/**
 * F6 · Layer 3 · Gmail compose driver unit tests.
 *
 * Runs in jsdom. Covers the 6 named assertions from Daniel's
 * unblock message:
 *   1. 3-selector fallback per action (primary hits)
 *   2. 3-selector fallback per action (secondary hits)
 *   3. 3-selector fallback per action (tertiary hits)
 *   4. Captcha detection + pause
 *   5. Rate limit enforcement (101st blocked)
 *   6. Circuit breaker fires on 3× SELECTOR_MISS + HTML dump saved
 *
 * All tests use fake DOM roots + injected clock/rand so they run in
 * milliseconds — no real Gmail, no real webview, no real waits.
 */

import { describe, it, expect } from 'vitest';
import { GmailComposeDriver } from './gmailComposeDriver';
import { GMAIL_SELECTORS, findWithFallback } from './selectorFallback';
import { RateLimitTracker } from './rateLimit';
import { SelectorMissCircuitBreaker } from './circuitBreaker';
import { perCharDelayMs, betweenSendsDelayMs, seededRandom } from './timing';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

class TestDumpSink {
  public dumps: Array<{ key: string; html: string }> = [];
  async dump(key: string, html: string): Promise<void> {
    this.dumps.push({ key, html });
  }
}

/** Build a mock Gmail DOM with the primary selector for each role. */
function buildFullGmailDom(): Document {
  const doc = new DOMParser().parseFromString(`
    <html>
      <body>
        <div gh="cm">Compose</div>
        <input peoplekit-id="1" aria-label="To" />
        <input name="subjectbox" />
        <div role="textbox" aria-label="Body"></div>
        <div role="button" data-tooltip="Send (⌘+Enter)">Send</div>
      </body>
    </html>
  `, 'text/html');
  return doc;
}

function buildGmailDomMissingPrimary(role: 'compose_button' | 'to_field' | 'subject_field' | 'body_field' | 'send_button'): Document {
  const doc = buildFullGmailDom();
  // Remove the primary selector's element so the secondary must fire.
  const primary = doc.querySelector(GMAIL_SELECTORS[role].selectors[0]);
  primary?.remove();
  if (role === 'compose_button') {
    const el = doc.createElement('div');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Compose');
    doc.body.appendChild(el);
  } else if (role === 'to_field') {
    const el = doc.createElement('textarea');
    el.setAttribute('name', 'to');
    doc.body.appendChild(el);
  } else if (role === 'subject_field') {
    const el = doc.createElement('input');
    el.setAttribute('placeholder', 'Subject');
    doc.body.appendChild(el);
  } else if (role === 'body_field') {
    const el = doc.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('g_editable', 'true');
    doc.body.appendChild(el);
  } else if (role === 'send_button') {
    const el = doc.createElement('div');
    el.className = 'T-I J-J5-Ji aoO v7 T-I-atl L3';
    doc.body.appendChild(el);
  }
  return doc;
}

function ensureSendToast(doc: Document): void {
  const toast = doc.createElement('div');
  toast.className = 'b8 UC';
  toast.setAttribute('role', 'alert');
  toast.textContent = 'Message sent';
  doc.body.appendChild(toast);
}

// ─────────────────────────────────────────────────────────────
// 1-3 · Selector fallback tests
// ─────────────────────────────────────────────────────────────

describe('selector fallback', () => {
  it('primary selector hits on a fresh Gmail DOM', () => {
    const doc = buildFullGmailDom();
    for (const role of ['compose_button', 'to_field', 'subject_field', 'body_field', 'send_button'] as const) {
      const res = findWithFallback(doc, GMAIL_SELECTORS[role]);
      expect(res.ok, `role ${role} primary must hit`).toBe(true);
      if (res.ok) expect(res.fallbackIndex).toBe(0);
    }
  });

  it('secondary selector fires when primary is missing', () => {
    for (const role of ['compose_button', 'to_field', 'subject_field', 'body_field', 'send_button'] as const) {
      const doc = buildGmailDomMissingPrimary(role);
      const res = findWithFallback(doc, GMAIL_SELECTORS[role]);
      expect(res.ok, `role ${role} secondary must hit`).toBe(true);
      if (res.ok) expect(res.fallbackIndex).toBe(1);
    }
  });

  it('tertiary selector fires when primary + secondary missing', () => {
    // Only the tertiary selector element is present.
    const doc = new DOMParser().parseFromString(`<html><body>
      <div class="T-I T-I-KE L3">obfuscated compose</div>
      <div role="combobox" aria-label="Recipients">to combobox</div>
      <input class="aoT" />
      <div class="Am aiL Al editable LW-avf tS-tW"></div>
      <div aria-label="Send email" role="button">obfuscated send</div>
    </body></html>`, 'text/html');
    for (const role of ['compose_button', 'to_field', 'subject_field', 'body_field', 'send_button'] as const) {
      const res = findWithFallback(doc, GMAIL_SELECTORS[role]);
      expect(res.ok, `role ${role} tertiary must hit`).toBe(true);
      if (res.ok) expect(res.fallbackIndex).toBe(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 4 · Captcha detection
// ─────────────────────────────────────────────────────────────

describe('captcha detection', () => {
  it('pauses the send flow when a captcha interstitial is present', async () => {
    const doc = buildFullGmailDom();
    // Inject a captcha iframe
    const iframe = doc.createElement('iframe');
    iframe.src = 'https://www.google.com/recaptcha/api2/anchor?ar=1';
    doc.body.appendChild(iframe);
    const storage = new MemoryStorage();
    const sink = new TestDumpSink();
    const driver = new GmailComposeDriver({
      getDocument: () => doc,
      getDocumentHtml: () => doc.documentElement.outerHTML,
      storage,
      htmlDumpSink: sink,
      sleep: async () => undefined,
    });
    const result = await driver.sendEmail({ to: 't@example.com', subject: 's', body: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('GMAIL_INTERSTITIAL');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 5 · Rate limit enforcement
// ─────────────────────────────────────────────────────────────

describe('rate limit', () => {
  it('blocks the 101st send in a 24h window on the driver', async () => {
    const storage = new MemoryStorage();
    // Preload 100 sends on today's key
    const key = RateLimitTracker.dayKey(new Date('2026-07-04T12:00:00Z'));
    storage.setItem(key, '100');

    const doc = buildFullGmailDom();
    ensureSendToast(doc);
    const driver = new GmailComposeDriver({
      getDocument: () => doc,
      getDocumentHtml: () => doc.documentElement.outerHTML,
      storage,
      htmlDumpSink: new TestDumpSink(),
      now: () => new Date('2026-07-04T12:00:00Z').getTime(),
      sleep: async () => undefined,
    });
    const result = await driver.sendEmail({ to: 't@example.com', subject: 's', body: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('RATE_LIMITED');
    }
  });

  it('allows the 100th send but blocks the 101st', async () => {
    const storage = new MemoryStorage();
    const key = RateLimitTracker.dayKey(new Date('2026-07-04T12:00:00Z'));
    storage.setItem(key, '99');
    const rate = new RateLimitTracker(storage);
    expect(rate.canSend(new Date('2026-07-04T12:00:00Z'))).toBe(true);
    rate.recordSend(new Date('2026-07-04T12:00:00Z'));
    expect(rate.canSend(new Date('2026-07-04T12:00:00Z'))).toBe(false); // 100 sent → 101st blocked
  });
});

// ─────────────────────────────────────────────────────────────
// 6 · Circuit breaker fires after 3× SELECTOR_MISS + HTML dumped
// ─────────────────────────────────────────────────────────────

describe('circuit breaker', () => {
  it('opens after 3 misses in the rolling window and captures an HTML dump', async () => {
    const sink = new TestDumpSink();
    const breaker = new SelectorMissCircuitBreaker(sink, { windowMs: 60_000, threshold: 3 });
    const html = '<html><body>dump-payload</body></html>';
    expect(breaker.isPaused()).toBe(false);
    await breaker.onSelectorMiss({ nowMs: 1000, role: 'compose_button', domHtml: html });
    await breaker.onSelectorMiss({ nowMs: 2000, role: 'compose_button', domHtml: html });
    expect(breaker.isPaused()).toBe(false);
    const evt = await breaker.onSelectorMiss({ nowMs: 3000, role: 'compose_button', domHtml: html });
    expect(breaker.isPaused()).toBe(true);
    expect(evt.paused).toBe(true);
    expect(evt.dumpedTo).toMatch(/^gmail-dom-.*\.html$/);
    expect(sink.dumps.length).toBe(1);
    expect(sink.dumps[0].html).toContain('dump-payload');
  });

  it('does NOT open when 3 misses land outside the 5min window', async () => {
    const sink = new TestDumpSink();
    const breaker = new SelectorMissCircuitBreaker(sink, { windowMs: 60_000, threshold: 3 });
    // Space misses > windowMs apart
    await breaker.onSelectorMiss({ nowMs: 0, role: 'send_button', domHtml: '' });
    await breaker.onSelectorMiss({ nowMs: 70_000, role: 'send_button', domHtml: '' });
    await breaker.onSelectorMiss({ nowMs: 140_000, role: 'send_button', domHtml: '' });
    expect(breaker.isPaused()).toBe(false);
    expect(sink.dumps.length).toBe(0);
  });

  it('driver refuses to send when the breaker is open', async () => {
    const storage = new MemoryStorage();
    const sink = new TestDumpSink();
    // Trip the breaker by giving it a document with NO known selectors, 3 times.
    const brokenDoc = new DOMParser().parseFromString('<html><body>nothing</body></html>', 'text/html');
    const driverBroken = new GmailComposeDriver({
      getDocument: () => brokenDoc,
      getDocumentHtml: () => brokenDoc.documentElement.outerHTML,
      storage,
      htmlDumpSink: sink,
      sleep: async () => undefined,
    });
    await driverBroken.sendEmail({ to: 'a', subject: 'a', body: 'a' });
    await driverBroken.sendEmail({ to: 'b', subject: 'b', body: 'b' });
    await driverBroken.sendEmail({ to: 'c', subject: 'c', body: 'c' });
    const snap = driverBroken.getBreakerSnapshot();
    expect(snap.paused).toBe(true);
    expect(sink.dumps.length).toBe(1);
    // Next attempt returns CIRCUIT_OPEN
    const next = await driverBroken.sendEmail({ to: 'd', subject: 'd', body: 'd' });
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toBe('CIRCUIT_OPEN');
  });
});

// ─────────────────────────────────────────────────────────────
// 7 · Human-timing jitter bounds
// ─────────────────────────────────────────────────────────────

describe('human timing', () => {
  it('per-char delay lands in the 60-140ms window', () => {
    const rand = seededRandom(42);
    for (let i = 0; i < 200; i++) {
      const d = perCharDelayMs(rand);
      expect(d).toBeGreaterThanOrEqual(60);
      expect(d).toBeLessThanOrEqual(140);
    }
  });

  it('between-sends delay lands in the 6-12s window', () => {
    const rand = seededRandom(7);
    for (let i = 0; i < 200; i++) {
      const d = betweenSendsDelayMs(rand);
      expect(d).toBeGreaterThanOrEqual(6_000);
      expect(d).toBeLessThanOrEqual(12_000);
    }
  });
});
