"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Persistent Download CTA floating in the bottom-right.
 * Hidden over the hero (no need — primary paste CTA is on screen)
 * and over the final CTA (mirrors the hero), so it never fights the
 * headline or the paste pill for space.
 */
export function DownloadFab() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.querySelector(".lc-w1");
    const final = document.querySelector(".lc-final");
    if (!hero || !final) return;

    let heroVisible = true;
    let finalVisible = false;

    const apply = () => setShown(!heroVisible && !finalVisible);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === hero) heroVisible = e.isIntersecting;
        if (e.target === final) finalVisible = e.isIntersecting;
      }
      apply();
    }, { threshold: [0, 0.25] });

    io.observe(hero);
    io.observe(final);
    return () => io.disconnect();
  }, []);

  return (
    <Link
      href="/download"
      className={`lc-fab${shown ? " is-shown" : ""}`}
      aria-label="Download Liquid Clips"
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
    >
      <span className="lc-fab-glyph" aria-hidden="true">▾</span>
      <span className="lc-fab-text">
        <span className="lc-fab-text-eb">DOWNLOAD</span>
        <span className="lc-fab-text-main">Open your clips</span>
      </span>
    </Link>
  );
}
