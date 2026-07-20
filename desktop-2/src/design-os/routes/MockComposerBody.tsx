/**
 * MockComposerBody · pixel-1:1 mockup ported to native JSX (2026-07-19)
 *
 * Ported from `desktop-2/public/mockup-composer.html` (v1 · 2026-07-18) to
 * replace the iframe embed used by `MockComposer.tsx`. All CSS lives in
 * `./MockComposer.css` — every selector is scoped under `.lc-mock-composer`
 * so mockup styles cannot leak into the rest of the app.
 *
 * Event wiring uses delegated click / keydown handlers on the root wrapper
 * (instead of hand-attaching onClick to every element). This keeps the port
 * mechanical — the DOM below is a verbatim JSX translation of the mockup
 * with class → className, comments in JSX form, inline style="" converted
 * to React style={{}} objects, and SVG hyphen-attrs (stroke-width etc.)
 * camel-cased. No behaviour was invented; the vanilla JS script from the
 * source HTML is deliberately NOT ported (this file only owns the static
 * DOM). Downstream sprints (S5–S12) feed live data into named slots.
 *
 * Interaction map (root-level delegation):
 *   .nav-item click        → onNavClick(navLabelToRoute(text of .nav-label))
 *   .layout-btn click      → onLayoutSet(dataset.layout)
 *   .hud-mode-btn click    → onModeSet(id === "mode-kade" ? "kade" : "classic")
 *   .hud-speed-btn click   → onSpeedSet(parseInt(dataset.speed))
 *   #turbo-toggle click    → onTurboToggle()
 *   .hud-turbo click       → onTurboToggle()
 *   .slot-grid button      → onSlotSelect(letter from textContent)
 *   .command-input Enter   → onCommand(value)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteId } from "../bridge";
import { useEvent } from "../bridge/useEvent";
import { useVoiceInput } from "../engine/composer/voiceInput";
import "./MockComposer.css";

/** One transcript word rendered inside `.transcript-strip`. */
export interface MockComposerTranscriptWord {
  text: string;
  idx: number;
}

/** One clip card rendered inside `.clip-stack`. */
export interface MockComposerClipCard {
  idx: number;
  num: string;
  dur: string;
  title: string;
  score: number;
}

/** Campaign brief rendered inside `.brief-card`. */
export interface MockComposerBrief {
  tag: string;
  title: string;
  rules: string[];
}

/** Caption style keys mirror `CaptionStyleKey` from CockpitContext. */
export type MockComposerCaptionStyle =
  | "fuchsia-pop"
  | "cyan-bold"
  | "amber-soft"
  | "mono-clean";

/** Props mirror MockComposer.tsx (thin wrapper). */
export interface MockComposerBodyProps {
  /** Called when the user submits a command in the mockup's input bar. */
  onCommand?: (text: string) => void;
  /** Called when the user clicks a nav item (Home / Create / Clips / …). */
  onNavClick?: (route: RouteId) => void;
  /** Called when the user clicks a layout button (single / split-* / grid-2x2). */
  onLayoutSet?: (layout: string) => void;
  /** Called when the user clicks a mode button (Kade / Classic). */
  onModeSet?: (mode: "kade" | "classic") => void;
  /** Called when the user clicks a speed button (1× / 2× / 5×). */
  onSpeedSet?: (speed: 1 | 2 | 5) => void;
  /** Called when the user clicks the turbo toggle. */
  onTurboToggle?: () => void;
  /** Called when the user clicks an A / B / C / D slot letter. */
  onSlotSelect?: (letter: "A" | "B" | "C" | "D") => void;
  /** S5 · Called when the user clicks the SHIP button (`.command-send`). */
  onShip?: () => void;
  /** S7 · When set, `.video-area` renders a real `<video>` with this src. */
  videoSrc?: string | null;
  /** S8 · Words rendered inside `.transcript-strip`. Falls back to demo fixture. */
  transcriptWords?: MockComposerTranscriptWord[];
  /** S9 · Clip cards rendered inside `.clip-stack`. Falls back to demo fixture. */
  clips?: MockComposerClipCard[];
  /** S11 · Text rendered inside the `.fake-caption` preview. */
  captionText?: string;
  /** S11 · Style token forwarded as `data-style` on `.fake-caption`. */
  captionStyle?: MockComposerCaptionStyle;
  /** S12 · Campaign brief rendered inside `.brief-card`. */
  brief?: MockComposerBrief | null;
  /**
   * 2026-07-19 · Real canvas-loaded state (drives CSS visibility of the
   * idle hint + Kade greeting). When true, the greeting fades and the
   * loaded canvas surfaces (transcript, clip stack, etc.) appear.
   */
  canvasLoaded?: boolean;
  /** Real aspect state · drives `.canvas[data-aspect]` styling. */
  canvasAspect?: "9:16" | "16:9" | "1:1";
  /** Real layout state · drives `.canvas[data-layout-mode]` styling. */
  canvasLayoutMode?: "single" | "split-vertical" | "split-horizontal" | "grid-2x2";
  /** Real active mode (from useModeStore) · drives `.hud-mode-btn[data-active]`. */
  activeMode?: "kade" | "classic";
  /** Real active speed (from useSpeedStore) · drives `.hud-speed-btn[data-active]`. */
  activeSpeed?: 1 | 2 | 5;
  /** Real turbo state · drives `.hud-turbo[data-active]`. */
  turboActive?: boolean;
  /** Current route id · drives `.nav-item[data-active]`. */
  activeRoute?: RouteId;
}

/**
 * Maps a mockup nav label to the app's RouteId.
 *
 * Every value returned here must be a member of the `RouteId` union
 * exported from `../bridge/events.ts`.
 */
function navLabelToRoute(label: string): RouteId | null {
  const lower = label.toLowerCase().trim();
  switch (lower) {
    case "home":      return "home";
    case "create":    return "composer";
    case "clips":     return "workstation";
    case "campaigns": return "campaigns";
    case "earn":      return "earn";
    case "schedule":  return "schedule";
    case "settings":  return "settings";
    default:          return null;
  }
}

export function MockComposerBody({
  onCommand,
  onNavClick,
  onLayoutSet,
  onModeSet,
  onSpeedSet,
  onTurboToggle,
  onSlotSelect,
  onShip,
  videoSrc,
  transcriptWords,
  clips,
  captionText,
  captionStyle,
  brief,
  canvasLoaded = false,
  canvasAspect = "9:16",
  canvasLayoutMode = "single",
  activeMode = "kade",
  activeSpeed = 1,
  turboActive = false,
  activeRoute,
}: MockComposerBodyProps): JSX.Element {
  /* S6 · Voice input. The hook feeds every finalised transcript into the
     same onCommand pipeline (identical to typing + Enter). We keep the
     hook local to MockComposerBody so the SHIP-adjacent mic tile can wire
     click → start/stop without an extra prop dance. */
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const voice = useVoiceInput({
    onTranscribed: (text) => {
      const clean = text.trim();
      if (!clean) return;
      onCommand?.(clean);
      if (commandInputRef.current) commandInputRef.current.value = "";
    },
  });
  const listening = voice.state === "listening";
  const onMicClick = useCallback(() => {
    if (listening) voice.stop();
    else voice.start();
  }, [listening, voice]);

  /* S10 · Reaction bubble subscribes to `kade:speak` and auto-hides after
     ~2.5s. We store `body` (the meaningful text) — the mockup icon stays
     visible; the message rides on top as a small caption to preserve
     the mockup's compositional grammar. */
  const [reactionMsg, setReactionMsg] = useState<string | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEvent("kade:speak", (payload) => {
    const msg = (payload?.body ?? payload?.title ?? "").trim();
    if (!msg) return;
    setReactionMsg(msg);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReactionMsg(null), 2500);
  });
  useEffect(() => {
    return () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    };
  }, []);

  /* 2026-07-19 · Signal to the shell CSS that the mockup is mounted, so
   * StickyKade + ChatToggle + speech bubble + banners hide (rules in
   * MockComposer.css:body[data-mock-composer-active]). The persistent
   * shell chrome was doubling-up on top of the mockup and blocked
   * interactions with the command bar. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.mockComposerActive = "true";
    return () => {
      delete document.body.dataset.mockComposerActive;
    };
  }, []);

  /* Video · sync playbackRate to activeSpeed when a real video is loaded. */
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = videoElRef.current;
    if (!v) return;
    v.playbackRate = activeSpeed;
  }, [activeSpeed, videoSrc]);

  /* Slot A/B/C · local state so the highlighted slot moves on click.
   * We ALSO forward the click to onSlotSelect so the outer app fires
   * the composer:slot-select bus event. */
  const [selectedSlot, setSelectedSlot] = useState<"A" | "B" | "C">("A");

  /* Tool presets · lightweight local state for the sidebar preset groups
   * (Snap-to-hook, Watermark position, Reaction audio). Each group is a
   * single-select radio; clicks re-map. */
  const [snapPreset, setSnapPreset] = useState<"snap-hook" | "snap-scene" | "snap-off">("snap-hook");
  const [wmPreset, setWmPreset] = useState<"tr" | "tl" | "br" | "bl">("tr");
  const [audioPreset, setAudioPreset] = useState<"own" | "kade" | "muted">("own");

  /* S12 · Dev-only gate for the Base Window JSON panel. Reads `?dev=1`
     off the URL OR `localStorage.getItem("lc:composer.showdev") === "1"`.
     Silent-safe in SSR / missing-window contexts. */
  const isDev = useMemo(() => {
    try {
      if (typeof window === "undefined") return false;
      const url = new URL(window.location.href);
      const q = url.searchParams.get("dev") ?? url.hash.match(/dev=(\d)/)?.[1];
      if (q === "1") return true;
      if (q === "0") return false;
      return window.localStorage.getItem("lc:composer.showdev") === "1";
    } catch {
      return false;
    }
  }, []);

  // Root-level click delegation. We match on the closest ancestor whose
  // classList / id identifies a wired control. Order matters (specific
  // ids before generic classes).
  const onRootClick = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      const target = ev.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;

      // Turbo toggle · fires on #turbo-toggle OR any .hud-turbo (defensive
      // in case class-only usage sneaks in).
      const turbo = target.closest<HTMLElement>("#turbo-toggle, .hud-turbo");
      if (turbo) {
        onTurboToggle?.();
        return;
      }

      // Mode buttons · #mode-kade / #mode-classic
      const mode = target.closest<HTMLElement>(".hud-mode-btn");
      if (mode) {
        const modeVal = mode.id === "mode-classic" ? "classic" : "kade";
        onModeSet?.(modeVal);
        return;
      }

      // Speed buttons · data-speed 1/2/5
      const speedBtn = target.closest<HTMLElement>(".hud-speed-btn");
      if (speedBtn) {
        const raw = Number.parseInt(speedBtn.dataset.speed ?? "", 10);
        const speed: 1 | 2 | 5 = raw === 2 || raw === 5 ? raw : 1;
        onSpeedSet?.(speed);
        return;
      }

      // Layout buttons · data-layout single / split-vertical / split-horizontal / grid-2x2
      const layout = target.closest<HTMLElement>(".layout-btn");
      if (layout) {
        const l = layout.dataset.layout ?? "";
        if (l) onLayoutSet?.(l);
        return;
      }

      // Slot letters · inside .slot-grid, populated dynamically by future
      // sprints. Match any <button> descendant of #slot-grid.
      const slot = target.closest<HTMLElement>("#slot-grid button");
      if (slot) {
        const letter = (slot.textContent ?? "").trim().toUpperCase().slice(0, 1);
        if (letter === "A" || letter === "B" || letter === "C" || letter === "D") {
          onSlotSelect?.(letter);
        }
        return;
      }

      // S6 · Mic button · toggle voice input. Guarded before generic
      // button matchers so a subtree click hit here first.
      const mic = target.closest<HTMLElement>("#command-mic, .command-mic");
      if (mic) {
        onMicClick();
        return;
      }

      // S5 · SHIP button · fires the `onShip` prop. When wired at the
      // parent (Composer.tsx) it forwards through the same `submitCommand`
      // pipeline as the input bar so the intent router owns the outcome.
      const ship = target.closest<HTMLElement>("#ship-btn, .command-ship");
      if (ship) {
        onShip?.();
        return;
      }

      // Command send button · #command-send reads #command-input value.
      // When `onShip` is wired the send button doubles as SHIP: pending
      // input still submits the typed command, but an EMPTY send press
      // fires `onShip` so the mockup's single-button `Send` acts as SHIP.
      const send = target.closest<HTMLElement>("#command-send");
      if (send) {
        const input = (
          send.ownerDocument ?? document
        ).getElementById("command-input") as HTMLInputElement | null;
        const text = (input?.value ?? "").trim();
        if (text) {
          onCommand?.(text);
          if (input) input.value = "";
        } else if (onShip) {
          onShip();
        }
        return;
      }

      // Nav items · derive label from .nav-label child; map to RouteId.
      const nav = target.closest<HTMLElement>(".nav-item");
      if (nav) {
        const label =
          nav.querySelector<HTMLElement>(".nav-label")?.textContent ??
          nav.textContent ??
          "";
        const route = navLabelToRoute(label);
        if (route) onNavClick?.(route);
        return;
      }
    },
    [
      onNavClick,
      onLayoutSet,
      onModeSet,
      onSpeedSet,
      onTurboToggle,
      onSlotSelect,
      onCommand,
      onShip,
      onMicClick,
    ],
  );

  // Command input · Enter submits. Delegated at the root so we don't have
  // to rebind the `<input>` mid-tree.
  const onRootKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (ev.key !== "Enter") return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const input = target.closest<HTMLInputElement>("#command-input");
      if (!input) return;
      const text = (input.value ?? "").trim();
      if (text) {
        onCommand?.(text);
        input.value = "";
      }
    },
    [onCommand],
  );

  return (
    <div
      className="lc-mock-composer"
      data-turbo={turboActive ? "true" : "false"}
      data-mode={activeMode}
      data-layout-mode={canvasLayoutMode}
      onClick={onRootClick}
      onKeyDown={onRootKeyDown}
      data-testid="mock-composer-body"
    >
  <div className="app">

    {/* ============================================================ */}
    {/*                       LEFT NAV                                 */}
    {/* ============================================================ */}
    <nav className="nav">
      <div className="nav-logo" title="Liquid Clips">
        {/* LC pixel invader */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="6" y="4" width="12" height="2" fill="#ff1a8c"/>
          <rect x="4" y="6" width="16" height="2" fill="#ff1a8c"/>
          <rect x="2" y="8" width="20" height="6" fill="#ff1a8c"/>
          <rect x="6" y="10" width="2" height="2" fill="#0b0b10"/>
          <rect x="16" y="10" width="2" height="2" fill="#0b0b10"/>
          <rect x="4" y="14" width="16" height="2" fill="#ff1a8c"/>
          <rect x="2" y="16" width="4" height="2" fill="#ff1a8c"/>
          <rect x="10" y="16" width="4" height="2" fill="#ff1a8c"/>
          <rect x="18" y="16" width="4" height="2" fill="#ff1a8c"/>
          <rect x="6" y="18" width="2" height="2" fill="#ff1a8c"/>
          <rect x="16" y="18" width="2" height="2" fill="#ff1a8c"/>
        </svg>
      </div>
      <div className="nav-item" data-active={activeRoute === "home" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12L12 4l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z"/></svg><span className="nav-label">Home</span></div>
      <div className="nav-item" data-active={activeRoute === "composer" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16v12H4z"/><path d="M4 10l6 4 4-3 6 5"/></svg><span className="nav-label">Create</span></div>
      <div className="nav-item" data-active={activeRoute === "workstation" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M10 10l5 2-5 2z" fill="currentColor"/></svg><span className="nav-label">Clips</span></div>
      <div className="nav-item" data-active={activeRoute === "campaigns" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3 6 6 1-4.5 4 1 6L12 16l-5.5 3 1-6L3 9l6-1z"/></svg><span className="nav-label">Campaigns</span></div>
      <div className="nav-item" data-active={activeRoute === "earn" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20"/><path d="M6 8h9a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10"/></svg><span className="nav-label">Earn</span></div>
      <div className="nav-item" data-active={activeRoute === "schedule" ? "true" : undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg><span className="nav-label">Schedule</span></div>
      <div style={{ flex: "1" }}></div>
      <div className="nav-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span className="nav-label">Settings</span></div>
    </nav>

    {/* ============================================================ */}
    {/*                      MAIN WORKSPACE                            */}
    {/* ============================================================ */}
    <div className="main">

      {/* Top HUD */}
      <header className="hud">
        <div className="hud-brand">
          <div className="hud-brand-text">Liquid <span>Clips</span></div>
        </div>
        <div className="plan-chip">Agency · $99.99/mo</div>
        <div className="hud-mode">
          <button className="hud-mode-btn" data-active={activeMode === "kade" ? "true" : undefined} id="mode-kade">Kade</button>
          <button className="hud-mode-btn" data-active={activeMode === "classic" ? "true" : undefined} id="mode-classic">Classic</button>
        </div>
        <button className="hud-turbo" data-active={turboActive ? "true" : undefined} id="turbo-toggle">Turbo</button>

        <div className="hud-speed">
          <span className="hud-speed-label">Speed</span>
          <button className="hud-speed-btn" data-speed="1" data-active={activeSpeed === 1 ? "true" : undefined}>1×</button>
          <button className="hud-speed-btn" data-speed="2" data-active={activeSpeed === 2 ? "true" : undefined}>2×</button>
          <button className="hud-speed-btn" data-speed="5" data-active={activeSpeed === 5 ? "true" : undefined}>5×</button>
        </div>
        <div className="hud-avatar" title="Daniel">D</div>
      </header>

      {/* Workspace grid */}
      <div className="workspace">

        {/* Canvas + Side Panel */}
        <div className="canvas-region">

          {/* Canvas */}
          <div className="canvas-wrap">
            <div className="canvas-header">
              <span>Video · <b>Base Window</b></span>
              <div className="canvas-header-right">
                <span className="canvas-tag">9:16 vertical</span>
                <span className="canvas-tag is-money" id="regions-tag">0 regions</span>
              </div>
            </div>

            <div
              className="canvas"
              id="canvas"
              data-layout-mode={canvasLayoutMode}
              data-canvas-loaded={canvasLoaded ? "true" : "false"}
              data-aspect={canvasAspect}
            >

              {/* Idle hint · concrete commands · fades out on first command */}
              <div className="idle-hint" id="idle-hint">
                type an aspect · <span>9:16</span> · <span>16:9</span> · <span>1:1</span>
              </div>

              {/* Layout switcher chip strip · additions v2 */}
              <div className="layout-strip" id="layout-strip">
                <button className="layout-btn" data-layout="single"           data-active={canvasLayoutMode === "single" ? "true" : undefined} title="Single canvas">Single</button>
                <button className="layout-btn" data-layout="split-vertical"   data-active={canvasLayoutMode === "split-vertical" ? "true" : undefined} title="Split · left | right">⇔ Split-V</button>
                <button className="layout-btn" data-layout="split-horizontal" data-active={canvasLayoutMode === "split-horizontal" ? "true" : undefined} title="Split · top / bottom">⇕ Split-H</button>
                <button className="layout-btn" data-layout="grid-2x2"         data-active={canvasLayoutMode === "grid-2x2" ? "true" : undefined} title="Grid 2×2">⊞ 2×2</button>
              </div>

              {/* Slot grid overlay · shown when layout != single · additions v2 */}
              <div className="slot-grid" id="slot-grid" data-layout={canvasLayoutMode}>
                {(["A", "B", "C"] as const).map((letter) => (
                  <button
                    key={letter}
                    className="slot-letter-btn"
                    data-slot={letter}
                    data-active={selectedSlot === letter ? "true" : undefined}
                    onClick={() => {
                      setSelectedSlot(letter);
                      onSlotSelect?.(letter);
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              {/* Celebration high-res flash overlay · additions v2 */}
              <div className="celebration-flash" id="celebration-flash">
                <img id="celebration-flash-img" src="/brand/kade/kade-celebration.webp" alt="Kade celebrating" />
              </div>

              {/* Video area · idle=invisible · aspect materializes on command.
                  S7 · when a real videoSrc is present we mount a native
                  <video> element and drop the fake noise/subject children.
                  When null we keep the demo fixture so the idle canvas
                  stays theatrical. */}
              <div
                className="video-area"
                id="video-area"
                data-loaded={videoSrc ? "true" : "false"}
                data-aspect="9:16"
              >
                {videoSrc ? (
                  <video
                    ref={videoElRef}
                    className="video-real"
                    src={videoSrc}
                    controls={false}
                    autoPlay={false}
                    muted
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <>
                    <div className="video-noise"></div>
                    <div className="video-fake-subject"></div>
                    <div className="video-timecode">00:00:32</div>
                    <div className="video-playhead">
                      <div className="video-playhead-fill" id="playhead"></div>
                    </div>
                  </>
                )}
              </div>

              {/* Transcript strip (Flow 1).
                  S8 · when `transcriptWords` is supplied we render the
                  real words; falling back to the demo fixture keeps the
                  idle canvas alive. */}
              <div className="transcript-strip" id="transcript-strip">
                {transcriptWords && transcriptWords.length > 0 ? (
                  transcriptWords.map((w) => (
                    <span
                      key={w.idx}
                      className="transcript-word"
                      data-idx={w.idx}
                    >
                      {w.text}
                    </span>
                  ))
                ) : (
                  <>
                    <span className="transcript-word" data-idx="0">customer</span>
                    <span className="transcript-word" data-idx="1">acquisition</span>
                    <span className="transcript-word" data-idx="2">is</span>
                    <span className="transcript-word" data-idx="3">the</span>
                    <span className="transcript-word" data-idx="4">one</span>
                    <span className="transcript-word" data-idx="5">thing</span>
                    <span className="transcript-word" data-idx="6">nobody</span>
                    <span className="transcript-word" data-idx="7">gets</span>
                    <span className="transcript-word" data-idx="8">right</span>
                    <span className="transcript-word" data-idx="9">early</span>
                  </>
                )}
              </div>

              {/* Clip stack (Flow 1).
                  S9 · when `clips` is supplied we render real cards;
                  falling back to the demo fixture keeps the idle canvas
                  full of "look what Kade found" energy. */}
              <div className="clip-stack" id="clip-stack">
                {clips && clips.length > 0 ? (
                  clips.map((c) => (
                    <div key={c.idx} className="clip-card" data-idx={c.idx}>
                      <div className="clip-card-header">
                        <span className="clip-card-num">{c.num}</span>
                        <span className="clip-card-dur">{c.dur}</span>
                      </div>
                      <div className="clip-card-title">{c.title}</div>
                      <span className="clip-card-score">{c.score} hook</span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="clip-card" data-idx="0">
                      <div className="clip-card-header">
                        <span className="clip-card-num">#01</span>
                        <span className="clip-card-dur">0:22</span>
                      </div>
                      <div className="clip-card-title">The one thing nobody gets right early</div>
                      <span className="clip-card-score">92 hook</span>
                    </div>
                    <div className="clip-card" data-idx="1">
                      <div className="clip-card-header">
                        <span className="clip-card-num">#02</span>
                        <span className="clip-card-dur">0:18</span>
                      </div>
                      <div className="clip-card-title">Cold outbound still works in 2026</div>
                      <span className="clip-card-score">88 hook</span>
                    </div>
                    <div className="clip-card" data-idx="2">
                      <div className="clip-card-header">
                        <span className="clip-card-num">#03</span>
                        <span className="clip-card-dur">0:27</span>
                      </div>
                      <div className="clip-card-title">Why founders undercharge every time</div>
                      <span className="clip-card-score">85 hook</span>
                    </div>
                  </>
                )}
              </div>

              {/* Reaction bubble (Flow 2).
                  S10 · subscribes to `kade:speak` and auto-hides after
                  ~2.5s. The icon stays inside the bubble; when a message
                  is live we tag `data-visible="true"` so the mockup CSS
                  fades it in, and render a tiny caption pill under it. */}
              <div
                className="reaction-bubble"
                id="reaction-bubble"
                data-visible={reactionMsg ? "true" : "false"}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 7l-7 5 7 5V7z"/>
                  <rect x="1" y="5" width="15" height="14" rx="2"/>
                </svg>
                {reactionMsg ? (
                  <span
                    className="reaction-bubble-msg"
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 4,
                      padding: "4px 8px",
                      background: "rgba(0,0,0,0.7)",
                      color: "var(--fuchsia)",
                      borderRadius: 6,
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      whiteSpace: "nowrap",
                      letterSpacing: "0.08em",
                      pointerEvents: "none",
                    }}
                  >
                    {reactionMsg}
                  </span>
                ) : null}
              </div>

              {/* Fake captions (Flow 3).
                  S11 · text + style are driven from useCockpit() via the
                  parent. Default text keeps the demo alive when captions
                  aren't yet configured. `data-style` is picked up by
                  MockComposer.css to key the color / weight variant. */}
              <div
                className="fake-caption"
                id="fake-caption"
                data-style={captionStyle ?? undefined}
              >
                {captionText ?? "This will hit hard."}
              </div>

              {/* Campaign brief card · flowCampaign (additions v3).
                  S12 · when `brief` is supplied we render its tag/title
                  + up to N rules; falling back to the demo fixture. */}
              <div className="brief-card" id="brief-card" data-visible="false">
                {brief ? (
                  <>
                    <span className="brief-card-tag">{brief.tag}</span>
                    <div className="brief-card-title">{brief.title}</div>
                    {brief.rules.map((rule, i) => (
                      <div
                        key={i}
                        className="brief-card-rule"
                        data-status="pending"
                        data-rule={i}
                      >
                        <span className="brief-card-rule-icon">·</span>
                        <span>{rule}</span>
                      </div>
                    ))}
                    <button className="brief-card-submit" id="brief-submit">Submit to Whop</button>
                  </>
                ) : (
                  <>
                    <span className="brief-card-tag">Creator brief</span>
                    <div className="brief-card-title">Uncle Daniel · 15s hook</div>
                    <div className="brief-card-rule" data-status="pending" data-rule="0">
                      <span className="brief-card-rule-icon">·</span><span>Duration under 15s</span>
                    </div>
                    <div className="brief-card-rule" data-status="pending" data-rule="1">
                      <span className="brief-card-rule-icon">·</span><span>Say the phrase "clips that pay"</span>
                    </div>
                    <div className="brief-card-rule" data-status="pending" data-rule="2">
                      <span className="brief-card-rule-icon">·</span><span>Agency watermark visible</span>
                    </div>
                    <button className="brief-card-submit" id="brief-submit">Submit to Whop</button>
                  </>
                )}
              </div>

              {/* REC pill · flowRecord (additions v3) */}
              <div className="rec-pill" id="rec-pill" data-visible="false">
                <span className="rec-pill-dot"></span>
                <span>REC · <span id="rec-pill-time">00:00</span></span>
              </div>

              {/* 9:16 safe-zone overlay · flowFrame (additions v3) */}
              <div className="safe-zone" id="safe-zone" data-visible="false">
                <span className="safe-zone-label">Safe · 9:16</span>
              </div>
              <div className="hook-text" id="hook-text" data-visible="false"></div>

              {/* Audio track strip · flowAudio (additions v3) */}
              <div className="audio-strip" id="audio-strip" data-visible="false">
                <div className="audio-track-row" data-track="source">
                  <span className="audio-track-label">Source</span>
                  <div className="audio-track-bar"><div className="audio-track-fill" id="audio-source-fill" style={{ "--vol": "100%" } as React.CSSProperties}></div></div>
                  <span className="audio-track-vol" id="audio-source-vol">100</span>
                </div>
                <div className="audio-track-row" data-track="music">
                  <span className="audio-track-label">Music</span>
                  <div className="audio-track-bar"><div className="audio-track-fill" id="audio-music-fill" style={{ "--vol": "0%" } as React.CSSProperties}></div></div>
                  <span className="audio-track-vol" id="audio-music-vol">0</span>
                </div>
                <span className="audio-suggestion-pill" id="audio-suggestion" style={{ display: "none" }}>♪ upbeat_lofi_01</span>
              </div>

              {/* Multi-track timeline · flowTimeline (additions v3) */}
              <div className="timeline-strip" id="timeline-strip" data-visible="false">
                <div className="timeline-row" data-track="video">
                  <span className="timeline-row-label">Video</span>
                  <div className="timeline-row-bar"><div className="timeline-row-block" style={{ "--start": "8%", "--dur": "70%" } as React.CSSProperties}></div></div>
                </div>
                <div className="timeline-row" data-track="reaction">
                  <span className="timeline-row-label">Reaction</span>
                  <div className="timeline-row-bar"><div className="timeline-row-block" id="tl-reaction-block" style={{ "--start": "14%", "--dur": "30%" } as React.CSSProperties}></div></div>
                </div>
                <div className="timeline-row" data-track="caption">
                  <span className="timeline-row-label">Caption</span>
                  <div className="timeline-row-bar"><div className="timeline-row-block" style={{ "--start": "18%", "--dur": "44%" } as React.CSSProperties}></div></div>
                </div>
                <div className="timeline-row" data-track="hook">
                  <span className="timeline-row-label">Hook</span>
                  <div className="timeline-row-bar"><div className="timeline-row-block" style={{ "--start": "8%", "--dur": "14%" } as React.CSSProperties}></div></div>
                </div>
                <div className="timeline-row" data-track="audio">
                  <span className="timeline-row-label">Audio</span>
                  <div className="timeline-row-bar"><div className="timeline-row-block" style={{ "--start": "8%", "--dur": "70%" } as React.CSSProperties}></div></div>
                </div>
              </div>

              {/* Waveform strip · flowReactionsDeep (additions v3) */}
              <div className="waveform-strip" id="waveform-strip" data-visible="false">
                <div className="wave-lock-marker" id="wave-lock" style={{ "--lock-x": "50%" } as React.CSSProperties}></div>
              </div>

              {/* Watermark chip · flowWatermark (additions v3) */}
              <div className="watermark-chip" id="watermark-chip" data-visible="false">
                <span className="watermark-qr"></span>
                <span className="watermark-handle">liquidclips.app/<b>@you</b></span>
              </div>

              {/* ============================================================ */}
              {/* PARAMETER PANELS · v4 · Kade visibly picks values on canvas   */}
              {/* ============================================================ */}

              {/* Reactions layout picker (flowReaction + flowReactionsDeep) */}
              <div className="param-panel" id="param-panel-reactions" data-visible="false">
                <div className="param-panel-title">Reactions · <b>Layout</b></div>
                <div className="param-thumb-grid" id="react-thumbs">
                  <div className="param-thumb" data-idx="0" data-layout-mini="pip">
                    <span className="param-thumb-mini"></span>
                    <span className="param-thumb-rect"></span>
                    <span className="param-thumb-label">PIP</span>
                  </div>
                  <div className="param-thumb" data-idx="1" data-layout-mini="tb">
                    <span className="param-thumb-mini"></span>
                    <span className="param-thumb-rect"></span>
                    <span className="param-thumb-label">Top/Bot</span>
                  </div>
                  <div className="param-thumb" data-idx="2" data-layout-mini="side">
                    <span className="param-thumb-mini"></span>
                    <span className="param-thumb-rect"></span>
                    <span className="param-thumb-label">Side</span>
                  </div>
                  <div className="param-thumb" data-idx="3" data-layout-mini="full">
                    <span className="param-thumb-mini"></span>
                    <span className="param-thumb-rect"></span>
                    <span className="param-thumb-label">Full</span>
                  </div>
                </div>
                <div className="param-row">
                  <span className="param-label">Main</span>
                  <div className="param-slider" id="react-main-slider"><div className="param-slider-fill" style={{ "--v": "70%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "70%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="react-main-num">70</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Reaction</span>
                  <div className="param-slider" id="react-rx-slider"><div className="param-slider-fill" style={{ "--v": "85%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "85%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="react-rx-num">85</span>
                </div>
                <div className="param-chip-row">
                  <span className="param-chip" id="react-autoswitch" data-on="true">Auto-switch</span>
                  <span className="param-chip" id="react-duckmain" data-on="true">Duck main</span>
                </div>
              </div>

              {/* Captions style panel (flowCaptions) */}
              <div className="param-panel" id="param-panel-captions" data-visible="false">
                <div className="param-panel-title">Captions · <b>Style</b></div>
                <div className="param-preset-row" id="cap-presets">
                  <div className="param-preset-card" data-idx="0" data-style={{  }}>Bold</div>
                  <div className="param-preset-card" data-idx="1" data-style={{  }}>Pop</div>
                  <div className="param-preset-card" data-idx="2" data-style={{  }}>subtle</div>
                </div>
                <div className="param-row">
                  <span className="param-label">Position</span>
                  <span className="param-chip" data-cap-pos="top">Top</span>
                  <span className="param-chip" data-cap-pos="mid" data-picked="true">Mid</span>
                  <span className="param-chip" data-cap-pos="bot">Bot</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Words/line</span>
                  <span className="param-chip" data-cap-wpl="3">3</span>
                  <span className="param-chip" data-cap-wpl="4" data-picked="true">4</span>
                  <span className="param-chip" data-cap-wpl="5">5</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Karaoke</span>
                  <span className="param-chip" id="cap-karaoke" data-on="true">On · <span style={{ color: "var(--fuchsia)" }}>●</span></span>
                </div>
                <div className="param-row">
                  <span className="param-label">Font</span>
                  <span className="param-input" style={{ fontSize: "9px" }}>Inter Display ▾</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Size</span>
                  <div className="param-slider" id="cap-size-slider"><div className="param-slider-fill" style={{ "--v": "52%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "52%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="cap-size-num">52</span>
                </div>
              </div>

              {/* Record source picker (flowRecord) */}
              <div className="param-panel" id="param-panel-record" data-visible="false">
                <div className="param-panel-title">Record · <b>Source</b></div>
                <div className="param-src-grid" id="rec-sources">
                  <div className="param-src-tile is-wide is-earn" data-idx="0">
                    <span className="param-src-badge">Earn</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="12" cy="10" r="2"/><path d="M9 10h.01M15 10h.01"/></svg>
                    Tutorial · demo Kade
                  </div>
                  <div className="param-src-tile" data-idx="1">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>
                    Display
                  </div>
                  <div className="param-src-tile" data-idx="2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/></svg>
                    Window
                  </div>
                  <div className="param-src-tile" data-idx="3">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><circle cx="12" cy="10" r="2"/></svg>
                    Scr + mic
                  </div>
                  <div className="param-src-tile" data-idx="4">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M14 16l3 4M10 16l-3 4"/></svg>
                    Scr + audio
                  </div>
                  <div className="param-src-tile" data-idx="5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/></svg>
                    Camera only
                  </div>
                </div>
              </div>

              {/* Frame · hook + safe zones (flowFrame) */}
              <div className="param-panel" id="param-panel-frame" data-visible="false">
                <div className="param-panel-title">Frame · <b>Hook</b></div>
                <div className="param-row">
                  <span className="param-label">Safe</span>
                  <span className="param-chip" id="frame-safe-tt" data-on="true">TikTok ✓</span>
                  <span className="param-chip" id="frame-safe-rl" data-on="true">Reels ✓</span>
                  <span className="param-chip" id="frame-safe-sh" data-on="true">Shorts ✓</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Zoom</span>
                  <div className="param-slider" id="frame-zoom-slider"><div className="param-slider-fill" style={{ "--v": "20%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "20%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="frame-zoom-num">1.4×</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Text</span>
                  <span className="param-input" id="frame-text-input">·</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Emphasize</span>
                  <span className="param-input"><b>lied to</b></span>
                </div>
                <div className="param-row">
                  <span className="param-label">Duration</span>
                  <div className="param-slider" id="frame-dur-slider"><div className="param-slider-fill" style={{ "--v": "12%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "12%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="frame-dur-num">1.5s</span>
                </div>
                <div className="param-grad-row" id="frame-grads">
                  <div className="param-grad-thumb" data-g="0" data-idx="0" data-picked="true"></div>
                  <div className="param-grad-thumb" data-g="1" data-idx="1"></div>
                  <div className="param-grad-thumb" data-g="2" data-idx="2"></div>
                  <div className="param-grad-thumb" data-g="3" data-idx="3"></div>
                  <div className="param-grad-thumb" data-g="4" data-idx="4"></div>
                </div>
              </div>

              {/* Audio mix panel (flowAudio) */}
              <div className="param-panel" id="param-panel-audio" data-visible="false">
                <div className="param-panel-title">Audio · <b>Mix</b></div>
                <div className="param-row">
                  <span className="param-label">Main</span>
                  <div className="param-slider" id="ap-main-slider"><div className="param-slider-fill" style={{ "--v": "70%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "70%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="ap-main-num">70</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Music</span>
                  <div className="param-slider" id="ap-music-slider"><div className="param-slider-fill" style={{ "--v": "30%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "30%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="ap-music-num">30</span>
                </div>
                <div className="param-chip-row" id="ap-tracks">
                  <span className="param-chip" data-track="lofi"     data-picked="true">Lofi 01</span>
                  <span className="param-chip" data-track="ambient">Ambient</span>
                  <span className="param-chip" data-track="trap">Trap Chill</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Duck</span>
                  <span className="param-chip" id="ap-duck" data-on="true">On</span>
                </div>
              </div>

              {/* Timeline zoom + ruler (flowTimeline) */}
              <div className="param-panel" id="param-panel-timeline" data-visible="false">
                <div className="param-panel-title">Timeline · <b>Zoom</b></div>
                <div className="param-chip-row" id="tl-zoom">
                  <span className="param-chip" data-zoom="1" data-picked="true">1×</span>
                  <span className="param-chip" data-zoom="2">2×</span>
                  <span className="param-chip" data-zoom="4">4×</span>
                </div>
                <div className="param-tl-ruler">
                  <span>0s</span><span>5s</span><span>10s</span><span>15s</span>
                </div>
              </div>

              {/* Watermark preset picker (flowWatermark) */}
              <div className="param-panel" id="param-panel-watermark" data-visible="false">
                <div className="param-panel-title">Watermark · <b>Preset</b></div>
                <div className="param-wm-row" id="wm-cards">
                  <div className="param-wm-card" data-idx="0" data-wm-pos="br">
                    <span className="param-wm-mini"></span>
                    <span className="param-wm-chip"></span>
                    <span className="param-wm-cap">BR · 60</span>
                  </div>
                  <div className="param-wm-card" data-idx="1" data-wm-pos="bl">
                    <span className="param-wm-mini"></span>
                    <span className="param-wm-chip"></span>
                    <span className="param-wm-cap">BL · 90</span>
                  </div>
                  <div className="param-wm-card" data-idx="2" data-wm-pos="bar">
                    <span className="param-wm-mini"></span>
                    <span className="param-wm-chip"></span>
                    <span className="param-wm-cap">Bar</span>
                  </div>
                </div>
                <div className="param-row">
                  <span className="param-label">Handle</span>
                  <span className="param-input">liquidclips.app/<b>@you</b></span>
                </div>
                <div className="param-row">
                  <span className="param-label">QR</span>
                  <span className="param-chip" id="wm-qr" data-on="true">On</span>
                </div>
                <div className="param-stats">
                  <span>324 views</span><span>4 signups</span><span><b>MRR live</b></span>
                </div>
              </div>

              {/* Campaign picker chip row (flowCampaign) */}
              <div className="param-panel" id="param-panel-campaign" data-visible="false">
                <div className="param-panel-title">Campaign · <b>Pick</b></div>
                <div className="param-chip-row" id="camp-picker">
                  <span className="param-chip" data-camp="uncle" data-picked="true">Uncle Daniel · 015</span>
                  <span className="param-chip" data-camp="tasty">TastyBites · 042</span>
                  <span className="param-chip" data-camp="demo">LC demo · 007</span>
                </div>
              </div>

              {/* Trim controls panel (flowTrim) */}
              <div className="param-panel" id="param-panel-trim" data-visible="false">
                <div className="param-panel-title">Trim · <b>Selection</b></div>
                <div className="param-row">
                  <span className="param-label">Start</span>
                  <span className="param-input" id="trim-start" style={{ textAlign: "center" }}>00:12.480</span>
                </div>
                <div className="param-row">
                  <span className="param-label">End</span>
                  <span className="param-input" id="trim-end" style={{ textAlign: "center" }}>00:40.960</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Duration</span>
                  <span className="param-num" style={{ width: "auto", color: "var(--fuchsia)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>00:28.480</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Speed</span>
                  <div className="param-slider" id="trim-speed-slider"><div className="param-slider-fill" style={{ "--v": "33%" } as React.CSSProperties}></div><div className="param-slider-handle" style={{ "--v": "33%" } as React.CSSProperties}></div></div>
                  <span className="param-num" id="trim-speed-num">1.0×</span>
                </div>
                <div className="param-chip-row">
                  <span className="param-chip" id="trim-silence" data-on="true">Remove silence</span>
                  <span className="param-chip" id="trim-tighten">Auto-tighten</span>
                </div>
              </div>

              {/* Split-screen orientation + audio track (extended · when layout multi) */}
              <div className="param-panel" id="param-panel-split" data-visible="false">
                <div className="param-panel-title">Split · <b>Options</b></div>
                <div className="param-row">
                  <span className="param-label">Orient</span>
                  <span className="param-chip" data-split-orient="tb" data-picked="true">Top / Bot</span>
                  <span className="param-chip" data-split-orient="lr">Left / Right</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Audio</span>
                  <span className="param-chip" data-split-audio="source" data-picked="true">Source</span>
                  <span className="param-chip" data-split-audio="voiceover">VO</span>
                  <span className="param-chip" data-split-audio="mixed">Mixed</span>
                  <span className="param-chip" data-split-audio="muted">Muted</span>
                </div>
                <div className="param-row">
                  <span className="param-label">Captions</span>
                  <span className="param-chip" id="split-caps" data-on="true">On</span>
                </div>
              </div>

              {/* ============================================================ */}
              {/* ASK PANEL · Kade-asks reusable multiple-choice (v5)          */}
              {/* Confidence router surfaces this when a param is unresolved. */}
              {/* ============================================================ */}
              <div className="ask-panel" id="ask-panel" data-visible="false" role="dialog" aria-label="Kade asks">
                <div className="ask-panel-header">
                  <span className="ask-panel-eb">KADE ASKS</span>
                  <span className="ask-panel-title" id="ask-panel-title">Which layout?</span>
                </div>
                <div className="ask-panel-options" id="ask-panel-options" data-count="2">
                  {/* Populated at runtime · 2 options by default */}
                </div>
                <div className="ask-panel-hint" id="ask-panel-hint">Tap one · Kade continues.</div>
              </div>

              {/* Kade avatar */}
              <div className="kade" id="kade" style={{ transform: "translate(20px, 340px)" }}>
                <img id="kade-img" src="/brand/kade/kade-idle.webp" alt="Kade" />
              </div>

              {/* Library modal (Flow 4) */}
              <div className="library-modal" id="library-modal">
                <div className="library-header">
                  <div className="library-title">Library · <b>Hormozi + SaaS</b></div>
                  <button className="library-close" id="library-close">Close</button>
                </div>
                <div className="library-grid" id="library-grid">
                  <button className="library-tile" data-idx="0">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Free content is your best sales rep</div>
                  </button>
                  <button className="library-tile" data-idx="1">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Why your SaaS pricing is wrong</div>
                  </button>
                  <button className="library-tile" data-idx="2">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">The one lever most founders miss</div>
                  </button>
                  <button className="library-tile" data-idx="3">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Selling to devs vs. buyers</div>
                  </button>
                  <button className="library-tile" data-idx="4">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Small teams win in SaaS. Here's why.</div>
                  </button>
                  <button className="library-tile" data-idx="5">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Churn is a leadership problem</div>
                  </button>
                  <button className="library-tile" data-idx="6">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Building distribution before the product</div>
                  </button>
                  <button className="library-tile" data-idx="7">
                    <div className="library-tile-thumb"></div>
                    <div className="library-tile-channel">@Hormozi</div>
                    <div className="library-tile-title">Free trials vs. paid pilots</div>
                  </button>
                </div>
                <div className="library-moments" id="library-moments" hidden>
                  {/* Populated when a tile is selected */}
                </div>
              </div>

            </div>
          </div>

          {/* Side panel */}
          <aside className="side-panel">
            <div className="side-panel-header">Kade · <b>Standby</b></div>
            <div className="side-panel-body">
              <div className="kade-status-card is-big">
                <div className="kade-status-thumb is-big">
                  <img id="kade-status-img" src="/brand/kade/kade-base.png" alt="Kade" />
                </div>
                <div className="kade-status-text">
                  <span className="kade-status-label">Doing</span>
                  <span className="kade-status-doing" id="kade-status-doing">Waiting for you.</span>
                </div>
              </div>

              <div className="side-section-title">Quick actions</div>

              <button className="quick-action" data-flow="discovery">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
                </span>
                <span className="quick-action-text">Find 3 clips from footage</span>
              </button>

              <button className="quick-action" data-flow="reaction">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="M22 7l-6 5 6 5V7z"/></svg>
                </span>
                <span className="quick-action-text">Add my reaction</span>
              </button>

              <button className="quick-action" data-flow="captions">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v14H8l-4 4z"/><path d="M8 10h2M12 10h4M8 14h6"/></svg>
                </span>
                <span className="quick-action-text">Style captions</span>
              </button>

              <button className="quick-action" data-flow="library">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h13v14H4z"/><path d="M7 3h13v13"/></svg>
                </span>
                <span className="quick-action-text">Find clip in library</span>
              </button>

              <button className="quick-action" data-flow="campaign">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h13l3 3v13H4z"/><path d="M8 10h8M8 14h6"/></svg>
                </span>
                <span className="quick-action-text">Match this brief</span>
              </button>

              <button className="quick-action" data-flow="record">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="14" height="14" rx="2"/><circle cx="10" cy="12" r="3" fill="currentColor"/><path d="M21 8v8"/></svg>
                </span>
                <span className="quick-action-text">Record my screen</span>
              </button>

              <button className="quick-action" data-flow="reactionsDeep">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h3l3-6 4 12 3-8 2 4h3"/></svg>
                </span>
                <span className="quick-action-text">Lock reaction to beat</span>
              </button>

              <button className="quick-action" data-flow="frame">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M7 10h10M7 14h6"/></svg>
                </span>
                <span className="quick-action-text">Add hook text</span>
              </button>

              <button className="quick-action" data-flow="audio">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h3l3-8 4 16 3-10 3 2h1"/></svg>
                </span>
                <span className="quick-action-text">Duck the audio</span>
              </button>

              <button className="quick-action" data-flow="timeline">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="1.5" fill="currentColor"/><circle cx="14" cy="12" r="1.5" fill="currentColor"/><circle cx="10" cy="18" r="1.5" fill="currentColor"/></svg>
                </span>
                <span className="quick-action-text">Show timeline</span>
              </button>

              <button className="quick-action" data-flow="watermark">
                <span className="quick-action-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM17 17h4v4h-4z"/></svg>
                </span>
                <span className="quick-action-text">Show my watermark</span>
              </button>

              <div className="side-section-title">Session</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <span className="canvas-tag" id="dialogue-count">Full dialogue</span>
                <span className="canvas-tag" id="turbo-tag">Standard</span>
              </div>
            </div>
          </aside>
        </div>

        {/* Tool panel */}
        <div className="tool-panel" id="tool-panel">
          <div className="tool-tabs">
            <div className="tool-tab" id="tool-panel-scope" style={{ cursor: "default", color: "var(--ink)", pointerEvents: "none" }}>
              <span id="tool-scope-label">Editing · <span style={{ color: "var(--fuchsia)" }}>no slot</span></span>
            </div>
            <button className="tool-tab" data-tool="trim" id="tab-trim">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M9 6L20 18M9 18L20 6"/></svg>
              Trim
            </button>
            <button className="tool-tab" data-tool="captions" id="tab-captions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 11h3M13 11h4M7 14h6"/></svg>
              Captions
            </button>
            <button className="tool-tab" data-tool="reactions" id="tab-reactions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="M22 7l-6 5 6 5V7z"/></svg>
              Reactions
            </button>
            <button className="tool-tab" data-tool="audio" id="tab-audio">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              Audio
            </button>
          </div>
          <div className="tool-body" id="tool-body">
            {/* Empty state */}
            <div className="tool-content" data-tool="empty" data-visible="true">
              <div className="tool-empty">Kade opens the tool he needs · Ask him something to begin.</div>
            </div>
            {/* Trim tool */}
            <div className="tool-content" data-tool="trim">
              <span className="tool-label">Selection</span>
              <div className="trim-timeline">
                <div className="trim-timeline-label">00:12 - 00:34</div>
                <div className="trim-timeline-fill"></div>
              </div>
              <button
                className="tool-preset"
                data-active={snapPreset === "snap-hook" ? "true" : undefined}
                onClick={() => setSnapPreset("snap-hook")}
              >
                Snap to hook
              </button>
            </div>
            {/* Captions tool */}
            <div className="tool-content" data-tool="captions">
              <span className="tool-label">Style</span>
              <button className="tool-preset is-bold-btn" id="cap-bold">B</button>
              <button className="tool-preset" id="cap-italic" style={{ fontStyle: "italic" }}>I</button>
              <span className="tool-label" style={{ marginLeft: "12px" }}>Color</span>
              <button className="tool-preset is-swatch" id="cap-white" style={{ "--sw": "#ffffff" } as React.CSSProperties}>White</button>
              <button className="tool-preset is-swatch" id="cap-fuchsia" style={{ "--sw": "#ff1a8c" } as React.CSSProperties}>Fuchsia</button>
              <button className="tool-preset is-swatch" id="cap-green" style={{ "--sw": "#3ad29f" } as React.CSSProperties}>Money</button>
            </div>
            {/* Reactions tool */}
            <div className="tool-content" data-tool="reactions">
              <span className="tool-label">Camera</span>
              <button className="record-btn" id="record-btn">
                <span className="record-dot"></span>
                Record
              </button>
              <span className="tool-label" style={{ marginLeft: "12px" }}>Placement</span>
              <button className="tool-preset" data-active={wmPreset === "tr" ? "true" : undefined} onClick={() => setWmPreset("tr")}>Top-right</button>
              <button className="tool-preset" data-active={wmPreset === "bl" ? "true" : undefined} onClick={() => setWmPreset("bl")}>Bottom-left</button>
              <button className="tool-preset" data-active={wmPreset === "br" ? "true" : undefined} onClick={() => setWmPreset("br")}>Corner-cam</button>
            </div>
            {/* Audio tool · additions v2 · scoped to selected slot */}
            <div className="tool-content" data-tool="audio">
              <span className="tool-label">Slot audio</span>
              <button className="audio-radio" data-audio="own"       data-active={audioPreset === "own" ? "true" : undefined} onClick={() => setAudioPreset("own")}>Own</button>
              <button className="audio-radio" data-audio="muted"     data-active={audioPreset === "muted" ? "true" : undefined} onClick={() => setAudioPreset("muted")}>Muted</button>
              <button className="audio-radio" data-audio="borrowed"  data-active={audioPreset === "kade" ? "true" : undefined} onClick={() => setAudioPreset("kade")}>Borrow</button>
              <button className="audio-radio" data-audio="voiceover" data-active={audioPreset === "kade" ? "true" : undefined} onClick={() => setAudioPreset("kade")}>Voiceover</button>
            </div>
          </div>
        </div>

        {/* Command bar area */}
        <div className="command-area">
          <div className="history-strip" id="history-strip">
            <span className="history-label">Recent</span>
            <span className="history-empty">No asks yet · try one from the side panel or type below.</span>
          </div>
          {/* v5 · low-confidence test commands · these trip the ASK panel */}
          <div className="history-strip" id="ask-test-strip" style={{ marginTop: "2px" }}>
            <span className="history-label">Ask tests</span>
            <button className="history-chip" type="button" data-ask-test="add my reaction"><span className="history-chip-num">?</span>add my reaction</button>
            <button className="history-chip" type="button" data-ask-test="record"><span className="history-chip-num">?</span>record</button>
            <button className="history-chip" type="button" data-ask-test="watermark"><span className="history-chip-num">?</span>watermark</button>
          </div>
          <div className="command-bar">
            <span className="command-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H8l-4 4z"/></svg>
            </span>
            <input
              ref={commandInputRef}
              className="command-input"
              id="command-input"
              type="text"
              placeholder="Type or speak · Try 9:16 · 16:9 · give me 3 clips · add my reaction"
              autoComplete="off"
              spellCheck="false"
            />
            <button
              className="command-mic"
              id="command-mic"
              title={listening ? "Stop listening" : "Voice"}
              data-active={listening ? "true" : undefined}
              aria-pressed={listening}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>
            </button>
            <button className="command-send" id="command-send">Send</button>
          </div>
        </div>

      </div>
    </div>
  </div>

  {/* ============================================================ */}
  {/*                    BASE WINDOW JSON DEV PANEL                  */}
  {/* S12 · dev-only. Enable via `?dev=1` or                          */}
  {/* localStorage `lc:composer.showdev=1`. Hidden in production.    */}
  {/* ============================================================ */}
  {isDev && (
    <div className="dev-panel" id="dev-panel" data-collapsed="false">
      <div className="dev-header" id="dev-header">
        <div className="dev-title">Base Window · JSON</div>
        <button className="dev-toggle" id="dev-toggle">Hide</button>
      </div>
      <div className="dev-mutation" id="dev-mutation" style={{ display: "none" }}>Ready</div>
      <div className="dev-body" id="dev-body">
        <pre id="dev-json"></pre>
      </div>
    </div>
  )}

  {/* Toast */}
  <div className="toast" id="toast"></div>

  {/* First-load Kade intro overlay · additions v2 (1.5s) */}
  <div className="kade-intro" id="kade-intro">
    <div className="kade-intro-portrait">
      <img src="/brand/kade/kade-base.png" alt="Kade" />
    </div>
    <div className="kade-intro-line">Hey · I'm <b>Kade</b>. What are we cutting?</div>
  </div>

    </div>
  );
}
