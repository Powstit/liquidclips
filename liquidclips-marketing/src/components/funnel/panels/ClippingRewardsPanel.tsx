"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { KadeHead } from "./KadeHead";

/**
 * Clipping Rewards panel · cinematic proof stage.
 *
 * Above the fold ·
 *   left  · eyebrow → headline → 3 hero metrics extract one-by-one (DSEG7
 *           count-up) → CTA
 *   right · the iPhone running Whop's content-rewards dashboard, framed
 *           in dark glass with cyan reticle, cyan PROOF·LIVE badge,
 *           breathing pink rim. Click to enlarge (proof modal).
 *
 * Below the fold ·
 *   flow educator + RPM educator + Whop campaign card
 *
 * Sequenced reveal · the visitor reads the story `we pulled these
 * numbers from this real dashboard` — not `here is a wall of cards`.
 */

type Metric = {
  eb: string;
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  caption: string;
};

const HERO_METRICS: Metric[] = [
  { eb: "VIEWS COUNTED", to: 1_458_005, caption: "across TikTok, Reels, Shorts, X, YouTube" },
  { eb: "MONEY PAID OUT", to: 1_808.30, prefix: "$", decimals: 2, caption: "real money sent to clippers so far" },
  { eb: "CLIPS APPROVED", to: 59,        suffix: "%", caption: "42 of 71 clips submitted got paid" },
];

const SECONDARY_METRICS: Metric[] = [
  { eb: "CLIPS SENT IN", to: 71, caption: "by clippers in this campaign" },
  { eb: "CLIPS PAID",    to: 42, caption: "approved and paid out" },
  { eb: "AVG PAY PER 1,000 VIEWS", to: 1.24, prefix: "$", decimals: 2, caption: "after the campaign ran" },
];

const FLOW = [
  { t: "Creator",  l: "drops a long video" },
  { t: "Liquid Clips", l: "picks the best moments" },
  { t: "You",      l: "post the clips to TikTok, Reels, Shorts" },
  { t: "Views",    l: "count automatically" },
  { t: "You earn", l: "money based on views" },
];

const RPM = [
  { views: 1_000,     usd: 1.50 },
  { views: 100_000,   usd: 150 },
  { views: 1_000_000, usd: 1_500 },
];

function useCountUp(target: number, start: boolean, durationMs = 1100): number {
  const [n, setN] = useState(0);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (!start) return;
    let raf = 0;
    function tick(now: number) {
      if (ref.current === null) ref.current = now;
      const t = Math.min(1, (now - ref.current) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, start]);
  return n;
}

function format(m: Metric, n: number): string {
  if (m.decimals != null) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: m.decimals,
      maximumFractionDigits: m.decimals,
    });
  }
  return Math.round(n).toLocaleString();
}

function HeroMetric({ m, delay, big = false }: { m: Metric; delay: number; big?: boolean }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setStarted(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  const n = useCountUp(m.to, started);
  return (
    <li className={`lc-cr2-metric ${big ? "lc-cr2-metric--big" : ""}`} data-started={started}>
      <span className="lc-cr2-metric-bracket lc-cr2-metric-bracket--tl" aria-hidden="true" />
      <span className="lc-cr2-metric-bracket lc-cr2-metric-bracket--tr" aria-hidden="true" />
      <span className="lc-cr2-metric-bracket lc-cr2-metric-bracket--bl" aria-hidden="true" />
      <span className="lc-cr2-metric-bracket lc-cr2-metric-bracket--br" aria-hidden="true" />
      <span className="lc-cr2-metric-eb">{m.eb}</span>
      <span className="lc-cr2-metric-value">
        {m.prefix ?? ""}
        {format(m, n)}
        {m.suffix ?? ""}
      </span>
      <span className="lc-cr2-metric-cap">{m.caption}</span>
    </li>
  );
}

export function ClippingRewardsPanel() {
  const [proofOpen, setProofOpen] = useState(false);

  // mount-staggered reveals
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lc-cr2 ${mounted ? "is-mounted" : ""}`}>
      <KadeHead
        src="/brand/kade/kade-success.webp"
        alt="Kade celebrating a payout"
      >
        <span className="lc-cr2-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-cr2-eb-dot" /> CLIPPING REWARDS · LIVE PROOF
        </span>
        <h2 className="lc-cr2-h" style={{ animationDelay: "120ms" }}>
          Get paid for posting clips. Join creator campaigns, post videos on
          TikTok, Reels or Shorts, and <em>earn money</em> when your clips
          get views.
        </h2>
        <p className="lc-cr2-sub" style={{ animationDelay: "240ms" }}>
          Real numbers from a real campaign running right now. Every view you
          get is tracked. Every view pays.
        </p>
      </KadeHead>

      {/* ── ABOVE THE FOLD ── */}
      <section className="lc-cr2-hero">
        <div className="lc-cr2-copy">
          <ol className="lc-cr2-hero-metrics" aria-label="Headline campaign metrics">
            <HeroMetric m={HERO_METRICS[0]} delay={900} big />
            <HeroMetric m={HERO_METRICS[1]} delay={1180} />
            <HeroMetric m={HERO_METRICS[2]} delay={1460} />
          </ol>

          <div className="lc-cr2-cta-row" style={{ animationDelay: "1820ms" }}>
            <Link href="#" className="lc-cr2-cta lc-btn lc-btn--primary">
              <span>Start earning today</span>
              <span aria-hidden="true">→</span>
            </Link>
            <button
              type="button"
              className="lc-cr2-source lc-btn lc-btn--secondary"
              onClick={() => setProofOpen(true)}
            >
              <span className="lc-cr2-source-eb">▾ SOURCE</span>
              <span>Open the raw dashboard</span>
            </button>
          </div>
        </div>

        {/* iPhone-style proof rig */}
        <button
          type="button"
          className="lc-cr2-rig"
          onClick={() => setProofOpen(true)}
          aria-label="Open the source dashboard"
          style={{ animationDelay: "560ms" }}
        >
          <span className="lc-cr2-rig-rim" aria-hidden="true" />
          <span className="lc-cr2-rig-bracket lc-cr2-rig-bracket--tl" aria-hidden="true" />
          <span className="lc-cr2-rig-bracket lc-cr2-rig-bracket--tr" aria-hidden="true" />
          <span className="lc-cr2-rig-bracket lc-cr2-rig-bracket--bl" aria-hidden="true" />
          <span className="lc-cr2-rig-bracket lc-cr2-rig-bracket--br" aria-hidden="true" />

          <span className="lc-cr2-rig-badge" aria-hidden="true">
            <span className="lc-cr2-rig-badge-dot" /> PROOF · LIVE
          </span>

          <span className="lc-cr2-rig-phone">
            <span className="lc-cr2-rig-notch" aria-hidden="true" />
            <Image
              src="/proof/rewards-analytics.png"
              alt="Whop content rewards dashboard · Jae5 clipper campaign"
              width={920}
              height={1980}
              className="lc-cr2-rig-img"
            />
            <span className="lc-cr2-rig-scan" aria-hidden="true" />
          </span>

          <span className="lc-cr2-rig-caption">
            <span>JAE5 · CLIP CAMPAIGN</span>
            <span>APR 10 – JUN 20 · 5 PLATFORMS</span>
          </span>
        </button>
      </section>

      {/* ── BELOW THE FOLD ── */}
      <section className="lc-cr2-detail">
        <ol className="lc-cr2-detail-metrics" aria-label="Detail metrics">
          <HeroMetric m={SECONDARY_METRICS[0]} delay={1700} />
          <HeroMetric m={SECONDARY_METRICS[1]} delay={1820} />
          <HeroMetric m={SECONDARY_METRICS[2]} delay={1940} />
        </ol>

        <section className="lc-cr2-flow" aria-label="How you get paid">
          <span className="lc-cr2-flow-eb">HOW YOU GET PAID</span>
          <ol className="lc-cr2-flow-row">
            {FLOW.map((f, i) => (
              <li key={f.t} className="lc-cr2-flow-step">
                <span className="lc-cr2-flow-num">0{i + 1}</span>
                <span className="lc-cr2-flow-name">{f.t}</span>
                <span className="lc-cr2-flow-line">{f.l}</span>
                {i < FLOW.length - 1 && (
                  <span className="lc-cr2-flow-arrow" aria-hidden="true">→</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className="lc-cr2-pair">
          <section className="lc-cr2-rpm">
            <span className="lc-cr2-rpm-eb">WHAT YOU EARN</span>
            <h3 className="lc-cr2-rpm-h">
              At <em>$1.50</em> per 1,000 views, here's what you make.
            </h3>
            <ul className="lc-cr2-rpm-table">
              {RPM.map((r) => (
                <li key={r.views}>
                  <span className="lc-cr2-rpm-views">
                    {r.views.toLocaleString()}
                    <span className="lc-cr2-rpm-unit"> views</span>
                  </span>
                  <span className="lc-cr2-rpm-eq">=</span>
                  <span className="lc-cr2-rpm-pay">${r.usd.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="lc-cr2-rpm-foot">
              Some creators pay more than this. Big launches can hit $5 per
              1,000 views and up.
            </p>
          </section>

          <section className="lc-cr2-camp">
            <span className="lc-cr2-camp-eb">A CAMPAIGN YOU CAN JOIN TODAY</span>
            <h3 className="lc-cr2-camp-h">Jae5 · paying clippers right now</h3>
            <div className="lc-cr2-camp-shot">
              <Image
                src="/proof/whop-campaign-jae5.jpg"
                alt="A creator campaign paying clippers — Jae5"
                width={1280}
                height={520}
                className="lc-cr2-camp-img"
              />
              <span className="lc-cr2-camp-bracket lc-cr2-camp-bracket--tl" aria-hidden="true" />
              <span className="lc-cr2-camp-bracket lc-cr2-camp-bracket--tr" aria-hidden="true" />
              <span className="lc-cr2-camp-bracket lc-cr2-camp-bracket--bl" aria-hidden="true" />
              <span className="lc-cr2-camp-bracket lc-cr2-camp-bracket--br" aria-hidden="true" />
            </div>
            <p className="lc-cr2-camp-cap">
              Creators put up the prize pool. You clip their videos and post
              them. Views = money in your pocket.
            </p>
          </section>
        </div>
      </section>

      {/* proof modal · raw screenshot */}
      {proofOpen && (
        <div className="lc-cr-proof-modal" role="dialog" aria-label="Source proof">
          <button
            type="button"
            className="lc-cr-proof-scrim"
            onClick={() => setProofOpen(false)}
            aria-label="Close"
          />
          <div className="lc-cr-proof-card">
            <button
              type="button"
              className="lc-cr-proof-close"
              onClick={() => setProofOpen(false)}
              aria-label="Close"
            >
              ✕ close
            </button>
            <span className="lc-cr-proof-card-eb">RAW SOURCE</span>
            <h3 className="lc-cr-proof-card-h">The exact dashboard.</h3>
            <p className="lc-cr-proof-card-sub">
              Live Whop content-rewards screen for the Jae5 clipper campaign,
              window Apr 10 → Jun 20.
            </p>
            <div className="lc-cr-proof-card-shot">
              <Image
                src="/proof/rewards-analytics.png"
                alt="Whop content rewards analytics · raw"
                width={920}
                height={1980}
                className="lc-cr-proof-card-img"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
