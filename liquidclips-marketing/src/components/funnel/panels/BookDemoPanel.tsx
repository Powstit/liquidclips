"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { KadeHead } from "./KadeHead";
import { SUPPORT_EMAIL } from "@/lib/env";

/**
 * Book Demo panel · Calendly inline embed.
 *
 * Above the fold ·
 *   left  · eyebrow + headline + sub + 3 "what to expect" beats + privacy
 *   right · Calendly inline widget (data-url branded with fuchsia)
 *
 * Calendly is the form. We don't reinvent the wheel · the calendar
 * captures name + email + scheduling intent in one step.
 */

const CALENDLY_URL =
  "https://calendly.com/liquidclips/cofounder" +
  "?hide_gdpr_banner=1" +
  "&primary_color=ff2bb0" +
  "&background_color=0b0b10" +
  "&text_color=ecebf2";

const EXPECT = [
  {
    glyph: "01",
    title: "30 minutes, that's it",
    body: "Short call. We show you the app live, you show us how you work today.",
  },
  {
    glyph: "02",
    title: "Bring one video",
    body: "We'll run it through Liquid Clips on the call. You walk out with 10 real clips from your video.",
  },
  {
    glyph: "03",
    title: "We help you start a campaign",
    body: "If paying clippers to post for you makes sense, we'll plan it with you on the call.",
  },
];

export function BookDemoPanel() {
  const [mounted, setMounted] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Re-initialise Calendly when the widget script is ready (some browsers
  // race the embed div mounting). Safe to no-op if already inited.
  useEffect(() => {
    if (!scriptLoaded) return;
    const w = window as unknown as {
      Calendly?: { initInlineWidgets?: () => void };
    };
    try {
      w.Calendly?.initInlineWidgets?.();
    } catch {
      /* noop */
    }
  }, [scriptLoaded]);

  return (
    <div className={`lc-bd ${mounted ? "is-mounted" : ""}`}>
      <Script
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
      />

      <KadeHead
        src="/brand/kade/kade-base.png"
        alt="Kade ready for a live demo"
      >
        <span className="lc-bd-eb" style={{ animationDelay: "0ms" }}>
          <span className="lc-bd-eb-dot" /> BOOK DEMO · 30 MIN · AGENCY READY
        </span>
        <h2 className="lc-bd-h" style={{ animationDelay: "120ms" }}>
          Book a live walkthrough and see exactly <em>how Liquid Clips fits
          your workflow</em>.
        </h2>
        <p className="lc-bd-sub" style={{ animationDelay: "240ms" }}>
          30 minutes on a call. We open the app, you bring a video, we make
          10 clips together. You leave knowing if this is for you — no sales
          pitch.
        </p>
      </KadeHead>

      <section className="lc-bd-grid">
        <div className="lc-bd-side">
          <span className="lc-bd-side-eb">WHAT TO EXPECT</span>
          <ol className="lc-bd-list">
            {EXPECT.map((e, i) => (
              <li
                key={e.glyph}
                className="lc-bd-list-item"
                style={{ animationDelay: `${560 + i * 140}ms` }}
              >
                <span className="lc-bd-list-bracket lc-bd-list-bracket--tl" aria-hidden="true" />
                <span className="lc-bd-list-bracket lc-bd-list-bracket--tr" aria-hidden="true" />
                <span className="lc-bd-list-bracket lc-bd-list-bracket--bl" aria-hidden="true" />
                <span className="lc-bd-list-bracket lc-bd-list-bracket--br" aria-hidden="true" />
                <span className="lc-bd-list-num">{e.glyph}</span>
                <span className="lc-bd-list-title">{e.title}</span>
                <span className="lc-bd-list-body">{e.body}</span>
              </li>
            ))}
          </ol>

          <div className="lc-bd-privacy">
            <span className="lc-bd-privacy-eb">YOUR PRIVACY</span>
            <p>
              Your booking details stay in our calendar. We don't share your
              videos or creator names with anyone. No follow-up emails unless
              you ask for them.
            </p>
          </div>

          <div className="lc-bd-alt">
            <span className="lc-bd-alt-eb">PREFER EMAIL?</span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="lc-bd-alt-link">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>

        <div className="lc-bd-calendar" aria-label="Schedule a 30-minute demo">
          <span className="lc-bd-calendar-bracket lc-bd-calendar-bracket--tl" aria-hidden="true" />
          <span className="lc-bd-calendar-bracket lc-bd-calendar-bracket--tr" aria-hidden="true" />
          <span className="lc-bd-calendar-bracket lc-bd-calendar-bracket--bl" aria-hidden="true" />
          <span className="lc-bd-calendar-bracket lc-bd-calendar-bracket--br" aria-hidden="true" />

          <span className="lc-bd-calendar-eb">
            <span className="lc-bd-calendar-eb-dot" /> LIVE CALENDAR · CALENDLY
          </span>

          {/* the Calendly inline widget. Calendly's script auto-initialises
              any div with .calendly-inline-widget on mount. */}
          <div
            className="calendly-inline-widget lc-bd-calendar-frame"
            data-url={CALENDLY_URL}
          />

          {!scriptLoaded && (
            <div className="lc-bd-calendar-pending" aria-hidden="true">
              <span className="lc-bd-calendar-pending-pulse" />
              <span>Opening the calendar…</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
