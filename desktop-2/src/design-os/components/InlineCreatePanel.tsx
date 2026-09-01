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
import { convertFileSrc } from "@tauri-apps/api/core";
import { bus, useEvent } from "../bridge";
import { useKillSwitch } from "../../lib/killSwitches";
import { sidecar } from "../engine/sidecar-stub";
import { notify as inboxNotify } from "../../inbox";
import {
  startPersistedSession,
} from "../state/engineSessionPersistence";
import { STAGE_ORDER, STAGE_LABEL, type StageName, type Clip } from "../engine/types";
import { useModalPortal, useRegisterModal } from "./ModalPortal";
// Watchdog Rollout · cp-02 (2026-07-06) · wraps InlineCreatePanel so a
// crash inside the URL-ingest / project-create flow renders
// KadeRepairScreen instead of the silent-empty black panel that Claude 2
// flagged. Pairs with cp-01 (Workstation) to close the "renders nothing"
// bug family. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./InlineCreatePanel.css";

// Ship-ready intake exposes three paths:
//   · url        · YouTube/URL → clips
//   · upload     · local file → clips
//   · transcribe · URL → plain transcript text (no clipping, no LLM, no cut)
//                  Uses sidecar.liftTranscript · same RPC the legacy desktop
//                  Script-mode had. Restored 2026-07-10 (Daniel's ask).
type Tab = "url" | "upload" | "transcribe";
// IMPORT-CREATE-RECONCILE-2 (2026-06-20) · operator direction restored:
// product needs three count selectors — 10 · 30 · 100 — plus the Open
// Engine jump. Chip text reads as a selector ("{n} clips"), not as an
// action verb. See BUGS_ERRORS_FIXES.md BUG-008/009/010/012.
type Count = 10 | 30 | 100;
const COUNT_OPTIONS: ReadonlyArray<Count> = [10, 30, 100];
type Phase = "idle" | "running" | "reviewing" | "done" | "error";

/** Format seconds as M:SS (or H:MM:SS past an hour) for the clip-review list
 *  and the custom-range inputs. */
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Accepts plain seconds ("94") or M:SS / H:MM:SS ("1:34"). Returns null on
 *  anything that doesn't parse — callers show a plain-English error instead
 *  of a NaN leaking into a sidecar call. */
function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  const [a, b, c] = nums.length === 3 ? nums : [0, ...nums];
  return a * 3600 + b * 60 + c;
}

/** Runtime-correct `<video src>` for a local filesystem path — same rule
 *  ClipPreviewShell.tsx uses (see its `reactionOverlaySrc`): Tauri-written
 *  absolute paths must go through `convertFileSrc` to reach the asset://
 *  protocol; outside Tauri (Vite dev / Playwright harness) that throws on
 *  the missing `__TAURI_INTERNALS__` global, so fall back to the raw path. */
function sourceVideoSrc(sourcePath: string): string {
  if (sourcePath.startsWith("blob:") || sourcePath.startsWith("http")) {
    return sourcePath;
  }
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    return sourcePath;
  }
  return convertFileSrc(sourcePath);
}

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

// 2026-08-31 · BUG FIX — "Pick your own clips" silently reverted to
// automatic mode on a second clip in the same session, with no error
// and no visible reason. Root cause: chooseOwnClips was a plain
// component-local useState(false), and this panel fully unmounts on
// close (`if (!open) return null` below) — every reopen re-ran
// useState(false) fresh, silently discarding whatever the user had
// toggled on the previous run. Confirmed live: submitted clip #1 with
// the toggle on (worked correctly, review screen opened), closed the
// panel, submitted clip #2 — the backend log showed it went straight
// into stage_transcribe (the full automatic pipeline) instead of
// pausing after the LLM stage, because chooseOwnClips was back to
// false with no user-visible change to the toggle's on-screen state
// at the moment they clicked Analyze.
//
// Fix: promote the value to module scope so it survives the panel's
// own unmount/remount cycle across submissions in the same app
// session — the user's choice now persists until they explicitly
// flip it again, instead of silently reverting. Still starts `false`
// on a fresh app launch, preserving the original "default OFF, opt-in
// only" intent from the comment below.
let chooseOwnClipsPersisted = false;

export function InlineCreatePanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  // 2026-06-25 · lane-1 acceptance criterion · "Editor shows an 'imported
  // from browser' chip below the source chipbar." The flag flips true when
  // lc:browse-url-handoff fires + clears when the user types a fresh URL.
  const [importedFromBrowser, setImportedFromBrowser] = useState(false);
  const [count, setCount] = useState<Count>(30);
  const [phase, setPhaseState] = useState<Phase>("idle");
  // 2026-09-01 · BUG FIX — `phaseRef` mirrors `phase` synchronously,
  // written the instant setPhase() is called rather than waiting for
  // React's next render. Needed because analyze() calls setPhase and
  // bus.emit("nav:click", ...) back-to-back in the same synchronous
  // function — React 18 batches the state update from an event handler,
  // so any OTHER callback that reads the closure-captured `phase`
  // variable (not phaseRef) during that same synchronous tick sees the
  // value from BEFORE this call, not "running". The route:enter handler
  // below used to do exactly that, closing the panel immediately at the
  // start of every analyze() call — not just during the 1.4s stale-timer
  // race sessionGeneration fixes above — because it never actually saw
  // phase flip to "running" in time. Every consumer that needs the
  // up-to-the-instant value (not the once-per-render snapshot) should
  // read phaseRef.current, not the closure variable.
  const phaseRef = useRef<Phase>("idle");
  const setPhase = (next: Phase): void => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const [activeStage, setActiveStage] = useState<StageName | null>(null);
  const [doneCount, setDoneCount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  // 2026-08-28 · mirrors sidecar-stub.ts's ingestInFlight flag — true
  // while ANY surface (this panel, the Create route, retry/resume) has
  // an ingest running, not just this one. Lets the button visually go
  // disabled even when the running job was started elsewhere.
  const [otherIngestBusy, setOtherIngestBusy] = useState(false);
  useEvent("ingest:flight", (p) => setOtherIngestBusy(p.inFlight));
  // 2026-08-31 · launch kill switches. Backend already 503s POST
  // /transcribe (ai_transcribe) and POST /proxy/llm|/proxy/anthropic
  // (ai_llm) — mirror both client-side so the two real triggers of
  // those calls (the full analyze pipeline, and the standalone
  // transcribe-tab button) show the real reason instead of failing
  // partway through with a raw error. See lib/killSwitches.ts.
  const transcribeKilled = useKillSwitch("ai_transcribe");
  const llmKilled = useKillSwitch("ai_llm");
  const analyzeKilled = transcribeKilled || llmKilled;
  // 2026-08-28 · double-submit guard for analyze() — see the comment there.
  const analyzeInFlight = useRef(false);
  // 2026-09-01 · BUG FIX — session generation counter. See the
  // window.setTimeout(..., 1400) inside the engine:complete(kind:"pick")
  // handler below: it calls close() unconditionally 1.4s after an
  // automatic run finishes, with no check for whether a NEW session has
  // started in the meantime. Confirmed live: click "+" and switch to
  // Manual within that 1.4s window, submit a new link, and the stale
  // timer still fires afterward and force-closes the panel right as (or
  // just after) the manual review editor tries to show — the review
  // screen never gets a chance to stay visible, leaving only the bare
  // Workstation stage-card view underneath (ingest done, everything
  // else pending) — which looks exactly like a stuck automatic run even
  // though the real cause is a delayed automatic-session cleanup
  // callback closing a completely different, newer manual session.
  // Every analyze() call bumps this; the stale timeout captures its own
  // generation number and only calls close() if nothing newer started.
  const sessionGeneration = useRef(0);
  // "Pick your own clips" review step · glaring opt-in toggle next to the
  // Generate button. Default false — automatic AI-picks-and-cuts behaviour
  // is unchanged when it's off. When on, the pipeline pauses right after
  // the "llm" (moment-picking) stage instead of chaining straight into
  // cut/reframe/thumbs, and the user gets a checklist of the AI's picks
  // plus the ability to mark their own custom ranges before anything gets
  // cut. Backend already supports all of this (add_clip / remove_clip /
  // run_stage) — no sidecar changes needed, pure frontend feature.
  const [chooseOwnClips, setChooseOwnClipsState] = useState(chooseOwnClipsPersisted);
  const setChooseOwnClips = (updater: boolean | ((v: boolean) => boolean)): void => {
    setChooseOwnClipsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      chooseOwnClipsPersisted = next;
      return next;
    });
  };
  const [reviewSlug, setReviewSlug] = useState<string | null>(null);
  const [reviewClips, setReviewClips] = useState<Clip[]>([]);
  const [reviewKept, setReviewKept] = useState<Set<number>>(new Set());
  const [reviewDuration, setReviewDuration] = useState(0);
  // Local filesystem path to the downloaded source (project.source_path) —
  // lets the review screen show an actual <video> the user can watch and
  // scrub, instead of asking them to type timestamps blind. 2026-08-24 ·
  // added after the first cut of "pick your own clips" shipped without a
  // player at all — Daniel's actual ask was "let me watch it and mark
  // where to cut," not "let me guess timestamps."
  const [reviewSourcePath, setReviewSourcePath] = useState<string | null>(null);
  const reviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [customClips, setCustomClips] = useState<Array<{ start: number; end: number; title: string }>>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // True once audio+transcribe have actually run for this project — either
  // because the user clicked "Let AI suggest more" (which needs them) or
  // because confirmReview() ran them itself for a pure-manual pick. Gates
  // whether confirmReview needs to run them or can skip straight to
  // add/removeClip.
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "error">("idle");
  const [aiStage, setAiStage] = useState<StageName | null>(null);
  // Transcribe tab state · 2026-07-10 · isolated from clip pipeline state so
  // the two flows can run without stepping on each other's UI.
  const [transcribeUrl, setTranscribeUrl] = useState("");
  const [transcribeUrlError, setTranscribeUrlError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribeCopied, setTranscribeCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transcribeInputRef = useRef<HTMLInputElement | null>(null);
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

  // 2026-09-01 · BUG FIX — re-open the panel if a manual review session
  // becomes ready while the panel is closed. The "Watch in Workstation →"
  // escape hatch (below, in the `phase === "running"` block) does
  // `setOpen(false)` directly while the pipeline keeps running in the
  // background — safe for Automatic mode, whose comment explains that a
  // later `engine:complete{kind:"pick"}` hydrates My Clips with no further
  // UI needed. Manual mode has no such unattended finish: it deliberately
  // *pauses* at phase "reviewing" and waits for THIS panel's own editor —
  // there's no other surface that can show it. Root-caused live 2026-09-01:
  // clicking that escape hatch during a manual session lets the pipeline
  // reach "reviewing" with `open` stuck false, so the editor exists in
  // state (React still runs its effects even while the component returns
  // null) but is never painted, and Workstation's own grid just shows
  // "ingest done, rest pending" forever with no way back in. Clicking "+"
  // again starts a brand new session rather than resuming the orphaned
  // one. This effect is the general fix: whenever a session actually
  // reaches "reviewing" while closed, for any reason, force it back open
  // instead of stranding the user. No effect on Automatic (which never
  // sets phase to "reviewing" at all, so this never fires for it).
  useEffect(() => {
    if (phase === "reviewing" && !open) {
      setOpen(true);
    }
  }, [phase, open]);

  /* Open from tiles. Tile name maps to tab. */
  useEvent("home:open-panel", (p) => {
    setOpen(true);
    setTab(p.tab === "upload" ? "upload" : "url");
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
      // 2026-09-01 · reads phaseRef, NOT the closure-captured `phase`
      // state variable — see the phaseRef comment at its declaration.
      // analyze() flips phase to "running" and emits nav:click in the
      // same synchronous call; the closure variable here could still
      // hold the pre-update value when this handler fires in that same
      // tick. phaseRef is written synchronously, so it's always current.
      return phaseRef.current === "running";
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
      analyzeInFlight.current = false;
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
      // 2026-09-01 · BUG FIX — capture the generation this completion
      // belongs to and re-check it at fire time. Without this, clicking
      // "+" and starting a brand-new session (e.g. switching to Manual)
      // within this 1.4s window let the stale timer close() the panel
      // out from under the NEW session — see sessionGeneration's own
      // comment above for the full failure story.
      const generationAtSchedule = sessionGeneration.current;
      window.setTimeout(() => {
        if (sessionGeneration.current !== generationAtSchedule) return;
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
    analyzeInFlight.current = false;
    setPhase("error");
    setErrorMsg(p.human ?? p.error ?? "Something went wrong. Try a different source.");
  });

  function close() {
    setOpen(false);
    // Reset local state but leave phase alone in case engine is still mid-flight.
    setUrl("");
    setUrlError(null);
    resetReviewState();
  }

  function resetReviewState() {
    setReviewSlug(null);
    setReviewClips([]);
    setReviewKept(new Set());
    setReviewDuration(0);
    setReviewSourcePath(null);
    setCustomClips([]);
    setCustomStart("");
    setCustomEnd("");
    setCustomTitle("");
    setReviewBusy(false);
    setReviewError(null);
    setTranscriptReady(false);
    setAiStatus("idle");
    setAiStage(null);
  }

  function retry() {
    analyzeInFlight.current = false;
    setPhase("idle");
    setActiveStage(null);
    setErrorMsg(null);
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }

  async function transcribe() {
    const raw = transcribeUrl.trim();
    if (!raw) return;
    if (!looksLikeIngestableUrl(raw)) {
      setTranscribeUrlError("That doesn't look like a video URL — paste a YouTube, Drive, or direct https link.");
      return;
    }
    setTranscribeUrlError(null);
    setTranscript(null);
    setTranscribing(true);
    void lcDiag("transcribe_started", {
      source: "src/design-os/components/InlineCreatePanel.tsx:transcribe",
      url_length: raw.length,
    });
    try {
      const res = await sidecar.liftTranscript(raw);
      const text = (res?.transcript_text ?? "").trim();
      if (!text) {
        throw new Error("Sidecar returned an empty transcript · try a different link.");
      }
      setTranscript(text);
      void lcDiag("transcribe_success", {
        source: "src/design-os/components/InlineCreatePanel.tsx:transcribe",
        char_count: text.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTranscribeUrlError(msg.slice(0, 200));
      void lcDiag("transcribe_failed", {
        source: "src/design-os/components/InlineCreatePanel.tsx:transcribe",
        error_message: msg.slice(0, 200),
      });
      // 2026-07-13 · Post-RC1 · canonical HQ envelope alongside the
      // legacy lcDiag beacon. `processing.failed` category so Codex
      // routes it into the pipeline lane.
      void import("../../lib/hqEmit").then((h) => {
        h.emitHqEvent({
          category: "processing.failed",
          severity: "error",
          topic: "transcribe.failed",
          data: {
            stage: "transcribe",
            error_message: msg.slice(0, 200),
          },
        });
      }).catch(() => {
        /* HQ emit is best-effort */
      });
    } finally {
      setTranscribing(false);
    }
  }

  async function copyTranscript() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setTranscribeCopied(true);
      window.setTimeout(() => setTranscribeCopied(false), 1600);
    } catch { /* clipboard denied · noop */ }
  }

  function saveTranscript() {
    if (!transcript) return;
    // Blob download works in WKWebView without needing tauri-plugin-fs
    // save-file permissions · portable across dev / installed / preview.
    const url = URL.createObjectURL(
      new Blob([transcript], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `liquidclips-transcript-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on next tick so the browser has time to start the save.
    window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
  }

  function analyze() {
    // 2026-08-28 · guard against double-submit. The button's own disabled
    // state (below) covers the normal case, but a fast double-click/tap can
    // still fire this twice before React re-renders the disabled prop —
    // observed live: the second ingest_url call for the same URL collides
    // with the still-in-flight first one and the sidecar's own duplicate
    // guard rejects it with a raw "Ingest already in progress" error that
    // a real user should never see. A ref check is synchronous (unlike
    // state, which can batch) so it actually blocks the second call.
    if (analyzeInFlight.current) return;
    // 2026-08-28 · Daniel's ask: one job at a time. This panel is a single
    // app-wide instance (mounted once in AppShell, not per-route), so
    // `phase` here really does represent "is anything currently
    // processing" — block starting a second, different link until the
    // first one reaches idle/done, rather than letting two pipelines run
    // concurrently (source of several confusing overlapping-log
    // situations observed live this session).
    if (phase !== "idle" && phase !== "error") {
      setUrlError("Still working on your last clip — this one can start once it's done.");
      return;
    }
    const raw = url.trim();
    if (!raw) return;
    if (!looksLikeIngestableUrl(raw)) {
      setUrlError("That doesn't look like a video URL — paste a YouTube, Drive, or direct https link.");
      return;
    }
    analyzeInFlight.current = true;
    sessionGeneration.current += 1;
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
    // "Pick your own clips" (2026-08-21, redesigned same day per live
    // feedback) — the toggle now pauses IMMEDIATELY after ingest, before
    // audio/transcribe/llm ever run, instead of after the AI's full pass.
    // First cut showed the review screen only once transcription + the AI
    // picker finished — the user's actual expectation was "let me see the
    // downloaded video and mark my own parts right away," not "make me
    // wait through the AI's whole pipeline to get a manual option." AI
    // suggestions are now opt-in and on-demand from inside the review
    // screen (see fetchAiSuggestions below) instead of mandatory up front.
    const wantsReview = chooseOwnClips;
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
        if (wantsReview) {
          // Pause right here — video's downloaded, nothing else has run.
          // No AI candidates yet; the user can start marking their own
          // ranges immediately, or opt into AI suggestions from the
          // review screen itself.
          analyzeInFlight.current = false;
          setReviewSlug(slug);
          setReviewClips([]);
          setReviewKept(new Set());
          setReviewDuration(project.duration_s ?? 0);
          setReviewSourcePath(project.source_path ?? downloaded_path ?? null);
          setTranscriptReady(false);
          setAiStatus("idle");
          setPhase("reviewing");
          void lcDiag("clip_review_opened", {
            source: "src/design-os/components/InlineCreatePanel.tsx:analyze",
            candidate_count: 0,
          });
          return;
        }
        let latestProject = project;
        for (const stage of PRE_REVIEW_STAGES) {
          const { project: updated } = await sidecar.runStage(slug, stage);
          latestProject = updated;
          bus.emit("engine:complete", { kind: "bake", slug, project: updated, final: false });
        }
        void latestProject;
        await runPostReviewStages(slug);
      })
      .catch((e: unknown) => {
        analyzeInFlight.current = false;
        bus.emit("engine:error", {
          kind: "ingest",
          error: String(e instanceof Error ? e.message : e),
          url: raw,
        });
      });
  }

  const PRE_REVIEW_STAGES: ReadonlyArray<StageName> = ["audio", "transcribe", "llm"];
  const POST_REVIEW_STAGES: ReadonlyArray<StageName> = ["cut", "reframe", "thumbs"];

  /** Runs cut → reframe → thumbs for whatever's currently in project.clips.
   *  Shared by the automatic path (toggle off) and confirmReview() (toggle
   *  on) so both end identically — same bake/pick events, same Workstation
   *  hand-off — regardless of how the clip list got decided. */
  async function runPostReviewStages(slug: string): Promise<void> {
    for (const stage of POST_REVIEW_STAGES) {
      const { project: updated } = await sidecar.runStage(slug, stage);
      bus.emit("engine:complete", {
        kind: "bake",
        slug,
        project: updated,
        final: stage === POST_REVIEW_STAGES[POST_REVIEW_STAGES.length - 1],
      });
    }
    // Keep the legacy "pick" emit — this panel's own engine:complete
    // listener gates its "running" → "done" UI flip on kind === "pick".
    bus.emit("engine:complete", { kind: "pick", slug });
  }

  /** Parses the two free-text time inputs, validates against the backend's
   *  own add_clip constraints (5–180s, end > start, end within source
   *  duration) so a bad range is caught here instead of round-tripping to
   *  the sidecar for a 400. Queues the clip client-side — actual add_clip
   *  RPC calls happen in confirmReview() so nothing is cut until the user
   *  hits the final confirm. */
  function addCustomClip() {
    const start = parseTimeInput(customStart);
    const end = parseTimeInput(customEnd);
    if (start == null || end == null) {
      setReviewError("Enter start and end as seconds or M:SS (e.g. 1:24).");
      return;
    }
    if (end <= start) {
      setReviewError("End must be after start.");
      return;
    }
    const dur = end - start;
    if (dur < 5 || dur > 180) {
      setReviewError("Custom clips must be between 5 and 180 seconds.");
      return;
    }
    if (reviewDuration > 0 && end > reviewDuration) {
      setReviewError(`End must be within the source length (${formatClock(reviewDuration)}).`);
      return;
    }
    setReviewError(null);
    setCustomClips((prev) => [
      ...prev,
      { start, end, title: customTitle.trim() || `Custom clip ${prev.length + 1}` },
    ]);
    setCustomStart("");
    setCustomEnd("");
    setCustomTitle("");
  }

  /** Commits the review screen: drops unchecked AI candidates, adds any
   *  manually-marked ranges, then resumes cut/reframe/thumbs on whatever's
   *  left. Removals run highest-index-first — remove_clip pops by array
   *  position on a fresh disk read each call, so descending order means an
   *  earlier removal never shifts the index of one still pending. */
  /** On-demand AI pass, triggered from inside the review screen (not
   *  automatically anymore — see the redesign note in analyze()). Runs
   *  audio → transcribe → llm and appends the AI's picks to whatever the
   *  user has already marked manually; doesn't touch or clear customClips,
   *  so "some manually, AI does the rest" is just "add your own, then
   *  also click this" — no separate mode to choose between. */
  /** Returns whether it actually succeeded — callers that need to gate
   *  further work on success (confirmReview) can't rely on reading
   *  `aiStatus` right after `await`ing this: it's React state, so the
   *  outer closure still sees whatever value was captured when the caller
   *  started, not what this function just set. */
  async function fetchAiSuggestions(): Promise<boolean> {
    if (!reviewSlug || aiStatus === "loading") return false;
    setAiStatus("loading");
    setReviewError(null);
    const slug = reviewSlug;
    try {
      for (const stage of PRE_REVIEW_STAGES) {
        setAiStage(stage);
        const { project: updated } = await sidecar.runStage(slug, stage);
        if (stage === "llm") {
          const picks = updated.clips ?? [];
          setReviewClips(picks);
          setReviewKept(new Set(picks.map((_, i) => i)));
        }
      }
      setTranscriptReady(true);
      setAiStatus("idle");
      setAiStage(null);
      void lcDiag("clip_review_ai_suggested", {
        source: "src/design-os/components/InlineCreatePanel.tsx:fetchAiSuggestions",
      });
      return true;
    } catch (e) {
      setAiStatus("error");
      setAiStage(null);
      const msg = e instanceof Error ? e.message : String(e);
      setReviewError(`AI suggestions failed: ${msg.slice(0, 180)}`);
      void lcDiag("clip_review_ai_suggest_failed", {
        source: "src/design-os/components/InlineCreatePanel.tsx:fetchAiSuggestions",
        error_message: msg.slice(0, 200),
      });
      return false;
    }
  }

  async function confirmReview(): Promise<void> {
    if (!reviewSlug) return;
    if (reviewKept.size === 0 && customClips.length === 0) {
      setReviewError("Add at least one clip of your own before cutting — the AI will find a few more automatically.");
      return;
    }
    setReviewBusy(true);
    setReviewError(null);
    const slug = reviewSlug;
    try {
      // Confirming always finds AI picks too, not just whatever the user
      // marked by hand — "cut my choice, and also clip other good moments
      // from the rest of the video" was the actual ask, not "cut only what
      // I marked." Skip it only if the user already ran fetchAiSuggestions
      // themselves (transcriptReady true) so this never double-runs the
      // LLM pass. Also covers add_clip's own requirement that
      // transcript.srt exist before it can bake captions in stage_reframe.
      if (!transcriptReady) {
        setPhase("running");
        setActiveStage("audio");
        const aiOk = await fetchAiSuggestions();
        setPhase("reviewing");
        setActiveStage(null);
        if (!aiOk) {
          // fetchAiSuggestions already set reviewError with the specific
          // failure — bail out here instead of proceeding to cut with an
          // incomplete transcript.
          setReviewBusy(false);
          return;
        }
      }
      const toRemove = reviewClips
        .map((_, i) => i)
        .filter((i) => !reviewKept.has(i))
        .sort((a, b) => b - a);
      for (const idx of toRemove) {
        await sidecar.removeClip(slug, idx);
      }
      for (const c of customClips) {
        await sidecar.addClip(slug, c.start, c.end, c.title);
      }
      void lcDiag("clip_review_confirmed", {
        source: "src/design-os/components/InlineCreatePanel.tsx:confirmReview",
        kept_count: reviewKept.size,
        dropped_count: toRemove.length,
        custom_count: customClips.length,
      });
      setPhase("running");
      setActiveStage("cut");
      // Reset only after the cut/reframe/thumbs pass actually succeeds — if
      // it throws, the catch below sends the user back to "reviewing" and
      // needs reviewSlug/reviewClips/customClips still intact so that
      // screen (and a retry via confirmReview) has something to show.
      await runPostReviewStages(slug);
      resetReviewState();
    } catch (e) {
      setReviewBusy(false);
      setPhase("reviewing");
      const msg = e instanceof Error ? e.message : String(e);
      setReviewError(msg.slice(0, 200));
      void lcDiag("clip_review_confirm_failed", {
        source: "src/design-os/components/InlineCreatePanel.tsx:confirmReview",
        error_message: msg.slice(0, 200),
      });
    }
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
              <TabButton id="url"        active={tab} onPick={setTab}>YouTube URL</TabButton>
              <TabButton id="upload"     active={tab} onPick={setTab}>Upload Video</TabButton>
              <TabButton id="transcribe" active={tab} onPick={setTab}>Transcribe</TabButton>
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
                {/* 2026-08-21 · glaring opt-in — default OFF so automatic
                    behaviour is unchanged unless the user deliberately
                    reaches for this. Sits directly above Generate so it's
                    seen at the exact moment the decision matters. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={chooseOwnClips}
                  className={`lc-icp-pick-toggle ${chooseOwnClips ? "on" : ""}`}
                  onClick={() => setChooseOwnClips((v) => !v)}
                  data-testid="choose-own-clips-toggle"
                >
                  <span className="lc-icp-pick-toggle-dot" aria-hidden="true" />
                  <span className="lc-icp-pick-toggle-text">
                    <strong>Pick your own clips</strong>
                    <span>Review the AI&rsquo;s picks — keep, drop, or add your own before it cuts</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="lc-icp-go"
                  disabled={!url.trim() || otherIngestBusy || analyzeKilled}
                  onClick={analyze}
                  title={analyzeKilled ? "AI processing is temporarily paused — try again shortly." : undefined}
                >
                  {analyzeKilled
                    ? "Temporarily paused"
                    : otherIngestBusy
                    ? "Still working on your last clip…"
                    : url.trim()
                    ? (chooseOwnClips ? "Analyze — I'll pick the clips" : `Analyze & Clip · ${count} clips`)
                    : "Paste a URL to start"}
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

            {tab === "transcribe" && (
              <div
                className="lc-icp-body lc-icp-transcribe"
                data-testid="transcribe-tab-block"
              >
                <input
                  ref={transcribeInputRef}
                  className={`lc-icp-input ${transcribeUrlError ? "err" : ""}`}
                  type="url"
                  placeholder="Paste a URL — YouTube, Drive, direct https…"
                  value={transcribeUrl}
                  onChange={(e) => {
                    setTranscribeUrl(e.target.value);
                    if (transcribeUrlError) setTranscribeUrlError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !transcribing && transcribe()}
                  disabled={transcribing}
                  aria-invalid={!!transcribeUrlError}
                  data-testid="transcribe-url-input"
                />
                {transcribeUrlError && (
                  <span className="lc-icp-err" data-testid="transcribe-err">{transcribeUrlError}</span>
                )}
                <button
                  type="button"
                  className="lc-icp-go"
                  disabled={!transcribeUrl.trim() || transcribing || transcribeKilled}
                  onClick={() => void transcribe()}
                  data-testid="transcribe-go"
                  title={transcribeKilled ? "Transcription is temporarily paused — try again shortly." : undefined}
                >
                  {transcribeKilled
                    ? "Temporarily paused"
                    : transcribing
                    ? "Transcribing…"
                    : (transcribeUrl.trim() ? "Get the transcript" : "Paste a URL to start")}
                </button>
                {transcript && (
                  <div className="lc-icp-transcribe-result" data-testid="transcribe-result">
                    <textarea
                      className="lc-icp-transcribe-text"
                      readOnly
                      value={transcript}
                      rows={10}
                      aria-label="Transcript"
                      data-testid="transcribe-textarea"
                    />
                    <div className="lc-icp-transcribe-actions">
                      <button
                        type="button"
                        className="lc-icp-chip"
                        onClick={() => void copyTranscript()}
                        data-testid="transcribe-copy"
                      >
                        {transcribeCopied ? "Copied ✓" : "Copy"}
                      </button>
                      <button
                        type="button"
                        className="lc-icp-chip"
                        onClick={saveTranscript}
                        data-testid="transcribe-save"
                      >
                        Save as .txt
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </>
        )}

        {phase === "reviewing" && (
          <div className="lc-icp-review" role="region" aria-label="Pick your clips">
            <div className="lc-icp-review-head">
              <span className="lc-icp-review-eb">Video's ready</span>
              <span className="lc-icp-review-count">
                {reviewKept.size + customClips.length} clip{reviewKept.size + customClips.length === 1 ? "" : "s"} selected
              </span>
            </div>

            {reviewSourcePath && (
              <video
                ref={reviewVideoRef}
                className="lc-icp-review-video"
                src={sourceVideoSrc(reviewSourcePath)}
                controls
                preload="metadata"
                data-testid="review-source-video"
              />
            )}

            {/* Confirming always runs this automatically too (see
                confirmReview) — clicking it here just lets you preview and
                uncheck AI picks before committing, instead of finding out
                what it chose only after the cut already ran. */}
            <div className="lc-icp-review-ai">
              {aiStatus === "idle" && reviewClips.length === 0 && (
                <button
                  type="button"
                  className="lc-icp-chip"
                  onClick={() => void fetchAiSuggestions()}
                  data-testid="review-ai-suggest"
                >
                  Preview AI picks now
                </button>
              )}
              {aiStatus === "loading" && (
                <span className="lc-icp-review-ai-status" role="status">
                  {aiStage ? STAGE_LABEL[aiStage] : "Working"}&hellip;
                </span>
              )}
              {aiStatus === "error" && (
                <button
                  type="button"
                  className="lc-icp-chip"
                  onClick={() => void fetchAiSuggestions()}
                  data-testid="review-ai-retry"
                >
                  AI suggestions failed — retry
                </button>
              )}
            </div>

            {reviewClips.length > 0 && (
              <ul className="lc-icp-review-list" data-testid="review-ai-list">
                {reviewClips.map((c, i) => (
                  <li key={c.id ?? i} className={`lc-icp-review-row ${reviewKept.has(i) ? "on" : ""}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={reviewKept.has(i)}
                        onChange={() => {
                          setReviewKept((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          });
                        }}
                      />
                      <span className="lc-icp-review-row-title">{c.title || "Untitled moment"}</span>
                      <span className="lc-icp-review-row-time">{formatClock(c.start)}–{formatClock(c.end)}</span>
                      {typeof c.score === "number" && (
                        <span className="lc-icp-review-row-score" title={c.score_reason || undefined}>{c.score}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {customClips.length > 0 && (
              <ul className="lc-icp-review-list lc-icp-review-custom-list" data-testid="review-custom-list">
                {customClips.map((c, i) => (
                  <li key={`custom-${i}`} className="lc-icp-review-row on">
                    <span className="lc-icp-review-row-title">{c.title}</span>
                    <span className="lc-icp-review-row-time">{formatClock(c.start)}–{formatClock(c.end)}</span>
                    <button
                      type="button"
                      className="lc-icp-review-row-remove"
                      onClick={() => setCustomClips((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Remove ${c.title}`}
                    >×</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="lc-icp-review-custom">
              <span className="lc-icp-review-custom-label">
                Add your own moment{reviewDuration > 0 ? ` — source is ${formatClock(reviewDuration)} long` : ""}
              </span>
              <div className="lc-icp-review-custom-row">
                <input
                  type="text"
                  className="lc-icp-review-custom-input"
                  placeholder="Start (1:24)"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  data-testid="review-custom-start"
                />
                {reviewSourcePath && (
                  <button
                    type="button"
                    className="lc-icp-chip lc-icp-review-mark-btn"
                    onClick={() => {
                      if (reviewVideoRef.current) setCustomStart(formatClock(reviewVideoRef.current.currentTime));
                    }}
                    data-testid="review-mark-start"
                  >Mark</button>
                )}
                <input
                  type="text"
                  className="lc-icp-review-custom-input"
                  placeholder="End (1:58)"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  data-testid="review-custom-end"
                />
                {reviewSourcePath && (
                  <button
                    type="button"
                    className="lc-icp-chip lc-icp-review-mark-btn"
                    onClick={() => {
                      if (reviewVideoRef.current) setCustomEnd(formatClock(reviewVideoRef.current.currentTime));
                    }}
                    data-testid="review-mark-end"
                  >Mark</button>
                )}
                <input
                  type="text"
                  className="lc-icp-review-custom-input lc-icp-review-custom-title"
                  placeholder="Title (optional)"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  data-testid="review-custom-title"
                />
                <button
                  type="button"
                  className="lc-icp-chip"
                  onClick={addCustomClip}
                  data-testid="review-custom-add"
                >Add</button>
              </div>
            </div>

            {reviewError && <span className="lc-icp-err" data-testid="review-error">{reviewError}</span>}

            <button
              type="button"
              className="lc-icp-go"
              disabled={reviewBusy || (reviewKept.size === 0 && customClips.length === 0)}
              onClick={() => void confirmReview()}
              data-testid="review-confirm"
            >
              {reviewBusy
                ? "Cutting…"
                : `Cut ${reviewKept.size + customClips.length} clip${reviewKept.size + customClips.length === 1 ? "" : "s"} →`}
            </button>
          </div>
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
            {/* Journey/first-clip fix · 2026-07-09 · escape hatch so the
             *  user is never trapped in the modal while the pipeline runs.
             *  Route was already flipped to Workstation on analyze() (see
             *  bus.emit("nav:click", { route: "workstation" }) above), so
             *  closing here just reveals the Workstation heartbeat +
             *  StageRail underneath. The bake keeps running; a new
             *  engine:complete{kind:"pick"} still hydrates My Clips even
             *  after the panel closes. */}
            <div className="lc-icp-seq-actions">
              <button
                type="button"
                className="lc-icp-ghost"
                data-testid="create-panel-watch-workstation"
                onClick={() => setOpen(false)}
                title="Close this panel and watch progress in the Workstation"
              >
                Watch in Workstation →
              </button>
            </div>
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
