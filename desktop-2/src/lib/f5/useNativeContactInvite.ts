/**
 * useNativeContactInvite · shared native-macOS-Contacts referral journey.
 *
 * Extracted from `routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx`
 * (Phase 2–4) so the SAME contact-selection + K-factor logic backs both
 * the Outreach money-drop surface AND the post-verify Crew referral
 * onboarding. No behaviour change for the Outreach surface — this is the
 * same flow, hoisted into a reusable module.
 *
 * Journey it owns:
 *   pick one native contact (CNContactPicker via `pickContactNative`)
 *     → extract name / email / phone(s)
 *     → POST /me/contact-check   (existing-user K-factor gate)
 *         is_user  → dead-end sub-state (`existing-user`)
 *         non-user → hand a { displayName, email } to the consumer
 *     → no email     → manual-email fallback sub-state (`need-email`)
 *     → phone present + consumer opted into Messages → `channel-choice`
 *     → cancel / picker error → safe idle / inline error
 *
 * What it does NOT own (consumer-specific, by design):
 *   - what happens once an email contact is confirmed non-user
 *     (Outreach: mailto: draft batch · CrewOnboarding: server invite
 *     via /me/crew/match + /me/crew/invites/send)
 *   - the raw sms: Messages hand-off (Outreach only; opt in by passing
 *     `onMessagesChannelChosen`. CrewOnboarding deliberately omits it so
 *     onboarding always routes through the tracked server invite.)
 *
 * Never opens mailto:/sms: itself. Never sends anything. Never
 * enumerates the address book.
 */

import { useCallback, useState } from 'react';
import { getJwt } from '../authStorage';
import {
  pickContactNative,
  selectPreferredPhone,
  validateManualEmail,
  type NativeContactPhone,
} from './nativeContactPicker';

/** A confirmed, non-existing-user contact with a usable email address. */
export interface NativeInviteEmailContact {
  displayName: string;
  email: string;
}

/** A confirmed, non-existing-user contact the user chose to reach via
 *  Messages (only surfaced when the consumer supplies
 *  `onMessagesChannelChosen`). */
export interface NativeInvitePhoneContact {
  displayName: string;
  phones: NativeContactPhone[];
}

export type NativeInviteSubState =
  | { kind: 'idle' }
  /** /me/contact-check in flight. */
  | { kind: 'checking' }
  /** Contact is already a Liquid Clips user — dead end, no invite. */
  | { kind: 'existing-user'; displayName: string }
  /** /me/contact-check failed (network / 401 / 5xx / malformed). Never
   *  treated as "non-user" — offer Retry. */
  | { kind: 'lookup-error'; displayName: string; email: string; phones: NativeContactPhone[] }
  /** Picked contact has no saved email — inline manual-entry fallback. */
  | { kind: 'need-email'; displayName: string }
  /** Contact has phone number(s); the consumer opted into a Messages
   *  hand-off, so let the user pick the channel. `email` is null when the
   *  contact is phone-only. */
  | { kind: 'channel-choice'; displayName: string; email: string | null; phones: NativeContactPhone[] };

export interface UseNativeContactInviteOptions {
  /** Fires once we have a confirmed NON-user contact with a real email.
   *  The consumer drives the actual referral/invite from here. */
  onEmailContactReady: (contact: NativeInviteEmailContact) => void;
  /** Opt-in: when supplied, a contact with phone number(s) can be routed
   *  to a Messages hand-off instead of email. Omit it (CrewOnboarding)
   *  and phone-only contacts fall through to the manual-email fallback so
   *  the invite still goes through the tracked server flow. */
  onMessagesChannelChosen?: (contact: NativeInvitePhoneContact) => void;
  /** Optional analytics tap fired when `pick()` is invoked. */
  onPickClicked?: () => void;
  /** Optional: mirror the "couldn't open the picker" message into the
   *  consumer's own error surface (in addition to `pickerError`). */
  onPickerError?: (message: string) => void;
  /** Test seam — overrides VITE_BACKEND_URL for the /me/contact-check call. */
  backendBaseUrl?: string;
}

export interface UseNativeContactInviteApi {
  subState: NativeInviteSubState;
  /** Bound value for the manual-email fallback input. */
  manualEmail: string;
  /** Inline validation error for the manual-email input, or null. */
  manualEmailError: string | null;
  /** "couldn't open the picker" style error, or null. */
  pickerError: string | null;
  /** Opens the OS-native single-contact picker and walks the journey. */
  pick: () => Promise<void>;
  setManualEmail: (value: string) => void;
  submitManualEmail: () => void;
  cancelManualEmail: () => void;
  retryLookup: () => void;
  dismissLookupError: () => void;
  dismissExistingUser: () => void;
  chooseEmailChannel: () => void;
  chooseMessagesChannel: () => void;
  cancelChannelChoice: () => void;
  /** Hard reset back to idle (consumer calls this on "choose someone
   *  else" / when leaving the surface). */
  reset: () => void;
}

function resolveBackend(override?: string): string {
  if (override) return override.replace(/\/+$/, '');
  try {
    const env = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env ?? {};
    return (env.VITE_BACKEND_URL ?? 'https://api.liquidclips.app').replace(/\/+$/, '');
  } catch {
    return 'https://api.liquidclips.app';
  }
}

export function useNativeContactInvite(
  opts: UseNativeContactInviteOptions,
): UseNativeContactInviteApi {
  const { onEmailContactReady, onMessagesChannelChosen, onPickClicked, onPickerError, backendBaseUrl } = opts;

  const [subState, setSubState] = useState<NativeInviteSubState>({ kind: 'idle' });
  const [manualEmail, setManualEmailState] = useState('');
  const [manualEmailError, setManualEmailError] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [noEmailName, setNoEmailName] = useState('');

  const reset = useCallback(() => {
    setSubState({ kind: 'idle' });
    setManualEmailState('');
    setManualEmailError(null);
    setPickerError(null);
    setNoEmailName('');
  }, []);

  /** Emit a confirmed email contact to the consumer, then clear local
   *  sub-state so the picker returns to idle behind the consumer's own
   *  screen transition. */
  const emitEmailContact = useCallback(
    (contact: NativeInviteEmailContact) => {
      onEmailContactReady(contact);
      reset();
    },
    [onEmailContactReady, reset],
  );

  const runExistingUserCheck = useCallback(
    async (displayName: string, email: string, phones: NativeContactPhone[]) => {
      setSubState({ kind: 'checking' });
      try {
        const jwt = getJwt();
        const base = resolveBackend(backendBaseUrl);
        const res = await fetch(`${base}/me/contact-check`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error(`contact-check ${res.status}`);
        const data: unknown = await res.json();
        // A malformed/unexpected 200 body (missing or non-boolean
        // is_user) must NOT be silently trusted as "non-user" — treat it
        // exactly like a network failure so the acquisition gate holds.
        if (
          typeof data !== 'object' ||
          data === null ||
          typeof (data as { is_user?: unknown }).is_user !== 'boolean'
        ) {
          throw new Error('contact-check malformed response');
        }
        if ((data as { is_user: boolean }).is_user === true) {
          setSubState({ kind: 'existing-user', displayName });
          return;
        }
        // Confirmed non-user.
        if (selectPreferredPhone(phones) && onMessagesChannelChosen) {
          setSubState({ kind: 'channel-choice', displayName, email, phones });
        } else {
          emitEmailContact({ displayName, email });
        }
      } catch {
        setSubState({ kind: 'lookup-error', displayName, email, phones });
      }
    },
    [backendBaseUrl, onMessagesChannelChosen, emitEmailContact],
  );

  const pick = useCallback(async () => {
    onPickClicked?.();
    setPickerError(null);
    const result = await pickContactNative();
    if (result.status === 'selected') {
      await runExistingUserCheck(result.displayName, result.email, result.phoneNumbers ?? []);
    } else if (result.status === 'no_email') {
      const phones = result.phoneNumbers ?? [];
      if (selectPreferredPhone(phones) && onMessagesChannelChosen) {
        setSubState({ kind: 'channel-choice', displayName: result.displayName, email: null, phones });
      } else {
        setNoEmailName(result.displayName);
        setSubState({ kind: 'need-email', displayName: result.displayName });
      }
    } else if (result.status === 'cancelled') {
      // No crash, no fabricated contact — stay idle.
    } else {
      const msg = 'Couldn’t open the contacts picker — try again.';
      setPickerError(msg);
      onPickerError?.(msg);
    }
  }, [onPickClicked, onPickerError, onMessagesChannelChosen, runExistingUserCheck]);

  const setManualEmail = useCallback((value: string) => {
    setManualEmailState(value);
    setManualEmailError((prev) => (prev ? null : prev));
  }, []);

  const submitManualEmail = useCallback(() => {
    const validation = validateManualEmail(manualEmail);
    if (!validation.ok) {
      setManualEmailError(validation.message);
      return;
    }
    emitEmailContact({ displayName: noEmailName, email: validation.email });
  }, [manualEmail, noEmailName, emitEmailContact]);

  const cancelManualEmail = useCallback(() => reset(), [reset]);

  const retryLookup = useCallback(() => {
    if (subState.kind !== 'lookup-error') return;
    void runExistingUserCheck(subState.displayName, subState.email, subState.phones);
  }, [subState, runExistingUserCheck]);

  const dismissLookupError = useCallback(() => setSubState({ kind: 'idle' }), []);
  const dismissExistingUser = useCallback(() => setSubState({ kind: 'idle' }), []);

  const chooseEmailChannel = useCallback(() => {
    if (subState.kind !== 'channel-choice' || subState.email === null) return;
    emitEmailContact({ displayName: subState.displayName, email: subState.email });
  }, [subState, emitEmailContact]);

  const chooseMessagesChannel = useCallback(() => {
    if (subState.kind !== 'channel-choice') return;
    // Deliberately do NOT reset here — the consumer's hand-off can fail
    // (the OS refusing to open Messages), in which case the channel-choice
    // card must stay put so the user can retry. On success the consumer
    // moves its own screen state, which unmounts this card.
    onMessagesChannelChosen?.({ displayName: subState.displayName, phones: subState.phones });
  }, [subState, onMessagesChannelChosen]);

  const cancelChannelChoice = useCallback(() => setSubState({ kind: 'idle' }), []);

  return {
    subState,
    manualEmail,
    manualEmailError,
    pickerError,
    pick,
    setManualEmail,
    submitManualEmail,
    cancelManualEmail,
    retryLookup,
    dismissLookupError,
    dismissExistingUser,
    chooseEmailChannel,
    chooseMessagesChannel,
    cancelChannelChoice,
    reset,
  };
}
