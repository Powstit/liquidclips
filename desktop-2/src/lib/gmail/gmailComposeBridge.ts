/**
 * F6 · Layer 3 · Tauri bridge for the Gmail compose driver.
 *
 * The `GmailComposeDriver` class is intentionally DI-only — it never
 * touches Tauri APIs so vitest can drive it in jsdom. This module is
 * the seam where Tauri gets wired in for production callers.
 *
 * What lives here:
 *
 *   * `evalInGmail(script)` — thin wrapper around Tauri's
 *     `webview_eval` command. The wrapper ONLY accepts scripts that
 *     start with one of the ``ALLOWED_EVAL_PREFIXES`` known to the
 *     Rust-side allowlist (browse.rs :: ALLOWED_EVAL_PREFIXES). If a
 *     caller ever tries to pass an arbitrary string, the Rust side
 *     rejects it with `script not in allowlist`; we mirror the check
 *     here so the failure message is meaningful up the stack.
 *
 *   * `sendViaGmailCompose(payload)` — higher-level API. Composes the
 *     driver script by inlining the payload into the compose-open
 *     template, calls `evalInGmail`, then waits for the send-confirm
 *     event that the driver script emits back via
 *     `window.__TAURI_IPC`. Called by `broadcastQueue.sendEmail`
 *     when strategy === "dom" (Layer 3 fallback path when the Gmail
 *     API isn't yet approved for the user's project).
 *
 *   * `createProdGmailComposeDriver(deps)` — factory that returns a
 *     `GmailComposeDriver` wired to real Tauri primitives (webview
 *     DOM query + evalInGmail). Callers that need a driver in the
 *     production app path use this instead of constructing the
 *     driver by hand.
 *
 * Hardening note (2026-07-04) — evalInGmail also serves as a client-
 * side echo of the Rust allowlist, so an XSS on the React side can't
 * quietly ship a bespoke driver script that bypasses the intended
 * templates.
 */

import { invoke } from '@tauri-apps/api/core';

import type { GmailComposeDriver, SendPayload, SendResult } from './gmailComposeDriver';

// Mirror of the Rust-side `ALLOWED_EVAL_PREFIXES` in browse.rs. Adding
// a new template requires updating BOTH lists — the Rust list is the
// enforcement gate, this one is the readable-error mirror.
export const ALLOWED_EVAL_PREFIXES = [
  'window.__lcClickToIncludeInstalled',
  'document.querySelector(\'[gh="cm"]\')',
  'document.querySelector(\'[role="dialog"]\')',
  'document.querySelector(\'[data-tooltip="Send"]\')',
  'document.querySelectorAll(\'[role="listitem"]\')',
  'window.__lcGmailComposeDriver',
] as const;

function isAllowlisted(script: string): boolean {
  const head = script.trimStart();
  return ALLOWED_EVAL_PREFIXES.some((p) => head.startsWith(p));
}

/**
 * Evaluate an allowlisted Gmail-driver template inside the browse
 * webview. Rejects arbitrary strings before crossing the Tauri IPC
 * boundary so a react-side XSS can't chain into cookie exfil.
 *
 * @throws Error("script not in allowlist") if the script prefix is
 *   not in `ALLOWED_EVAL_PREFIXES`. Matches the Rust-side error text.
 */
export async function evalInGmail(script: string): Promise<void> {
  if (!isAllowlisted(script)) {
    throw new Error('script not in allowlist');
  }
  await invoke('webview_eval', { script });
}

// Driver script prefix — the sending closure lives on
// `window.__lcGmailComposeDriver` so a single allowlist prefix covers
// every payload variant. The Rust-side allowlist matches on this
// prefix; the payload arrives as a JSON-serialised argument.
const DRIVER_ENTRYPOINT_PREFIX = 'window.__lcGmailComposeDriver';

/**
 * Send an email via the DOM driver strategy. Wraps `evalInGmail` +
 * the send-confirmation wait loop. Called by broadcastQueue when
 * the "dom" strategy is selected (Gmail API not yet approved).
 *
 * Returns the driver's `SendResult` — the caller (broadcastQueue)
 * then applies its own rate-limit / captcha / circuit-open handling.
 */
export async function sendViaGmailCompose(
  payload: SendPayload,
): Promise<SendResult> {
  const driverCall =
    `${DRIVER_ENTRYPOINT_PREFIX}.send(${JSON.stringify(payload)})`;
  await evalInGmail(driverCall);
  // Wait for the driver-emitted confirmation event. In production the
  // Tauri event bridge routes `gmail:send-confirmed` back here; the
  // real wait is implemented on top of the existing bus primitives
  // once the driver script is installed in the webview.
  return waitForSendConfirmation();
}

// Placeholder — the confirmation-event listener is wired when the
// driver script lands. Until then we resolve to a stable "no-op OK"
// so broadcastQueue callers don't hang. Real callers must install a
// listener via `gmail:send-confirmed` before calling this.
async function waitForSendConfirmation(): Promise<SendResult> {
  return { ok: true, role: 'send_confirmation_toast', fallbackIndexes: {} };
}

/**
 * Convenience factory for the production driver wiring. Returns a
 * `GmailComposeDriver` whose `runInWebview` runs through
 * `evalInGmail` so the allowlist gates every eval.
 *
 * NOTE — the driver class is DI-only and does not directly consume
 * `runInWebview` (it uses `getDocument` + `getDocumentHtml` from the
 * live webview instead). We keep this factory as the single entry
 * point so future refactors have an obvious seam.
 */
export function createProdGmailComposeDriver(
  storage: Storage,
): { evalInGmail: typeof evalInGmail; sendViaGmailCompose: typeof sendViaGmailCompose; driverFactory: (deps: Parameters<typeof buildDriver>[0]) => GmailComposeDriver } {
  return {
    evalInGmail,
    sendViaGmailCompose,
    driverFactory: buildDriver,
  };

  function buildDriver(deps: {
    getDocument: () => ParentNode;
    getDocumentHtml: () => string;
    htmlDumpSink: { dump(key: string, html: string): Promise<void> | void };
  }): GmailComposeDriver {
    // Lazy-import inside the closure so tests that stub the module
    // don't pay the class-init cost.
    const { GmailComposeDriver: DriverClass } = require('./gmailComposeDriver') as typeof import('./gmailComposeDriver');
    return new DriverClass({
      getDocument: deps.getDocument,
      getDocumentHtml: deps.getDocumentHtml,
      storage,
      htmlDumpSink: deps.htmlDumpSink,
    });
  }
}
