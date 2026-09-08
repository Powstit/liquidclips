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

import { SyncMailMoneyDrop } from './SyncMailMoneyDrop';
import type { OAuthDriver } from '../../lib/f5/googleOAuth';
import type { HttpFetch } from '../../lib/f5/contactScan';
import type { BatchLookup } from '../../lib/f5/youtubeCrossRef';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  pickContactNativeMock.mockReset();
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
    findButtonByText('Or choose one contact directly').click();
    await Promise.resolve();
    await Promise.resolve();
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
    // the connect button and native-pick entry point are both gone.
    expect(queryButtonByText('Link my email')).toBeNull();
    expect(queryButtonByText('Or choose one contact directly')).toBeNull();
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
    expect(queryButtonByText('Or choose one contact directly')).not.toBeNull();
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
    expect(queryButtonByText('Link my email')).not.toBeNull();
    expect(queryButtonByText('Or choose one contact directly')).not.toBeNull();
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
    // Not stuck: the connect button and native-pick entry are still
    // present and enabled, so the user can immediately retry.
    const nativePickBtn = queryButtonByText('Or choose one contact directly');
    expect(nativePickBtn).not.toBeNull();
    expect(nativePickBtn?.disabled).toBeFalsy();
    const connectBtn = queryButtonByText('Link my email');
    expect(connectBtn?.disabled).toBeFalsy();
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
// REGRESSION — Gmail "Link my email" path is unaffected
// ─────────────────────────────────────────────────────────────

describe('SyncMailMoneyDrop · regression — native Contacts addition is additive only', () => {
  it('the original Google OAuth/Gmail-scan path still reaches roster-populating on its own', async () => {
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

    await act(async () => {
      findButtonByText('Link my email').click();
      // Let the async onConnect() handler (OAuth → scanner.run()) settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 0 real contacts + 0 real matches → an honest empty roster state,
    // not a crash and not a fallback into the native-Contacts path.
    expect(container.textContent).toContain('No clippers in your inbox yet');
    expect(pickContactNativeMock).not.toHaveBeenCalled();
    expect(container.querySelector('.smmd-native-manual-email')).toBeNull();
  });
});
