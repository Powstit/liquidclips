/**
 * useNativeContactInvite · behavioural coverage for the shared native
 * macOS Contacts referral journey (pick → /me/contact-check →
 * existing-user / email / phone / no-email). Both SyncMailMoneyDrop and
 * CrewOnboarding drive their referral flows through this hook, so these
 * tests pin the reusable core once.
 *
 * `pickContactNative` and global `fetch` are mocked — no OS picker, no
 * network. `renderHook` from a tiny local harness keeps this dependency-
 * free (the repo has no @testing-library/react-hooks).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const pickContactNativeMock = vi.fn();
vi.mock('./nativeContactPicker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nativeContactPicker')>();
  return { ...actual, pickContactNative: (...a: unknown[]) => pickContactNativeMock(...a) };
});

import { useNativeContactInvite, type UseNativeContactInviteOptions, type UseNativeContactInviteApi } from './useNativeContactInvite';

// ── minimal renderHook ──────────────────────────────────────────────
let container: HTMLDivElement;
let root: Root;
function renderHook(opts: UseNativeContactInviteOptions): { current: UseNativeContactInviteApi } {
  const ref: { current: UseNativeContactInviteApi } = { current: null as unknown as UseNativeContactInviteApi };
  function Harness(): null {
    ref.current = useNativeContactInvite(opts);
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(<Harness />);
  });
  return ref;
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}
const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ is_user: false })));

async function flush(times = 6): Promise<void> {
  await act(async () => {
    for (let i = 0; i < times; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  pickContactNativeMock.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: false })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useNativeContactInvite', () => {
  it('non-user contact with an email → onEmailContactReady, no channel choice', async () => {
    const onEmailContactReady = vi.fn();
    pickContactNativeMock.mockResolvedValue({ status: 'selected', email: 'ada@x.com', displayName: 'Ada' });
    const hook = renderHook({ onEmailContactReady, backendBaseUrl: 'https://api.test' });

    await act(async () => { await hook.current.pick(); });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/me/contact-check',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(onEmailContactReady).toHaveBeenCalledWith({ displayName: 'Ada', email: 'ada@x.com' });
    expect(hook.current.subState.kind).toBe('idle');
  });

  it('existing Liquid Clips user → dead-end sub-state, invite is NOT emitted', async () => {
    const onEmailContactReady = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: true })));
    pickContactNativeMock.mockResolvedValue({ status: 'selected', email: 'member@x.com', displayName: 'Grace' });
    const hook = renderHook({ onEmailContactReady });

    await act(async () => { await hook.current.pick(); });
    await flush();

    expect(onEmailContactReady).not.toHaveBeenCalled();
    expect(hook.current.subState).toEqual({ kind: 'existing-user', displayName: 'Grace' });
    act(() => hook.current.dismissExistingUser());
    expect(hook.current.subState.kind).toBe('idle');
  });

  it('contact-check failure → lookup-error with Retry, never treated as non-user', async () => {
    const onEmailContactReady = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({}, false)));
    pickContactNativeMock.mockResolvedValue({ status: 'selected', email: 'x@x.com', displayName: 'X' });
    const hook = renderHook({ onEmailContactReady });

    await act(async () => { await hook.current.pick(); });
    await flush();

    expect(onEmailContactReady).not.toHaveBeenCalled();
    expect(hook.current.subState.kind).toBe('lookup-error');

    // Retry succeeds this time.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ is_user: false })));
    await act(async () => { hook.current.retryLookup(); });
    await flush();
    expect(onEmailContactReady).toHaveBeenCalledWith({ displayName: 'X', email: 'x@x.com' });
  });

  it('malformed 200 body is a failure, not a silent "non-user"', async () => {
    const onEmailContactReady = vi.fn();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ nope: 1 })));
    pickContactNativeMock.mockResolvedValue({ status: 'selected', email: 'x@x.com', displayName: 'X' });
    const hook = renderHook({ onEmailContactReady });

    await act(async () => { await hook.current.pick(); });
    await flush();

    expect(onEmailContactReady).not.toHaveBeenCalled();
    expect(hook.current.subState.kind).toBe('lookup-error');
  });

  it('no-email contact + no Messages handler → manual-email fallback → onEmailContactReady', async () => {
    const onEmailContactReady = vi.fn();
    pickContactNativeMock.mockResolvedValue({ status: 'no_email', displayName: 'No Email Guy' });
    const hook = renderHook({ onEmailContactReady });

    await act(async () => { await hook.current.pick(); });
    await flush();
    expect(hook.current.subState).toEqual({ kind: 'need-email', displayName: 'No Email Guy' });

    act(() => hook.current.setManualEmail('bad'));
    act(() => hook.current.submitManualEmail());
    expect(hook.current.manualEmailError).toBeTruthy();
    expect(onEmailContactReady).not.toHaveBeenCalled();

    act(() => hook.current.setManualEmail('good@x.com'));
    expect(hook.current.manualEmailError).toBeNull();
    act(() => hook.current.submitManualEmail());
    expect(onEmailContactReady).toHaveBeenCalledWith({ displayName: 'No Email Guy', email: 'good@x.com' });
  });

  it('phone-only contact WITHOUT a Messages handler → manual-email fallback (no sms hand-off)', async () => {
    const onEmailContactReady = vi.fn();
    pickContactNativeMock.mockResolvedValue({
      status: 'no_email',
      displayName: 'Phone Only',
      phoneNumbers: [{ number: '+15551234567', label: 'mobile' }],
    });
    const hook = renderHook({ onEmailContactReady }); // NB: no onMessagesChannelChosen

    await act(async () => { await hook.current.pick(); });
    await flush();
    expect(hook.current.subState.kind).toBe('need-email');
  });

  it('phone-bearing contact WITH a Messages handler → channel-choice; choosing Messages calls the handler', async () => {
    const onEmailContactReady = vi.fn();
    const onMessagesChannelChosen = vi.fn();
    pickContactNativeMock.mockResolvedValue({
      status: 'selected',
      email: 'both@x.com',
      displayName: 'Both',
      phoneNumbers: [{ number: '+15550000000', label: 'mobile' }],
    });
    const hook = renderHook({ onEmailContactReady, onMessagesChannelChosen });

    await act(async () => { await hook.current.pick(); });
    await flush();
    expect(hook.current.subState.kind).toBe('channel-choice');

    act(() => hook.current.chooseMessagesChannel());
    expect(onMessagesChannelChosen).toHaveBeenCalledWith({
      displayName: 'Both',
      phones: [{ number: '+15550000000', label: 'mobile' }],
    });
    // Deliberately NOT reset — a failed hand-off must be able to retry.
    expect(hook.current.subState.kind).toBe('channel-choice');

    act(() => hook.current.chooseEmailChannel());
    expect(onEmailContactReady).toHaveBeenCalledWith({ displayName: 'Both', email: 'both@x.com' });
  });

  it('cancelled picker → stays idle, nothing emitted', async () => {
    const onEmailContactReady = vi.fn();
    pickContactNativeMock.mockResolvedValue({ status: 'cancelled' });
    const hook = renderHook({ onEmailContactReady });

    await act(async () => { await hook.current.pick(); });
    await flush();
    expect(hook.current.subState.kind).toBe('idle');
    expect(onEmailContactReady).not.toHaveBeenCalled();
    expect(hook.current.pickerError).toBeNull();
  });

  it('picker error → pickerError set + onPickerError mirror, hook not stuck', async () => {
    const onEmailContactReady = vi.fn();
    const onPickerError = vi.fn();
    pickContactNativeMock.mockResolvedValue({ status: 'error', message: 'boom' });
    const hook = renderHook({ onEmailContactReady, onPickerError });

    await act(async () => { await hook.current.pick(); });
    await flush();
    expect(hook.current.subState.kind).toBe('idle');
    expect(hook.current.pickerError).toContain('try again');
    expect(onPickerError).toHaveBeenCalled();
  });
});
