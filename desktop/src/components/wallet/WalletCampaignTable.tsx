/**
 * WalletCampaignTable · per-campaign drill-in rows.
 *
 * One row per sponsored campaign the clipper has submitted to. Read-only
 * for v1 — clicking is a no-op today (drill-in modal deferred to v2 per
 * the scope doc · table itself is required so the clipper sees which
 * campaign their money is queued behind).
 *
 * Status pill colour-codes pick up brand tokens:
 *   live / funded            → green-ish
 *   partially_funded         → amber
 *   coming_soon              → cyan-decoration
 *   closed                   → soft red
 *   unknown / fallback       → quiet neutral
 */

import type { WalletCampaignRow } from "../../lib/wallet";
import { fmtUsdCents, fmtViews } from "../../lib/wallet";

export interface WalletCampaignTableProps {
  rows: WalletCampaignRow[];
  /** Optional click handler · noop today · reserved for v2 drill-in modal. */
  onRowClick?: (row: WalletCampaignRow) => void;
}

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  funded: "Funded",
  partially_funded: "Partially funded",
  coming_soon: "Coming soon",
  closed: "Closed",
  unknown: "—",
};

export function WalletCampaignTable({ rows, onRowClick }: WalletCampaignTableProps) {
  if (rows.length === 0) return null;

  return (
    <div className="lc-wallet-table" data-testid="wallet-campaign-table">
      <div className="lc-wallet-table-head" role="row">
        <span>Campaign</span>
        <span className="is-right">Views</span>
        <span className="is-right">Subs</span>
        <span className="is-right">Approved</span>
        <span className="is-right">Earned</span>
        <span className="is-right">Status</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.slug}
          className="lc-wallet-row"
          role="row"
          data-testid={`wallet-campaign-row-${row.slug}`}
          data-status={row.status}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          style={onRowClick ? { cursor: "pointer" } : undefined}
        >
          <div className="lc-wallet-row-c">
            <div
              className="lc-wallet-row-thumb"
              style={row.banner_url ? { backgroundImage: `url("${row.banner_url}")` } : undefined}
              aria-hidden="true"
            />
            <div className="lc-wallet-row-c-l">
              <span className="lc-wallet-row-c-title">{row.title}</span>
              {row.brand && <span className="lc-wallet-row-c-brand">{row.brand}</span>}
            </div>
          </div>
          <span className="lc-wallet-row-n">{fmtViews(row.views)}</span>
          <span className="lc-wallet-row-n">{row.submissions}</span>
          <span className="lc-wallet-row-n">{row.approved}</span>
          <span className="lc-wallet-row-n is-earned">{fmtUsdCents(row.earned_usd_cents)}</span>
          <span className="lc-wallet-row-status" data-status={row.status}>
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </div>
      ))}
    </div>
  );
}
