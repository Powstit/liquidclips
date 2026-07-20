/**
 * Updater v2 · IG-BOOT-HEALTH-ACK · LOCKED 2026-07-20.
 *
 * Fires `runtime_ack_boot_healthy` after the customer-facing app tree
 * has successfully mounted. The Rust side records the ack timestamp +
 * resets its boot-attempts counter. If a promoted-then-broken bundle
 * ever reaches this point without acking (React tree throws before
 * this fires, native crash, etc), the NEXT boot's rollback trigger
 * observes boot_attempts > HEALTHY_BOOT_ATTEMPT_LIMIT and auto-rolls
 * back to the previous known-good version.
 *
 * The ack fires from a top-level useEffect wrapped in a 1.5s delay:
 *   - long enough that a boot which crashes early doesn't ack
 *   - short enough that a healthy boot always acks well before a user
 *     could trigger a second launch
 *
 * Idempotent · repeat calls just refresh the ack timestamp.
 *
 * Browser (no Tauri) is a no-op so vite-dev keeps working.
 */

import { useEffect } from "react";

const HEALTHY_BOOT_ACK_DELAY_MS = 1500;

export function useRuntimeBootHealthyAck(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const timer = window.setTimeout(async () => {
      try {
        const mod = await import("@tauri-apps/api/core");
        await mod.invoke("runtime_ack_boot_healthy");
      } catch {
        // Non-fatal · the rollback trigger will simply not-fire this
        // boot, so a temporary IPC glitch doesn't cause a false
        // rollback either. Silent by design.
      }
    }, HEALTHY_BOOT_ACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
}
