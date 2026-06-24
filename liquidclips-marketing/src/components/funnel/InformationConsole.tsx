"use client";

import { Suspense, lazy, useEffect, useState } from "react";
import Image from "next/image";
import { CONSOLE_CLOSE, CONSOLE_OPEN } from "@/lib/consoleBus";

// Panels lazy-load · only the panel the visitor opens hits the network.
// The overlay shell + rail are tiny; the panels carry the heavy bits
// (Calendly script, screenshots, count-up animations).
const FeaturesPanel        = lazy(() => import("./panels/FeaturesPanel").then((m) => ({ default: m.FeaturesPanel })));
const ClippingRewardsPanel = lazy(() => import("./panels/ClippingRewardsPanel").then((m) => ({ default: m.ClippingRewardsPanel })));
const AgenciesPanel        = lazy(() => import("./panels/AgenciesPanel").then((m) => ({ default: m.AgenciesPanel })));
const BillingPanel         = lazy(() => import("./panels/BillingPanel").then((m) => ({ default: m.BillingPanel })));
const TestimonialsPanel    = lazy(() => import("./panels/TestimonialsPanel").then((m) => ({ default: m.TestimonialsPanel })));
const AffiliatesPanel      = lazy(() => import("./panels/AffiliatesPanel").then((m) => ({ default: m.AffiliatesPanel })));
const BookDemoPanel        = lazy(() => import("./panels/BookDemoPanel").then((m) => ({ default: m.BookDemoPanel })));

/**
 * InformationConsole · in-world dashboard below Workbench.
 *
 * Art direction (v2 · user-approved):
 *   · the WORLD is the hero · the Kade Command Centre png lives at near-full
 *     brightness, only a soft vignette · no heavy scrim
 *   · an idle Kade is staged inside the room (right-centre, breathing)
 *   · the content panel is HIDDEN by default · the room demonstrates premium
 *   · hover a menu item → its panel reveals (desktop)
 *   · click a menu item → its panel pins (touch + accessibility)
 *   · clicking outside the rail unpins
 *
 * Inherits LOCKED W1 tokens / typography / motion language.
 *
 * PANEL BUILD ORDER (one per pass):
 *   1. Features          · BUILT
 *   2. Clipping Rewards  · stub
 *   3. Agencies          · stub
 *   4. Billing           · stub
 *   5. Testimonials      · stub
 *   6. Affiliates        · stub
 *   7. Book Demo         · stub
 */

type PanelKey =
  | "features"
  | "rewards"
  | "agencies"
  | "billing"
  | "testimonials"
  | "affiliates"
  | "demo";

const MENU: { key: PanelKey; label: string; glyph: string; tag: string }[] = [
  { key: "features",     label: "Features",         glyph: "▣", tag: "10 clips, scored." },
  { key: "rewards",      label: "Clipping Rewards", glyph: "◆", tag: "Tracked views · paid rewards." },
  { key: "agencies",     label: "Agencies",         glyph: "▤", tag: "Pipelines, not paragraphs." },
  { key: "billing",      label: "Billing",          glyph: "$", tag: "Free → Pro → Agency." },
  { key: "testimonials", label: "Testimonials",     glyph: "✦", tag: "Proof, not stories." },
  { key: "affiliates",   label: "Affiliates",       glyph: "↗", tag: "Earn for the room." },
  { key: "demo",         label: "Book Demo",        glyph: "▶", tag: "Show your creator pipeline." },
];

export function InformationConsole() {
  const [hovered, setHovered] = useState<PanelKey | null>(null);
  const [pinned, setPinned] = useState<PanelKey | null>(null);
  const [open, setOpen] = useState(false);
  const active: PanelKey | null = hovered ?? pinned;
  const showing = active !== null;

  function onSelect(key: PanelKey) {
    setPinned((p) => (p === key ? null : key));
  }

  // Bus listeners · the right-edge tab + any other surface opens us.
  useEffect(() => {
    const openFn = () => setOpen(true);
    const closeFn = () => setOpen(false);
    window.addEventListener(CONSOLE_OPEN, openFn);
    window.addEventListener(CONSOLE_CLOSE, closeFn);
    return () => {
      window.removeEventListener(CONSOLE_OPEN, openFn);
      window.removeEventListener(CONSOLE_CLOSE, closeFn);
    };
  }, []);

  // Escape to close · body scroll lock when open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <section
      id="information-console"
      className={`lc-ic ${showing ? "is-showing" : ""} ${open ? "is-open" : "is-closed"}`}
      aria-label="Information console"
      aria-hidden={!open}
      role="dialog"
      onMouseLeave={() => setHovered(null)}
    >
      {open && (
        <button
          type="button"
          className="lc-ic-overlay-close"
          onClick={() => setOpen(false)}
          aria-label="Close information console"
        >
          ✕ <span className="lc-ic-overlay-close-label">close console</span>
        </button>
      )}
      {/* layer 0 · the GENERATED cockpit-home world plate · pink nebula
          + semicircular console + reflective floor. NOT the desktop UI
          screenshot. */}
      <div className="lc-ic-world" aria-hidden="true">
        <Image
          src="/world/cockpit-home.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="lc-ic-world-img"
        />
        <div className="lc-ic-world-vignette" />
        <div className="lc-ic-world-scanlines" />
      </div>

      {/* layer 1 · corner ticks · part of the room frame */}
      <span className="lc-ic-tick lc-ic-tick--tl" aria-hidden="true" />
      <span className="lc-ic-tick lc-ic-tick--tr" aria-hidden="true" />
      <span className="lc-ic-tick lc-ic-tick--bl" aria-hidden="true" />
      <span className="lc-ic-tick lc-ic-tick--br" aria-hidden="true" />

      {/* layer 2 · status bar */}
      <div className="lc-ic-status">
        <span className="lc-ic-status-mark">liquid/clips</span>
        <span className="lc-ic-status-sep">/</span>
        <span className="lc-ic-status-trail">information console · v0.7.80</span>
        <span className="lc-ic-status-spacer" />
        <span className="lc-ic-status-eb">
          <span className="lc-ic-status-dot" /> KADE // STANDING BY
        </span>
      </div>

      {/* layer 3 · main layout */}
      <div className="lc-ic-frame">
        {/* the room · the cockpit-home plate is the architecture · we add
            an idle Kade in the foreground hovering above the console
            desk so the room has its inhabitant. */}
        <div className="lc-ic-room">
          <div className="lc-ic-kade" aria-hidden="true">
            <div className="lc-ic-kade-rim" />
            <Image
              src="/brand/kade/kade-idle.webp"
              alt=""
              width={520}
              height={520}
              className="lc-ic-kade-img"
              priority
            />
          </div>
          <div className="lc-ic-prompt">
            <span className="lc-ic-prompt-eb">SELECT A PANEL</span>
            <span className="lc-ic-prompt-hint">
              hover the rail · click to pin
            </span>
          </div>
        </div>

        {/* the rail · always visible · hover triggers ephemeral reveal */}
        <nav className="lc-ic-rail" aria-label="Console sections">
          <span className="lc-ic-rail-eb">CONSOLE</span>
          <ul className="lc-ic-rail-list">
            {MENU.map((m) => (
              <li key={m.key}>
                <button
                  type="button"
                  className={`lc-ic-rail-item ${pinned === m.key ? "is-pinned" : ""} ${hovered === m.key ? "is-hover" : ""}`}
                  onMouseEnter={() => setHovered(m.key)}
                  onFocus={() => setHovered(m.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect(m.key)}
                  aria-pressed={pinned === m.key}
                >
                  <span className="lc-ic-rail-glyph" aria-hidden="true">{m.glyph}</span>
                  <span className="lc-ic-rail-label">{m.label}</span>
                  <span className="lc-ic-rail-tag">{m.tag}</span>
                  {pinned === m.key && (
                    <span className="lc-ic-rail-pip" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="lc-ic-rail-foot">
            <span className="lc-ic-rail-foot-eb">SESSION</span>
            <span className="lc-ic-rail-foot-text">
              one continuous workstation · no page reload
            </span>
          </div>
        </nav>

        {/* mobile chip strip · click only (no hover for touch) */}
        <div className="lc-ic-chips" role="tablist" aria-label="Console sections">
          {MENU.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`lc-ic-chip ${pinned === m.key ? "is-active" : ""}`}
              onClick={() => onSelect(m.key)}
              aria-pressed={pinned === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* the panel · hidden when no hover + no pin */}
        <div
          className={`lc-ic-panel ${showing ? "is-open" : ""}`}
          role="region"
          aria-live="polite"
          aria-hidden={!showing}
        >
          {showing && (
            <>
              <button
                type="button"
                className="lc-ic-panel-close"
                onClick={() => { setPinned(null); setHovered(null); }}
                aria-label="Close panel"
              >
                ✕ close
              </button>

              <span className="lc-ic-panel-bracket lc-ic-panel-bracket--tl" aria-hidden="true" />
              <span className="lc-ic-panel-bracket lc-ic-panel-bracket--tr" aria-hidden="true" />
              <span className="lc-ic-panel-bracket lc-ic-panel-bracket--bl" aria-hidden="true" />
              <span className="lc-ic-panel-bracket lc-ic-panel-bracket--br" aria-hidden="true" />

              <Suspense fallback={
                <div className="lc-ic-panel-loading" aria-live="polite">
                  <span className="lc-ic-panel-loading-pulse" />
                  <span>Loading panel…</span>
                </div>
              }>
                {active === "features"     && <FeaturesPanel />}
                {active === "rewards"      && <ClippingRewardsPanel />}
                {active === "agencies"     && <AgenciesPanel />}
                {active === "billing"      && <BillingPanel />}
                {active === "testimonials" && <TestimonialsPanel />}
                {active === "affiliates"   && <AffiliatesPanel />}
                {active === "demo"         && <BookDemoPanel />}
              </Suspense>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
