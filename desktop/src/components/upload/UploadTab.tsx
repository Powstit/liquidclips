import { useEffect, useState } from "react";
import { UploadCloud, CalendarClock, Settings2, Zap } from "lucide-react";
import { socialGetConnection, type ConnectionPlatform, type SocialConnectionState } from "../../lib/backend";
import { sidecar } from "../../lib/sidecar";
import { PUBLISHING_ENABLED } from "../../lib/flags";
import { PlatformIcon } from "../PlatformIcon";
import { ScheduleQueue } from "../ScheduleQueue";
import { LocalQueue } from "./LocalQueue";
import { CampaignContextStrip } from "../earn/CampaignContextStrip";

const PLATFORM_ORDER: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];

/**
 * Upload tab — the home for everything that leaves Liquid Clips and lands on a
 * social platform. Replaces the old header "Queue" drawer and centralises
 * the scheduled posts list, the connected-platforms summary, and (later)
 * the Drip planner entry point. Per-clip "Publish now / Schedule" is still
 * triggered from ResultsGrid because it's bound to a specific clip — what
 * *lives* here is the cross-cutting view of "what's queued and where it's
 * going."
 */
export function UploadTab({
  onOpenSettings,
}: {
  /** Settings → Connections is where the user actually links accounts.
   *  We bubble the request up rather than re-implementing it inline. */
  onOpenSettings: () => void;
}) {
  // Sprint #3 — swapped from legacy `backend.connections.list` (Postiz era,
  // per-account OAuth integration model) to `socialGetConnection` which
  // reflects the Ayrshare profile + the platforms the user has linked on
  // Ayrshare's hosted dashboard. The chip rail now stays in sync with the
  // actual publishing path.
  const [connection, setConnection] = useState<SocialConnectionState | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (cancelled) return;
        if (!jwt) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        const state = await socialGetConnection();
        if (!cancelled) setConnection(state);
      } catch {
        if (!cancelled) setConnection(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = new Set((connection?.platforms ?? []).map((p) => p.toLowerCase()));

  return (
    // v0.5.1 — Studio Deck (workspace). Fuchsia top-edge band + faint
    // ambient tint above the existing MainShell backdrop. See
    // docs/RPO_VISUAL_LANGUAGE.md and src/index.css `.deck` utilities.
    <div className="deck deck-workspace flex w-full max-w-[920px] flex-col gap-7 pt-2">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <UploadCloud className="h-3.5 w-3.5" strokeWidth={2} />
            upload
          </div>
          <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            Schedule &amp; publish
          </h1>
          <p className="mt-1 max-w-[560px] font-sans text-[13px] leading-relaxed text-text-secondary">
            Everything queued, scheduled, or already live. Per-clip Schedule and Publish-now still
            live next to the clip on the results screen — this is the cross-cutting view.
          </p>
        </div>
        <button
          onClick={onOpenSettings}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          title="Connect or disconnect social accounts in Settings → Connections"
        >
          <Settings2 className="h-3.5 w-3.5" strokeWidth={2} />
          Manage connections
        </button>
      </header>

      <CampaignContextStrip />

      {/* Connected-platforms chip rail — 4 fixed slots, fuchsia when connected,
          dim when not. Reads at a glance whether the queue can actually fire.
          Task #69 — HUD chrome: corner brackets + soft inner glow on the
          primary featured card. See docs/RPO_VISUAL_LANGUAGE.md. */}
      <section className="hud-frame rounded-2xl border border-line bg-paper-warm/30 px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          connected accounts
          <span className="ml-auto font-mono text-[10px] text-text-tertiary">
            {connection ? `${connection.platforms.length} linked` : "—"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PLATFORM_ORDER.map((p) => {
            const isOn = connected.has(p);
            return (
              <div
                key={p}
                tabIndex={0}
                className={`deck-focusable flex items-center gap-2 rounded-xl border px-3 py-2 outline-none ${
                  isOn
                    ? "border-fuchsia/40 bg-fuchsia-soft/30 text-ink"
                    : "border-line bg-paper text-text-tertiary"
                }`}
              >
                <PlatformIcon id={p} className={`h-4 w-4 ${isOn ? "text-fuchsia-deep" : ""}`} />
                <span className="font-mono text-[11px] uppercase tracking-[0.08em]">{p}</span>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em]">
                  {isOn ? "linked" : "—"}
                </span>
              </div>
            );
          })}
        </div>
        {authed === false && (
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">
            Sign in to view your connected accounts.
          </p>
        )}
      </section>

      {/* PRIMARY: local "Liquid Clips reminds, you post" queue. Always available,
          no tier gate, no Postiz dependency — runs from $CLIPS_HOME/.schedule.json. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
            schedule &mdash; assisted
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            local · runs offline
          </span>
        </div>
        <LocalQueue />
      </section>

      {/* SECONDARY: backend auto-publish queue (premium, hosted).
          When PUBLISHING_ENABLED is off, render a visible coming-soon card
          here instead of silently hiding the section. Users should see that
          the hosted layer is on the roadmap, not absent. */}
      {PUBLISHING_ENABLED ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              auto-publish &mdash; growth / autopilot
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              hosted
            </span>
          </div>
          <ScheduleQueue />
        </section>
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              auto-publish
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              coming soon
            </span>
          </div>
          <div className="rounded-2xl border border-line bg-paper-warm/30 px-5 py-4">
            <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
              One-tap publishing across your connected accounts is in beta. We're verifying the full
              path end-to-end before flipping it on. For now, use the local schedule above &mdash;
              Liquid Clips reminds you when it's time and copies your caption so you post in one tap.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
