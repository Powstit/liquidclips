/**
 * ClipPreviewShell · Phase 6D Studio main preview
 *
 * Ported from desktop/src/components/ClipPreview.tsx (modal editor section
 * 1: left video pane + right metadata pane). Phase 6D keeps the data shape
 * (Clip type, ratio chips, virality breakdown) and presentation rewritten
 * against Design OS surfaces.
 *
 * Behaviour:
 *   - Renders preview + metadata for the passed `clip` prop.
 *   - When no clip → empty state with "Open Engine" CTA so the user gets
 *     back to picking a candidate.
 *   - Ratio chips switch between 9:16 · 1:1 · 16:9 (visual swap only —
 *     no transcode trigger; real ratio swap requires sidecar runtime).
 *   - No lucide, no motion/react, no tailwind utility classes.
 */

import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { GlassCard } from "../components";
import { bus, useEvent } from "../bridge";
import type { Clip, Platform } from "../engine/types";
import { useTierCaps } from "../state/useTierCaps";
import { CockpitContextOptional } from "../engine/cockpit/CockpitContext";
import { PlatformBadgePicker } from "../../components/PlatformBadge";
import { exportApi } from "../engine/sidecar-stub";
import "./ClipPreviewShell.css";

export type ClipRatio = "9:16" | "1:1" | "16:9";

export interface ClipPreviewShellProps {
  clip: Clip | null;
  /** Called when the user clicks "Open Engine" from the empty state. */
  onGoEngine?: () => void;
  /** 2026-08-08 · project.source_path, for "Reveal source" — distinct from
   *  the clip's own vertical_path (revealed via ClipCard's own button).
   *  Undefined for fixture/preview data or if the session hasn't hydrated
   *  a project yet; the button falls back to an honest "not available"
   *  toast rather than pretending to work. */
  sourcePath?: string | null;
}

export function ClipPreviewShell({ clip, onGoEngine, sourcePath }: ClipPreviewShellProps) {
  const [ratio, setRatio] = useState<ClipRatio>("9:16");
  // 2026-06-23 · platform targets · single source of truth via bus.
  // Seed from clip.platforms when the focused clip changes; mutations
  // emit clip:platforms-change so ClipCard (grid chips) stays in sync.
  const [platforms, setPlatforms] = useState<Platform[]>(clip?.platforms ?? []);
  useEffect(() => {
    setPlatforms(clip?.platforms ?? []);
  }, [clip?.idx, clip?.platforms]);
  useEvent("clip:platforms-change", (p) => {
    if (clip && p.clipIdx === clip.idx) setPlatforms(p.platforms);
  });
  // BUG-036 · watermark single source of truth. The preview badge MUST
  // reflect the EFFECTIVE export decision, not just the tier flag. The
  // PublishModule computes the same decision via `deriveWatermarkPromise`;
  // here we mirror its logic so the badge cannot disagree with the export.
  //
  //   Free tier              → badge always shown.
  //   Paid tier + toggle on  → badge shown.
  //   Paid tier + toggle off → badge hidden.
  //   Unknown / loading      → badge shown (safe — export will burn watermark).
  const tier = useTierCaps();
  const cockpit = useContext(CockpitContextOptional);
  const userChoiceWatermark = cockpit?.settings.publish.watermark ?? true;
  const effectiveWatermark = (() => {
    if (tier.loading) return true;
    if (tier.source === "unknown" || tier.source === "unavailable") return true;
    if (tier.caps.watermarkLocked) return true;
    return userChoiceWatermark;
  })();
  const showWatermark = effectiveWatermark;

  // ───── IRON GATE IG-LC2-018 — see BUG-032 P0 ─────
  // The shell is also rendered in TimelineStudio (no CockpitProvider),
  // so `cockpit` is null there and `reaction` is undefined — the unbaked
  // reaction overlay simply doesn't mount in that context. `cockpit`
  // was already resolved above for the watermark decision; reuse it.
  const reaction = cockpit?.settings.reaction;
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);
  const reactionVideoRef = useRef<HTMLVideoElement | null>(null);
  const splitLayout = !!reaction && isSplitLayout(reaction.layout);
  useEffect(() => {
    const main = mainVideoRef.current;
    const secondary = reactionVideoRef.current;
    if (!main || !secondary || !reaction?.syncPlayback || !splitLayout) return;
    const align = () => {
      const target = Math.max(0, main.currentTime + reaction.brollOffsetS);
      if (Math.abs(secondary.currentTime - target) > 0.25) secondary.currentTime = target;
    };
    const play = () => {
      align();
      void secondary.play().catch(() => undefined);
    };
    const pause = () => secondary.pause();
    main.addEventListener("play", play);
    main.addEventListener("pause", pause);
    main.addEventListener("seeking", align);
    return () => {
      main.removeEventListener("play", play);
      main.removeEventListener("pause", pause);
      main.removeEventListener("seeking", align);
    };
  }, [reaction?.syncPlayback, reaction?.brollOffsetS, splitLayout, clip?.idx]);
  // ───── END IRON GATE IG-LC2-018 (preview overlay read) ─────

  if (!clip) return <ClipPreviewEmpty onGoEngine={onGoEngine} />;

  return (
    /* Checkpoint item 3 · container queries must run on an ANCESTOR of
       the element they style. Previously .lc-cps carried
       `container-type` and was also the target of @container cps → the
       element cannot query itself. .lc-cps-host is a semantic-free
       wrapper that owns the container declaration so the query hits
       .lc-cps as a descendant. */
    <div className="lc-cps-host">
    <section className="lc-cps">
      {/* Left · video preview */}
      <GlassCard density="default" className="lc-cps-pane lc-cps-preview">
        <header className="lc-cps-pane-head">
          <span className="lc-cps-pane-eb">Preview</span>
          <div className="lc-cps-ratios" role="tablist">
            {(["9:16", "1:1", "16:9"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={ratio === r}
                className={`lc-cps-ratio ${ratio === r ? "is-active" : ""}`}
                onClick={() => setRatio(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </header>

        <div
          className={`lc-cps-stage lc-cps-stage-${ratio.replace(":", "-")}`}
          data-composite-layout={reaction?.layout ?? "solo"}
          data-swap-panes={reaction?.swapPanes ? "1" : "0"}
          data-testid="preview-stage"
          data-watermark-visible={String(showWatermark)}
          data-watermark-tier-source={tier.source}
          data-watermark-tier={tier.tier}
        >
          {clip.vertical_path ? (
            // ───── IRON GATE IG-LC2-017 — see docs/lc2/IRON_GATES_LC2.md ─────
            // Focused-clip preview is the inverse of the grid-tile primitive
            // (see IG-LC2-015 + BUG-027): tiles render <img poster>, focused
            // editor renders <video>. `key` forces remount when the user
            // switches clips so the new src actually loads. Mirrors
            // desktop/src/components/ClipPreview.tsx:812. Never replace this
            // with <img>, never bypass convertFileSrc, never accept a raw
            // clip.vertical_path. See BUG-028 AFTER FIX.
            <>
              <video
                ref={mainVideoRef}
                key={clip.vertical_path}
                className="lc-cps-poster lc-cps-main-video"
                style={reaction && isSplitLayout(reaction.layout)
                  ? splitPaneStyle("main", reaction.layout, reaction.swapPanes)
                  : undefined}
                src={reactionOverlaySrc(clip.vertical_path)}
                controls
                autoPlay
                loop
                muted
                playsInline
              />
              {showWatermark && (
                <span
                  className="lc-cps-watermark"
                  data-testid="preview-watermark-badge"
                  aria-hidden="true"
                >
                  Liquid<span className="lc-cps-watermark-em">Clips</span>
                </span>
              )}
              {/* BUG-032 P0 · unbaked reaction overlay. Shown only when the
                  customer has picked a reaction file via ReactionModule, and
                  the chosen layout is non-solo. The overlay is muted +
                  autoplay so the customer sees the layout instantly,
                  without controls that could distract from the main clip.
                  After Apply Bake, the engine:complete{kind:"bake"} handler
                  refetches the project and the main `<video>` source flips
                  to the baked path — at which point this overlay continues
                  to render in mock mode but in real-sidecar mode the
                  customer sees the baked result directly in the main video. */}
              {reaction && reaction.sourcePath && reaction.layout !== "solo" && (
                <video
                  ref={reactionVideoRef}
                  key={reaction.sourcePath + reaction.layout}
                  className={`lc-cps-reaction lc-cps-reaction-${reaction.layout}`}
                  style={isSplitLayout(reaction.layout)
                    ? splitPaneStyle("reaction", reaction.layout, reaction.swapPanes)
                    : undefined}
                  src={reactionOverlaySrc(reaction.sourcePath)}
                  data-testid="reaction-overlay"
                  data-reaction-layout={reaction.layout}
                  controls={splitLayout}
                  autoPlay
                  loop
                  muted={reaction.audioSource !== "broll"}
                  playsInline
                  aria-label="Unbaked reaction preview"
                />
              )}
            </>
          ) : (
            <div className="lc-cps-no-poster">
              <span className="lc-cps-no-poster-eb">No render yet</span>
              <span className="lc-cps-no-poster-body">
                Preview lands when the sidecar runtime renders this ratio.
              </span>
            </div>
          )}
        </div>

        <footer className="lc-cps-pane-foot">
          <span className="lc-cps-time">
            {formatTime(clip.start)} – {formatTime(clip.end)} · {clip.duration_s ?? clip.end - clip.start}s
          </span>
        </footer>
      </GlassCard>

      {/* Right · metadata + actions */}
      <GlassCard density="default" className="lc-cps-pane lc-cps-meta">
        <header className="lc-cps-pane-head">
          <span className="lc-cps-pane-eb">Clip · #{clip.idx}</span>
          {/* Checkpoint item 5 · absent-value contract. Normalizer
              guarantees `clip.score` is either a finite number or
              undefined; render `—` explicitly instead of `0` so the
              customer can distinguish "we didn't score this" from
              "score = 0". Also fixes the ARIA label. */}
          <div
            className="lc-cps-score"
            aria-label={
              typeof clip.score === "number"
                ? `Virality score ${clip.score}`
                : "Virality score unavailable"
            }
          >
            <span className="lc-cps-score-num">
              {typeof clip.score === "number" ? clip.score : "—"}
            </span>
            <span className="lc-cps-score-unit">LC</span>
          </div>
        </header>

        <h3 className="lc-cps-title">{clip.title}</h3>

        {clip.score_reason && (
          <p className="lc-cps-reason">{clip.score_reason}</p>
        )}

        {clip.score_breakdown && (
          <div className="lc-cps-breakdown">
            {(["hook", "retention", "clarity", "shareability"] as const).map((k) => {
              const v = clip.score_breakdown?.[k];
              if (v == null) return null;
              return (
                <div key={k} className="lc-cps-sub">
                  <span className="lc-cps-sub-k">{k}</span>
                  <span className="lc-cps-sub-bar">
                    <span className="lc-cps-sub-fill" style={{ width: `${v}%` }} />
                  </span>
                  <span className="lc-cps-sub-v">{v}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 2026-06-23 · interactive picker replaces the display-only
            chip strip. Sits in the right metadata pane mirroring the
            OLD desktop ClipPreview.tsx PlatformBadgePicker placement.
            NOT tier-gated; tier-gating belongs at publish/connect time.
            Emits clip:platforms-change so ClipCard grid chips stay in
            sync with this picker. */}
        <div className="lc-cps-platforms">
          <PlatformBadgePicker
            selected={platforms}
            onToggle={(p) => {
              const next = platforms.includes(p)
                ? platforms.filter((x) => x !== p)
                : [...platforms, p];
              setPlatforms(next);
              bus.emit("clip:platforms-change", { clipIdx: clip.idx, platforms: next });
            }}
            testId="cps-platform-picker"
          />
        </div>

        <div className="lc-cps-actions">
          <button
            type="button"
            className="lc-cps-action lc-cps-action-quiet"
            onClick={async () => {
              // 2026-08-08 · wired to the real reveal call — was a stub
              // toast that never actually opened Finder. Mirrors the
              // tri-state pattern already used by ClipCard / ExportProgress
              // (revealed / not_found / error / not_wired) so failures are
              // told to the user honestly instead of collapsed into one
              // generic message.
              if (!sourcePath) {
                bus.emit("toast", {
                  kind: "warning",
                  title: "No source on file",
                  body: "This project doesn't have a source video path yet.",
                });
                return;
              }
              try {
                const r = await exportApi.revealInFinder(sourcePath);
                if (r.revealed) return;
                if (r.reason === "not_found") {
                  bus.emit("toast", {
                    kind: "warning",
                    title: "Source file missing",
                    body: "That source was moved or deleted.",
                  });
                } else if (r.reason === "error") {
                  bus.emit("toast", { kind: "error", title: "Reveal failed", body: r.error ?? "Unknown error" });
                }
              } catch (err) {
                bus.emit("toast", {
                  kind: "error",
                  title: "Reveal failed",
                  body: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            Reveal source
          </button>
          <button
            type="button"
            className="lc-cps-action"
            onClick={async () => {
              // 2026-08-08 · wired to the real save-copy call — was a stub
              // toast that never opened a save dialog. Copies the clip's
              // rendered output (vertical_path — always ffmpeg-encoded
              // h264, matches what the preview above actually plays),
              // falling back to cut_path only if reframe hasn't landed yet.
              const path = clip?.vertical_path || (clip as { cut_path?: string } | null)?.cut_path;
              if (!path) {
                bus.emit("toast", {
                  kind: "warning",
                  title: "Clip not exported yet",
                  body: "Bake this source first — nothing on disk to copy.",
                });
                return;
              }
              try {
                const r = await exportApi.saveCopyAs(path);
                if (r.dest) {
                  bus.emit("toast", { kind: "success", title: "Copy saved", body: r.dest.split("/").pop() ?? r.dest });
                } else if (r.reason === "not_found") {
                  bus.emit("toast", { kind: "error", title: "Source file missing", body: "The clip file was moved or deleted." });
                } else if (r.reason === "error") {
                  bus.emit("toast", { kind: "error", title: "Save failed", body: r.error ?? "Unknown copy error" });
                } else if (r.reason === "cancelled") {
                  bus.emit("toast", { kind: "info", title: "Save cancelled", body: "No destination selected." });
                }
              } catch (err) {
                bus.emit("toast", {
                  kind: "error",
                  title: "Save failed",
                  body: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            Save copy as…
          </button>
        </div>
      </GlassCard>
    </section>
    </div>
  );
}

function ClipPreviewEmpty({ onGoEngine }: { onGoEngine?: () => void }) {
  return (
    <GlassCard density="default" className="lc-cps-empty">
      <span className="lc-cps-empty-eb">Studio deck · empty</span>
      <h2 className="lc-cps-empty-h">No clip selected.</h2>
      <p className="lc-cps-empty-sub">
        Pick a candidate from Clipping Engine first. Studio opens the selected
        clip with trim, captions, layout, and export controls.
      </p>
      <button type="button" className="lc-cps-empty-cta" onClick={onGoEngine}>
        Open Clipping Engine
      </button>
    </GlassCard>
  );
}

/**
 * BUG-032 P0 · runtime-correct `<video src>`. Tauri-written filesystem
 * paths must go through `convertFileSrc` to reach the asset:// protocol;
 * relative/public paths (FIXTURE clip.vertical_path = "/brand/...") and
 * blob/http URLs must NOT — they're served directly by the dev server
 * or the page itself. Outside Tauri (the user-lens harness running
 * against Vite dev), `convertFileSrc` throws on the global window's
 * missing `__TAURI_INTERNALS__`, which crashes the entire preview shell
 * (the harness caught this).
 */
function reactionOverlaySrc(sourcePath: string): string {
  if (sourcePath.startsWith("blob:") || sourcePath.startsWith("http")) {
    return sourcePath;
  }
  // Relative public-asset paths (bundled fixtures like "/brand/...") —
  // leave them alone; the dev server (and Tauri's webview) both resolve
  // them from the bundle. 2026-08-07 · was `startsWith("/")`, which ALSO
  // matched every real absolute macOS filesystem path (vertical_path is
  // always "/Users/.../LiquidClips/..."), skipping convertFileSrc
  // entirely and leaving the raw fs path as <video src> — the WebView
  // can't resolve that, so real clips rendered a black frame with the
  // "can't play" icon. Narrowed to the actual fixture prefix.
  if (sourcePath.startsWith("/brand/")) return sourcePath;
  // Absolute filesystem paths only reach this branch (Tauri runtime).
  // If we're outside Tauri this would throw — but in that case the
  // sourcePath would not be an absolute filesystem path anyway (the
  // harness uses blob URLs via ReactionModule's runtime split).
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    return sourcePath;
  }
  return convertFileSrc(sourcePath);
}

function splitPaneStyle(
  pane: "main" | "reaction",
  layout: "side-by-side" | "top-bottom",
  swapped: boolean,
): CSSProperties {
  const mainFirst = swapped;
  const isFirst = pane === "main" ? mainFirst : !mainFirst;
  if (layout === "side-by-side") {
    return {
      position: "absolute",
      top: 0,
      right: "auto",
      bottom: "auto",
      left: isFirst ? 0 : "50%",
      width: "50%",
      height: "100%",
    };
  }
  return {
    position: "absolute",
    top: isFirst ? 0 : "50%",
    right: "auto",
    bottom: "auto",
    left: 0,
    width: "100%",
    height: "50%",
  };
}

function isSplitLayout(
  layout: string,
): layout is "side-by-side" | "top-bottom" {
  return layout === "side-by-side" || layout === "top-bottom";
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
