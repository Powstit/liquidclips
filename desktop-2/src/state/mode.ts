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
import { getCachedMeSnapshot } from "../design-os/state/useMe";

export type UserMode = "clipper" | "agency";

export const DEFAULT_MODE: UserMode = "clipper";

/* ─── V1-AGENCY-GATE (LOCKED 2026-07-20) · IG-CONTROL-TRUTH ────────────
 *
 * The regression this closes: `setMode("agency")` used to flip the UI
 * to Agency features unconditionally, so a Free / Clipper / Solo tier
 * user could self-elevate by clicking the GemPillToggle or ModeStrip.
 * That's a paid-feature bypass.
 *
 * Fix: `setMode` now consults the last-known `/me.effective_tier`
 * snapshot before flipping. Agency-family backend tiers (agency /
 * autopilot / agency_solo / agency_whitelabel) pass. Every other tier —
 * INCLUDING an unknown/unhydrated snapshot — is refused, emits a
 * warning toast + a stable diagnostic code, and leaves the store in
 * clipper mode.
 *
 * The gate MUST refuse on "unknown" — a fresh install with no /me yet
 * gives a hostile clicker no free ride. Legitimate agency users hit
 * this only during the ~500ms cold-start hydration window; the toast
 * says "still loading your account" and the pill flips on the next
 * click after hydration completes.
 *
 * Stable error code: LC-AGENCY-GATE-001.
 *
 * Exception: setting to "clipper" is ALWAYS allowed (downgrade / opt
 * out of Agency mode is legit for every tier). */

const AGENCY_ALLOWED_BACKEND_TIERS: ReadonlySet<string> = new Set([
  "agency",
  "autopilot",
  "agency_solo",
  "agency_whitelabel",
]);

/** Read the last-known /me snapshot's `effective_tier` and decide
 *  whether the user is permitted to enter Agency mode. Admin-override
 *  users (backend elevates them to `autopilot`) pass because their
 *  effective_tier reflects that. Unknown = refuse. */
export function canUseAgencyMode(): boolean {
  const snap = getCachedMeSnapshot();
  if (!snap) return false;
  const raw = (snap.effectiveTier ?? snap.rawTier ?? "").trim().toLowerCase();
  if (!raw) return false;
  return AGENCY_ALLOWED_BACKEND_TIERS.has(raw);
}

/** Diagnostic shape emitted on a refused elevation. */
export interface AgencyGateRefusalDetail {
  code: "LC-AGENCY-GATE-001";
  requested: UserMode;
  currentTier: string | null;
  reason: "no_snapshot" | "tier_not_agency";
}

function emitAgencyRefusal(reason: AgencyGateRefusalDetail["reason"]): void {
  const snap = getCachedMeSnapshot();
  const detail: AgencyGateRefusalDetail = {
    code: "LC-AGENCY-GATE-001",
    requested: "agency",
    currentTier: snap ? (snap.effectiveTier ?? snap.rawTier ?? null) : null,
    reason,
  };
  bus.emit("toast", {
    kind: "warning",
    title: reason === "no_snapshot"
      ? "Still loading your account"
      : "Agency mode is a paid feature",
    body: reason === "no_snapshot"
      ? "Give us a moment · try again in a second."
      : "Upgrade to unlock Agency mode.",
    ttl: 6000,
  });
  bus.emit("agency:gate-refused", detail);
}

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

/* ─── V1(b)-BOOT-RECONCILE (LOCKED 2026-07-20) ────────────────────────
 *
 * Defence-in-depth for the entitlement gate: even if a hostile actor
 * edits `localStorage.lc.mode = "agency"` between sessions (bypassing
 * the setMode guard entirely), a boot-time reconciliation forces the
 * store back to clipper as soon as /me hydrates and reports a
 * non-agency `effective_tier`.
 *
 * Return shape lets the boot caller emit its own diagnostic when a
 * downgrade actually happened (rare + auditable). Idempotent: no-op
 * when the stored mode already matches entitlement.
 *
 * Called AFTER /me hydrates (see App.tsx boot sequence) so
 * `getCachedMeSnapshot()` is populated. If snapshot is still null the
 * function returns { reconciled: false, reason: "no_snapshot" } and
 * leaves the store alone — the runtime gate at setMode still refuses
 * any FUTURE elevation attempt while the snapshot is unknown. */

export interface ReconcileResult {
  reconciled: boolean;
  previousMode: UserMode;
  newMode: UserMode;
  reason: "no_snapshot" | "already_clipper" | "tier_qualifies" | "downgraded";
  effectiveTier: string | null;
}

export function reconcilePersistedModeAgainstTier(): ReconcileResult {
  const currentMode = readPersistedMode();
  const snap = getCachedMeSnapshot();

  if (!snap) {
    return {
      reconciled: false,
      previousMode: currentMode,
      newMode: currentMode,
      reason: "no_snapshot",
      effectiveTier: null,
    };
  }

  const rawTier = (snap.effectiveTier ?? snap.rawTier ?? "").trim().toLowerCase();

  // Anything other than an agency-family tier + stored mode="agency"
  // means someone flipped mode without entitlement (or the tier
  // dropped). Force clipper.
  if (currentMode === "agency" && !canUseAgencyMode()) {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MODE_STORAGE_KEY, "clipper");
      }
    } catch { /* private-mode / quota — non-fatal */ }
    bus.emit("mode:change", { mode: "clipper" });
    bus.emit("agency:gate-refused", {
      code: "LC-AGENCY-GATE-001",
      requested: "agency",
      currentTier: snap.effectiveTier ?? snap.rawTier ?? null,
      reason: "tier_not_agency",
    });
    return {
      reconciled: true,
      previousMode: "agency",
      newMode: "clipper",
      reason: "downgraded",
      effectiveTier: rawTier || null,
    };
  }

  return {
    reconciled: false,
    previousMode: currentMode,
    newMode: currentMode,
    reason: currentMode === "clipper" ? "already_clipper" : "tier_qualifies",
    effectiveTier: rawTier || null,
  };
}

export const useModeStore = create<ModeState>()((set, get) => ({
  mode: readPersistedMode(),
  setMode: (mode) => {
    if (get().mode === mode) return;
    // V1-AGENCY-GATE · refuse elevation to agency when entitlement is
    // absent. Downgrade to clipper is always allowed.
    if (mode === "agency" && !canUseAgencyMode()) {
      const snap = getCachedMeSnapshot();
      emitAgencyRefusal(snap ? "tier_not_agency" : "no_snapshot");
      return;
    }
    set({ mode });
    persistAndBroadcast(mode);
  },
  toggleMode: () => {
    const next: UserMode = get().mode === "clipper" ? "agency" : "clipper";
    // V1-AGENCY-GATE · same refusal semantics as setMode.
    if (next === "agency" && !canUseAgencyMode()) {
      const snap = getCachedMeSnapshot();
      emitAgencyRefusal(snap ? "tier_not_agency" : "no_snapshot");
      return;
    }
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
