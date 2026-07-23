/**
 * remoteControlStatus · app-wide Zustand slot for the remote-control
 * banner + HUD pill. useRemoteControl (mounted in ComposerRoute) writes
 * to this so a persistent pill can render in AppShell TopHud — visible
 * on EVERY route, not just Composer.
 *
 * 2026-07-22 · Sprint remote-1a · fixes "banner only on composer"
 */

import { create } from "zustand";

export interface RemoteStatusState {
  active: boolean;
  hasConsent: boolean;
  isFounder: boolean;
  lastError: string | null;
  optIn: (() => void) | null;
  killSwitch: (() => void) | null;
  setStatus: (patch: Partial<RemoteStatusState>) => void;
}

export const useRemoteStatus = create<RemoteStatusState>((set) => ({
  active: false,
  hasConsent: false,
  isFounder: false,
  lastError: null,
  optIn: null,
  killSwitch: null,
  setStatus: (patch) => set(patch),
}));
