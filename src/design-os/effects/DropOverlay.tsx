/**
 * DropOverlay · global file-drop affordance
 *
 * Phase 6B infrastructure. Mounted once at AppShell root.
 *   - Subscribes to Tauri 2 `getCurrentWebview().onDragDropEvent()` for native
 *     OS drag-drop (file paths arrive directly — no FormData).
 *   - Falls back to HTML5 dragenter/dragover/drop on non-Tauri runtimes
 *     (vite dev in browser) so dev preview still demos the affordance.
 *   - Renders NOTHING until a drag is in progress.
 *   - On drop: emits `bus.emit("source:drop", { paths })`. Routes
 *     (CreateClips, ClippingEngine) subscribe via useEvent to react.
 *   - prefers-reduced-motion + body.rm disable the cyan pulse.
 *
 * Phase 6B does NOT mount a consumer — the bus channel fires into the void
 * until CreateClips (Phase 6C step 9) subscribes.
 */

import { useEffect, useState } from "react";
import { bus } from "../bridge";
import "./DropOverlay.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function DropOverlay() {
  const [hovering, setHovering] = useState(false);

  // ---- Tauri 2 native drag-drop ----
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const mod = await import("@tauri-apps/api/webview");
        const webview = mod.getCurrentWebview();
        const handle = await webview.onDragDropEvent((e) => {
          const t = e.payload.type;
          if (t === "enter" || t === "over") {
            setHovering(true);
          } else if (t === "leave") {
            setHovering(false);
          } else if (t === "drop") {
            setHovering(false);
            const payload = e.payload as { type: "drop"; paths: string[] };
            if (payload.paths && payload.paths.length > 0) {
              bus.emit("source:drop", { paths: payload.paths });
            }
          }
        });
        if (cancelled) {
          handle();
        } else {
          unlisten = handle;
        }
      } catch (err) {
        console.warn("[DropOverlay] Tauri drag-drop unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ---- HTML5 fallback (dev preview in a browser) ----
  useEffect(() => {
    if (window.__TAURI_INTERNALS__) return;

    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setHovering(true);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setHovering(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      depth = 0;
      setHovering(false);
      // Browser fallback emits filenames only — full paths require the
      // Tauri runtime. Useful for dev visualization, not for ingest.
      const paths = Array.from(e.dataTransfer.files).map((f) => f.name);
      bus.emit("source:drop", { paths });
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (!hovering) return null;

  return (
    <div className="lc-drop-overlay" aria-hidden="true">
      <div className="lc-drop-overlay-inner">
        <div className="lc-drop-overlay-ring" />
        <span className="lc-drop-overlay-eb">Source bay</span>
        <span className="lc-drop-overlay-title">Drop to ingest</span>
        <span className="lc-drop-overlay-sub">I'll scan it and find the moments.</span>
      </div>
    </div>
  );
}
