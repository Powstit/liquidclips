/**
 * ClipperJourneyRoute · UI-3 · dedicated mission map
 *
 * Replaces the beta stub with a five-chip badge chain that tells the clipper
 * exactly where they are in the loop. Pure UI surface · state derives from
 * the focused FIXTURE clip's status + a small mock earn count.
 *
 * Mode-aware: in Agency mode the route immediately redirects to
 * #/submissions (the agency's equivalent mission surface).
 */

import { useEffect } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { bus, useMode } from "../bridge";
import { presets } from "../motion";
import { FIXTURE_PROJECT } from "../engine/types";
import type { ClipStatus } from "../engine/clipCardStatus";
import "./SimPage.css";
import "./ClipperJourney.css";

type ChipState = "done" | "current" | "locked";

interface ChipSpec {
  id: "join" | "clip" | "post" | "submit" | "earn";
  label: string;
  verb: string;
  state: ChipState;
  /** Route or bus action to fire when clicked. */
  go: () => void;
  /** Path to the Kade pose poster (existing brand asset). */
  art: string;
}

export function ClipperJourneyRoute() {
  const mode = useMode();

  // Mode redirect — agency mode should land on submissions.
  useEffect(() => {
    if (mode === "agency") {
      window.setTimeout(() => bus.emit("nav:click", { route: "submissions" }), 60);
    }
  }, [mode]);

  if (mode === "agency") return null;

  // Derive chip states from the highest-status fixture clip + a mock earn flag.
  const statuses = FIXTURE_PROJECT.clips.map((c) => (c.status ?? "draft") as ClipStatus);
  const has = (s: ClipStatus) => statuses.includes(s);

  const chips: ChipSpec[] = [
    {
      id: "join",
      label: "Join",
      verb: "Pick a brief",
      state: "done",
      go: () => bus.emit("nav:click", { route: "campaigns" }),
      art: "/brand/kade/kade-campaign-mode.webp",
    },
    {
      id: "clip",
      label: "Clip",
      verb: "Paste a URL",
      state: has("ready") || has("posted") || has("submitted") ? "done" : "current",
      go: () => { bus.emit("nav:click", { route: "home" }); window.setTimeout(() => bus.emit("home:open-panel", { tab: "url" }), 60); },
      art: "/brand/kade/kade-create-clips.webp",
    },
    {
      id: "post",
      label: "Post",
      verb: "TikTok · YT · IG",
      state: has("posted") || has("submitted") ? "done" : has("ready") ? "current" : "locked",
      go: () => bus.emit("nav:click", { route: "workstation" }),
      art: "/brand/kade/kade-publishing.webp",
    },
    {
      id: "submit",
      label: "Submit",
      verb: "Hand it to Whop",
      state: has("submitted") ? "done" : has("posted") ? "current" : "locked",
      go: () => {
        const clip = FIXTURE_PROJECT.clips.find((c) => c.status === "posted") ?? FIXTURE_PROJECT.clips[0];
        bus.emit("nav:click", { route: "workstation" });
        window.setTimeout(() => bus.emit("clip:open-submit", { clipIdx: clip.idx }), 80);
      },
      art: "/brand/kade/kade-earn-mode.webp",
    },
    {
      id: "earn",
      label: "Earn",
      verb: "Whop pays out",
      state: has("submitted") ? "current" : "locked",
      go: () => bus.emit("nav:click", { route: "earn" }),
      art: "/brand/kade/kade-success.webp",
    },
  ];

  const advancedCount = chips.filter((c) => c.state === "done").length;
  const total = chips.length;
  // VAL.5 · progress strip · "Step N of 5" + visual bar
  const pct = Math.round((advancedCount / total) * 100);

  return (
    <DesignOSAppShell world="cockpit-home" route="clipper" defaultKade="campaign-mode" kadePlacement="center">
      <fm.div
        className="sim-stage lc-cj-stage"
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
          <fm.span className="sim-eb" variants={presets.staggerItem}>Clipper journey</fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>From mission to payout.</fm.h1>
        </fm.div>

        {/* VAL.5 · progress strip — replaces the previous paragraph. */}
        <div className="lc-cj-progress" aria-label={`Step ${Math.min(advancedCount + 1, total)} of ${total}`}>
          <span className="lc-cj-progress-eb">Step {Math.min(advancedCount + 1, total)} of {total}</span>
          <span className="lc-cj-progress-bar">
            <span className="lc-cj-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        </div>

        <div className="lc-cj-chain" role="list">
          {chips.map((c, i) => (
            <div
              key={c.id}
              role="listitem"
              className="lc-cj-chip-wrap"
            >
              <button
                type="button"
                className={`lc-cj-chip lc-cj-chip-${c.state}`}
                onClick={c.go}
                aria-current={c.state === "current" ? "step" : undefined}
              >
                <span className="lc-cj-chip-art-wrap" aria-hidden="true">
                  <img className="lc-cj-chip-art" src={c.art} alt="" />
                </span>
                <span className="lc-cj-chip-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="lc-cj-chip-label">{c.label}</span>
                <span className="lc-cj-chip-verb">{c.verb}</span>
                <span className="lc-cj-chip-state">{c.state === "done" ? "Done" : c.state === "current" ? "Up next" : "Locked"}</span>
              </button>
              {i < chips.length - 1 && (
                <span className={`lc-cj-link lc-cj-link-${chips[i + 1].state === "locked" ? "locked" : "lit"}`} aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </fm.div>
    </DesignOSAppShell>
  );
}

/* VAL.5 · Inline SVG glyphs removed — chips now render Kade artwork from
   `public/brand/kade/*.webp`. No new assets generated. */
