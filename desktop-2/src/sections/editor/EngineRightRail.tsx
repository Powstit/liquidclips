import { useState } from "react";
import type {
  Clip,
  EditState,
  FrameLayout,
  PlatformKey,
  ReactionCorner,
  ReactionSource,
} from "../../fixtures/fakeEditor";
import { PLATFORMS, PLATFORM_KEYS } from "../../fixtures/fakeEditor";

type RailTab =
  | "captions"
  | "reframe"
  | "reactions"
  | "layout"
  | "audio"
  | "thumb"
  | "post";

interface EngineRightRailProps {
  clip: Clip;
  edit: EditState;
  setEdit: (patch: Partial<EditState>) => void;
  togglePlatform: (key: PlatformKey) => void;
  onWhopSubmit: () => void;
  activeTab?: RailTab;
  onTabChange?: (tab: RailTab) => void;
  /** Lane 2 — optional CampaignContextStrip slot pinned to the top of the rail. */
  contextStrip?: JSX.Element;
}

export function EngineRightRail({
  clip,
  edit,
  setEdit,
  togglePlatform,
  onWhopSubmit,
  activeTab: activeTabProp,
  onTabChange,
  contextStrip,
}: EngineRightRailProps) {
  const [internalTab, setInternalTab] = useState<RailTab>("captions");
  const activeTab = activeTabProp ?? internalTab;
  const setActiveTab = (tab: RailTab) => {
    if (onTabChange) onTabChange(tab);
    else setInternalTab(tab);
  };
  const [thumbGenerating, setThumbGenerating] = useState(false);

  const tabs: { key: RailTab; label: string }[] = [
    { key: "captions", label: "Captions" },
    { key: "reframe", label: "Reframe" },
    { key: "reactions", label: "Reactions" },
    { key: "layout", label: "Layout" },
    { key: "audio", label: "Audio" },
    { key: "thumb", label: "Thumbnail" },
    { key: "post", label: "Post to" },
  ];

  const handleGenerateThumb = () => {
    setThumbGenerating(true);
    setTimeout(() => setThumbGenerating(false), 900);
  };

  const captionStyleOptions: { key: EditState["captionStyle"]; label: JSX.Element }[] = [
    {
      key: "pop",
      label: (
        <span className="lc2-engine-so-pop">
          Bold <em>Pop</em>
        </span>
      ),
    },
    {
      key: "clean",
      label: (
        <span className="lc2-engine-so-clean">
          Clean <em>line</em>
        </span>
      ),
    },
    {
      key: "karaoke",
      label: (
        <span className="lc2-engine-so-karaoke">
          Kara<em>oke</em>
        </span>
      ),
    },
    {
      key: "min",
      label: (
        <span className="lc2-engine-so-min">
          Min <em>imal</em>
        </span>
      ),
    },
  ];

  const reactionSources: { key: ReactionSource; label: string; icon?: JSX.Element }[] = [
    { key: "off", label: "No reaction" },
    {
      key: "cam",
      label: "Webcam clip",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 7l-7 5 7 5V7zM1 5h15v14H1z" />
        </svg>
      ),
    },
    {
      key: "giphy",
      label: "Giphy / Pexels",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 3v18M3 9h5" />
        </svg>
      ),
    },
    {
      key: "upload",
      label: "Upload clip",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 15V3m-4 4 4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      ),
    },
  ];

  const layoutOptions: { key: FrameLayout; label: string; mk: JSX.Element }[] = [
    {
      key: "single",
      label: "Single",
      mk: <i style={{ left: "20%", right: "20%", bottom: 0, height: "60%", borderRadius: "4px 4px 0 0" }} />,
    },
    {
      key: "split",
      label: "Split two-up",
      mk: (
        <>
          <i style={{ inset: "2px 2px 50% 2px", borderRadius: 3 }} />
          <i style={{ inset: "50% 2px 2px 2px", borderRadius: 3, background: "rgba(0,229,255,.3)" }} />
        </>
      ),
    },
    {
      key: "reaction",
      label: "Reaction",
      mk: (
        <>
          <i style={{ inset: 0 }} />
          <i style={{ top: 3, right: 3, width: 11, height: 11, borderRadius: 3, background: "var(--color-fuchsia)" }} />
        </>
      ),
    },
  ];

  const renderCaptions = () => (
    <>
      <div className="lc2-engine-field">
        <label>Style</label>
        <div className="lc2-engine-styles">
          {captionStyleOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`lc2-engine-style-opt${edit.captionStyle === opt.key ? " on" : ""}`}
              onClick={() => setEdit({ captionStyle: opt.key })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Position</label>
        <div className="lc2-engine-seg">
          {(["bottom", "mid"] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              className={edit.captionPosition === pos ? "on" : ""}
              onClick={() => setEdit({ captionPosition: pos })}
            >
              {pos === "bottom" ? "Lower" : "Center"}
            </button>
          ))}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Highlight colour</label>
        <div className="lc2-engine-swatches">
          {[
            { bg: "#FF1A8C", value: "#FF3DA5" },
            { bg: "#FF8FCB", value: "#FF8FCB" },
            { bg: "#00E5FF", value: "#00E5FF" },
            { bg: "#F4F1EA", value: "#F4F1EA" },
          ].map((sw) => (
            <button
              key={sw.value}
              type="button"
              className={`lc2-engine-sw${edit.captionHighlight === sw.value ? " on" : ""}`}
              style={{ background: sw.bg }}
              onClick={() => setEdit({ captionHighlight: sw.value })}
              aria-label={`highlight ${sw.value}`}
            />
          ))}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Size</label>
        <input
          type="range"
          className="lc2-engine-slider"
          min={70}
          max={130}
          value={edit.captionSize}
          onChange={(e) => setEdit({ captionSize: Number(e.target.value) })}
        />
      </div>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Burn into video</div>
          <div className="lc2-engine-tg-sub">Captions written into the MP4</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.burnCaptions ? " on" : ""}`}
          onClick={() => setEdit({ burnCaptions: !edit.burnCaptions })}
          aria-label="burn captions"
        />
      </div>
    </>
  );

  const renderReframe = () => (
    <>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Auto-track subject</div>
          <div className="lc2-engine-tg-sub">Keeps the speaker centred</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.reframeTrack ? " on" : ""}`}
          onClick={() => setEdit({ reframeTrack: !edit.reframeTrack })}
          aria-label="auto-track"
        />
      </div>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Active-speaker switch</div>
          <div className="lc2-engine-tg-sub">Cuts to whoever is talking</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.reframeActiveSpeaker ? " on" : ""}`}
          onClick={() => setEdit({ reframeActiveSpeaker: !edit.reframeActiveSpeaker })}
          aria-label="active speaker"
        />
      </div>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Smooth motion</div>
          <div className="lc2-engine-tg-sub">Damps fast pans</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.reframeSmooth ? " on" : ""}`}
          onClick={() => setEdit({ reframeSmooth: !edit.reframeSmooth })}
          aria-label="smooth motion"
        />
      </div>
      <div className="lc2-engine-field" style={{ marginTop: 16 }}>
        <label>Manual frame</label>
        <div className="lc2-engine-seg">
          {(["fill", "fit", "free"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={edit.manualFrame === m ? "on" : ""}
              onClick={() => setEdit({ manualFrame: m })}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Zoom</label>
        <input
          type="range"
          className="lc2-engine-slider"
          min={100}
          max={160}
          value={edit.reframeZoom}
          onChange={(e) => setEdit({ reframeZoom: Number(e.target.value) })}
        />
      </div>
    </>
  );

  const renderReactions = () => (
    <>
      <div className="lc2-engine-field">
        <label>Reaction source</label>
        <div className="lc2-engine-react-src">
          {reactionSources.map((src) => (
            <button
              key={src.key}
              type="button"
              className={`lc2-engine-rsrc${edit.reactionSource === src.key ? " on" : ""}`}
              onClick={() => setEdit({ reactionSource: src.key })}
            >
              {src.icon}
              {src.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Corner</label>
        <div className="lc2-engine-corner-grid">
          {(["tl", "tr", "bl", "br"] as ReactionCorner[]).map((corner) => {
            const label: Record<ReactionCorner, string> = {
              tl: "Top left",
              tr: "Top right",
              bl: "Bottom left",
              br: "Bottom right",
            };
            return (
              <button
                key={corner}
                type="button"
                className={`lc2-engine-corner${edit.reactionCorner === corner ? " on" : ""}`}
                onClick={() => setEdit({ reactionCorner: corner })}
              >
                {label[corner]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="lc2-engine-field">
        <label>Size</label>
        <input
          type="range"
          className="lc2-engine-slider"
          min={20}
          max={44}
          value={edit.reactionSize}
          onChange={(e) => setEdit({ reactionSize: Number(e.target.value) })}
        />
      </div>
    </>
  );

  const renderLayout = () => (
    <>
      <div className="lc2-engine-field">
        <label>Frame layout</label>
        <div className="lc2-engine-layout-grid">
          {layoutOptions.map((lo) => (
            <button
              key={lo.key}
              type="button"
              className={`lc2-engine-lopt${edit.layout === lo.key ? " on" : ""}`}
              onClick={() => setEdit({ layout: lo.key })}
            >
              <div className="lc2-engine-lopt-mk">{lo.mk}</div>
              {lo.label}
            </button>
          ))}
        </div>
      </div>
      <p className="lc2-engine-note">
        Split stacks a second clip in the frame. Import a clip into the empty cell from the timeline.
      </p>
      {/* Gate 6 (2026-06-26) — Import-clip-into-frame is a legacy split-
       *  layout entry point. The customer-facing Design-OS split-layout
       *  lives at /workstation. Disabled with explainer instead of dead-
       *  click. */}
      <button
        type="button"
        className="lc2-engine-btn"
        style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
        disabled
        title="Split layouts are in the Design-OS workstation export panel."
        aria-disabled="true"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Import clip into frame
      </button>
    </>
  );

  const renderAudio = () => (
    <>
      <div className="lc2-engine-field">
        <label>Clip volume</label>
        <input
          type="range"
          className="lc2-engine-slider"
          min={0}
          max={100}
          value={edit.clipVolume}
          onChange={(e) => setEdit({ clipVolume: Number(e.target.value) })}
        />
      </div>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Clean up speech</div>
          <div className="lc2-engine-tg-sub">Removes hiss and room noise</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.cleanSpeech ? " on" : ""}`}
          onClick={() => setEdit({ cleanSpeech: !edit.cleanSpeech })}
          aria-label="clean speech"
        />
      </div>
      <div className="lc2-engine-toggle-row">
        <div>
          <div className="lc2-engine-tg-name">Background music</div>
          <div className="lc2-engine-tg-sub">Subtle bed under the clip</div>
        </div>
        <button
          type="button"
          className={`lc2-engine-sw-toggle${edit.backgroundMusic ? " on" : ""}`}
          onClick={() => setEdit({ backgroundMusic: !edit.backgroundMusic })}
          aria-label="background music"
        />
      </div>
      <div className="lc2-engine-field" style={{ marginTop: 16 }}>
        <label>Music level</label>
        <input
          type="range"
          className="lc2-engine-slider"
          min={0}
          max={100}
          value={edit.musicLevel}
          onChange={(e) => setEdit({ musicLevel: Number(e.target.value) })}
        />
      </div>
    </>
  );

  const renderThumb = () => (
    <>
      <div className="lc2-engine-field">
        <label>Thumbnail</label>
        <div className="lc2-engine-thumb-prev">
          <b>{(`${clip.hl} ${clip.rest}`).toUpperCase().slice(0, 14)}</b>
        </div>
        <button
          type="button"
          className="lc2-engine-btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={handleGenerateThumb}
          disabled={thumbGenerating}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
          </svg>
          {thumbGenerating ? "Generating…" : "Generate thumbnail"}
        </button>
      </div>
      <p className="lc2-engine-note">
        Character-consistent thumbnail from your reference face — rotates expression and layout for click-power.
      </p>
    </>
  );

  const renderPost = () => (
    <>
      <div className="lc2-engine-field">
        <label>Accounts this clip posts to</label>
        <div className="lc2-engine-ed-platrow">
          {PLATFORM_KEYS.map((key) => {
            const on = clip.plats.has(key);
            return (
              <button
                key={key}
                type="button"
                className={`lc2-engine-ed-plat${on ? " on" : ""}`}
                onClick={() => togglePlatform(key)}
                aria-label={PLATFORMS[key].name}
              >
                {PLATFORMS[key].renderIcon({ size: 16 })}
              </button>
            );
          })}
        </div>
      </div>
      <p className="lc2-engine-note" style={{ marginBottom: 14 }}>
        Each clip can target its own accounts. Tap to connect.{" "}
        <span style={{ color: "var(--color-fuchsia-glow)" }}>Publishing runs through Ayrshare.</span>
      </p>
      <div className="lc2-engine-field">
        <label>When</label>
        <div className="lc2-engine-seg">
          {(["now", "drip"] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={edit.postWhen === w ? "on" : ""}
              onClick={() => setEdit({ postWhen: w })}
            >
              {w === "now" ? "Post now" : "Add to drip"}
            </button>
          ))}
        </div>
      </div>
      <div className="lc2-engine-whop-note">
        <div className="lc2-engine-wn-h">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Rewards run on Whop (v1)
        </div>
        <p>
          Views and payouts live in Whop Content Rewards — no API yet, so we link out and never show numbers we
          can't pull. Build our own after PMF / £100k MRR.
        </p>
        <button
          type="button"
          className="lc2-engine-btn"
          style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
          onClick={onWhopSubmit}
        >
          Submit to Whop rewards
        </button>
      </div>
    </>
  );

  const panelContent: Record<RailTab, JSX.Element> = {
    captions: renderCaptions(),
    reframe: renderReframe(),
    reactions: renderReactions(),
    layout: renderLayout(),
    audio: renderAudio(),
    thumb: renderThumb(),
    post: renderPost(),
  };

  return (
    <aside className="lc2-engine-rail">
      {contextStrip}
      <div className="lc2-engine-rail-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`lc2-engine-rail-tab${activeTab === t.key ? " on" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="lc2-engine-rail-body">{panelContent[activeTab]}</div>
    </aside>
  );
}

export type { RailTab };
