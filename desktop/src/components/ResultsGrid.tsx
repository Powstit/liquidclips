import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckCircle2, FolderOpen, Plus, Film } from "lucide-react";
import type { Project, RatioKey } from "../lib/sidecar";
import { ClipPreview } from "./ClipPreview";
import { DripCalendar } from "./DripCalendar";
import { PublishModal, type PublishModalMode } from "./PublishModal";
import { ClipCard as FeedClipCard } from "./clips-feed/ClipCard";
import { ClipsBulkToolbar } from "./clips-feed/ClipsBulkToolbar";
import { ClipsBottomBar } from "./clips-feed/ClipsBottomBar";
import { UpgradeLockCard } from "./UpgradeLockCard";
import { AddClipCard } from "./AddClipCard";
import { YouTubeView } from "./YouTubeView";
import { BountySubmissionCapture } from "./earn/BountySubmissionCapture";
import { BountyWorkspaceHeader } from "./earn/BountyWorkspaceHeader";
import { sidecar, type DripSlot } from "../lib/sidecar";
import { PUBLISHING_ENABLED } from "../lib/flags";
import { backend } from "../lib/backend";
import { useTier, FREE_TIER_VISIBLE_CLIPS } from "../lib/useTier";
import { InfoHint } from "./InfoHint";

type Tab = "clips" | "youtube" | "files";

export function ResultsGrid({
  project,
  onDropAnother,
  onProjectChange,
}: {
  project: Project;
  onDropAnother: () => void;
  onProjectChange: (p: Project) => void;
}) {
  const intent = project.intent ?? "both";
  const defaultTab: Tab = intent === "youtube" ? "youtube" : "clips";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [ratio, setRatio] = useState<RatioKey>("vertical");
  const [dripOpen, setDripOpen] = useState(false);
  const [publishModal, setPublishModal] = useState<{
    mode: PublishModalMode;
    clipIdx: number;
  } | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const tier = useTier();
  const isBounty = !!project.whop_bounty_id;
  const previewClip = previewIdx !== null ? project.clips[previewIdx] : null;
  // Publishing requires a 9:16 render — cut_path alone (horizontal) won't do.
  const firstRenderedClipIdx = project.clips.findIndex((c) => !!c.vertical_path);

  function openPublish(mode: PublishModalMode) {
    if (firstRenderedClipIdx < 0) {
      setActionToast("No rendered clips yet — wait for the pipeline to finish.");
      return;
    }
    setPublishModal({ mode, clipIdx: firstRenderedClipIdx });
  }

  async function onDripConfirm(slots: DripSlot[]) {
    // Pull the license JWT off the keychain. If absent, the user gets a clear
    // pointer to Settings; we never silently swallow this.
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) {
      throw new Error(
        "Sign in to Junior to continue — use the Sign in button in the top bar, then retry."
      );
    }
    await backend.scheduleDripBatch(project.slug, slots, jwt);
    setDripOpen(false);
  }

  return (
    <div className="w-full max-w-[1080px]">
      <BountyWorkspaceHeader project={project} />

      <BountySubmissionCapture project={project} />

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
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
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
        {!PUBLISHING_ENABLED ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-paper-warm px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              beta · coming soon
            </span>
            <span className="font-sans text-[13px] text-text-secondary">
              Auto-publish, schedule &amp; drip are in private beta — for now, export each clip and post it yourself.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => openPublish("publish-now")}
            disabled={firstRenderedClipIdx < 0}
            title={
              firstRenderedClipIdx < 0
                ? "No rendered clips yet"
                : isBounty
                ? "Publish a clip, then paste your Whop submission link to track it"
                : "Publish a clip now"
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-40"
          >
            {isBounty ? "Publish & prepare Whop submission" : "Publish now"}
            {isBounty && (
              <InfoHint text="Junior publishes the clip to your connected platform, then points you to Whop to submit it for the reward. Whop has no public submit API, so the final submit happens on whop.com." />
            )}
          </button>
          <button
            onClick={() => openPublish("schedule-one")}
            disabled={firstRenderedClipIdx < 0}
            className="rounded-full border border-line bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-ink transition-colors hover:border-fuchsia disabled:opacity-40"
          >
            Schedule one
          </button>
          {tier.can("drip_scheduling") ? (
            <button
              onClick={() => setDripOpen(true)}
              disabled={project.clips.length === 0}
              title={project.clips.length === 0 ? "Drop a video first" : "Open drip planner"}
              className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50 disabled:hover:bg-fuchsia-bright disabled:hover:shadow-none"
            >
              Drip across ▾
            </button>
          ) : (
            <button
              onClick={() => openExternal("https://account.jnremployee.com/upgrade").catch(() => undefined)}
              title="Drip-mode is an Autopilot feature — clips dripped across 14 days, optimal timing per platform."
              className="rounded-full border border-fuchsia bg-paper px-4 py-1.5 font-sans text-[13px] font-medium text-fuchsia-deep transition-all hover:bg-fuchsia-soft/40"
            >
              Drip across · Autopilot →
            </button>
          )}
        </div>
        )}
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
                    {tier.tier !== "free" && (
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

      {publishModal && project.clips[publishModal.clipIdx] && (
        <PublishModal
          clip={project.clips[publishModal.clipIdx]}
          clipIdx={publishModal.clipIdx}
          projectSlug={project.slug}
          mode={publishModal.mode}
          onClose={() => setPublishModal(null)}
          onDone={(msg) => {
            setPublishModal(null);
            // For bounty projects, the publish is only half the job — nudge the
            // clipper to finish on Whop, where the actual submission lives.
            const guidance = isBounty
              ? `${msg} — now open the reward on Whop and paste your submission link below to track approval + payout.`
              : msg;
            setActionToast(guidance);
            window.setTimeout(() => setActionToast(null), isBounty ? 12000 : 8000);
          }}
        />
      )}
    </div>
  );
}

function FilesPane({ project }: { project: Project }) {
  return (
    <div className="rounded-2xl border border-line bg-paper-warm/50 p-5 font-mono text-[12px] text-text-secondary">
      <p className="mb-3">Everything Junior made is in:</p>
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
