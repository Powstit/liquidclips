/**
 * CommunityBanner · Phase 6L-C
 *
 * Consumes `useCommunity().communityTopBanners` (one or more banners
 * targeted at `placement="community_top"`). Reuses GlassCard chrome and
 * the existing `browse:open` bus event for the CTA.
 *
 * Renders nothing when the placement is empty — no fake content. Routes
 * the CTA URL through the same `browse:open` indirection the discussion
 * surfaces use so a future in-app browser overlay intercepts uniformly.
 */

import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { BannerItem } from "./types";
import "./CommunityBanner.css";

export interface CommunityBannerProps {
  items: ReadonlyArray<BannerItem>;
}

function isExternalUrl(url: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

export function CommunityBanner({ items }: CommunityBannerProps) {
  if (items.length === 0) return null;
  /* Top-priority banner first · sort already ran in the sidecar. */
  const banner = items[0];

  const handleCta = () => {
    if (!banner.ctaUrl) return;
    if (isExternalUrl(banner.ctaUrl)) {
      bus.emit("browse:open", {
        url: banner.ctaUrl,
        source: "community",
        mirror: "whop",
        title: banner.title,
      });
    } else {
      bus.emit("toast", {
        kind: "info",
        title: banner.title,
        body: banner.subtitle ?? "Action lands in a later phase.",
      });
    }
  };

  return (
    <GlassCard density="default" className="lc-cb" hoverLift>
      <div className="lc-cb-body">
        {banner.imageUrl && (
          <div className="lc-cb-art-wrap">
            <img src={banner.imageUrl} alt="" className="lc-cb-art" />
          </div>
        )}
        <div className="lc-cb-text">
          <span className="lc-cb-eb">From the team</span>
          <h3 className="lc-cb-title">{banner.title}</h3>
          {banner.subtitle && <p className="lc-cb-sub">{banner.subtitle}</p>}
        </div>
        {banner.ctaText && banner.ctaUrl && (
          <button type="button" className="lc-cb-cta" onClick={handleCta}>
            {banner.ctaText}
          </button>
        )}
      </div>
    </GlassCard>
  );
}
