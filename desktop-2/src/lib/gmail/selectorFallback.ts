/**
 * F6 · Layer 3 · reliability sprint · 2026-07-04
 *
 * Pure DOM selector fallback finder. Kept separate from the driver so it
 * can be unit-tested in jsdom without the Tauri IPC layer.
 *
 * Gmail's DOM ships obfuscated class names ("jd", "T-I", "aoT") and
 * changes them on a rolling basis. Every action the F6 driver takes MUST
 * carry three fallback selectors — a stable one (data-tooltip / role /
 * aria-label), a semi-stable one (contenteditable / :nth-child), and a
 * last-resort obfuscated one (class chain from a fresh recording). If
 * ALL THREE miss, the driver reports SELECTOR_MISS and the circuit
 * breaker starts counting.
 */

export type FallbackRole =
  | 'compose_button'
  | 'to_field'
  | 'subject_field'
  | 'body_field'
  | 'send_button'
  | 'send_confirmation_toast'
  | 'captcha_interstitial';

export interface SelectorFallback {
  role: FallbackRole;
  /** Ordered primary → secondary → tertiary. All three MUST be provided
   * so the driver can report which fallback fired. Empty strings are
   * skipped (some roles have only 1-2 sensible selectors) but the array
   * length is always 3. */
  selectors: readonly [string, string, string];
}

export type FindResult =
  | { ok: true; element: Element; fallbackIndex: 0 | 1 | 2 }
  | { ok: false; reason: 'SELECTOR_MISS'; role: FallbackRole; tried: readonly string[] };

/**
 * Search a document root for the first matching element across the three
 * fallback selectors. Returns which fallback fired so the driver can log
 * "selector 2/3 hit — Gmail nudged the primary" without a full outage.
 */
export function findWithFallback(
  root: ParentNode,
  fallback: SelectorFallback,
): FindResult {
  const tried: string[] = [];
  for (let i = 0; i < fallback.selectors.length; i++) {
    const selector = fallback.selectors[i];
    if (!selector) continue;
    tried.push(selector);
    let el: Element | null = null;
    try {
      el = root.querySelector(selector);
    } catch {
      // Malformed selector — skip and try next fallback.
      el = null;
    }
    if (el) {
      return { ok: true, element: el, fallbackIndex: i as 0 | 1 | 2 };
    }
  }
  return { ok: false, reason: 'SELECTOR_MISS', role: fallback.role, tried };
}

/**
 * Locked selector table for every action the F6 Gmail driver performs.
 * Update the primary when Gmail ships a redesign; leave the secondary +
 * tertiary intact as safety nets. Any modification requires re-running
 * `layer-3-selector-audit.test.ts`.
 */
export const GMAIL_SELECTORS: Record<FallbackRole, SelectorFallback> = {
  compose_button: {
    role: 'compose_button',
    selectors: [
      'div[gh="cm"]',                                 // Gmail's stable "gh" attribute
      'div[role="button"][aria-label*="Compose" i]',  // localised aria-label
      'div.T-I.T-I-KE.L3',                            // obfuscated class chain
    ],
  },
  to_field: {
    role: 'to_field',
    selectors: [
      'input[peoplekit-id][aria-label*="To" i]',
      'textarea[name="to"]',
      'div[role="combobox"][aria-label*="Recipient" i]',
    ],
  },
  subject_field: {
    role: 'subject_field',
    selectors: [
      'input[name="subjectbox"]',
      'input[placeholder*="Subject" i]',
      'input.aoT',
    ],
  },
  body_field: {
    role: 'body_field',
    selectors: [
      'div[role="textbox"][aria-label*="Body" i]',
      'div[contenteditable="true"][g_editable]',
      'div.Am.aiL.Al.editable.LW-avf.tS-tW',
    ],
  },
  send_button: {
    role: 'send_button',
    selectors: [
      'div[role="button"][data-tooltip^="Send" i]',
      'div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
      'div[aria-label*="Send" i][role="button"]',
    ],
  },
  send_confirmation_toast: {
    role: 'send_confirmation_toast',
    selectors: [
      'div.b8.UC[role="alert"]',                       // Gmail's "Message sent" pill
      'span:has-text("Message sent")',                 // fallback text
      'div[aria-live="polite"]',                       // last-resort live-region
    ],
  },
  captcha_interstitial: {
    role: 'captcha_interstitial',
    selectors: [
      'iframe[src*="recaptcha"]',
      'div[data-testid="unusual-activity"]',
      'form[action*="challenge"]',
    ],
  },
};
