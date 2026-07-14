// Simulator-only mode state.
// No auth, no real tier check, no billing check.
// Default = "clipper".
//
// RC1 state-drift trifecta · P0-1 (2026-07-11)
// ============================================
// This file used to be a `zustand + persist` store keyed on
// `localStorage.lc:user-mode:v1`. That created a DUPLICATE persistence
// site alongside `localStorage.lc.mode` (canonical, written by TopHud
// and read by `design-os/bridge/useMode.ts`). Two persistences ⇒
// silent drift: hard-refresh preserved both keys explicitly, but any
// consumer that only touched one side (e.g. ExternalTest seeding
// `lc.mode` alone, or an old sign-out flow) left the other stale.
//
// The zustand store now acts as a thin bridge over the bus:
//   - reads canonical persistence from `localStorage.lc.mode`
//   - subscribes to `mode:change` on the shared bus so external
//     flips (TopHud pill, useMode hook) propagate to every zustand
//     subscriber (ModeStrip, GemPillToggle, EditorSection via
//     useUserMode, SubmitToWhopModal via useUserMode)
//   - emits `mode:change` on setMode so downstream React subscribers
//     see the flip on the same tick as canonical consumers
//
// `MODE_STORAGE_KEY` is retained as a name-only export for downstream
// code that referenced the constant but its VALUE now points at the
// canonical `lc.mode` key. The old `lc:user-mode:v1` key is not read
// or written by any code path. `hardRefresh` no longer preserves it.

import { create } from "zustand";
import { bus } from "../design-os/bridge/events";

export type UserMode = "clipper" | "agency";

export const DEFAULT_MODE: UserMode = "clipper";

// Canonical persistence key — was `lc:user-mode:v1`. Now points at the
// TopHud/useMode canonical key so external consumers that grep for a
// stable name (e.g. `MODE_STORAGE_KEY`) land on the ONE key that
// actually stores mode. The old zustand-specific key is intentionally
// unused and hard-refresh no longer preserves it.
export const MODE_STORAGE_KEY = "lc.mode";

export interface ModeState {
  mode: UserMode;
  setMode: (mode: UserMode) => void;
  toggleMode: () => void;
}

/** Read the canonical mode key from localStorage. Fail-safe → default. */
function readPersistedMode(): UserMode {
  try {
    if (typeof window === "undefined") return DEFAULT_MODE;
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return raw === "agency" ? "agency" : DEFAULT_MODE;
  } catch { return DEFAULT_MODE; }
}

/** Write the canonical key + emit on the shared bus. */
function persistAndBroadcast(mode: UserMode): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    }
  } catch { /* private-mode / quota — non-fatal */ }
  bus.emit("mode:change", { mode });
}

export const useModeStore = create<ModeState>()((set, get) => ({
  mode: readPersistedMode(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    set({ mode });
    persistAndBroadcast(mode);
  },
  toggleMode: () => {
    const next: UserMode = get().mode === "clipper" ? "agency" : "clipper";
    set({ mode: next });
    persistAndBroadcast(next);
  },
}));

// Bridge · listen for external flips (TopHud pill fires `mode:change`
// directly, useMode hook subscribers do too). When we hear a flip we
// didn't originate, mirror it into zustand so every downstream
// consumer (ModeStrip, GemPillToggle, EditorSection, SubmitToWhopModal)
// re-renders on the same tick. Guard against the persistAndBroadcast
// emit above by comparing state — no-op when already in sync.
if (typeof window !== "undefined") {
  bus.on("mode:change", (p) => {
    const state = useModeStore.getState();
    if (state.mode !== p.mode) {
      useModeStore.setState({ mode: p.mode });
    }
  });
  // Cross-tab safety net · storage event when another window mutates
  // the canonical key. Same as the bus mirror above.
  window.addEventListener("storage", (e) => {
    if (e.key !== MODE_STORAGE_KEY) return;
    const next = e.newValue === "agency" ? "agency" : DEFAULT_MODE;
    const state = useModeStore.getState();
    if (state.mode !== next) {
      useModeStore.setState({ mode: next });
    }
  });
}

export function isClipperMode(mode: UserMode): boolean {
  return mode === "clipper";
}

export function isAgencyMode(mode: UserMode): boolean {
  return mode === "agency";
}
