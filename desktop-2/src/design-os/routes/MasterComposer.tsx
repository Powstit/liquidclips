/**
 * MasterComposer · Sprint 2 Tier 2 · 2026-07-21
 *
 * The mockup-shaped composer with REAL state wiring. Ships as a
 * staff-gated route (`#/composer-master?staff=1`) alongside the
 * default SimpleComposer so Daniel can A/B them before we swap.
 *
 * Layout (5 regions per approved kade-composer-simulator.html):
 *   ┌────┬─────────────────────────────┬──────────────┐
 *   │ N  │  Top HUD (48px)             │  Right Panel │
 *   │ a  │  brand · plan chip · avatar │  Base Window │
 *   │ v  │                             │  JSON (live) │
 *   │ 68 │  Center Canvas              │              │
 *   │ px │  Kade + prompt + timeline   │              │
 *   │    │                             │              │
 *   │    │  Bottom Command Bar         │              │
 *   └────┴─────────────────────────────┴──────────────┘
 *
 * State bindings (real, not fake):
 *   - Kade avatar    → useEvent("kade:mood") · pose swaps on state
 *   - Tier pill      → useMe() · shows AGENCY / FREE
 *   - Command bar    → local-first routeIntent → hosted fallback → sidecar
 *   - Source picker  → @tauri-apps/plugin-dialog (native macOS)
 *   - Progress       → useEvent("engine:progress")
 *   - Clip cards     → useEvent("engine:complete") reads project.clips
 *   - JSON panel     → live sessionCtx + activeSlug + progress
 *   - Nav rail       → bus.emit("nav:click")
 *
 * ⛔ IRON GATE IG-MASTER-COMPOSER-LAYOUT · this route MUST render all
 *    5 regions. Never collapse a region — that breaks the mockup contract.
 *
 * ⛔ IRON GATE IG-COMPOSER-HOSTED-INTENT · same as SimpleComposer ·
 *    local routeIntent first, hosted fallback preserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { bus, useEvent } from "../bridge";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { routeIntent, type SessionState } from "../engine/composer/router";
import { CAPABILITIES } from "../engine/composer/capabilities";
import { sidecar } from "../engine/sidecar-stub";
import type { Clip, ProjectMeta } from "../engine/types";
import { requestKadeIntent, type KadeIntent } from "../../lib/kadeIntentClient";
import { useMe } from "../state/useMe";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./MasterComposer.css";

const STAFF_FLAG_KEY = "lc.staff.flag";

/* ── Nav items · matches mockup 6-rail (Home/Create/Clips/Campaigns/Earn/Schedule) ── */
const NAV_ITEMS: readonly { id: string; label: string; route: string; icon: ReactElement }[] = [
  { id: "home", label: "Home", route: "home", icon: <IconHome /> },
  { id: "create", label: "Create", route: "composer", icon: <IconCreate /> },
  { id: "clips", label: "Clips", route: "workstation", icon: <IconClips /> },
  { id: "campaigns", label: "Campaigns", route: "campaigns", icon: <IconCampaign /> },
  { id: "earn", label: "Earn", route: "earn", icon: <IconEarn /> },
  { id: "schedule", label: "Schedule", route: "schedule", icon: <IconSchedule /> },
];

const ALL_CAPABILITY_IDS: readonly string[] = Object.keys(CAPABILITIES);

interface ProgressState {
  stage: string;
  percent: number | null;
  note?: string;
  segmentsDone?: number;
  segmentsTotal?: number;
}

function isStaff(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash || "";
    if (hash.includes("staff=1")) {
      try {
        window.localStorage.setItem(STAFF_FLAG_KEY, "1");
        const clean = hash.split("?")[0];
        window.history.replaceState(null, "", clean);
      } catch { /* silent */ }
      return true;
    }
    return window.localStorage.getItem(STAFF_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function parseCountFromCommand(cmd: string): number | undefined {
  const m = cmd.match(/(\d{1,3})[\s-]*clips?/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return undefined;
  return n;
}

function resolveCount(resolved: Record<string, string>, cmd: string): number | undefined {
  const raw = resolved.count ?? resolved.n ?? resolved.number;
  if (raw != null) {
    const n = parseInt(String(raw), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  }
  return parseCountFromCommand(cmd);
}

function isSourceAsk(names: readonly string[]): boolean {
  return names.some((n) => /source|file|url|video|footage/i.test(n));
}

/* ── Kade pose picker · maps mood → pose asset ── */
function kadePoseFor(mood: "idle" | "thinking" | "alert" | "collapsed", stage: string | null): string {
  if (mood === "alert") return "/brand/kade/kade-hover.webp";
  if (mood === "thinking") {
    if (stage === "transcribe") return "/brand/kade/kade-generating-captions.webp";
    if (stage === "llm") return "/brand/kade/kade-reading-brief.webp";
    if (stage === "cut") return "/brand/kade/kade-cutting-clips.webp";
    return "/brand/kade/kade-cutting-clips.webp";
  }
  return "/brand/kade/kade-idle.webp";
}

export function MasterComposerRoute(): ReactElement {
  const [staff] = useState<boolean>(() => isStaff());
  const spec = ROUTE_REGISTRY.composer;
  const inputRef = useRef<HTMLInputElement>(null);

  const me = useMe();
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [pendingUtterance, setPendingUtterance] = useState<string>("");
  const [awaitingSource, setAwaitingSource] = useState(false);
  const [urlDraft, setUrlDraft] = useState<string>("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [sessionCtx, setSessionCtx] = useState<Record<string, string>>({});
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [clips, setClips] = useState<readonly Clip[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<{ title: string; body: string; severity: "info" | "warn" } | null>(null);
  const [kadeMood, setKadeMood] = useState<"idle" | "thinking" | "alert" | "collapsed">("idle");
  const [lastIntentStatus, setLastIntentStatus] = useState<
    { kind: "ok"; ms: number; action: string; quota: number | null }
    | { kind: "fail"; message: string }
    | null
  >(null);

  const handleSubmitRef = useRef<((cmd: string, ctx?: Record<string, string>) => Promise<void>) | null>(null);
  const activeSlugRef = useRef<string | null>(null);

  const tier: string = ((me as { tier?: string } | null | undefined)?.tier ?? "free") as string;
  const founder: boolean = Boolean((me as { founder_flag?: boolean } | null | undefined)?.founder_flag);
  const tierLabel = founder || tier === "agency" || tier === "agency_whitelabel" || tier === "autopilot"
    ? "AGENCY"
    : "FREE";

  /* ── Source acceptance · persists to sessionCtx + re-fires handleSubmit ── */
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
          body: "File picking needs the installed .app · try Paste URL instead.",
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
      void lcDiag("master_composer_source_picked_file", { path_len: path.length });
      acceptSource({ path });
    } catch (exc) {
      void lcDiag("master_composer_source_picker_failed", {
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
    if (/youtube\.com\/live\//i.test(u)) {
      bus.emit("kade:speak", {
        title: "Live streams aren't downloadable yet",
        body: "Try a regular video URL (youtube.com/watch?v=...) — live paths fail at yt-dlp.",
        severity: "warn",
      });
      return;
    }
    void lcDiag("master_composer_source_pasted_url", { url_len: u.length });
    acceptSource({ url: u });
  }, [urlDraft, acceptSource]);

  /* ── Capability execution ── */
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
          const sourcePath = resolved.source_path ?? sessionCtx.source_path;
          const sourceUrl = resolved.source_url ?? sessionCtx.source_url;
          if (!sourcePath && !sourceUrl) {
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
            void lcDiag("master_composer_run_started", {
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
            void lcDiag("master_composer_run_start_failed", { message: msg.slice(0, 200) });
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
        default: {
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: capId,
            body: `Got it · running "${rawCmd.slice(0, 60)}". Full flow lands in Sprint 3-6.`,
            severity: "info",
          });
          void lcDiag("master_composer_capability_pending_wire", { cap: capId, raw: rawCmd.slice(0, 120) });
        }
      }
    },
    [sessionCtx],
  );

  /* ── handleSubmit · local-first, hosted-fallback (matches SimpleComposer contract) ── */
  const handleSubmit = useCallback(
    async (rawCmd: string, ctxOverride?: Record<string, string>) => {
      const cmd = rawCmd.trim();
      if (!cmd) return;
      setHistory((h) => [cmd, ...h.filter((prev) => prev !== cmd)].slice(0, 8));
      setPendingUtterance(cmd);

      const ctx = ctxOverride ?? sessionCtx;

      const session: SessionState = {};
      const routed = routeIntent(cmd, session);

      if (routed.kind === "execute") {
        setAwaitingSource(false);
        setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
        void lcDiag("master_composer_local_intent_ok", { action: "execute", cap: routed.capability.id });
        const resolved = { ...(routed.resolved as Record<string, string>) };
        if (!resolved.source_path && ctx.source_path) resolved.source_path = ctx.source_path;
        if (!resolved.source_url && ctx.source_url) resolved.source_url = ctx.source_url;
        void executeCapability(routed.capability.id, resolved, cmd);
        setCommand("");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      if (routed.kind === "ask") {
        const wantsSource = routed.capability.depends_on?.includes("source.exists") ?? false;
        if (wantsSource && (ctx.source_path || ctx.source_url)) {
          const resolved: Record<string, string> = {};
          if (ctx.source_path) resolved.source_path = ctx.source_path;
          if (ctx.source_url) resolved.source_url = ctx.source_url;
          setLastIntentStatus({ kind: "ok", ms: 0, action: "execute", quota: null });
          void executeCapability(routed.capability.id, resolved, cmd);
          setCommand("");
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }
        setLastIntentStatus({ kind: "ok", ms: 0, action: "ask", quota: null });
        if (wantsSource) {
          setAwaitingSource(true);
          bus.emit("kade:mood", { mood: "thinking" });
          bus.emit("kade:speak", {
            title: routed.capability.label,
            body: "Pick a file or paste a URL to start.",
            severity: "info",
          });
        }
        setCommand("");
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      // Local miss · try hosted fallback
      let hostedIntent: KadeIntent | null = null;
      try {
        const t0 = Date.now();
        const resp = await requestKadeIntent({
          utterance: cmd,
          capability_ids: [...ALL_CAPABILITY_IDS],
          context: ctx,
        });
        hostedIntent = resp.intent;
        setLastIntentStatus({ kind: "ok", ms: Date.now() - t0, action: hostedIntent.action, quota: resp.quota_remaining });
        void lcDiag("master_composer_hosted_intent_ok", { action: hostedIntent.action, capability: hostedIntent.capability });
      } catch (exc) {
        const msg = (exc instanceof Error ? exc.message : String(exc)).slice(0, 200);
        setLastIntentStatus({ kind: "fail", message: msg });
        void lcDiag("master_composer_hosted_intent_failed", { message: msg });
      }

      if (hostedIntent && hostedIntent.action === "execute" && hostedIntent.capability) {
        setAwaitingSource(false);
        void executeCapability(hostedIntent.capability, hostedIntent.resolved_params ?? {}, cmd);
      } else if (hostedIntent && hostedIntent.action === "ask" && hostedIntent.capability) {
        const asks = hostedIntent.needs_ask ?? [];
        const wantsSource = isSourceAsk(asks);
        setAwaitingSource(wantsSource);
        bus.emit("kade:mood", { mood: "thinking" });
        bus.emit("kade:speak", {
          title: wantsSource ? "Which source?" : "One more thing",
          body: wantsSource ? "Pick a file or paste a URL." : `I need: ${asks.join(", ")}`,
          severity: "info",
        });
      } else {
        bus.emit("kade:mood", { mood: "alert" });
        bus.emit("kade:speak", {
          title: "I didn't catch that",
          body: `Try: give me 3 clips · make 5 clips with hooks · style captions bold · record my screen`,
          severity: "warn",
        });
      }
      setCommand("");
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [sessionCtx, executeCapability],
  );

  /* ── Refs kept fresh · defence-in-depth for TDZ + useEvent closures ── */
  useEffect(() => { handleSubmitRef.current = handleSubmit; }, [handleSubmit]);
  useEffect(() => { activeSlugRef.current = activeSlug; }, [activeSlug]);

  /* ── Kade mood subscription · drives pose swap on canvas ── */
  useEvent("kade:mood", (p) => {
    const m = (p as { mood?: string }).mood;
    if (m === "idle" || m === "thinking" || m === "alert" || m === "collapsed") {
      setKadeMood(m);
    }
  });

  /* ── Kade speech mirror · always visible in the right JSON panel context ── */
  useEvent("kade:speak", (p) => {
    const sev = (p as { severity?: "info" | "warn" }).severity;
    setLastReply({
      title: String((p as { title?: string }).title ?? ""),
      body: String((p as { body?: string }).body ?? ""),
      severity: sev === "warn" ? "warn" : "info",
    });
  });

  /* ── Engine event subscriptions ── */
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
      void lcDiag("master_composer_run_complete", { slug: project.slug, clips: project.clips.length });
    }
  });

  useEvent("engine:error", (p) => {
    const currentSlug = activeSlugRef.current;
    if (currentSlug && p.slug && p.slug !== currentSlug) return;
    const msg = (p as { message?: string }).message ?? "Sidecar failed";
    setRunError(msg);
    setProgress(null);
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Run failed", body: msg.slice(0, 160), severity: "warn" });
  });

  /* ── Focus + keyboard shortcuts ── */
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === "Escape") {
        inputRef.current?.blur();
        setCommand("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSubmit(command);
  };

  const progressWidth = useMemo(() => {
    if (!progress) return 0;
    if (typeof progress.percent === "number") return Math.min(100, Math.max(0, progress.percent * 100));
    if (progress.segmentsTotal && progress.segmentsDone != null) {
      return Math.min(100, (progress.segmentsDone / progress.segmentsTotal) * 100);
    }
    return 6;
  }, [progress]);

  const baseWindowJson = useMemo(() => {
    return JSON.stringify({
      tier,
      founder,
      tierLabel,
      sessionCtx,
      activeSlug,
      progress,
      clipsCount: clips.length,
      awaitingSource,
      lastReply,
      kadeMood,
      lastIntentStatus,
    }, null, 2);
  }, [tier, founder, tierLabel, sessionCtx, activeSlug, progress, clips.length, awaitingSource, lastReply, kadeMood, lastIntentStatus]);

  if (!staff) {
    return (
      <DesignOSAppShell world={spec.world} route="composer" defaultKade={spec.defaultKade} kadePlacement={spec.kadePlacement}>
        <div className="lc-master-block">
          <h1>Master Composer · staff only</h1>
          <p>Sprint 2 Tier 2 · React port of the approved mockup with real state wiring.</p>
          <p>To enable: <code>localStorage.setItem("lc.staff.flag", "1")</code> then reload.</p>
        </div>
      </DesignOSAppShell>
    );
  }

  return (
    <DesignOSAppShell world={spec.world} route="composer" defaultKade={spec.defaultKade} kadePlacement={spec.kadePlacement}>
      <div className="lc-master" data-testid="master-composer" data-turbo="false">
        {/* Left nav rail · 68px · 6 mockup items · wired to bus.emit(nav:click) */}
        <nav className="lc-master-nav" aria-label="Primary navigation">
          <div className="lc-master-nav-logo" title="Liquid Clips">
            <span>LC</span>
          </div>
          {NAV_ITEMS.map((n) => (
            <button
              key={n.id}
              type="button"
              className="lc-master-nav-item"
              data-active={n.id === "create" ? "true" : "false"}
              onClick={() => bus.emit("nav:click", { route: n.route as never })}
              aria-label={n.label}
            >
              {n.icon}
              <span className="lc-master-nav-label">{n.label}</span>
            </button>
          ))}
        </nav>

        {/* Main column · HUD + Canvas + Command Bar */}
        <div className="lc-master-main">
          <header className="lc-master-hud">
            <div className="lc-master-hud-brand">
              Liquid <span>Clips</span>
            </div>
            <div className="lc-master-hud-chip" data-tier={tierLabel.toLowerCase()}>
              {tierLabel === "AGENCY" ? "Agency · $99.99/mo" : "Free · 10 clips + watermark"}
            </div>
            <div className="lc-master-hud-mode">
              <button className="lc-master-hud-mode-btn" data-active="true">Kade</button>
              <button className="lc-master-hud-mode-btn">Classic</button>
            </div>
            <div className="lc-master-hud-runtime">
              <span className="lc-master-hud-runtime-pill">runtime 2.2.75</span>
              <a
                className="lc-master-hud-diag-link"
                href="#/composer-preview?staff=1"
                title="Compare to iframe mockup preview"
                style={{ fontSize: 10 }}
              >
                Iframe →
              </a>
              <a
                className="lc-master-hud-diag-link"
                href="#/diagnostics?staff=1"
                title="Diagnostic Center"
              >
                Diag →
              </a>
            </div>
          </header>

          <div className="lc-master-workspace">
            <div className="lc-master-canvas-region">
              <div className="lc-master-canvas" data-loaded={clips.length > 0 ? "true" : "false"}>
                <img
                  className="lc-master-kade"
                  src={kadePoseFor(kadeMood, progress?.stage ?? null)}
                  alt=""
                  aria-hidden="true"
                />
                {!progress && clips.length === 0 && !awaitingSource && (
                  <div className="lc-master-prompt">What are we cutting today?</div>
                )}

                {/* Source picker */}
                {awaitingSource && (
                  <div className="lc-master-source-ask" data-testid="master-composer-source-ask">
                    <div className="lc-master-source-ask-title">Where's the source?</div>
                    <div className="lc-master-source-ask-row">
                      <button type="button" className="lc-master-source-btn" onClick={pickFile} data-testid="master-composer-pick-file">
                        📁 Pick a file
                      </button>
                      <button type="button" className="lc-master-source-btn" onClick={() => setShowUrlInput((v) => !v)} data-testid="master-composer-paste-url-toggle">
                        🔗 Paste URL
                      </button>
                    </div>
                    {showUrlInput && (
                      <form className="lc-master-source-url-form" onSubmit={(e) => { e.preventDefault(); submitUrl(); }}>
                        <input
                          type="url"
                          className="lc-master-source-url-input"
                          placeholder="https://youtube.com/watch?v=…"
                          value={urlDraft}
                          onChange={(e) => setUrlDraft(e.target.value)}
                          autoFocus
                          data-testid="master-composer-url-input"
                        />
                        <button type="submit" className="lc-master-source-btn">Go</button>
                      </form>
                    )}
                  </div>
                )}

                {/* Progress */}
                {progress && (
                  <div className="lc-master-progress" data-testid="master-composer-progress">
                    <div className="lc-master-progress-eyebrow">
                      {progress.stage.toUpperCase()}
                      {progress.note ? ` · ${progress.note.slice(0, 60)}` : ""}
                      {progress.segmentsTotal && progress.segmentsDone != null
                        ? ` · ${progress.segmentsDone} of ${progress.segmentsTotal}`
                        : ""}
                    </div>
                    <div className="lc-master-progress-bar">
                      <div className="lc-master-progress-fill" style={{ width: `${progressWidth}%` }} />
                    </div>
                  </div>
                )}

                {/* Error */}
                {runError && !progress && clips.length === 0 && (
                  <div className="lc-master-error" data-testid="master-composer-error">
                    {runError}
                  </div>
                )}

                {/* Clips */}
                {clips.length > 0 && (
                  <div className="lc-master-clips" data-testid="master-composer-clips">
                    <div className="lc-master-clips-eyebrow">
                      {clips.length} clip{clips.length === 1 ? "" : "s"} ready · scroll →
                    </div>
                    <div className="lc-master-clips-row">
                      {clips.map((c) => (
                        <div key={c.idx} className="lc-master-clip-card">
                          <div className="lc-master-clip-title">{c.title}</div>
                          <div className="lc-master-clip-meta">
                            {typeof c.score === "number" ? `${c.score}%` : "—"}
                            {" · "}
                            {c.duration_s ? `${Math.round(c.duration_s)}s` : `${Math.round(c.end - c.start)}s`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeline stub (Sprint 3 wires real waveform + drag handles) */}
                <div className="lc-master-timeline-stub" aria-hidden="true">
                  <div className="lc-master-timeline-track">
                    {[...Array(24)].map((_, i) => (
                      <span key={i} className="lc-master-timeline-tick" data-active={activeSlug ? "true" : "false"} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Wire status pill · shows local vs hosted intent result */}
              {lastIntentStatus && (
                <div className="lc-master-wire-status" data-testid="master-composer-wire-status" data-tone={lastIntentStatus.kind === "ok" ? "ok" : "fail"}>
                  {lastIntentStatus.kind === "ok"
                    ? `⚡ Kade heard you · ${lastIntentStatus.action} · ${lastIntentStatus.ms}ms`
                    : `⚠ Hosted LLM failed (${lastIntentStatus.message.slice(0, 60)}) · using local fallback`}
                </div>
              )}
            </div>
          </div>

          <form className="lc-master-cmd" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="lc-master-cmd-input"
              placeholder="Tell Kade what to do…"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              aria-label="Command Kade"
              data-testid="master-composer-command"
            />
            <button
              type="submit"
              className="lc-master-cmd-send"
              disabled={!command.trim()}
              data-testid="master-composer-send"
              aria-label="Send command"
            >
              →
            </button>
          </form>
          <div className="lc-master-hotkeys">
            <kbd>⌘K</kbd> focus · <kbd>Esc</kbd> clear
            {history.length > 0 && (
              <span className="lc-master-history">
                {" · recent: "}
                {history.slice(0, 2).map((cmd, i) => (
                  <button
                    key={cmd + i}
                    type="button"
                    className="lc-master-history-chip"
                    onClick={() => void handleSubmit(cmd)}
                    title={cmd}
                  >
                    {cmd.slice(0, 28)}{cmd.length > 28 ? "…" : ""}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>

        {/* Right rail · Base Window JSON live state (mockup contract) */}
        <aside className="lc-master-right" aria-label="Base Window JSON state">
          <div className="lc-master-right-head">
            <span className="lc-master-right-eyebrow">BASE WINDOW · LIVE</span>
            <span className="lc-master-right-mood" data-mood={kadeMood}>
              {kadeMood.toUpperCase()}
            </span>
          </div>
          <pre className="lc-master-right-json">{baseWindowJson}</pre>
          {lastReply && (
            <div className="lc-master-right-reply" data-tone={lastReply.severity}>
              <div className="lc-master-right-reply-eyebrow">KADE SAID</div>
              <div className="lc-master-right-reply-title">{lastReply.title}</div>
              <div className="lc-master-right-reply-body">{lastReply.body}</div>
            </div>
          )}
        </aside>
      </div>
    </DesignOSAppShell>
  );
}

/* ── Icons (SVG · matches mockup nav) ── */
function IconHome() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12L12 4l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z" /></svg>;
}
function IconCreate() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16v12H4z" /><path d="M4 10l6 4 4-3 6 5" /></svg>;
}
function IconClips() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M10 10l5 2-5 2z" fill="currentColor" /></svg>;
}
function IconCampaign() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3 6 6 1-4.5 4 1 6L12 16l-5.5 3 1-6L3 9l6-1z" /></svg>;
}
function IconEarn() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20" /><path d="M6 8h9a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10" /></svg>;
}
function IconSchedule() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
}

export default MasterComposerRoute;
