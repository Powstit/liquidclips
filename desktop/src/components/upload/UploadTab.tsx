import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, Settings2, Upload, Zap } from "lucide-react";
import { PageHeader } from "../primitives";
import { socialGetConnection, type SocialConnectionState } from "../../lib/backend";
import { sidecar, type Project } from "../../lib/sidecar";
import { PUBLISHING_ENABLED } from "../../lib/flags";
import { ScheduleQueue } from "../ScheduleQueue";
import { LocalQueue } from "./LocalQueue";
import { DirectPublishQueue } from "./DirectPublishQueue";
import { CampaignContextStrip } from "../earn/CampaignContextStrip";

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
  onOpenProject,
  onOpenSchedule,
}: {
  /** Settings → Connections is where the user actually links accounts.
   *  We bubble the request up rather than re-implementing it inline. */
  onOpenSettings: () => void;
  /** Route uploaded finished clips into the normal ResultsGrid editor so
   *  they get the same reaction / stack / split / schedule features. */
  onOpenProject: (project: Project) => void;
  /** Jump to the Schedule page → Channels tab, the canonical linked-accounts
   *  surface. Connect-accounts UI no longer lives inline on Upload. */
  onOpenSchedule?: () => void;
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

  return (
    // v0.5.1 — Studio Deck (workspace). Fuchsia top-edge band + faint
    // ambient tint above the existing MainShell backdrop. See
    // docs/RPO_VISUAL_LANGUAGE.md and src/index.css `.deck` utilities.
    <div className="deck deck-workspace flex w-full max-w-[920px] flex-col gap-7 pt-2">
      <PageHeader
        glyph={Upload}
        eyebrow="upload deck"
        title="Schedule & publish"
        subtitle="Everything queued, scheduled, or already live. Per-clip publish lives next to the clip."
        trailing={
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3.5 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
            title="Connect or disconnect social accounts in Settings → Connections"
          >
            <Settings2 className="h-3.5 w-3.5" strokeWidth={2} />
            Manage connections
          </button>
        }
      />

      <CampaignContextStrip />

      {/* Linked-accounts glance — the canonical connect surface now lives in
          Schedule → Channels. We keep the "N linked" status as a useful
          glanceable, and link out with a small pill instead of duplicating
          the connect grid here. */}
      <section className="hud-frame rounded-2xl border border-line bg-paper-warm/30 px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          connected accounts
          <span className="ml-auto font-mono text-[10px] text-text-tertiary">
            {connection ? `${connection.platforms.length} linked` : "—"}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          {authed === false ? (
            <p className="font-mono text-[11px] text-text-tertiary">
              Sign in to view your connected accounts.
            </p>
          ) : (
            <span className="font-sans text-[12px] text-text-secondary">
              Manage linked accounts in Schedule.
            </span>
          )}
          {onOpenSchedule && (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3 py-1.5 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
              title="Open Schedule → Channels to connect or disconnect accounts"
            >
              Connect accounts in Schedule
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
      </section>

      {/* Direct publish — drop a finished clip and ship it without the
          long-form clip-pick pipeline. The drop zone + queue cards live in
          DirectPublishQueue; the modal reuse is per-card via PublishModal
          in publish-now / schedule-one modes. */}
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

      {/* SECONDARY: backend auto-publish queue (premium, hosted).
          When PUBLISHING_ENABLED is off, render a visible coming-soon card
          here instead of silently hiding the section. Users should see that
          the hosted layer is on the roadmap, not absent. */}
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
