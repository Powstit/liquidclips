// ship-lens v0.7.13 Tier 1 fixes landed (T1.1 + T1.2 + T1.3 + T1.5):
//   T1.1 — Success/error import toast lifted to App root (GlobalToast) so it
//          survives the empty → results view swap. WorkstationRoom's local
//          dropError surface still renders for drag-drop rejection on the
//          empty view (back-compat); the root toast is what survives the
//          view transition triggered by handleImportDirect.
//   T1.2 — OnboardingOverlay gated on view.kind === "empty" so a fresh user
//          mid-import doesn't get the welcome scrim painted over ResultsGrid.
//   T1.3 — `importing` state + double-click guard in handleImportDirect,
//          piped to WorkstationRoom so the Import tile dims + shows a
//          "preparing…" pill while the OS picker + sidecar.importReadyClips
//          are in flight. Back-compat: WorkstationRoom's `importing` prop
//          defaults to false.
//   T1.5 — handleImportDirect catch now routes through humanError() so a
//          SidecarError surfaces its pre-classified human message instead
//          of a raw `String(e)` traceback.
// Carry-overs from v0.7.8 preserved verbatim: S1 atomic-wipe sign-out, S5
// engine-restart banner, S6 check_deps remediation, v0.7.7 fixes #3/#5/#9.
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Loader2, LogIn } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
// motion / AnimatePresence are no longer used directly from App.tsx — the
// route-level dolly + room-change exit live inside RoomShell. Keeping the
// import out lets TS strict catch any future regressions where someone
// reaches for them at App level instead of via the shell.
// v0.6.35 — Cockpit. Replaces the empty-view UnifiedDropZone + dashboard
// stack with a transparent two-tile launch room, and the top-right header
// chrome with one orbital avatar that summons the full HUD panel.
import { Cockpit } from "./components/cockpit/Cockpit";
import { RoomShell } from "./components/cockpit/RoomShell";
import { WorkstationRoom } from "./components/cockpit/WorkstationRoom";
import { UploadPortal } from "./components/cockpit/UploadPortal";
import { AvatarOrbit } from "./components/cockpit/AvatarOrbit";
import { AvatarPanel } from "./components/cockpit/AvatarPanel";
import SignalLine from "./components/cockpit/SignalLine";
import { useAvatar } from "./lib/avatar";
// v0.6.0 — sidebar nav restructure. The 6 NavTab buttons + Logo moved into
// SideNav (fixed 64px left rail). Header right-side chips (status / bell /
// sign-in / settings) stay where they are.
import { SideNav, type SideNavKey } from "./components/nav/SideNav";
// v0.6.3 — replaces the faint OASIS atmosphere bleed with a fixed
// full-bleed aurora gradient (Aceternity-style) for the "new world"
// ambient depth Daniel approved in the v0.6.3 mockup.
import { AuroraBackground } from "./components/effects/AuroraBackground";
// v0.6.35 — UnifiedDropZone is now mounted inside UploadPortal (cockpit)
// instead of inline on the empty view. Same internals, modal frame.
// WorkspaceDashboard moved into AvatarPanel; only Earn still renders it
// inline if it ever needs to be re-exposed.
// v0.6.4 — retired from Workspace empty surface (still mountable elsewhere
// if a future Sprint wants them back; left as repo-resident components).
// import { SponsoredClipsCarousel } from "./components/workspace/SponsoredClipsCarousel";
// import { LiquidLiftBanner } from "./components/workspace/LiquidLiftBanner";
// import { MinecraftChallengeCard } from "./components/earn/MinecraftChallengeCard";
import { SubmissionPortal } from "./components/earn/SubmissionPortal";
import { LearnTab } from "./components/learn/LearnTab";
import { SchedulePage } from "./components/schedule/SchedulePage";
import { WorkingStage } from "./components/WorkingStage";
import { ResultsGrid } from "./components/ResultsGrid";
import { FirstRun } from "./components/FirstRun";
// v0.7.47 — ship-lens-reviewer caught GlobalToastHost as orphan code. It
// listens on the `lc:toast` window CustomEvent bus but was never mounted,
// so every dispatch in the app (Earn whopBounty failure toast, drag-drop
// unsupported file, multi-file drop notice, picker conflict) rendered
// nothing. Mounting it once at the App root revives all four surfaces.
import { GlobalToastHost } from "./components/GlobalToastHost";
import { JuniorLoader } from "./components/JuniorLoader";
import { Splash } from "./components/Splash";
import { NotificationBell } from "./components/NotificationBell";
import { NotificationSheet } from "./components/NotificationSheet";
// v0.6.41 — UploadTab + PayoutsTab retired in Sprint 1 consolidation.
// Upload queues fold into SchedulePage; Payouts becomes an Earn sub-tab.
import { LibraryTab } from "./components/library/LibraryTab";
import { InvadersOverlay } from "./components/invaders/InvadersOverlay";
import { OnboardingOverlay } from "./components/onboarding/OnboardingOverlay";
import { StudioTour } from "./components/onboarding/StudioTour";
import { useOnboardingStep } from "./contracts/useOnboardingStep";
import { closeInvaders } from "./lib/invaders/store";
import { Settings } from "./components/Settings";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { AchievementToast } from "./components/AchievementToast";
import { AuthPanel } from "./components/auth/AuthPanel";
import { useAuthPanel, closeAuthPanel } from "./components/auth/useAuthPanel";
import { isAdminEmail } from "./lib/useTier";
import { ThumbnailStudio } from "./components/ThumbnailStudio";
import { recordAchievement } from "./lib/achievements";
import { humanError, sidecar, subscribeSidecarDied, visibleStagesFor, pipelineStagesFor, backgroundStagesFor, onIngestProgress, onLiftProgress, type BountyContext, type IngestProgress, type Intent, type LiftProgress, type LiftTranscriptResult, type Project, type SecretName, type StageName } from "./lib/sidecar";
import { backend, maybeCheckQuota, QuotaExceededError, setOnUnauthorized } from "./lib/backend";
import { initDeepLinks, setOnActivated } from "./lib/activation";
import { HOSTED_LLM_ENABLED } from "./lib/flags";
import { closeBrowsePanel, openBrowsePanel, reconcileBrowsePanel, useBrowsePanel, WHOP_COMMUNITY_URL, WHOP_REWARDS_URL } from "./lib/browse";
import { CommunityTab } from "./components/CommunityTab";
import { BrowseRewardsPanel } from "./components/BrowseRewardsPanel";
import { reportDesktopError, setTelemetryConsent } from "./lib/telemetry";
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

const SAMPLE_ONBOARDING_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

// v0.6.18 — Backend ships both the v2 tier matrix ("free"|"solo"|"pro"|"agency")
// AND legacy aliases ("growth"=pro, "autopilot"=agency). Sponsored visibility
// gates are written in the v2 vocabulary, so we collapse legacy names here.
function normalizeTier(t: string | null): "free" | "solo" | "pro" | "agency" | null {
  if (!t) return null;
  if (t === "growth" || t === "channel") return "pro";
  if (t === "autopilot") return "agency";
  if (t === "free" || t === "solo" || t === "pro" || t === "agency") return t;
  return null;
}

type View =
  | { kind: "first-run" }
  | { kind: "empty" }
  | { kind: "quota" }
  | { kind: "earn" }
  | { kind: "learn" }
  | { kind: "library" }
  | { kind: "schedule" }
  | { kind: "community" }
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
  // P1 #22 — guard against the OS file picker + a Tauri drag-drop firing in
  // the same window. If the user opens Browse and then drags a file over the
  // window, the dialog and the listener race; the drop hijacks the picker
  // promise on macOS and leaves stranded UI state. While the picker is open,
  // the drag-drop listener ignores the event.
  const pickerOpenRef = useRef(false);
  // P1 #24 — generation guard for runRemainingStages, same pattern as
  // liftGenRef. Bumped at the start of every pipeline loop and on Cancel /
  // drag-drop-replace; each stage await re-checks before mutating view state
  // so a stale resolution from an abandoned run can't yank the user back.
  const runGenRef = useRef(0);
  // P0 #3 / #4 — shared cancel signal threaded through every async pipeline
  // boundary (ingest, runRemainingStages loop, drag-drop replace flow). The
  // sidecar cancel marker is one mechanism; this ref is the second: the
  // between-stage loop checks it before kicking off the next sidecar call so
  // a Cancel during stage N halts before stage N+1 starts. WorkingStage's
  // Cancel button sets this ref via a window event so we don't have to thread
  // a setter through props.
  const cancelRequestedRef = useRef(false);
  const [sidecarStatus, setSidecarStatus] = useState<"booting" | "ready" | "failed">("booting");
  // Has the user dismissed the splash (via Continue or Skip on the embedded
  // Invaders game)? Splash stays mounted until both sidecar is ready AND
  // this flips true — gives the user a guaranteed window to play.
  const [splashAcked, setSplashAcked] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // v0.7.31 — Thumbnail Studio surface (Cover Pack + AI Generate). Replaces
  // the v0.7.1 placeholder toast at the WorkstationRoom onThumbnails handler.
  // slug="" means no project context (Brand/Identity wizards still work,
  // Cover Pack + Generate are gated until a project is open).
  const [thumbnailStudio, setThumbnailStudio] = useState<{
    open: boolean;
    slug: string;
    projectName: string;
    clips: import("./lib/sidecar").Clip[];
  }>({ open: false, slug: "", projectName: "", clips: [] });
  // Analytics Phase 1 — deep-link target for Schedule's sub-tab. Set by
  // callers (Settings → Connections "view analytics", ChannelCard
  // "analytics →") before flipping the view to "schedule" so SchedulePage
  // mounts on the right tab. Cleared after each consume so subsequent
  // navigations honor the default.
  const [scheduleInitialSub, setScheduleInitialSub] = useState<"queue" | "channels" | "analytics" | undefined>(undefined);
  // v0.7.45 P3.c — BottomCockpit dispatches lc:settings-open-tab BEFORE
  // Settings mounts, so Settings.tsx never catches it. We add a root-level
  // listener that routes directly to Schedule → Channels, and a transient
  // ref so onOpenSettings can skip opening Settings when the event already
  // handled navigation.
  const channelConnectPendingRef = useRef(false);
  const channelConnectTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    function onSettingsTab(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab === "channels") {
        channelConnectPendingRef.current = true;
        if (channelConnectTimeoutRef.current) window.clearTimeout(channelConnectTimeoutRef.current);
        channelConnectTimeoutRef.current = window.setTimeout(() => {
          channelConnectPendingRef.current = false;
          channelConnectTimeoutRef.current = null;
        }, 100);
        setScheduleInitialSub("channels");
        setView({ kind: "schedule" });
      }
    }
    window.addEventListener("lc:settings-open-tab", onSettingsTab);
    return () => window.removeEventListener("lc:settings-open-tab", onSettingsTab);
  }, []);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [submissionPortalOpen, setSubmissionPortalOpen] = useState(false);
  const [refreshingApp, setRefreshingApp] = useState(false);
  // Branded confirm primitives — kill the two native `confirm()` calls that
  // block the Tauri webview thread + break the cockpit voice. The replace-
  // pipeline confirm carries a Promise resolver so the original drag-drop
  // listener can `await` the user's answer without polling.
  const [confirmReplacePipeline, setConfirmReplacePipeline] = useState<
    { resolve: (ok: boolean) => void } | null
  >(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // v0.7.8 S5 — mid-session sidecar crash banner. `engineRestartReason`
  // captures the exit code the Rust shell parsed out of the death event so
  // we can surface "engine restarted (exit N)" copy when present. Auto-
  // dismisses after the NEXT successful sidecar call lands — see the
  // `sidecarCallSuccessAt` heartbeat below. Restart button calls relaunch.
  const [engineRestartReason, setEngineRestartReason] = useState<{ exit_code: number | null } | null>(null);
  const [engineRestarting, setEngineRestarting] = useState(false);

  // ship-lens v0.7.14 K-γ mount — StudioTour contract hook. Reads the
  // LIQUIDCLIPS_ONBOARDED keychain flag; while not done + not hydrating,
  // we mount <StudioTour /> as a top-layer overlay (z-60). Tour itself
  // owns its 4-step sequence (workstation → clips → schedule → earn); we
  // call begin() once so the contract's stepId tracking is consumed, and
  // forward Skip/Finish to skip()/finish() which write the keychain flag.
  // Settings → "Replay tour" can call reset() later to re-fire.
  const {
    isDone: tourDone,
    hydrating: tourHydrating,
    stepId: tourStepId,
    begin: beginTour,
    skip: skipTour,
    finish: finishTour,
  } = useOnboardingStep();
  // Local guard so a single render cycle doesn't call begin() twice (the
  // hook's begin is idempotent but we still want one click of intent).
  const tourBegunRef = useRef(false);

  // Sprint #14c — global "open Settings" bus so any component (e.g. the
  // Earn-tab ConnectionBadge "Sign in with Whop" CTA) can pop Settings open
  // without prop-drilling setSettingsOpen everywhere.
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("lc:open-settings", open);
    return () => window.removeEventListener("lc:open-settings", open);
  }, []);

  // v0.7.8 S5 — surface mid-session sidecar crashes as a top-level fuchsia
  // banner. Pre-fix the only path to learn about a sidecar:died event was
  // via individual RPC rejections (SidecarCrashedError) — which only screens
  // with an in-flight call surfaced. A user looking at the cockpit landing
  // could lose the engine and never see a hint. subscribeSidecarDied is the
  // single-source-of-truth event Rust emits on Python death; the banner
  // mounts the moment it fires.
  useEffect(() => {
    const unsubscribe = subscribeSidecarDied((info) => {
      setEngineRestartReason({ exit_code: info.exit_code });
    });
    return unsubscribe;
  }, []);

  // ship-lens v0.7.14 K-γ mount — fire begin() once the keychain hydrate
  // resolves to "not done". One call per session; subsequent renders are
  // no-ops via the ref guard. View gating happens at render time below.
  useEffect(() => {
    if (tourHydrating) return;
    if (tourDone) return;
    if (tourBegunRef.current) return;
    tourBegunRef.current = true;
    beginTour(["workstation", "clips", "schedule", "earn"]);
  }, [tourHydrating, tourDone, beginTour]);

  // Auto-dismiss the engine-restart banner once a sidecar call comes back
  // clean. Cheap heartbeat: ping every 4s while the banner is up; clear on
  // first success. Failure leaves the banner mounted so the Restart button
  // remains visible. We don't run the heartbeat when the banner is down,
  // so steady-state cost is zero.
  useEffect(() => {
    if (!engineRestartReason) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await sidecar.ping();
        if (!cancelled) setEngineRestartReason(null);
      } catch {
        /* sidecar still down — keep the banner mounted */
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [engineRestartReason]);

  // P0 #3 — WorkingStage Cancel fires `lc:pipeline-cancel`; App.tsx flips the
  // shared ref so the between-stage loop bails before the next sidecar call.
  // This is the bus replacing prop-threading the ref through WorkingStage.
  useEffect(() => {
    const onCancel = () => {
      cancelRequestedRef.current = true;
      // P0 #4 — frontend writes BOTH cancel markers. The sidecar RPC clears
      // its inflight ingest_url / lift_transcript; the per-project .cancel
      // marker is checked by cut/reframe/thumbs stages. Failure is fine —
      // best-effort; the in-process ref check is the belt.
      void sidecar.liftCancel().catch(() => undefined);
    };
    window.addEventListener("lc:pipeline-cancel", onCancel);
    return () => window.removeEventListener("lc:pipeline-cancel", onCancel);
  }, []);
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
  // v0.6.36 — Read-side removed when UploadPortal stopped surfacing the
  // free-tier counter inline. Setter retained for /sync side effects so the
  // value stays current for any future surface that wants to gate on it.
  const [, setRemainingExports] = useState<number | null>(null);
  // v0.6.18 — user tier captured from /sync so SponsoredRewardsRow + the Earn
  // carousel can resolve visibility correctly (was hardcoded to "free" which
  // showed Agency/Pro users a locked banner for campaigns they could open).
  //
  // v0.6.50 — seed from the SAME cache useTier reads so first paint matches
  // the hook. Previously this was `null`, which caused SponsoredBannerCarousel
  // + EarnTab to flash a locked-banner state for ~500ms before /sync resolved.
  // The cache survives reboots so an Agency user re-opening the app stays
  // Agency from frame 1.
  const [userTier, setUserTier] = useState<"free" | "solo" | "pro" | "agency" | null>(() => {
    try {
      const raw = window.localStorage?.getItem("lc:cached_tier");
      return normalizeTier(raw);
    } catch {
      return null;
    }
  });

  // GlobalAuthPanel dispatches `lc:tier-refresh` on close (Clerk Stripe
  // Checkout success path). Without this listener the event was a
  // deadletter and an in-app upgrade never flipped the tier until next
  // window focus. Lens fix v0.6.50.
  useEffect(() => {
    function onTierRefresh(e: Event) {
      const detail = (e as CustomEvent).detail as { tier?: string } | undefined;
      const normalized = normalizeTier(detail?.tier ?? null);
      if (normalized) setUserTier(normalized);
    }
    window.addEventListener("lc:tier-refresh", onTierRefresh);
    return () => window.removeEventListener("lc:tier-refresh", onTierRefresh);
  }, []);
  // v0.6.18 — pipeline state lifted out of `view` so a user can navigate away
  // (Earn / Community / etc) and the pipeline keeps running in the background;
  // a "rendering" pill at the top of every non-running view lets them return.
  const [runningProject, setRunningProject] = useState<Project | null>(null);
  const [runningStage, setRunningStage] = useState<StageName | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // v0.6.35 — Cockpit state. `panelOpen` toggles the AvatarPanel HUD; the
  // upload portal is opened from either WorkstationRoom tile and carries
  // the lane the user picked so UnifiedDropZone lands in the right mode.
  const [panelOpen, setPanelOpen] = useState(false);
  // v0.6.36 — Portal lost its lane prop. Import now bypasses the modal
  // entirely (direct file picker); the portal only exists for the Create
  // URL/file flow.
  // v0.7.7 ship-lens fix #5 — UploadPortal now carries which tile launched
  // it so the same modal can drive either pipeline. Default `clips` =
  // Create tile (legacy behaviour). `script` = Script tile → lift_transcript.
  const [uploadPortal, setUploadPortal] = useState<{ open: boolean; intent: "clips" | "script" }>({ open: false, intent: "clips" });
  // ship-lens v0.7.13 T1.3 — `importing` is the single source of truth for
  // the Import tile's loading state AND the double-click guard. It's both
  // a visual signal (Import tile dims + shows a "preparing…" pill via the
  // WorkstationRoom `importing` prop) and a logical one (the early-return
  // in handleImportDirect bails on a second invocation mid-flight). Belt
  // and braces — the disabled tile is the visual half, the guard is the
  // logical half, because pointer-events can be defeated by a rapid second
  // click landing between two renders.
  const [importing, setImporting] = useState(false);
  // Direct import — single click on the Workstation Import tile fires the
  // OS file picker, then routes the resulting Project into ResultsGrid.
  // No intermediate modal, no lane chooser; the picker IS the next surface.
  async function handleImportDirect() {
    // ship-lens v0.7.13 T1.3 — double-click guard. A second invocation
    // mid-import is a no-op so we don't kick off two parallel
    // importReadyClips calls and race their setView landings.
    if (importing) return;
    setImporting(true);
    // P1 #22 — mark picker open so the drag-drop listener ignores any drop
    // that lands while the OS dialog is visible. Cleared in the finally block.
    pickerOpenRef.current = true;
    try {
      const picked = await open({
        multiple: true,
        filters: [
          { name: "Finished clips", extensions: ["mp4", "MP4", "mov", "MOV", "webm", "WEBM", "m4v", "M4V"] },
        ],
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;
      // ship-lens v0.7.11: surface visible feedback on BOTH success + failure
      // so the user knows the click took. The pre-v0.7.11 catch silently
      // console.error'd while a project saved to disk — exactly the
      // silent-success-and-no-UI-transition strand the audit named in v0.7.7
      // and that escaped through v0.7.8.
      // ship-lens v0.7.13 T1.1 — `dropError` is read by both
      // WorkstationRoom (mounted only on the empty view) AND by GlobalToast
      // at App root (mounted everywhere). The success message survives the
      // setView({ kind: "results" }) transition via the root toast even
      // though WorkstationRoom has already unmounted.
      setDropError(null);
      try {
        const { project } = await sidecar.importReadyClips(paths);
        setView({ kind: "results", project });
        setDropError(
          `Imported ${paths.length} clip${paths.length === 1 ? "" : "s"} → opening workbench…`,
        );
      } catch (e) {
        console.error("[import-direct] failed:", e);
        // ship-lens v0.7.13 T1.5 — humanError handles SidecarError's
        // pre-classified .human field and falls back to e.message /
        // String(e) for unknown error shapes. Replaces the prior raw
        // `e instanceof Error ? e.message : String(e)` which leaked
        // Python tracebacks from a sidecar-side failure straight into
        // the toast copy.
        setDropError(`Import failed: ${humanError(e).slice(0, 200)}`);
      }
    } finally {
      setImporting(false);
      pickerOpenRef.current = false;
    }
  }
  // Hydrate avatar store from the sidecar once at app boot. The orbit + the
  // panel header both read from the same Zustand store, so one refresh
  // covers every avatar surface.
  useEffect(() => {
    void useAvatar.getState().refresh();
  }, []);

  // Verify sidecar + warm-load whisper. We DON'T force first-run anymore —
  // the app opens straight into the empty/workspace view so the flow is
  // testable without an account. Sign-in lives as a top-nav action and
  // shows the FirstRun splash on demand; sign-out from Settings also routes
  // back to it explicitly.
  useEffect(() => {
    (async () => {
      try {
        // v0.7.7 ship-lens fix #3 — sidecar.ping() goes through sidecarCall,
        // which only settles on (a) Tauri invoke returning or (b) the
        // sidecar:died crash event. A stuck Python interpreter that's
        // alive-but-not-responsive (heavy import deadlock, signed-binary
        // gatekeeper prompt, hung mlx-whisper warm-up, etc.) never fires
        // either — the boot hangs forever and the user sees a frozen
        // splash with no Restart affordance. Wrapping with an 8s race
        // routes that case into setSidecarStatus("failed"), which the
        // Splash already renders as the Restart / Copy / Email card.
        await Promise.race([
          sidecar.ping(),
          new Promise<never>((_, rej) =>
            window.setTimeout(
              () => rej(new Error("sidecar ping timeout after 8s")),
              8000,
            ),
          ),
        ]);
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
          } else {
            const { secrets } = await sidecar.secretsStatus();
            const firstRun =
              !secrets.LIQUIDCLIPS_ONBOARDED &&
              !secrets.LICENSE_JWT &&
              !secrets.OPENAI_API_KEY;
            setShowOnboarding(firstRun);
          }
        } catch (e) {
          // v0.7.8 S6 — check_deps itself failed: don't strand a fresh user
          // on an empty workspace with no remediation card. Route them to
          // the deps-missing surface with an empty `missing` list — that
          // view renders the raw probe error in the <details> "raw import
          // errors" pane and surfaces a Retry chip so the user can pull a
          // fresh probe without restarting. Mirrors the recovery path that
          // sidecar.ping() failure already takes via setSidecarStatus.
          const probeMessage = humanError(e);
          setView({
            kind: "deps-missing",
            missing: [],
            errors: { check_deps: probeMessage },
            python: "unavailable",
          });
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
        // Boot tier resolution — parallel /sync + /me so we can apply the
        // same three-signal admin check as useTier: admin_override field,
        // effective_tier=autopilot, or isAdminEmail(me.email). Mirrors
        // useTier.ts so App.tsx's parallel userTier state never drifts.
        void import("./lib/backend")
          .then(async (m) => {
            // v0.7.7 ship-lens fix #9 — meStatus now returns a discriminated
            // union; the boot-time admin-fallback only needs `.email`, so
            // meStatusLegacy() preserves the prior `MeStatus | null` shape
            // without dropping the new "expired" signal (Settings consumes
            // the union directly to fire the re-activate banner).
            const [s, me] = await Promise.all([
              m.syncStatus().catch(() => null),
              m.meStatusLegacy().catch(() => null),
            ]);
            return { s, me };
          })
          .then(({ s, me }) => {
            const isAdmin =
              s?.admin_override === true ||
              s?.tier === "autopilot" ||
              isAdminEmail(me?.email);
            setRemainingExports(isAdmin ? null : (s?.remaining_exports ?? null));
            const tier = isAdmin ? "agency" : (s?.tier ?? null);
            setUserTier(normalizeTier(tier));
          })
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

    // v0.7.49 — "You just updated" toast. Daniel ran the v0.7.48 install
    // cycle and saw nothing (the downloaded banner disappeared and the app
    // appeared to hang). Compare current version against the one we recorded
    // at last launch; if it's higher, the user just installed an update —
    // celebrate it via lc:toast so the success is unambiguous. Without this
    // beat the auto-update felt silent and broken.
    void (async () => {
      try {
        const currentVersion = await getVersion();
        const stored = window.localStorage.getItem("lc:last_launched_version") || "";
        if (stored && stored !== currentVersion) {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("lc:toast", {
                detail: {
                  kind: "success",
                  message: `Updated to Liquid Clips ${currentVersion} — you're on the latest build.`,
                },
              }),
            );
          }, 1200);
        }
        window.localStorage.setItem("lc:last_launched_version", currentVersion);
      } catch {
        /* getVersion can fail outside Tauri; safe to ignore */
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

    // Native-crash recovery (sprint #14c P2 audit fix). The Rust panic hook
    // in src-tauri/src/lib.rs writes ~/LiquidClips/.last-crash.json when a
    // hard panic happens. On the NEXT boot we read it, report to Admin HQ,
    // then delete so we don't double-report. Failure here is silent — the
    // app must boot even if the crash marker is malformed.
    void (async () => {
      try {
        const { homeDir } = await import("@tauri-apps/api/path");
        const { readTextFile, remove, exists } = await import("@tauri-apps/plugin-fs");
        const home = await homeDir();
        const path = `${home}/LiquidClips/.last-crash.json`;
        if (await exists(path)) {
          const raw = await readTextFile(path);
          const parsed = JSON.parse(raw) as {
            event?: string;
            message?: string;
            file?: string;
            line?: number;
            app_version?: string;
          };
          void reportDesktopError(parsed.event ?? "rust_panic", {
            error_code: "RustPanic",
            message: `${parsed.message ?? "panic"} at ${parsed.file ?? "?"}:${parsed.line ?? 0} (v${parsed.app_version ?? "?"})`,
          });
          await remove(path).catch(() => undefined);
        }
      } catch {
        /* crash recovery best-effort — never break boot */
      }
    })();

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
  // P0 #6 — ephemeral inline error for "drop something not a video". Set on
  // unsupported drops, auto-cleared after 4s. Also exposed as a `lc:toast`
  // window event so any future toast system can lift it; until then the
  // WorkstationRoom shows the message inline.
  const [dropError, setDropError] = useState<string | null>(null);
  useEffect(() => {
    if (!dropError) return;
    const id = window.setTimeout(() => setDropError(null), 4000);
    return () => window.clearTimeout(id);
  }, [dropError]);
  // P0 #5 — drive a visible drop affordance on WorkstationRoom whenever
  // Tauri reports a drag is currently hovering over the window. Mounted
  // once at App level so it's correct for every surface, not just empty.
  const [dragHoverActive, setDragHoverActive] = useState(false);
  useEffect(() => {
    const unEnter = listen("tauri://drag-enter", () => setDragHoverActive(true));
    const unLeave = listen("tauri://drag-leave", () => setDragHoverActive(false));
    const unDrop = listen("tauri://drag-drop", () => setDragHoverActive(false));
    return () => {
      void unEnter.then((un) => un());
      void unLeave.then((un) => un());
      void unDrop.then((un) => un());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
      // P1 #22 — race guard. If the OS file picker is currently open, ignore
      // the drop instead of racing the dialog's promise. Surface a toast so
      // the user knows the drop was deliberately rejected (vs. silently lost).
      if (pickerOpenRef.current) {
        try {
          window.dispatchEvent(new CustomEvent("lc:toast", {
            detail: { kind: "info", message: "Close the file picker before dropping a file." },
          }));
        } catch {
          /* ignore */
        }
        return;
      }
      const paths = event.payload?.paths ?? [];
      const path = paths[0];
      if (!path) return;
      // v0.7.34 — Was silently truncating to paths[0]. Beta users dropping
      // 3 videos saw 2 vanish with no signal. We still only PROCESS the
      // first (the clip pipeline is single-project at a time), but we now
      // surface a toast so the user knows the rest were ignored and can
      // drop them one at a time.
      if (paths.length > 1) {
        const message = `${paths.length} files dropped — importing the first one. Drop the rest after this finishes.`;
        try {
          window.dispatchEvent(new CustomEvent("lc:toast", { detail: { kind: "info", message } }));
        } catch {
          /* ignore */
        }
      }
      // P0 — if the UploadPortal modal is open, dismiss it BEFORE we route.
      // Otherwise the IntentPicker mounts behind a half-faded portal overlay
      // and the user gets a ghost-portal-over-IntentPicker visual bug. We
      // close before the file-type check too so the inline drop-error toast
      // shown by WorkstationRoom isn't occluded by the modal.
      if (uploadPortal.open) {
        setUploadPortal((u) => ({ ...u, open: false }));
      }
      // Whitelist video extensions — Tauri will hand us folder paths or
      // unrelated files (zip, txt) on a stray drop. Reject early so the
      // sidecar doesn't waste a probe failing on something obviously wrong.
      if (!/\.(mp4|mov|mkv|webm|avi|m4v|mp3|m4a|wav)$/i.test(path)) {
        // P0 #6 — was a silent console.warn; now surface so the user knows
        // why nothing happened. Also dispatch a `lc:toast` for the future
        // toast system to pick up.
        const message = "Unsupported file. Drop MP4, MOV, MKV, or WEBM.";
        setDropError(message);
        try {
          window.dispatchEvent(new CustomEvent("lc:toast", { detail: { kind: "error", message } }));
        } catch {
          /* ignore */
        }
        return;
      }
      // P0 #1 — guard against silent abandon. If a pipeline is running (or
      // we're in choose-intent), confirm with the user before throwing away
      // the in-flight work. Cancel the running ingest first so the sidecar
      // doesn't keep eating bandwidth in the background.
      if (
        view.kind === "downloading" ||
        view.kind === "lifting" ||
        view.kind === "running" ||
        view.kind === "choosing-intent"
      ) {
        // Branded confirm — the native window.confirm() here used to block
        // the Tauri webview thread and break cockpit voice. We open the
        // modal and await the user's answer via a Promise resolver so this
        // listener can continue exactly like before.
        const ok = await new Promise<boolean>((resolve) => {
          setConfirmReplacePipeline({ resolve });
        });
        if (!ok) return;
        // P1 #23 — bump liftGenRef so any in-flight lift Promise from the
        // run we're replacing can't land a stale "lifted" view between
        // sidecar.liftCancel() resolving and the new ingest's view
        // transition. Mirrors the WorkingStage Cancel handler.
        liftGenRef.current += 1;
        cancelRequestedRef.current = true;
        await sidecar.liftCancel().catch(() => undefined);
      }
      // Drops route through the intent picker like every other entry. The
      // pipeline doesn't start until the user picks what they're making.
      setView({ kind: "choosing-intent", source: { kind: "file", path }, brief: pendingBrief });
    });
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, [pendingBrief, view.kind, uploadPortal.open]);

  // Autoclose Invaders when the pipeline reaches any terminal state — the
  // user came here to clip, not to play. Game state inside the overlay still
  // persists internally for the session (high score is on disk), so reopening
  // resumes from a fresh wave 1.
  useEffect(() => {
    const terminalKinds: View["kind"][] = ["results", "lifted", "failed", "canceled", "empty", "earn", "learn", "schedule"];
    if (terminalKinds.includes(view.kind)) {
      closeInvaders();
    }
  }, [view.kind]);

  async function runPipelineFromUrl(url: string, brief: string = "", intent: Intent = "both", bounty?: BountyContext) {
    // P0 #2 — re-entry cancel. If a prior URL ingest is still in flight (e.g.
    // user pasted a second link before the first finished), tell the sidecar
    // to drop the current job before we start the new one. Reset the cancel
    // flag too so the fresh pipeline isn't pre-poisoned by the previous run.
    await sidecar.liftCancel().catch(() => undefined);
    cancelRequestedRef.current = false;
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
      // P1 #8 — mirror the success-path sticky-view check: if the user has
      // navigated away to Earn / Community / Library / etc., don't yank them
      // back to a FailureCard. They'll see it via the inbox / on return.
      const stickyKinds: View["kind"][] = [
        "running",
        "downloading",
        "lifting",
        "empty",
        "choosing-intent",
      ];
      setView((v) =>
        stickyKinds.includes(v.kind)
          ? { kind: "ingest-failed", url, intent, error: humanIngestError(e) }
          : v,
      );
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
    // P1 #24 — generation guard, mirroring liftGenRef. Bumped + captured at
    // entry; each `await sidecar.runStage(...)` re-checks runGenRef before
    // mutating view state. A stale resolution from an abandoned run (e.g.
    // drag-drop replace, Cancel) can no longer yank the user back onto a
    // mid-pipeline view or land a phantom "failed"/"results" transition.
    const myGen = ++runGenRef.current;
    let current = initial;
    const remaining: StageName[] = pipelineStagesFor(current.intent ?? "both");
    setRunningProject(current);
    // v0.6.18 — Sticky-running. setView only forces the "running" surface if
    // the user is currently looking at a pipeline view. If they navigated to
    // Earn / Community / etc, we keep `runningProject`/`runningStage` in
    // state so a floating "rendering" pill can route them back without
    // kicking them away from where they're working.
    const isOnPipelineView = (kind: View["kind"]) =>
      kind === "running" || kind === "downloading" || kind === "lifting" || kind === "empty" || kind === "choosing-intent";
    for (const stage of remaining) {
      // P0 #3 — between-stage cancel check. If the user clicked Cancel during
      // the previous stage, halt BEFORE we tell the sidecar to start the next
      // one. The sidecar marker covers in-stage cancellation; this covers the
      // gap between stages where no Python code is running to notice.
      if (cancelRequestedRef.current) {
        setRunningProject(null);
        setRunningStage(null);
        // Best-effort: drop the per-project .cancel marker too so any stage
        // that DID start can also bail at its next checkpoint.
        try {
          await import("@tauri-apps/plugin-fs").then((m) =>
            m.writeTextFile(`${current.root}/.cancel`, "1"),
          );
        } catch {
          /* best-effort */
        }
        setView((v) => (isOnPipelineView(v.kind) ? { kind: "canceled", project: current } : v));
        return;
      }
      setRunningStage(stage);
      setView((v) => (isOnPipelineView(v.kind)
        ? { kind: "running", project: current, currentStage: stage }
        : v));
      try {
        // P0 #5 — per-stage frontend timeout. Heavy stages (cut/reframe/thumbs)
        // can legitimately take longer than the original 10-minute blanket
        // budget on long sources or busy machines; the prior uniform timeout
        // hard-failed healthy long jobs. Lighter stages (audio/transcribe and
        // ingest/llm) keep the 10-minute ceiling so the timeout still catches
        // genuine hangs instead of hiding bugs. The sidecar still owns real
        // cancellation (.cancel marker); the race here is the UI's
        // "something is very wrong" tripwire, not the slow-path budget.
        const STAGE_TIMEOUT_MS_BY_STAGE: Record<StageName, number> = {
          ingest: 10 * 60 * 1000,
          audio: 10 * 60 * 1000,
          transcribe: 10 * 60 * 1000,
          llm: 10 * 60 * 1000,
          cut: 20 * 60 * 1000,
          reframe: 20 * 60 * 1000,
          thumbs: 20 * 60 * 1000,
        };
        const STAGE_TIMEOUT_MS = STAGE_TIMEOUT_MS_BY_STAGE[stage] ?? 10 * 60 * 1000;
        const STAGE_TIMEOUT_MIN = Math.round(STAGE_TIMEOUT_MS / 60000);
        const { project: updated } = await Promise.race([
          sidecar.runStage(current.slug, stage),
          new Promise<never>((_, reject) =>
            window.setTimeout(
              () => reject(new Error(`Stage "${stage}" timed out after ${STAGE_TIMEOUT_MIN} minutes. Cancel and try again, or check your source.`)),
              STAGE_TIMEOUT_MS,
            ),
          ),
        ]);
        // P1 #24 — if the run was superseded while sidecar.runStage was in
        // flight, drop the resolution on the floor so we don't write stale
        // state into the new generation's view.
        if (runGenRef.current !== myGen) return;
        current = updated;
        setRunningProject(current);
      } catch (e) {
        // P1 #24 — same gen-check on the failure path. A timeout/error from
        // an abandoned run must not surface a FailureCard for the new run.
        if (runGenRef.current !== myGen) return;
        const { project: refreshed } = await sidecar.getProject(current.slug).catch(() => ({ project: current }));
        if (runGenRef.current !== myGen) return;
        current = refreshed;
        const err = current.stages[stage]?.error ?? "";
        setRunningProject(null); setRunningStage(null);
        if (err === "canceled" || err.includes("CanceledError")) {
          setView((v) => (isOnPipelineView(v.kind) ? { kind: "canceled", project: current } : v));
          return;
        }
        setView((v) => (isOnPipelineView(v.kind) ? { kind: "failed", project: current, error: err || humanError(e) } : v));
        return;
      }
      if (current.stages[stage].status === "failed") {
        const err = current.stages[stage].error ?? "";
        setRunningProject(null); setRunningStage(null);
        if (err === "canceled" || err.includes("CanceledError")) {
          setView((v) => (isOnPipelineView(v.kind) ? { kind: "canceled", project: current } : v));
          return;
        }
        setView((v) => (isOnPipelineView(v.kind) ? { kind: "failed", project: current, error: err || "stage failed" } : v));
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
    setRunningProject(null); setRunningStage(null);
    // v0.6.18 — Inbox notification on success. Backend-side row appears in the
    // bell + sheet so a user who navigated away returns to a clear "clips
    // finished" card with a one-tap return action. external_dedup_key makes
    // the create call idempotent for the same project slug.
    void (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (!jwt) return;
        const n = current.clips.length;
        await backend.notifications.create(jwt, {
          category: "pipeline_event",
          title: n === 1 ? "Your clip is ready." : `${n} clips ready.`,
          body: `Liquid Clips finished ${current.source_filename}. Tap to open the workspace and review.`,
          priority: "medium",
          action_kind: "open_project",
          action_data: { slug: current.slug },
          external_dedup_key: `pipeline-done-${current.slug}`,
        });
      } catch (e) {
        console.warn("[inbox] create notification failed (non-fatal):", e);
      }
    })();
    // v0.6.18 — Only surface the results view if the user is still on a
    // pipeline screen. If they're on Earn / Community / etc, leave them
    // there; the rendering pill (or the new inbox row) is their cue to
    // come back when they want.
    setView((v) => {
      const stickyKinds: View["kind"][] = ["running", "downloading", "lifting", "empty", "choosing-intent"];
      if (stickyKinds.includes(v.kind)) return { kind: "results", project: current };
      return v;
    });

    // v0.6.15 — Background stages. Clip runs now show rough playable clips
    // before transcription finishes; transcript/caption polish and thumbnails
    // happen after ResultsGrid is visible. YouTube intent still blocks on
    // transcript because chapters/description need text.
    for (const stage of backgroundStagesFor(current.intent ?? "both")) {
      void sidecar
        .runStage(current.slug, stage)
        .then(({ project: updated }) => {
          setView((v) => (v.kind === "results" && v.project.slug === updated.slug ? { kind: "results", project: updated } : v));
        })
        .catch((e) => {
          console.warn(`[background-stage] ${stage} failed (non-blocking):`, e);
          // v0.7.34 — Surface thumbnail failures. Other background stages
          // (transcript polish, caption refine) can fail silently because
          // the clip still plays. Thumbnails are the one users will hunt
          // for if they're missing, so push a toast they can act on.
          if (stage === "thumbs") {
            try {
              window.dispatchEvent(new CustomEvent("lc:toast", {
                detail: {
                  kind: "warn",
                  message: "Thumbnails didn't generate — clips are ready. Retry from the clip editor.",
                },
              }));
            } catch {
              /* ignore */
            }
          }
        });
    }
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
    // P0 #2 — mirror runPipelineFromUrl: any prior ingest must be torn down
    // before we kick off a fresh local-file run, and the cancel flag has to
    // reset so a stale Cancel click from the prior run can't pre-poison us.
    await sidecar.liftCancel().catch(() => undefined);
    cancelRequestedRef.current = false;
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
      // P0 #9 — was raw String(e), leaking Python tracebacks / "[object Object]"
      // into the FailureCard. humanError(e) surfaces SidecarError.human if the
      // sidecar pre-classified it, else falls back to e.message / String(e).
      setView((prev) => {
        const base = prev.kind === "running" || prev.kind === "results" || prev.kind === "failed" ? prev.project : null;
        if (base) {
          return { kind: "failed", project: base, error: humanError(e) };
        }
        console.error("[pipeline] startRun failed:", e);
        return { kind: "empty" };
      });
    }
  }

  async function pickFile(briefFromUI: string) {
    setPendingBrief(briefFromUI);
    // P1 #22 — same picker-vs-drop guard as handleImportDirect. The dialog
    // is the only thing the user should be interacting with while it's open.
    pickerOpenRef.current = true;
    let picked: string | string[] | null = null;
    try {
      picked = await open({
        multiple: false,
        filters: [
          { name: "Videos", extensions: ["mp4", "MP4", "mov", "MOV", "mkv", "MKV", "webm", "m4v", "M4V", "avi", "AVI", "hevc"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
    } finally {
      pickerOpenRef.current = false;
    }
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

  async function completeOnboarding() {
    setShowOnboarding(false);
    await sidecar.secretSet("LIQUIDCLIPS_ONBOARDED", "v1").catch(() => undefined);
  }

  // v0.7.7 ship-lens fix #5 — Re-wired from the Script tile. UploadPortal in
  // `intent: "script"` calls onPasteUrlScript(url) which invokes this
  // function. The "lifting" → "lifted" → TranscriptResult flow is the same
  // path the original Script-mode UI used before it was parked in v0.6.36.
  async function _onLiftTranscript(url: string) {
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
      const transcribeEngine = result.transcribe_engine ?? result.meta?.transcribe_engine ?? null;
      trackEvent("pipeline_transcribe_completed", {
        source_host: host,
        duration_s: result.duration ?? null,
        segments: Array.isArray(result.segments) ? result.segments.length : 0,
        engine: transcribeEngine,
      });
      trackEvent("lift_completed", {
        source_host: host,
        duration_s: result.duration ?? null,
        segments: Array.isArray(result.segments) ? result.segments.length : 0,
        wall_ms: Math.round(performance.now() - startMs),
        language: result.language ?? null,
        engine: transcribeEngine,
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
  // v0.7.7 ship-lens fix #5 — _onLiftTranscript is now actively wired from
  // the Script tile via UploadPortal onPasteUrlScript; the void-keep-alive
  // is gone. The "lifted" view renders TranscriptResult; existing project
  // routing still picks up where it always has.

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
            void sidecar.secretSet("LIQUIDCLIPS_ONBOARDED", "v1").catch(() => undefined);
            setView({ kind: "empty" });
            setShowOnboarding(false);
            setNeedsActivation(false); // fresh JWT written → clear the prompt; polls recover
            // Activation usually writes the license JWT during FirstRun.
            // Re-poll so the nav swaps Sign in → Account without a relaunch.
            void sidecar.licenseJwtRead().then(({ value }) => setSignedIn(!!value)).catch(() => undefined);
          }}
        />
      </div>
    );
  }

  // v0.6.0 — derive SideNav active key from the current view. Mirrors the
  // active={...} predicates that used to live on each NavTab. Bounty-setup
  // counts as Earn; the long tail of pipeline states (downloading / lifting /
  // results / failed / canceled / etc.) all sit under Workspace.
  const sideNavActiveKey: SideNavKey | null = (() => {
    switch (view.kind) {
      case "library":
        return "library";
      case "earn":
      case "bounty-setup":
        return "earn";
      case "learn":
        return "learn";
      case "schedule":
        return "schedule";
      case "community":
        return "community";
      case "deps-missing":
        // "first-run" is unreachable here — the early return at line 652
        // peels it off before we resolve the active rail key.
        return null;
      default:
        return "workspace";
    }
  })();

  async function refreshApp() {
    setRefreshingApp(true);
    try {
      await closeBrowsePanel().catch(() => undefined);
    } finally {
      window.location.reload();
    }
  }

  return (
    <MainShell>
      <SideNav
        activeKey={settingsOpen ? "settings" : sideNavActiveKey}
        onSelect={(key) => {
          switch (key) {
            case "workspace":
              setView({ kind: "empty" });
              break;
            case "library":
              setView({ kind: "library" });
              break;
            case "earn":
              setView({ kind: "earn" });
              break;
            case "learn":
              setView({ kind: "learn" });
              break;
            case "schedule":
              setScheduleInitialSub(undefined);
              setView({ kind: "schedule" });
              break;
            case "community":
              // v0.6.19 — Community rail click does two things at once:
              // 1. Sets view to "community" (native CommunityTab — campaign
              //    feed, release notes, affiliate guide)
              // 2. Slides the in-app chat panel in from the right with the
              //    Whop joined-hub URL — so chat is one click away, not two
              // Members hit Community → chat is RIGHT THERE.
              setView({ kind: "community" });
              void openBrowsePanel(WHOP_COMMUNITY_URL);
              break;
          }
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {/* Right column — header on top, main below.
          v0.6.35 — Header chrome collapsed to a single AvatarOrbit on the
          right. Sidecar pulse moved into the orbit ring colour; refresh,
          inbox, settings, sign-out moved into the AvatarPanel footer rail. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 px-6 py-3">
          {signedIn === false && (
            <button
              onClick={() => setView({ kind: "first-run" })}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia-soft/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep transition-colors hover:bg-fuchsia hover:text-white"
              aria-label="Sign in to Liquid Clips"
            >
              <LogIn className="h-3.5 w-3.5" strokeWidth={2} />
              Sign in
            </button>
          )}
          {/* v0.6.38 — Fix: previously hardcoded "ready" because the splash
              early-return narrows sidecarStatus's type to "ready" at this
              line. String() widens the value back so mid-session sidecar
              failures still flip the ring red. */}
          <AvatarOrbit
            sidecarStatus={(() => {
              const raw = String(sidecarStatus);
              if (raw === "ready") return "ready";
              if (raw === "failed") return "failed";
              return "starting";
            })()}
            notificationCount={0}
            tier={userTier}
            onOpen={() => setPanelOpen(true)}
          />
        </header>

      <main className="flex flex-1 items-stretch justify-center overflow-y-auto px-6 py-10">
        {/* v0.6.36 — Every nav-driven room renders inside one Cockpit so
            cursor parallax + perspective are shared, and every page swaps
            with the same camera-dolly entry via RoomShell. Pipeline states
            (lifting / downloading / failure cards) stay raw inside the
            cockpit — they ignore the parallax CSS vars and shouldn't tilt
            during heavy progress UIs.
            v0.7.48 — Parallax listener is scoped to the two views that
            actually render workstation tiles consuming --cockpit-px/py
            (Results + Empty / Workstation). On Library / Earn / Settings /
            Schedule / Learn the listener used to fire on every pointer
            event for no visual gain — smoothness diagnostic finding #2. */}
        <Cockpit active={view.kind === "results" || view.kind === "empty"}>
        {/* v0.6.39 — Ambient bottom-edge ticker rotating rank / next-scheduled
            / today's leader signals. Fixed-position; below modals (z-20). */}
        <SignalLine />
        {view.kind === "library" && (
          <RoomShell roomKey="library" align="top">
            <LibraryTab
              onOpenProject={(project) => setView({ kind: "results", project })}
              onGoToWorkstation={() => setView({ kind: "empty" })}
            />
          </RoomShell>
        )}

        {view.kind === "learn" && (
          <RoomShell roomKey="learn" align="top"><LearnTab /></RoomShell>
        )}

        {view.kind === "community" && (
          <RoomShell roomKey="community" align="top"><CommunityTab /></RoomShell>
        )}

        {view.kind === "schedule" && (
          <RoomShell roomKey="schedule" align="top">
            <SchedulePage
              onOpenWorkspace={() => setView({ kind: "empty" })}
              initialSub={scheduleInitialSub}
            />
          </RoomShell>
        )}

        {view.kind === "earn" && (
          <RoomShell roomKey="earn" align="top">
          <EarnTab
            userTier={userTier}
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
          </RoomShell>
        )}

        {view.kind === "bounty-setup" && (
          <RoomShell roomKey="bounty" align="top">
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
          </RoomShell>
        )}

        {view.kind === "empty" && bootChecked && (
          // v0.6.36 — Workstation now shares the cockpit-wide perspective.
          // RoomShell handles the camera-dolly entry; UploadPortal mounts
          // outside the shell so its layoutId morph from the Create tile
          // works across the AnimatePresence boundary.
          <RoomShell roomKey="workstation">
            <WorkstationRoom
              onCreate={() => setUploadPortal({ open: true, intent: "clips" })}
              onImport={() => void handleImportDirect()}
              onThumbnails={() => {
                // v0.7.31 — Opens the ThumbnailStudio surface. No project
                // context yet from the empty state, so we pass slug="" — the
                // studio shows the Brand + Identity wizards (per-user setup
                // that survives across projects) and gates the Cover Pack +
                // Generate flows behind "open a project first."
                setThumbnailStudio({
                  open: true,
                  slug: "",
                  projectName: "Thumbnail setup",
                  clips: [],
                });
              }}
              onScript={() => {
                // v0.7.7 ship-lens fix #5 — Script tile now opens the same
                // UploadPortal modal in `intent: "script"` so the URL Go
                // button routes to _onLiftTranscript (transcript only, no
                // clip cutting). Previously this opened the portal in
                // default (clips) mode, so the tile promised
                // "transcript · captions ready" and silently ran the clips
                // pipeline instead — Daniel's #5 punch-list bug.
                setUploadPortal({ open: true, intent: "script" });
              }}
              dragHoverActive={dragHoverActive}
              dropError={dropError}
              userTier={userTier}
              importing={importing}
            />
          </RoomShell>
        )}
        {view.kind === "empty" && (
          <UploadPortal
            open={uploadPortal.open}
            intent={uploadPortal.intent}
            onClose={() => setUploadPortal((u) => ({ ...u, open: false }))}
            onPickFile={pickFile}
            onPasteUrl={onPasteUrl}
            // v0.7.7 ship-lens fix #5 — Script-mode URL handler. liftTranscript
            // sets view to "lifting" → "lifted" → TranscriptResult render.
            // Same existing routing that the original Script-mode lift used
            // before the surface was retired.
            onPasteUrlScript={(url: string) => void _onLiftTranscript(url)}
            dragHoverActive={dragHoverActive}
          />
        )}

        {view.kind === "choosing-intent" && (
          <IntentPicker
            source={view.source}
            brief={view.brief}
            onPick={onIntentPicked}
            onCancel={() => setView({ kind: "empty" })}
            // P1 #11 — "change URL" escape hatch. If the user pasted the wrong
            // link they shouldn't have to back-button to empty and reopen the
            // portal; one tap routes them back into Create with the URL
            // pre-filled-as-empty for a clean retype.
            onChangeSource={() => {
              setView({ kind: "empty" });
              // v0.7.7 — change-source always returns to clips mode; the
              // IntentPicker only ever shows for the clips pipeline, so
              // "change URL" routes back to the same launcher.
              setUploadPortal({ open: true, intent: "clips" });
            }}
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
              // P0 #4 — frontend dispatches BOTH cancel signals:
              //   • lift_cancel RPC → ~/LiquidClips/.lift_cancel marker used
              //     by ingest_url + lift_transcript polling loops.
              //   • cancelRequestedRef → between-stage guard in
              //     runRemainingStages so the next stage never starts.
              cancelRequestedRef.current = true;
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
            // v0.7.34 — Retry preserves script-mode intent. The lift-failed
            // view is only entered from _onLiftTranscript (transcript pipeline),
            // so retry must re-enter the SAME pipeline. Previously routed
            // through onPasteUrl which silently re-ran the clips pipeline —
            // users got clips out of a Script-mode retry, which is the wrong
            // pipeline for what they originally asked for.
            onRetry={() => void _onLiftTranscript(view.url)}
            onDismiss={() => setView({ kind: "empty" })}
            subject={`Liquid Clips — lift failed for ${view.url}`}
          />
        )}

        {view.kind === "downloading" && (
          <JuniorLoader
            message="Fetching from the source"
            detail={formatDownloadDetail(view.url, view.progress)}
            percent={view.progress?.percent ?? undefined}
            downloadedBytes={view.progress?.downloaded_bytes ?? undefined}
            onCancel={() => {
              // P0 #4 — same dual-marker dispatch as the lifting Cancel.
              // ingest_url polls ~/LiquidClips/.lift_cancel; the ref guards
              // the between-stage loop in case the ingest already finished.
              cancelRequestedRef.current = true;
              void sidecar.liftCancel().catch(() => undefined);
              setView({ kind: "empty" });
            }}
            onRetry={() => void runPipelineFromUrl(view.url, "", view.intent)}
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
                  // In-app upgrade — opens the Clerk-routed /upgrade page in
                  // a centered Tauri child webview so the user never leaves
                  // Liquid Clips for billing. On close the panel refreshes
                  // /sync; if Stripe Checkout succeeded the quota wall lifts.
                  void import("./components/auth/useAuthPanel").then((m) =>
                    m.openAuthPanel("upgrade"),
                  );
                }}
                className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white hover:bg-fuchsia-bright"
              >
                Continue on Solo · $29.99/mo
              </button>
              {/* P1 #12 — "I've upgraded — recheck" escape hatch. The marketing
                  upgrade page opens in the browser; once they come back, a
                  single button re-pulls /sync and routes them past the wall
                  if their tier flipped paid. No restart, no manual cache flush. */}
              <button
                onClick={async () => {
                  try {
                    const m = await import("./lib/backend");
                    const [s, me] = await Promise.all([
                      m.syncStatus(),
                      // v0.7.7 ship-lens fix #9 — legacy shim; recheck only
                      // needs `.email` for the admin fallback.
                      m.meStatusLegacy().catch(() => null),
                    ]);
                    // Same three-signal admin embed used at boot + useTier.
                    // Without this, the recheck handler would strip admin
                    // back to s.tier (which could still be "free" if the
                    // user's row hasn't been migrated yet).
                    const isAdmin =
                      s?.admin_override === true ||
                      s?.tier === "autopilot" ||
                      isAdminEmail(me?.email);
                    const nextTier = isAdmin ? "agency" : normalizeTier(s?.tier ?? null);
                    setUserTier(nextTier);
                    setRemainingExports(isAdmin ? null : (s?.remaining_exports ?? null));
                    // Anything other than free unlocks — solo, pro, agency
                    // all bypass the 100-export wall.
                    if (nextTier && nextTier !== "free") {
                      setView({ kind: "empty" });
                    }
                  } catch {
                    /* recheck is best-effort — user can hit it again */
                  }
                }}
                className="rounded-full border border-fuchsia bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:bg-fuchsia-soft/30"
              >
                I&apos;ve upgraded — recheck
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
            // P1 #10 — pipe through humanError so raw Python tracebacks don't
            // bleed into a customer-facing FailureCard. Falls back to the raw
            // string if no pattern matches (better ugly than blank).
            error={humanError(view.error)}
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
            onOpenSettings={() => {
              // v0.7.45 P3.c — If the channel-connect event already routed
              // us to Schedule → Channels, don't also open Settings.
              if (channelConnectPendingRef.current === true) return;
              setSettingsOpen(true);
            }}
          />
        )}
        </Cockpit>
      </main>

      {/* v0.6.18 — Floating "rendering" pill. Visible whenever a pipeline is
          in flight AND the user has navigated away from the running view.
          Click returns to the WorkingStage where they left off.
          P0 #7 — Now also visible during the *downloading* and *lifting*
          phases (before runningProject is set), using view.url as the label.
          Previously the pill only appeared once runStage started, so a user
          who navigated away mid-ingest lost their re-entry. */}
      {(() => {
        const inFlightFromIngest = view.kind === "downloading" || view.kind === "lifting";
        const inFlightFromStages =
          !!runningProject &&
          view.kind !== "running" &&
          view.kind !== "results" &&
          view.kind !== "failed" &&
          view.kind !== "canceled" &&
          view.kind !== "downloading" &&
          view.kind !== "lifting";
        // Show the pill when stages are in flight AND the user looked away,
        // OR (new) during the ingest/lift phase if they navigated off it.
        // The ingest phase pill stays on the same view since downloading IS
        // the running surface — but if they walked off it via the sidebar,
        // the pill in the *destination* view needs to show. We can't easily
        // detect navigation here, so we always show it during ingest/lift.
        if (!inFlightFromStages && !inFlightFromIngest) return null;
        const label = inFlightFromIngest
          ? ("url" in view ? view.url : "in progress")
          : runningStage
            ? `${runningStage} stage`
            : "in progress";
        const onClick = () => {
          if (runningProject) {
            setView({
              kind: "running",
              project: runningProject,
              currentStage: runningStage ?? "ingest",
            });
          }
          // For downloading/lifting we're already on the right surface; the
          // pill is a no-op return so it stays visible but doesn't move us.
        };
        return (
          <button
            type="button"
            onClick={onClick}
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-3 rounded-full border border-fuchsia bg-paper-elev/95 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink shadow-[0_0_28px_rgba(255,26,140,0.45)] backdrop-blur-md transition-colors hover:bg-paper-elev"
            aria-label="Return to rendering pipeline"
          >
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fuchsia opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-fuchsia" />
            </span>
            <span className="text-fuchsia">rendering</span>
            <span className="text-text-tertiary">·</span>
            <span className="truncate max-w-[200px] normal-case tracking-normal text-text-secondary">
              {label}
            </span>
            <span className="text-fuchsia">return →</span>
          </button>
        );
      })()}

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

      {/* v0.7.8 S5 — mid-session sidecar crash banner. Auto-mounts when
          subscribeSidecarDied fires; auto-dismisses on the next successful
          sidecar.ping() landed via the 4s heartbeat above; Restart button
          fires the tauri-plugin-process relaunch so the user can short-
          circuit the recovery without quitting from the menu bar. */}
      {engineRestartReason && (
        <div className="flex items-center justify-between border-t border-fuchsia-soft bg-fuchsia-soft/40 px-6 py-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
            ● Engine restarted{engineRestartReason.exit_code != null ? ` (exit ${engineRestartReason.exit_code})` : ""} — features may need a moment
          </div>
          <button
            onClick={async () => {
              if (engineRestarting) return;
              setEngineRestarting(true);
              try {
                const m = await import("@tauri-apps/plugin-process");
                await m.relaunch();
              } catch {
                /* relaunch is best-effort; user can still quit + reopen */
              } finally {
                setEngineRestarting(false);
              }
            }}
            disabled={engineRestarting}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
          >
            {engineRestarting ? "Restarting…" : "Restart Liquid Clips"}
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

      {/* v0.7.49 — "installing" used to render NOTHING (the bug Daniel
          hit on v0.7.48: download bar disappeared, then silence, then he
          closed the app thinking it was broken). Full-screen blocking
          overlay makes it impossible to miss + a "Restart now" fallback
          covers the case where Tauri's relaunch() hangs. */}
      {updateBanner.kind === "installing" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/85 backdrop-blur-sm">
          <div className="relative max-w-[440px] rounded-2xl border border-fuchsia bg-paper p-8 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
            <span className="cockpit-tile-corner-tl" aria-hidden />
            <span className="cockpit-tile-corner-tr" aria-hidden />
            <span className="cockpit-tile-corner-bl" aria-hidden />
            <span className="cockpit-tile-corner-br" aria-hidden />
            <div className="flex items-start gap-4">
              <Loader2 className="mt-1 h-10 w-10 shrink-0 animate-spin text-fuchsia" strokeWidth={2} />
              <div>
                <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  Installing the update…
                </h2>
                <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-secondary">
                  Liquid Clips will restart automatically in a moment. If nothing happens in 15 seconds, click Restart now.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await relaunch();
                    } catch (e) {
                      console.warn("[update] manual relaunch failed", e);
                      window.dispatchEvent(
                        new CustomEvent("lc:toast", {
                          detail: {
                            kind: "error",
                            message: "Couldn't restart — quit the app from the menu bar and reopen it.",
                          },
                        }),
                      );
                    }
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-semibold text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
                >
                  Restart now
                </button>
              </div>
            </div>
          </div>
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
      </div>

      <ThumbnailStudio
        open={thumbnailStudio.open}
        onClose={() => setThumbnailStudio((prev) => ({ ...prev, open: false }))}
        slug={thumbnailStudio.slug}
        projectName={thumbnailStudio.projectName}
        clips={thumbnailStudio.clips}
        userTier={userTier}
        onOpenSettings={() => {
          setThumbnailStudio((prev) => ({ ...prev, open: false }));
          setSettingsOpen(true);
        }}
        onCoverChanged={() => {
          // v0.7.31 — broadcast so LibraryTab re-fetches list_projects and the
          // wall tile picks up the new cover (sidecar.py now prefers
          // cover_choice.json over the auto rank-1 thumb).
          window.dispatchEvent(new CustomEvent("lc:library-refresh"));
        }}
      />

      {settingsOpen && (
        <Settings
          onOpenSchedule={(subtab) => {
            setSettingsOpen(false);
            setScheduleInitialSub(subtab);
            setView({ kind: "schedule" });
          }}
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

      {/* v0.6.35 — Avatar HUD panel. Mounted at root so it can be summoned
          from any view (the orbit button itself lives in the header). The
          panel handles its own backdrop + Esc dismiss. */}
      <AvatarPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        tier={userTier}
        refreshing={refreshingApp}
        onRefresh={() => void refreshApp()}
        onOpenNotifications={() => setInboxOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSchedule={() => { setScheduleInitialSub(undefined); setView({ kind: "schedule" }); }}
        onOpenEarn={() => setView({ kind: "earn" })}
        onSignOut={
          // v0.6.38 — Real in-place sign-out (was opening Settings as a
          // proxy). Mirrors the Settings sign-out flow: confirm, clear
          // LICENSE_JWT in keychain, bounce to FirstRun. Confirm modal lives
          // at the root render below so the AvatarPanel can unmount without
          // killing the dialog mid-RPC.
          signedIn ? () => setConfirmSignOutOpen(true) : undefined
        }
      />
      {/* NotificationBell is still referenced from a few legacy callers (Earn
          empty state etc.); leaving the import in place even though the
          cockpit header no longer surfaces it directly. */}
      {false && <NotificationBell onOpen={() => setInboxOpen(true)} />}
      {/* Invaders overlay — portals to document.body so it's not affected by
          MainShell padding when the browse panel is open. Triggered manually
          from JuniorLoader / WorkingStage; auto-closes when the pipeline
          reaches a terminal state (see autoclose effect at App top). */}
      <InvadersOverlay />
      {/* ship-lens v0.7.13 T1.1 — Root-mounted toast that survives view
          transitions. handleImportDirect calls setDropError("Imported N
          clip…") AFTER setView({ kind: "results" }); the WorkstationRoom-
          local dropError surface unmounts the moment view flips, so the
          success cue was invisible pre-fix. GlobalToast lives at App root
          and renders for every view, so the same dropError state drives
          both the inline WorkstationRoom hint (on empty) AND a persistent
          bottom-right pill (everywhere else). Tone branches on the message
          prefix — "Imported" → fuchsia success, anything else → red error.
          The 4s auto-clear in the dropError useEffect dismisses both
          surfaces together. */}
      <GlobalToast message={dropError} />
      {/* ship-lens v0.7.13 T1.2 — OnboardingOverlay now gated on
          view.kind === "empty". Pre-fix a fresh user mid-import (empty →
          importReadyClips → results) saw the welcome scrim painted over
          ResultsGrid because showOnboarding rendered regardless of view.
          The overlay belongs to the launchpad surface, not to the
          workbench — gating it on "empty" keeps every other surface
          uncovered. */}
      {showOnboarding && view.kind === "empty" && (
        <OnboardingOverlay
          onComplete={completeOnboarding}
          onOpenSettings={() => setSettingsOpen(true)}
          onTrySample={() => onPasteUrl(SAMPLE_ONBOARDING_URL, "")}
        />
      )}
      {/* ship-lens v0.7.14 K-γ mount — StudioTour overlay. Gated on the
          contract hook's hydrate + done flags so we only mount once the
          keychain read has resolved AND the user has not finished the
          tour before. tourStepId tracks the contract's stepIdx — null
          means skipped/finished/never-begun, so we additionally check it
          to unmount the moment Skip/Finish runs (CoachMark's own state
          would otherwise re-render the next step until the keychain
          write settles). Suppressed during OnboardingOverlay so two
          welcome surfaces never stack on the empty view. */}
      {!tourHydrating &&
        !tourDone &&
        tourStepId !== null &&
        !(showOnboarding && view.kind === "empty") && (
          <StudioTour
            onComplete={() => {
              void finishTour();
            }}
            onSkip={() => {
              void skipTour();
            }}
          />
        )}
      {/* Achievement unlock toasts (sprint #18a) — global mount, listens on
          the achievements bus, slides in for ~5s when a badge unlocks. */}
      <AchievementToast />
      {/* Sprint #14c — Submission portal modal for the Minecraft Story Clip
          Challenge (or any future wrapped campaign). Triggered from the
          MinecraftChallengeCard in the empty-workspace view. */}
      {submissionPortalOpen && (
        <SubmissionPortal onClose={() => setSubmissionPortalOpen(false)} />
      )}
      {/* In-app auth + upgrade webview. Singleton — any component can dispatch
          via openAuthPanel("upgrade" | "sign-in" | ...). On close we refresh
          /sync so a successful checkout / sign-in flips the tier immediately
          without waiting for the next window-focus poll. */}
      <GlobalAuthPanel />
      {/* Branded confirm dialogs — replace the two prior native confirm()
          calls (drag-drop pipeline replace + AvatarPanel sign-out). Mounted
          at root so neither one unmounts when its origin surface goes away. */}
      <ConfirmDialog
        open={confirmReplacePipeline !== null}
        tone="neutral"
        title="Replace the running pipeline?"
        body={
          <>
            A pipeline is already running. Drop this file in and your in-flight
            work will be lost.
          </>
        }
        confirmLabel="Replace pipeline"
        onCancel={() => {
          confirmReplacePipeline?.resolve(false);
          setConfirmReplacePipeline(null);
        }}
        onConfirm={() => {
          confirmReplacePipeline?.resolve(true);
          setConfirmReplacePipeline(null);
        }}
      />
      <ConfirmDialog
        open={confirmSignOutOpen}
        tone="destructive"
        title="Sign out and forget your API keys on this Mac?"
        body={
          <>
            We&apos;ll clear your Liquid Clips session AND every API key you
            stored in the keychain on this machine — OpenAI, Anthropic, Whop,
            Pexels, Pixabay, Giphy. Useful if you&apos;re handing the Mac to
            someone else. You&apos;ll paste your keys back in next time you
            sign in.
          </>
        }
        confirmLabel="Sign out + clear keys"
        busy={signingOut}
        onCancel={() => { if (!signingOut) setConfirmSignOutOpen(false); }}
        onConfirm={async () => {
          if (signingOut) return;
          setSigningOut(true);
          // v0.7.8 S1 — atomic wipe. Single secret-delete only cleared the
          // license; the BYO API keys + onboarded flag stayed on disk, so a
          // second user inheriting the Mac picked up the prior user's OpenAI
          // bill or could re-open the app already "onboarded" with no fresh
          // welcome. Promise.all covers the whole inventory in parallel and
          // never aborts a single delete on one failure — best-effort wins.
          await performAtomicSignOutWipe();
          setSignedIn(false);
          setView({ kind: "first-run" });
          setConfirmSignOutOpen(false);
          setSigningOut(false);
        }}
      />
      {/* v0.7.47 — App-wide toast bus listener. Lives INSIDE MainShell so
          the fixed-positioned toasts overlay the workspace correctly; the
          host listens for `lc:toast` window events dispatched from anywhere
          in the tree (EarnPanelMount, App drop handlers, future surfaces). */}
      <GlobalToastHost />
    </MainShell>
  );
}

function GlobalAuthPanel() {
  const { mode, open } = useAuthPanel();
  return (
    <AuthPanel
      open={open}
      mode={mode ?? "upgrade"}
      onClose={() => {
        closeAuthPanel();
        // Pull tier from backend — Clerk's Stripe Checkout success path
        // bounces back to /dashboard; admin_override + new tier land here.
        // Parallel /sync + /me so the email-based admin fallback works even
        // if the backend hasn't redeployed.
        void import("./lib/backend")
          .then(async (m) => {
            const [s, me] = await Promise.all([
              m.syncStatus(),
              // v0.7.7 ship-lens fix #9 — legacy shim; AuthPanel completion
              // only needs `.email` for the admin override.
              m.meStatusLegacy().catch(() => null),
            ]);
            return { s, me };
          })
          .then(({ s, me }) => {
            if (!s && !me) return;
            const isAdmin =
              s?.admin_override === true ||
              s?.tier === "autopilot" ||
              isAdminEmail(me?.email);
            const tier = isAdmin ? "agency" : (s?.tier ?? "free");
            // App.tsx's useEffect listener picks this up and calls
            // setUserTier — keeps GlobalAuthPanel decoupled from App's
            // state without leaving the event as a deadletter.
            setUserTierGlobalEvent(tier);
          })
          .catch(() => undefined);
      }}
    />
  );
}

// Tiny dispatcher — lets the inner GlobalAuthPanel push a tier update without
// owning App's state directly. App listens for the same event in its main
// useEffect and reflects it via setUserTier.
function setUserTierGlobalEvent(tier: string) {
  window.dispatchEvent(new CustomEvent("lc:tier-refresh", { detail: { tier } }));
}

// ship-lens v0.7.13 T1.1 — Root-level toast. Lives outside Cockpit + every
// view branch so it survives setView() transitions (in particular the
// empty → results swap that handleImportDirect triggers AFTER it sets the
// success message). Tone branches on the copy prefix: "Imported …" reads
// as a success (fuchsia + CheckCircle2); everything else is treated as an
// error (red + AlertTriangle). The 4s auto-clear lives in the dropError
// useEffect — both this and the WorkstationRoom inline surface dismiss
// together when the timer fires.
function GlobalToast({ message }: { message: string | null }) {
  if (!message) return null;
  const isSuccess = message.startsWith("Imported");
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle;
  const containerClass = isSuccess
    ? "border-fuchsia bg-paper-elev/95 text-ink shadow-[0_0_28px_rgba(255,26,140,0.45)]"
    : "border-[var(--color-danger)] bg-paper-elev/95 text-[var(--color-danger)] shadow-[0_0_28px_rgba(220,38,38,0.4)]";
  const iconClass = isSuccess ? "text-fuchsia" : "text-[var(--color-danger)]";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 inline-flex max-w-[420px] items-center gap-2.5 rounded-full border bg-paper-elev/95 px-4 py-2.5 font-mono text-[11px] backdrop-blur-md ${containerClass}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} strokeWidth={2} />
      <span className="truncate normal-case tracking-normal">{message}</span>
    </div>
  );
}

// v0.7.8 S1 — Atomic sign-out wipe. Centralised so both the AvatarPanel
// confirm modal and the Settings drawer sign-out call the same primitive
// and can't drift. Wipes ALL sensitive keychain entries (the prior single-
// secret delete left BYO OpenAI / Anthropic / Whop tokens lying around for
// the next user of the Mac), clears the avatar Zustand store so the orbit
// face doesn't bleed into the next session, and resets telemetry consent
// to its opt-out default — re-opting in is a positive action the next
// signed-in user should take, not an inherited toggle. ALL deletes run in
// parallel; one failure won't poison the rest because each leg has its
// own `.catch(() => undefined)` swallow.
//
// EXHAUSTIVENESS — `SECRETS_TO_WIPE_ON_SIGN_OUT` is the contract. If a new
// secret name is added to `SecretName` in lib/sidecar.ts, add it here too.
const SECRETS_TO_WIPE_ON_SIGN_OUT: SecretName[] = [
  "LICENSE_JWT",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "JUNIOR_WHOP_TOKEN",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "GIPHY_API_KEY",
  "LIQUIDCLIPS_ONBOARDED",
];

export async function performAtomicSignOutWipe(): Promise<void> {
  await Promise.all([
    ...SECRETS_TO_WIPE_ON_SIGN_OUT.map((name) =>
      sidecar.secretDelete(name).catch(() => undefined),
    ),
    // Avatar store clear — the orbit face is technically derivable from the
    // backend's /me row, but the local PNG also lives in ~/LiquidClips/avatar.png
    // and the Zustand store will paint the prior user's face until refresh().
    // useAvatar.getState().clear() handles both the disk delete and the
    // store reset in one call.
    useAvatar.getState().clear().catch(() => undefined),
  ]);
  // Reset telemetry to opt-out — Mac handoff posture. The next user
  // explicitly opts in via Settings → About → Send anonymous telemetry.
  try {
    setTelemetryConsent(false);
  } catch {
    /* best-effort */
  }
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
      {/* v0.6.3 — Aurora ambient depth replaces the v0.5.0 OASIS bleed.
          See src/components/effects/AuroraBackground.tsx + .lc-aurora in
          src/index.css. Mounted as the bottom layer so every other
          surface composites cleanly on top. */}
      <AuroraBackground />
      {/* v0.6.0 — flex-row so the SideNav can sit as the left column. The
          right column re-imposes flex-col so the existing header + main
          stack stays vertical. */}
      <div
        className="relative flex h-full flex-row text-ink transition-[padding] duration-200"
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

// v0.6.0 — NavTab removed; the rail items live in src/components/nav/SideNav.tsx
// and SideNavItem.tsx now. The horizontal nav strip was replaced by the
// fixed 64px left rail (see MainShell flex-row change below).
