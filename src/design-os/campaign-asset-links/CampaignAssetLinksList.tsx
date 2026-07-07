/**
 * CampaignAssetLinksList · Phase 6N-D v1 · read-only wrapper
 *
 * Reads brief links via `useCampaignAssetLinks(slug)` and renders them
 * as `<CampaignAssetLinkRow>`s. Safe loading/error/empty states.
 *
 * Used inside `<CampaignPageShell>` §6 "Asset sources" section. The
 * legacy `Campaign.assetSources[]` inline JSON was retired by the v1
 * pivot — this is the only consumer surface.
 */

import { useCampaignAssetLinks } from "../state/useCampaignAssetLinks";
import { CampaignAssetLinkRow } from "./CampaignAssetLinkRow";
import "./CampaignAssetLinksList.css";

export interface CampaignAssetLinksListProps {
  /** Campaign slug · null when no campaign loaded yet. */
  slug: string | null;
}

export function CampaignAssetLinksList({ slug }: CampaignAssetLinksListProps) {
  const { links, loading, error, source } = useCampaignAssetLinks(slug);

  if (loading) {
    return (
      <div className="lc-cal-list-safe">
        <span className="lc-cal-list-safe-eb">Loading brief links…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lc-cal-list-safe is-error">
        <span className="lc-cal-list-safe-eb">Couldn't load brief links</span>
        <p className="lc-cal-list-safe-body">{error}</p>
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="lc-cal-list-safe is-empty">
        <span className="lc-cal-list-safe-eb">No brief links yet</span>
        <p className="lc-cal-list-safe-body">
          The agency hasn't attached any source links yet · check back when the
          brief drops.
        </p>
      </div>
    );
  }

  return (
    <div className="lc-cal-list" data-source={source}>
      {links.map((link) => (
        <CampaignAssetLinkRow key={link.id} link={link} />
      ))}
    </div>
  );
}
