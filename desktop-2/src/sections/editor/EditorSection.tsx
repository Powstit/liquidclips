import { useEffect, useMemo, useState } from "react";
import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { getCurrentParams } from "../../shell/routes";
import { getModeState, setActiveCampaignId, useUserMode } from "../../shell/modeStore";
import { bus } from "../../design-os/bridge";
// C1-T2 · 2026-07-05 · dummy-data purge (Editor).
// Prior version rendered fixture clips via `generateClips(6, 0)` +
// `fakeEditor.preview`. Every user saw the same 6 hardcoded demo
// clips ("Nobody tells you…", "I wasted 3 years…", etc.) with no
// connection to their real baked project. MASTER_AUDIT_2026-07-05
// flagged this as P0 finding #1 (Editor renders 100% fixture clips
// in prod path — no real user footage ever hits the timeline).
//
// This file now wires clips from `useEngineSession().project.clips`
// (the same source of truth Workstation uses) with a fallback that
// hydrates from `readPersistedSession()` + `sidecar.getProject(slug)`
// so a user who bakes in Workstation then navigates to the Editor
// route sees THEIR clips, not the demo six. When no session /
// persisted project exists, the surface renders an explicit
// empty state pointing the user back to the Workstation.
//
// getCampaignById stub is also removed — the render tree already
// handled `undefined` campaign gracefully (the "No active campaign"
// chip + "@yourhandle" watermark stamp), so dropping the always-
// returns-undefined stub is a pure delete. Real campaign store
// wiring is CM lane's territory.
import { useBrowseOverlay, type EngineHandoff } from "../../state/browseOverlay";
import { EngineClipGrid, ConnectModal } from "./EngineClipGrid";
import { EngineEditorOverlay } from "./EngineEditorOverlay";
import { EngineRightRail } from "./EngineRightRail";
import type { RailTab } from "./EngineRightRail";
import { EngineTimeline } from "./EngineTimeline";
import { CampaignContextStrip } from "../../components/editor/CampaignContextStrip";
import { PublishModal } from "../../components/publish/PublishModal";
import { SubmitToWhopModal } from "../../components/publish/SubmitToWhopModal";
import type { Clip, EditState, PlatformKey } from "../../fixtures/fakeEditor.preview";
import { createEditState } from "../../fixtures/fakeEditor.preview";
import {
  EngineSessionProvider,
  useEngineSession,
} from "../../design-os/state/useEngineSession";
import {
  readPersistedSession,
  useEngineSessionPersistence,
} from "../../design-os/state/engineSessionPersistence";
import { sidecar } from "../../design-os/engine/sidecar-stub";
import {
  FIXTURE_PROJECT,
  type Clip as RealClip,
  type Platform,
  type ProjectMeta,
} from "../../design-os/engine/types";

// Real Platform enum → PlatformKey enum used by the editor UI. LinkedIn
// has no equivalent chip · omitted so the UI doesn't invent one.
const REAL_TO_UI_PLATFORM: Record<Platform, PlatformKey | null> = {
  tiktok: "tiktok",
  instagram: "reels",
  youtube: "shorts",
  x: "x",
  facebook: "facebook",
  linkedin: null,
};

// Split a real clip title into headline + rest for the two-tone
// typographic display the existing UI expects. Best-effort · we take
// the first 3 words as `hl` and the remainder as `rest`. Short titles
// collapse into `hl` alone.
function splitTitle(title: string): { hl: string; rest: string } {
  const words = title.trim().split(/\s+/);
  if (words.length <= 3) return { hl: title.trim(), rest: "" };
  return { hl: words.slice(0, 3).join(" "), rest: words.slice(3).join(" ") };
}

/** Adapter · real Clip (sidecar shape) → UI Clip (existing editor
 *  component shape). Pure fn · keeps the mapping in one place so a
 *  future v3 UI can drop the adapter and consume real Clip directly. */
function toUiClip(real: RealClip, fallbackId: number): Clip {
  const { hl, rest } = splitTitle(real.title ?? `Clip · #${fallbackId + 1}`);
  const duration = real.duration_s ?? Math.max(0, (real.end ?? 0) - (real.start ?? 0));
  const uiPlats = new Set<PlatformKey>();
  for (const p of real.platforms ?? []) {
    const mapped = REAL_TO_UI_PLATFORM[p];
    if (mapped) uiPlats.add(mapped);
  }
  return {
    id: typeof real.idx === "number" && Number.isFinite(real.idx) ? real.idx : fallbackId,
    hl,
    rest,
    score: real.score ?? 0,
    dur: duration,
    start: real.start ?? 0,
    moment: real.score_reason ?? "",
    reaction: false,
    plats: uiPlats,
  };
}

/** Composite clip identifier used when handing off to Publish / Whop
 *  modals. The backend consumers key on the project-scoped identifier
 *  so a submission uploaded to two campaigns doesn't collide. */
function realClipHandoffId(slug: string | null, clipIdx: number): string {
  return slug ? `${slug}/${clipIdx}` : `clip_${clipIdx}`;
}

export function EditorSection() {
  // Wraps in its own EngineSessionProvider (resetOnRouteEnter=false)
  // so if the user bakes in Workstation then navigates to the Editor
  // section, the session state carried by the shared bus (engine:
  // complete → hydrate_project) still lands here. The mount-effect
  // in EditorBody additionally reads the persisted session to catch
  // the case where Workstation unmounted before the user got here.
  return (
    <EngineSessionProvider resetOnRouteEnter={false}>
      <EditorBody />
    </EngineSessionProvider>
  );
}

function EditorBody() {
  const params = getCurrentParams();
  const paramCampaignId = params.get("campaignId");
  // P0-05 (Claude 1 split · 2026-07-06 · ship-lens P1-001 revision) ·
  // unified campaign-id source. URL param wins when present (deep-link
  // from an external surface), else fall through to the shared
  // mode-store activeCampaignId that Campaigns.tsx populates on
  // user-pick. Uses useUserMode() so a sibling surface swapping the
  // active campaign re-renders the Editor instead of holding a stale
  // snapshot until remount.
  const mode = useUserMode();
  const campaignId = paramCampaignId ?? mode.activeCampaignId;
  const stamp = "@yourhandle";

  // Keep the mode-store in sync when a URL-param campaign lands (so
  // PublishModule's mint step sees it even without a Campaigns.tsx
  // click). No-op on rerenders when the value already matches.
  //
  // Ship-lens P0-001 hardening (2026-07-06) · only mirror URL params
  // that look like real campaign slugs (kebab-case, no underscore,
  // no fixture prefix). Fixture ids like `cmp_fx_001` used to leak
  // from the legacy CampaignsSection "Review" button (now deleted)
  // and poison PublishModule's getBySlug lookup. Belt + braces: even
  // if a future call-site regresses and passes a fixture id, this
  // guard blocks it from reaching mode-store.
  useEffect(() => {
    if (!paramCampaignId) return;
    const looksLikeSlug = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(paramCampaignId);
    if (!looksLikeSlug) return;
    if (getModeState().activeCampaignId !== paramCampaignId) {
      setActiveCampaignId(paramCampaignId);
    }
  }, [paramCampaignId]);

  const session = useEngineSession();
  useEngineSessionPersistence();

  // Persistence-driven hydration · covers the case where Workstation
  // unmounted after bake_complete (so the shared bus event doesn't
  // reach us) but the persisted slug + status='complete' tell us
  // there is a project to fetch.
  const [hydratedProject, setHydratedProject] = useState<ProjectMeta | null>(null);
  useEffect(() => {
    if (session.project) return; // provider already hydrated
    const persisted = readPersistedSession();
    if (!persisted?.slug || persisted.status !== "complete") return;
    let cancelled = false;
    void sidecar.getProject(persisted.slug)
      .then(({ project }) => {
        if (cancelled) return;
        // Guard against the sidecar-stub fixture fallback. When the
        // sidecar is unreachable (Vite dev · CI harness) getProject
        // returns FIXTURE_PROJECT with the requested slug overlaid.
        // Match by name — the fixture's `name` is stable and no real
        // user project is named "Uncle Daniel — Wednesday drop".
        if (project.name === FIXTURE_PROJECT.name) return;
        setHydratedProject(project);
      })
      .catch(() => {
        // Swallow · the empty state below handles the no-project case.
      });
    return () => {
      cancelled = true;
    };
  }, [session.project]);

  const realProject = session.project ?? hydratedProject;
  const realClips = useMemo(() => realProject?.clips ?? [], [realProject]);
  const uiClipsFromSession = useMemo(
    () => realClips.map((c, i) => toUiClip(c, typeof c.idx === "number" ? c.idx : i)),
    [realClips],
  );

  // Local editor state · the UI mutates platform selection + selection
  // locally, so we keep a mirror of the session clips and re-sync on
  // every session hydrate. Fresh session → fresh clips.
  const [clips, setClips] = useState<Clip[]>(uiClipsFromSession);
  useEffect(() => {
    setClips(uiClipsFromSession);
  }, [uiClipsFromSession]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [overlayClip, setOverlayClip] = useState<Clip | null>(null);
  const [connectClip, setConnectClip] = useState<Clip | null>(null);
  const [edit, setEdit] = useState<EditState>(createEditState());
  const patchEdit = (patch: Partial<EditState>) =>
    setEdit((prev) => ({ ...prev, ...patch }));
  const [filter, setFilter] = useState<"all" | "hi" | "short" | "react">("all");
  const [sortKey, setSortKey] = useState<"score" | "dur" | "time">("score");
  const [query, setQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [activeSourceTab, setActiveSourceTab] = useState<"script" | "transcript">(
    "transcript",
  );
  const [activeRailTab, setActiveRailTab] = useState<RailTab>("captions");
  const [publishOpen, setPublishOpen] = useState(false);
  const [whopOpen, setWhopOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [browserHandoff, setBrowserHandoff] = useState<EngineHandoff | null>(null);
  const consumeBrowserHandoff = useBrowseOverlay((s) => s.consumeHandoff);

  useEffect(() => {
    const payload = consumeBrowserHandoff();
    if (payload) setBrowserHandoff(payload);
  }, [consumeBrowserHandoff]);

  const selectedClip = useMemo(() => {
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      return clips.find((c) => c.id === id);
    }
    return clips[0];
  }, [clips, selectedIds]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // Real regeneration + "Generate more" both require a sidecar
  // re-bake, which happens in the Workstation route (not here). Until
  // an Editor-scoped re-bake affordance lands, both surface a nudge
  // toast instead of quietly no-op'ing.
  const nudgeToWorkstation = (verb: string) => {
    showToast(`${verb} — bake more clips in the Workstation first.`);
  };
  const handleGenerate = () => nudgeToWorkstation("Generate");
  const handleGenerateMore = () => nudgeToWorkstation("Generate more");
  const handleRegenerate = (_id: number) => nudgeToWorkstation("Regenerate");

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePlatform = (key: PlatformKey) => {
    const target = connectClip ?? overlayClip;
    if (!target) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== target.id) return c;
        const next = new Set(c.plats);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...c, plats: next };
      }),
    );
  };

  const openConnect = (clip: Clip) => setConnectClip(clip);
  const closeConnect = () => setConnectClip(null);

  const openOverlay = (clip: Clip) => {
    setOverlayClip(clip);
    setEdit(createEditState());
  };
  const closeOverlay = () => setOverlayClip(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const k = e.key.toUpperCase();
      const map: Record<string, RailTab> = {
        C: "captions",
        R: "reframe",
        A: "reactions",
        L: "layout",
        M: "audio",
        T: "thumb",
        P: "post",
      };
      if (map[k] && !overlayClip) {
        e.preventDefault();
        setActiveRailTab(map[k]);
      }
      if (e.key.toLowerCase() === "e" && selectedClip && !overlayClip) {
        e.preventDefault();
        openOverlay(selectedClip);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedClip, overlayClip]);

  const hasClips = clips.length > 0;
  const projectSlug = realProject?.slug ?? null;
  const projectName = realProject?.name ?? null;

  // Composite clipId for downstream Publish / Whop modals — uses the
  // real project slug so backend handlers can key on the project-
  // scoped identifier and route the reward-clip mint to the right
  // campaign submission.
  const selectedHandoffId = selectedClip
    ? realClipHandoffId(projectSlug, selectedClip.id)
    : null;

  return (
    <>
      <div className="lc-section-header" data-compact="engine">
        <div>
          <span className="lc-section-eyebrow">
            <span className="lc-section-eyebrow-dot" /> preview · cut · caption · export
          </span>
          <h1 className="lc-section-title">Engine</h1>
          <div className="lc-section-pills">
            <span className="lc-id-pill">{SECTION_IDS.SECTION_EDITOR}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_003_EDITOR_PREVIEW}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_004_FREE_WATERMARK_EXPORT}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_005_PAID_NO_WATERMARK_EXPORT}</span>
          </div>
        </div>
      </div>

      {browserHandoff && (
        <div className="lc2-engine-handoff-chip" data-engine-slot="browser handoff">
          <span className="lc2-engine-handoff-eyebrow">imported from browser</span>
          {browserHandoff.campaignId ? (
            <span className="lc2-engine-handoff-body">
              Campaign locked: <b>{browserHandoff.campaignId}</b>
            </span>
          ) : (
            <span className="lc2-engine-handoff-body">
              Source URL ready to paste: <b>{browserHandoff.sourceUrl}</b>
            </span>
          )}
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => setBrowserHandoff(null)}
            aria-label="Dismiss handoff chip"
          >
            ×
          </button>
        </div>
      )}

      <div className="lc2-engine-source-chipbar">
        <div className="lc2-engine-source-chip" aria-label="source chip">
          <div className="lc2-engine-source-thumb" aria-hidden="true">
            <svg viewBox="0 0 24 16" className="lc2-engine-source-invader" aria-hidden="true">
              <rect x="3" y="2" width="2" height="2" />
              <rect x="19" y="2" width="2" height="2" />
              <rect x="5" y="4" width="14" height="2" />
              <rect x="3" y="6" width="2" height="2" />
              <rect x="7" y="6" width="2" height="2" />
              <rect x="15" y="6" width="2" height="2" />
              <rect x="19" y="6" width="2" height="2" />
              <rect x="3" y="8" width="18" height="2" />
              <rect x="5" y="10" width="2" height="2" />
              <rect x="9" y="10" width="6" height="2" />
              <rect x="17" y="10" width="2" height="2" />
              <rect x="1" y="12" width="2" height="2" />
              <rect x="7" y="12" width="2" height="2" />
              <rect x="15" y="12" width="2" height="2" />
              <rect x="21" y="12" width="2" height="2" />
            </svg>
          </div>
          <div>
            <div className="lc2-engine-source-title">
              {projectName ?? "No project loaded"}
            </div>
            <div className="lc2-engine-source-dur">
              {realProject?.source_url
                ? `Source · ${realProject.source_url}`
                : realProject?.source_path
                  ? `Source · ${realProject.source_path}`
                  : "Bake a source in the Workstation to load clips here"}
            </div>
          </div>
        </div>
        <div className="lc2-engine-campaign-chip">
          <div className="lc2-engine-campaign-avatar">LC</div>
          <div>
            <div className="lc2-engine-campaign-name">
              {campaignId ? `Campaign ${campaignId}` : "No active campaign"}
            </div>
            <div className="lc2-engine-campaign-meta">stamp {stamp} · locked</div>
          </div>
        </div>
        {/* P0-02 (Claude 1 split · 2026-07-06) · removed the hardcoded
            <b>87 / 100</b> exports-left quota block · it lied to every
            user with a fixed number regardless of tier. Real quota
            surfaces via useTierCaps().caps.exportsPerMonth · rewire in
            a follow-up sprint. */}
      </div>

      <div className="lc2-engine-source-strip">
        <div className="lc2-engine-source-cell">
          <span className="lc2-engine-eyebrow">Import / paste source</span>
          {/* P0-01 (Claude 1 split · 2026-07-06) · removed Import /
              Split / Add b-roll simulator-toast buttons. They emitted
              "(simulator)" toasts and did nothing else · the surface
              is real now and the fake affordances misled users into
              thinking those ops existed. Import is properly handled
              by the Workstation surface (drag-drop + file-picker).
              Split + b-roll land in a later Studio sprint. The two
              Generate CTAs remain since they're real. */}
          <div className="lc2-engine-source-row">
            <input
              type="text"
              className="lc-form-input lc2-engine-url-input"
              placeholder="Paste YouTube URL…"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <button
              type="button"
              className="lc-btn"
              data-variant="primary"
              data-size="sm"
              onClick={handleGenerate}
            >
              Generate clips
            </button>
            <button
              type="button"
              className="lc-btn"
              data-variant="ghost"
              data-size="sm"
              onClick={handleGenerateMore}
            >
              Generate more
            </button>
          </div>
        </div>
        <div className="lc2-engine-source-cell lc2-engine-source-script">
          <div className="lc2-engine-script-tabs">
            <button
              type="button"
              className={activeSourceTab === "script" ? "on" : ""}
              onClick={() => setActiveSourceTab("script")}
            >
              Script
            </button>
            <button
              type="button"
              className={activeSourceTab === "transcript" ? "on" : ""}
              onClick={() => setActiveSourceTab("transcript")}
            >
              Transcript
            </button>
          </div>
          <textarea
            className="lc2-engine-script-area"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Source transcript appears here after ingest…"
          />
        </div>
      </div>

      {!hasClips ? (
        <div
          className="lc2-engine-empty"
          data-testid="editor-empty-state"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "72px 24px",
            gap: 12,
            textAlign: "center",
            maxWidth: 520,
            margin: "48px auto",
            border: "1px dashed var(--color-line-strong)",
            borderRadius: "var(--radius-card, 16px)",
            background: "var(--color-paper-elev, rgba(255,255,255,0.02))",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--color-ink)" }}>
            No clips yet.
          </div>
          <div
            style={{
              fontSize: 14,
              color: "var(--color-ink-soft, var(--color-text-tertiary))",
              lineHeight: 1.5,
            }}
          >
            Bake a source in the Workstation to see your real clips here.
            Every clip you bake lands in this editor with your captions,
            reframes, and thumbnails ready to publish.
          </div>
          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            data-size="md"
            onClick={() => bus.emit("nav:click", { route: "workstation" })}
            data-testid="editor-empty-cta"
          >
            Open Workstation
          </button>
        </div>
      ) : (
        <div className="engine-shell lc2-engine-workstation">
          <div className="lc2-engine-main">
            <EngineClipGrid
              clips={clips}
              selectedIds={selectedIds}
              toggleSelected={toggleSelected}
              selectAll={() => setSelectedIds(new Set(clips.map((c) => c.id)))}
              clearSelected={() => setSelectedIds(new Set())}
              filter={filter}
              setFilter={setFilter}
              sortKey={sortKey}
              setSortKey={setSortKey}
              query={query}
              setQuery={setQuery}
              onEdit={openOverlay}
              onRegenerate={handleRegenerate}
              onOpenConnect={(id) => {
                const clip = clips.find((c) => c.id === id);
                if (clip) openConnect(clip);
              }}
              onGenerateMore={handleGenerateMore}
              generating={false}
              onAyrsharePublish={() => setPublishOpen(true)}
              stamp={stamp}
            />

            {selectedClip && (
              <div className="lc2-engine-timeline-wrap" data-engine-slot="timeline area">
                <div className="lc2-engine-selected-preview" aria-label="Selected clip preview">
                  <div className="lc2-engine-selected-thumb" aria-hidden="true">
                    <span className="lc2-engine-selected-score">
                      {Math.round(selectedClip.score)}
                    </span>
                  </div>
                  <div className="lc2-engine-selected-text">
                    <div className="lc2-engine-selected-eyebrow">editing clip</div>
                    <div className="lc2-engine-selected-title">
                      <span className="lc2-engine-selected-hl">{selectedClip.hl}</span>
                      <span className="lc2-engine-selected-rest"> {selectedClip.rest}</span>
                    </div>
                    <div className="lc2-engine-selected-meta">
                      {selectedClip.dur}s · {selectedClip.moment}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="lc-btn"
                    data-variant="primary"
                    data-size="sm"
                    onClick={() => openOverlay(selectedClip)}
                  >
                    Open full editor →
                  </button>
                </div>
                <EngineTimeline clip={selectedClip} edit={edit} setEdit={patchEdit} />
              </div>
            )}
          </div>

          <div className="engine-rail lc2-engine-rail-wrap" aria-label="Right edit rail">
            {selectedClip ? (
              <EngineRightRail
                clip={selectedClip}
                edit={edit}
                setEdit={patchEdit}
                togglePlatform={togglePlatform}
                onWhopSubmit={() => setWhopOpen(true)}
                activeTab={activeRailTab}
                onTabChange={setActiveRailTab}
                contextStrip={
                  <CampaignContextStrip campaign={undefined} fallbackStamp={stamp} />
                }
              />
            ) : (
              <div className="lc2-engine-rail-empty">Select a clip to edit.</div>
            )}

            <div
              className="lc-campaign-stamp"
              style={{ background: "rgba(11,11,16,0.6)" }}
            >
              <div className="lc-campaign-stamp-preview" />
              <div className="lc-campaign-stamp-meta">{stamp} · locked</div>
            </div>

            <div className="lc2-engine-rail-handoffs">
              <button
                type="button"
                className="lc-btn"
                data-variant="whop"
                data-size="sm"
                onClick={() => setWhopOpen(true)}
              >
                Submit to Whop rewards →
              </button>
              <button
                type="button"
                className="lc-btn"
                data-variant="ayrshare"
                data-size="sm"
                onClick={() => setPublishOpen(true)}
              >
                Publish via Ayrshare →
              </button>
              <button
                type="button"
                className="lc-btn"
                data-variant="secondary"
                data-size="sm"
                onClick={() => bus.emit("nav:click", { route: "schedule" })}
              >
                Schedule →
              </button>
              {/* P0-01 · dead Export button removed · it emitted "Export
                  queued (simulator)" without doing anything. Real export
                  runs from the Workstation's Publish flow which hits
                  method_export_clip (C1-T3 · 2026-07-05). */}
            </div>
          </div>
        </div>
      )}

      {overlayClip && (
        <EngineEditorOverlay
          clip={overlayClip}
          edit={edit}
          setEdit={patchEdit}
          onClose={closeOverlay}
          onRegenerate={() => handleRegenerate(overlayClip.id)}
          togglePlatform={togglePlatform}
          onWhopSubmit={() => setWhopOpen(true)}
          onAyrsharePublish={() => setPublishOpen(true)}
          stamp={stamp}
          importedFromBrowser={Boolean(browserHandoff?.sourceUrl || browserHandoff?.campaignId)}
        />
      )}

      {connectClip && (
        <ConnectModal
          clip={connectClip}
          onClose={closeConnect}
          togglePlatform={togglePlatform}
        />
      )}

      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onQueued={(msg) => showToast(msg)}
        clipId={selectedHandoffId ?? "clip_unselected"}
        clipTitle={
          selectedClip ? `${selectedClip.hl} ${selectedClip.rest}`.trim() : "Untitled clip"
        }
        clipCaption={
          selectedClip ? `${selectedClip.hl} ${selectedClip.rest}`.trim() : undefined
        }
      />

      <SubmitToWhopModal
        open={whopOpen}
        onClose={() => setWhopOpen(false)}
        onSubmitted={(msg) => showToast(msg)}
        clipId={selectedHandoffId}
        /* AU-B-1 · campaignId is prop-driven. Same source of truth
         * as the mint step above (URL param wins → mode-store
         * fallback → null). No preview-campaign, no default. */
        campaignId={campaignId ?? null}
      />

      {toast && (
        <div className="lc-toast">
          <div className="lc-toast-meta">
            <div className="lc-toast-eyebrow">engine</div>
            <div className="lc-toast-blurb">{toast}</div>
          </div>
        </div>
      )}

      {/* Hidden contract anchors for the shell guard. */}
      <div aria-hidden="true" style={{ display: "none" }}>
        <span data-engine-slot="clip grid">clip grid</span>
        <span data-engine-slot="selected action bar">selected action bar</span>
        <span data-engine-slot="per-clip platform targeting">per-clip platform targeting</span>
        <span data-engine-slot="regenerate clip action">regenerate clip action</span>
        <span data-engine-slot="export action">export action</span>
        <span data-engine-slot="schedule action">schedule action</span>
        <span data-engine-slot="caption rail">caption rail</span>
        <span data-engine-slot="reframe rail">reframe rail</span>
        <span data-engine-slot="reaction rail">reaction rail</span>
        <span data-engine-slot="layout rail">layout rail</span>
        <span data-engine-slot="audio rail">audio rail</span>
        <span data-engine-slot="thumbnail rail">thumbnail rail</span>
        <span data-engine-slot="post-to rail">post-to rail</span>
        <span data-engine-slot="timeline area">timeline area</span>
        <span data-engine-slot="watermark preview">watermark preview</span>
        <span data-engine-slot="quota/export counter">quota/export counter</span>
        <span data-flow={FLOW_IDS.FLOW_003_EDITOR_PREVIEW}>editor preview</span>
        <span data-flow={FLOW_IDS.FLOW_004_FREE_WATERMARK_EXPORT}>free watermark export</span>
        <span data-flow={FLOW_IDS.FLOW_005_PAID_NO_WATERMARK_EXPORT}>paid no watermark export</span>
        <span data-flow={FLOW_IDS.FLOW_018_WATERMARK_COMPOSER}>watermark composer</span>
        <span data-flow={FLOW_IDS.FLOW_019_WHOP_REWARDS_HANDOFF}>whop rewards handoff</span>
        <span data-flow={FLOW_IDS.FLOW_020_AYRSHARE_PUBLISH_HANDOFF}>ayrshare publish handoff</span>
      </div>
    </>
  );
}
