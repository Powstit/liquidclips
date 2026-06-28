/**
 * HomeBanner · cinematic strip above the 4-tile grid.
 *
 * 2026-06-24 · added on Daniel's request after wiring the in-app browser.
 * Surfaces the new browse-Whop affordance + the $50 sponsored reward
 * programme without burying it inside Find Rewards.
 *
 * Click → opens the in-app browser at Whop content rewards (same wire
 * the Find Rewards tile uses). Single CTA, no carousel, no rotation.
 */

import { motion as fm } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useBrowseOverlay, WHOP_REWARDS_URL } from "../../state/browseOverlay";
import { presets } from "../motion";

export function HomeBanner(): JSX.Element {
  const openBrowser = useBrowseOverlay((s) => s.openWith);
  const onClick = () => openBrowser(WHOP_REWARDS_URL, "browse-campaign");

  return (
    <fm.button
      type="button"
      className="lc-home-banner"
      onClick={onClick}
      variants={presets.staggerItem}
      whileHover={{ y: -2 }}
      whileTap={{ y: 0 }}
      aria-label="Open in-app browser to find paid Whop skills"
    >
      <div className="lc-home-banner-art" aria-hidden="true">
        <img
          src="/brand/kade/kade-celebration.webp"
          alt=""
          className="lc-home-banner-kade"
          loading="eager"
          decoding="async"
        />
        <div className="lc-home-banner-rim" />
      </div>
      <div className="lc-home-banner-copy">
        <span className="lc-home-banner-eb">Kade's reward scout · powered by Whop</span>
        <h3 className="lc-home-banner-h">
          Find paid clipping opportunities without leaving the app.
        </h3>
        <p className="lc-home-banner-sub">
          Browse rewards, inspect the brief, then send the source straight
          into Create Clips.
        </p>
      </div>
      <div className="lc-home-banner-cta">
        <span className="lc-home-banner-cta-label">Browse Whop</span>
        <ArrowUpRight size={16} />
      </div>
    </fm.button>
  );
}
