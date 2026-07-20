/**
 * Composer · Phase 1c
 *
 * The "talk to Kade" surface. Sibling of Workstation, not a replacement.
 * A user types (or in Phase 2, speaks) an intent; the composer router
 * matches it against `CAPABILITIES`, either:
 *   - executes the flow directly (writing resolved params through the
 *     cockpit setters, so the change round-trips through the same
 *     persistence path as the Workstation dock),
 *   - opens an AskPanel to pick from a narrowed option set, or
 *   - surfaces "I didn't catch that" via Kade's speech bubble.
 *
 * Wired into the same 4-layer wrap as Workstation:
 *   Watchdog → EngineSessionProvider → CockpitProvider → DesignOSAppShell
 *
 * Zero touches to Workstation. Zero new deps. Every Kade dialogue fires
 * through `bus.emit("kade:speak" | "kade:mood")` — Composer NEVER swaps
 * Kade state locally (Line 8 of bridge/events.ts).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { MockComposer } from "./MockComposer";
import { sidecar } from "../engine/sidecar-stub";
import { isSupportedPortalUrl } from "../engine/UploadPortal";
import { useModeStore } from "../../lib/modeStore";
import { useSpeedStore } from "../../lib/speedStore";
import { selectSlot } from "../engine/composer/SlotGrid";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { CockpitProvider, useCockpit } from "../engine/cockpit/CockpitContext";
import { writeComposerHandoff } from "../../lib/composerHandoff";
import { getModeState } from "../../shell/modeStore";
import { FIXTURE_PROJECT, type Clip } from "../engine/types";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { readPersistedSession } from "../state/engineSessionPersistence";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { bus } from "../bridge";
import { Watchdog } from "../../lib/watchdog";

// ── Composer engine · Phase 1a exports ─────────────────────────────────
import {
  routeIntent,
  type RoutedIntent,
  type SessionState,
} from "../engine/composer/router";
import type { Capability } from "../engine/composer/capabilities";
import { AskPanel } from "../engine/composer/AskPanel";

// ── Phase 1b · 12 flow panels ──────────────────────────────────────────
import { ReactionPanel } from "../engine/composer/ParamPanels/ReactionPanel";
import { CaptionsPanel } from "../engine/composer/ParamPanels/CaptionsPanel";
import { TrimPanel } from "../engine/composer/ParamPanels/TrimPanel";
import { FramePanel } from "../engine/composer/ParamPanels/FramePanel";
import { AudioPanel } from "../engine/composer/ParamPanels/AudioPanel";
import { TimelinePanel } from "../engine/composer/ParamPanels/TimelinePanel";
import { WatermarkPanel } from "../engine/composer/ParamPanels/WatermarkPanel";
import { RecordPanel } from "../engine/composer/ParamPanels/RecordPanel";
import { CampaignPanel } from "../engine/composer/ParamPanels/CampaignPanel";
import { LibraryPanel } from "../engine/composer/ParamPanels/LibraryPanel";
import { DiscoveryPanel } from "../engine/composer/ParamPanels/DiscoveryPanel";
import { ReactionsDeepPanel } from "../engine/composer/ParamPanels/ReactionsDeepPanel";

// ── Phase 1c · Sprint 3 Kade personality integration (E1-E5) ────────────
import { pickLine, type DialogueKey } from "../engine/composer/kadeDialogue";
import { setPose } from "../engine/composer/kadePoses";
import { useSilenceCounter } from "../engine/composer/kadeSilence";
import { moveKade } from "../engine/composer/kadeMove";
import { CelebrationFlash } from "../components/CelebrationFlash";
// ── Sprint 3 · E4 · ComposerKade canvas actor (absolute-positioned) ─────
import { ComposerKade } from "../engine/composer/ComposerKade";
// ── Composer D · Reaction Record mode live preview ──────────────────────
import { ReactionRecordPreview } from "../engine/composer/ReactionRecordPreview";
import { useEvent } from "../bridge/useEvent";
// ── Sprint 3 · E7 · Slot A/B/C system ───────────────────────────────────
import { SlotGrid } from "../engine/composer/SlotGrid";
// ── Sprint 3 · E6 · Voice input via Web Speech API ──────────────────────
import { useVoiceInput } from "../engine/composer/voiceInput";

import "./Composer.css";

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-C · Command history log contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   `appendCommandHistory()` MUST:
     1. Persist to `localStorage` under key `lc.composer.history.v1`
        (versioned so a future schema change can migrate safely).
     2. Dedup the LAST entry when the same text is re-submitted (avoids
        accidental double-submits stacking).
     3. Cap the buffer at 20 entries · FIFO evict when full · prevents
        unbounded growth on power users.
     4. Wrap in try/catch so localStorage disabled (Safari private mode,
        Playwright evaluate context) never throws from `submitCommand`.
     5. Log the user's raw trimmed text BEFORE routing so misses + asks
        also surface in A8's history chips (debugging user friction).
   Removing the log or moving it after routing means users lose visibility
   into commands the router couldn't resolve · degrading the pedagogical
   value of the surface. Regression test `Composer.commandbar.test.ts` +
   lint invariants #25–30 enforce.
   ═════════════════════════════════════════════════════════════════════ */
const COMPOSER_HISTORY_STORAGE_KEY = "lc.composer.history.v1";
const COMPOSER_HISTORY_CAP = 20;
/** A8 · number of history chips rendered as clickable re-fires above the
 *  command bar. Distinct from the storage cap so we can widen the
 *  stored history without cluttering the chip row. */
const A8_HISTORY_CHIP_LIMIT = 8;

function appendCommandHistory(cmd: string): void {
  if (!cmd) return;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (list[list.length - 1] === cmd) return;
    list.push(cmd);
    while (list.length > COMPOSER_HISTORY_CAP) list.shift();
    window.localStorage.setItem(
      COMPOSER_HISTORY_STORAGE_KEY,
      JSON.stringify(list),
    );
  } catch {
    /* localStorage disabled · non-fatal */
  }
}

/** Read-only accessor for A8's history-chip render. Returns a defensive
 *  copy so consumers can't mutate the underlying buffer. */
export function readCommandHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice() : [];
  } catch {
    return [];
  }
}

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-D · Turbo mode toggle contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   Turbo mode collapses Composer animation durations to 40 ms so power
   users can burn through flows without the theatre. Contract:
     1. `useTurboMode()` reads initial state from `localStorage` key
        `lc.composer.turbo.v1` synchronously on mount · avoids the flash
        of default-off before hydration completes.
     2. Toggle writes to same key immediately (write-through), so the
        next mount + parallel Composer surfaces reflect the flip.
     3. Composer's outer wrapper carries `data-turbo="true" | "false"`
        so CSS rules keyed on that attribute override animation
        durations globally within the route.
     4. Wrap the read in try/catch so localStorage-disabled runtimes
        (Safari private mode, Playwright evaluate context) fall back
        to `false` without throwing.
   Removing the localStorage persistence forces users to re-flip every
   session · defeats the entire "productivity mode" purpose. Regression
   test `Composer.turbo.test.ts` + lint invariants #31–36 enforce.
   ═════════════════════════════════════════════════════════════════════ */
const COMPOSER_TURBO_STORAGE_KEY = "lc.composer.turbo.v1";

function readTurboFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COMPOSER_TURBO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useTurboMode(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(() => readTurboFromStorage());
  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          COMPOSER_TURBO_STORAGE_KEY,
          next ? "1" : "0",
        );
      } catch {
        /* storage disabled · toggle still flips in-memory */
      }
      return next;
    });
  }, []);
  return [on, toggle];
}

/* ==========================================================================
 * Composer state machine
 * ==========================================================================
 * activeFlow    · which ParamPanel is currently mounted (one at a time)
 * askQueue      · the routed intent when the router asked for a choice
 * resolvedParams· accumulator for multi-param asks (e.g. layout + audio)
 * lastCap       · the capability from the current run (for the ask → execute
 *                 hand-off after the user resolves the last param)
 */

type ComposerFlow =
  | "flowReaction"
  | "flowCaptions"
  | "flowTrim"
  | "flowFrame"
  | "flowAudio"
  | "flowTimeline"
  | "flowWatermark"
  | "flowRecord"
  | "flowCampaign"
  | "flowLibrary"
  | "flowDiscovery"
  | "flowReactionsDeep"
  | "flowAspect"
  | null;

interface ComposerRuntimeState {
  activeFlow: ComposerFlow;
  askQueue: RoutedIntent | null;
  resolvedParams: Record<string, unknown>;
  lastCap: Capability | null;
}

type ComposerAction =
  | { type: "route-execute"; capability: Capability; resolved: Record<string, unknown> }
  | { type: "route-ask"; intent: RoutedIntent; capability: Capability }
  | { type: "route-miss" }
  | { type: "close-ask" }
  | { type: "close-flow" }
  | { type: "merge-param"; key: string; value: unknown };

const INITIAL_RUNTIME: ComposerRuntimeState = {
  activeFlow: null,
  askQueue: null,
  resolvedParams: {},
  lastCap: null,
};

function runtimeReducer(
  state: ComposerRuntimeState,
  action: ComposerAction,
): ComposerRuntimeState {
  switch (action.type) {
    case "route-execute":
      return {
        activeFlow: (action.capability.flow as ComposerFlow) ?? null,
        askQueue: null,
        resolvedParams: action.resolved,
        lastCap: action.capability,
      };
    case "route-ask":
      return {
        ...state,
        askQueue: action.intent,
        lastCap: action.capability,
      };
    case "route-miss":
      return { ...state, askQueue: null };
    case "close-ask":
      return { ...state, askQueue: null };
    case "close-flow":
      return { activeFlow: null, askQueue: null, resolvedParams: {}, lastCap: null };
    case "merge-param":
      return {
        ...state,
        resolvedParams: { ...state.resolvedParams, [action.key]: action.value },
      };
    default:
      return state;
  }
}

/* ==========================================================================
 * Drift-mapped writer · resolved params → cockpit setters
 * ==========================================================================
 * Every capability declares `writes_to` = "reaction.layout" | "caption.style"
 * | "style.watermark" | "baseWindow.aspect" | "baseWindow.layout".
 * Split on "." to route to the right setter. Unknown paths fall through to
 * setBaseWindow so a new capability doesn't silently drop its resolved value.
 */

interface CockpitWriters {
  setReaction: ReturnType<typeof useCockpit>["setReaction"];
  setCaption: ReturnType<typeof useCockpit>["setCaption"];
  setTrim: ReturnType<typeof useCockpit>["setTrim"];
  setStyle: ReturnType<typeof useCockpit>["setStyle"];
  setPublish: ReturnType<typeof useCockpit>["setPublish"];
  setBaseWindow: ReturnType<typeof useCockpit>["setBaseWindow"];
}

function writeThroughDrift(
  writers: CockpitWriters,
  writesTo: string | undefined,
  field: string,
  value: unknown,
): void {
  if (!writesTo) {
    // Capability has no declared write path · park the value on the base
    // window bag so nothing gets lost. Composer's dev-panel still displays it.
    writers.setBaseWindow({ [field]: value } as Record<string, unknown>);
    return;
  }
  const [section] = writesTo.split(".");
  const patch = { [field]: value } as Record<string, unknown>;
  switch (section) {
    case "reaction":
      writers.setReaction(patch as never);
      return;
    case "caption":
      writers.setCaption(patch as never);
      return;
    case "trim":
      writers.setTrim(patch as never);
      return;
    case "style":
      writers.setStyle(patch as never);
      return;
    case "publish":
      writers.setPublish(patch as never);
      return;
    case "baseWindow":
    default:
      writers.setBaseWindow(patch as never);
      return;
  }
}

/* ==========================================================================
 * Focused-clip resolution
 * ==========================================================================
 * IRON GATE IG-LC2-016 · the composer resolves focusedClip from the LIVE
 * engine session (never FIXTURE_PROJECT). When no clip has been picked yet,
 * we still mount CockpitProvider with the fixture clip[0] as a STABLE
 * structural placeholder — matching the Workstation pattern from BUG-032
 * so the provider's React identity doesn't churn on focus changes.
 */

function useFocusedClipFromSession(): Clip | undefined {
  const session = useEngineSession();
  if (!session.project) return undefined;
  const clips = session.project.clips;
  if (!clips || clips.length === 0) return undefined;
  return clips[0];
}

function useProjectSlug(): string | undefined {
  const session = useEngineSession();
  return session.project?.slug ?? session.slug ?? undefined;
}

/* ==========================================================================
 * ComposerCanvas
 * ==========================================================================
 * Idle-state canvas + command bar + dev panel + Kade avatar mount point.
 * Ask panel + one active flow panel dock on the right.
 */

function ComposerCanvas(): ReactElement {
  const [turbo, toggleTurbo] = useTurboMode();
  // 2026-07-19 · S2 wire · mode + speed stores drive the mockup HUD buttons.
  const [hudMode, setHudMode] = useModeStore();
  const [hudSpeed, setHudSpeed] = useSpeedStore();
  const cockpit = useCockpit();
  // Ship button needs to know if we have a real focused clip to hand off
  // to Workstation. Both come from the ancestor EngineSessionProvider
  // (ComposerRoute.tsx:1131 chain).
  const focusedClip = useFocusedClipFromSession();
  const shipSlug = useProjectSlug();
  // Cold-boot gate · shows the "Start in Create" hero when the user
  // arrived with NO persisted engine session at all — the true "first
  // launch or fresh signout" case. Composer doesn't itself mount
  // `useEngineSessionPersistence`, so we do a one-time synchronous
  // localStorage read to detect the "there is history to work on"
  // case vs. the "come from Create" case.
  const persistedSession = useMemo(() => readPersistedSession(), []);
  const showColdBoot = !focusedClip && !persistedSession;
  const {
    setReaction,
    setCaption,
    setTrim,
    setStyle,
    setPublish,
    setBaseWindow,
    settings,
  } = cockpit;

  const writers = useMemo<CockpitWriters>(
    () => ({ setReaction, setCaption, setTrim, setStyle, setPublish, setBaseWindow }),
    [setReaction, setCaption, setTrim, setStyle, setPublish, setBaseWindow],
  );

  const [runtime, dispatch] = useReducer(runtimeReducer, INITIAL_RUNTIME);
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Sprint 1 A8 · history-chip render revision counter. Incremented on
  // every submitted command so the useMemo below re-reads localStorage
  // and the chip row picks up the fresh entry. Cheap alternative to a
  // full state store.
  const [historyRevision, setHistoryRevision] = useState(0);
  const historyChips = useMemo<readonly string[]>(() => {
    return readCommandHistory().slice(0, A8_HISTORY_CHIP_LIMIT);
  }, [historyRevision]);

  // Sprint 3 E5 · progressive silence counter · gates kade:speak so Kade
  // doesn't wear the user out after 5 successful flows in the session.
  const silenceCounter = useSilenceCounter();

  // Composer D · Reaction Record mode live preview state · IG-COMPOSER-JJ.
  const [reactionPreview, setReactionPreview] = useState<{
    active: boolean;
    layout: string;
    stream: MediaStream | null;
    elapsedMs: number;
  }>({ active: false, layout: "top-bottom", stream: null, elapsedMs: 0 });
  useEvent("composer:reaction-preview", (payload) => setReactionPreview(payload));

  // Sprint 3 E6 · voice input · Web Speech API primary, sidecar Whisper
  // fallback (deferred). Transcribed text lands in the command bar for
  // the user to review + hit Send.
  const voice = useVoiceInput({
    onTranscribed: (text) => {
      setCommand((prev) => (prev.length > 0 ? `${prev} ${text}` : text));
      inputRef.current?.focus();
    },
  });

  // Sprint 3 E1 · in-character line dispatch. Uses the dialogue library
  // (kadeDialogue.pickLine) instead of hardcoded copy. Wrapped in the
  // silence rule so post-threshold flows quiet down.
  const speakLine = useCallback(
    (key: DialogueKey, fallbackTitle: string) => {
      if (!silenceCounter.shouldEmit()) return;
      const body = pickLine(key);
      if (!body) return;
      bus.emit("kade:speak", { title: fallbackTitle, body, severity: "info" });
    },
    [silenceCounter],
  );

  // Route:enter fires on mount so the shell + telemetry know we're here.
  useEffect(() => {
    bus.emit("route:enter", { route: "composer" });
    bus.emit("kade:speak", {
      title: "Composer",
      body: "Tell me what you want. Try: add my reaction · style captions bold · record my screen.",
      severity: "info",
    });
    bus.emit("kade:mood", { mood: "idle" });
    // Sprint 3 E2 · pose swap on route enter. StickyKade / any pose-aware
    // consumer of the kade:pose bus event flips its portrait.
    setPose("idle");
  }, []);

  // Composer full-bleed workspace parity (kade-composer-simulator.html) ·
  // auto-collapse the ConsoleNav rail to the 60px icon-rail on route
  // entry so the canvas gets the mockup's edge-to-edge treatment.
  // Emits `nav:set-collapsed` (see events.ts:101) which ConsoleNav
  // subscribes to (ConsoleNav.tsx `useNavCollapsed`). Payload is
  // absolute so restore-on-unmount is deterministic — we remember the
  // enter-state and re-emit the opposite value on cleanup ONLY if we
  // were the ones who flipped it.
  useEffect(() => {
    const wasCollapsed = document.documentElement.dataset.navCollapsed === "1";
    if (!wasCollapsed) {
      bus.emit("nav:set-collapsed", { collapsed: true });
    }
    return () => {
      if (!wasCollapsed) {
        bus.emit("nav:set-collapsed", { collapsed: false });
      }
    };
  }, []);

  // The session shape the router narrows against. Aspect + reaction layout
  // are the two knobs `narrowOptions` currently reads.
  const sessionState: SessionState = useMemo(() => {
    const aspect = settings.baseWindow?.aspect ?? null;
    const lastSource: SessionState["lastSource"] =
      aspect === "9:16" ? "vertical" : aspect === "16:9" ? "wide" : null;
    return {
      lastSource,
      baseWindow: {
        window: { layout: settings.reaction.layout ?? "solo" },
      },
    };
  }, [settings.baseWindow?.aspect, settings.reaction.layout]);

  const runFlow = useCallback(
    (cap: Capability, resolved: Record<string, unknown>) => {
      // Persist every resolved key through the drift map. Each field lands
      // on the cockpit section its `writes_to` prefix declares; unknown
      // fields (Composer-only extras) park on baseWindow.
      Object.entries(resolved).forEach(([key, val]) => {
        writeThroughDrift(writers, cap.writes_to, key, val);
      });
      dispatch({ type: "route-execute", capability: cap, resolved });
      // Sprint 3 E1 · pick an in-character line for the specific flow that
      // just fired. Falls back to a generic session.success if no per-flow
      // key exists yet.
      const doneKey = `${cap.flow}.done` as DialogueKey;
      const dialogueKey: DialogueKey = pickLine(doneKey) ? doneKey : "session.success";
      speakLine(dialogueKey, cap.label);
      bus.emit("kade:mood", { mood: "thinking" });
      // Sprint 3 E2 · pose swap after a successful flow · celebration pose
      // signals the win to any pose-aware Kade consumer.
      setPose("success", cap.label);
      // Sprint 3 E3 · fire the celebration flash overlay · CelebrationFlash
      // component listens for this and shows kade-celebration.webp for
      // 800 ms (reduced when prefers-reduced-motion).
      bus.emit("composer:celebrate", {});
      // Sprint 3 E5 · increment the success counter · after 5 successful
      // flows in this session Kade's dialogue frequency drops to 1-in-3.
      silenceCounter.increment();
      // Sprint 3 E4 · nudge the in-canvas Kade actor to the right corner
      // so the reel material can breathe. ComposerKade consumes kade:move
      // and animates via transform:translate.
      moveKade(160, -20, 240);
    },
    [writers, speakLine, silenceCounter],
  );

  const submitCommand = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      // IG-COMPOSER-C · every submitted command is logged to
      // localStorage BEFORE routing so A8's history chips read a
      // stable source · misses + asks are just as valuable to surface
      // as executes (debugging user friction).
      appendCommandHistory(text);
      // A8 · nudge the chip row to refresh from localStorage on next render.
      setHistoryRevision((n) => n + 1);
      // 2026-07-19 · URL detection · when the user pastes a supported
      // portal URL (YouTube / TikTok / Instagram / etc.), skip the
      // capability router entirely and kick off the REAL sidecar
      // pipeline via `sidecar.ingestUrl(...)`. This is the connector
      // that makes Composer actually produce clips instead of just
      // firing intent events. The sidecar handles download, transcribe,
      // analyze, and populates `useEngineSession` with the picked clips
      // so the mockup's clip-stack renders the real results.
      if (isSupportedPortalUrl(text)) {
        try {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Got it · fetching your video",
            body: "Downloading, transcribing, and picking the best hooks.",
            severity: "info",
          });
          // Chain intent="clips" + count=3 so the sidecar auto-runs the
          // full analyze → pick pipeline. Session updates flow through
          // useEngineSession → the mockup's clip-stack renders the 3
          // picked clips when they arrive.
          //
          // 2026-07-20 · Tauri-lens fix · attach an explicit .catch so
          // sidecar-unavailable / IPC-timeout / whisper-crash all surface
          // to the user through Kade instead of hanging silently. Prior
          // `void` swallowed the rejection — user saw "fetching" then
          // nothing forever. Explicit error → honest Kade line.
          sidecar.ingestUrl(text, undefined, "clips", 3).catch((err) => {
            const msg = err instanceof Error ? err.message : "Something broke";
            bus.emit("kade:mood", { mood: "alert" });
            bus.emit("kade:speak", {
              title: "Couldn't fetch that video",
              body: msg.length > 140 ? msg.slice(0, 137) + "…" : msg,
              severity: "warn",
            });
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[composer] ingestUrl failed:", e);
        }
        return;
      }
      // 2026-07-19 · telemetry probe · time the whole route resolve.
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const routed = routeIntent(text, sessionState);
      const duration_ms = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
      );
      // Fire `capability:executed` on EVERY branch so the watcher +
      // Doctor + HQ see a complete per-command ledger. Kept above the
      // side-effects so the event lands even if runFlow throws.
      try {
        bus.emit("capability:executed", {
          id: routed.kind === "miss" ? null : routed.capability.id,
          flow: routed.kind === "miss" ? null : (routed.capability.flow ?? null),
          kind: routed.kind,
          command: text,
          duration_ms,
        });
      } catch { /* telemetry best-effort · never blocks the flow */ }
      // G6 · bridge to the closed observability registry (SO-GATE-5).
      // `capability:executed` is an in-process bus event · here we
      // translate the same signal into typed `feature_started` /
      // `feature_failed` events so HQ + Doctor see per-capability health
      // without a bespoke sink. Kept in a fire-and-forget try/catch so
      // an adapter uninit (SSR / early boot) never blocks the flow.
      try {
        void (async () => {
          const telemetry = await import("../../lib/telemetry");
          if (routed.kind === "miss") {
            // IRON GATE IG-COMPOSER-MISS-DIAG · 2026-07-19 · LOCKED.
            //
            // The miss telemetry MUST carry the raw query text (truncated
            // to 60 chars, sanitized by redact.ts) so admin/bugs and the
            // heatmap can show WHICH command the user typed. Prior to this
            // gate, miss events landed with `message: null` and left us
            // blind — Daniel hit 22 misses in one morning with zero signal
            // about what he typed. Do NOT drop metadata.query_text or the
            // sentinel below. Regression tests + pre-commit lint enforce
            // both. See feedback_never_regress_4_layer_defense.md.
            const queryPreview = text.slice(0, 60);
            telemetry.emit({
              event: "feature_failed",
              payload: {
                feature_id: "composer.capability.route",
                stable_error_code: "capability_route_miss",
                duration_ms,
              },
              feature_id: "composer.capability.route",
              surface: "composer",
              route: "composer",
              success: false,
              stable_error_code: "capability_route_miss",
              duration_ms,
              metadata: { query_text: queryPreview },
            });
            return;
          }
          telemetry.emit({
            event: "feature_started",
            payload: {
              feature_id: `composer.${routed.capability.id}`,
            },
            feature_id: `composer.${routed.capability.id}`,
            surface: "composer",
            route: "composer",
            duration_ms,
            metadata: { kind: routed.kind, flow: routed.capability.flow ?? null },
          });
        })();
      } catch { /* telemetry uninit · non-fatal */ }
      if (routed.kind === "execute") {
        runFlow(routed.capability, routed.resolved);
        setCommand("");
        return;
      }
      if (routed.kind === "ask") {
        dispatch({ type: "route-ask", intent: routed, capability: routed.capability });
        setCommand("");
        return;
      }
      // kind === "miss"
      dispatch({ type: "route-miss" });
      // Sprint 3 E1 + E5 · in-character error dialogue, gated by silence.
      speakLine("session.error", "");
      // Sprint 3 E2 · pose swap on miss so pose-aware Kade shows warning.
      setPose("warning");
    },
    [sessionState, runFlow, speakLine],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitCommand(command);
    },
    [command, submitCommand],
  );

  // Ask → execute hand-off. When the AskPanel resolves the current param,
  // we merge it into resolvedParams; if that was the last needed param the
  // flow executes, otherwise we pop the queue for the next param.
  const onAskResolve = useCallback(
    (paramName: string, value: unknown) => {
      const q = runtime.askQueue;
      if (!q || q.kind !== "ask") return;
      const mergedResolved: Record<string, unknown> = {
        ...runtime.resolvedParams,
        [paramName]: value,
      };
      dispatch({ type: "merge-param", key: paramName, value });
      const remaining = q.needsAsk.slice(1);
      if (remaining.length === 0) {
        runFlow(q.capability, mergedResolved);
        return;
      }
      // Still more asks. Push the next request.
      dispatch({
        type: "route-ask",
        intent: { kind: "ask", capability: q.capability, needsAsk: remaining },
        capability: q.capability,
      });
    },
    [runtime.askQueue, runtime.resolvedParams, runFlow],
  );

  const onAskDismiss = useCallback(() => {
    dispatch({ type: "close-ask" });
    bus.emit("kade:mood", { mood: "idle" });
  }, []);

  const onPanelPick = useCallback(
    (fieldName: string, value: unknown) => {
      // Panel pushes explicit picks · park on the base window unless the
      // active capability already claims a `writes_to`. Keeps the dev
      // panel honest about every parameter the user has touched.
      dispatch({ type: "merge-param", key: fieldName, value });
      const cap = runtime.lastCap;
      writeThroughDrift(writers, cap?.writes_to, fieldName, value);
    },
    [runtime.lastCap, writers],
  );

  const closeActiveFlow = useCallback(() => {
    dispatch({ type: "close-flow" });
    bus.emit("kade:mood", { mood: "idle" });
    // Sprint 3 E4 · return Kade to home position (0, 0) when the panel
    // closes. Turbo consumers clamp the 220ms to 40ms in ComposerKade.
    moveKade(0, 0, 220);
    setPose("idle");
  }, []);

  /* ═════════════════════════════════════════════════════════════════
     IRON GATE IG-COMPOSER-F · Idle canvas contract · LOCKED 2026-07-18
     ─────────────────────────────────────────────────────────────────
     Composer's canvas is BLANK by default. Only after Kade actually
     acts (a flow becomes active OR the ask panel opens) does the
     canvas material render. This is the "Kade is in control · AI
     brings the content" theme Daniel locked at
     `liquid_clips_outcome_first_dictate_ux.md`.

     Contract:
       1. `canvasLoaded` derives from EXACTLY two conditions ·
          `runtime.activeFlow !== null` OR `runtime.askQueue` truthy.
          No other signals feed it (session ready, hooks resolved,
          etc). Widening the condition means the canvas materialises
          before Kade acts · breaks the theme.
       2. `data-canvas-loaded` attribute on the .lc-composer root MUST
          equal "false" on fresh mount · CSS keyed on this attribute
          collapses all reel chrome (border, gradient, timecode, etc).
       3. `canvasAsking` derives from `!!runtime.askQueue` · CSS
          selects `data-canvas-asking="true"` to dim material during
          ask panel interactions.
     Regression test `Composer.idle.test.ts` + lint invariants #43–46
     enforce.
     ═════════════════════════════════════════════════════════════════ */
  const canvasLoaded = runtime.activeFlow !== null || !!runtime.askQueue;
  const canvasAsking = !!runtime.askQueue;
  const aspect = settings.baseWindow?.aspect ?? null;

  // 2026-07-19 · Mock-composer opt-in.
  //
  // When `lc:composer.mock.v1 === "1"` (or `?mock=1` in the URL), we
  // render the pixel-1:1 mockup iframe instead of the full Composer
  // tree. Commands / clicks route through the real submitCommand +
  // setBaseWindow so behavior stays wired.
  //
  // Default ON for the 2026-07-19 walkthrough (Daniel's directive:
  // "just put the mock inside the app then wire it end to end").
  // Toggle to old tree via `?mock=0` or setting the key to "0".
  const useMock = (() => {
    try {
      if (typeof window === "undefined") return true;
      const url = new URL(window.location.href);
      const q = url.searchParams.get("mock") ?? url.hash.match(/mock=(\d)/)?.[1];
      if (q === "1") return true;
      if (q === "0") return false;
      const stored = window.localStorage.getItem("lc:composer.mock.v1");
      return stored !== "0"; // null / "1" → ON, "0" → OFF
    } catch {
      return true;
    }
  })();

  if (useMock) {
    // S11 · caption preview values are sourced from useCockpit() so the
    // fake-caption inside the mock composer reads the same shape the
    // rest of the app writes to. `undefined` (not null) lets the mockup
    // fall through to its own demo defaults when nothing is set yet.
    const captionText = settings.caption?.text || undefined;
    const captionStyle = settings.caption?.style || undefined;
    return (
      <MockComposer
        onCommand={(text) => submitCommand(text)}
        onNavClick={(route) => bus.emit("nav:click", { route })}
        onLayoutSet={(layout) => {
          // S3 · 2026-07-19 · ComposerBaseWindow.layout landed.
          if (
            layout === "single" ||
            layout === "split-vertical" ||
            layout === "split-horizontal" ||
            layout === "grid-2x2"
          ) {
            setBaseWindow({ layout });
          }
        }}
        onModeSet={(mode) => setHudMode(mode)}
        onSpeedSet={(speed) => setHudSpeed(speed)}
        onTurboToggle={() => toggleTurbo()}
        onSlotSelect={(letter) => {
          if (letter === "A" || letter === "B" || letter === "C") {
            selectSlot(letter);
          }
        }}
        // S5 · SHIP → the same intent pipeline as any typed command.
        onShip={() => submitCommand("ship this clip")}
        // S7 · real preview URL wire is a follow-up · pass null for now
        //      so `.video-area` keeps its idle noise/subject fixture.
        videoSrc={null}
        // S8 · real transcript wire is a follow-up (needs live clip).
        transcriptWords={undefined}
        // S9 · real clip stack wire is a follow-up.
        clips={undefined}
        // S11 · caption preview wired to useCockpit().
        captionText={captionText}
        captionStyle={captionStyle}
        // S12 · real brief wire is a follow-up (needs picked campaign).
        brief={undefined}
        // 2026-07-19 · Bind canvas-loaded / aspect / layout to real state so
        //   the mockup DOM's data-* attributes flip when the user acts
        //   (idle greeting fades, aspect updates, layout switches).
        canvasLoaded={canvasLoaded}
        canvasAspect={aspect === "9:16" || aspect === "16:9" || aspect === "1:1" ? aspect : "9:16"}
        canvasLayoutMode={
          settings.baseWindow?.layout === "single"
            || settings.baseWindow?.layout === "split-vertical"
            || settings.baseWindow?.layout === "split-horizontal"
            || settings.baseWindow?.layout === "grid-2x2"
              ? settings.baseWindow.layout
              : "single"
        }
        activeMode={hudMode}
        activeSpeed={hudSpeed}
        turboActive={turbo}
        activeRoute="composer"
      />
    );
  }

  return (
    <div
      className="lc-composer"
      data-canvas-loaded={canvasLoaded ? "true" : "false"}
      data-canvas-asking={canvasAsking ? "true" : "false"}
      data-aspect={aspect ?? "unset"}
      data-turbo={turbo ? "true" : "false"}
    >
      {/* ───── IRON GATE IG-LC2-016 — see docs/lc2/IRON_GATES_LC2.md ─────
          Composer resolves its focused clip from the live engine session,
          never FIXTURE_PROJECT. This gate is enforced UPSTREAM by
          `useFocusedClipFromSession()` (the ComposerBody consumer), not
          in this canvas — the canvas only READS through useCockpit(),
          which the provider seeded from the same live clip. */}
      {/* ───── END IRON GATE IG-LC2-016 (focusedClip resolution) ───── */}

      <h1
        className="lc-visually-hidden"
        data-route-title="Composer"
        data-kade-anchor
      >
        Composer
      </h1>

      <div className="lc-composer-canvas" role="presentation">
        {/* Canvas header · mockup parity · kade-composer-simulator.html:2459-2465.
            Left: `Video · Base Window` eyebrow. Right: aspect tag + regions
            count (money-green when non-solo). */}
        <div className="lc-composer-canvas-header" aria-hidden="true">
          <span className="lc-composer-canvas-header-eb">
            Video · <b>Base Window</b>
          </span>
          <div className="lc-composer-canvas-header-right">
            <span className="lc-composer-canvas-tag">
              {aspect ?? "9:16"} vertical
            </span>
            <span
              className="lc-composer-canvas-tag is-money"
              data-testid="composer-regions-tag"
            >
              {(() => {
                switch (settings.reaction.layout) {
                  case "solo": return "0 regions";
                  case "side-by-side":
                  case "top-bottom":
                  case "pip-tr":
                  case "pip-tl":
                  case "pip-br":
                  case "pip-bl": return "2 regions";
                  case "grid-2x2": return "4 regions";
                  case "full-overlay": return "1 region";
                  default: return "0 regions";
                }
              })()}
            </span>
          </div>
        </div>

        {/* Layout switcher strip · mockup parity · lines 2476-2479.
            Writes settings.reaction.layout so the shared export pipeline
            (ReactionModule + reaction merge) picks it up. */}
        <div
          className="lc-composer-layout-strip"
          data-testid="composer-layout-strip"
          role="toolbar"
          aria-label="Canvas layout"
        >
          {(
            [
              { key: "solo",         label: "Single" },
              { key: "side-by-side", label: "⇔ Split-V" },
              { key: "top-bottom",   label: "⇕ Split-H" },
              { key: "grid-2x2",     label: "⊞ 2×2" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              className="lc-composer-layout-btn"
              data-active={settings.reaction.layout === opt.key ? "true" : "false"}
              data-testid={`composer-layout-${opt.key}`}
              onClick={() => cockpit.setReaction({ layout: opt.key })}
              title={opt.label}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Cold-boot empty state · shows when no clip has been loaded
            into the session yet. Guides the user to Create rather than
            leaving the canvas silently idle. Once a clip is focused,
            this vanishes and the aspect picker takes over. */}
        {showColdBoot && (
          <div
            className="lc-composer-cold-boot"
            data-testid="composer-cold-boot"
            role="region"
            aria-label="No clip loaded"
          >
            <span className="lc-composer-cold-boot-eb">No clip loaded</span>
            <h2 className="lc-composer-cold-boot-title">Start in Create</h2>
            <p className="lc-composer-cold-boot-sub">
              Drop a source file or paste a URL in Create. Once Liquid
              Clips finishes analyzing, come back here and Kade will
              shape it into a clip you can Ship.
            </p>
            <button
              type="button"
              className="lc-composer-cold-boot-cta"
              data-testid="composer-cold-boot-cta"
              onClick={() => bus.emit("nav:click", { route: "create" })}
            >
              Open Create →
            </button>
          </div>
        )}

        {!showColdBoot && (
        <div className="lc-composer-canvas-hint" data-testid="composer-idle-hint">
          <span className="lc-composer-hint-eb">Type an aspect</span>
          <div
            className="lc-composer-aspect-picker"
            role="group"
            aria-label="Pick a canvas aspect"
            data-testid="composer-aspect-picker"
          >
            {([
              { key: "9:16", label: "9:16" },
              { key: "16:9", label: "16:9" },
              { key: "1:1",  label: "1:1"  },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                className="lc-composer-aspect-btn"
                data-active={aspect === opt.key ? "true" : "false"}
                data-testid={`composer-aspect-${opt.key}`}
                onClick={() => cockpit.setBaseWindow({ aspect: opt.key })}
                title={`Set aspect ${opt.label}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Quick Actions side panel · kade-composer-simulator.html:2735-2760
          parity. Each button fires a canonical command through the same
          engine router the command bar uses (submitCommand) — so voice /
          text / click all converge on one intent lane. Idle-time surface;
          non-blocking; hidden when a flow panel is active so the canvas
          stays the focal point. */}
      {runtime.activeFlow === null && !runtime.askQueue && (
        <aside
          className="lc-composer-quickactions"
          data-testid="composer-quickactions"
          aria-label="Quick actions"
        >
          <div className="lc-composer-quickactions-header">
            <span className="lc-composer-quickactions-eb">
              Kade · <b>Waiting for you</b>
            </span>
          </div>
          <div className="lc-composer-quickactions-list" role="list">
            {([
              // "give me 3 clips" routes to discovery.scrub. The obvious
              // phrasing "find 3 clips" would hit library.search first
              // (its /\bfind\b/i comes before discovery.scrub in
              // CAPABILITY_ORDER). Label stays mockup-verbatim.
              { cmd: "give me 3 clips",           label: "Find 3 clips from footage" },
              { cmd: "add my reaction",           label: "Add my reaction" },
              { cmd: "style my captions",         label: "Style captions" },
              // "library" hits library.search cleanly without falling into
              // /find/ ordering (both match; library.search is first anyway).
              { cmd: "library",                   label: "Find clip in library" },
              { cmd: "match this brief",          label: "Match this brief" },
            ] as const).map((qa) => (
              <button
                key={qa.cmd}
                type="button"
                className="lc-composer-quickaction-btn"
                data-testid={`composer-quickaction-${qa.cmd.replace(/\s+/g, "-")}`}
                onClick={() => submitCommand(qa.cmd)}
              >
                {qa.label}
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Editing tab strip · kade-composer-simulator.html:2871-2887 parity.
          "EDITING · NO SLOT" eyebrow + 4 canonical tabs (TRIM · CAPTIONS ·
          REACTIONS · AUDIO). Each click submits its canonical verb, which
          routes through the same engine path as voice + text. Sits above
          the command bar in grid row 2. */}
      <div
        className="lc-composer-editing-tabs"
        data-testid="composer-editing-tabs"
        role="toolbar"
        aria-label="Editing tabs"
      >
        <span className="lc-composer-editing-eb">
          Editing · <b>no slot</b>
        </span>
        {([
          { key: "flowTrim",     cmd: "trim this clip",    label: "Trim" },
          { key: "flowCaptions", cmd: "style my captions", label: "Captions" },
          { key: "flowReaction", cmd: "add my reaction",   label: "Reactions" },
          // "audio settings" misses every audio.mix regex (duck audio / mix
          // audio / add music / lofi). "mix audio" hits the /mix audio/i
          // intent · verified against capabilities.ts audio.mix entry.
          { key: "flowAudio",    cmd: "mix audio",         label: "Audio" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="lc-composer-editing-tab"
            data-active={runtime.activeFlow === tab.key ? "true" : "false"}
            data-testid={`composer-editing-tab-${tab.label.toLowerCase()}`}
            onClick={() => submitCommand(tab.cmd)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═════════════════════════════════════════════════════════════════
          IRON GATE IG-COMPOSER-T · Command history chip row · A8
          ─────────────────────────────────────────────────────────────────
          Renders the last N (A8_HISTORY_CHIP_LIMIT = 8) commands as
          clickable chips. Click re-fires the exact command through
          submitCommand · same routing path as a fresh keyboard submit.
          Hidden when historyChips is empty so the idle canvas stays
          truly idle · IG-COMPOSER-F composure preserved.
          ═════════════════════════════════════════════════════════════════ */}
      {historyChips.length > 0 && (
        <div
          className="lc-composer-history"
          data-testid="composer-history-chips"
          role="toolbar"
          aria-label="Command history"
        >
          {historyChips.map((chip, idx) => (
            <button
              key={`${chip}-${idx}`}
              type="button"
              className="lc-composer-history-chip"
              data-testid={`composer-history-chip-${idx}`}
              onClick={() => submitCommand(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form className="lc-composer-command" onSubmit={onSubmit} role="search">
        {/* Ship CTA · closes the Composer→Export loop.
            Captures the LIVE cockpit `settings` + focused clip identity
            into `lc.composer.handoff.v1`, then navigates to `#/export`.
            Workstation reads the handoff on mount and applies it (force-focus
            the same clip.idx so CockpitProvider re-seeds settings from
            the store Composer wrote to). The alias `export: workstation`
            in SimulatorRouter is why `#/export` lands on Workstation.
            ExportRoute is a drift route (see ExportRoute.tsx G4 comment).
            ExportPanel (format from aspect, preset from style, watermark
            from tier). Disabled when there is no focused clip — the
            hero empty state guides the user to Create instead. */}
        <button
          type="button"
          className="lc-composer-ship"
          data-testid="composer-ship-btn"
          aria-label="Ship this clip"
          disabled={!focusedClip || !shipSlug}
          title={
            focusedClip && shipSlug
              ? "Ship this clip · render + prepare to submit"
              : "Load a clip in Create first · then Ship"
          }
          onClick={() => {
            if (!focusedClip || !shipSlug) return;
            // Settings persist via `CockpitProvider.patch()` →
            // `clipSettingsStore[slug:clipIdx]`. Workstation's mount
            // reads them back via `seedFor()`. Handoff carries the
            // intent + clip identity + campaign context.
            //
            // P0 · 2026-07-19 · capture activeCampaignId at Ship time
            // so the auto-Submit-to-Whop flow on the Workstation side
            // knows which bounty to attribute against. Producer + consumer
            // interface stay in sync per read-both-sides-of-contract.
            const activeCampaignId = getModeState().activeCampaignId;
            writeComposerHandoff({
              slug: shipSlug,
              clipIdx: focusedClip.idx,
              campaignId: activeCampaignId,
            });
            bus.emit("nav:click", { route: "export" });
          }}
        >
          Ship →
        </button>
        <button
          type="button"
          className="lc-composer-mic"
          data-testid="composer-mic-btn"
          data-listening={voice.state === "listening" ? "true" : "false"}
          data-supported={voice.supported ? "true" : "false"}
          aria-label={voice.state === "listening" ? "Stop voice input" : "Start voice input"}
          aria-pressed={voice.state === "listening"}
          disabled={!voice.supported}
          title={
            voice.error
              ? voice.error
              : voice.state === "listening"
              ? "Listening… click to stop"
              : voice.supported
              ? "Voice command · click to speak"
              : "Voice input unavailable in this browser"
          }
          onClick={() => (voice.state === "listening" ? voice.stop() : voice.start())}
        >
          <MicIcon />
        </button>
        <input
          ref={inputRef}
          className="lc-composer-input"
          type="text"
          placeholder="tell Kade what to do…"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          data-testid="composer-command-input"
          aria-label="Composer command"
        />
        <button
          type="submit"
          className="lc-composer-send"
          data-testid="composer-command-send"
          disabled={!command.trim()}
        >
          Send
        </button>
      </form>

      {/* Ask panel · mounts absolute over the canvas when the router
          returned kind:"ask". Renders the first unresolved param first
          and re-mounts as each param is picked. */}
      {runtime.askQueue && runtime.askQueue.kind === "ask" && (
        <EngineErrorBoundary route="composer" component="AskPanel">
          <AskPanel
            capability={runtime.askQueue.capability}
            needsAsk={runtime.askQueue.needsAsk}
            onResolve={onAskResolve}
            onDismiss={onAskDismiss}
            session={sessionState}
          />
        </EngineErrorBoundary>
      )}

      {/* Flow panel dock · one active at a time. Each panel visibility
          toggle is a `visible` prop — no dynamic imports needed since
          all 12 are already ported for Phase 1b. */}
      <div className="lc-composer-flow-dock" data-testid="composer-flow-dock">
        <EngineErrorBoundary route="composer" component="FlowPanels">
          <ReactionPanel visible={runtime.activeFlow === "flowReaction"} onPick={onPanelPick} />
          <CaptionsPanel visible={runtime.activeFlow === "flowCaptions"} onPick={onPanelPick} />
          <TrimPanel visible={runtime.activeFlow === "flowTrim"} onPick={onPanelPick} />
          <FramePanel visible={runtime.activeFlow === "flowFrame"} onPick={onPanelPick} />
          <AudioPanel visible={runtime.activeFlow === "flowAudio"} onPick={onPanelPick} />
          <TimelinePanel visible={runtime.activeFlow === "flowTimeline"} onPick={onPanelPick} />
          <WatermarkPanel visible={runtime.activeFlow === "flowWatermark"} onPick={onPanelPick} />
          <RecordPanel visible={runtime.activeFlow === "flowRecord"} onPick={onPanelPick} />
          <CampaignPanel visible={runtime.activeFlow === "flowCampaign"} onPick={onPanelPick} />
          <LibraryPanel visible={runtime.activeFlow === "flowLibrary"} onPick={onPanelPick} />
          <DiscoveryPanel visible={runtime.activeFlow === "flowDiscovery"} onPick={onPanelPick} />
          <ReactionsDeepPanel visible={runtime.activeFlow === "flowReactionsDeep"} onPick={onPanelPick} />
        </EngineErrorBoundary>
        {runtime.activeFlow && (
          <button
            type="button"
            className="lc-composer-flow-close"
            onClick={closeActiveFlow}
            aria-label="Close panel"
            data-testid="composer-flow-close"
          >
            Close panel
          </button>
        )}
      </div>

      {/* Base-window dev panel · shows the resolved state Kade is holding.
          Phase 1 dev-only preview — Daniel + Max read this to verify
          drift-mapping is landing values on the right section. */}
      {/* ═════════════════════════════════════════════════════════════════
          IRON GATE IG-COMPOSER-B · Base Window dev-panel contract · LOCKED 2026-07-18
          ─────────────────────────────────────────────────────────────────
          The dev-panel MUST:
            1. Read `settings` from `useCockpit()` LIVE. Never from
               module state, a fixture, or a stale useMemo snapshot.
               Every user action that mutates CockpitContext must
               re-render the JSON on the next React tick.
            2. Include `settings.baseWindow` in the rendered payload
               so voice/text commands writing to Composer-only fields
               (aspect, layout, snap) are visible to the user.
            3. Expose testid `composer-dev-panel` (master plan A6 spec)
               for QA + regression grep stability. No legacy testids
               remain — nothing else in `src/**` or `tests/**` reads
               the previous `composer-basewindow` id.
            4. Render the JSON via `JSON.stringify(payload, null, 2)`
               so the pretty-print reads honestly · never a truncated
               placeholder.
          Removing the live `settings` read reintroduces the "demo
          theater" failure that led to the 2026-07-18 Composer pull.
          Regression test `Composer.devpanel.test.ts` + lint invariants
          #19–24 enforce.
          ═════════════════════════════════════════════════════════════ */}
      <aside
        className="lc-composer-basewindow"
        aria-label="Base window · dev preview"
        data-testid="composer-dev-panel"
      >
        <div className="lc-composer-basewindow-eb">
          Base window
          <button
            type="button"
            className="lc-composer-turbo-btn"
            data-testid="composer-turbo-toggle"
            data-active={turbo ? "true" : "false"}
            aria-pressed={turbo}
            onClick={toggleTurbo}
            title={turbo ? "Turbo mode ON · 40 ms motion · click to slow" : "Turbo mode OFF · click for fast motion"}
          >
            {turbo ? "TURBO" : "turbo"}
          </button>
        </div>
        <pre className="lc-composer-basewindow-json">
{JSON.stringify(
  {
    reaction: settings.reaction,
    caption: settings.caption,
    trim: settings.trim,
    style: settings.style,
    baseWindow: settings.baseWindow ?? {},
    resolvedThisRun: runtime.resolvedParams,
    activeFlow: runtime.activeFlow,
    lastCap: runtime.lastCap?.id ?? null,
  },
  null,
  2,
)}
        </pre>
      </aside>

      {/* Sprint 3 E3 · CelebrationFlash mounts once, listens for the
          "composer:celebrate" bus event, and renders the 240×240 flash
          for 800ms (reduced when prefers-reduced-motion). Fires from
          runFlow() after a successful capability execution. */}
      <CelebrationFlash />

      {/* Sprint 3 E7 · SlotGrid overlay lets the user pick region A/B/C.
          Router can also drive this via composer:slot-select from a
          voice command ("add reaction to slot B"). */}
      <SlotGrid />

      {/* Composer D · Reaction Record mode live preview · IG-COMPOSER-JJ.
          Mounted inside the canvas so the user sees screen+camera split
          exactly where the final clip will render. */}
      <ReactionRecordPreview
        visible={reactionPreview.active}
        layout={reactionPreview.layout as never}
        stream={reactionPreview.stream}
        elapsedMs={reactionPreview.elapsedMs}
      />

      {/* Sprint 3 E4 · ComposerKade · absolute-positioned Kade actor
          inside the composer canvas. Listens for kade:move (transform
          transitions) + kade:pose (portrait swap). Distinct from
          StickyKade (shell-level sticky wrapper). */}
      <ComposerKade turbo={turbo} />
    </div>
  );
}

/* ==========================================================================
 * ComposerBody
 * ==========================================================================
 * Wraps CockpitProvider around the canvas. Focused-clip and slug are read
 * from the LIVE engine session. Provider identity stays stable across
 * clip switches — IG-LC2-018 mirrors the Workstation pattern.
 */

function ComposerBody(): ReactElement {
  useKadeFromSession("composer");
  const focusedClip = useFocusedClipFromSession();
  const slug = useProjectSlug();
  const spec = ROUTE_REGISTRY.composer;

  // ───── IRON GATE IG-LC2-018 — see BUG-032 P0 AFTER FIX (harness) ─────
  // CockpitProvider is mounted ONCE, ALWAYS. When no clip is focused, we
  // pass the fixture clip[0] as a STABLE structural placeholder so the
  // provider's React identity does not churn on focus changes. Mirrors
  // Workstation.tsx (see BUG-032 P0 lift). Consumers still key any
  // visible behaviour on `focusedClip` truthy, not on the provider mount.
  const providerClip = focusedClip ?? FIXTURE_PROJECT.clips[0];
  // ───── END IRON GATE IG-LC2-018 (lifted provider, stable mount) ─────

  return (
    // ───── IRON GATE IG-LC2-017 — see docs/lc2/IRON_GATES_LC2.md ─────
    // Every consumer that reads the focused clip inside Composer reads it
    // from the SAME useCockpit() context. The dock + preview equivalents
    // in Workstation cannot fall onto different clip contexts because the
    // provider wraps every child; the same holds here — Composer's flow
    // panels and canvas both hang off the same provider.
    <CockpitProvider clip={providerClip} slug={slug}>
      <DesignOSAppShell
        world={spec.world}
        route="composer"
        defaultKade={spec.defaultKade}
        kadePlacement={spec.kadePlacement}
      >
        <ComposerCanvas />
      </DesignOSAppShell>
    </CockpitProvider>
    // ───── END IRON GATE IG-LC2-017 (single provider, single focus) ───
  );
}

/* ==========================================================================
 * ComposerRoute · public export
 * ==========================================================================
 * 4-layer wrap matches Workstation.tsx:266-559:
 *   Watchdog → EngineSessionProvider → CockpitProvider → DesignOSAppShell
 * Kept order-stable so a future ship-lens pass can diff the two routes.
 */

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-A · Composer route mount contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   ComposerRoute MUST:
     1. Wrap in the same 4-layer pattern as WorkstationRoute:
        Watchdog → EngineSessionProvider → CockpitProvider → DesignOSAppShell.
        Any reorder or omission strips the crash-recovery + session +
        composition + shell contracts and reintroduces the crash surfaces
        that IG-LC2-016/017/018 exist to prevent.
     2. Resolve focusedClip via `useFocusedClipFromSession()` which reads
        the LIVE `useEngineSession().project.clips[0]` — NEVER from
        FIXTURE_PROJECT. This is the Composer-side transfer of IG-LC2-016.
     3. Mount CockpitProvider ONCE inside ComposerBody, unconditionally
        (STABLE fallback clip when no focus). Composer-side transfer of
        IG-LC2-018 · reference implementation at Composer.tsx:542.
     4. Emit `bus.emit("route:enter", { route: "composer" })` on mount.
        See Composer.tsx:255. Confirms the Design OS routing pipeline
        registered the surface and downstream telemetry can observe.
   Removing or reordering any of the 4 wrappers reintroduces the crash
   surfaces that IG-LC2-016/017/018 exist to prevent. Reverting
   focusedClip to a fixture breaks Sprint 2's editor-reuse features.
   Pre-commit hook + `Composer.mount.test.ts` regression test enforce.
   ═════════════════════════════════════════════════════════════════════ */
export function ComposerRoute(): ReactElement {
  return (
    <Watchdog
      id="pipeline/cp-02/composer-route"
      label="Composer · voice-driven cockpit"
      cluster="pipeline"
      source="src/design-os/routes/Composer.tsx:ComposerRoute"
    >
      <EngineSessionProvider resetOnRouteEnter>
        <ComposerBody />
      </EngineSessionProvider>
    </Watchdog>
  );
}

/* ==========================================================================
 * Icons
 * ========================================================================== */

function MicIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  );
}

export default ComposerRoute;
