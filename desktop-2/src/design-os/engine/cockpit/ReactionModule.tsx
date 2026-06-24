/**
 * ReactionModule · cockpit · UI-2 + BUG-032 P0
 *
 * Picks how the clip frames the speaker (solo / split-screen / picture-in-
 * picture corners), picks the reaction source clip, and fires
 * `sidecar.startOverlayBake` so the bake replaces the clip's `vertical_path`
 * with the reaction-baked MP4. Persistence + per-clip restore are owned by
 * `CockpitContext` (BUG-031 Patch A).
 */

import { useEffect, useRef, useState } from "react";
import { useCockpit, type ReactionLayoutKey, type ReactionAudioSource } from "./CockpitContext";
import { sidecar } from "../sidecar-stub";
import { bus, useEvent } from "../../bridge";
import { useEngineSession } from "../../state/useEngineSession";
import { notify as inboxNotify } from "../../../inbox";
import "./modules.css";

interface LayoutOption {
  id: ReactionLayoutKey;
  label: string;
  glyph: JSX.Element;
}

const LAYOUTS: ReadonlyArray<LayoutOption> = [
  { id: "solo",   label: "Solo",       glyph: <LayoutGlyph kind="solo" /> },
  { id: "split",  label: "Split",      glyph: <LayoutGlyph kind="split" /> },
  { id: "pip-tl", label: "PIP · top L", glyph: <LayoutGlyph kind="pip-tl" /> },
  { id: "pip-tr", label: "PIP · top R", glyph: <LayoutGlyph kind="pip-tr" /> },
  { id: "pip-bl", label: "PIP · bot L", glyph: <LayoutGlyph kind="pip-bl" /> },
  { id: "pip-br", label: "PIP · bot R", glyph: <LayoutGlyph kind="pip-br" /> },
];

const AUDIO_SOURCES: ReadonlyArray<{ id: ReactionAudioSource; label: string }> = [
  { id: "main",   label: "Main clip" },
  { id: "broll",  label: "Reaction" },
  { id: "muted",  label: "Muted" },
];

export function ReactionModule() {
  const { focusedClip, settings, setReaction } = useCockpit();
  const { layout, frameAtS, sourcePath, audioSource, brollOffsetS } = settings.reaction;

  const session = useEngineSession();
  const slug = session.project?.slug ?? session.slug ?? undefined;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "saving" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bakeState, setBakeState] = useState<"idle" | "baking" | "done" | "error">("idle");
  const [bakeError, setBakeError] = useState<string | null>(null);

  // Clear the "Baked" pill the next time the customer touches anything.
  useEffect(() => {
    if (bakeState !== "done") return;
    const t = window.setTimeout(() => setBakeState("idle"), 2400);
    return () => window.clearTimeout(t);
  }, [bakeState]);

  // Bake completion is signalled by the existing engine bus. The
  // useEngineSession hook ALREADY refetches the project on `kind:"bake"`
  // and dispatches hydrate_project (state/useEngineSession.ts:269-291), so
  // focusedClip.vertical_path updates without any work from this module.
  // We only flip our local busy pill.
  useEvent("engine:complete", (p) => {
    if (p.kind !== "bake") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setBakeState("done");
    /* FEATURE-001 · in-app only (default policy doesn't email this). */
    inboxNotify({
      kind: "reaction-bake-complete",
      title: "Reaction baked",
      body: "Vertical clip with your reaction overlay is ready to export.",
    });
  });

  useEvent("engine:error", (p) => {
    if (p.kind !== "bake") return;
    if (p.slug !== slug) return;
    if (typeof p.idx === "number" && p.idx !== focusedClip.idx) return;
    setBakeState("error");
    setBakeError(p.human ?? p.error ?? "Bake failed");
  });

  // Synthesize 3 frame anchors across the clip duration.
  const frames = [
    focusedClip.start,
    Math.round((focusedClip.start + focusedClip.end) / 2),
    focusedClip.end,
  ];

  async function onFilePicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow re-pick of the same file
    if (!file) return;

    setUploadState("saving");
    setUploadError(null);
    try {
      // BUG-032 P0 · Runtime split. In Tauri (production) we write the
      // file under AppData via plugin-fs and pass the abs path to the
      // sidecar so ffmpeg can read it. Outside Tauri (the user-lens
      // harness running against Vite dev) we use a blob: URL — the
      // preview overlay accepts it directly, and the mock-mode sidecar
      // does not actually call ffmpeg so the path doesn't need to be on
      // disk. Production behaviour unchanged.
      const sourcePath = isTauriRuntime()
        ? await writeReactionToAppData(file, slug, focusedClip.idx)
        : URL.createObjectURL(file);

      setReaction({ sourcePath });
      // Promote layout off "solo" so the customer sees the overlay land
      // immediately. Defaults to PIP-BR which is the least intrusive.
      if (layout === "solo") setReaction({ layout: "pip-br" });

      setUploadState("idle");
      bus.emit("toast", {
        kind: "success",
        title: "Reaction added",
        body: `${file.name} ready for bake.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUploadError(msg);
      setUploadState("error");
      bus.emit("toast", {
        kind: "error",
        title: "Reaction upload failed",
        body: msg.slice(0, 140),
      });
    }
  }

  function isTauriRuntime(): boolean {
    if (typeof window === "undefined") return false;
    return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  }

  async function writeReactionToAppData(file: File, slugIn: string | undefined, clipIdx: number): Promise<string> {
    // Imports are dynamic so the Tauri-only modules never resolve in the
    // pure-browser harness context. Vite tree-shakes the path that's
    // never reached.
    const [{ writeFile, mkdir, BaseDirectory }, { appDataDir, join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dotIdx = file.name.lastIndexOf(".");
    const ext = (dotIdx >= 0 ? file.name.slice(dotIdx + 1) : "mp4").toLowerCase();
    const ts = Date.now();
    const safeSlug = (slugIn ?? "no-slug").replace(/[^a-z0-9-_]/gi, "_");
    const relDir = "Liquid Clips/reactions";
    const filename = `${safeSlug}_${clipIdx}_${ts}.${ext}`;
    const relPath = `${relDir}/${filename}`;
    await mkdir(relDir, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeFile(relPath, bytes, { baseDir: BaseDirectory.AppData });
    const appDir = await appDataDir();
    return await join(appDir, relDir, filename);
  }

  async function onApply() {
    if (!slug) {
      bus.emit("toast", {
        kind: "error",
        title: "No project bound",
        body: "Generate clips first, then add a reaction.",
      });
      return;
    }
    if (!sourcePath) {
      bus.emit("toast", {
        kind: "info",
        title: "Pick a reaction first",
        body: "Choose a video file before baking.",
      });
      return;
    }

    setBakeState("baking");
    setBakeError(null);
    try {
      await sidecar.startOverlayBake(slug, focusedClip.idx, {
        type: layout,
        source_path: sourcePath,
        start_offset_s: brollOffsetS,
        audio_source: audioSource,
      });
      // Completion flips bakeState→"done" via the useEvent listener above.
      // If the sidecar is mocked, completion lands in ~1.4s (sidecar-stub.ts:336).
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBakeState("error");
      setBakeError(msg);
    }
  }

  function onClearReaction() {
    setReaction({ sourcePath: null });
  }

  const reactionFilename = sourcePath ? sourcePath.split("/").pop() : null;
  const canBake = !!sourcePath && bakeState !== "baking" && uploadState !== "saving";

  return (
    <section className="lc-cd-mod">
      {/* LEFT · controls */}
      <div>
        <header className="lc-cd-mod-head">
          <span className="lc-cd-mod-eb">Reaction</span>
          <span className="lc-cd-mod-sub">Add a second clip. Pick a layout, then a source.</span>
        </header>

        <div className="lc-cd-section">
          <span className="lc-cd-lbl">Layout</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Reaction layout">
            {LAYOUTS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={layout === opt.id}
                className={`lc-cd-chip ${layout === opt.id ? "on" : ""}`}
                onClick={() => setReaction({ layout: opt.id })}
              >
                <span className="lc-cd-react-glyph">{opt.glyph}</span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* BUG-032 P0 · reaction source picker. Hidden native input is
            triggered by the visible button so the dialog opens with no
            visible browser-chrome leak. */}
        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <span className="lc-cd-lbl">Source</span>
          <input
            ref={fileInputRef}
            data-testid="reaction-file-input"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"
            style={{ display: "none" }}
            onChange={onFilePicked}
          />
          <div className="lc-cd-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="reaction-choose"
              className="lc-cd-chip"
              disabled={uploadState === "saving"}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadState === "saving" ? "Saving…" : sourcePath ? "Replace file…" : "Choose reaction file…"}
            </button>
            {sourcePath && (
              <button type="button" className="lc-cd-chip" onClick={onClearReaction}>
                Clear
              </button>
            )}
            {reactionFilename && (
              <span style={{ fontSize: 11, color: "#c8c4be", alignSelf: "center", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {reactionFilename}
              </span>
            )}
          </div>
          {uploadError && (
            <span style={{ fontSize: 11, color: "#ff7aa0", marginTop: 6, display: "block" }}>
              {uploadError}
            </span>
          )}
        </div>

        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <span className="lc-cd-lbl">Audio</span>
          <div className="lc-cd-row" role="radiogroup" aria-label="Reaction audio source">
            {AUDIO_SOURCES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={audioSource === opt.id}
                className={`lc-cd-chip ${audioSource === opt.id ? "on" : ""}`}
                onClick={() => setReaction({ audioSource: opt.id })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <span className="lc-cd-lbl">Reaction start offset</span>
          <div className="lc-cd-row" style={{ alignItems: "center", gap: 10 }}>
            <input
              type="range"
              min={-15}
              max={15}
              step={0.5}
              value={brollOffsetS}
              onChange={(e) => setReaction({ brollOffsetS: Number(e.target.value) })}
              style={{ width: 200 }}
              aria-label="Reaction start offset in seconds"
            />
            <span style={{ fontSize: 11, color: "#c8c4be", minWidth: 56 }}>
              {brollOffsetS > 0 ? "+" : ""}{brollOffsetS.toFixed(1)}s
            </span>
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 16 }}>
          <span className="lc-cd-lbl">Hero frame</span>
          <div className="lc-cd-row">
            {frames.map((s, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={frameAtS === s}
                className={`lc-cd-chip ${frameAtS === s ? "on" : ""}`}
                onClick={() => setReaction({ frameAtS: s })}
              >
                Frame · {fmtSec(s)}
              </button>
            ))}
          </div>
        </div>

        <div className="lc-cd-section" style={{ marginTop: 18 }}>
          <button
            type="button"
            data-testid="reaction-apply"
            data-bake-state={bakeState}
            className={`lc-cd-chip ${canBake ? "on" : ""}`}
            disabled={!canBake}
            onClick={onApply}
            style={{ minWidth: 160, justifyContent: "center" }}
          >
            {bakeState === "baking" ? "Baking reaction…" : bakeState === "done" ? "Baked ✓" : "Apply reaction"}
          </button>
          {bakeError && (
            <span style={{ fontSize: 11, color: "#ff7aa0", marginLeft: 12 }}>
              {bakeError}
            </span>
          )}
        </div>
      </div>

      {/* RIGHT · readout */}
      <div className="lc-cd-readout" aria-label="Reaction summary">
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Layout</span>
          <span className="lc-cd-readout-val">{labelFor(layout)}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Source</span>
          <span className="lc-cd-readout-val" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {reactionFilename ?? "—"}
          </span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Audio</span>
          <span className="lc-cd-readout-val">{AUDIO_SOURCES.find((a) => a.id === audioSource)?.label}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Offset</span>
          <span className="lc-cd-readout-val">{brollOffsetS > 0 ? "+" : ""}{brollOffsetS.toFixed(1)}s</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Hero frame</span>
          <span className="lc-cd-readout-val">{fmtSec(frameAtS)}</span>
        </div>
        <div className="lc-cd-readout-row">
          <span className="lc-cd-readout-key">Clip</span>
          <span className="lc-cd-readout-val">{focusedClip.title}</span>
        </div>
      </div>
    </section>
  );
}

function labelFor(k: ReactionLayoutKey): string {
  return LAYOUTS.find((l) => l.id === k)?.label ?? k;
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/* Tiny inline glyph showing the layout — pure SVG primitives. */
function LayoutGlyph({ kind }: { kind: ReactionLayoutKey }) {
  const stroke = "currentColor";
  const inner = "rgba(255, 26, 140, .85)";
  return (
    <svg viewBox="0 0 24 16" width="22" height="14" fill="none" stroke={stroke} strokeWidth="1.4">
      <rect x="1" y="1" width="22" height="14" rx="1.6" />
      {kind === "split" && <line x1="12" y1="1" x2="12" y2="15" stroke={inner} strokeWidth="1.4" />}
      {kind === "pip-tl" && <rect x="2.4" y="2.4" width="6.5" height="5" rx="1" fill={inner} stroke="none" />}
      {kind === "pip-tr" && <rect x="15.1" y="2.4" width="6.5" height="5" rx="1" fill={inner} stroke="none" />}
      {kind === "pip-bl" && <rect x="2.4" y="8.6" width="6.5" height="5" rx="1" fill={inner} stroke="none" />}
      {kind === "pip-br" && <rect x="15.1" y="8.6" width="6.5" height="5" rx="1" fill={inner} stroke="none" />}
    </svg>
  );
}
