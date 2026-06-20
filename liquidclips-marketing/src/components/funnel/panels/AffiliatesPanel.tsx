"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KadeHead } from "./KadeHead";

/**
 * Affiliates panel · 50% MRR offer + earnings ladder + referral journey.
 *
 * Above the fold ·
 *   eyebrow + headline + sub
 *   3 hero metrics · 50% MRR · $14.99/mo per ref · 30-day cookie
 *   CTA
 *
 * Below the fold ·
 *   earnings ladder · 1 → 10 → 50 → 100 → 250 refs · DSEG7 math
 *   4-step referral journey
 *   "who refers" 4-up audience grid
 *   foot CTA
 *
 * Same sequenced-reveal model as Rewards / Agencies / Billing.
 */

const HERO_METRICS = [
  { eb: "YOUR CUT",           value: "50%",     caption: "of every Pro subscription, every month" },
  { eb: "YOU EARN",            value: "$14.99", caption: "per signup, every month they stay subscribed" },
  { eb: "YOU GET CREDIT",     value: "30d",     caption: "if they sign up within 30 days of your link" },
];

const LADDER = [
  { refs: 1,   monthly: 14.99,    label: "your first signup pays for your own Pro" },
  { refs: 10,  monthly: 149.90,   label: "covers Pro + a week of groceries" },
  { refs: 50,  monthly: 749.50,   label: "more than most clippers earn in a month" },
  { refs: 100, monthly: 1499.00,  label: "money landing every month while you sleep" },
  { refs: 250, monthly: 3747.50,  label: "the kind of side income people don't post about" },
];

const JOURNEY = [
  { t: "Share",   l: "Drop your link in your bio, your Discord, your videos, anywhere" },
  { t: "They click", l: "Someone clicks and lands on Liquid Clips" },
  { t: "They sign up", l: "They install the app and upgrade to Pro" },
  { t: "You get paid", l: "You earn 50% every month they stay subscribed" },
];

const AUDIENCES = [
  { glyph: "✂",  title: "Other clippers",   line: "Your clipper friends are already telling their group about tools." },
  { glyph: "▶",  title: "Creators",   line: "Long-form creators send their fans here to clip them." },
  { glyph: "▤",  title: "Agencies",   line: "Send a whole agency through your link — earn on every seat." },
  { glyph: "✦",  title: "Communities", line: "Discord mods, club owners, anyone with people listening." },
];

function useCountUp(target: number, start: boolean, durationMs = 1000): number {
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

function LadderRow({ refs, monthly, label, delay }: { refs: number; monthly: number; label: string; delay: number }) {
  const [start, setStart] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setStart(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  const n = useCountUp(monthly, start);
  return (
    <li className="lc-af-ladder-row">
      <span className="lc-af-ladder-refs">{refs.toLocaleString()}<span> refs</span></span>
      <span className="lc-af-ladder-eq" aria-hidden="true">=</span>
      <span className="lc-af-ladder-pay">
        ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="lc-af-ladder-unit"> /mo</span>
      </span>
      <span className="lc-af-ladder-note">{label}</span>
    </li>
  );
}

export function AffiliatesPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lc-af ${mounted ? "is-mounted" : ""}`}>
      <KadeHead
        src="/brand/kade/kade-shooter.webp"
        alt="Kade pointing forward to share a link"
      >
        <span className="lc-af-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-af-eb-dot" /> AFFILIATES · 50% MRR
        </span>
        <h2 className="lc-af-h" style={{ animationDelay: "120ms" }}>
          Invite creators and clippers. <em>Earn recurring commission</em>
          every month they stay subscribed.
        </h2>
        <p className="lc-af-sub" style={{ animationDelay: "240ms" }}>
          Share your link. When someone signs up through it, you get 50% of
          what they pay — every single month, for as long as they stay.
        </p>
      </KadeHead>

      <ol className="lc-af-hero-metrics" aria-label="The offer">
        {HERO_METRICS.map((m, i) => (
          <li
            key={m.eb}
            className="lc-af-metric"
            style={{ animationDelay: `${560 + i * 160}ms` }}
          >
            <span className="lc-af-metric-bracket lc-af-metric-bracket--tl" aria-hidden="true" />
            <span className="lc-af-metric-bracket lc-af-metric-bracket--tr" aria-hidden="true" />
            <span className="lc-af-metric-bracket lc-af-metric-bracket--bl" aria-hidden="true" />
            <span className="lc-af-metric-bracket lc-af-metric-bracket--br" aria-hidden="true" />
            <span className="lc-af-metric-eb">{m.eb}</span>
            <span className="lc-af-metric-value">{m.value}</span>
            <span className="lc-af-metric-cap">{m.caption}</span>
          </li>
        ))}
      </ol>

      <div className="lc-af-cta-row" style={{ animationDelay: "1200ms" }}>
        <Link href="#" className="lc-af-cta lc-btn lc-btn--primary">
          <span>Get my affiliate link</span>
          <span aria-hidden="true">→</span>
        </Link>
        <span className="lc-af-cta-sub">no minimum signups · paid every month</span>
      </div>

      {/* ── BELOW THE FOLD ── */}
      <section className="lc-af-ladder" aria-label="What you could earn">
        <header className="lc-af-ladder-head">
          <span className="lc-af-ladder-eb">WHAT YOU COULD EARN</span>
          <h3 className="lc-af-ladder-h">
            Every signup pays you <em>forever</em>.
          </h3>
        </header>
        <ol className="lc-af-ladder-list" aria-label="What you earn for each number of signups">
          {LADDER.map((row, i) => (
            <LadderRow key={row.refs} {...row} delay={1400 + i * 140} />
          ))}
        </ol>
        <p className="lc-af-ladder-foot">
          Based on Pro at $29.99/month. You earn 50% — $14.99/month per signup.
          If they cancel, you stop earning from them. If they stay (most do),
          you keep getting paid.
        </p>
      </section>

      <section className="lc-af-journey" aria-label="How it works in 4 steps">
        <span className="lc-af-journey-eb">HOW IT WORKS · IN 4 STEPS</span>
        <ol className="lc-af-journey-row">
          {JOURNEY.map((s, i) => (
            <li key={s.t} className="lc-af-journey-step">
              <span className="lc-af-journey-num">0{i + 1}</span>
              <span className="lc-af-journey-name">{s.t}</span>
              <span className="lc-af-journey-line">{s.l}</span>
              {i < JOURNEY.length - 1 && (
                <span className="lc-af-journey-arrow" aria-hidden="true">→</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="lc-af-audiences" aria-label="Who sends signups">
        <span className="lc-af-audiences-eb">WHO SENDS SIGNUPS</span>
        <ol className="lc-af-audiences-grid">
          {AUDIENCES.map((a) => (
            <li key={a.title} className="lc-af-audience">
              <span className="lc-af-audience-bracket lc-af-audience-bracket--tl" aria-hidden="true" />
              <span className="lc-af-audience-bracket lc-af-audience-bracket--tr" aria-hidden="true" />
              <span className="lc-af-audience-bracket lc-af-audience-bracket--bl" aria-hidden="true" />
              <span className="lc-af-audience-bracket lc-af-audience-bracket--br" aria-hidden="true" />
              <span className="lc-af-audience-glyph" aria-hidden="true">{a.glyph}</span>
              <span className="lc-af-audience-title">{a.title}</span>
              <span className="lc-af-audience-line">{a.line}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="lc-af-foot-cta">
        <div>
          <span className="lc-af-foot-eb">READY?</span>
          <span className="lc-af-foot-line">
            Grab your link. Share it. Watch the payments stack up.
          </span>
        </div>
        <Link href="#" className="lc-af-cta lc-btn lc-btn--primary">
          <span>Get my affiliate link</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
