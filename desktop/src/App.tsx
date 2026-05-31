import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { LayoutGrid, Wallet, UploadCloud, Banknote, Settings as SettingsIcon, LogIn, UserCircle2, type LucideIcon } from "lucide-react";
import { Logo } from "./components/Logo";
import { DropZone } from "./components/DropZone";
import { WorkingStage } from "./components/WorkingStage";
import { ResultsGrid } from "./components/ResultsGrid";
import { FirstRun } from "./components/FirstRun";
import { JuniorLoader } from "./components/JuniorLoader";
import { Splash } from "./components/Splash";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationSheet } from "./components/NotificationSheet";
import { UploadTab } from "./components/upload/UploadTab";
import { PayoutsTab } from "./components/payouts/PayoutsTab";
import { InvadersOverlay } from "./components/invaders/InvadersOverlay";
import { closeInvaders } from "./lib/invaders/store";
import { Settings } from "./components/Settings";
import { AchievementToast } from "./components/AchievementToast";
import { recordAchievement } from "./lib/achievements";
import { sidecar, visibleStagesFor, pipelineStagesFor, onIngestProgress, onLiftProgress, type BountyContext, type IngestProgress, type Intent, type LiftProgress, type LiftTranscriptResult, type Project, type StageName } from "./lib/sidecar";
import { backend, maybeCheckQuota, QuotaExceededError, setOnUnauthorized } from "./lib/backend";
import { initDeepLinks, setOnActivated } from "./lib/activation";
import { HOSTED_LLM_ENABLED } from "./lib/flags";
import { closeBrowsePanel, openBrowsePanel, reconcileBrowsePanel, useBrowsePanel, WHOP_REWARDS_URL } from "./lib/browse";
import { BrowseRewardsPanel } from "./components/BrowseRewardsPanel";
import { reportDesktopError } from "./lib/telemetry";
import { applyUpdate, checkForUpdate, type UpdateState } from "./lib/updater";
import { TranscriptResult, LiftingProgress } from "./components/TranscriptResult";
import { IntentPicker } from "./components/IntentPicker";
import { EarnTab } from "./components/earn/EarnTab";
import { allowedPlatforms, whopBountyUrl } from "./components/earn/types";
import { BountySourceSetup } from "./components/earn/BountySourceSetup";
import { extractSourceUrls } from "./lib/sourceParser";
import { track as trackEvent, trackFirstBountyWorkspace } from "./lib/analytics";
import { FailureCard } from "./components/FailureCard";
import { SidecarError, type WhopBounty } from "./lib/sidecar";

type View =
  | { kind: "first-run" }
  | { kind: "payouts" }
  | { kind: "empty" }
  | { kind: "quota" }
  | { kind: "earn" }
  | { kind: "upload" }
  | { kind: "bounty-setup"; bounty: WhopBounty }
  | { kind: "choosing-intent"; source: { kind: "file"; path: string } | { kind: "url"; url: string }; brief: string; bounty?: WhopBounty }
  | { kind: "downloading"; url: string; progress?: IngestProgress; intent: Intent }
  | { kind: "ingest-failed"; url: string; error: string; intent: Intent }
  | { kind: "deps-missing"; missing: string[]; errors: Record<string, string>; python: string }
  | { kind: "lifting"; url: string; progress?: LiftProgress }
  | { kind: "lifted"; result: LiftTranscriptResult }
  | { kind: "lift-failed"; url: string; error: string }
  | { kind: "running"; project: Project; currentStage: StageName }
  | { kind: "results"; project: Project }
  | { kind: "canceled"; project: Project }
  | { kind: "failed"; project: Project; error: string };

// inWhopIframe lives in lib/whop-iframe.ts now so the same detection drives
// both the iframe auth bridge and the IA decision. Re-exported here for
// historical callers; new code should import from lib/whop-iframe directly.
import { attachWhopIframeAuth, inWhopIframe } from "./lib/whop-iframe";
export { inWhopIframe };

export default function App() {
  const [view, setView] = useState<View>({ kind: "empty" });
  // Generation guard for lift_transcript — bumped on every new lift and on
  // Cancel. Inflight awaits compare against the captured generation before
  // touching view state, so an abandoned Promise can't yank the user back
  // onto a stale "lifted" / "lift-failed" screen.
  const liftGenRef = useRef(0);
  const [sidecarStatus, setSidecarStatus] = useState<"booting" | "ready" | "failed">("booting");
  // Has the user dismissed the splash (via Continue or Skip on the embedded
  // Invaders game)? Splash stays mounted until both sidecar is ready AND
  // this flips true — gives the user a guaranteed window to play.
  const [splashAcked, setSplashAcked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [bootChecked, setBootChecked] = useState(false);
  const [updateBanner, setUpdateBanner] = useState<UpdateState>({ kind: "idle" });
  // Set when the backend rejects our license JWT (401). backend.ts has already
  // cleared the stale token; here we flip to a friendly "sign in again" prompt
  // instead of letting Inbox/Queue/etc. show raw errors. Cleared on re-activation
  // → recovers without a restart.
  const [needsActivation, setNeedsActivation] = useState(false);
  // Auth indicator. true once we've confirmed the user has a license JWT in
  // the keychain (i.e. they've activated via account.jnremployee.com). Drives
  // the top-nav button copy — "Sign in" while null/false, "Account" once true.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // Free clip exports left on the 100-export starter pass. null = unlimited
  // (paid / founder / unactivated) — when null we never show the counter or
  // the export gate. Updated from /sync on boot and from each clip-exported
  // call so the "X free exports left" line stays honest within a session.
  const [remainingExports, setRemainingExports] = useState<number | null>(null);

  // Verify sidecar + warm-load whisper. We DON'T force first-run anymore —
  // the app opens straight into the empty/workspace view so the flow is
  // testable without an account. Sign-in lives as a top-nav action and
  // shows the FirstRun splash on demand; sign-out from Settings also routes
  // back to it explicitly.
  useEffect(() => {
    (async () => {
      try {
        await sidecar.ping();
        // Preflight every heavy import before the user can paste a URL —
        // catches the "system Python missing yt-dlp / faster-whisper" silent
        // hang at boot instead of mid-pipeline. Failure routes to the
        // remediation card; sidecar still reports "ready" so the splash can
        // render the card cleanly instead of an "app broken" fallback.
        setSidecarStatus("ready");
        try {
          const deps = await sidecar.checkDeps();
          if (!deps.ok) {
            setView({
              kind: "deps-missing",
              missing: deps.missing,
              errors: deps.errors,
              python: deps.python,
            });
          }
        } catch {
          // check_deps itself failed — sidecar is too broken to even probe.
          // Fall through; pipeline calls will surface their own errors.
        }
        sidecar.preloadWhisper().catch(() => undefined);
        // Check for a license JWT in the keychain. Presence = signed in. We
        // don't validate the JWT here — that's the backend's job on /sync.
        // We only need a yes/no signal for the nav button copy.
        try {
          const { value } = await sidecar.licenseJwtRead();
          setSignedIn(!!value);
        } catch {
          setSignedIn(false);
        }
        // Seed the starter-pass counter from /sync (null = unlimited / paid /
        // unactivated). Best-effort: a missing backend just leaves it null,
        // which hides the counter and never blocks.
        void import("./lib/backend")
          .then((m) => m.syncStatus())
          .then((s) => setRemainingExports(s?.remaining_exports ?? null))
          .catch(() => undefined);
      } catch {
        setSidecarStatus("failed");
      } finally {
        setBootChecked(true);
      }
    })();

    // Auto-check for updates on every launch. We surface every result briefly so
    // Daniel can tell the installed app really hit the update manifest.
    (async () => {
      setUpdateBanner({ kind: "checking" });
      const state = await checkForUpdate();
      setUpdateBanner(state);
      if (state.kind === "up-to-date") {
        window.setTimeout(() => {
          setUpdateBanner((current) => (current.kind === "up-to-date" ? { kind: "idle" } : current));
        }, 5000);
      }
    })();

    // Whop iframe auth bridge — captures the user session token from the
    // parent window and pushes it to the sidecar. No-op outside an iframe.
    // Teardown clears the in-memory token on unmount.
    // Central self-heal: any authed backend call that 401s makes backend.ts
    // clear the stale license JWT + fire this handler → flip the whole app to a
    // friendly "activate again" state (Inbox/Queue/Sync/Connections/Earn all
    // benefit, no per-screen wiring). Re-activation clears it without a restart.
    setOnUnauthorized(() => {
      setSignedIn(false);
      setNeedsActivation(true);
      setInboxOpen(false);
    });

    // Activation bridge: register the liquidclips:// deep-link listener once so a
    // license can land even if the user navigated away from the sign-in screen,
    // and wire the success hook. On activation we flip the whole app to
    // signed-in + re-sync — no restart, and we leave the current view alone so
    // someone who activated from Earn stays on Earn.
    void initDeepLinks();
    setOnActivated(() => {
      setSignedIn(true);
      setNeedsActivation(false);
      void import("./lib/backend")
        .then((m) => m.syncStatus())
        .then((s) => setRemainingExports(s?.remaining_exports ?? null))
        .catch(() => undefined);
    });

    // Catch-all telemetry for UNEXPECTED errors. The known self-heal paths
    // (401, offline, quota) already report + are skipped here to avoid dupes —
    // this surfaces the bugs we don't yet know about so they show in Admin HQ.
    const reportedKind = (err: unknown) =>
      ["unauthorized", "backend_offline", "quota_exceeded"].includes(
        (err as { kind?: string })?.kind ?? "",
      );
    const onWinError = (ev: ErrorEvent) => {
      if (reportedKind(ev.error)) return;
      void reportDesktopError("unhandled_error", {
        error_code: (ev.error as Error)?.name ?? "Error",
        message: ev.message || String(ev.error),
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      if (reportedKind(ev.reason)) return;
      void reportDesktopError("unhandled_error", {
        error_code: (ev.reason as Error)?.name ?? "UnhandledRejection",
        message: String(ev.reason),
      });
    };
    window.addEventListener("error", onWinError);
    window.addEventListener("unhandledrejection", onRejection);

    const detach = attachWhopIframeAuth({});
    return () => {
      setOnUnauthorized(null);
      setOnActivated(null);
      window.removeEventListener("error", onWinError);
      window.removeEventListener("unhandledrejection", onRejection);
      detach();
    };
  }, []);

  const [pendingBrief, setPendingBrief] = useState<string>("");

  useEffect(() => {
    const unlistenPromise = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const path = event.payload?.paths?.[0];
      if (!path) return;
      // Whitelist video extensions — Tauri will hand us folder paths or
      // unrelated files (zip, txt) on a stray drop. Reject early so the
      // sidecar doesn't waste a probe failing on something obviously wrong.
      if (!/\.(mp4|mov|mkv|webm|avi|m4v|mp3|m4a|wav)$/i.test(path)) {
        console.warn("[drop] ignored non-video path:", path);
        return;
      }
      // Drops route through the intent picker like every other entry. The
      // pipeline doesn't start until the user picks what they're making.
      setView({ kind: "choosing-intent", source: { kind: "file", path }, brief: pendingBrief });
    });
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [pendingBrief]);

  // Autoclose Invaders when the pipeline reaches any terminal state — the
  // user came here to clip, not to play. Game state inside the overlay still
  // persists internally for the session (high score is on disk), so reopening
  // resumes from a fresh wave 1.
  useEffect(() => {
    const terminalKinds: View["kind"][] = ["results", "lifted", "failed", "canceled", "empty", "earn", "upload", "payouts"];
    if (terminalKinds.includes(view.kind)) {
      closeInvaders();
    }
  }, [view.kind]);

  async function runPipelineFromUrl(url: string, brief: string = "", intent: Intent = "both", bounty?: BountyContext) {
    let unlistenProgress: (() => void) | null = null;
    try {
      if (!(await guardQuota())) return;
      setView({ kind: "downloading", url, intent });
      unlistenProgress = await onIngestProgress((p) => {
        setView((v) => (v.kind === "downloading" ? { ...v, progress: p } : v));
      });
      const trimmed = brief.trim();
      const { project } = await sidecar.ingestUrl(url, trimmed || undefined, intent, bounty);
      if (project.whop_bounty_id) {
        trackFirstBountyWorkspace({
          bounty_id: project.whop_bounty_id,
          source_type: "pasted_url",
          allowed_platforms: bounty?.allowedPlatforms,
        });
      }
      await runRemainingStages(project);
    } catch (e) {
      console.error("[pipeline] URL ingest failed:", e);
      // Mirror the lift-failed path so the user sees an actionable
      // FailureCard instead of the screen silently resetting to empty.
      setView({ kind: "ingest-failed", url, intent, error: humanIngestError(e) });
    } finally {
      unlistenProgress?.();
    }
  }

  async function guardQuota(): Promise<boolean> {
    // Exporting requires a Liquid Clips account: the 100-free-export pass is tracked
    // server-side against the license JWT. No JWT = not activated, so we send
    // the user to sign in rather than letting exports run uncapped/untracked
    // (the "free forever" bypass). Sign-in is free — it just makes them a known
    // user so the starter pass can be counted.
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setNeedsActivation(true);
        setView({ kind: "first-run" });
        return false;
      }
    } catch {
      // Keychain read failed — fall through to the quota check; if that also
      // can't resolve a token the authed call will surface it.
    }
    // Clip selection runs on OpenAI until hosted AI ships (HOSTED_LLM_ENABLED).
    // If no key is resolvable (env / keychain / dev file), guide the user to add
    // one now instead of failing mid-pipeline at the LLM step.
    if (!HOSTED_LLM_ENABLED) {
      try {
        const { available } = await sidecar.openaiKeyStatus();
        if (!available) {
          setView({ kind: "first-run" });
          return false;
        }
      } catch {
        // Status check failed — don't hard-block; the LLM stage surfaces a clear
        // error if the key is genuinely missing.
      }
    }
    try {
      await maybeCheckQuota();
      return true;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        setView({ kind: "quota" });
        return false;
      }
      console.warn("[quota] check failed (proceeding):", e);
      return true;
    }
  }

  async function runRemainingStages(initial: Project) {
    let current = initial;
    const remaining: StageName[] = pipelineStagesFor(current.intent ?? "both");
    for (const stage of remaining) {
      setView({ kind: "running", project: current, currentStage: stage });
      try {
        const { project: updated } = await sidecar.runStage(current.slug, stage);
        current = updated;
      } catch (e) {
        // Server-side raised — could be a real failure OR a cancellation.
        // The stage record persisted to disk tells us which.
        const { project: refreshed } = await sidecar.getProject(current.slug).catch(() => ({ project: current }));
        current = refreshed;
        const err = current.stages[stage]?.error ?? "";
        if (err === "canceled" || err.includes("CanceledError")) {
          setView({ kind: "canceled", project: current });
          return;
        }
        setView({ kind: "failed", project: current, error: err || String(e) });
        return;
      }
      if (current.stages[stage].status === "failed") {
        const err = current.stages[stage].error ?? "";
        if (err === "canceled" || err.includes("CanceledError")) {
          setView({ kind: "canceled", project: current });
          return;
        }
        setView({ kind: "failed", project: current, error: err || "stage failed" });
        return;
      }
    }
    // Clips are written to disk by the pipeline, so reaching here == a
    // SUCCESSFUL export. Failed / canceled runs returned early above and never
    // reach this point, so the starter pass is only ever charged for real
    // exports — never previews, drafts, or failures.
    if (current.clips.length > 0) {
      // Count EACH exported clip against the 100-export starter pass (one
      // /usage/clip-exported per clip file). Paid / founder users get
      // remaining_exports: null and are never 402'd. A free user who crosses
      // 100 mid-run gets a 402 → raise the upgrade wall and block.
      const blocked = await chargeClipExport(current.clips.length);
      if (blocked) return;
    }

    if (current.whop_bounty_id && current.clips.length > 0) {
      trackEvent("bounty_clip_exported", {
        bounty_id: current.whop_bounty_id,
        export_count: current.clips.length,
        // No project_slug — it derives from the source filename/title (PII).
        // If a project identifier is ever needed, use an opaque id, not the slug.
      });
    }
    setView({ kind: "results", project: current });
  }

  // Charges ONE export per successfully exported clip/file — a 7-clip run
  // consumes 7 of the 100, matching the "100 free clip exports" promise. Failed/
  // canceled runs return earlier and never reach here, so only real exports
  // count; re-running creates a new run → charges again. Paid/founder users get
  // remaining_exports: null on the first call and stop charging. On the call
  // that crosses 100 the backend 402s → upgrade wall (export #101 blocked).
  // Resilient: no JWT / backend offline / network error → never blocks.
  async function chargeClipExport(count: number): Promise<boolean> {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      // Unactivated users are blocked at guardQuota() before the pipeline runs,
      // so we shouldn't reach here without a JWT. If we somehow do, don't charge
      // (no clips should exist) — the pre-run gate is the real enforcement.
      if (!jwt) return false;
      let remaining: number | null = null;
      for (let i = 0; i < count; i++) {
        const res = await backend.clipExported(jwt);
        remaining = res.remaining_exports;
        if (remaining === null) break; // paid / founder — uncapped, stop charging
      }
      setRemainingExports(remaining);
      return false;
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        setRemainingExports(0);
        setView({ kind: "quota" });
        return true;
      }
      console.warn("[export-gate] charge failed (proceeding):", e);
      return false;
    }
  }

  async function runPipeline(sourcePath: string, brief: string = "", intent: Intent = "both", bounty?: BountyContext) {
    try {
      if (!(await guardQuota())) return;
      const trimmed = brief.trim();
      const { project } = await sidecar.startRun(sourcePath, trimmed || undefined, intent, bounty);
      if (project.whop_bounty_id) {
        trackFirstBountyWorkspace({
          bounty_id: project.whop_bounty_id,
          source_type: "upload",
          allowed_platforms: bounty?.allowedPlatforms,
        });
      }
      await runRemainingStages(project);
    } catch (e) {
      setView((prev) => {
        const base = prev.kind === "running" || prev.kind === "results" || prev.kind === "failed" ? prev.project : null;
        if (base) {
          return { kind: "failed", project: base, error: String(e) };
        }
        console.error("[pipeline] startRun failed:", e);
        return { kind: "empty" };
      });
    }
  }

  async function pickFile(briefFromUI: string) {
    setPendingBrief(briefFromUI);
    const picked = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] }],
    });
    if (typeof picked === "string") {
      // Route through the intent picker — the pipeline only starts after the
      // user picks what they're making.
      setView({ kind: "choosing-intent", source: { kind: "file", path: picked }, brief: briefFromUI });
    }
  }

  function onIntentPicked(intent: Intent) {
    setView((v) => {
      if (v.kind !== "choosing-intent") return v;
      const src = v.source;
      const brief = v.brief;
      // Compact bounty payload Project persists — now carries the richer
      // context the workspace header + fit checklist read. sourceUrl is the
      // actual source the clipper chose (URL ingests only; file picks have no
      // shareable URL). Avoids dragging the whole WhopBounty graph through.
      const bounty: BountyContext | undefined = v.bounty
        ? {
            id: v.bounty.id,
            title: v.bounty.title,
            rewardPerUnitAmount: v.bounty.rewardPerUnitAmount,
            currency: v.bounty.currency,
            description: v.bounty.description || null,
            allowedPlatforms: allowedPlatforms(v.bounty),
            sourceUrl: src.kind === "url" ? src.url : null,
            creator: v.bounty.user?.username || null,
            spotsRemaining: v.bounty.spotsRemaining ?? null,
            whopUrl: whopBountyUrl(v.bounty),
          }
        : undefined;
      if (src.kind === "file") {
        void runPipeline(src.path, brief, intent, bounty);
      } else {
        void runPipelineFromUrl(src.url, brief, intent, bounty);
      }
      return v;
    });
  }

  function onPasteUrl(url: string, brief: string) {
    setPendingBrief(brief);
    setView({ kind: "choosing-intent", source: { kind: "url", url }, brief });
  }

  async function onLiftTranscript(url: string) {
    let unlistenProgress: (() => void) | null = null;
    const myGen = ++liftGenRef.current;
    setView({ kind: "lifting", url });
    // Sprint #26 telemetry — lift funnel events. host derived from URL
    // because hostname alone isn't PII (forbidden-keys filter strips path/slug).
    let host = "unknown";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    const startMs = performance.now();
    trackEvent("lift_started", { source_host: host });
    try {
      unlistenProgress = await onLiftProgress((p) => {
        if (liftGenRef.current !== myGen) return;
        setView((v) => (v.kind === "lifting" ? { ...v, progress: p } : v));
      });
      // Frontend-side belt-and-braces timeout (1h). The Python sidecar emits
      // a clearer scaled-to-duration timeout for honest UX before this fires;
      // this is just the absolute floor so the invoke promise can never hang
      // forever. User can hit Cancel any time — that path returns immediately.
      const TIMEOUT_MS = 60 * 60 * 1000;
      const result = await Promise.race([
        sidecar.liftTranscript(url),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error("Transcription took longer than 1 hour — give up and try a shorter video.")),
            TIMEOUT_MS,
          ),
        ),
      ]);
      if (liftGenRef.current === myGen) setView({ kind: "lifted", result });
      trackEvent("lift_completed", {
        source_host: host,
        duration_s: result.duration ?? null,
        segments: Array.isArray(result.segments) ? result.segments.length : 0,
        wall_ms: Math.round(performance.now() - startMs),
        language: result.language ?? null,
      });
      // Sprint #18a — first successful lift unlocks the "First Clip" badge.
      // Toast appears top-right via AchievementToast. recordAchievement is
      // dedup'd via localStorage so this is safe to call every time.
      recordAchievement("first_clip");
    } catch (e) {
      console.error("[lift] failed:", e);
      // Distinguish cancel vs error — generation mismatch implies user hit Cancel.
      if (liftGenRef.current !== myGen) {
        trackEvent("lift_canceled", { source_host: host, wall_ms: Math.round(performance.now() - startMs) });
      } else {
        trackEvent("lift_failed", {
          source_host: host,
          wall_ms: Math.round(performance.now() - startMs),
          error_code: e instanceof SidecarError ? e.code : null,
        });
        setView({ kind: "lift-failed", url, error: humanIngestError(e) });
      }
    } finally {
      unlistenProgress?.();
    }
  }

  // Splash — sidecar still booting OR user hasn't dismissed the embedded
  // Invaders game yet. Even when the sidecar comes up fast, the splash
  // holds for the user to play one round + see Continue light up. They can
  // click Skip any time. Failed sidecar bypasses the game entirely.
  const sidecarReady = bootChecked && sidecarStatus === "ready";
  const splashShouldShow = !bootChecked || sidecarStatus !== "ready" || !splashAcked;
  if (splashShouldShow) {
    return (
      <div className="flex h-full flex-col bg-paper text-ink">
        <Splash
          failed={sidecarStatus === "failed"}
          ready={sidecarReady}
          onContinue={() => setSplashAcked(true)}
        />
      </div>
    );
  }

  // First-run swallows the chrome — full-bleed paper screen.
  if (view.kind === "first-run") {
    return (
      <div className="flex h-full flex-col bg-paper text-ink">
        <FirstRun
          onComplete={() => {
            setView({ kind: "empty" });
            setNeedsActivation(false); // fresh JWT written → clear the prompt; polls recover
            // Activation usually writes the license JWT during FirstRun.
            // Re-poll so the nav swaps Sign in → Account without a relaunch.
            void sidecar.licenseJwtRead().then(({ value }) => setSignedIn(!!value)).catch(() => undefined);
          }}
        />
      </div>
    );
  }

  return (
    <MainShell>
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em]">
            <NavTab
              label="Workspace"
              active={view.kind !== "earn" && view.kind !== "upload" && view.kind !== "bounty-setup" && view.kind !== "payouts"}
              onClick={() => setView({ kind: "empty" })}
              Icon={LayoutGrid}
            />
            <NavTab
              label="Earn"
              active={view.kind === "earn" || view.kind === "bounty-setup"}
              onClick={() => setView({ kind: "earn" })}
              Icon={Wallet}
            />
            <NavTab
              label="Upload"
              active={view.kind === "upload"}
              onClick={() => setView({ kind: "upload" })}
              Icon={UploadCloud}
            />
            <NavTab
              label="Payouts"
              active={view.kind === "payouts"}
              onClick={() => setView({ kind: "payouts" })}
              Icon={Banknote}
            />
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span
              className={`pulse-dot inline-block h-1.5 w-1.5 rounded-full ${
                sidecarStatus === "ready"
                  ? "bg-fuchsia"
                  : sidecarStatus === "failed"
                  ? "bg-[#DC2626]"
                  : "bg-text-tertiary"
              }`}
            />
            {sidecarStatus === "ready" ? "ready" : sidecarStatus === "failed" ? "sidecar failed" : "starting…"}
          </div>
          <NotificationBell onOpen={() => setInboxOpen(true)} />
          {signedIn ? (
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
              aria-label="Open your account"
              title="Signed in · open Account in Settings"
            >
              <UserCircle2 className="h-3.5 w-3.5 text-fuchsia" strokeWidth={2} />
              Account
            </button>
          ) : signedIn === false ? (
            <button
              onClick={() => setView({ kind: "first-run" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia-soft/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep transition-colors hover:bg-fuchsia hover:text-white"
              aria-label="Sign in to Liquid Clips"
            >
              <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
              Sign in
            </button>
          ) : null}
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:border-fuchsia hover:text-ink"
            aria-label="Open settings"
          >
            <SettingsIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Settings
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-stretch justify-center overflow-y-auto px-6 py-10">
        {view.kind === "upload" && (
          <UploadTab onOpenSettings={() => setSettingsOpen(true)} />
        )}

        {view.kind === "payouts" && <PayoutsTab />}

        {view.kind === "earn" && (
          <EarnTab
            onSignIn={() => setView({ kind: "first-run" })}
            onStartBounty={(bounty) => {
              // Route into a focused, bounty-specific setup screen — detected
              // source URL, paste, or upload-local — instead of dumping the
              // clipper into the generic drop flow.
              setView({ kind: "bounty-setup", bounty });
            }}
            onResumeProject={(slug) => {
              void sidecar
                .getProject(slug)
                .then(({ project }) => setView({ kind: "results", project }))
                .catch((e) => console.error("[resume] getProject failed:", e));
            }}
            onStartManualBounty={(bountyCtx, sourceUrl) => {
              // Beta fallback: user pasted bounty + source. Synthesize a
              // minimal WhopBounty shape so the existing choosing-intent →
              // pipeline path doesn't need to learn a new code path. Only the
              // BountyContext-shaped fields actually flow through (see
              // onIntentPicked's `bounty:` mapping — extracts id/title/
              // rewardPerUnitAmount/currency only).
              const synthetic: WhopBounty = {
                id: bountyCtx.id,
                title: bountyCtx.title,
                description: "",
                baseUnitAmount: 0,
                rewardPerUnitAmount: bountyCtx.rewardPerUnitAmount,
                currency: bountyCtx.currency,
                allowYoutube: true,
                allowTiktok: true,
                allowInstagram: true,
                allowX: true,
                acceptedSubmissionsLimit: 0,
                acceptedSubmissionsCount: 0,
                spotsRemaining: 0,
                bountyType: "manual",
                status: "active",
                viewCount: 0,
                totalPaid: 0,
                budgetAmount: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                user: { username: "", name: "", image: "" },
              };
              setView({
                kind: "choosing-intent",
                source: { kind: "url", url: sourceUrl },
                brief: "",
                bounty: synthetic,
              });
            }}
          />
        )}

        {view.kind === "bounty-setup" && (
          <BountySourceSetup
            bounty={view.bounty}
            detectedSources={extractSourceUrls(view.bounty.description)}
            onCancel={() => setView({ kind: "earn" })}
            onContinue={(source) =>
              setView({
                kind: "choosing-intent",
                source,
                brief: view.bounty.description ?? "",
                bounty: view.bounty,
              })
            }
          />
        )}

        {view.kind === "empty" && bootChecked && (
          <DropZone
            onPickFile={pickFile}
            onPasteUrl={onPasteUrl}
            onLiftTranscript={(url) => void onLiftTranscript(url)}
            remainingExports={remainingExports}
          />
        )}

        {view.kind === "choosing-intent" && (
          <IntentPicker
            source={view.source}
            brief={view.brief}
            onPick={onIntentPicked}
            onCancel={() => setView({ kind: "empty" })}
          />
        )}

        {view.kind === "lifting" && (
          <LiftingProgress
            url={view.url}
            phase={view.progress?.phase ?? "downloading"}
            percent={view.progress?.percent ?? null}
            etaS={view.progress?.eta_s ?? null}
            onCancel={() => {
              // Best-effort cancel: writes marker file in sidecar; the running
              // lift_transcript polls it every 2s and raises. Bump the gen
              // counter FIRST so the abandoned Promise's setView calls become
              // no-ops when the sidecar finally returns — without this, a
              // transcribe that finishes inside the 2s polling window will
              // yank you back to a "lifted" view after you'd hit Cancel.
              liftGenRef.current += 1;
              void sidecar.liftCancel().catch(() => undefined);
              setView({ kind: "empty" });
            }}
          />
        )}

        {view.kind === "lifted" && (
          <TranscriptResult
            result={view.result}
            onDone={() => setView({ kind: "empty" })}
          />
        )}

        {view.kind === "lift-failed" && (
          <FailureCard
            eyebrow="couldn't lift this one"
            heading="That link didn't transcribe."
            url={view.url}
            error={view.error}
            note="Private posts and login-walled videos can't be lifted. Public reels / shorts / posts work."
            onRetry={() => void onPasteUrl(view.url, "")}
            onDismiss={() => setView({ kind: "empty" })}
            subject={`Liquid Clips — lift failed for ${view.url}`}
          />
        )}

        {view.kind === "downloading" && (
          <JuniorLoader
            message="Fetching from the source"
            detail={formatDownloadDetail(view.url, view.progress)}
            percent={view.progress?.percent ?? undefined}
            onCancel={() => {
              void sidecar.liftCancel().catch(() => undefined);
              setView({ kind: "empty" });
            }}
          />
        )}

        {view.kind === "ingest-failed" && (
          <FailureCard
            eyebrow="couldn't download this one"
            heading="That link didn't import."
            url={view.url}
            error={view.error}
            note="Private / login-walled posts can't be fetched. Public YouTube / TikTok / IG reels should work."
            onRetry={() => void runPipelineFromUrl(view.url, "", view.intent)}
            onDismiss={() => setView({ kind: "empty" })}
            subject={`Liquid Clips — ingest failed for ${view.url}`}
          />
        )}

        {view.kind === "deps-missing" && (
          <DepsMissingCard
            missing={view.missing}
            errors={view.errors}
            python={view.python}
            onRetry={async () => {
              const deps = await sidecar.checkDeps().catch(() => null);
              if (deps?.ok) setView({ kind: "empty" });
              else if (deps) setView({ kind: "deps-missing", ...deps });
            }}
          />
        )}

        {view.kind === "quota" && (
          <div className="w-full max-w-[720px] rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
              free starter pass used up
            </div>
            <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              Your 100 free clip exports — used up.
            </h2>
            <p className="mt-2 max-w-[520px] font-sans text-[14px] leading-relaxed text-text-secondary">
              You've exported 100 clips for free. Keep going for unlimited exports. Growth · $99.99/mo adds
              hosted transcribe and multi-platform publishing. Autopilot · $199.99/mo adds drip-mode.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={() => {
                  void import("@tauri-apps/plugin-shell").then((m) =>
                    m.open("https://account.jnremployee.com/upgrade"),
                  );
                }}
                className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white hover:bg-fuchsia-bright"
              >
                Continue on Solo · $29.99/mo
              </button>
              <button
                onClick={() => setView({ kind: "empty" })}
                className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {view.kind === "running" && (
          <WorkingStage project={view.project} stages={visibleStagesFor(view.project.intent ?? "both")} currentStage={view.currentStage} />
        )}

        {view.kind === "failed" && (
          <FailureCard
            eyebrow="Pipeline failed"
            heading={view.project.source_filename}
            error={view.error}
            note="Cached audio + transcript on disk skip instantly — only the failed stage re-runs."
            logHint={`Logs: ${view.project.root}/.progress.json`}
            onRetry={() => void runRemainingStages(view.project)}
            retryLabel="Retry from failed stage"
            onDismiss={() => setView({ kind: "empty" })}
            dismissLabel="Drop another"
            subject={`Liquid Clips — pipeline failed on ${view.project.source_filename}`}
          />
        )}

        {view.kind === "canceled" && (
          <div className="w-full max-w-[720px]">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
              canceled
            </div>
            <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
              Stopped where you asked.
            </h2>
            <p className="mt-3 max-w-[520px] font-sans text-[14px] text-text-secondary">
              {view.project.source_filename}. Partial work is on disk at <span className="font-mono text-[12px] text-text-tertiary">{view.project.root}</span> —
              everything completed before the cancel survives.
            </p>
            <button
              onClick={() => setView({ kind: "empty" })}
              className="mt-6 rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
            >
              Drop another
            </button>
          </div>
        )}

        {view.kind === "results" && (
          <ResultsGrid
            project={view.project}
            onDropAnother={() => setView({ kind: "empty" })}
            onProjectChange={(p) => setView({ kind: "results", project: p })}
          />
        )}
      </main>

      {needsActivation && (
        <div className="flex items-center justify-between border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            ● Your Liquid Clips session ended — sign in again to sync
          </div>
          <button
            onClick={() => { setNeedsActivation(false); setView({ kind: "first-run" }); }}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Sign in
          </button>
        </div>
      )}

      {updateBanner.kind === "available" && (
        <div className="flex items-center justify-between border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            ● Liquid Clips {updateBanner.update.version} ready — auto-update available
          </div>
          <button
            onClick={async () => {
              if (updateBanner.kind !== "available") return;
              await applyUpdate(updateBanner.update, setUpdateBanner);
            }}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Install + relaunch
          </button>
        </div>
      )}

      {updateBanner.kind === "checking" && (
        <div className="border-t border-line bg-paper px-6 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          ● checking Liquid Clips updates…
        </div>
      )}

      {updateBanner.kind === "up-to-date" && (
        <div className="border-t border-line bg-paper px-6 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          ✓ Liquid Clips is up to date
        </div>
      )}

      {updateBanner.kind === "downloading" && (
        <div className="border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          ↓ downloading update…
          {updateBanner.total ? ` ${Math.round((updateBanner.downloaded / updateBanner.total) * 100)}%` : ""}
        </div>
      )}

      {updateBanner.kind === "error" && (
        <div className="flex items-center justify-between border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            ● Update didn&apos;t finish — you can keep working; we&apos;ll retry next launch
          </div>
          <button
            onClick={async () => {
              setUpdateBanner({ kind: "checking" });
              setUpdateBanner(await checkForUpdate());
            }}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Retry
          </button>
        </div>
      )}

      <footer className="border-t border-line px-6 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        sprint 3 · onboarding · keychain · settings · auto-update
      </footer>

      {settingsOpen && (
        <Settings
          onClose={() => {
            setSettingsOpen(false);
            // Settings can change auth state — for example, the user activated
            // via /connect-desktop in another window or the JWT was rotated
            // by /sync. Re-poll so the top-nav indicator stays honest.
            void sidecar.licenseJwtRead().then(({ value }) => setSignedIn(!!value)).catch(() => undefined);
          }}
          onSignOut={() => {
            // JWT already cleared by Settings; bounce the user back to
            // the first-run welcome surface so they get the polished sign-in
            // flow on next launch.
            setSignedIn(false);
            setView({ kind: "first-run" });
          }}
        />
      )}
      {inboxOpen && <NotificationSheet onClose={() => setInboxOpen(false)} />}
      {/* Invaders overlay — portals to document.body so it's not affected by
          MainShell padding when the browse panel is open. Triggered manually
          from JuniorLoader / WorkingStage; auto-closes when the pipeline
          reaches a terminal state (see autoclose effect at App top). */}
      <InvadersOverlay />
      {/* Achievement unlock toasts (sprint #18a) — global mount, listens on
          the achievements bus, slides in for ~5s when a badge unlocks. */}
      <AchievementToast />
    </MainShell>
  );
}

// Wraps the main app surface. Browse Rewards is a native child webview pinned
// inside the same Liquid Clips window frame; padding keeps the React workbench
// from sitting underneath the right browser pane.
function MainShell({ children }: { children: React.ReactNode }) {
  const { open } = useBrowsePanel();
  useEffect(() => {
    void reconcileBrowsePanel();
  }, []);
  return (
    <>
      <div
        className="flex h-full flex-col bg-paper text-ink transition-[padding] duration-200"
        style={{ paddingRight: open ? 566 : 0 }}
      >
        {children}
      </div>
      <BrowserEdgeTab open={open} />
      <BrowseRewardsPanel />
    </>
  );
}

function BrowserEdgeTab({ open }: { open: boolean }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      if (open) {
        await closeBrowsePanel();
      } else {
        await openBrowsePanel(WHOP_REWARDS_URL);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={open ? "Close browser" : "Open browser"}
      className="fixed top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-fuchsia/70 bg-fuchsia px-2.5 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[0_14px_40px_rgba(255,26,140,0.3)] transition-[right,opacity,background-color] duration-200 hover:bg-fuchsia-bright disabled:opacity-50"
      style={{ right: open ? 566 : 0, writingMode: "vertical-rl" }}
    >
      {busy ? "…" : open ? "Close" : "Browse"}
    </button>
  );
}

// Map raw sidecar / yt-dlp errors to one-line copy a human can act on. Falls
// back to the raw string if no pattern matches — better an ugly error than a
// silent reset to empty (which is what we did before P0 #2).
function humanIngestError(e: unknown): string {
  // SidecarError carries the sidecar's pre-classified human message — prefer it.
  if (e instanceof SidecarError) return e.human;
  const raw = e instanceof Error ? e.message : String(e);
  if (/ModuleNotFoundError|No module named/.test(raw)) {
    return "The sidecar is missing a required Python package. Open Settings → Diagnose, or reinstall the app.";
  }
  if (/Private video|members-only|login required|sign in to confirm/i.test(raw)) {
    return "That source is private / login-walled. Public links work; private ones don't.";
  }
  if (/Video unavailable|removed by/i.test(raw)) {
    return "The source video is unavailable (removed, geo-blocked, or age-restricted).";
  }
  if (/HTTP Error 429|rate.?limit/i.test(raw)) {
    return "The source is rate-limiting us. Wait a minute and try again.";
  }
  if (/network|socket|timed out|TimeoutError|Connection/i.test(raw)) {
    return "Network timeout reaching the source. Check your connection and try again.";
  }
  return raw;
}

// P0 #1 — actionable remediation card when the sidecar's Python env is
// missing a required package. The bundled .app does NOT ship a venv (we
// rely on the user's system Python), so a fresh Mac can hit this on first
// run. Surfaces the exact pip command so the user can self-heal.
function DepsMissingCard({
  missing,
  errors,
  python,
  onRetry,
}: {
  missing: string[];
  errors: Record<string, string>;
  python: string;
  onRetry: () => void | Promise<void>;
}) {
  const pipCmd = `"${python}" -m pip install --break-system-packages ${missing.join(" ")}`;
  return (
    <div className="w-full max-w-[720px] rounded-3xl border border-fuchsia-soft bg-paper-elev p-7">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
        sidecar can't start the pipeline
      </div>
      <h2 className="mt-2 font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
        Liquid Clips needs a few Python packages that aren't installed yet.
      </h2>
      <p className="mt-2 max-w-[560px] font-sans text-[13px] leading-relaxed text-text-secondary">
        The clip pipeline runs on your system Python and {missing.length === 1 ? "one package is" : `${missing.length} packages are`} missing:
        <span className="ml-1 font-mono text-ink">{missing.join(", ")}</span>.
      </p>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
        run in Terminal to fix
      </p>
      <pre className="mt-1 select-all overflow-x-auto rounded-lg border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink">
        {pipCmd}
      </pre>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        once that finishes, click retry
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => void onRetry()}
          className="rounded-full bg-fuchsia px-5 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-paper hover:bg-fuchsia/90"
        >
          retry
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          python: {python.replace(/^.*\//, "…/")}
        </span>
      </div>
      {Object.keys(errors).length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            raw import errors
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper p-2 font-mono text-[10px] leading-relaxed text-text-tertiary">
            {Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

function formatDownloadDetail(url: string, p?: IngestProgress): string {
  if (!p) return url;
  const parts: string[] = [];
  if (p.percent != null) parts.push(`${p.percent.toFixed(0)}%`);
  if (p.total_bytes && p.downloaded_bytes) {
    parts.push(`${formatBytes(p.downloaded_bytes)} / ${formatBytes(p.total_bytes)}`);
  } else if (p.downloaded_bytes) {
    parts.push(formatBytes(p.downloaded_bytes));
  }
  if (p.speed_bps && p.speed_bps > 0) parts.push(`${formatBytes(p.speed_bps)}/s`);
  if (p.eta_seconds != null && p.eta_seconds > 0) parts.push(`${formatEta(p.eta_seconds)} left`);
  const line = parts.join(" · ");
  return line ? `${line}\n${url}` : url;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Regex-match a yt-dlp-compatible URL out of a bounty description. Covers the
// platforms yt-dlp resolves cleanly + that our pipeline already handles.
function NavTab({
  label,
  active,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  Icon?: LucideIcon;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
        active ? "text-ink" : "text-text-tertiary hover:text-ink"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} />}
      {label}
      {active && (
        <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded-full bg-fuchsia" />
      )}
    </button>
  );
}
