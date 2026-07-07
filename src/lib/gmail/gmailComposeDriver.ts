/**
 * F6 · Layer 3 · Gmail compose DOM driver.
 *
 * Automates the Gmail compose form inside our persistent BrowseOverlay
 * webview. Runs entirely via DOM injection — no Gmail API, no Google
 * OAuth scope. The user is already signed into Gmail in the webview
 * (cookies persist at `app_data_dir/webview_profile`); this driver just
 * drives the compose form on their behalf.
 *
 * Error model (typed enum, propagates via `SendResult.error`):
 *   - SELECTOR_MISS         · none of the 3 fallbacks located a target
 *   - SEND_TIMEOUT          · Send clicked but no confirmation toast in 15s
 *   - GMAIL_INTERSTITIAL    · captcha / suspicious-activity form detected
 *   - RATE_LIMITED          · 24h cap reached
 *   - CIRCUIT_OPEN          · circuit breaker paused the session
 *
 * The driver is DEPENDENCY-INJECTED for testability:
 *   - `runInWebview(script)` returns the JS result — real usage calls
 *     Tauri's `webview_eval` command; tests pass a jsdom-backed shim.
 *   - `now()` returns Date.now() — tests time-travel.
 *   - `sleep(ms)` awaits ms — tests fast-forward.
 *   - `rand()` returns [0,1) — tests seed deterministic jitter.
 *
 * Nothing in this module touches Tauri directly; the Tauri bridge lives
 * in `gmailComposeBridge.ts` so this file is unit-testable in jsdom.
 */

import {
  GMAIL_SELECTORS,
  findWithFallback,
  type FallbackRole,
  type FindResult,
} from './selectorFallback';
import { RateLimitTracker } from './rateLimit';
import { SelectorMissCircuitBreaker } from './circuitBreaker';
import { perCharDelayMs, betweenSendsDelayMs, type RandomFn } from './timing';

export type SendError =
  | 'SELECTOR_MISS'
  | 'SEND_TIMEOUT'
  | 'GMAIL_INTERSTITIAL'
  | 'RATE_LIMITED'
  | 'CIRCUIT_OPEN';

export interface SendPayload {
  to: string;
  subject: string;
  body: string;   // HTML — the compose body is contenteditable
}

export type SendResult =
  | { ok: true; role: FallbackRole; fallbackIndexes: Partial<Record<FallbackRole, 0 | 1 | 2>> }
  | { ok: false; error: SendError; role?: FallbackRole; note?: string };

export interface DriverDeps {
  /** Query the live webview DOM for the current document root. */
  getDocument: () => ParentNode;
  /** Full HTML dump of the current webview page — used by the circuit breaker. */
  getDocumentHtml: () => string;
  /** Persist and query localStorage-ish state for rate-limit + session. */
  storage: Storage;
  /** Sink that saves HTML dumps when the breaker fires. */
  htmlDumpSink: { dump(key: string, html: string): Promise<void> | void };
  /** Deterministic clock. Defaults to Date.now. */
  now?: () => number;
  /** Sleep in ms. Defaults to setTimeout Promise. */
  sleep?: (ms: number) => Promise<void>;
  /** RNG — tests seed for determinism. Defaults to Math.random. */
  rand?: RandomFn;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GmailComposeDriver {
  private getDocument: () => ParentNode;
  private getDocumentHtml: () => string;
  private rateLimit: RateLimitTracker;
  private breaker: SelectorMissCircuitBreaker;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private rand: RandomFn;

  constructor(deps: DriverDeps) {
    this.getDocument = deps.getDocument;
    this.getDocumentHtml = deps.getDocumentHtml;
    this.rateLimit = new RateLimitTracker(deps.storage);
    this.breaker = new SelectorMissCircuitBreaker(deps.htmlDumpSink);
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? DEFAULT_SLEEP;
    this.rand = deps.rand ?? Math.random;
  }

  /**
   * Full send flow: pre-flight gates → open compose → fill fields with
   * jitter → click send → wait for confirmation → record success.
   */
  async sendEmail(payload: SendPayload): Promise<SendResult> {
    // Circuit breaker gate
    if (this.breaker.isPaused()) {
      return { ok: false, error: 'CIRCUIT_OPEN', note: 'selector-miss circuit is open · manual reset required' };
    }
    // Rate-limit gate
    const nowDate = new Date(this.now());
    if (!this.rateLimit.canSend(nowDate)) {
      return { ok: false, error: 'RATE_LIMITED', note: `24h cap reached (${this.rateLimit.snapshot(nowDate).count} sent)` };
    }
    // Captcha gate — pre-check before we touch anything.
    const interstitial = findWithFallback(this.getDocument(), GMAIL_SELECTORS.captcha_interstitial);
    if (interstitial.ok) {
      return { ok: false, error: 'GMAIL_INTERSTITIAL', role: 'captcha_interstitial', note: 'captcha visible · pausing' };
    }

    const fallbackHits: Partial<Record<FallbackRole, 0 | 1 | 2>> = {};

    const composeBtn = await this.findOrMiss('compose_button');
    if (!composeBtn.ok) return { ok: false, error: 'SELECTOR_MISS', role: composeBtn.role };
    fallbackHits.compose_button = composeBtn.fallbackIndex;

    const toField = await this.findOrMiss('to_field');
    if (!toField.ok) return { ok: false, error: 'SELECTOR_MISS', role: toField.role };
    fallbackHits.to_field = toField.fallbackIndex;
    await this.typeInto(toField.element, payload.to);

    const subjectField = await this.findOrMiss('subject_field');
    if (!subjectField.ok) return { ok: false, error: 'SELECTOR_MISS', role: subjectField.role };
    fallbackHits.subject_field = subjectField.fallbackIndex;
    await this.typeInto(subjectField.element, payload.subject);

    const bodyField = await this.findOrMiss('body_field');
    if (!bodyField.ok) return { ok: false, error: 'SELECTOR_MISS', role: bodyField.role };
    fallbackHits.body_field = bodyField.fallbackIndex;
    // Body is contenteditable — set innerHTML directly (no per-char jitter for HTML).
    (bodyField.element as HTMLElement).innerHTML = payload.body;

    const sendBtn = await this.findOrMiss('send_button');
    if (!sendBtn.ok) return { ok: false, error: 'SELECTOR_MISS', role: sendBtn.role };
    fallbackHits.send_button = sendBtn.fallbackIndex;
    (sendBtn.element as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));

    // Await confirmation toast — poll up to 15s.
    const toastResult = await this.pollFor('send_confirmation_toast', 15_000);
    if (!toastResult.ok) {
      return { ok: false, error: 'SEND_TIMEOUT', role: 'send_confirmation_toast' };
    }
    fallbackHits.send_confirmation_toast = toastResult.fallbackIndex;

    this.rateLimit.recordSend(nowDate);
    return { ok: true, role: 'send_confirmation_toast', fallbackIndexes: fallbackHits };
  }

  /**
   * Post-send inter-message pause with jitter. Callers hold this before
   * sending the next email in a batch so Gmail doesn't flag the account.
   */
  async pauseBetweenSends(): Promise<void> {
    await this.sleep(betweenSendsDelayMs(this.rand));
  }

  getRateLimitSnapshot(): ReturnType<RateLimitTracker['snapshot']> {
    return this.rateLimit.snapshot(new Date(this.now()));
  }
  getBreakerSnapshot(): ReturnType<SelectorMissCircuitBreaker['snapshot']> {
    return this.breaker.snapshot();
  }
  resetBreaker(): void {
    this.breaker.reset();
  }

  // ─── Internals ────────────────────────────────────────────────

  private async findOrMiss(role: FallbackRole): Promise<FindResult> {
    const res = findWithFallback(this.getDocument(), GMAIL_SELECTORS[role]);
    if (!res.ok) {
      await this.breaker.onSelectorMiss({
        nowMs: this.now(),
        role,
        domHtml: this.getDocumentHtml(),
      });
    }
    return res;
  }

  private async pollFor(role: FallbackRole, timeoutMs: number, intervalMs = 250): Promise<FindResult> {
    const deadline = this.now() + timeoutMs;
    while (this.now() < deadline) {
      const res = findWithFallback(this.getDocument(), GMAIL_SELECTORS[role]);
      if (res.ok) return res;
      await this.sleep(intervalMs);
    }
    return { ok: false, reason: 'SELECTOR_MISS', role, tried: [...GMAIL_SELECTORS[role].selectors] };
  }

  private async typeInto(element: Element, value: string): Promise<void> {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    // Simulate human-timing per character — the tests seed rand for
    // deterministic delay bounds; in production the sleep is real.
    for (const ch of value) {
      input.value = (input.value ?? '') + ch;
      // Fire an input event so React / Gmail listeners pick up the change.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(perCharDelayMs(this.rand));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
