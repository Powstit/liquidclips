import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckCircle2, FolderOpen, Plus, Film } from "lucide-react";
import type { Project, RatioKey } from "../lib/sidecar";
import { ClipPreview } from "./ClipPreview";
import { DripCalendar } from "./DripCalendar";
import { ClipCard as FeedClipCard } from "./clips-feed/ClipCard";
import { ClipsBulkToolbar } from "./clips-feed/ClipsBulkToolbar";
import { ClipsBottomBar } from "./clips-feed/ClipsBottomBar";
import { UpgradeLockCard } from "./UpgradeLockCard";
import { AddClipCard } from "./AddClipCard";
import { YouTubeView } from "./YouTubeView";
import { BountySubmissionCapture } from "./earn/BountySubmissionCapture";
import { CampaignContextStrip } from "./earn/CampaignContextStrip";
import { BountyWorkspaceHeader } from "./earn/BountyWorkspaceHeader";
import { sidecar, type DripSlot } from "../lib/sidecar";
import { PUBLISHING_ENABLED } from "../lib/flags";
import { useTier, FREE_TIER_VISIBLE_CLIPS } from "../lib/useTier";

type Tab = "clips" | "youtube" | "files";

export function ResultsGrid({
  project,
  onDropAnother,
  onProjectChange,
  onOpenSettings: _onOpenSettings,
}: {
  project: Project;
  onDropAnother: () => void;
  onProjectChange: (p: Project) => void;
  /** Kept for API stability — the v0.6.3 PublishModal route used this. v0.6.4
   *  publish flow lives on the clip card and doesn't need it, but App.tsx
   *  still passes it to keep the upgrade path open. */
  onOpenSettings?: () => void;
}) {
  const intent = project.intent ?? "both";
  const defaultTab: Tab = intent === "youtube" ? "youtube" : "clips";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [ratio, setRatio] = useState<RatioKey>("vertical");
  const [dripOpen, setDripOpen] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const tier = useTier();
  const previewClip = previewIdx !== null ? project.clips[previewIdx] : null;

  async function onDripConfirm(slots: DripSlot[]) {
    // 0.4.28 Drip Helper: write to the LOCAL queue, not the backend Postiz
    // pipeline. The local queue ($CLIPS_HOME/.schedule.json) needs no JWT
    // and no tier gate — every user gets reminded to post at the optimal
    // time, and Liquid Clips assists with copy-caption + open-platform on the
    // Upload tab. Auto-publish via Postiz is a future opt-in toggle, not
    // a default — avoids double-scheduling when both layers exist.
    const items = slots.map((s) => ({
      project_slug: project.slug,
      clip_idx: s.clip_idx,
      clip_title: s.clip_title,
      vertical_path: s.vertical_path,
      platform: s.platform,
      scheduled_for: s.scheduled_for,
      caption: project.clips[s.clip_idx]?.title || s.clip_title,
    }));
    await sidecar.localScheduleAdd(items);
    setActionToast(`Scheduled ${items.length} reminder${items.length === 1 ? "" : "s"} — see them in the Upload tab.`);
    setDripOpen(false);
  }

  return (
    <div className="w-full max-w-[1080px]">
      <BountyWorkspaceHeader project={project} />

      <BountySubmissionCapture project={project} />

      <div className="mb-4">
        <CampaignContextStrip />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {(() => {
            const out = project.stages.ingest?.output as { poster_path?: string | null } | undefined;
            const poster = out?.poster_path;
            return poster ? (
              <div className="aspect-video h-[88px] shrink-0 overflow-hidden rounded-xl border border-line bg-paper-warm">
                <img src={convertFileSrc(poster)} alt="" className="h-full w-full object-cover" />
              </div>
            ) : null;
          })()}
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-soft bg-fuchsia-soft/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2.25} />
              Ready
            </div>
            <h2 className="mt-2 font-display text-[32px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
              {project.source_filename}
            </h2>
            <p className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[12px] text-text-tertiary">
              <Film className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="text-ink tabular-nums">{project.clips.length}</span> {project.clips.length === 1 ? "clip" : "clips"} ready to ship
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              try {
                await openExternal(project.root);
              } catch (e) {
                console.warn("open folder failed:", e);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2.5 font-sans text-[14px] font-medium text-ink transition-colors hover:border-fuchsia"
          >
            <FolderOpen className="h-4 w-4" strokeWidth={2} />
            Open folder
          </button>
          <button
            onClick={onDropAnother}
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Drop another
          </button>
        </div>
      </div>

      {/* Spec §1.5 action bar — Publish now / Schedule one / Drip across ▾ */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-gradient-to-r from-paper-warm/60 via-paper to-paper-warm/40 px-5 py-3.5 shadow-[0_1px_0_rgba(15,15,18,0.02)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          take action
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Drip across ▾ — local, no tier gate (0.4.28). Schedules
              reminders to $CLIPS_HOME/.schedule.json; the Upload tab
              surfaces them with copy-caption + open-platform assist. */}
          <button
            onClick={() => setDripOpen(true)}
            disabled={project.clips.length === 0}
            title={
              project.clips.length === 0
                ? "Drop a video first"
                : "Plan a drip across the next 1–4 weeks. Liquid Clips reminds you to post; you stay in control."
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-50 disabled:hover:bg-fuchsia disabled:hover:shadow-none"
          >
            Drip across ▾
          </button>
          {/* v0.6.4 — Per-clip publish moved ONTO the clip card via
              InlineScheduler (no modal, no separate action bar). The
              project-level bar keeps "Drip across" for local-reminder
              planning and drops the 3 hosted publish CTAs since each
              clip carries its own Schedule button inline now. */}
          {!PUBLISHING_ENABLED && (
            <span className="font-sans text-[12px] text-text-tertiary">
              Auto-publish hosted layer is in private beta — Drip across schedules local reminders you can act on in the Upload tab.
            </span>
          )}
        </div>
        {actionToast && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            {actionToast}
          </span>
        )}
      </div>

      {/* Tab strip — branches by intent so the two journeys don't bleed:
            clips    → no tabs, just clips + Files (single subtle Files link)
            youtube  → no tabs, YouTube view + Files
            both     → Clips · YouTube · Files (YouTube consolidates chapters/desc/titles) */}
      {intent === "both" && (
        <div className="mt-8 flex gap-0.5 border-b border-line font-mono text-[11px] uppercase tracking-[0.14em]">
          {(["clips", "youtube", "files"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative px-4 py-3 transition-colors ${
                tab === t
                  ? "text-ink"
                  : "text-text-tertiary hover:text-ink"
              }`}
            >
              {t}
              {tab === t && (
                <span className="absolute inset-x-3 bottom-[-1px] h-[2px] rounded-full bg-fuchsia" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6">
        {tab === "clips" && intent !== "youtube" && (
          <>
            <ClipsBulkToolbar
              project={project}
              ratio={ratio}
              onRatioChange={setRatio}
              onProjectChange={onProjectChange}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(() => {
                const visibleCount =
                  tier.tier === "free"
                    ? Math.min(FREE_TIER_VISIBLE_CLIPS, project.clips.length)
                    : project.clips.length;
                const hidden = project.clips.length - visibleCount;
                return (
                  <>
                    {project.clips.slice(0, visibleCount).map((clip, idx) => (
                      <FeedClipCard
                        key={`${idx}-${clip.slug}`}
                        clip={clip}
                        index={idx + 1}
                        slug={project.slug}
                        project={project}
                        ratio={ratio}
                        onProjectChange={onProjectChange}
                        onOpenEditor={() => setPreviewIdx(idx)}
                      />
                    ))}
                    {hidden > 0 && (
                      <UpgradeLockCard hiddenCount={hidden} totalClips={project.clips.length} />
                    )}
                    {/* v0.6.11 — Hide AddClipCard for imported projects. The
                        "carve a new clip from the source" affordance only
                        makes sense when there's a single coherent source
                        video; for an Import-lane pack of finished clips,
                        there's no single source to cut from. */}
                    {tier.tier !== "free" && !project.clips.every((c) => c.imported) && (
                      <AddClipCard
                        project={project}
                        onProjectChange={onProjectChange}
                      />
                    )}
                  </>
                );
              })()}
            </div>
            <ClipsBottomBar project={project} />
          </>
        )}
        {tab === "youtube" && intent !== "clips" && (
          <YouTubeView project={project} />
        )}
        {tab === "files" && <FilesPane project={project} />}
      </div>

      {/* Single bottom link for the clips-only and youtube-only intents — they
          have no tab strip so we surface Files as a quiet link at the foot. */}
      {intent !== "both" && (
        <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
          <button
            onClick={() => setTab(tab === "files" ? defaultTab : "files")}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
          >
            {tab === "files" ? "← back to results" : "Show files →"}
          </button>
        </div>
      )}

      {previewClip && previewIdx !== null && (
        <ClipPreview
          clip={previewClip}
          index={previewIdx + 1}
          slug={project.slug}
          project={project}
          totalClips={project.clips.length}
          onClose={() => setPreviewIdx(null)}
          onProjectChange={(p) => {
            onProjectChange(p);
            // If the removed clip was the previewed one, close.
            if (previewIdx >= p.clips.length) setPreviewIdx(null);
          }}
          onNavigate={(dir) => {
            const next = previewIdx + dir;
            if (next >= 0 && next < project.clips.length) setPreviewIdx(next);
          }}
        />
      )}

      {dripOpen && (
        <DripCalendar
          project={project}
          onClose={() => setDripOpen(false)}
          onConfirm={onDripConfirm}
        />
      )}

      {/* v0.6.4 — PublishModal mount retired from this surface. Per-clip
          publish state is now carried by InlineScheduler INSIDE each
          ClipCard, so the project-level modal is duplicative here. The
          PublishModal component is still mounted from UploadTab's
          DirectPublishQueue for the finished-MP4-from-disk path. */}
    </div>
  );
}

function FilesPane({ project }: { project: Project }) {
  return (
    <div className="rounded-2xl border border-line bg-paper-warm/50 p-5 font-mono text-[12px] text-text-secondary">
      <p className="mb-3">Everything Liquid Clips made is in:</p>
      <code className="block rounded bg-paper px-3 py-2 text-ink">{project.root}</code>
      <ul className="mt-4 space-y-1 text-[11px]">
        <li>source/ — original file (symlinked)</li>
        <li>audio/audio.wav — extracted 16kHz mono</li>
        <li>transcript/transcript.json + .srt — word-level timestamps</li>
        <li>clips/ — cut MP4s plus rendered vertical clips/captions when available</li>
        <li>metadata/ — chapters, description, titles, tweet thread, linkedin</li>
        <li>project.json — pipeline state</li>
      </ul>
    </div>
  );
}
