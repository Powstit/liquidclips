/**
 * ThumbnailQuotaBadge · v2.2.17
 *
 * Small "X batches left this month" pill for ThumbnailBatchControls.
 * Renders only for metered tiers (Pro/Agency) · BYO-key tiers (Solo)
 * see no widget since they have no server cap. Click opens the boost
 * pack in an external browser (Whop checkout) OR emits a bus event
 * the shell can catch.
 */
import { useEffect, useState } from "react";
import { openSmart } from "../../lib/openSmart";
import { fetchThumbnailQuota, type ThumbnailQuota } from "../../lib/thumbnailQuota";
import "./ThumbnailQuotaBadge.css";

export function ThumbnailQuotaBadge(): JSX.Element | null {
  const [quota, setQuota] = useState<ThumbnailQuota | null>(null);

  useEffect(() => {
    void (async () => setQuota(await fetchThumbnailQuota()))();
  }, []);

  if (!quota) return null;
  if (quota.monthly_included === null) return null; // BYO key · no cap to show

  const remaining = quota.remaining_total ?? 0;
  const urgency =
    remaining <= 0 ? "critical" : remaining <= 10 ? "warning" : "info";

  const openBoost = () => {
    void openSmart(quota.boost_pack_url);
  };

  return (
    <button
      type="button"
      className="lc-thumb-quota-badge"
      data-testid="lc-thumb-quota-badge"
      data-urgency={urgency}
      onClick={openBoost}
      title={
        remaining > 0
          ? `${remaining} batch${remaining === 1 ? "" : "es"} left this month · click for $9 boost pack (+${quota.boost_pack_batches})`
          : `Monthly cap reached · click for $9 boost pack (+${quota.boost_pack_batches})`
      }
    >
      <span className="lc-thumb-quota-badge-eb">QUOTA</span>
      <span className="lc-thumb-quota-badge-metric">
        {remaining} left
      </span>
      {quota.boost_credit > 0 ? (
        <span className="lc-thumb-quota-badge-boost">+{quota.boost_credit} boost</span>
      ) : null}
      <span className="lc-thumb-quota-badge-cta">
        {remaining <= 0 ? "Buy 25 for $9" : "Top up"}
      </span>
    </button>
  );
}
