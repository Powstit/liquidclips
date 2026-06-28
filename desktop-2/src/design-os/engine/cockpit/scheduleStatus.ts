/**
 * scheduleStatus · single source of truth for the scheduling promise.
 *
 * BUG-038 · neither ScheduleModule nor PublishModule had a real
 * scheduling backend (no queue, no provider, no Ayrshare wrapper in
 * desktop-2's sidecar-stub). Both surfaces had separate FAKE-toast paths
 * that lied to the customer in two divergent ways. This module replaces
 * both lies with one honest stub the entire cockpit reads from.
 *
 * When a real scheduling backend lands (Ayrshare wrapper in the stub,
 * or a custom queue), flip `available: true` AND add the wiring to
 * `enqueue(...)`. The COMING SOON copy + disabled controls + harness
 * assertions update from this one file.
 *
 * Mirrors the deriveWatermarkPromise pattern (BUG-036): one function,
 * read by every surface that displays the promise to the customer.
 */
export type ScheduleAvailability = "coming-soon" | "ready";

export interface SchedulePromise {
  /** Whether the scheduler is reachable RIGHT NOW. Drives every CTA's
   *  enabled state across the cockpit. */
  available: boolean;
  /** Machine-readable state — UI surfaces expose this as data-schedule-state. */
  state: ScheduleAvailability;
  /** Visible copy under the schedule CTAs so the customer is never lied to. */
  copy: string;
  /** Shorter inline copy for badges. */
  badge: string;
}

/**
 * Assisted scheduling is available without a publishing provider. Junior
 * stores the reminder locally, then prepares the browser/file/caption
 * handoff. Automatic posting remains a separate provider-owned feature.
 */
export function deriveSchedulePromise(): SchedulePromise {
  return {
    available: true,
    state: "ready",
    copy: "Assisted schedule: Junior reminds you and prepares the platform handoff. You press Post.",
    badge: "Assisted · ready",
  };
}
