/**
 * WalletActivityFeed · last-10 wallet events for the clipper.
 *
 * Chronological top→down. Each row colour-coded by event kind via the
 * data-kind attribute (CSS picks up the matching dot tint). Time stamps
 * recompute on a 60s tick so "12 min ago" stays accurate without manual
 * refresh.
 */

import { useEffect, useState } from "react";
import type { WalletActivityRow } from "../../lib/wallet";
import { fmtRelativeTime } from "../../lib/wallet";

export interface WalletActivityFeedProps {
  rows: WalletActivityRow[];
}

export function WalletActivityFeed({ rows }: WalletActivityFeedProps) {
  // Re-render every 60s so relative timestamps stay fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (rows.length === 0) return null;

  // tick is referenced solely to ensure re-render on the interval.
  void tick;

  return (
    <div className="lc-wallet-feed" data-testid="wallet-activity-feed">
      {rows.map((row, i) => (
        <div
          key={`${row.at}-${i}`}
          className="lc-wallet-feed-row"
          data-kind={row.kind}
          data-testid={`wallet-activity-row-${i}`}
        >
          <span className="lc-wallet-feed-dot" aria-hidden="true" />
          <span className="lc-wallet-feed-label" title={row.label}>{row.label}</span>
          <span className="lc-wallet-feed-time">{fmtRelativeTime(row.at)}</span>
        </div>
      ))}
    </div>
  );
}
