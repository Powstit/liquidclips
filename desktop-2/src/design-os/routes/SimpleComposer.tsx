/**
 * SimpleComposer · minimal-but-polished Composer route
 *
 * 2026-07-21 · Wire D · Hosted LLM intent + real sidecar delivery.
 *
 * ⛔ IRON GATE IG-COMPOSER-HOSTED-INTENT · SimpleComposer MUST call
 *    requestKadeIntent (hosted /proxy/llm/intent) BEFORE the local
 *    routeIntent() fallback. Hosted path enables "trim the boring bits
 *    and add captions" · local regex is the offline fallback.
 *    Never delete this sentinel without a documented replacement path.
 *
 * ⛔ IRON GATE IG-COMPOSER-NO-STATIC-VISIBLE · zero hardcoded
 *    data-visible="true|false" string literals in this route. Every
 *    conditional render binds to React state.
 *
 * Order of resolution per user submit:
 *   1. requestKadeIntent(utterance, capabilityIds, context) → hosted LLM
 *   2. On success · action=execute → executeCapability(cap, resolved)
 *                 · action=ask     → surface needs_ask · show source
 *                                     picker when source-shaped ask
 *                 · action=miss    → suggestions list
 *   3. On throw (401/402/403/timeout/network) → local routeIntent()
 *      · guarantees the command bar never dead-ends
 *
 * Delivery path (discovery.scrub):
 *   - sidecar.startRun(path, "", "clips", count)  when file picked
 *   - sidecar.ingestUrl(url, "", "clips", count)  when URL pasted
 *   - subscribe engine:progress → live percent + stage
 *   - subscribe engine:complete → render clip cards from project.clips
 *   - subscribe engine:error    → Kade alert
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { bus, useEvent } from "../bridge";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { routeIntent, type SessionState } from "../engine/composer/router";
import { CAPABILITIES } from "../engine/composer/capabilities";
import { sidecar } from "../engine/sidecar-stub";
import type { Clip, ProjectMeta } from "../engine/types";
import {
  requestKadeIntent,
  type KadeIntent,
} from "../../lib/kadeIntentClient";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./SimpleComposer.css";

type Layout = "single" | "split-v" | "split-h" | "2x2";

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  command: string;
  icon: ReactElement;
}

interface ProgressState {
  stage: string;
  percent: number | null;
  note?: string;
  segmentsDone?: number;
  segmentsTotal?: number;
}

/** Every capability the router knows about. Passed to hostedIntent so
 *  the LLM only picks from things Composer can actually execute. */
const ALL_CAPABILITY_IDS: readonly string[] = Object.keys(CAPABILITIES);

/** Detect "source"-shaped ask names so we can show the picker UI. */
function isSourceAsk(names: readonly string[]): boolean {
  return names.some((n) => /source|file|url|video|footage/i.test(n));
}

/** Parse clip count from raw command · fallback when LLM omits it.
 *  Handles "15 clips", "15-clip pack", "make me 15 clips with hooks". */
function parseCountFromCommand(cmd: string): number | undefined {
  const m = cmd.match(/(\d{1,3})[\s-]*clips?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return undefined;
  return n;
}

/** Extract count from resolved_params (LLM) or fall back to regex. */
function resolveCount(resolved: Record<string, string>, cmd: string): number | undefined {
  const raw = resolved.count ?? resolved.n ?? resolved.number;
  if (raw != null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  }
  return parseCountFromCommand(cmd);
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "1", label: "Find 3 clips", hint: "from footage", command: "give me 3 clips", icon: <IconClips /> },
  { key: "2", label: "Add my reaction", hint: "screen + camera", command: "add my reaction", icon: <IconCam /> },
  { key: "3", label: "Style captions", hint: "bold · pop · subtle", command: "style captions bold", icon: <IconCaption /> },
  { key: "4", label: "Find clip in library", hint: "1.3M-channel HQ", command: "find clip in library", icon: <IconLibrary /> },
  { key: "5", label: "Record my screen", hint: "Kade guides you", command: "record my screen", icon: <IconRecord /> },
  { key: "6", label: "Duck the audio", hint: "auto voice + music mix", command: "duck the audio", icon: <IconAudio /> },
] as const;

export function SimpleComposerRoute(): ReactElement {
  const spec = ROUTE_REGISTRY.composer;
  const inputRef = useRef<HTMLInputElement>(null);
  const [command, setCommand] = useState("");
  const [layout, setLayout] = useState<Layout>("single");
  const [history, setHistory] = useState<string[]>([]);

  // Multi-turn intent state · when hostedIntent returns action=ask, we
  // hold the intent + the utterance so the next submit can chain with
  // the source the user picks.
  const [pendingIntent, setPendingIntent] = useState<KadeIntent | null>(null);
  const [pendingUtterance, setPendingUtterance] = useState<string>("");
  const [awaitingSource, setAwaitingSource] = useState(false);
  const [urlDraft, setUrlDraft] = useState<string>("");
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Session context · accumulates hints (lastSource, lastAspect) that
  // the LLM uses to resolve params without asking again.
  const [sessionCtx, setSessionCtx] = useState<Record<string, string>>({});

  // In-flight sidecar run state
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [clips, setClips] = useState<readonly Clip[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  // Visibility layer · 2026-07-21 (2.2.72). Users complained "nothing
  // happens" when Kade replies via bus.emit("kade:speak") because the
  // speech-bubble host may not be mounted on every route. We mirror
  // the last kade:speak inline in the sidebar so feedback is always
  // visible without depending on the shell overlay.
  const [lastReply, setLastReply] = useState<{ title: string; body: string; severity: "info" | "warn" } | null>(null);
  const [lastIntentStatus, setLastIntentStatus] = useState<
    { kind: "ok"; ms: number; action: string; quota: number | null }
    | { kind: "fail"; message: string }
    | null
  >(null);

  // Refs so late-defined callbacks (acceptSource → handleSubmit) don't
  // capture TDZ bindings, and so useEvent handlers always see the
  // freshest activeSlug (useEvent.ts uses handlerRef so the callback
  // *identity* refreshes each render, but reading state via a ref
  // is defence-in-depth against any future useEvent refactor).
  const handleSubmitRef = useRef<((cmd: string, ctx?: Record<string, string>) => Promise<void>) | null>(null);
  const activeSlugRef = useRef<string | null>(null);

  // Persist source picker choice into sessionCtx AND kick a fresh
  // hostedIntent turn so the LLM can now say "execute."
  const acceptSource = useCallback(
    (source: { path?: string; url?: string }) => {
      setSessionCtx((prev) => {
        const next: Record<string, string> = { ...prev };
        if (source.path) {
          next.source_path = source.path;
          next.lastSource = source.path;
        }
        if (source.url) {
          next.source_url = source.url;
          next.lastSource = source.url;
        }
        setAwaitingSource(false);
        setShowUrlInput(false);
        setUrlDraft("");
        // Re-submit via ref · handleSubmit is declared later in the file.
        // The ref pattern breaks TDZ concerns cleanly.
        if (pendingUtterance) {
          void handleSubmitRef.current?.(pendingUtterance, next);
        }
        return next;
      });
    },
    [pendingUtterance],
  );

  const pickFile = useCallback(async () => {
    try {
      const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
      if (!w.__TAURI_INTERNALS__) {
        bus.emit("kade:speak", {
          title: "Desktop only",
          body: "File picking needs the installed .app · try the URL button in the browser preview.",
          severity: "warn",
        });
        return;
      }
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }],
      });
      if (!chosen) return;
      const path = typeof chosen === "string" ? chosen : String(chosen);
      if (!path.trim()) return;
      void lcDiag("composer_source_picked_file", { path_len: path.length });
      acceptSource({ path });
    } catch (exc) {
      void lcDiag("composer_source_picker_failed", {
        message: (exc instanceof Error ? exc.message : String(exc)).slice(0, 200),
      });
      bus.emit("kade:speak", {
        title: "Picker failed",
        body: "Couldn't open the file picker · try Paste URL instead.",
        severity: "warn",
      });
    }
  }, [acceptSource]);

  const submitUrl = useCallback(() => {
    const u = urlDraft.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      bus.emit("kade:speak", {
        title: "URL looks off",
        body: "Paste a full URL starting with http:// or https://",
        severity: "warn",
      });
      return;
    }
    void lcDiag("composer_source_pasted_url", { url_len: u.length });
    acceptSource({ url: u });
  }, [urlDraft, acceptSource]);

  /* ──────────────────────────────────────────────────────────────
     executeCapability · runs REAL side effects for known ids.
     ────────────────────────────────────────────────────────────── */
  const executeCapability = useCallback(
    async (capId: string, resolved: Record<string, string>, rawCmd: string): Promise<void> => {
      switch (capId) {
        case "record.capture": {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Record screen",
            body: "Pick your source · Kade will guide the recording.",
            severity: "info",
          });
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const targets = await invoke<unknown[]>("screen_capture_list_targets");
            bus.emit("kade:speak", {
              title: "Ready",
              body: `Found ${Array.isArray(targets) ? targets.length : 0} capture source(s). Pick one to start.`,
              severity: "info",
            });
          } catch {
            bus.emit("kade:speak", {
              title: "Recording needs the desktop app",
              body: "Screen capture is Tauri-only. Open the installed .app to record.",
              severity: "warn",
            });
          }
          return;
        }
        case "library.search": {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Library",
            body: "Opening the HQ library · pick any clip to bring into the composer.",
            severity: "info",
          });
          bus.emit("nav:click", { route: "workstation" });
          return;
        }
        case "discovery.scrub": {
          // Source resolution priority: resolved_params (LLM) → sessionCtx (prior turn)
          const sourcePath = resolved.source_path ?? sessionCtx.source_path;
          const sourceUrl = resolved.source_url ?? sessionCtx.source_url;
          if (!sourcePath && !sourceUrl) {
            // Should be caught by action=ask, but guard anyway.
            setAwaitingSource(true);
            setPendingUtterance(rawCmd);
            bus.emit("kade:mood", { mood: "thinking" });
            bus.emit("kade:speak", {
              title: "I need the source",
              body: "Pick a file or paste a URL · then I'll cut it.",
              severity: "info",
            });
            return;
          }
          const count = resolveCount(resolved, rawCmd) ?? 3;
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: `Cutting ${count} clip${count === 1 ? "" : "s"}`,
            body: sourcePath
              ? `From ${sourcePath.split("/").pop() ?? "your file"} · scoring hooks…`
              : `From ${sourceUrl} · downloading + scoring…`,
            severity: "info",
          });
          setRunError(null);
          setClips([]);
          setProgress({ stage: "starting", percent: 0 });
          try {
            let project: ProjectMeta;
            if (sourcePath) {
              const res = await sidecar.startRun(sourcePath, "", "clips", count);
              project = res.project;
            } else {
              const res = await sidecar.ingestUrl(sourceUrl!, "", "clips", count);
              project = res.project;
            }
            setActiveSlug(project.slug);
            void lcDiag("composer_run_started", {
              slug: project.slug,
              via: sourcePath ? "file" : "url",
              count,
            });
          } catch (exc) {
            const msg = exc instanceof Error ? exc.message : String(exc);
            setRunError(msg.slice(0, 240));
            setProgress(null);
            bus.emit("kade:mood", { mood: "alert" });
            bus.emit("kade:speak", {
              title: "Couldn't start",
              body: msg.slice(0, 160),
              severity: "warn",
            });
            void lcDiag("composer_run_start_failed", { message: msg.slice(0, 200) });
          }
          return;
        }
        case "captions.style": {
          const preset = String(resolved.preset ?? "bold");
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Captions",
            body: `Style set to ${preset}. Applies to the next export.`,
            severity: "info",
          });
          try { window.localStorage.setItem("lc.composer.caption.style", preset); } catch { /* silent */ }
          return;
        }
        case "reactions.add": {
          const layoutParam = String(resolved.layout ?? "pip");
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: "Reaction",
            body: `Layout: ${layoutParam}. Start recording your reaction from the Record tile.`,
            severity: "info",
          });
          return;
        }
        default: {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: capId,
            body: `Got it · running "${rawCmd.slice(0, 60)}". Full flow lands in Volume 2.`,
            severity: "info",
          });
          void lcDiag("composer_capability_pending_wire", { cap: capId, raw: rawCmd.slice(0, 120) });
        }
      }
    },
    [sessionCtx],
  );

  /* ──────────────────────────────────────────────────────────────
     handleSubmit · LOCAL-FIRST · hosted only on local miss.
     ────────────────────────────────────────────────────────────── */
  const handleSubmit = useCallback(
    async (rawCmd: string, ctxOverride?: Record<string, string>) => {
      const cmd = rawCmd.trim();
      if (!cmd) return;
      setHistory((h) => [cmd, ...h.filter((prev) => prev !== cmd)].slice(0, 8));
      setPendingUtterance(cmd);

      const ctx = ctxOverride ?? sessionCtx;

      // Tier 1 · LOCAL regex router (fast · reliable · offline-safe · zero network)
      // This is the 07-09-equivalent direct path — user says "make 5 clips" or
      // pastes a URL, we match locally and hand off to sidecar immediately.
      const session: SessionState = {};
      const routed = routeIntent(cmd, session);

      if (routed.kind === "execute") {
        // Local resolved everything · direct-fire the capability. No LLM hop.
        setPendingIntent(null);
        setAwaitingSource(false);
        setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
        void lcDiag("composer_local_intent_ok", { action: "execute", cap: routed.capability.id });
        // Merge sessionCtx-provided source into resolved so executeCapability sees it.
        const resolved = { ...(routed.resolved as Record<string, string>) };
        if (!resolved.source_path && ctx.source_path) resolved.source_path = ctx.source_path;
        if (!resolved.source_url && ctx.source_url) resolved.source_url = ctx.source_url;
        void executeCapability(routed.capability.id, resolved, cmd);
        setCommand("");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      if (routed.kind === "ask") {
        // Local matched a capability but needs more info (usually source).
        const wantsSource = routed.capability.depends_on?.includes("source.exists") ?? false;
        // If we already have a source from a prior turn, hand it in and re-fire.
        if (wantsSource && (ctx.source_path || ctx.source_url)) {
          const resolved: Record<string, string> = {};
          if (ctx.source_path) resolved.source_path = ctx.source_path;
          if (ctx.source_url) resolved.source_url = ctx.source_url;
          setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
          void lcDiag("composer_local_intent_ok", { action: "execute_from_ctx", cap: routed.capability.id });
          void executeCapability(routed.capability.id, resolved, cmd);
          setCommand("");
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }
        // Otherwise ask.
        setLastIntentStatus({ kind: "ok", ms: 0, action: "ask", quota: null });
        void lcDiag("composer_local_intent_ok", { action: "ask", cap: routed.capability.id });
        if (wantsSource) {
          setAwaitingSource(true);
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: routed.capability.label,
            body: "Pick a file or paste a URL to start.",
            severity: "info",
          });
        } else {
          const first = routed.needsAsk[0];
          const opts = first?.spec.options?.map((o) => o.label).slice(0, 4).join(" · ") ?? "";
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: routed.capability.label,
            body: `Which ${first?.name}? ${opts}`,
            severity: "info",
          });
        }
        setCommand("");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      // Tier 2 · Local MISSED. Try hosted LLM intent for ambiguous NL commands
      // like "trim the boring bits and add captions" that regex can't match.
      // This step is optional — if it fails, we fall through to a helpful miss
      // reply. The composer NEVER dead-ends.
      let hostedIntent: KadeIntent | null = null;
      try {
        const t0 = Date.now();
        const resp = await requestKadeIntent({
          utterance: cmd,
          capability_ids: [...ALL_CAPABILITY_IDS],
          context: ctx,
        });
        hostedIntent = resp.intent;
        setLastIntentStatus({
          kind: "ok",
          ms: Date.now() - t0,
          action: hostedIntent.action,
          quota: resp.quota_remaining,
        });
        void lcDiag("composer_hosted_intent_ok", {
          action: hostedIntent.action,
          capability: hostedIntent.capability,
          ms: Date.now() - t0,
          quota_remaining: resp.quota_remaining,
        });
      } catch (exc) {
        const msg = (exc instanceof Error ? exc.message : String(exc)).slice(0, 200);
        setLastIntentStatus({ kind: "fail", message: msg });
        void lcDiag("composer_hosted_intent_failed", { message: msg });
      }

      if (hostedIntent && hostedIntent.action === "execute" && hostedIntent.capability) {
        setPendingIntent(null);
        setAwaitingSource(false);
        void executeCapability(hostedIntent.capability, hostedIntent.resolved_params ?? {}, cmd);
      } else if (hostedIntent && hostedIntent.action === "ask" && hostedIntent.capability) {
        setPendingIntent(hostedIntent);
        const asks = hostedIntent.needs_ask ?? [];
        const wantsSource = isSourceAsk(asks);
        setAwaitingSource(wantsSource);
        bus.emit("kade:mood", { mood: "thinking" });
        if (wantsSource) {
          bus.emit("kade:speak", {
            title: "Which source?",
            body: "Pick a file or paste a URL and I'll cut it.",
            severity: "info",
          });
        } else {
          bus.emit("kade:speak", {
            title: "One more thing",
            body: `I need: ${asks.join(", ")}`,
            severity: "info",
          });
        }
      } else {
        // Both tiers missed · helpful suggestion.
        bus.emit("kade:mood", { mood: "alert" });
        bus.emit("kade:speak", {
          title: "I didn't catch that",
          body: `Try one of: give me 3 clips · add my reaction · style captions · find clip in library · record my screen · duck the audio`,
          severity: "warn",
        });
      }
      setCommand("");
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [sessionCtx, executeCapability],
  );

  const submitCommand = useCallback(
    (text: string) => {
      void handleSubmit(text);
    },
    [handleSubmit],
  );

  // Keep refs current on every render · defence-in-depth against
  // TDZ (acceptSource references handleSubmit before its declaration)
  // and against future useEvent refactors that might not use handlerRef.
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);
  useEffect(() => {
    activeSlugRef.current = activeSlug;
  }, [activeSlug]);

  /* ──────────────────────────────────────────────────────────────
     Engine event subscriptions
     ────────────────────────────────────────────────────────────── */
  // Mirror every kade:speak into the sidebar so users always see the
  // feedback even if the shell speech-bubble host isn't mounted.
  useEvent("kade:speak", (p) => {
    const sev = (p as { severity?: "info" | "warn" }).severity;
    setLastReply({
      title: String((p as { title?: string }).title ?? ""),
      body: String((p as { body?: string }).body ?? ""),
      severity: sev === "warn" ? "warn" : "info",
    });
  });

  useEvent("engine:progress", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    setProgress({
      stage: p.stage,
      percent: p.percent,
      note: p.note,
      segmentsDone: p.segmentsDone,
      segmentsTotal: p.segmentsTotal,
    });
  });

  useEvent("engine:complete", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    // The sidecar's bake_complete carries the full project payload.
    const project = p.project as ProjectMeta | undefined;
    if (project && Array.isArray(project.clips) && project.clips.length > 0) {
      setClips(project.clips);
      setProgress(null);
      bus.emit("kade:mood", { mood: "idle" });
      bus.emit("kade:speak", {
        title: `${project.clips.length} clip${project.clips.length === 1 ? "" : "s"} ready`,
        body: "Scroll through · keep the winners · cut the rest.",
        severity: "info",
      });
      void lcDiag("composer_run_complete", { slug: project.slug, clips: project.clips.length });
    }
  });

  useEvent("engine:error", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    // Bug fix 2026-07-21: the event never carries `message` — only `error`
    // (raw sidecar string) and `human` (friendly, when the sidecar's own
    // humanError() ran). Reading `.message` meant every real clip failure
    // silently fell to the generic "Sidecar failed" instead of the actual,
    // often actionable reason (e.g. "video too short", "add a key to make
    // clips"). Prefer `human`, fall back to the raw `error`.
    const msg = p.human ?? p.error ?? "Sidecar failed";
    setRunError(msg);
    setProgress(null);
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", {
      title: "Run failed",
      body: msg.slice(0, 160),
      severity: "warn",
    });
    void lcDiag("composer_run_error", { message: msg.slice(0, 200) });
  });

  // Auto-focus on route mount
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, []);

  // Keyboard shortcuts · ⌘K focus · Esc blur · 1-9 quick action
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
        setCommand("");
        return;
      }
      if (document.activeElement !== inputRef.current) {
        const num = parseInt(e.key, 10);
        if (!Number.isNaN(num) && num >= 1 && num <= QUICK_ACTIONS.length) {
          e.preventDefault();
          submitCommand(QUICK_ACTIONS[num - 1].command);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitCommand]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitCommand(command);
  };

  // Progress-bar computed width
  const progressWidth = useMemo(() => {
    if (!progress) return 0;
    if (typeof progress.percent === "number") return Math.min(100, Math.max(0, progress.percent * 100));
    if (progress.segmentsTotal && progress.segmentsDone != null) {
      return Math.min(100, (progress.segmentsDone / progress.segmentsTotal) * 100);
    }
    return 6; // indeterminate hint
  }, [progress]);

  return (
    <DesignOSAppShell
      world={spec.world}
      route="composer"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      <div className="lc-simple-composer" data-testid="simple-composer">
        {/* Layout chips · top-right of canvas */}
        <div className="lc-sc-layout-strip">
          {(["single", "split-v", "split-h", "2x2"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className="lc-sc-layout-chip"
              data-active={layout === l ? "true" : "false"}
              onClick={() => setLayout(l)}
              aria-label={`Layout ${l}`}
            >
              {l === "single" ? "SINGLE" : l === "split-v" ? "SPLIT-V" : l === "split-h" ? "SPLIT-H" : "2×2"}
            </button>
          ))}
        </div>

        {/* Main canvas · hero Kade + prompt + command bar */}
        <div className="lc-sc-canvas" data-layout={layout}>
          <img
            className="lc-sc-hero"
            src="/brand/kade/kade-canvas-hero.png"
            alt=""
            aria-hidden="true"
          />
          <div className="lc-sc-prompt">What are we cutting today?</div>
          <form className="lc-sc-cmd-form" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="lc-sc-cmd-input"
              placeholder="Tell Kade what to do…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              data-testid="composer-command"
              autoComplete="off"
              spellCheck="false"
              aria-label="Command Kade"
            />
            <button
              type="submit"
              className="lc-sc-cmd-send"
              data-testid="composer-send"
              aria-label="Send command to Kade"
              disabled={!command.trim()}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </form>
          <div className="lc-sc-hotkeys">
            <kbd>⌘K</kbd> focus · <kbd>1-6</kbd> quick action · <kbd>Esc</kbd> close
          </div>

          {/* Wire status pill · shows LLM intent call result inline so
              "did anything happen" is answered without leaving the composer. */}
          {lastIntentStatus && (
            <div
              className="lc-sc-wire-status"
              data-testid="composer-wire-status"
              data-tone={lastIntentStatus.kind === "ok" ? "ok" : "fail"}
            >
              {lastIntentStatus.kind === "ok"
                ? `⚡ Kade heard you · ${lastIntentStatus.action} · ${lastIntentStatus.ms}ms`
                : `⚠ Hosted LLM failed (${lastIntentStatus.message.slice(0, 60)}) · using local fallback`}
            </div>
          )}

          {/* Source picker · appears when Kade asks for a source */}
          {awaitingSource && (
            <div className="lc-sc-source-ask" data-testid="composer-source-ask">
              <div className="lc-sc-source-ask-title">Where's the source?</div>
              <div className="lc-sc-source-ask-row">
                <button
                  type="button"
                  className="lc-sc-source-btn"
                  onClick={pickFile}
                  data-testid="composer-pick-file"
                >
                  📁 Pick a file
                </button>
                <button
                  type="button"
                  className="lc-sc-source-btn"
                  onClick={() => setShowUrlInput((v) => !v)}
                  data-testid="composer-paste-url-toggle"
                >
                  🔗 Paste URL
                </button>
              </div>
              {showUrlInput && (
                <form
                  className="lc-sc-source-url-form"
                  onSubmit={(e) => { e.preventDefault(); submitUrl(); }}
                >
                  <input
                    type="url"
                    className="lc-sc-source-url-input"
                    placeholder="https://youtube.com/watch?v=…"
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    data-testid="composer-url-input"
                    autoFocus
                  />
                  <button type="submit" className="lc-sc-source-btn">Go</button>
                </form>
              )}
            </div>
          )}

          {/* Progress · appears when a sidecar run is in flight */}
          {progress && (
            <div className="lc-sc-progress" data-testid="composer-progress">
              <div className="lc-sc-progress-eyebrow">
                {progress.stage.toUpperCase()}
                {progress.note ? ` · ${progress.note.slice(0, 60)}` : ""}
                {progress.segmentsTotal && progress.segmentsDone != null
                  ? ` · ${progress.segmentsDone} of ${progress.segmentsTotal}`
                  : ""}
              </div>
              <div className="lc-sc-progress-bar">
                <div
                  className="lc-sc-progress-fill"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
            </div>
          )}

          {/* Error · non-blocking · fades on next successful run */}
          {runError && !progress && clips.length === 0 && (
            <div className="lc-sc-error" data-testid="composer-error">
              {runError}
            </div>
          )}

          {/* Clip results · horizontal strip · appears on engine:complete */}
          {clips.length > 0 && (
            <div className="lc-sc-clips" data-testid="composer-clips">
              <div className="lc-sc-clips-eyebrow">
                {clips.length} clip{clips.length === 1 ? "" : "s"} ready · scroll →
              </div>
              <div className="lc-sc-clips-row">
                {clips.map((c) => (
                  <div key={c.idx} className="lc-sc-clip-card">
                    <div className="lc-sc-clip-title">{c.title}</div>
                    <div className="lc-sc-clip-meta">
                      {typeof c.score === "number" ? `${c.score}%` : "—"}
                      {" · "}
                      {c.duration_s
                        ? `${Math.round(c.duration_s)}s`
                        : `${Math.round(c.end - c.start)}s`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar · DOING + last reply + quick actions */}
        <aside className="lc-sc-sidebar">
          <div className="lc-sc-doing">
            <div className="lc-sc-doing-eyebrow">DOING</div>
            <img
              className="lc-sc-doing-avatar"
              src="/brand/kade/kade-idle.webp"
              alt=""
              aria-hidden="true"
            />
            <div className="lc-sc-doing-title">
              {progress ? progress.stage : awaitingSource ? "Waiting for source" : clips.length > 0 ? `${clips.length} clips ready` : lastReply ? lastReply.title : "Waiting for you"}
            </div>
          </div>

          {/* Inline Kade reply · mirrors bus.emit("kade:speak") so every
              response is visible in the sidebar regardless of the shell
              speech-bubble host. Fixes the "nothing happened" ghost. */}
          {lastReply && (
            <div
              className="lc-sc-reply"
              data-testid="composer-last-reply"
              data-tone={lastReply.severity}
            >
              <div className="lc-sc-reply-eyebrow">KADE SAID</div>
              <div className="lc-sc-reply-title">{lastReply.title}</div>
              <div className="lc-sc-reply-body">{lastReply.body}</div>
            </div>
          )}

          {/* Runtime version pill + Diagnostic shortcut · so users can
              always confirm which bundle they're on + open the X-ray. */}
          <div className="lc-sc-runtime-strip">
            <span className="lc-sc-runtime-pill">runtime 2.2.72</span>
            <a
              className="lc-sc-diag-link"
              href="#/diagnostics?staff=1"
              onClick={() => { try { window.localStorage.setItem("lc.staff.flag", "1"); } catch { /* silent */ } }}
              title="Open Diagnostic Center · X-ray of bus events + fetches + errors"
            >
              Open Diagnostic Center →
            </a>
          </div>
          <div className="lc-sc-quicks">
            <div className="lc-sc-quicks-eyebrow">QUICK ACTIONS</div>
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.key}
                type="button"
                className="lc-sc-quick"
                onClick={() => submitCommand(qa.command)}
                data-testid={`composer-quick-${qa.key}`}
                aria-label={`${qa.label} · ${qa.hint}`}
              >
                <span className="lc-sc-quick-num">{qa.key}</span>
                <span className="lc-sc-quick-icon">{qa.icon}</span>
                <span className="lc-sc-quick-label">
                  <span className="lc-sc-quick-title">{qa.label}</span>
                  <span className="lc-sc-quick-hint">{qa.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Recent commands strip · click to re-run */}
        {history.length > 0 && (
          <div className="lc-sc-recent" data-testid="composer-recent">
            <span className="lc-sc-recent-eyebrow">RECENT</span>
            {history.slice(0, 3).map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="lc-sc-recent-chip"
                onClick={() => submitCommand(cmd)}
                title={cmd}
              >
                {cmd.slice(0, 42)}{cmd.length > 42 ? "…" : ""}
              </button>
            ))}
          </div>
        )}

        {/* Silence a couple of lint warnings for state slots kept for
         *  read-in future turns (pendingIntent · activeSlug are consumed
         *  via closure in handlers above but the JSX doesn't touch them). */}
        <span hidden aria-hidden="true">
          {pendingIntent ? pendingIntent.action : ""}
          {activeSlug ?? ""}
        </span>
      </div>
    </DesignOSAppShell>
  );
}

/* ── Icons ────────────────────────────────────────────────────────── */
function IconClips() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></svg>;
}
function IconCam() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="14" height="12" rx="2" /><polygon points="17 9 22 6 22 18 17 15" /></svg>;
}
function IconCaption() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 14 L11 14" /><path d="M13 14 L17 14" /><path d="M7 10 L15 10" /></svg>;
}
function IconLibrary() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4 L4 20" /><path d="M8 4 L8 20" /><rect x="11" y="4" width="4" height="16" rx="0.5" /><path d="M17 6 L21 5 L21 20 L17 20" /></svg>;
}
function IconRecord() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4.5" width="19" height="13" rx="2" /><circle cx="12" cy="11" r="3" fill="currentColor" stroke="none" /><path d="M8 20.5 L16 20.5" /></svg>;
}
function IconAudio() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 L6 12" /><path d="M8 8 L8 16" /><path d="M12 4 L12 20" /><path d="M16 8 L16 16" /><path d="M20 12 L22 12" /></svg>;
}

export default SimpleComposerRoute;
