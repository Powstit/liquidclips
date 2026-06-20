"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { KadeHead } from "./KadeHead";

/**
 * Agencies panel · same cinematic proof-stage rules as Clipping Rewards.
 *
 * Above the fold ·
 *   left  · eyebrow → headline → sub → 3 hero metrics extracted from the
 *           Spotify dashboard → CTA
 *   right · the iPhone Spotify dashboard, framed in dark glass with a
 *           cyan reticle, "ATTENTION SOURCE · NOT ENDORSED" badge,
 *           breathing pink rim · click to enlarge
 *
 * Below the fold ·
 *   OLD WAY vs NEW WAY comparison diagram
 *   6 benefit cards
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
  { eb: "TOTAL PLAYS",  to: 707_105, caption: "for one of our example artists this month" },
  { eb: "MONTHLY FANS", to: 376_629, caption: "people who listen every month" },
  { eb: "PLAYS PER FAN", to: 1.7,    decimals: 1, caption: "they come back more than once" },
];

const OLD_WAY = [
  { t: "Films",        l: "Creator records a 2-hour podcast or stream" },
  { t: "Watches",      l: "Editor scrubs through the whole thing" },
  { t: "Guesses",      l: "Editor picks moments by gut feel" },
  { t: "Edits",        l: "Cuts 4 clips, adds captions by hand" },
  { t: "Posts late",   l: "Clips go out after the moment has passed" },
];

const NEW_WAY = [
  { t: "Films",          l: "Creator records a 2-hour podcast or stream" },
  { t: "App scans",      l: "The best 100 moments surface in 60 seconds" },
  { t: "Best ones top",  l: "Each clip already has a title and a score" },
  { t: "Editors finish", l: "They polish the winners — they don't pick them" },
  { t: "Posts same day", l: "Clips go out while people are still talking about it" },
];

const BENEFITS = [
  { glyph: "01", title: "100 clips ready in minutes", body: "One creator's back catalogue becomes a pile of short clips your team can post the same day." },
  { glyph: "02", title: "Best clips show up first", body: "Every clip has a score. Your editors work on the winners and skip the duds." },
  { glyph: "03", title: "Stop watching, start posting", body: "No more 2-hour scrub sessions. The app reads the video, your team posts the result." },
  { glyph: "04", title: "Clips arrive with titles + captions", body: "Editors finish, they don't write from scratch. Less work, more clips shipped." },
  { glyph: "05", title: "Pay clippers to do the posting", body: "Run a campaign and let clippers post your creators' clips. You pay per view that lands." },
  { glyph: "06", title: "See what's working, all in one place", body: "Every view, every payout, every clip tracked — across every creator on your roster." },
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
    <li className={`lc-ag-metric ${big ? "lc-ag-metric--big" : ""}`} data-started={started}>
      <span className="lc-ag-metric-bracket lc-ag-metric-bracket--tl" aria-hidden="true" />
      <span className="lc-ag-metric-bracket lc-ag-metric-bracket--tr" aria-hidden="true" />
      <span className="lc-ag-metric-bracket lc-ag-metric-bracket--bl" aria-hidden="true" />
      <span className="lc-ag-metric-bracket lc-ag-metric-bracket--br" aria-hidden="true" />
      <span className="lc-ag-metric-eb">{m.eb}</span>
      <span className="lc-ag-metric-value">
        {m.prefix ?? ""}
        {format(m, n)}
        {m.suffix ?? ""}
      </span>
      <span className="lc-ag-metric-cap">{m.caption}</span>
    </li>
  );
}

export function AgenciesPanel() {
  const [proofOpen, setProofOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lc-ag ${mounted ? "is-mounted" : ""}`}>
      <KadeHead
        src="/brand/kade/kade-campaign-mode.webp"
        alt="Kade running a creator campaign"
      >
        <span className="lc-ag-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-ag-eb-dot" /> AGENCIES · ATTENTION TO DISTRIBUTION
        </span>
        <h2 className="lc-ag-h" style={{ animationDelay: "120ms" }}>
          Run clipping campaigns for creators. Invite clippers, generate
          content, manage campaigns and grow <em>multiple creator accounts</em>
          from one dashboard.
        </h2>
        <p className="lc-ag-sub" style={{ animationDelay: "240ms" }}>
          One creator's long video turns into 100+ short clips ready to post.
          Pay clippers to post them. Track every view, every payout, every
          creator — in one place.
        </p>
      </KadeHead>

      {/* ── ABOVE THE FOLD ── */}
      <section className="lc-ag-hero">
        <div className="lc-ag-copy">
          <ol className="lc-ag-hero-metrics" aria-label="Example creator attention numbers">
            <HeroMetric m={HERO_METRICS[0]} delay={900} big />
            <HeroMetric m={HERO_METRICS[1]} delay={1180} />
            <HeroMetric m={HERO_METRICS[2]} delay={1460} />
          </ol>

          <div className="lc-ag-cta-row" style={{ animationDelay: "1820ms" }}>
            <Link href="#" className="lc-ag-cta lc-btn lc-btn--primary">
              <span>Book a walkthrough</span>
              <span aria-hidden="true">→</span>
            </Link>
            <button
              type="button"
              className="lc-ag-source lc-btn lc-btn--secondary"
              onClick={() => setProofOpen(true)}
            >
              <span className="lc-ag-source-eb">▾ SOURCE</span>
              <span>Open the raw dashboard</span>
            </button>
          </div>
        </div>

        {/* iPhone proof rig · Spotify */}
        <button
          type="button"
          className="lc-ag-rig"
          onClick={() => setProofOpen(true)}
          aria-label="Open the source dashboard"
          style={{ animationDelay: "560ms" }}
        >
          <span className="lc-ag-rig-rim" aria-hidden="true" />
          <span className="lc-ag-rig-bracket lc-ag-rig-bracket--tl" aria-hidden="true" />
          <span className="lc-ag-rig-bracket lc-ag-rig-bracket--tr" aria-hidden="true" />
          <span className="lc-ag-rig-bracket lc-ag-rig-bracket--bl" aria-hidden="true" />
          <span className="lc-ag-rig-bracket lc-ag-rig-bracket--br" aria-hidden="true" />

          <span className="lc-ag-rig-badge" aria-hidden="true">
            <span className="lc-ag-rig-badge-dot" /> ATTENTION SOURCE
          </span>

          <span className="lc-ag-rig-phone">
            <span className="lc-ag-rig-notch" aria-hidden="true" />
            <Image
              src="/proof/spotify-jae5-minksb.jpg"
              alt="Streaming dashboard · JAE5 · MINK SB"
              width={920}
              height={1980}
              className="lc-ag-rig-img"
            />
            <span className="lc-ag-rig-scan" aria-hidden="true" />
          </span>

          <span className="lc-ag-rig-caption">
            <span>EXAMPLE CREATOR · NOT ENDORSED</span>
            <span>SOURCE: STREAMING DASHBOARD · LIVE</span>
          </span>
        </button>
      </section>

      {/* ── BELOW THE FOLD ── */}
      <section className="lc-ag-detail">
        <header className="lc-ag-vs-head">
          <span className="lc-ag-vs-eb">HOW IT USED TO WORK · HOW IT WORKS NOW</span>
          <h3 className="lc-ag-vs-h">
            Same creator. Same recording. <em>Way more clips out the door.</em>
          </h3>
        </header>

        <div className="lc-ag-vs">
          <ol className="lc-ag-vs-col lc-ag-vs-col--old" aria-label="Old way">
            <li className="lc-ag-vs-label">
              <span>OLD WAY</span>
              <span className="lc-ag-vs-tag lc-ag-vs-tag--old">5 DAYS · 4 CLIPS</span>
            </li>
            {OLD_WAY.map((s, i) => (
              <li key={`old-${i}`} className="lc-ag-vs-step">
                <span className="lc-ag-vs-num">0{i + 1}</span>
                <span className="lc-ag-vs-name">{s.t}</span>
                <span className="lc-ag-vs-line">{s.l}</span>
              </li>
            ))}
          </ol>
          <ol className="lc-ag-vs-col lc-ag-vs-col--new" aria-label="New way">
            <li className="lc-ag-vs-label">
              <span>NEW WAY</span>
              <span className="lc-ag-vs-tag lc-ag-vs-tag--new">SAME DAY · 100 CLIPS</span>
            </li>
            {NEW_WAY.map((s, i) => (
              <li key={`new-${i}`} className="lc-ag-vs-step">
                <span className="lc-ag-vs-num">0{i + 1}</span>
                <span className="lc-ag-vs-name">{s.t}</span>
                <span className="lc-ag-vs-line">{s.l}</span>
              </li>
            ))}
          </ol>
        </div>

        <section className="lc-ag-benefits" aria-label="What you get">
          <span className="lc-ag-benefits-eb">WHAT YOU GET</span>
          <ol className="lc-ag-benefits-grid">
            {BENEFITS.map((b) => (
              <li key={b.glyph} className="lc-ag-benefit">
                <span className="lc-ag-benefit-bracket lc-ag-benefit-bracket--tl" aria-hidden="true" />
                <span className="lc-ag-benefit-bracket lc-ag-benefit-bracket--tr" aria-hidden="true" />
                <span className="lc-ag-benefit-bracket lc-ag-benefit-bracket--bl" aria-hidden="true" />
                <span className="lc-ag-benefit-bracket lc-ag-benefit-bracket--br" aria-hidden="true" />
                <span className="lc-ag-benefit-num">{b.glyph}</span>
                <h4 className="lc-ag-benefit-title">{b.title}</h4>
                <p className="lc-ag-benefit-body">{b.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="lc-ag-foot-cta">
          <div>
            <span className="lc-ag-foot-eb">READY?</span>
            <span className="lc-ag-foot-line">
              Tell us about your creators. We'll show you the app live.
            </span>
          </div>
          <Link href="#" className="lc-ag-cta lc-btn lc-btn--primary">
            <span>Book a walkthrough</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

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
            <span className="lc-cr-proof-card-eb">RAW SOURCE · EXAMPLE</span>
            <h3 className="lc-cr-proof-card-h">Streaming dashboard, raw.</h3>
            <p className="lc-cr-proof-card-sub">
              Example creator attention source. Not affiliated with or endorsed
              by Spotify · used to illustrate the kind of long-form attention
              an agency can convert into clipped distribution.
            </p>
            <div className="lc-cr-proof-card-shot">
              <Image
                src="/proof/spotify-jae5-minksb.jpg"
                alt="Streaming dashboard · raw screenshot"
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
