// ship-lens v0.7.13: Grid + multi-select COMBINED. The Workbench WindowManager mount was a v0.7.5 regression that broke per-clip flow; selection on the grid IS the multi-clip surface.
import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckCircle2, FolderOpen, Plus, Film } from "lucide-react";
import type { Project, RatioKey } from "../lib/sidecar";
import { ClipPreview } from "./ClipPreview";
import { DripCalendar } from "./DripCalendar";
import { PublishModal, type PublishModalMode } from "./PublishModal";
import { ClipCard as FeedClipCard } from "./clips-feed/ClipCard";
import { ClipsBottomBar } from "./clips-feed/ClipsBottomBar";
import { GridMasterToolbar } from "./clips-feed/GridMasterToolbar";
import { BottomCockpit } from "./cockpit/BottomCockpit";
import { UpgradeLockCard } from "./UpgradeLockCard";
import { AddClipCard } from "./AddClipCard";
import { YouTubeView } from "./YouTubeView";
import { BountySubmissionCapture } from "./earn/BountySubmissionCapture";
import { CampaignContextStrip } from "./earn/CampaignContextStrip";
import { BountyWorkspaceHeader } from "./earn/BountyWorkspaceHeader";
import { sidecar, type DripSlot } from "../lib/sidecar";
import { useTier, FREE_TIER_VISIBLE_CLIPS } from "../lib/useTier";
import { useLocalPref } from "../lib/useLocalPref";
import { useMultiSelect } from "../lib/useMultiSelect";

type Tab = "clips" | "youtube" | "files";

export function ResultsGrid({
  project,
  onDropAnother,
  onProjectChange,
  onOpenSettings,
}: {
  project: Project;
  onDropAnother: () => void;
  onProjectChange: (p: Project) => void;
  // Sprint #3 — PublishModal needs a way to route the user to Settings →
  // Connections when they hit publish without a connected Ayrshare profile.
  onOpenSettings?: () => void;
}) {
  const intent = project.intent ?? "both";
  const defaultTab: Tab = intent === "youtube" ? "youtube" : "clips";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [openCaptionsForIdx, setOpenCaptionsForIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  // v0.7.23 — ratio toggle moved into the cockpit Frame module (bulk) and
  // ClipPreview Reaction Studio (per-clip). The grid renders at vertical by
  // default; the setter is no longer wired locally.
  const [ratio] = useState<RatioKey>("vertical");
  const [dripOpen, setDripOpen] = useState(false);
  const [publishModal, setPublishModal] = useState<{
    mode: PublishModalMode;
    clipIdx: number;
  } | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  // Default OFF — kept so ClipsBulkToolbar's preview-sound + preview-motion
  // toggles still wire to localStorage; the workbench tile honours them via
  // the workbench store on a future pass.
  // v0.7.23 — preview-sound + preview-motion setters moved out with
  // ClipsBulkToolbar. The grid still READS the saved prefs so per-card
  // hover behaviour stays consistent; setters return to the cockpit
  // Preferences module on the next pass.
  const [previewSoundOn] = useLocalPref<boolean>("lc:preview_sound", false);
  const [previewMotionOn] = useLocalPref<boolean>("lc:preview_motion", false);
  const isBounty = !!project.whop_bounty_id;
  // v0.7.29 — firstRenderedClipIdx was used by the legacy openPublish helper
  // (TAKE ACTION bar). Cockpit's SchedulePopoverInline gates on clip selection
  // itself, so the helper + this derived state are both retired.
  const tier = useTier();
  // Multi-select state — selection on the grid IS the workbench experience
  // post-v0.7.13. Drives both per-card "selected" rings and the floating
  // GridMasterToolbar fan-out.
  const { selected, isSelected, toggle, selectAll, clear } = useMultiSelect();
  // v0.7.25 — Focused clip: the one the cockpit is currently editing.
  // Defaults to 0 once any clip exists; a plain (non-meta/shift) card click
  // sets it; ESC clears it back to 0. Distinct from multi-select.
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  // Keep focusedIdx clamped if clips get removed beneath it.
  useEffect(() => {
    if (focusedIdx >= project.clips.length && project.clips.length > 0) {
      setFocusedIdx(0);
    }
  }, [project.clips.length, focusedIdx]);

  // Cmd-A → select-all, Esc → clear. Document-level so the chord works
  // anywhere on the page (the grid root is not always focused). Bails when
  // focus is inside an input/textarea/contentEditable so the captions drawer's
  // text fields still get their native Cmd-A / Esc behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        if (project.clips.length === 0) return;
        e.preventDefault();
        selectAll(project.clips.length - 1);
        return;
      }
      if (e.key === "Escape") {
        // ship-lens v0.7.13 F6 — ClipPreview owns Esc semantics when its
        // modal is open. Bail so the modal's own keydown can close itself
        // without us also clearing the grid selection behind it.
        if (previewIdx !== null) return;
        if (selected.size === 0) return;
        e.preventDefault();
        clear();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [project.clips.length, selectAll, clear, selected.size, previewIdx]);

  // v0.7.29 — openPublish helper retired alongside the legacy TAKE ACTION
  // action bar. The cockpit's SchedulePopoverInline owns the Schedule/Publish
  // flow now and emits its own toast on completion.

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

  const previewClip = previewIdx !== null ? project.clips[previewIdx] : null;
  const selectedIdxs = Array.from(selected).sort((a, b) => a - b);

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
                <img
                  src={convertFileSrc(poster)}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
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

      {/* v0.7.29 (Bug 2 of section IG-006 fix pass) — Legacy "TAKE ACTION ·
          Drip across · Publish now · Schedule one" action bar removed.
          Per integration-lens this duplicated the cockpit's primary CTA
          (Schedule / Publish) and the schedule pill, exactly the
          ClipsBulkToolbar pattern we cut before. The cockpit owns all
          per-project publish/schedule actions now. Drip-across-the-week
          feature can return as a ⋮-menu route when needed. */}
      {actionToast && (
        <span className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
          {actionToast}
        </span>
      )}

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
            {/* v0.7.23 — ClipsBulkToolbar (apply-layout-to-all dropdown +
                grid-wide ratio toggle) removed. Per integration-lens those
                belong to the BottomCockpit Frame module now; carrying both
                was parallel UI competing for the same actions. Preview
                motion + sound toggles will return on the cockpit's
                Preferences module in a follow-up. */}
            {/* v0.7.18 — Persistent bottom Cockpit. Always visible; "All N
                clips" when no selection, narrows to the selection when there
                is one. Uses the cockpit-tile language from the demo + the
                full 5-module layout (Channels, Caption, Frame Reaction
                Studio, When, Master). The legacy GridMasterToolbar is kept
                as a fallback import for now; will be deleted in v0.7.20.
                pb-44 below keeps grid clear of the taller cockpit chrome. */}
            <BottomCockpit
              selectedIdxs={selectedIdxs}
              focusedIdx={focusedIdx}
              project={project}
              onProjectChange={onProjectChange}
              onClear={clear}
              onChangeFocus={setFocusedIdx}
              modalOpen={previewIdx !== null}
              onOpenSettings={onOpenSettings}
              onOpenEditor={(clipIdx) => setPreviewIdx(clipIdx)}
              onOpenCaptions={(clipIdx) => {
                setPreviewIdx(clipIdx);
                setOpenCaptionsForIdx(clipIdx);
              }}
            />
            {/* Keep the legacy mount referenced so tsc doesn't flag the
                import as unused while we transition. */}
            {false && <GridMasterToolbar selectedIdxs={[]} project={project} onProjectChange={onProjectChange} onClear={clear} />}
            <div className="grid grid-cols-1 gap-4 pb-44 sm:grid-cols-2 lg:grid-cols-3">
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
                        onOpenCaptions={() => { setPreviewIdx(idx); setOpenCaptionsForIdx(idx); }}
                        previewSoundOn={previewSoundOn}
                        previewMotionOn={previewMotionOn}
                        selected={isSelected(idx)}
                        focused={focusedIdx === idx}
                        onSelectClick={(e) => {
                          // v0.7.25 — Plain click = focus the cockpit on
                          // this clip. Meta/shift = multi-select.
                          // v0.7.27 user-journey-lens fix: focus follows
                          // shift/cmd-click too — the user's MOST RECENT
                          // click is what the Reaction module reflects,
                          // even when the click was a bulk-add chord.
                          if (e.meta || e.shift) {
                            toggle(idx, { meta: e.meta, shift: e.shift });
                            setFocusedIdx(idx);
                          } else {
                            setFocusedIdx(idx);
                            if (selected.size > 0) clear();
                          }
                        }}
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

      {/* Full-screen edit drawer — opens when a card's edit button is
          clicked. Pre-v0.7.5 mount restored byte-for-byte; ClipPreview's API
          (clip/index/slug/totalClips/initialCaptionsOpen) is preserved
          per the "do not touch ClipPreview" constraint. */}
      {previewClip && previewIdx !== null && (
        <ClipPreview
          clip={previewClip}
          index={previewIdx + 1}
          slug={project.slug}
          project={project}
          totalClips={project.clips.length}
          initialCaptionsOpen={openCaptionsForIdx === previewIdx}
          onClose={() => { setPreviewIdx(null); setOpenCaptionsForIdx(null); }}
          onProjectChange={(p) => {
            onProjectChange(p);
            // If the removed clip was the previewed one, close.
            if (previewIdx >= p.clips.length) { setPreviewIdx(null); setOpenCaptionsForIdx(null); }
          }}
          onNavigate={(dir) => {
            const next = previewIdx + dir;
            if (next >= 0 && next < project.clips.length) { setPreviewIdx(next); setOpenCaptionsForIdx(null); }
          }}
          onPublish={(clipIdx) => {
            // Open PublishModal pre-selected to THIS clip (not
            // firstRenderedClipIdx). ClipPreview already gates on
            // clip.vertical_path so we don't need to re-check here.
            setPublishModal({ mode: "publish-now", clipIdx });
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
          onOpenSettings={onOpenSettings}
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
    <div className="relative rounded-2xl bg-transparent p-5 font-mono text-[12px] text-text-secondary">
      <span className="cockpit-tile-corner-tl" aria-hidden />
      <span className="cockpit-tile-corner-tr" aria-hidden />
      <span className="cockpit-tile-corner-bl" aria-hidden />
      <span className="cockpit-tile-corner-br" aria-hidden />
      <p className="mb-3">Everything Liquid Clips made is in:</p>
      <code className="block rounded bg-paper-warm/40 px-3 py-2 text-ink">{project.root}</code>
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
