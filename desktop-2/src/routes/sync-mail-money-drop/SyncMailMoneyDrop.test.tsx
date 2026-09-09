/**
 * SyncMailMoneyDrop · Phase 2 (macOS native Contacts) flow coverage.
 *
 * First test file for this component. Scoped to the native-Contacts
 * addition (`nativeContactPicker.ts`) and its manual-entry fallback —
 * NOT a general coverage pass of the whole referral surface. The
 * original Google OAuth/Gmail-scan path (`onConnect`) is exercised only
 * as a regression check that the native addition hasn't disturbed it;
 * its own detailed behavior is already covered by scanner.test.ts /
 * contactScan.test.ts / sendComposer.test.ts.
 *
 * `pickContactNative` is imported directly by SyncMailMoneyDrop.tsx
 * (no prop-injection seam like oauthDriver/httpFetch/batchLookup), so
 * it's mocked at module scope; `rawContactFromNativePick` and
 * `validateManualEmail` are kept real via importOriginal since they're
 * pure and already covered in isolation by nativeContactPicker.test.ts.
 *
 * Mount pattern matches the repo's established convention (no
 * @testing-library/react): `createRoot` + `act`, `document.body`
 * queries (this component renders directly into its mount container,
 * no portal).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../lib/diagnosticLogger', () => ({
  lcDiag: () => undefined,
}));

vi.mock('../../lib/watchdog', () => ({
  Watchdog: ({ children }: { children: React.ReactNode }) => children,
  watchdogWrap: (_meta: unknown, fn: (...args: unknown[]) => unknown) => fn,
}));

const pickContactNativeMock = vi.fn();
vi.mock('../../lib/f5/nativeContactPicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/f5/nativeContactPicker')>();
  return {
    ...actual,
    pickContactNative: (...args: unknown[]) => pickContactNativeMock(...args),
  };
});

const openSmartMock = vi.fn();
vi.mock('../../lib/openSmart', () => ({
  openSmart: (...args: unknown[]) => openSmartMock(...args),
}));

import { SyncMailMoneyDrop } from './SyncMailMoneyDrop';
import type { OAuthDriver } from '../../lib/f5/googleOAuth';
import type { HttpFetch } from '../../lib/f5/contactScan';
import type { BatchLookup } from '../../lib/f5/youtubeCrossRef';

let container: HTMLDivElement;
let root: Root;

// Phase 4 (K-factor existing-user gate) — every contact with an email
// now runs through /me/contact-check before any invite UI. Default to
// "not a user" so the many existing email-having-contact tests below
// keep exercising the pre-gate behavior unchanged without each needing
// their own fetch mock; individual tests override this for the
// existing-user / lookup-failure cases.
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}
const fetchMock = vi.fn((_input?: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(jsonResponse({ is_user: false })),
);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  pickContactNativeMock.mockReset();
  openSmartMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: false })));
  vi.stubGlobal('fetch', fetchMock);
  // jsdom doesn't implement HTMLMediaElement.play() — it returns
  // undefined rather than a Promise. The component renders an
  // autoplaying <video> via DemoOverlay (unrelated to this feature),
  // which calls .play().catch(...) and crashes without this shim.
  // Test-environment-only; not a production code change.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mount(): void {
  act(() => {
    root = createRoot(container);
    root.render(<SyncMailMoneyDrop showScrubber={false} />);
  });
}

function findButtonByText(text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(text),
  );
  if (!btn) throw new Error(`no button found containing text: ${text}`);
  return btn as HTMLButtonElement;
}

function queryButtonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(text),
    ) as HTMLButtonElement) ?? null
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function clickNativePick(): Promise<void> {
  await act(async () => {
    findButtonByText('Link with contact directly').click();
    // A contact with an email now runs an extra async hop through
    // /me/contact-check (fetch + res.json()) before state settles.
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

// ─────────────────────────────────────────────────────────────
// TEST E — native contact with email
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST E — native contact with email', () => {
  it('reaches approve-send with a one-row roster and no manual-entry form', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();

    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.querySelector('.smmd-roster-name')?.textContent).toBe('Ada Lovelace');
    // approve-send/roster-populating markup replaces the hook screen —
    // the native-pick entry point is gone.
    expect(queryButtonByText('Link with contact directly')).toBeNull();
    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// TEST F — native contact without email
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST F — native contact without email', () => {
  it('shows the inline manual-entry form with the picked contact name', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'No Email Guy' });
    mount();
    await clickNativePick();

    const form = container.querySelector('.smmd-native-manual-email');
    expect(form).not.toBeNull();
    expect(form?.textContent).toContain('No Email Guy');
    expect(form?.textContent).toContain('No email address is saved for this contact.');
    const input = container.querySelector<HTMLInputElement>('.smmd-native-manual-input');
    expect(input).not.toBeNull();
    // No roster/send action has happened yet.
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('falls back to the literal "(no name on record)" label when displayName is empty', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: '' });
    mount();
    await clickNativePick();

    const form = container.querySelector('.smmd-native-manual-email');
    expect(form?.textContent).toContain('(no name on record)');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST G — valid manual email
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST G — valid manual email', () => {
  it('continues through finishNativeContact into a one-row roster at approve-send', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'Grace Hopper' });
    mount();
    await clickNativePick();

    const input = container.querySelector<HTMLInputElement>('.smmd-native-manual-input')!;
    await act(async () => {
      setInputValue(input, 'grace@gmail.com');
    });
    await act(async () => {
      findButtonByText('Continue').click();
    });

    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.querySelector('.smmd-roster-name')?.textContent).toBe('Grace Hopper');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST H — invalid manual email
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST H — invalid manual email', () => {
  async function enterAndContinue(value: string): Promise<void> {
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'Someone' });
    mount();
    await clickNativePick();
    const input = container.querySelector<HTMLInputElement>('.smmd-native-manual-input')!;
    await act(async () => {
      setInputValue(input, value);
    });
    await act(async () => {
      findButtonByText('Continue').click();
    });
  }

  it('empty input: shows the required-field error and stays on the form', async () => {
    await enterAndContinue('');
    expect(container.querySelector('.smmd-native-manual-error')?.textContent).toBe(
      'Email address is required.',
    );
    expect(container.querySelector('.smmd-native-manual-email')).not.toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('whitespace-only input: shows the required-field error and stays on the form', async () => {
    await enterAndContinue('   ');
    expect(container.querySelector('.smmd-native-manual-error')?.textContent).toBe(
      'Email address is required.',
    );
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('clearly malformed input: shows a validation error and stays on the form', async () => {
    await enterAndContinue('not-an-email');
    expect(container.querySelector('.smmd-native-manual-error')?.textContent).toBe(
      'Enter a valid email address.',
    );
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('clears the inline error as soon as the user edits the input again', async () => {
    await enterAndContinue('not-an-email');
    expect(container.querySelector('.smmd-native-manual-error')).not.toBeNull();
    const input = container.querySelector<HTMLInputElement>('.smmd-native-manual-input')!;
    await act(async () => {
      setInputValue(input, 'still-typing');
    });
    expect(container.querySelector('.smmd-native-manual-error')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// TEST I — manual-entry cancellation
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST I — manual-entry cancellation', () => {
  it('returns to the normal hook screen with no roster and no lingering form state', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'Someone' });
    mount();
    await clickNativePick();
    expect(container.querySelector('.smmd-native-manual-email')).not.toBeNull();

    await act(async () => {
      findButtonByText('Cancel').click();
    });

    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);

    // Re-opening the picker afterward starts from a clean slate — no
    // leftover name/email from the cancelled attempt.
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'Fresh Person' });
    await clickNativePick();
    expect(container.querySelector('.smmd-native-manual-email')?.textContent).toContain('Fresh Person');
    expect(container.querySelector('.smmd-native-manual-email')?.textContent).not.toContain('Someone');
  });
});

// ─────────────────────────────────────────────────────────────
// TEST J — native picker cancellation
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST J — native picker cancellation', () => {
  it('stays on the hook screen with no roster and no error, no fabricated contact', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'cancelled' });
    mount();
    await clickNativePick();

    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// TEST K — native picker error
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · TEST K — native picker error', () => {
  it('shows an inline error and leaves the hook screen interactive (not stuck loading)', async () => {
    pickContactNativeMock.mockResolvedValue({ status: 'error', message: 'boom' });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain('try again');
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    // Not stuck: the native-pick entry is still present and enabled,
    // so the user can immediately retry.
    const nativePickBtn = queryButtonByText('Link with contact directly');
    expect(nativePickBtn).not.toBeNull();
    expect(nativePickBtn?.disabled).toBeFalsy();
  });

  // Note: a genuinely rejected pickContactNative() promise is not a
  // reachable production scenario — the real implementation
  // (nativeContactPicker.ts) wraps everything that could throw
  // (including invoke() rejecting) in its own try/catch and always
  // resolves to a typed { status: 'error', message } result instead.
  // That guarantee is what TEST D in nativeContactPicker.test.ts
  // proves directly; asserting behavior for an impossible input here
  // would test a scenario the real bridge cannot produce.
});

// ─────────────────────────────────────────────────────────────
// Phase 4 — Gmail/OAuth entry point removed; native Contacts is sole entry
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · Phase 4 — native Contacts is the sole K-factor entry point', () => {
  it('renders no "Link my email" or "Or choose one contact directly" text anywhere on the hook screen', async () => {
    mount();
    expect(container.textContent).not.toContain('Link my email');
    expect(container.textContent).not.toContain('Or choose one contact directly');
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
  });

  it('shows the required supporting copy beneath the primary action', async () => {
    mount();
    expect(container.textContent).toContain(
      'Pick a contact from your device and invite them via Messages or Email.',
    );
  });

  it('the injected Gmail/OAuth props (oauthDriver/httpFetch/batchLookup) are accepted without error but have no UI trigger', async () => {
    // onConnect is intentionally preserved (not deleted — shared
    // F5Scanner/googleOAuth modules, still used by CrewOnboarding.tsx)
    // but no button calls it anymore. This proves the component still
    // renders cleanly with these props supplied (no crash from a
    // stale prop contract) even though nothing in the UI can reach
    // the Gmail path now — that unreachability is the point of this
    // task, not a regression to guard against.
    const oauthDriver: OAuthDriver = async () => ({
      ok: true,
      tokens: {
        access: 'test-access-token',
        refresh: 'test-refresh-token',
        expiresAt: Date.now() + 3600_000,
        scope: [
          'https://www.googleapis.com/auth/contacts.readonly',
          'https://www.googleapis.com/auth/gmail.metadata',
        ],
      },
    });
    const httpFetch: HttpFetch = async ({ url }) => {
      if (url.includes('people.googleapis.com')) return { status: 200, body: { connections: [] } };
      if (url.includes('gmail.googleapis.com')) return { status: 200, body: { messages: [] } };
      throw new Error(`unexpected url in regression stub: ${url}`);
    };
    const batchLookup: BatchLookup = async () => [];

    act(() => {
      root = createRoot(container);
      root.render(
        <SyncMailMoneyDrop
          showScrubber={false}
          oauthDriver={oauthDriver}
          httpFetch={httpFetch}
          batchLookup={batchLookup}
        />,
      );
    });

    expect(queryButtonByText('Link my email')).toBeNull();
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Phase 3 — native Messages handoff
// ─────────────────────────────────────────────────────────────

async function flushPromises(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('SyncMailMoneyDrop · Phase 3 — email-only contact (regression, no phoneNumbers)', () => {
  it('behaves exactly as before: straight to approve-send, no channel-choice UI', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();

    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.textContent).not.toContain('Send via Messages');
    expect(container.textContent).not.toContain('Send via Email');
  });

  it('also unaffected when phoneNumbers is explicitly empty', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      phoneNumbers: [],
    });
    mount();
    await clickNativePick();

    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.textContent).not.toContain('Send via Messages');
  });
});

describe('SyncMailMoneyDrop · Phase 3 — phone-only contact', () => {
  it('offers "Send via Messages" only — no email option, no manual-email form, no roster yet', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'no_email',
      displayName: 'No Email Guy',
      phoneNumbers: [{ number: '+15551234567', label: 'mobile' }],
    });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain('No Email Guy');
    expect(queryButtonByText('Send via Messages')).not.toBeNull();
    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(container.querySelector('.smmd-native-manual-input')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('clicking "Send via Messages" opens an sms: URL and reaches back-to-app', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'no_email',
      displayName: 'No Email Guy',
      phoneNumbers: [{ number: '+15551234567', label: 'mobile' }],
    });
    openSmartMock.mockResolvedValue(undefined);
    mount();
    await clickNativePick();

    await act(async () => {
      findButtonByText('Send via Messages').click();
      await flushPromises();
    });

    expect(openSmartMock).toHaveBeenCalledTimes(1);
    expect(openSmartMock.mock.calls[0][0]).toMatch(/^sms:\+15551234567\?body=/);
    // Never automatically sends — openSmart only opens Messages.app with
    // a pre-filled draft; there is no second call that would submit it.
    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
  });
});

describe('SyncMailMoneyDrop · Phase 3 — email + phone contact', () => {
  function mockBothContact() {
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      phoneNumbers: [{ number: '+15559876543', label: 'mobile' }],
    });
  }

  it('offers both "Send via Email" and "Send via Messages" — does not auto-choose either', async () => {
    mockBothContact();
    mount();
    await clickNativePick();

    expect(queryButtonByText('Send via Email')).not.toBeNull();
    expect(queryButtonByText('Send via Messages')).not.toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('"Send via Email" proceeds through the existing finishNativeContact roster path', async () => {
    mockBothContact();
    mount();
    await clickNativePick();

    await act(async () => {
      findButtonByText('Send via Email').click();
    });

    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.querySelector('.smmd-roster-name')?.textContent).toBe('Ada Lovelace');
    expect(queryButtonByText('Send via Messages')).toBeNull();
  });

  it('"Send via Messages" opens the sms: URL directly without building an email roster', async () => {
    mockBothContact();
    openSmartMock.mockResolvedValue(undefined);
    mount();
    await clickNativePick();

    await act(async () => {
      findButtonByText('Send via Messages').click();
      await flushPromises();
    });

    expect(openSmartMock).toHaveBeenCalledTimes(1);
    expect(openSmartMock.mock.calls[0][0]).toMatch(/^sms:\+15559876543\?body=/);
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });
});

describe('SyncMailMoneyDrop · Phase 3 — neither email nor phone (regression)', () => {
  it('falls back to the existing manual-email form, unaffected by Phase 3', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'no_email',
      displayName: 'Nobody Reachable',
      phoneNumbers: [],
    });
    mount();
    await clickNativePick();

    expect(container.querySelector('.smmd-native-manual-input')).not.toBeNull();
    expect(queryButtonByText('Send via Messages')).toBeNull();
  });
});

describe('SyncMailMoneyDrop · Phase 3 — Messages handoff failure', () => {
  it('shows an error and does not falsely advance to a "sent" state', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'no_email',
      displayName: 'No Email Guy',
      phoneNumbers: [{ number: '+15551234567', label: 'mobile' }],
    });
    openSmartMock.mockRejectedValue(new Error('no default handler for sms:'));
    mount();
    await clickNativePick();

    await act(async () => {
      findButtonByText('Send via Messages').click();
      await flushPromises();
    });

    expect(container.textContent).toContain('Messages refused to open');
    // Must not have advanced past the choice screen into the
    // back-to-app/notification-drop "money moment" — Messages never
    // actually opened.
    expect(queryButtonByText('Send via Messages')).not.toBeNull();
  });
});

describe('SyncMailMoneyDrop · Phase 3 — channel-choice cancellation', () => {
  it('Cancel returns to the normal hook screen with no roster and no Messages call', async () => {
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      phoneNumbers: [{ number: '+15559876543', label: 'mobile' }],
    });
    mount();
    await clickNativePick();
    expect(queryButtonByText('Send via Email')).not.toBeNull();

    await act(async () => {
      findButtonByText('Cancel').click();
    });

    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(queryButtonByText('Send via Messages')).toBeNull();
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    expect(openSmartMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Phase 4 — K-factor existing-user gate (/me/contact-check)
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · Phase 4 — email-only contact, already a user', () => {
  it('shows "Already on Liquid Clips" and no invite UI at all', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: true })));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'existing@example.com',
      displayName: 'Existing User',
    });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain('Already on Liquid Clips');
    expect(container.textContent).toContain('Existing User');
    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(queryButtonByText('Send via Messages')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/me/contact-check');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'existing@example.com' });
  });

  it('"Close" returns to the normal hook screen', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: true })));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'existing@example.com',
      displayName: 'Existing User',
    });
    mount();
    await clickNativePick();

    await act(async () => {
      findButtonByText('Close').click();
    });

    expect(container.textContent).not.toContain('Already on Liquid Clips');
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
  });
});

describe('SyncMailMoneyDrop · Phase 4 — email + phone contact, already a user', () => {
  it('shows "Already on Liquid Clips" instead of the channel choice, and never offers Messages', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: true })));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'existing@example.com',
      displayName: 'Existing User',
      phoneNumbers: [{ number: '+15551112222', label: 'mobile' }],
    });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain('Already on Liquid Clips');
    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(queryButtonByText('Send via Messages')).toBeNull();
  });
});

describe('SyncMailMoneyDrop · Phase 4 — lookup failure', () => {
  it('does not assume non-user: shows a retry state, not the invite UI', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network error')));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain("Couldn't check this contact");
    expect(queryButtonByText('Retry')).not.toBeNull();
    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    expect(container.textContent).not.toContain('Already on Liquid Clips');
  });

  it('treats a non-2xx response the same as a network error (not non-user)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({}, false)));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();

    expect(queryButtonByText('Retry')).not.toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('Retry re-runs the lookup and proceeds normally once it succeeds', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('network error')));
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: false })));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();
    expect(queryButtonByText('Retry')).not.toBeNull();

    await act(async () => {
      findButtonByText('Retry').click();
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
    });

    expect(queryButtonByText('Retry')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(1);
    expect(container.querySelector('.smmd-roster-name')?.textContent).toBe('Ada Lovelace');
  });

  it('Retry re-runs the lookup and shows "Already on Liquid Clips" once it succeeds with is_user: true', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('network error')));
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: true })));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'existing@example.com',
      displayName: 'Existing User',
    });
    mount();
    await clickNativePick();
    expect(queryButtonByText('Retry')).not.toBeNull();

    await act(async () => {
      findButtonByText('Retry').click();
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
    });

    expect(queryButtonByText('Retry')).toBeNull();
    expect(container.textContent).toContain('Already on Liquid Clips');
    expect(queryButtonByText('Send via Email')).toBeNull();
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
  });

  it('a malformed 200 response (missing/invalid is_user) is treated as a lookup failure, never as non-user', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({})));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();

    expect(container.textContent).toContain("Couldn't check this contact");
    expect(queryButtonByText('Retry')).not.toBeNull();
    // Must NOT have been silently treated as is_user: false.
    expect(container.querySelectorAll('.smmd-roster-row').length).toBe(0);
    expect(container.textContent).not.toContain('Already on Liquid Clips');
  });

  it('Cancel on the error state returns to the normal hook screen', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('network error')));
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
    });
    mount();
    await clickNativePick();
    expect(queryButtonByText('Retry')).not.toBeNull();

    await act(async () => {
      findButtonByText('Cancel').click();
    });

    expect(queryButtonByText('Retry')).toBeNull();
    expect(queryButtonByText('Link with contact directly')).not.toBeNull();
  });
});
