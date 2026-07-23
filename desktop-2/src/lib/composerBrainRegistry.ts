/**
 * composerBrainRegistry · lets the app-wide useRemoteControl hook find
 * the current ComposerBrain regardless of which route it lives on.
 * ComposerRoute registers its brain on mount; the registry stays
 * populated while the composer is loaded. Commands that need brain
 * (composer.submit, composer.pickFile, composer.acceptSource) call
 * getBrain() and return an ok=false ack if it's null (user isn't on
 * the composer route right now).
 *
 * 2026-07-22 · Sprint remote-1a
 */

import { create } from "zustand";
import type { ComposerBrain } from "../design-os/routes/useComposerBrain";

interface BrainRegistry {
  brain: ComposerBrain | null;
  setBrain: (b: ComposerBrain | null) => void;
}

export const useBrainRegistry = create<BrainRegistry>((set) => ({
  brain: null,
  setBrain: (b) => set({ brain: b }),
}));

export function getBrain(): ComposerBrain | null {
  return useBrainRegistry.getState().brain;
}
