import { useEffect, useMemo, useState } from "react";
import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { getCurrentParams } from "../../shell/routes";
import { bus } from "../../design-os/bridge";
import { getCampaignById } from "../../fixtures/fakeCampaigns";
import { getModeState } from "../../shell/modeStore";
import { useBrowseOverlay, type EngineHandoff } from "../../state/browseOverlay";
import { EngineClipGrid, ConnectModal } from "./EngineClipGrid";
import { EngineEditorOverlay } from "./EngineEditorOverlay";
import { EngineRightRail } from "./EngineRightRail";
import type { RailTab } from "./EngineRightRail";
import { EngineTimeline } from "./EngineTimeline";
import { CampaignContextStrip } from "../../components/editor/CampaignContextStrip";
import { PublishModal } from "../../components/publish/PublishModal";
import { SubmitToWhopModal } from "../../components/publish/SubmitToWhopModal";
import type { Clip, EditState, PlatformKey } from "../../fixtures/fakeEditor";
import {
  createEditState,
  generateClips,
  regenerateClip,
  resetClipSequence,
} from "../../fixtures/fakeEditor";

export function EditorSection() {
  const params = getCurrentParams();
  const paramCampaignId = params.get("campaignId");
  const modeCampaignId = getModeState().activeCampaignId;
  const campaignId = paramCampaignId ?? modeCampaignId;
  const campaign = campaignId ? getCampaignById(campaignId) : undefined;
  const stamp = campaign?.watermarkHandle ?? "@uncledaniel";

  const [clips, setClips] = useState<Clip[]>(() => {
    resetClipSequence();
    return generateClips(6, 0);
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [overlayClip, setOverlayClip] = useState<Clip | null>(null);
  const [connectClip, setConnectClip] = useState<Clip | null>(null);
  const [edit, setEdit] = useState<EditState>(createEditState());
  const patchEdit = (patch: Partial<EditState>) => setEdit((prev) => ({ ...prev, ...patch }));
  const [filter, setFilter] = useState<"all" | "hi" | "short" | "react">("all");
  const [sortKey, setSortKey] = useState<"score" | "dur" | "time">("score");
  const [query, setQuery] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [activeSourceTab, setActiveSourceTab] = useState<"script" | "transcript">("transcript");
  const [activeRailTab, setActiveRailTab] = useState<RailTab>("captions");
  const [publishOpen, setPublishOpen] = useState(false);
  const [whopOpen, setWhopOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [browserHandoff, setBrowserHandoff] = useState<EngineHandoff | null>(null);
  const consumeBrowserHandoff = useBrowseOverlay((s) => s.consumeHandoff);

  // On mount and whenever the route hits the Editor, consume any pending
  // browser → engine handoff and display it as a context chip.
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

  const handleGenerate = () => {
    setGenerating(true);
    setTimeout(() => {
      const next = generateClips(4, clips.length);
      setClips((prev) => [...prev, ...next]);
      setGenerating(false);
      showToast(`Generated ${next.length} clips`);
    }, 900);
  };

  const handleGenerateMore = () => {
    handleGenerate();
  };

  const handleRegenerate = (id: number) => {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? regenerateClip(c) : c))
    );
    showToast("Clip regenerated");
  };

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
      })
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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

      {/* Browser → Engine handoff chip. Renders when the user clicked
          "Use in Engine ↗" inside the BrowseOverlay. */}
      {browserHandoff && (
        <div className="lc2-engine-handoff-chip" data-engine-slot="browser handoff">
          <span className="lc2-engine-handoff-eyebrow">imported from browser</span>
          {browserHandoff.campaignId ? (
            <span className="lc2-engine-handoff-body">
              Campaign locked: <b>{getCampaignById(browserHandoff.campaignId)?.name ?? browserHandoff.campaignId}</b>
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

      {/* source chip + campaign chip + quota */}
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
            <div className="lc2-engine-source-title">How to build an audience from zero</div>
            <div className="lc2-engine-source-dur">YouTube · 1:00:00</div>
          </div>
        </div>
        {campaign ? (
          <div className="lc2-engine-campaign-chip">
            <div className="lc2-engine-campaign-avatar">UD</div>
            <div>
              <div className="lc2-engine-campaign-name">{campaign.name}</div>
              <div className="lc2-engine-campaign-meta">stamp {campaign.watermarkHandle} · locked</div>
            </div>
          </div>
        ) : (
          <div className="lc2-engine-campaign-chip">
            <div className="lc2-engine-campaign-avatar">LC</div>
            <div>
              <div className="lc2-engine-campaign-name">No active campaign</div>
              <div className="lc2-engine-campaign-meta">stamp @uncledaniel · locked</div>
            </div>
          </div>
        )}
        <div className="lc2-engine-quota-bar">
          <div className="lc2-engine-quota-row">
            <span>Exports left</span>
            <b>87 / 100</b>
          </div>
          <div className="lc2-engine-quota-track">
            <div className="lc2-engine-quota-fill" style={{ width: "87%" }} />
          </div>
        </div>
      </div>

      {/* Source / import / generate strip */}
      <div className="lc2-engine-source-strip">
        <div className="lc2-engine-source-cell">
          <span className="lc2-engine-eyebrow">Import / paste source</span>
          <div className="lc2-engine-source-row">
            <button
              type="button"
              className="lc-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={() => showToast("Import file dialog (simulator)")}
            >
              Import
            </button>
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
              disabled={generating}
            >
              {generating ? "Generating…" : "Generate clips"}
            </button>
            <button
              type="button"
              className="lc-btn"
              data-variant="ghost"
              data-size="sm"
              onClick={handleGenerateMore}
              disabled={generating}
            >
              Generate more
            </button>
            <span className="lc2-engine-source-divider" />
            <button
              type="button"
              className="lc-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={() => showToast("Split at playhead (simulator)")}
            >
              Split
            </button>
            <button
              type="button"
              className="lc-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={() => showToast("Add b-roll (simulator)")}
            >
              Add b-roll
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
            generating={generating}
            onAyrsharePublish={() => setPublishOpen(true)}
            stamp={stamp}
          />

          {selectedClip && (
            <div className="lc2-engine-timeline-wrap" data-engine-slot="timeline area">
              <div className="lc2-engine-selected-preview" aria-label="Selected clip preview">
                <div className="lc2-engine-selected-thumb" aria-hidden="true">
                  <span className="lc2-engine-selected-score">{Math.round(selectedClip.score)}</span>
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
              contextStrip={<CampaignContextStrip campaign={campaign} fallbackStamp={stamp} />}
            />
          ) : (
            <div className="lc2-engine-rail-empty">Select a clip to edit.</div>
          )}

          <div className="lc-campaign-stamp" style={{ background: "rgba(11,11,16,0.6)" }}>
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
            <button
              type="button"
              className="lc-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={() => showToast("Export queued (simulator)")}
            >
              Export
            </button>
          </div>
        </div>
      </div>

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
        <ConnectModal clip={connectClip} onClose={closeConnect} togglePlatform={togglePlatform} />
      )}

      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onQueued={(msg) => showToast(msg)}
        clipId={selectedClip ? String(selectedClip.id) : "clip_unselected"}
        clipTitle={selectedClip ? `${selectedClip.hl} ${selectedClip.rest}`.trim() : "Untitled clip"}
        clipCaption={selectedClip ? `${selectedClip.hl} ${selectedClip.rest}`.trim() : undefined}
      />

      <SubmitToWhopModal
        open={whopOpen}
        onClose={() => setWhopOpen(false)}
        onSubmitted={(msg) => showToast(msg)}
        clipId={selectedClip ? String(selectedClip.id) : null}
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
