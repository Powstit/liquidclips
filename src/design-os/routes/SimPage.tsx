/**
 * SimPage · shared simulator page template
 *
 * Phase 5B: every route except CommandRoom uses this template. Wraps the
 * Design OS shell + a uniform hero + 5-state grid + microinteraction strip.
 *
 * Real routes (Phase 6+) will replace each one with full content.
 */

import { useState, type ReactNode } from "react";
import { motion as fm } from "framer-motion";
import {
  DesignOSAppShell,
  GlassCard,
  bus,
  type KadeState,
  type RouteId,
} from "..";
import { presets, useMotionGate } from "../motion";
import type { WorldKey } from "../components/WorldLayer";
import { ROUTE_HERO, ROUTE_STATES, KADE_SAYS, type RouteHero } from "../copy/copyMap";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import "./SimPage.css";

export interface KeyPanelSpec {
  /** Mono eyebrow above the headline. */
  eyebrow: string;
  /** Big stat or short headline. */
  headline: string;
  /** Optional Kade-voiced subline. */
  sub?: string;
  /** Optional small chip row beneath the headline. */
  chips?: ReadonlyArray<string>;
  /** Optional progress (0..1) shown as a thin bar. */
  progress?: number;
}

export interface SimPageProps {
  route: RouteId;
  world: WorldKey;
  defaultKade: KadeState;
  /** Optional extra panel rendered between hero and state grid. */
  centerPanel?: ReactNode;
  /** Per-route key panel — the single "this is what this route is for" tile.
   *  Routes that overbuild can leave this empty and pass `centerPanel` directly. */
  keyPanel?: KeyPanelSpec;
  /** Optional list of microinteraction buttons (label + kade flash state). */
  microInteractions?: ReadonlyArray<{ label: string; kade: KadeState }>;
  /** Hide the sticky Kade — login uses its own boot Kade. */
  hideStickyKade?: boolean;
  /** UX-1-c R-39 · per-stub hero override. Used when a stub uses an
   *  existing RouteId for plumbing (e.g. StopPages reuses `home`) but
   *  needs its own hero copy. Falls back to `ROUTE_HERO[route]` if
   *  unset. */
  heroOverride?: RouteHero;
}

export function SimPage({
  route, world, defaultKade, centerPanel, keyPanel, microInteractions, hideStickyKade, heroOverride,
}: SimPageProps) {
  const hero = heroOverride ?? ROUTE_HERO[route];
  const states = ROUTE_STATES[route];
  const { reduced } = useMotionGate();
  const [currentKade, setCurrentKade] = useState<KadeState>(defaultKade);
  const kadePlacement = ROUTE_REGISTRY[route].kadePlacement;

  // The microinteraction button fires nav:hover so the StickyKade reacts.
  // Pattern matches CommandRoom — keeps Kade user-driven.
  const onDemo = (kade: KadeState) => {
    setCurrentKade(kade);
    bus.emit("nav:hover", { route: route, kade });
    window.setTimeout(() => setCurrentKade(defaultKade), 2000);
  };

  return (
    <DesignOSAppShell
      world={world}
      route={route}
      defaultKade={currentKade}
      kadePlacement={kadePlacement}
      hideStickyKade={hideStickyKade}
    >
      <fm.div
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >

        {/* Hero — anchored so StickyKade IntersectionObserver flips to
            mini-mode only when this whole block leaves the viewport. */}
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>{hero.eyebrow}</fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>{hero.h1}</fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>{hero.sub}</fm.p>
        </fm.div>

        {/* Key panel — single "what this route is for" tile. */}
        {keyPanel && <SimKeyPanel spec={keyPanel} />}

        {/* Optional fully-custom central panel — overrides keyPanel layout. */}
        {centerPanel}

        {/* 5-state grid */}
        <div className="sim-states">
          <h2 className="sim-section-h">Sample states · empty · loading · success · warning · error</h2>
          <div className="sim-state-grid">
            <StateTile tone="dim"     title="Empty"     state={states.empty} />
            <StateTile tone="fxd"     title="Loading"   state={states.loading} />
            <StateTile tone="fx"      title="Success"   state={states.success} />
            <StateTile tone="amber"   title="Warning"   state={states.warning} />
            <StateTile tone="danger"  title="Error"     state={states.error} />
          </div>
        </div>

        {/* Microinteraction strip */}
        {microInteractions && microInteractions.length > 0 && (
          <GlassCard className="sim-micro" density="quiet">
            <h2 className="sim-section-h">Key microinteractions</h2>
            <p className="sim-micro-sub">{kadeQuote(currentKade)}</p>
            <div className="sim-micro-row">
              {microInteractions.map((mi) => (
                <button
                  key={mi.label}
                  className="sim-btn"
                  onClick={() => onDemo(mi.kade)}
                  disabled={reduced}
                >
                  {mi.label}
                </button>
              ))}
            </div>
          </GlassCard>
        )}
      </fm.div>
    </DesignOSAppShell>
  );
}

function StateTile({ tone, title, state }: {
  tone: "fx" | "fxd" | "amber" | "danger" | "dim";
  title: string;
  state: { title: string; body: string };
}) {
  return (
    <div className={`sim-state sim-tone-${tone}`}>
      <span className="sim-state-lbl">{title}</span>
      <span className="sim-state-title">{state.title || "—"}</span>
      <span className="sim-state-body">{state.body || "Not applicable on this route."}</span>
    </div>
  );
}

function SimKeyPanel({ spec }: { spec: KeyPanelSpec }) {
  const pct = typeof spec.progress === "number" ? Math.max(0, Math.min(1, spec.progress)) : null;
  return (
    <GlassCard className="sim-key" density="default" hoverLift>
      <div className="sim-key-head">
        <span className="sim-key-eb">{spec.eyebrow}</span>
        <span className="sim-key-tag">live</span>
      </div>
      <div className="sim-key-headline">{spec.headline}</div>
      {spec.sub && <p className="sim-key-sub">{spec.sub}</p>}
      {spec.chips && spec.chips.length > 0 && (
        <div className="sim-key-chips">
          {spec.chips.map((c, i) => (
            <span key={i} className="sim-key-chip">{c}</span>
          ))}
        </div>
      )}
      {pct !== null && (
        <div className="sim-key-bar"><div className="sim-key-fill" style={{ width: `${pct * 100}%` }} /></div>
      )}
    </GlassCard>
  );
}

function kadeQuote(state: KadeState): string {
  switch (state) {
    case "idle":             return KADE_SAYS.idle;
    case "hover":            return KADE_SAYS.hover;
    case "create-clips":     return KADE_SAYS.create;
    case "import-footage":   return KADE_SAYS.importing;
    case "reading-brief":    return KADE_SAYS.reading;
    case "cutting-clips":    return KADE_SAYS.cutting;
    case "generating-captions": return KADE_SAYS.captions;
    case "exporting":        return KADE_SAYS.exporting;
    case "publishing":       return KADE_SAYS.publishing;
    case "campaign-mode":    return KADE_SAYS.campaign;
    case "earn-mode":        return KADE_SAYS.earnMode;
    case "community-mode":   return KADE_SAYS.community;
    case "settings-mode":    return KADE_SAYS.settings;
    case "success":          return KADE_SAYS.success;
    case "celebration":      return KADE_SAYS.celebration;
    case "warning":          return KADE_SAYS.warning;
    case "error":            return KADE_SAYS.error;
    default:                 return KADE_SAYS.idle;
  }
}
