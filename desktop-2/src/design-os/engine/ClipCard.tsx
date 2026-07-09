/**
 * ClipCard · UI-3 upgrade
 *
 * Adds the working surface a clipper needs without losing the existing
 * viewing surface:
 *   - status badge (Draft / Ready / Scheduled / Posted / Submitted)
 *   - per-clip platform picker (existing badges become a button)
 *   - CTA row · Edit / Export / Post / Submit · gated by status + mode
 *
 * Outer shell switched from <button> to <div role="button"> so nested action
 * buttons no longer trip React's validateDOMNesting warning.
 *
 * Mock-only · status mutations fire bus events for downstream listeners
 * (Earn ledger row, Submissions Review feed) but do NOT call the sidecar.
 */

import { useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { GlassCard } from "../components";
import { bus, useEvent, useMode } from "../bridge";
import { getClipCardFallback } from "../assets/assetRegistry";
import type { Clip, Platform } from "./types";

// BUG-027 · Grid tiles render the sidecar-generated thumbnail PNG, not the
// mp4. A <video preload="metadata"> never paints pixels — only the header
// loads. The shipping desktop/ shell uses this same <img> pattern for all
// grid surfaces (LibraryClipStrip, ResultsGrid). Fallback chain:
// thumbnails[rank 1].path → poster_path → null (renders nothing).
function clipPosterPath(clip: Clip): string | null {
  if (clip.thumbnails && clip.thumbnails.length > 0) {
    const best = [...clip.thumbnails].sort((a, b) => a.rank - b.rank)[0];
    if (best?.path) return best.path;
  }
  return clip.poster_path ?? null;
}
import {
  STATUS_LABEL, STATUS_TONE, ctaVisibilityFor, nextStatusFor,
  type ClipStatus,
} from "./clipCardStatus";
import { PlatformPickerPopover } from "./PlatformPickerPopover";
import { PlatformGlyph } from "../../components/PlatformBadge";
import "./ClipCard.css";

export interface ClipCardProps {
  clip: Clip;
  selected?: boolean;
  focused?: boolean;
  onSelect?: (clip: Clip) => void;
  onOpen?: (clip: Clip) => void;
  /** Phase 6J-C · icon-first "schedule this clip" quick action. */
  onSchedule?: (clip: Clip) => void;
  /** Used by the workbench / multi-select header to show selection. */
  showSelection?: boolean;
}

export function ClipCard({
  clip, selected = false, focused = false,
  onSelect, onOpen, onSchedule,
  showSelection,
}: ClipCardProps) {
  const [platformsOpen, setPlatformsOpen] = useState(false);
  // Local status mirrors `clip.status` but lets UI-3 mutations land
  // immediately without round-tripping through a parent store. The fixture
  // seed primes this; Batch D swaps the source.
  const [status, setStatus] = useState<ClipStatus>(clip.status ?? "draft");
  const [platforms, setPlatforms] = useState<Platform[]>(clip.platforms ?? []);
  const mode = useMode();
  const [posterError, setPosterError] = useState(false);

  // Pick up status flips from other surfaces (Submit-to-Whop modal, etc).
  useEvent("clip:status-change", (p) => {
    if (p.clipIdx === clip.idx) setStatus(p.status as ClipStatus);
  });

  // 2026-06-23 · platform-targets changed elsewhere (editor picker in
  // ClipPreviewShell). Mirror into local state so the grid chips stay in
  // sync with the editor. One source of truth lives on the bus until the
  // sidecar setClipPlatforms RPC lands.
  useEvent("clip:platforms-change", (p) => {
    if (p.clipIdx === clip.idx) setPlatforms(p.platforms);
  });

  // Checkpoint item 5 · distinguish "no score" (render `—`, dim tone)
  // from "score is 0" (real value). Normalizer guarantees clip.score is
  // finite-or-undefined; undefined = absent.
  const hasScore = typeof clip.score === "number";
  const score = hasScore ? (clip.score as number) : 0;
  const scoreDisplay: number | string = hasScore ? score : "—";
  const tone = !hasScore
    ? "dim"
    : score >= 85 ? "fx" : score >= 70 ? "cy" : score >= 55 ? "amber" : "dim";

  const flip = (action: "edit" | "schedule" | "post" | "submit") => {
    const next = nextStatusFor(action, status);
    if (next !== status) {
      setStatus(next);
      bus.emit("clip:status-change", { clipIdx: clip.idx, status: next });
    }
  };

  const cta = ctaVisibilityFor(status);
  // Agency mode hides the Submit-to-Whop affordance (it's a clipper action).
  const showSubmitChrome = mode === "clipper" && cta.showSubmit;

  // Stage B-1 · clip-card fallback art is registry-driven (was a CSS
  // `:nth-child(6n+N)` cycle in ClipCard.css). The 6-pose Kade cycle is
  // keyed off `clip.idx` so the same clip always shows the same fallback
  // pose — stable visual identity rather than positional churn. The real
  // poster <img> below still wins when present; the fallback only shows
  // through the preview's background when posterPath is null OR the img
  // errors out.
  const fallbackAsset = getClipCardFallback(Math.max(0, clip.idx));
  const previewStyle: CSSProperties = {
    ["--lc-clip-fallback-url" as string]: `url(${fallbackAsset.publicPath})`,
  };

  return (
    <GlassCard
      density="default"
      className={`lc-clip-card lc-clip-tone-${tone} ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
      hoverLift
      data-testid="clip-card"
      data-clip-idx={clip.idx}
    >
      <div
        role="button"
        tabIndex={0}
        className="lc-clip-shell"
        data-testid="clip-shell"
        onClick={() => onOpen?.(clip)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(clip); }
        }}
      >
        {/* ───── IRON GATE IG-LC2-015 — see docs/lc2/IRON_GATES_LC2.md ─────
            Grid tiles render the sidecar's PNG thumbnail via <img>. NEVER
            <video> for grid display — <video preload="metadata"> loads
            headers but never decodes pixels, so tiles stay black (see
            BUG-027 in desktop-2/docs/BUGS_ERRORS_FIXES.md). Video belongs
            ONLY in the single-clip editor pane, after user click. Mirrors
            desktop/src/components/projects/LibraryClipStrip.tsx:244. */}
        <div
          className="lc-clip-preview"
          style={previewStyle}
          data-clip-fallback-id={fallbackAsset.id}
          data-clip-fallback-resolved="1"
        >
          {(() => {
            const posterPath = clipPosterPath(clip);
            if (!posterPath || posterError) return null;
            return (
              <img
                className="lc-clip-video"
                src={convertFileSrc(posterPath)}
                alt=""
                draggable={false}
                onError={() => setPosterError(true)}
              />
            );
          })()}
          {/* ───── END IRON GATE IG-LC2-015 ───── */}

          {/* Status badge · top-left (UI-3) */}
          <span
            className={`lc-clip-status lc-clip-status-${STATUS_TONE[status]}`}
            aria-label={`Status · ${STATUS_LABEL[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>

          {/* Virality score · top-right (existing) */}
          <div className={`lc-clip-score lc-clip-score-${tone}`}>
            <span className="lc-clip-score-num">{scoreDisplay}</span>
            <span className="lc-clip-score-unit">LC</span>
          </div>

          {/* Platform badges bottom-left — now a button that opens the picker.
              2026-06-23 · text-letter glyphs ("Y","T","I","X") replaced with
              brand SVG badges (PlatformGlyph). Daniel: "Use real brand icons,
              not text letters." */}
          <button
            type="button"
            className="lc-clip-platforms"
            onClick={(e) => { e.stopPropagation(); setPlatformsOpen((v) => !v); }}
            aria-expanded={platformsOpen}
            aria-label="Change target platforms"
          >
            {platforms.length === 0 && (
              <span className="lc-clip-platform-empty">+ Platform</span>
            )}
            {platforms.slice(0, 4).map((p) => (
              <span
                key={p}
                className={`lc-clip-platform lc-clip-platform-${p}`}
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  color: "white",
                  ...(p === "instagram"
                    ? { background: "linear-gradient(135deg, #FED373, #F15245 50%, #D92E7F)" }
                    : { backgroundColor: p === "youtube" ? "#FF0000" : "#000000" }),
                }}
              >
                <span style={{ width: "60%", height: "60%", display: "flex" }}>
                  <PlatformGlyph id={p} />
                </span>
              </span>
            ))}
          </button>
          {platformsOpen && (
            <PlatformPickerPopover
              value={platforms}
              onChange={(next) => {
                setPlatforms(next);
                bus.emit("clip:platforms-change", { clipIdx: clip.idx, platforms: next });
              }}
              onClose={() => setPlatformsOpen(false)}
            />
          )}

          {/* Selection check */}
          {showSelection && (
            <button
              type="button"
              className="lc-clip-checkbox"
              onClick={(e) => { e.stopPropagation(); onSelect?.(clip); }}
              aria-label={selected ? "Deselect clip" : "Select clip"}
            >
              {selected ? "✓" : ""}
            </button>
          )}

          {/* Quick-schedule glyph */}
          {onSchedule && (
            <button
              type="button"
              className="lc-clip-sched"
              onClick={(e) => { e.stopPropagation(); onSchedule(clip); flip("schedule"); }}
              aria-label="Schedule this clip"
              title="Schedule this clip"
            >
              <span aria-hidden="true">⏱</span>
            </button>
          )}
        </div>

        {/* Title + breakdown */}
        <div className="lc-clip-meta">
          <h3 className="lc-clip-title" title={clip.title}>{clip.title}</h3>
          {clip.score_reason && (
            <p className="lc-clip-reason" title={clip.score_reason}>
              {clip.score_reason}
            </p>
          )}
          {clip.score_breakdown && (
            <div className="lc-clip-breakdown">
              {(["hook", "retention", "clarity", "shareability"] as const).map((k) => {
                const v = clip.score_breakdown?.[k];
                if (v == null) return null;
                return (
                  <span key={k} className="lc-clip-sub" title={`${k}: ${v}`}>
                    <span className="lc-clip-sub-k">{k[0].toUpperCase()}</span>
                    <span className="lc-clip-sub-v">{v}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* UI-3 · CTA row · 2026-07-09 button audit: dead Post + dead Export
          * on clip card removed. Real export lives in dedicated ExportRoute.
          * Local-clip access affordances added: Reveal in Finder + Copy path.
          * Files are already on disk after clipping — these buttons act on
          * the existing local file, not a re-render. */}
        <div className="lc-clip-ctas" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="lc-clip-cta"
            onClick={(e) => {
              e.stopPropagation();
              flip("edit");
              onOpen?.(clip);
              // BUG-031 · force-open CockpitDock and land on Reaction. The
              // onOpen callback above sets focusedClipIdx in Workstation; the
              // bus event tells the dock to expand + switch tab in parallel.
              bus.emit("clip:open-edit", { clipIdx: clip.idx });
              // Recovery brief P0 · Daniel's clipping-suite model. Fires
              // local_clip_open_clicked with the real file path (if present)
              // so we can pair it with an lstat/exists proof downstream.
              void (async () => {
                try {
                  const mod = await import("../../lib/diagnosticLogger");
                  const path = clip.vertical_path || (clip as { cut_path?: string }).cut_path || null;
                  mod.lcDiag("local_clip_open_clicked", {
                    clip_idx: clip.idx,
                    path: path ? String(path).slice(0, 200) : null,
                    path_present: !!path,
                  });
                } catch { /* non-fatal */ }
              })();
            }}
          >Open clip</button>
          <button
            type="button"
            className="lc-clip-cta"
            title="Reveal the exported file in Finder"
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                const path = clip.vertical_path || (clip as { cut_path?: string }).cut_path || null;
                try {
                  const diagMod = await import("../../lib/diagnosticLogger");
                  diagMod.lcDiag("local_clip_reveal_clicked", {
                    clip_idx: clip.idx,
                    path: path ? String(path).slice(0, 200) : null,
                    path_present: !!path,
                  });
                  if (!path) {
                    // No exported file yet (never baked, or session hasn't
                    // hydrated). Clipper-voice one-liner.
                    bus.emit("toast", {
                      kind: "warning",
                      title: "Clip not exported yet",
                      body: "Bake this source first — nothing on disk to reveal.",
                    });
                    return;
                  }
                  const sidecarMod = await import("./sidecar-stub");
                  const r = await sidecarMod.exportApi.revealInFinder(path);
                  diagMod.lcDiag("local_clip_reveal_result", {
                    clip_idx: clip.idx,
                    revealed: r?.revealed ?? false,
                    reason: (r as { reason?: string })?.reason ?? null,
                  });
                  // Emit the ACCEPTANCE-TEST marker only when reveal
                  // actually landed (proves the file existed for Finder to point at).
                  if (r?.revealed) {
                    diagMod.lcDiag("local_clip_access_proven", {
                      clip_idx: clip.idx,
                      via: "reveal_in_finder",
                      path: String(path).slice(0, 200),
                    });
                  } else if ((r as { reason?: string })?.reason === "not_found") {
                    // 2026-07-09 · scenario #7 · file-missing customer-safe
                    // toast. Path stays in the diagnostic ring; user sees
                    // a one-liner in clipper voice.
                    bus.emit("toast", {
                      kind: "warning",
                      title: "Clip file missing",
                      body: "That clip was moved or deleted. Re-run the source to rebuild it.",
                    });
                  }
                } catch (err) {
                  try {
                    const diagMod = await import("../../lib/diagnosticLogger");
                    diagMod.lcDiag("local_clip_reveal_error", {
                      clip_idx: clip.idx,
                      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
                    });
                    // Route through customer-safe classifier so no raw
                    // plugin / tauri error string reaches the toast body.
                    const safeMod = await import("../errors/customerSafeErrors");
                    const safe = safeMod.humanErrorToast(err, { scenario: "reveal" });
                    bus.emit("toast", { kind: safe.kind, title: safe.title, body: safe.body });
                  } catch { /* non-fatal */ }
                }
              })();
            }}
          >Reveal in Finder</button>
          <button
            type="button"
            className="lc-clip-cta"
            title="Copy the file path to clipboard"
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                const path = clip.vertical_path || (clip as { cut_path?: string }).cut_path || null;
                try {
                  const diagMod = await import("../../lib/diagnosticLogger");
                  diagMod.lcDiag("local_clip_copy_path_clicked", {
                    clip_idx: clip.idx,
                    path: path ? String(path).slice(0, 200) : null,
                    path_present: !!path,
                  });
                  if (!path) {
                    bus.emit("toast", {
                      kind: "warning",
                      title: "Clip not exported yet",
                      body: "Bake this source first — no path to copy.",
                    });
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(String(path));
                    diagMod.lcDiag("local_clip_access_proven", {
                      clip_idx: clip.idx,
                      via: "copy_path_clipboard",
                      path: String(path).slice(0, 200),
                    });
                    bus.emit("toast", {
                      kind: "success",
                      title: "Path copied",
                      body: String(path).split("/").pop() ?? "Clip path in clipboard.",
                    });
                  } catch (clipErr) {
                    diagMod.lcDiag("local_clip_copy_path_error", {
                      clip_idx: clip.idx,
                      error: clipErr instanceof Error ? clipErr.message.slice(0, 120) : String(clipErr).slice(0, 120),
                    });
                    bus.emit("toast", {
                      kind: "warning",
                      title: "Copy didn't work",
                      body: "Your browser blocked clipboard access. Try again from the app.",
                    });
                  }
                } catch { /* non-fatal */ }
              })();
            }}
          >Copy path</button>
          {showSubmitChrome && (
            <button
              type="button"
              className={`lc-clip-cta lc-clip-cta-primary ${cta.submitDisabled ? "is-done" : ""}`}
              disabled={cta.submitDisabled}
              onClick={(e) => {
                e.stopPropagation();
                if (!cta.submitDisabled) bus.emit("clip:open-submit", { clipIdx: clip.idx });
              }}
            >
              {cta.submitDisabled ? "Submitted" : "Submit to Whop"}
            </button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

