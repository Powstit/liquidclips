"use client";

/**
 * LaunchRewardBanner · Phase 5 update.
 *
 * Banner click now opens the ProductHuntCaptureModal FIRST instead of
 * sending the visitor straight to Product Hunt. The modal captures
 * email + optional PH handle, then the visitor opens PH from inside the
 * success state. Traffic we paid to attract is now traffic we own.
 */
import { useState } from "react";
import { PRODUCT_HUNT_URL } from "@/lib/env";
import { ProductHuntCaptureModal } from "./ProductHuntCaptureModal";

export function LaunchRewardBanner() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <section className="lc-launch" aria-label="Product Hunt launch reward">
        <span className="lc-launch-bracket lc-launch-bracket--tl" aria-hidden="true" />
        <span className="lc-launch-bracket lc-launch-bracket--tr" aria-hidden="true" />
        <span className="lc-launch-bracket lc-launch-bracket--bl" aria-hidden="true" />
        <span className="lc-launch-bracket lc-launch-bracket--br" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="lc-launch-asset"
          aria-label="Save your spot before opening Liquid Clips on Product Hunt"
        >
          {/* plain <img> so the SVG keeps its embedded <image href> refs ·
              next/image optimizer was stripping the Kade png inside. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/launch/ph-campaign-banner.svg"
            alt="Product Hunt launch · Give Kade your upvote"
            width={1920}
            height={1080}
            className="lc-launch-asset-img"
          />
        </button>

        <div className="lc-launch-spark" aria-hidden="true" />
      </section>

      <ProductHuntCaptureModal
        open={modalOpen}
        productHuntUrl={PRODUCT_HUNT_URL}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
