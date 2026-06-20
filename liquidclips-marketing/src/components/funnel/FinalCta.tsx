"use client";

import { HeroPaste } from "./HeroPaste";

/**
 * FinalCta · mirror of the hero pill at the bottom of the page.
 * Reuses the LOCKED <HeroPaste/> so input + button behaviour stays
 * 1:1 with the hero. No Kade tracking · just the hardware.
 */

export function FinalCta() {
  return (
    <section className="lc-final" aria-labelledby="lc-final-h">
      <div className="lc-final-room" aria-hidden="true">
        <div className="lc-final-bloom-fx" />
        <div className="lc-final-bloom-cy" />
        <div className="lc-final-scanlines" />
      </div>

      <span className="lc-final-tick lc-final-tick--tl" aria-hidden="true" />
      <span className="lc-final-tick lc-final-tick--tr" aria-hidden="true" />
      <span className="lc-final-tick lc-final-tick--bl" aria-hidden="true" />
      <span className="lc-final-tick lc-final-tick--br" aria-hidden="true" />

      <div className="lc-final-inner">
        <span className="lc-final-eb">
          <span className="lc-final-eb-dot" /> READY WHEN YOU ARE
        </span>
        <h2 id="lc-final-h" className="lc-final-h">
          Drop one tape. <em>Open your workbench.</em>
        </h2>
        <p className="lc-final-sub">
          Paste a long video. Kade scans it. Open Liquid Clips. The clips load
          themselves.
        </p>

        <HeroPaste ariaLabel="Long video URL · final CTA" />

        <div className="lc-final-status">
          <span>NO CREDITS</span>
          <span className="lc-final-status-sep" aria-hidden="true">·</span>
          <span>NO TIMELINE</span>
          <span className="lc-final-status-sep" aria-hidden="true">·</span>
          <span>NO GUESSING</span>
        </div>
      </div>
    </section>
  );
}
