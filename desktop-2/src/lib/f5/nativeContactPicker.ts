/**
 * F5 · Layer 2 · native macOS Contacts picker bridge (Phase 2).
 *
 * Alternative contact source alongside the existing Google OAuth/
 * Gmail-metadata pipeline (googleOAuth.ts, contactScan.ts, scanner.ts —
 * all unchanged by this file). Calls the Tauri command
 * `pick_contact_macos` (src-tauri/src/contacts_picker.rs), which spawns
 * a small native Swift helper that shows exactly one CNContactPicker
 * popover and returns the user's explicit single selection.
 *
 * No bulk address-book scan, no auto-selection, no network request —
 * the helper only ever returns what the user explicitly picked (or
 * "no_email" / "cancelled").
 */

import type { RawContact } from './contactScan';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type NativeContactPickerResult =
  | { status: 'selected'; email: string; displayName: string }
  | { status: 'no_email'; displayName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/**
 * Opens the native macOS Contacts picker and resolves with the user's
 * explicit selection. Never resolves with more than one contact.
 */
export async function pickContactNative(): Promise<NativeContactPickerResult> {
  if (!isTauriRuntime()) {
    return { status: 'error', message: 'native contact picker requires the desktop app' };
  }
  try {
    const mod = await import('@tauri-apps/api/core');
    const raw = await mod.invoke<string>('pick_contact_macos');
    const parsed = JSON.parse(raw) as NativeContactPickerResult;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'status' in parsed &&
      ['selected', 'no_email', 'cancelled', 'error'].includes((parsed as { status: string }).status)
    ) {
      return parsed;
    }
    return { status: 'error', message: 'unrecognized response from contacts picker helper' };
  } catch (e) {
    return { status: 'error', message: String(e).slice(0, 300) };
  }
}

/**
 * Converts a resolved native-picker selection (or a manually-entered
 * fallback email, when the picked contact had none) into the same
 * RawContact shape f5/contactScan.ts produces from the Google flow —
 * so rosterBuilder.ts and everything downstream needs no changes.
 */
export function rawContactFromNativePick(
  displayName: string,
  email: string,
): RawContact {
  return {
    email,
    displayName: displayName.trim().length > 0 ? displayName : null,
    sentCount: 0,
  };
}

const EMAIL_LOCAL_DOMAIN_PATTERN = /^[^\s@]+@[^\s@]+$/;

/**
 * Minimal, deterministic manual-email validation for the no-email
 * fallback UI. Not an RFC 5322 parser on purpose.
 */
export function validateManualEmail(raw: string): { ok: true; email: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Email address is required.' };
  }
  if ((trimmed.match(/@/g) ?? []).length !== 1) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  if (!EMAIL_LOCAL_DOMAIN_PATTERN.test(trimmed)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }
  return { ok: true, email: trimmed };
}
