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
import "./SimPage.css";
import "./ClipperJourney.css";

type ChipState = "available";

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

  const chips: ChipSpec[] = [
    {
      id: "join",
      label: "Join",
      verb: "Pick a brief",
      state: "available",
      go: () => bus.emit("nav:click", { route: "campaigns" }),
      art: "/brand/kade/kade-campaign-mode.webp",
    },
    {
      id: "clip",
      label: "Clip",
      verb: "Paste a URL",
      state: "available",
      go: () => { bus.emit("nav:click", { route: "home" }); window.setTimeout(() => bus.emit("home:open-panel", { tab: "url" }), 60); },
      art: "/brand/kade/kade-create-clips.webp",
    },
    {
      id: "post",
      label: "Post",
      verb: "TikTok · YT · IG",
      state: "available",
      go: () => bus.emit("nav:click", { route: "workstation" }),
      art: "/brand/kade/kade-publishing.webp",
    },
    {
      id: "submit",
      label: "Submit",
      verb: "Hand it to Whop",
      state: "available",
      go: () => {
        bus.emit("nav:click", { route: "workstation" });
      },
      art: "/brand/kade/kade-earn-mode.webp",
    },
    {
      id: "earn",
      label: "Earn",
      verb: "Whop pays out",
      state: "available",
      go: () => bus.emit("nav:click", { route: "earn" }),
      art: "/brand/kade/kade-success.webp",
    },
  ];

  return (
    <DesignOSAppShell world="cockpit-home" route="clipper" defaultKade="campaign-mode" kadePlacement="helper-right">
      <fm.div
        className="sim-stage lc-cj-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <div className="lc-route-head" data-kade-anchor data-route-title="My journey">
          <div className="lc-cj-heading">
            <span className="lc-route-head-eb">My journey</span>
            <span className="lc-cj-heading-copy">Move from a paid brief to a verified payout.</span>
          </div>
          <span className="lc-cj-honesty">Progress tracking activates with your first Reward Clip</span>
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
              >
                <span className="lc-cj-chip-art-wrap" aria-hidden="true">
                  <img className="lc-cj-chip-art" src={c.art} alt="" />
                </span>
                <span className="lc-cj-chip-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="lc-cj-chip-label">{c.label}</span>
                <span className="lc-cj-chip-verb">{c.verb}</span>
                <span className="lc-cj-chip-state">Open</span>
              </button>
              {i < chips.length - 1 && (
                <span className="lc-cj-link lc-cj-link-lit" aria-hidden="true" />
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
