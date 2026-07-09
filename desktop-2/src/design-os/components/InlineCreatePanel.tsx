/**
 * InlineCreatePanel · slide-up Home panel
 *
 * Ports the canonical inline URL/import panel from
 *   desktop/docs/demo.html §653–732
 * into the live shell. Three tabs (URL · Upload · Library), Generate 10/30/100
 * chips, and the signature stage-by-stage analysis sequence.
 *
 * Wires directly to Batch B RPC wrappers — no new sidecar contracts. Clip-count
 * intent is passed through the existing `brief` field on `ingest_url`/`start_run`.
 *
 * Open / close is driven by `bus.emit("home:open-panel", { tab })` from Home
 * tiles. The component also handles its own Esc / backdrop dismissal.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bus, useEvent } from "../bridge";
import { sidecar } from "../engine/sidecar-stub";
import { notify as inboxNotify } from "../../inbox";
import {
  startPersistedSession,
} from "../state/engineSessionPersistence";
import { STAGE_ORDER, type StageName } from "../engine/types";
import { useModalPortal, useRegisterModal } from "./ModalPortal";
// Watchdog Rollout · cp-02 (2026-07-06) · wraps InlineCreatePanel so a
// crash inside the URL-ingest / project-create flow renders
// KadeRepairScreen instead of the silent-empty black panel that Claude 2
// flagged. Pairs with cp-01 (Workstation) to close the "renders nothing"
// bug family. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./InlineCreatePanel.css";

// UX-4 · Library tab removed (it duplicated the My Clips tile). Script tab
// added as an honest stub so the affordance is reserved without inventing
// functionality.
type Tab = "url" | "upload" | "script";
// IMPORT-CREATE-RECONCILE-2 (2026-06-20) · operator direction restored:
// product needs three count selectors — 10 · 30 · 100 — plus the Open
// Engine jump. Chip text reads as a selector ("{n} clips"), not as an
// action verb. See BUGS_ERRORS_FIXES.md BUG-008/009/010/012.
type Count = 10 | 30 | 100;
const COUNT_OPTIONS: ReadonlyArray<Count> = [10, 30, 100];
type Phase = "idle" | "running" | "done" | "error";

/** Cheap pre-flight: does the pasted string look like an HTTP(S) URL we can
 *  realistically ingest? Keeps obvious "yo" / "test" submissions from
 *  reaching the sidecar where they'd run a full mock pipeline against nothing. */
function looksLikeIngestableUrl(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 8) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch { return false; }
}

// IMPORT-CREATE-RECONCILE-1 · spec asks for exactly four progress beats:
// Reading transcript · Finding hooks · Cutting clips · {N} clips landed.
// The fourth beat is the `done` phase below, so the running list collapses
// the seven sidecar stages into three visible rows. Mapping is by stage
// position in STAGE_ORDER — any active stage inside a group lights the
// group, any later stage marks earlier groups done.
interface StageGroup {
  id: "transcript" | "hooks" | "cutting";
  label: string;
  stages: ReadonlyArray<StageName>;
}
const STAGE_GROUPS: ReadonlyArray<StageGroup> = [
  { id: "transcript", label: "Reading transcript", stages: ["ingest", "audio", "transcribe"] },
  { id: "hooks",      label: "Finding hooks",      stages: ["llm"] },
  { id: "cutting",    label: "Cutting clips",      stages: ["cut", "reframe", "thumbs"] },
];

function stageGroupState(
  group: StageGroup,
  activeStage: StageName | null,
): "done" | "active" | "pending" {
  if (!activeStage) return "pending";
  const activeIdx = STAGE_ORDER.indexOf(activeStage);
  const groupIndexes = group.stages.map((s) => STAGE_ORDER.indexOf(s));
  const groupMin = Math.min(...groupIndexes);
  const groupMax = Math.max(...groupIndexes);
  if (activeIdx > groupMax) return "done";
  if (activeIdx >= groupMin) return "active";
  return "pending";
}

export function InlineCreatePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  // 2026-06-25 · lane-1 acceptance criterion · "Editor shows an 'imported
  // from browser' chip below the source chipbar." The flag flips true when
  // lc:browse-url-handoff fires + clears when the user types a fresh URL.
  const [importedFromBrowser, setImportedFromBrowser] = useState(false);
  const [count, setCount] = useState<Count>(30);
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeStage, setActiveStage] = useState<StageName | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Portal target — escapes the legacy `.lc-section` containing block (which
  // has `transform`+`filter` baked in) so `position: fixed` on the root
  // anchors to the viewport, not the section.
  const modalHost = useModalPortal();
  // BUG-008/009/010/012 · register with the portal so `lc-modal-portal-root`
  // becomes `data-modal-active="1"` (pointer-events: auto · aria-hidden: false)
  // while open. Removes the WKWebView pointer-events fragility that other
  // registered modals (ThumbnailPromptPreview, UploadPortal, AddAccountPopover)
  // avoid by registering. Esc handling stays inline below; we pass an empty
  // onEscape so the portal's top-of-stack handler is a no-op for this panel.
  useRegisterModal({ id: "inline-create-panel", open });

  /* Open from tiles. Tile name maps to tab. */
  useEvent("home:open-panel", (p) => {
    setOpen(true);
    setTab(p.tab ?? "url");
    setPhase("idle");
    setActiveStage(null);
    setDoneCount(null);
    setErrorMsg(null);
    setUrlError(null);
    // Defer focus until after the slide-in starts.
    window.setTimeout(() => inputRef.current?.focus(), 80);
  });

  /* 2026-06-26 · close on navigation away from home. Without this the
   * full-screen scrim stays mounted while the user navigates via
   * ConsoleNav, blocking clicks on chrome (avatar, browse tab, etc.).
   * Real-user UX: navigating away should dismiss the modal. Phase
   * "running" is preserved (active analysis stays visible). The "home"
   * + "create" + "import" SimulatorRouter aliases re-trigger
   * home:open-panel via onArrive, so they re-open immediately. */
  useEvent("route:enter", ({ route }) => {
    if (route === "home") return;
    setOpen((wasOpen) => {
      if (!wasOpen) return false;
      // Don't kill an in-flight analysis · user can navigate back.
      return phase === "running";
    });
  });

  /* DEV-only screenshot hook · lets the headless harness open the panel
   *  imperatively without firing a real DOM click (which would race the
   *  scrim's mouseup-to-close handler). Stripped in production builds by
   *  Vite's import.meta.env.DEV gate. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    interface DevHookWindow extends Window {
      __lc_dev_open_panel?: (tab?: Tab) => void;
    }
    (window as DevHookWindow).__lc_dev_open_panel = (tab) => {
      setOpen(true);
      setTab(tab ?? "url");
      setPhase("idle");
      setActiveStage(null);
      setDoneCount(null);
      setErrorMsg(null);
      setUrlError(null);
    };
    return () => {
      delete (window as DevHookWindow).__lc_dev_open_panel;
    };
  }, []);

  /* 2026-06-24 · listen for the lc:browse-url-handoff CustomEvent that the
   * BrowseOverlay dispatches when the user clicks "Use in Engine" on a raw
   * URL. We auto-open the panel on the URL tab + pre-fill the URL field so
   * the clipper can hit Generate immediately. */
  useEffect(() => {
    const onHandoff = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string; source?: string }>).detail;
      const incoming = detail?.url?.trim();
      if (!incoming) return;
      setOpen(true);
      setTab("url");
      setUrl(incoming);
      setImportedFromBrowser(true);
      setUrlError(null);
      setErrorMsg(null);
      setPhase("idle");
    };
    window.addEventListener("lc:browse-url-handoff", onHandoff);
    return () => window.removeEventListener("lc:browse-url-handoff", onHandoff);
  }, []);

  /* Esc dismisses when idle (running sequence is non-dismissible by Esc). */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase]);

  /* Engine progress drives the analysis sequence reveal. */
  useEvent("engine:progress", (p) => {
    if (phase !== "running") return;
    if (STAGE_ORDER.includes(p.stage as StageName)) {
      setActiveStage(p.stage as StageName);
    }
  });
  useEvent("engine:complete", (p) => {
    if (phase !== "running") return;
    // D1.patch · `kind: "ingest"` only signals download finished; the chained
    // `start_run` then drives audio→transcribe→llm→cut→reframe→thumbs and
    // emits `kind: "pick"` when the full clipping pipeline is done. THAT's
    // the moment the user gets clips, so that's when we route to workstation.
    if (p.kind === "pick") {
      setPhase("done");
      setDoneCount(count);
      /* FEATURE-001 · clip generation complete · email-worthy. */
      inboxNotify({
        kind: "clip-generation-complete",
        title: `${count} clips ready`,
        body: "Your clips are in My Clips · open the Workstation to review.",
        href: "#/workstation",
        ctaLabel: "Open Workstation",
      });
      // Hand the user off to the workstation after a brief beat.
      window.setTimeout(() => {
        bus.emit("nav:click", { route: "workstation" });
        close();
      }, 1400);
    }
  });

  /* engine:error — break the running phase, surface the human message,
   *  and re-enable close. Without this the panel would deadlock on every
   *  failed ingest (yt-dlp 403, geo-block, private video, sidecar-died). */
  useEvent("engine:error", (p) => {
    if (phase !== "running") return;
    setPhase("error");
    setErrorMsg(p.human ?? p.error ?? "Something went wrong. Try a different source.");
  });

  function close() {
    setOpen(false);
    // Reset local state but leave phase alone in case engine is still mid-flight.
    setUrl("");
    setUrlError(null);
  }

  function retry() {
    setPhase("idle");
    setActiveStage(null);
    setErrorMsg(null);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }

  function analyze() {
    const raw = url.trim();
    if (!raw) return;
    if (!looksLikeIngestableUrl(raw)) {
      setUrlError("That doesn't look like a video URL — paste a YouTube, Drive, or direct https link.");
      return;
    }
    setUrlError(null);
    setPhase("running");
    setActiveStage("ingest");
    setErrorMsg(null);
    startPersistedSession(raw, { url: raw });
    // Phase 6E-Workstation-Frame · route the user into Workstation as
    // soon as Generate fires. The InlineCreatePanel modal stays open
    // (portal-rendered above the route), so its progress UI keeps
    // running, but the chrome behind it now shows the live session in
    // the title bar (WORKSTATION · running · <stage>) — a browser/OS
    // tab feel during generation. Workstation already gates render on
    // `session.phase` from useEngineSession, which the tauri-adapter
    // bridges from sidecar:stage_progress events.
    bus.emit("nav:click", { route: "workstation" });
    // BUG-029.6 · Kade-ignition immediate trigger. The session reducer only
    // flips phase to "running" on the first real `engine:progress` event,
    // which is gated on sidecar boot + yt-dlp start (1–3s). Emit a synthetic
    // ingest-progress now so phase flips on click. Real sidecar events
    // overwrite stage/percent/note/segments the moment they arrive. UI-only:
    // no engine, no sidecar, no RPC.
    bus.emit("engine:progress", { stage: "ingest", percent: null, url: raw });
    // Phase 6E-Engine-Chain (2026-06-20) — fresh-URL pipeline driver.
    //
    // PRIOR BUG: chain was `ingestUrl → pickMoreClips`, but
    // `start_pick_more_clips` (sidecar.py:1127) requires an existing
    // transcript.json. After a fresh ingest the project has only stage
    // "ingest" done — no transcript yet — so pickMoreClips immediately
    // raised FileNotFoundError. The panel stayed visually stuck on the
    // "Reading transcript" step because activeStage never advanced past
    // "ingest" (no later stage_progress event fires when the chain dies
    // at the first call).
    //
    // FIX: walk the post-ingest stages explicitly using the existing
    // `run_stage` RPC (sidecar.py:460). Each call is sync and emits
    // `stage_progress` events during execution; the panel listener moves
    // activeStage in real time. The sidecar dispatcher does block per
    // stage (transcribe ≈ 0.2× audio duration); a non-blocking driver
    // would be a future patch — IG-002 is preserved here (no method
    // rename, no payload change, no new RPC added — only the JS chain).
    //
    // FALLBACK: if pickMoreClips ever turns out to be a viable resume
    // path (project already has transcript), the catch is non-fatal —
    // the error surfaces via engine:error and the panel flips to "error"
    // with the human message instead of hanging.
    const POST_INGEST_STAGES: ReadonlyArray<StageName> = [
      "audio",
      "transcribe",
      "llm",
      "cut",
      "reframe",
      "thumbs",
    ];
    const brief = `Generate ${count} clips`;
    // Control Tower #4 · 2026-07-09 — client-generated run_id per attempt.
    const runId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // BUG-017 P2 · the brief stays as user-visible context; the structured
    // `count` carries the real signal into Project.clip_count → stage_llm
    // prompt. Without this 4th arg the sidecar fell back to the adaptive
    // 15-25 heuristic regardless of which chip the user clicked.
    sidecar.ingestUrl(raw, brief, "clips", count, runId)
      .then(async ({ project, downloaded_path }) => {
        const slug = project?.slug;
        if (!slug) {
          throw new Error(
            downloaded_path
              ? "Sidecar downloaded the source but did not create a project slug"
              : "Sidecar returned no slug or source path after ingest",
          );
        }
        for (const stage of POST_INGEST_STAGES) {
          // Drive the next stage. `runStage` resolves when the stage
          // finishes with the updated project; mirrors desktop/App.tsx:1620
          // `setRunningProject(updated)` per-stage hydration. The bake-kind
          // emit pushes the embedded project into useEngineSession so the
          // grid surfaces clips as cut/reframe/thumbs land — not only at
          // the end.
          const { project: updated } = await sidecar.runStage(slug, stage);
          bus.emit("engine:complete", { kind: "bake", slug, project: updated });
        }
        // Keep the legacy "pick" emit — this panel's own engine:complete
        // listener (line 164 above) gates its "running" → "done" UI flip
        // on kind === "pick". Removing it would strand the create panel.
        bus.emit("engine:complete", { kind: "pick", slug });
      })
      .catch((e: unknown) => {
        bus.emit("engine:error", {
          kind: "ingest",
          error: String(e instanceof Error ? e.message : e),
          url: raw,
        });
      });
  }

  // UX-4 · openWorkstation removed; Library tab folded into the "My Clips"
  // tile on Home, which deep-links to /workstation directly.

  if (!open) return null;
  // 2026-06-25 · fall back to document.body when no ModalPortal context is
  // available. The panel is now mounted globally in AppShell (above the
  // ModalPortal provider), so on non-home routes modalHost is null but the
  // panel still needs to render for the browse → handoff workflow.
  const portalHost = modalHost ?? (typeof document !== "undefined" ? document.body : null);
  if (!portalHost) return null;

  return createPortal(
    <Watchdog
      id="pipeline/cp-02/inline-create-panel"
      label="Inline Create Panel (URL ingest · project create)"
      cluster="pipeline"
      source="src/design-os/components/InlineCreatePanel.tsx:363"
    >
    <div
      className="lc-icp-root"
      data-testid="create-panel-root"
      role="dialog"
      aria-label="Create clips panel"
    >
      <div
        className="lc-icp-scrim"
        onClick={() => phase !== "running" && close()}
        aria-hidden="true"
      />
      <div
        className="lc-icp-panel"
        data-testid="create-panel"
        data-phase={phase}
      >
        {phase !== "running" && phase !== "done" && (
          <>
            {/* 2026-06-26 · C2A · compact eyebrow anchors what this panel
                is for. No hero slab — single line of small-caps under the
                edge of the panel. Sets user expectation in one glance. */}
            <span className="lc-icp-eb" data-testid="create-panel-eb">
              Drop a clip source · pick a path
            </span>
            <div
              className="lc-icp-tabs"
              role="tablist"
              data-testid="create-panel-tabs"
              data-active-tab={tab}
            >
              <TabButton id="url"     active={tab} onPick={setTab}>YouTube URL</TabButton>
              <TabButton id="upload"  active={tab} onPick={setTab}>Upload Video</TabButton>
              <TabButton id="script"  active={tab} onPick={setTab}>Script</TabButton>
            </div>

            {tab === "url" && (
              <div className="lc-icp-body">
                {/* 2026-06-25 · lane-1 acceptance criterion · "imported from
                    browser" chip · proves the handoff happened so the user
                    knows this isn't a stale URL. Clears the moment they
                    edit the field. */}
                {importedFromBrowser && (
                  <span className="lc-icp-handoff-chip" aria-label="URL imported from in-app browser">
                    <span className="lc-icp-handoff-dot" /> imported from browser
                  </span>
                )}
                <input
                  ref={inputRef}
                  className={`lc-icp-input ${urlError ? "err" : ""}`}
                  type="url"
                  placeholder="Paste a URL — YouTube, Drive, Twitch…"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (urlError) setUrlError(null);
                    if (importedFromBrowser) setImportedFromBrowser(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && analyze()}
                  aria-invalid={!!urlError}
                  aria-describedby={urlError ? "lc-icp-url-err" : undefined}
                />
                {urlError && (
                  <span id="lc-icp-url-err" className="lc-icp-err">{urlError}</span>
                )}
                {/* 2026-06-26 · C2A · removed the "Open Engine →" backdoor pill.
                    It sat alongside the count chips but was a NON-source-intake
                    CTA — clicking it bypassed Create entirely and dumped the
                    user on Workstation. That broke the "source → generate →
                    workstation" contract and added a duplicate Create concept.
                    Users who want to jump straight to clips already have the
                    "My Clips" home tile. */}
                <div className="lc-icp-count" role="radiogroup" aria-label="Clip count target">
                  {COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={count === n}
                      aria-label={`Select ${n} clips`}
                      className={`lc-icp-chip ${count === n ? "on" : ""}`}
                      onClick={() => setCount(n)}
                    >
                      {n} clips
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="lc-icp-go"
                  disabled={!url.trim()}
                  onClick={analyze}
                >
                  {url.trim() ? `Analyze & Clip · ${count} clips` : "Paste a URL to start"}
                </button>
              </div>
            )}

            {tab === "upload" && (
              <div
                className="lc-icp-body lc-icp-upload"
                data-testid="upload-tab-block"
                data-upload-state="live"
              >
                <div className="lc-icp-drop" data-testid="upload-drop-zone">
                  <span className="lc-icp-drop-eb">Drop a video anywhere</span>
                  <span className="lc-icp-drop-hint" data-testid="upload-drop-hint">
                    Drag an MP4 / MOV / M4V / WEBM onto the app, or pick one below.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="upload-pick-file"
                  className="lc-icp-go"
                  onClick={() => {
                    void (async () => {
                      // P0.1 · 2026-07-09 · native file picker on the live
                      // drop path. Emits `source:drop` so GlobalDropConsumer
                      // runs the SAME sidecar ingest a drag/drop would.
                      const isTauri =
                        typeof window !== "undefined" &&
                        "__TAURI_INTERNALS__" in window;
                      if (!isTauri) {
                        // Browser preview / Vite dev · no native picker.
                        // Keep URL flow live; explain and no-op.
                        return;
                      }
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const chosen = await open({
                          multiple: false,
                          directory: false,
                          filters: [
                            { name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] },
                          ],
                        });
                        if (!chosen) return;
                        const path = typeof chosen === "string" ? chosen : String(chosen);
                        if (!path.trim()) return;
                        const filename = path.split("/").pop() || path;
                        void lcDiag("file_picker_selected", {
                          source: "src/design-os/components/InlineCreatePanel.tsx:upload-tab-pick",
                          path_length: path.length,
                          filename,
                        });
                        bus.emit("source:drop", { paths: [path] });
                      } catch (exc) {
                        void lcDiag("file_picker_failed", {
                          source: "src/design-os/components/InlineCreatePanel.tsx:upload-tab-pick",
                          error_message: (exc instanceof Error ? exc.message : String(exc)).slice(0, 200),
                        });
                      }
                    })();
                  }}
                  title="Pick a local MP4 / MOV / M4V / WEBM"
                >
                  Pick file
                </button>
              </div>
            )}

            {tab === "script" && (
              <div
                className="lc-icp-body lc-icp-script"
                data-testid="script-tab-block"
                data-script-state="coming-soon"
              >
                <span className="lc-icp-script-eb" data-testid="script-coming-soon-eb">
                  Script · Solo tier · coming after launch
                </span>
                <textarea
                  data-testid="script-textarea"
                  className="lc-icp-script-input"
                  placeholder="Paste a script and we'll cut clips that match the moments you call out…"
                  rows={4}
                  disabled
                  title="Script clipping is coming after launch"
                />
                <button
                  type="button"
                  data-testid="script-generate"
                  className="lc-icp-go"
                  disabled
                  title="Script clipping is coming after launch"
                >
                  Generate from script · unlocks on Solo
                </button>
                <span className="lc-icp-script-sub" data-testid="script-coming-soon-copy">
                  Script-driven clipping is a Solo+ feature. Live in the next batch · use a YouTube URL or upload a video to clip today.
                </span>
              </div>
            )}
          </>
        )}

        {phase === "running" && (
          <div className="lc-icp-seq" role="status" aria-live="polite">
            <ol className="lc-icp-seq-list">
              {STAGE_GROUPS.map((g) => {
                const state = stageGroupState(g, activeStage);
                return (
                  <li key={g.id} className={`lc-icp-seq-row ${state}`}>
                    <span className="lc-icp-seq-tick" aria-hidden="true">{state === "done" ? "✓" : state === "active" ? "·" : ""}</span>
                    <span className="lc-icp-seq-label">{g.label}</span>
                  </li>
                );
              })}
            </ol>
            <div className="lc-icp-bar" aria-hidden="true"><div className="lc-icp-bar-fill" /></div>
          </div>
        )}

        {phase === "done" && (
          <div className="lc-icp-done" role="status">
            <span className="lc-icp-done-tick">✓</span>
            <span className="lc-icp-done-text">{doneCount ?? count} clips landed</span>
          </div>
        )}

        {phase === "error" && (
          <div className="lc-icp-fail" role="alert">
            <span className="lc-icp-fail-eb">Run hit a snag</span>
            <span className="lc-icp-fail-msg">{errorMsg ?? "Something went wrong. Try a different source."}</span>
            <div className="lc-icp-fail-actions">
              <button type="button" className="lc-icp-go" onClick={retry}>Try again</button>
              <button type="button" className="lc-icp-ghost" onClick={close}>Close</button>
            </div>
          </div>
        )}

        {phase !== "running" && (
          <button
            type="button"
            className="lc-icp-close"
            onClick={close}
            aria-label="Close create panel"
          >×</button>
        )}
      </div>
    </div>
    </Watchdog>,
    portalHost,
  );
}

function TabButton({
  id, active, onPick, children,
}: {
  id: Tab; active: Tab; onPick: (t: Tab) => void; children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active === id}
      // 2026-06-26 · C2A · mark URL tab as canonical so CSS can demote
      // the COMING SOON tabs without removing them (the existing tests
      // still need them clickable to verify the honest disabled state).
      data-canonical={id === "url" ? "true" : "false"}
      className={`lc-icp-tab ${active === id ? "on" : ""}`}
      onClick={() => onPick(id)}
    >
      <span>{children}</span>
    </button>
  );
}
