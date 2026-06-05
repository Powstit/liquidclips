import { useEffect, useState } from "react";
import { UploadCloud, CalendarClock, Settings2, Zap } from "lucide-react";
import { socialGetConnection, type ConnectionPlatform, type SocialConnectionState } from "../../lib/backend";
import { sidecar, type Project } from "../../lib/sidecar";
import { PUBLISHING_ENABLED } from "../../lib/flags";
import { PlatformIcon } from "../PlatformIcon";
import { ScheduleQueue } from "../ScheduleQueue";
import { LocalQueue } from "./LocalQueue";
import { DirectPublishQueue } from "./DirectPublishQueue";
import { CampaignContextStrip } from "../earn/CampaignContextStrip";
import { HudChip } from "../cockpit/HudChip";

const PLATFORM_ORDER: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];

/**
 * Upload tab — the home for everything that leaves Liquid Clips and lands on a
 * social platform. v0.6.39 cockpit pass: cockpit-style header, transparent
 * shell, bracket-cornered connected-accounts rail.
 *
 * Per-clip "Publish now / Schedule" is still triggered from ResultsGrid — what
 * lives here is the cross-cutting "what's queued and where" view.
 */
export function UploadTab({
  onOpenSettings,
  onOpenProject,
  onOpenSchedule,
}: {
  /** Settings hosts the API-keys + non-connection settings. */
  onOpenSettings: () => void;
  /** Route uploaded finished clips into ResultsGrid so they get the same
   *  stack / split / schedule / publish affordances. Wired to DirectPublishQueue. */
  onOpenProject: (project: Project) => void;
  /** Jump to Schedule → Channels — the canonical linked-accounts surface
   *  since Settings → Connections was collapsed. */
  onOpenSchedule?: () => void;
}) {
  // Sprint #3 — `socialGetConnection` reflects the Ayrshare profile + linked
  // platforms (replaced legacy Postiz `backend.connections.list`).
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
    <div className="deck deck-workspace flex w-full max-w-[920px] flex-col gap-7 bg-transparent pt-2">
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
        <HudChip
          active={false}
          onClick={onOpenSchedule ?? onOpenSettings}
          title="Manage linked accounts in Schedule → Channels"
        >
          <Settings2 className="h-3 w-3" strokeWidth={2} />
          Manage connections
        </HudChip>
      </header>

      <CampaignContextStrip />

      {/* Connected-platforms rail — 4 fixed slots, fuchsia HUD brackets on
          the linked ones, dim on the empty ones. Reads at a glance whether
          the queue can actually fire. */}
      <section className="relative px-5 py-4">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
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
                data-hot={isOn ? "true" : "false"}
                className="library-card relative flex items-center gap-2 px-3 py-2 outline-none"
              >
                <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                <PlatformIcon id={p} className={`h-4 w-4 ${isOn ? "text-fuchsia-deep" : "text-text-tertiary"}`} />
                <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${isOn ? "text-ink" : "text-text-tertiary"}`}>{p}</span>
                <span className={`ml-auto font-mono text-[10px] uppercase tracking-[0.12em] ${isOn ? "text-fuchsia-deep" : "text-text-tertiary"}`}>
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

      {/* Direct publish — drop a finished clip, ship it without the long-form
          clip-pick pipeline. DirectPublishQueue handles the drop zone, queue
          cards, and per-card PublishModal reuse. */}
      <DirectPublishQueue
        onOpenSettings={onOpenSettings}
        onOpenProject={onOpenProject}
        onOpenSchedule={onOpenSchedule}
      />

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

      {/* SECONDARY: backend auto-publish queue (premium, hosted). Coming-soon
          card stays visible when the flag is off so users see it's roadmap, not absent. */}
      {PUBLISHING_ENABLED ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <Zap className="h-3.5 w-3.5" strokeWidth={2} />
              auto-publish &mdash; pro / agency
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
          <div className="relative bg-transparent px-5 py-4">
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
            <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
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
