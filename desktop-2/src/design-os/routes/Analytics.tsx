/**
 * AnalyticsRoute · UX-4 · honest stub
 *
 * Surface promises what's coming after Batch D without inventing numbers.
 *
 * 2026-06-23 monetisation pass · Daniel's commitment-point principle:
 *   "Agency features should not disappear completely below Agency. Show
 *    locked previews where useful. Especially Campaign Create and
 *    Analytics. The user should understand what Agency unlocks even
 *    before upgrading."
 *
 * Previously: clipper users got redirected to /home on mount — the
 * Analytics route was a dead screen below Agency.
 * Now: every tier RENDERS the analytics preview; below Agency the
 * surface is wrapped in PaywallGate(mode="overlay") so the locked-state
 * upgrade card sits on top. Real per-clip rollups stay Agency-gated
 * (TIER_CAPS.agency.analyticsAccess === "rollups").
 */

import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { presets } from "../motion";
import { ROUTE_HERO } from "../copy/copyMap";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import "./Analytics.css";

const PLACEHOLDERS = [
  { label: "Total views",         value: "—", sub: "Across every clip" },
  { label: "Avg clip score",      value: "—", sub: "Out of 100" },
  { label: "Top performing clip", value: "—", sub: "Best of the week" },
  { label: "Reach by platform",   value: "—", sub: "TikTok · YT · IG · X" },
];

const CHECKLIST = [
  "Per-campaign views, RPM, and clipper rank",
  "Top clips by score, retention, shareability",
  "Channel-level performance breakdown",
];

export function AnalyticsRoute() {
  const hero = ROUTE_HERO["analytics"];
  const spec = ROUTE_REGISTRY["analytics"];

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="analytics"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage lc-an-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
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

        {/* Below Agency: the preview renders + PaywallGate overlay sits
            on top with "Agency required" copy. Above Agency: gate passes
            through and the user sees the live (still placeholder)
            analytics surface. */}
        <PaywallGate requiredTier="agency" action="View per-clip rollups" mode="overlay">
          <section className="lc-an-stub" data-testid="analytics-stub" data-state="coming-soon">
            <header className="lc-an-stub-head">
              <span className="lc-an-stub-eb">Example metrics</span>
              <span className="lc-an-stub-sub" data-testid="analytics-coming-soon-copy">Numbers stay quiet until Batch D wires real data.</span>
            </header>

            <div className="lc-an-grid" data-testid="analytics-grid">
              {PLACEHOLDERS.map((m) => (
                <article key={m.label} className="lc-an-card" aria-disabled="true" data-analytics-card={m.label}>
                  <span className="lc-an-card-eb">{m.label}</span>
                  <span className="lc-an-card-val" data-testid={`analytics-card-value-${m.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{m.value}</span>
                  <span className="lc-an-card-sub">{m.sub}</span>
                </article>
              ))}
            </div>

            <aside className="lc-an-checklist">
              <span className="lc-an-checklist-eb">Launch checklist · what we'll wire</span>
              <ul>
                {CHECKLIST.map((line) => (
                  <li key={line}><span className="lc-an-tick" aria-hidden="true">○</span>{line}</li>
                ))}
              </ul>
            </aside>
          </section>
        </PaywallGate>
      </fm.div>
    </DesignOSAppShell>
  );
}
