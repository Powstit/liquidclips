/**
 * nativeContactPicker · Phase 2 (macOS native Contacts) bridge coverage.
 *
 * First test file for this module. Covers the four
 * NativeContactPickerResult branches the Tauri command
 * (`pick_contact_macos`, src-tauri/src/contacts_picker.rs) can produce,
 * the RawContact normalization `rawContactFromNativePick` performs so
 * rosterBuilder.ts needs no changes for this source, and the minimal
 * `validateManualEmail` used by the no-email manual-entry fallback in
 * SyncMailMoneyDrop.tsx.
 *
 * Mocks `@tauri-apps/api/core` before import, matching the established
 * pattern in gmail/gmailComposeBridge.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeSpy = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeSpy(...args),
}));

import { pickContactNative, rawContactFromNativePick, validateManualEmail } from './nativeContactPicker';

function setTauriRuntime(on: boolean): void {
  if (on) {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
}

beforeEach(() => {
  invokeSpy.mockReset();
  setTauriRuntime(true);
});

afterEach(() => {
  setTauriRuntime(false);
});

describe('pickContactNative · TEST A — contact with email', () => {
  it('returns the selected status with the email and display name verbatim', async () => {
    invokeSpy.mockResolvedValue(
      JSON.stringify({ status: 'selected', email: 'ada@example.com', displayName: 'Ada Lovelace' }),
    );
    const result = await pickContactNative();
    expect(result).toEqual({ status: 'selected', email: 'ada@example.com', displayName: 'Ada Lovelace' });
    expect(invokeSpy).toHaveBeenCalledWith('pick_contact_macos');
  });

  it('rawContactFromNativePick normalizes a selected contact into the shared RawContact shape', () => {
    const contact = rawContactFromNativePick('Ada Lovelace', 'ada@example.com');
    expect(contact).toEqual({ email: 'ada@example.com', displayName: 'Ada Lovelace', sentCount: 0 });
  });

  it('rawContactFromNativePick maps an empty display name to null (not an empty string)', () => {
    const contact = rawContactFromNativePick('', 'ada@example.com');
    expect(contact.displayName).toBeNull();
  });
});

describe('pickContactNative · TEST B — contact without email', () => {
  it('returns the no_email status with the display name and no email field', async () => {
    invokeSpy.mockResolvedValue(JSON.stringify({ status: 'no_email', displayName: 'No Email Guy' }));
    const result = await pickContactNative();
    expect(result).toEqual({ status: 'no_email', displayName: 'No Email Guy' });
    expect((result as { email?: string }).email).toBeUndefined();
  });
});

describe('pickContactNative · TEST C — user cancellation', () => {
  it('returns cancelled with no fabricated contact fields', async () => {
    invokeSpy.mockResolvedValue(JSON.stringify({ status: 'cancelled' }));
    const result = await pickContactNative();
    expect(result).toEqual({ status: 'cancelled' });
  });
});

describe('pickContactNative · TEST D — native picker error', () => {
  it('surfaces a helper-reported error status verbatim', async () => {
    invokeSpy.mockResolvedValue(
      JSON.stringify({ status: 'error', message: 'contacts picker helper not bundled — run native-contacts/build.sh' }),
    );
    const result = await pickContactNative();
    expect(result).toEqual({
      status: 'error',
      message: 'contacts picker helper not bundled — run native-contacts/build.sh',
    });
  });

  it('catches a rejected invoke() (e.g. the Rust command itself failing) into an error result', async () => {
    invokeSpy.mockRejectedValue(new Error('failed to spawn contacts picker helper: ENOENT'));
    const result = await pickContactNative();
    expect(result.status).toBe('error');
    expect((result as { message: string }).message).toContain('failed to spawn contacts picker helper');
  });

  it('catches malformed (non-JSON) stdout into an error result instead of throwing', async () => {
    invokeSpy.mockResolvedValue('not json');
    const result = await pickContactNative();
    expect(result.status).toBe('error');
  });

  it('treats an unrecognized status value as an error rather than passing it through', async () => {
    invokeSpy.mockResolvedValue(JSON.stringify({ status: 'something_else' }));
    const result = await pickContactNative();
    expect(result).toEqual({ status: 'error', message: 'unrecognized response from contacts picker helper' });
  });

  it('short-circuits to an error without calling invoke at all outside the desktop runtime', async () => {
    setTauriRuntime(false);
    const result = await pickContactNative();
    expect(result).toEqual({ status: 'error', message: 'native contact picker requires the desktop app' });
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe('validateManualEmail', () => {
  it('rejects an empty string', () => {
    const r = validateManualEmail('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('Email address is required.');
  });

  it('rejects whitespace-only input', () => {
    const r = validateManualEmail('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('Email address is required.');
  });

  it('rejects clearly malformed input with no @', () => {
    const r = validateManualEmail('not-an-email');
    expect(r.ok).toBe(false);
  });

  it('rejects input with more than one @', () => {
    const r = validateManualEmail('a@b@c.com');
    expect(r.ok).toBe(false);
  });

  it('accepts a normal Gmail address', () => {
    const r = validateManualEmail('person@gmail.com');
    expect(r).toEqual({ ok: true, email: 'person@gmail.com' });
  });

  it('accepts a normal email address on a different domain', () => {
    const r = validateManualEmail('person@example.org');
    expect(r).toEqual({ ok: true, email: 'person@example.org' });
  });

  it('trims surrounding whitespace on an otherwise-valid address', () => {
    const r = validateManualEmail('  person@example.org  ');
    expect(r).toEqual({ ok: true, email: 'person@example.org' });
  });
});
