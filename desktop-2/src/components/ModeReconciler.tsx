/**
 * V1(b)-BOOT-RECONCILE · defence-in-depth for the entitlement gate.
 * LOCKED 2026-07-20.
 *
 * Runtime setMode() refuses agency without qualifying tier. This
 * component covers the OTHER attack: a stored `lc.mode="agency"` in
 * localStorage from a previous session (or hand-edited by a hostile
 * actor) survives cold boot with `readPersistedMode()` returning
 * "agency" BEFORE /me hydrates. The setMode gate can't help retro-
 * actively — the store is already primed to "agency" at construction.
 *
 * This component subscribes to `/me` via useMe(). When the snapshot
 * arrives (or updates) and `effective_tier` is not agency-family,
 * `reconcilePersistedModeAgainstTier()` forces the store back to
 * clipper and emits `agency:gate-refused` with the same stable code
 * `LC-AGENCY-GATE-001` that the runtime gate uses.
 *
 * Renders nothing. Idempotent — no-op when the stored mode already
 * matches entitlement (99.9% of boots).
 */

import { useEffect } from "react";
import { useMe } from "../design-os/state/useMe";
import { reconcilePersistedModeAgainstTier } from "../state/mode";
import { lcDiag } from "../lib/diagnosticLogger";

export function ModeReconciler() {
  const me = useMe();
  const source = me.source;
  const effectiveTier = me.snapshot?.effectiveTier ?? null;
  const rawTier = me.snapshot?.rawTier ?? null;

  useEffect(() => {
    if (source !== "real-http" && source !== "session-cache") return;
    const result = reconcilePersistedModeAgainstTier();
    if (result.reconciled) {
      try {
        lcDiag("agency_boot_reconciled", {
          code: "LC-AGENCY-GATE-001",
          reason: result.reason,
          previous_mode: result.previousMode,
          new_mode: result.newMode,
          effective_tier: result.effectiveTier,
        });
      } catch { /* diagnostic never blocks boot */ }
    }
  }, [source, effectiveTier, rawTier]);

  return null;
}
