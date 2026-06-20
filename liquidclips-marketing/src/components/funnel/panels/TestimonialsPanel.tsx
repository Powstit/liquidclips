"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { KadeHead } from "./KadeHead";

/**
 * Testimonials panel · proof + outcomes (NOT fake celebrity quotes).
 *
 * Above the fold ·
 *   3 outcome cards · creator + clipper + agency
 *
 * Below the fold · 3 proof cards (artifacts, not stories) ·
 *   Launch  · Product Hunt mark + reward copy
 *   Campaign · Whop campaign screenshot
 *   Metrics · 1.4M+ views big number tied to the source modal
 *
 * Hard rule from the brief: the proof does most of the talking. The
 * outcome quotes are short, the artifacts carry the trust.
 */

const OUTCOMES = [
  {
    role: "A CREATOR USED IT AND SAID",
    body: "Got 10 short clips from a 90-minute video before I even finished watching it.",
    foot: "@uncledaniel · clips his own podcasts",
  },
  {
    role: "A CLIPPER USED IT AND SAID",
    body: "Finally stopped guessing which moments were worth cutting.",
    foot: "@mr.podshorts · posts clips for money",
  },
  {
    role: "AN AGENCY USED IT AND SAID",
    body: "Turned one creator recording into a whole week's worth of posts.",
    foot: "studio-row labs · agency running creators",
  },
];

function ProductHuntMark() {
  // Minimal mono brand mark · orange #DA552F · "P" inside a rounded square.
  // Not the official asset · clearly labeled as a launch badge alongside.
  return (
    <span className="lc-ts-ph-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="36" height="36">
        <rect x="2" y="2" width="36" height="36" rx="11" fill="#DA552F" />
        <path
          d="M16 12h7.5a5.5 5.5 0 0 1 0 11H19v5h-3V12zm3 3v5h4.4a2.5 2.5 0 0 0 0-5H19z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

export function TestimonialsPanel() {
  const [mounted, setMounted] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lc-ts ${mounted ? "is-mounted" : ""}`}>
      <KadeHead
        src="/brand/kade/kade-reading-brief.webp"
        alt="Kade reading the proof"
      >
        <span className="lc-ts-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-ts-eb-dot" /> TESTIMONIALS · PROOF, NOT STORIES
        </span>
        <h2 className="lc-ts-h" style={{ animationDelay: "120ms" }}>
          See what other people have <em>already done</em> with Liquid Clips.
        </h2>
        <p className="lc-ts-sub" style={{ animationDelay: "240ms" }}>
          A real product launch. A real campaign paying clippers right now.
          Real money already paid. You can join the same campaign today.
        </p>
      </KadeHead>

      {/* outcomes row */}
      <ol className="lc-ts-outcomes" aria-label="Outcome quotes">
        {OUTCOMES.map((o, i) => (
          <li
            key={o.role}
            className="lc-ts-outcome"
            style={{ animationDelay: `${560 + i * 140}ms` }}
          >
            <span className="lc-ts-outcome-bracket lc-ts-outcome-bracket--tl" aria-hidden="true" />
            <span className="lc-ts-outcome-bracket lc-ts-outcome-bracket--tr" aria-hidden="true" />
            <span className="lc-ts-outcome-bracket lc-ts-outcome-bracket--bl" aria-hidden="true" />
            <span className="lc-ts-outcome-bracket lc-ts-outcome-bracket--br" aria-hidden="true" />
            <span className="lc-ts-outcome-role">{o.role}</span>
            <p className="lc-ts-outcome-body">“{o.body}”</p>
            <span className="lc-ts-outcome-foot">— {o.foot}</span>
          </li>
        ))}
      </ol>

      {/* proof artifacts row */}
      <section className="lc-ts-artifacts" aria-label="Real things you can check yourself">
        <span className="lc-ts-artifacts-eb">REAL THINGS YOU CAN CHECK YOURSELF</span>
        <div className="lc-ts-artifacts-grid">

          {/* LAUNCH · Product Hunt */}
          <article
            className="lc-ts-art lc-ts-art--launch"
            style={{ animationDelay: "1020ms" }}
          >
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tr" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--bl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--br" aria-hidden="true" />

            <header className="lc-ts-art-head">
              <ProductHuntMark />
              <div className="lc-ts-art-head-text">
                <span className="lc-ts-art-eb">LAUNCH HAPPENING NOW</span>
                <span className="lc-ts-art-title">We're live on Product Hunt today.</span>
              </div>
            </header>
            <p className="lc-ts-art-body">
              Drop a video. Get clips. Join the launch reward and start earning
              from day one.
            </p>
            <ul className="lc-ts-art-meta">
              <li><b>72H</b> launch window — go now</li>
              <li><b>Limited</b> reward spots</li>
            </ul>
            <Link href="#" className="lc-ts-art-cta lc-btn lc-btn--primary">
              <span>Upvote on Product Hunt</span>
              <span aria-hidden="true">→</span>
            </Link>
          </article>

          {/* CAMPAIGN · Whop */}
          <article
            className="lc-ts-art lc-ts-art--campaign"
            style={{ animationDelay: "1180ms" }}
          >
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tr" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--bl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--br" aria-hidden="true" />

            <header className="lc-ts-art-head">
              <div className="lc-ts-art-head-text">
                <span className="lc-ts-art-eb">A CAMPAIGN PAYING RIGHT NOW</span>
                <span className="lc-ts-art-title">Jae5 — paying clippers per view today.</span>
              </div>
            </header>
            <div className="lc-ts-art-shot">
              <Image
                src="/proof/whop-campaign-jae5.jpg"
                alt="A live creator campaign paying clippers — Jae5"
                width={1280}
                height={520}
                className="lc-ts-art-shot-img"
              />
            </div>
            <ul className="lc-ts-art-meta">
              <li><b>Free</b> to join</li>
              <li><b>Live</b> right now</li>
            </ul>
          </article>

          {/* METRICS · 1.4M+ views */}
          <article
            className="lc-ts-art lc-ts-art--metrics"
            style={{ animationDelay: "1340ms" }}
          >
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--tr" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--bl" aria-hidden="true" />
            <span className="lc-ts-art-bracket lc-ts-art-bracket--br" aria-hidden="true" />

            <span className="lc-ts-art-eb">REAL NUMBERS FROM THE CAMPAIGN</span>
            <span className="lc-ts-art-big">1.4M+</span>
            <span className="lc-ts-art-big-label">VIEWS COUNTED ACROSS TIKTOK, REELS, SHORTS, X, YOUTUBE</span>

            <ul className="lc-ts-art-strip">
              <li>
                <span className="lc-ts-art-strip-num">$1,808</span>
                <span className="lc-ts-art-strip-cap">paid to clippers so far</span>
              </li>
              <li>
                <span className="lc-ts-art-strip-num">42 / 71</span>
                <span className="lc-ts-art-strip-cap">clips got approved + paid</span>
              </li>
              <li>
                <span className="lc-ts-art-strip-num">59%</span>
                <span className="lc-ts-art-strip-cap">of submitted clips got paid</span>
              </li>
            </ul>

            <button
              type="button"
              className="lc-ts-art-source lc-btn lc-btn--secondary"
              onClick={() => setProofOpen(true)}
            >
              <span className="lc-ts-art-source-eb">▾ PROOF</span>
              <span>Show me the real dashboard</span>
            </button>
          </article>
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
            >
              ✕ close
            </button>
            <span className="lc-cr-proof-card-eb">RAW SOURCE</span>
            <h3 className="lc-cr-proof-card-h">The dashboard, unedited.</h3>
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
