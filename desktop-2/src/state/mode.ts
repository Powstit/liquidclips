// Simulator-only mode state.
// No auth, no real tier check, no billing check.
// Default = "clipper". Optional localStorage persistence key = "lc:user-mode:v1".

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserMode = "clipper" | "agency";

export const DEFAULT_MODE: UserMode = "clipper";

export const MODE_STORAGE_KEY = "lc:user-mode:v1";

export interface ModeState {
  mode: UserMode;
  setMode: (mode: UserMode) => void;
  toggleMode: () => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set, get) => ({
      mode: DEFAULT_MODE,
      setMode: (mode) => set({ mode }),
      toggleMode: () => {
        const next = get().mode === "clipper" ? "agency" : "clipper";
        set({ mode: next });
      },
    }),
    {
      name: MODE_STORAGE_KEY,
    },
  ),
);

export function isClipperMode(mode: UserMode): boolean {
  return mode === "clipper";
}

export function isAgencyMode(mode: UserMode): boolean {
  return mode === "agency";
}
