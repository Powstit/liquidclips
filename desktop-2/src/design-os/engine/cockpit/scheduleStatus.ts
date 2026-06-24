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
 * Today's truth: no scheduling backend in desktop-2's sidecar-stub. No
 * Ayrshare wrapper. No local queue. Return `available: false` with
 * honest copy. Future: replace this body with a real check against the
 * scheduler RPC's readiness.
 */
export function deriveSchedulePromise(): SchedulePromise {
  return {
    available: false,
    state: "coming-soon",
    copy: "Scheduling coming soon — connect a provider in Settings to enable.",
    badge: "Coming soon · not scheduled yet",
  };
}
