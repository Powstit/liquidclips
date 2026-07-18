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
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { CockpitProvider, useCockpit } from "../engine/cockpit/CockpitContext";
import { FIXTURE_PROJECT, type Clip } from "../engine/types";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
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

import "./Composer.css";

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
  const cockpit = useCockpit();
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

  // Route:enter fires on mount so the shell + telemetry know we're here.
  useEffect(() => {
    bus.emit("route:enter", { route: "composer" });
    bus.emit("kade:speak", {
      title: "Composer",
      body: "Tell me what you want. Try: add my reaction · style captions bold · record my screen.",
      severity: "info",
    });
    bus.emit("kade:mood", { mood: "idle" });
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
      bus.emit("kade:speak", {
        title: "",
        body: `${cap.label}. Locked in.`,
        severity: "info",
      });
      bus.emit("kade:mood", { mood: "thinking" });
    },
    [writers],
  );

  const submitCommand = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const routed = routeIntent(text, sessionState);
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
      bus.emit("kade:speak", {
        title: "",
        body: "I didn't catch that. Try a verb — add, style, record, trim.",
        severity: "info",
      });
    },
    [sessionState, runFlow],
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
  }, []);

  const canvasLoaded = runtime.activeFlow !== null || !!runtime.askQueue;
  const canvasAsking = !!runtime.askQueue;
  const aspect = settings.baseWindow?.aspect ?? null;

  return (
    <div
      className="lc-composer"
      data-canvas-loaded={canvasLoaded ? "true" : "false"}
      data-canvas-asking={canvasAsking ? "true" : "false"}
      data-aspect={aspect ?? "unset"}
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
        <div className="lc-composer-canvas-hint" aria-hidden="true">
          <span className="lc-composer-hint-eb">Idle</span>
          <span className="lc-composer-hint-title">Waiting for a command</span>
          <span className="lc-composer-hint-sub">
            The canvas materialises the moment you tell Kade what to do.
          </span>
          {aspect && (
            <span className="lc-composer-aspect-tag" data-testid="composer-aspect-tag">
              Aspect · {aspect}
            </span>
          )}
        </div>
      </div>

      <form className="lc-composer-command" onSubmit={onSubmit} role="search">
        <button
          type="button"
          className="lc-composer-mic"
          aria-label="Voice command (Phase 2)"
          disabled
          title="Voice input arrives in Phase 2"
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
      <aside
        className="lc-composer-basewindow"
        aria-label="Base window · dev preview"
        data-testid="composer-basewindow"
      >
        <div className="lc-composer-basewindow-eb">Base window</div>
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
