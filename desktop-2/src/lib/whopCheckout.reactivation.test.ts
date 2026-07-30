/**
 * whopCheckout · openWhopReactivationCheckout · regression guard.
 * 2026-07-30.
 *
 * The cancellation-intercept modal's "Reactivate my $99.99/mo" button
 * (shown for lifecycleState === 'cancelled-past-cutoff') used to call
 * AccountSection's handleKeepSubscription, which is just
 * `setCancelOpen(false)` — a silent no-op. No Whop "resume membership"
 * endpoint exists on this account. Rather than build a new payment-link
 * API integration, this reopens the SAME hosted Whop checkout page every
 * new signup already goes through successfully — proven infrastructure,
 * not a new one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const openUrlMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
  openPath: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// bus.emit is called on the failure path only — stub so no real event
// bridge is required in this unit test.
vi.mock("../design-os/bridge", () => ({
  bus: { emit: vi.fn() },
}));

// beginActivation is imported by whopCheckout.ts for a different export
// (openSignInOrSignUpBridge) — stub so importing the module doesn't
// pull in unrelated activation machinery.
vi.mock("./activation", () => ({
  beginActivation: () => "test-challenge",
}));

describe("openWhopReactivationCheckout", () => {
  beforeEach(() => {
    openUrlMock.mockClear();
  });

  it("opens the real Whop checkout URL for the standard $99.99/mo plan via the native opener", async () => {
    const { openWhopReactivationCheckout, WHOP_STUDIO_PLAN_ID } = await import("./whopCheckout");
    await openWhopReactivationCheckout();
    expect(openUrlMock).toHaveBeenCalledTimes(1);
    expect(openUrlMock).toHaveBeenCalledWith(`https://whop.com/checkout/${WHOP_STUDIO_PLAN_ID}`);
  });

  it("falls back to a toast with the URL if the native opener call rejects (no silent dead button)", async () => {
    openUrlMock.mockRejectedValueOnce(new Error("plugin unavailable"));
    const { bus } = await import("../design-os/bridge");
    const { openWhopReactivationCheckout, WHOP_STUDIO_PLAN_ID } = await import("./whopCheckout");
    await openWhopReactivationCheckout();
    expect(bus.emit).toHaveBeenCalledWith(
      "toast",
      expect.objectContaining({
        kind: "warning",
        body: expect.stringContaining(`https://whop.com/checkout/${WHOP_STUDIO_PLAN_ID}`),
      }),
    );
  });
});
