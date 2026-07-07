// Liquid Clips 2.0 — user-mode simulator store (compatibility shim).
// Canonical store lives in src/state/mode.ts.
// Two personas: clipper (supply) and agency / campaign owner (demand).
// This is UI state only; no backend or entitlement logic here.

import { useEffect, useState } from "react";
import {
  useModeStore,
  type UserMode as CanonicalUserMode,
  DEFAULT_MODE,
} from "../state/mode";

// Public API preserves the legacy nullable + "campaign" alias for existing callers.
export type UserMode = CanonicalUserMode | "campaign" | null;

export interface ModeState {
  mode: UserMode;
  activeCampaignId: string | null;
}

let activeCampaignId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function normalizeMode(mode: UserMode): CanonicalUserMode {
  if (mode === "campaign") return "agency";
  if (mode === "clipper") return "clipper";
  return DEFAULT_MODE;
}

function denormalizeMode(mode: CanonicalUserMode): Exclude<UserMode, null> {
  return mode;
}

export function getModeState(): ModeState {
  const canonical = useModeStore.getState().mode;
  return { mode: denormalizeMode(canonical), activeCampaignId };
}

export function setUserMode(mode: UserMode): void {
  useModeStore.getState().setMode(normalizeMode(mode));
  emit();
}

export function setActiveCampaignId(id: string | null): void {
  activeCampaignId = id;
  emit();
}

export function subscribeMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Lightweight React hook for sections that need live mode state.
export function useUserMode(): ModeState {
  const canonicalMode = useModeStore((s) => s.mode);
  const [state, setState] = useState<ModeState>(() => getModeState());

  useEffect(() => {
    setState(getModeState());
  }, [canonicalMode]);

  useEffect(() => {
    const unsubMode = useModeStore.subscribe(() => emit());
    const handle = () => setState(getModeState());
    const unsubLocal = subscribeMode(handle);
    return () => {
      unsubMode();
      unsubLocal();
    };
  }, []);

  return state;
}
