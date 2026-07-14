/**
 * fmtRelativeTime · future-timestamp regression.
 *
 * Found via a live interactive debug pass: the Wallet's "Next payout"
 * stat (a future `next_payout_at` timestamp) always rendered "just now"
 * regardless of whether the payout was in 10 minutes or 10 days,
 * because `Math.max(0, nowMs - then)` clamped every negative (future)
 * delta to 0. Locks in the "in N…" phrasing for future timestamps
 * alongside the existing "N… ago" phrasing for past ones
 * (`row.created_at` in the transaction ledger).
 */

import { describe, it, expect } from "vitest";
import { fmtRelativeTime } from "./wallet";

describe("wallet.ts · fmtRelativeTime", () => {
  const now = Date.parse("2026-07-14T12:00:00Z");

  it("formats past timestamps with 'ago' phrasing", () => {
    expect(fmtRelativeTime("2026-07-14T11:59:30Z", now)).toBe("just now");
    expect(fmtRelativeTime("2026-07-14T11:30:00Z", now)).toBe("30 min ago");
    expect(fmtRelativeTime("2026-07-14T09:00:00Z", now)).toBe("3 hr ago");
    expect(fmtRelativeTime("2026-07-12T12:00:00Z", now)).toBe("2 d ago");
  });

  it("formats future timestamps with 'in N…' phrasing instead of clamping to 'just now'", () => {
    expect(fmtRelativeTime("2026-07-14T12:00:20Z", now)).toBe("just now");
    expect(fmtRelativeTime("2026-07-14T12:30:00Z", now)).toBe("in 30 min");
    expect(fmtRelativeTime("2026-07-14T22:00:00Z", now)).toBe("in 10 hr");
    expect(fmtRelativeTime("2026-07-15T00:00:00Z", now)).toBe("in 12 hr");
    expect(fmtRelativeTime("2026-07-17T12:00:00Z", now)).toBe("in 3 d");
  });
});
