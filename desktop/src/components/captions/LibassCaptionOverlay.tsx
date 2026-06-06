import { useEffect, useMemo, useRef } from "react";
import type { CaptionLine } from "../../lib/captions";

// libass-wasm overlay — renders the actual ASS file from the sidecar bake
// over the playing video, pixel-identical to the exported MP4. Replaces the
// DOM-approximation CaptionOverlay for the post-Apply preview path so
// "preview looks like export" stops being a class of bugs.
//
// The DOM CaptionOverlay still handles three cases the wasm path can't:
//   1. Static thumbnails in CaptionStyleCard (no <video> to attach to)
//   2. Live edits BEFORE the first bake (no ass_text yet)
//   3. Reduced-motion fallback (we ship the DOM path with karaoke fill off)
//
// Lens-flagged races, all handled here:
//   • <video> remount on cache-bust → effect re-keys on videoEl ref
//   • Worker leak on close → dispose() runs in cleanup
//   • Reduced-motion → skip wasm init entirely; parent renders DOM overlay
//
// Tauri CSP needs `'wasm-unsafe-eval'` and `worker-src 'self' blob:` in
// tauri.conf.json — already shipped alongside this component.

type Octopus = {
  setTrack: (subContent: string) => void;
  dispose: () => void;
};

type OctopusConstructor = new (opts: {
  video: HTMLVideoElement;
  subContent: string;
  workerUrl: string;
  legacyWorkerUrl: string;
  fonts?: string[];
}) => Octopus;

let cachedFactory: OctopusConstructor | null = null;

async function loadOctopus(): Promise<OctopusConstructor> {
  if (cachedFactory) return cachedFactory;
  // libass-wasm ships as a UMD bundle keyed on `SubtitlesOctopus`. Dynamic
  // import keeps the ~1MB wasm out of the initial bundle — clippers who
  // never open the editor never pay the load cost.
  // @ts-expect-error — libass-wasm has no shipped types.
  const mod = await import("libass-wasm");
  cachedFactory = (mod.default ?? mod) as OctopusConstructor;
  return cachedFactory;
}

export function LibassCaptionOverlay({
  videoRef,
  assText,
  // Lines + style kept for type parity with the DOM overlay so the parent
  // doesn't have to branch — libass-wasm reads everything from `assText`.
  lines: _lines,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  assText: string;
  lines: CaptionLine[];
}) {
  const octopusRef = useRef<Octopus | null>(null);

  // Re-init the worker whenever the <video> element changes (ClipPreview
  // remounts the video on cache-bust via `key={videoSrc}`) OR the ASS text
  // changes (a re-bake produced new colours / lines / timing).
  useEffect(() => {
    if (!videoRef.current || !assText) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // Reduced-motion: skip the karaoke animation. Parent should render the
      // DOM overlay instead — we just bail out cleanly.
      return;
    }

    let cancelled = false;
    let local: Octopus | null = null;
    void (async () => {
      try {
        const Factory = await loadOctopus();
        if (cancelled || !videoRef.current) return;
        // Vite resolves the worker + wasm to bundled URLs. Both files ship
        // in node_modules/libass-wasm/dist/js/. ?url + ?worker hints would
        // be cleaner but the package's worker file already accepts being
        // served as a plain static asset.
        const workerUrl = new URL(
          "../../../node_modules/libass-wasm/dist/js/subtitles-octopus-worker.js",
          import.meta.url,
        ).toString();
        const legacyWorkerUrl = new URL(
          "../../../node_modules/libass-wasm/dist/js/subtitles-octopus-worker-legacy.js",
          import.meta.url,
        ).toString();
        local = new Factory({
          video: videoRef.current,
          subContent: assText,
          workerUrl,
          legacyWorkerUrl,
        });
        if (cancelled) {
          local.dispose();
          return;
        }
        octopusRef.current = local;
      } catch (e) {
        // Silent fall-through — DOM overlay still mounts as the fallback in
        // the parent, so a wasm init failure just degrades preview fidelity.
        console.warn("[captions] libass-wasm init failed", e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        local?.dispose();
        octopusRef.current?.dispose();
      } catch {
        // Disposal can throw if the worker died mid-flight — swallow.
      }
      octopusRef.current = null;
    };
  }, [videoRef, assText]);

  // Visually-hidden mirror of the active caption text for screen readers —
  // canvas overlays expose no semantics. Picks the line at currentTime
  // exactly like the DOM overlay so AT users hear what sighted users see.
  const ariaText = useAriaCaptionText(videoRef, _lines);

  return (
    <p
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: 0,
      }}
    >
      {ariaText}
    </p>
  );
}

function useAriaCaptionText(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  lines: CaptionLine[],
): string {
  // Cheap rAF poll — Octopus draws every frame anyway, so adding a separate
  // rAF for the SR mirror is in the same magnitude. The string only changes
  // on line boundary so the aria-live announcement throttles itself.
  const textRef = useRef("");
  const force = useRef(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = videoRef.current?.currentTime ?? 0;
      const active = lines.find((ln) => t >= ln.start && t < ln.end);
      const next = active?.text ?? "";
      if (next !== textRef.current) {
        textRef.current = next;
        force.current += 1;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, lines]);
  return useMemo(() => textRef.current, [force.current]);
}
