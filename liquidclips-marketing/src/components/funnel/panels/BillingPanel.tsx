"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KadeHead } from "./KadeHead";

/**
 * Billing panel · clean 3-tier ladder.
 *
 * Above the fold ·
 *   eyebrow + headline + sub
 *   3 dark-glass tier cards · Free → Pro (featured) → Agency
 *   each card · name · price (DSEG7) · 4-6 feature lines · CTA
 *
 * Below the fold ·
 *   `Pro pays for itself` math strip
 *   educator: 1 viral clip × 100k views × $1.50 RPM = $150 = 5 months of Pro
 *
 * Sequenced reveal · eyebrow → h2 → sub → cards stagger L→R → math strip
 */

type Tier = {
  key: string;
  name: string;
  price: string;
  unit?: string;
  featured?: boolean;
  blurb: string;
  features: string[];
  cta: string;
  ctaSub: string;
};

const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    blurb: "Try it out. See if you like it.",
    features: [
      "Generate 10 clips to test",
      "Clips export with a small watermark",
      "Join basic paid campaigns",
      "Get titles, scores and hooks for free",
    ],
    cta: "Start free",
    ctaSub: "no card needed",
  },
  {
    key: "pro",
    name: "Pro",
    price: "$29.99",
    unit: "/ mo",
    featured: true,
    blurb: "For people who clip every day and want to get paid.",
    features: [
      "Make as many clips as you want",
      "No watermark — your clips look clean",
      "Access the highest-paying campaigns",
      "Earn more per view on premium drops",
      "Faster clips — your stuff jumps the queue",
      "Refer a friend and earn 50% every month they stay",
    ],
    cta: "Go Pro",
    ctaSub: "cancel any time",
  },
  {
    key: "agency",
    name: "Agency",
    price: "from $500",
    unit: "/ mo",
    blurb: "For teams managing creators or running clip campaigns.",
    features: [
      "Make 100+ clips per creator you manage",
      "Workspace per creator so nothing mixes",
      "We help you set up your first campaign",
      "Add your team with roles and permissions",
      "Priority onboarding from a real human",
      "We help you decide what to pay clippers",
    ],
    cta: "Book a walkthrough",
    ctaSub: "30 minutes, live, with you",
  },
];

export function BillingPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lc-bl ${mounted ? "is-mounted" : ""}`}>
      <KadeHead
        src="/brand/kade/kade-idle.webp"
        alt="Kade introducing the tier ladder"
      >
        <span className="lc-bl-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-bl-eb-dot" /> BILLING · TIER LADDER
        </span>
        <h2 className="lc-bl-h" style={{ animationDelay: "120ms" }}>
          Start free. <em>Upgrade</em> when you need more clips, more exports
          and more campaigns.
        </h2>
        <p className="lc-bl-sub" style={{ animationDelay: "240ms" }}>
          Every plan picks the same best moments. Paid plans drop the
          watermark, let you generate unlimited clips, and open the biggest
          paying campaigns.
        </p>
      </KadeHead>

      <ol className="lc-bl-grid" aria-label="Tier ladder">
        {TIERS.map((t, i) => (
          <li
            key={t.key}
            className={`lc-bl-tier ${t.featured ? "is-featured" : ""}`}
            style={{ animationDelay: `${560 + i * 160}ms` }}
          >
            {t.featured && (
              <span className="lc-bl-tier-flag" aria-label="Recommended">
                <span className="lc-bl-tier-flag-dot" /> RECOMMENDED
              </span>
            )}

            <span className="lc-bl-tier-bracket lc-bl-tier-bracket--tl" aria-hidden="true" />
            <span className="lc-bl-tier-bracket lc-bl-tier-bracket--tr" aria-hidden="true" />
            <span className="lc-bl-tier-bracket lc-bl-tier-bracket--bl" aria-hidden="true" />
            <span className="lc-bl-tier-bracket lc-bl-tier-bracket--br" aria-hidden="true" />

            <header className="lc-bl-tier-head">
              <span className="lc-bl-tier-name">{t.name}</span>
              <div className="lc-bl-tier-price-row">
                <span className="lc-bl-tier-price">{t.price}</span>
                {t.unit && <span className="lc-bl-tier-unit">{t.unit}</span>}
              </div>
              <span className="lc-bl-tier-blurb">{t.blurb}</span>
            </header>

            <ul className="lc-bl-tier-list">
              {t.features.map((f) => (
                <li key={f}>
                  <span className="lc-bl-tier-tick" aria-hidden="true">▸</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <div className="lc-bl-tier-foot">
              <Link
                href="#"
                className={`lc-bl-tier-cta lc-btn ${
                  t.featured ? "is-primary lc-btn--primary" : "lc-btn--tertiary"
                }`}
              >
                <span>{t.cta}</span>
                <span aria-hidden="true">→</span>
              </Link>
              <span className="lc-bl-tier-cta-sub">{t.ctaSub}</span>
            </div>
          </li>
        ))}
      </ol>

      {/* ── BELOW THE FOLD ── */}
      <section
        className="lc-bl-math"
        style={{ animationDelay: "1100ms" }}
        aria-label="How Pro pays for itself"
      >
        <span className="lc-bl-math-eb">HOW PRO PAYS FOR ITSELF</span>
        <h3 className="lc-bl-math-h">
          One clip that <em>goes viral</em> covers months of Pro.
        </h3>
        <ol className="lc-bl-math-row">
          <li>
            <span className="lc-bl-math-num">1</span>
            <span className="lc-bl-math-label">VIRAL CLIP</span>
            <span className="lc-bl-math-line">10 minutes in the app</span>
          </li>
          <li className="lc-bl-math-op" aria-hidden="true">×</li>
          <li>
            <span className="lc-bl-math-num">100k</span>
            <span className="lc-bl-math-label">VIEWS</span>
            <span className="lc-bl-math-line">on your post</span>
          </li>
          <li className="lc-bl-math-op" aria-hidden="true">×</li>
          <li>
            <span className="lc-bl-math-num">$1.50</span>
            <span className="lc-bl-math-label">PAID PER 1,000 VIEWS</span>
            <span className="lc-bl-math-line">paid by the creator's campaign</span>
          </li>
          <li className="lc-bl-math-op" aria-hidden="true">=</li>
          <li className="lc-bl-math-result">
            <span className="lc-bl-math-num lc-bl-math-num--big">$150</span>
            <span className="lc-bl-math-label">IN YOUR POCKET</span>
            <span className="lc-bl-math-line">≈ 5 months of Pro covered</span>
          </li>
        </ol>
        <p className="lc-bl-math-foot">
          One good clip pays for 5 months of Pro. The next one is pure profit.
        </p>
      </section>
    </div>
  );
}
