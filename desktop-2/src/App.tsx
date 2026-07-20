import { lazy, Suspense, useEffect, useState } from "react";
import { flowTrace } from "./lib/flowTrace";
import { runtimeVersionSync } from "./lib/useRuntimeVersion";
import { FLOW_IDS } from "./contracts/flowRegistry";
import { BrowseOverlay, BrowserScrim } from "./components/browser";
import { AgencyWelcomeOverlay } from "./overlays/AgencyWelcome";
import {
  initAuthStorage,
  hasJwt,
  hasJwtKeychainPresence,
  resumeJwtFromKeychainForAuthAction,
  reconcileKeychainOnBoot,
} from "./lib/authStorage";
import { useAuth } from "./lib/useAuth";
import { attachQA, qaGateEnabled } from "./lib/qa";
import { mountDeepLinkSubscriber, type DeepLinkBootHandle } from "./lib/deepLinkBoot";
import { HardUpdateGate } from "./components/update/HardUpdateGate";
import { useActivation } from "./lib/activation";
// SPRINT_FINAL §1H test hook (Max · 2026-07-07) · Playwright bus seam
// for the AssetRansomPaywall. Dev-only · tree-shaken in prod.
import { AssetRansomPaywallTestHook } from "./components/paywall/AssetRansomPaywallTestHook";
// 2026-07-17 · Liquid Studio · free-preview disclosure card. Uses
// the same modal portal + Watchdog pattern as the existing ransom
// paywall; only mounts when the sidecar emits the disclosure event.
import { FreePreviewDisclosureCard } from "./components/paywall/FreePreviewDisclosureCard";
import { FounderMoments } from "./components/founder/FounderMoments";
// 2026-07-17 · Liquid Studio · reserve-refusal routing hook. Maps
// backend structured codes (free_bundle_used, allowance_exceeded,
// studio_unlimited_key_required) to existing paywall / setup surfaces.
import { useBillingRefusalRouter } from "./lib/billingRefusalRouter";
import { CampaignShellTestHook } from "./components/paywall/CampaignShellTestHook";
import { MembershipGate } from "./components/gate/MembershipGate";
// V1(b)-BOOT-RECONCILE 2026-07-20 · defence-in-depth for the Agency
// entitlement gate. Reconciles a stored `lc.mode="agency"` against
// the live /me.effective_tier — forces clipper when tier no longer
// qualifies. See src/components/ModeReconciler.tsx.
import { ModeReconciler } from "./components/ModeReconciler";
// Updater v2 · 2026-07-20 · fires runtime_ack_boot_healthy after a
// short delay so the Rust rollback trigger knows this boot mounted
// successfully. Missing acks over HEALTHY_BOOT_ATTEMPT_LIMIT boots =
// auto-rollback to LKG.
import { useRuntimeBootHealthyAck } from "./lib/runtimeHealthAck";
import { openSignInOrSignUpBridge, initQaMode } from "./lib/whopCheckout";
import { readSessionIdFromLaunch, clearFunnelSession } from "./lib/funnelSession";
import { AssistedScheduleMonitor } from "./design-os/schedule/AssistedScheduleMonitor";
// Watchdog Rollout · id-01 (2026-07-06) · wraps IntroSplash so a
// crash inside the boot sequence renders KadeRepairScreen instead of
// white-screen. Every failure dispatches an intercession event to
// HQ Admin for the Intercession LLM. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "./lib/watchdog";
// Track 2 (file upload) global consumer · subscribes to `source:drop`
// emitted by design-os/effects/DropOverlay so a file dropped onto ANY
// route (not just Create) drives the ingest pipeline. Previously the
// only listener lived inside CreateClipsRoute — drops fired anywhere
// else disappeared silently. Watchdog node pipeline/cp-18/drop-consumer.
import { GlobalDropConsumer } from "./lib/globalDropConsumer";
// AU-C-1 (2026-07-10) · normal runtime-bundle update pill. Sits
// alongside HardUpdateGate — the gate handles mandatory / security
// updates (full-viewport blocker), the beacon handles normal runtime
// bundle updates as a persistent bottom-right pill. See
// src/components/UpdateBeacon.tsx.
import { UpdateBeacon } from "./components/UpdateBeacon";
// Wave D1 · j015-runtime-update (2026-07-12) · Codex-model.
// Visible surfaces for the state machine that UpdateBeacon now
// drives. Mounted next to the transport-layer beacon so the
// Watchdog boundary still covers the whole update sub-tree.
import { UpdateReadyIndicator } from "./design-os/update/UpdateReadyIndicator";
import { RestartGate } from "./design-os/update/RestartGate";
import { EngineErrorBoundary } from "./design-os/components/EngineErrorBoundary";

/* LC-UI-P0-BOOT · Patch A · 2026-06-26
 *
 * Heavy components lazy-loaded so the initial JS chunk drops dramatically
 * and first paint lands immediately on a black brand stage instead of
 * waiting on the full app shell + intro splash + invaders game + auth
 * chrome to parse.
 *
 * Behaviour preserved · auth/storage/deeplink effects still run on App
 * mount · the conditional render logic in IntroSplash/AuthGate/FunnelGate
 * is unchanged · the only difference is each heavy module's bytes arrive
 * AFTER the first paint instead of blocking it. */
const AppShell = lazy(() => import("./shell/AppShell").then((m) => ({ default: m.AppShell })));
const IntroSplash = lazy(() => import("./overlays/IntroSplash").then((m) => ({ default: m.IntroSplash })));
const InvadersOverlay = lazy(() =>
  import("./overlays/invaders/InvadersOverlay").then((m) => ({ default: m.InvadersOverlay })),
);
// 2026-07-05 · 2.2.24 · sign-in surface pivot. The old in-app OAuth
// webview + rollback fallback + Mount #1 surface were all deleted.
// New flow: Whop's hosted checkout page IS the sign-in surface — user
// clicks "Sign in" in TopHud → default browser opens
// `whop.com/checkout/<founder_plan_id>` (see lib/whopCheckout.ts —
// currently `plan_svbzoXoT4oj6b`) → Whop redirects to backend
// `/whop/checkout-success` → 302 to `liquidclips://activate` deep link
// → activation.ts handleActivationUrl stores JWT. Zero in-app auth
// chrome. -1,600 LOC removed. See lib/whopCheckout.ts for the URL.
const ClaimScreen = lazy(() =>
  import("./design-os/routes/ClaimScreen").then((m) => ({ default: m.ClaimScreen })),
);
// Kade Welcome · post-splash clipper/agency path picker + activation
// recovery. Renders only when there's no JWT AND welcome hasn't been
// acked yet. Ships 2026-07-06 — resolves the login-fall-over cluster
// by giving guest clippers a value-first path and agency users a
// direct Whop checkout, and gives deep-link-failed users a paste-code
// recovery UI. See src/design-os/routes/WelcomeRoute.tsx.
const WelcomeRoute = lazy(() =>
  import("./design-os/routes/WelcomeRoute").then((m) => ({ default: m.WelcomeRoute })),
);

/* First-paint fallback · matches brand background so the screen is never
 * white. 2026-07-07 · cold-open lens P1-004 · previously an empty div with
 * no children, which on slow cold-parse looked like a hung shell (Daniel
 * called it "not cursor responsive"). Now shows a subtle status line so
 * the user knows the workbench is loading, not frozen. Still cheap — no
 * fonts, no images, no animation — just one small centred string. */
function BootFallback(): React.ReactElement {
  // Responsiveness polish · 2026-07-10 · swapped the plain "loading
  // workbench…" copy for the on-brand ring-clip-process loader.
  // Still cheap — SVG served from public/, spun via CSS keyframe
  // once mounted. Text remains for a11y (visually hidden).
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b10",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
      }}
    >
      <img
        src="/brand/loading/ring-clip-process.svg"
        alt=""
        aria-hidden="true"
        width={48}
        height={48}
        style={{
          animation: "lc-brand-spin 1.4s linear infinite",
          filter: "drop-shadow(0 0 8px rgba(255, 26, 140, 0.4))",
        }}
      />
      <span
        style={{
          color: "rgba(255,255,255,0.55)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "10px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
        }}
      >
        loading liquid clips
      </span>
      <style>{`
        @keyframes lc-brand-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          img[aria-hidden="true"] { animation: none; }
        }
      `}</style>
    </div>
  );
}

export function App() {
  // Dev-only escape hatch so headless screenshots can land on the main UI
  // without sitting through the 28.5s intro. Not exposed to users. QA mode
  // (VITE_LC_QA build / lc.qa.enabled localStorage / vite DEV) also skips
  // so deterministic snapshots see steady state instead of the splash.
  //
  // forceIntro=1 reverses the QA/DEV auto-skip so the splash test in
  // tests/e2e/splash-and-agency-palette.spec.ts can exercise the actual
  // mount path. Has no effect for real users (they would never set it).
  const _urlParams = new URLSearchParams(window.location.search);
  const _forceIntro = _urlParams.get("forceIntro") === "1";
  const skipIntro =
    !_forceIntro && (_urlParams.get("skipIntro") === "1" || qaGateEnabled());

  // 2026-07-17 · Route sidecar reserve refusals to the existing
  // paywall / setup surfaces. Idempotent subscription cleanup handled
  // inside the hook.
  useBillingRefusalRouter();
  // Updater v2 · fires runtime_ack_boot_healthy after mount so the
  // Rust rollback trigger sees a healthy boot. See useRuntimeBootHealthyAck.
  useRuntimeBootHealthyAck();
  const [splashAcked, setSplashAcked] = useState(skipIntro);
  const [splashReady, setSplashReady] = useState(false);

  useEffect(() => {
    flowTrace({
      flowId: FLOW_IDS.FLOW_000_APP_SHELL,
      sectionId: null,
      actionId: "app.mounted",
      status: "ok",
      // BUG-007 sweep · Wave B1 · runtime-truth (2026-07-12) — the shell
      // fallback is honest here because the flowTrace fires on first
      // mount, before the Tauri invoke has a chance to resolve. The pill
      // reader (TopHud + Settings + Diagnostics) surface the live
      // runtime-bundle version via `useRuntimeVersion()`.
      metadata: { version: runtimeVersionSync() },
    });
    // 2026-07-03 · Step 5-7 · telemetry bootstrap — installs the closed
    // envelope adapter + registers all four sinks (backend · desktop-error
    // · PostHog · Sentry). Import is lazy so a bootstrap failure never
    // blocks first paint.
    void import("./lib/telemetry/bootstrap")
      .then((m) => m.bootstrapTelemetry())
      .catch(() => {
        /* telemetry never blocks the app */
      });
    // Constellation Engine · start polling /hq/nodes/state every 30s
    // so pool config + admin-pushed overrides refresh without a client
    // restart. HQ can insert Railway pool members via the admin panel
    // and the client picks them up on the next tick.
    void import("./lib/watchdog")
      .then((m) => m.startInterceptionStatePolling())
      .catch(() => {
        /* constellation state polling is best-effort */
      });
    // QA-mode idempotent read of `?qa=1` URL param · sticks in localStorage
    // so the founder-checkout link swaps to the $2 test plan for
    // internal walk-throughs.
    initQaMode();
  }, []);

  // 2026-07-03 · Global client-error capture to AppData/client-diagnostics.log.
  // Surfaces the actual reason silent catches fire so we can diagnose
  // without opening WKWebView DevTools. See lib/diagBuffer.ts. Also logs
  // an "app.boot" line so we know the writer path is functioning.
  useEffect(() => {
    void import("./lib/diagBuffer").then((m) => {
      m.logDiag("app.boot", {
        // BUG-007 sweep · Wave B1 · same reasoning as flowTrace above.
        version: runtimeVersionSync(),
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
        online: typeof navigator !== "undefined" ? navigator.onLine : true,
      });
      const onErr = (e: ErrorEvent) => {
        m.logDiag("window.error", {
          message: e.message,
          filename: e.filename,
          line: e.lineno,
          col: e.colno,
        });
      };
      const onRej = (e: PromiseRejectionEvent) => {
        m.logDiagError("window.unhandledrejection", e.reason);
      };
      window.addEventListener("error", onErr);
      window.addEventListener("unhandledrejection", onRej);
      // Best-effort cleanup at unmount (StrictMode double-mount safe).
      (window as unknown as { __lcDiagBoot?: () => void }).__lcDiagBoot = () => {
        window.removeEventListener("error", onErr);
        window.removeEventListener("unhandledrejection", onRej);
      };
    }).catch(() => { /* diag never breaks the app */ });
    return () => {
      const fn = (window as unknown as { __lcDiagBoot?: () => void }).__lcDiagBoot;
      if (typeof fn === "function") fn();
    };
  }, []);

  // 2026-07-05 · ship-day walk fix · sidecar-readiness hold reduced
  // from 6000ms → 1500ms so cold-open lands the Continue button while
  // the brand moment is still on screen. Anything longer feels like a
  // forced pause. Users who want the full cinematic still see it via
  // the "Skip intro" button remaining latent; users who just installed
  // from a cold-email link don't lose 5 seconds.
  useEffect(() => {
    const t = window.setTimeout(() => setSplashReady(true), 1_500);
    return () => window.clearTimeout(t);
  }, []);

  // P1-1D-d · headless auth boot. Primes the JWT cache so authHeaders()
  // is correct from first render onward, and mounts the deep-link
  // subscriber so liquidclips://activate?token=…&challenge=… URLs route
  // through handleActivationUrl(). Both calls are async-IIFE'd so they
  // never block render. The Promise is intentionally fire-and-forget ·
  // cleanup captures the handle and disposes on unmount (covers React
  // StrictMode's double-effect in dev). No UI · no route gating · no
  // redirects · the activation state machine stays headless until P1-1E.
  useEffect(() => {
    let handle: DeepLinkBootHandle | null = null;
    let cancelled = false;
    void (async () => {
      try {
        await initAuthStorage();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[app-boot] initAuthStorage failed:", e);
      }
      // IG-014-B · 2026-07-18 · preemptive keychain reconciliation.
      // Runs AFTER initAuthStorage() so `memoryCache` is primed. If
      // localStorage says signed-out but the OS Keychain still holds a
      // stale LICENSE_JWT presence flag, silently purge it so the next
      // sign-in starts from a clean slate — no visible warning, no
      // Reset button click required. Wrapped in try/catch so boot never
      // breaks on this housekeeping call.
      try {
        await reconcileKeychainOnBoot();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[app-boot] reconcileKeychainOnBoot failed:", e);
      }
      // IG-014 cold-boot keychain resume. The presence command reads only
      // the plaintext boolean mirror, so a signed-out/fresh install never
      // prompts merely because localStorage is empty. We read the actual JWT
      // only when that mirror confirms a saved credential exists.
      if (!hasJwt() && await hasJwtKeychainPresence()) {
        try {
          await resumeJwtFromKeychainForAuthAction();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[app-boot] keychain resume failed:", e);
        }
      }
      try {
        const h = await mountDeepLinkSubscriber();
        if (cancelled) {
          // Effect tore down before mount resolved · dispose immediately.
          try { h.dispose(); } catch { /* noop */ }
        } else {
          handle = h;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[app-boot] mountDeepLinkSubscriber failed:", e);
      }
      // QA control surface · attaches window.__lcQA only when the local-QA
      // gate is open (VITE_LC_QA=true bundle, vite DEV, or lc.qa.enabled=1
      // localStorage). Never exposed in shipping user bundles.
      try {
        attachQA();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[app-boot] attachQA failed:", e);
      }
    })();
    return () => {
      cancelled = true;
      if (handle) {
        try { handle.dispose(); } catch { /* noop */ }
        handle = null;
      }
    };
  }, []);

  return (
    /* HardUpdateGate is the OUTERMOST wrapper · before the gate fires,
     * children render normally so the IntroSplash and rest of the boot
     * sequence proceed. If the Tauri updater reports a newer manifest,
     * the gate mounts a full-viewport blocker on top with no bypass
     * affordance · the only way forward is its primary CTA which
     * download + installs + relaunches. Browser preview (Vite dev /
     * Playwright) short-circuits to the children path so the e2e suite
     * is unaffected. */
    <HardUpdateGate>
      {/* V1(b)-BOOT-RECONCILE · runs as soon as /me hydrates. Invisible.
          See src/components/ModeReconciler.tsx for rationale. */}
      <ModeReconciler />
      <Suspense fallback={<BootFallback />}>
        {!splashAcked && (
          <Watchdog
            id="identity/id-01/intro-splash"
            label="First-launch intro splash"
            cluster="identity"
            source="src/App.tsx:225"
          >
            <IntroSplash
              ready={splashReady}
              failed={false}
              onContinue={() => setSplashAcked(true)}
            />
          </Watchdog>
        )}
        {splashAcked && (
          <WelcomeGate>
            <FunnelGate>
              <AuthGate>
                <>
                  <AppShell />
                  {/* Watchdog Rollout · mo-02 (2026-07-06) · schedule
                      notification fire. The monitor polls every 15s +
                      listens for @tauri-apps/plugin-notification onAction
                      · a crash inside the poll loop (or an unhandled
                      hook throw) renders KadeRepairScreen instead of
                      freezing the assisted-schedule walk-around. */}
                  <Watchdog
                    id="money/mo-02/schedule-notification-fire"
                    label="Schedule notification fire (walk-around · native OS notification)"
                    cluster="money"
                    source="src/design-os/schedule/AssistedScheduleMonitor.tsx"
                  >
                    <AssistedScheduleMonitor />
                  </Watchdog>
                  {/* Track 2 (file upload) · Watchdog Rollout · cp-18
                      (2026-07-07) · shell-level source:drop consumer.
                      DropOverlay emits `source:drop` on native drag-drop,
                      but before this the ONLY subscriber lived inside
                      CreateClipsRoute — so any drop from Home /
                      Workstation / Earn / Settings fired into the void.
                      Mounts here (post splashAcked + welcomeAcked +
                      authed) so drops only route through once the user
                      is truly inside the app. See
                      src/lib/globalDropConsumer.tsx. */}
                  <GlobalDropConsumer />
                  {/* AU-C-1 (2026-07-10) · normal runtime-bundle update
                      pill. HardUpdateGate handles mandatory updates
                      (full-viewport blocker); UpdateBeacon handles
                      normal runtime hot-swap as a persistent
                      bottom-right pill that reads `runtime_info` + polls
                      `runtime_check_now`. Hidden during an active clip
                      run. Watchdog wrap so a Tauri-invoke throw (missing
                      command, browser preview) surfaces
                      KadeRepairScreen instead of white-screening the
                      shell. See src/components/UpdateBeacon.tsx. */}
                  <Watchdog
                    id="system/shell-update-beacon"
                    label="Update beacon (normal runtime bundle)"
                    cluster="system"
                    source="src/components/UpdateBeacon.tsx"
                  >
                    <EngineErrorBoundary route="shell" component="UpdateBeacon">
                      <UpdateBeacon />
                      {/* Wave D1 · j015-runtime-update — visible
                          surfaces driven by updateJourney.ts.
                          UpdateReadyIndicator = soft pill for
                          non-critical stage OR critical-deferred.
                          RestartGate = mandatory blocking modal for
                          gate state. Both no-op via null render when
                          the journey isn't in the matching state, so
                          it's safe to keep them mounted alongside
                          the transport-layer beacon. */}
                      <UpdateReadyIndicator />
                      <RestartGate />
                    </EngineErrorBoundary>
                  </Watchdog>
                  {/* P0 first-run access · shell-before-Whop (2026-07-08).
                   *  MembershipGate mounts here so it renders AFTER the
                   *  shell + settle window. Free-tier users with no active
                   *  subscription see a dismissible ActivateFounderPanel
                   *  that opens the Whop iframe INSIDE the app · Whop is
                   *  never the first gate. See
                   *  src/components/gate/MembershipGate.tsx. */}
                  <MembershipGate />
                </>
              </AuthGate>
            </FunnelGate>
          </WelcomeGate>
        )}
        <InvadersOverlay />
        {/* Browser overlay (Lane 1) — never globally mounted; each component
            returns null unless the store says open. Kept eager · they're
            guard-rendered to null and add ~2KB. */}
        <BrowserScrim />
        <BrowseOverlay />
        {/* Sprint E · Agency welcome first-run modal. Guard-rendered to
            null when either (a) not agency-tier, (b) already seen, or
            (c) VITE_AGENCY_WELCOME_DISABLED is set. Never blocks the
            app — user can dismiss without a CTA. */}
        {splashAcked && <AgencyWelcomeOverlay />}
      </Suspense>
      {/* SPRINT_FINAL §1H test hooks · mounted OUTSIDE the Suspense
       *  boundary 2026-07-07 so their bus subscriptions attach on the
       *  first paint, even while lazy AppShell / WelcomeRoute chunks
       *  are still compiling on cold Vite. Prior mount inside <AuthGate>
       *  (and later inside Suspense) raced the spec's page.evaluate —
       *  subscription hadn't landed yet. Both hooks self-guard on
       *  import.meta.env.DEV; production bundles tree-shake them. */}
      <AssetRansomPaywallTestHook />
      <CampaignShellTestHook />
      <FreePreviewDisclosureCard />
      <FounderMoments />
    </HardUpdateGate>
  );
}

/* UX-1-d · funnel handoff gate.
 *
 * A user who came from liquidclips.app arrives carrying a session id
 * (URL query / localStorage). We intercept BEFORE the auth gate · their
 * 10 clips are the reward and we show them immediately. From the claim
 * screen they can enter the workbench (continues through AuthGate) or
 * dismiss (also continues through AuthGate). Either way the session id
 * is cleared on departure so we don't re-claim on every cold launch.
 */
function FunnelGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const [sessionId, setSessionId] = useState<string | null>(() => readSessionIdFromLaunch());
  if (!sessionId) return <>{children}</>;
  return (
    <ClaimScreen
      sessionId={sessionId}
      onEnterWorkbench={() => {
        clearFunnelSession();
        setSessionId(null);
      }}
      onAbandon={() => {
        clearFunnelSession();
        setSessionId(null);
      }}
    />
  );
}

/* Kade Welcome gate (2026-07-06).
 *
 * Renders the WelcomeRoute post-splash when:
 *   (a) no license JWT is present, AND
 *   (b) welcome hasn't been acked in localStorage.
 *
 * Once the user picks a lane (or pastes a recovery code), we set the
 * `lc:welcome-acked` flag and unmount — the app continues through the
 * FunnelGate / AuthGate stack. If they picked Clipper, they land in
 * guest mode with a 10-clip quota tracked at `lc:guest-clips-remaining`.
 * Existing signed-in users skip the gate entirely on the first render.
 */
function WelcomeGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const [acked, setAcked] = useState<boolean>(() => {
    if (hasJwt()) return true;
    try {
      return window.localStorage.getItem("lc:welcome-acked") === "1";
    } catch {
      return true; // fail-open · never block the app on storage errors
    }
  });
  // 2026-07-07 · reactive to activation:complete. Prior version read
  // localStorage once at mount; when the $1 Whop deep-link fired mid-
  // session the JWT landed but this gate stayed stuck on the welcome
  // route. Now we subscribe to (a) the activation snapshot for the
  // normal handleActivationUrl path AND (b) the raw `activation:complete`
  // bus event for any surface that stores the JWT directly (e.g. the
  // LC-ID redeem path, or Playwright's test seam that seeds localStorage
  // + emits the bus event). Both routes flip acked.
  const activation = useActivation();
  useEffect(() => {
    if (acked) return;
    if (activation.status === "activated" || hasJwt()) {
      setAcked(true);
    }
  }, [activation.status, acked]);
  useEffect(() => {
    if (acked) return;
    let disposed = false;
    let offActivation: (() => void) | null = null;
    let offSignedIn: (() => void) | null = null;
    // IG-014-D · 2026-07-18 · LOCKED · WelcomeGate MUST subscribe to
    // BOTH `activation:complete` AND `auth:signed-in`. Prior version
    // only listened to `activation:complete` — the OTP sign-in path in
    // SimpleLoginPanel writes the JWT via setJwt() and emits
    // `auth:signed-in`, NOT `activation:complete` (the latter only fires
    // on the Whop deep-link / Clerk activation branch). That left users
    // stranded on the login screen with a valid JWT already stored,
    // waiting for a bus event that never came. Restarting the app
    // "fixed" it because `useState(() => hasJwt())` rechecked at mount.
    // The regression guard at App.WelcomeGate.test.ts pins both
    // subscriptions; the pre-commit lint at
    // `scripts/lint-session-reset-guard.sh` refuses commits that drop
    // either handler.
    const runAckCheck = () => {
      let welcomeAcked = false;
      try {
        welcomeAcked = window.localStorage.getItem("lc:welcome-acked") === "1";
      } catch { /* localStorage disabled — fall through */ }
      if (hasJwt() || activation.status === "activated" || welcomeAcked) {
        setAcked(true);
      }
    };
    void import("./design-os/bridge").then(({ bus }) => {
      if (disposed) return;
      offActivation = bus.on("activation:complete", runAckCheck);
      offSignedIn = bus.on("auth:signed-in", runAckCheck);
    });
    return () => {
      disposed = true;
      if (offActivation) try { offActivation(); } catch { /* noop */ }
      if (offSignedIn) try { offSignedIn(); } catch { /* noop */ }
    };
  }, [acked, activation.status]);
  // 2026-07-07 · cold-open lens P0-003 · WelcomeGate must return the
  // user to WelcomeRoute on mid-session sign-out. Previously acked only
  // flipped false on unmount, so signing out via TopHud / Settings left
  // the shell rendering anonymously with no route back to the login
  // surface. Subscribe to auth:signed-out and — provided the sign-out
  // path really did clear the JWT + welcome-acked flag (see P0-001/002
  // fixes in TopHud + Settings) — flip acked=false to re-mount
  // WelcomeRoute.
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | null = null;
    void import("./design-os/bridge").then(({ bus }) => {
      if (disposed) return;
      off = bus.on("auth:signed-out", () => {
        let welcomeAcked = false;
        try {
          welcomeAcked = window.localStorage.getItem("lc:welcome-acked") === "1";
        } catch { /* localStorage disabled — treat as unacked */ }
        if (!hasJwt() && !welcomeAcked) setAcked(false);
      });
    });
    return () => {
      disposed = true;
      if (off) try { off(); } catch { /* noop */ }
    };
  }, []);
  if (acked) return <>{children}</>;
  return <WelcomeRoute onDone={() => setAcked(true)} />;
}

/* 2026-07-05 · 2.2.24 · pass-through AuthGate.
 *
 * Since the sign-in surface pivot, the gate never blocks the shell.
 * hasJwt() still drives internal state for consumers that read
 * activation snapshots (Settings, WalletDetail), but the shell renders
 * unconditionally. Sign-in becomes a bus event: any surface fires
 * `auth:open-panel` → this component's handler opens Whop's hosted
 * checkout in the OS default browser → the deep-link handler stores
 * the JWT on return. `auth:signed-out` re-syncs local state.
 *
 * Network failure / 500 paths are explicitly NOT eviction-triggers ·
 * the activation orchestrator sets `degraded: true` and preserves the
 * JWT · hasJwt() stays true · the app keeps working. */
export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const activation = useActivation();
  // P0-3 (RC1 · 2026-07-11) — was `useState(!!getJwt())` + polling
  // useEffect keyed on activation state. `useAuth()` fans out from a
  // module-scope subscriber network so this gate re-renders on the same
  // tick as TopHud + SideNav + SplashLeaderboard.
  const { hasJwt: hasLicense } = useAuth();
  // Reference activation + hasLicense so React knows to re-run any
  // downstream effects when either flips. No local state needed.
  void hasLicense;
  void activation.status;
  // 2026-07-05 · 2.2.24 · anonymous free-tier flow. AuthGate is a
  // pass-through — the shell always renders. The "Sign in" entry point
  // lives in TopHud and any downstream CTA (paywall, wallet, feature
  // gate) fires `auth:open-panel` on the bus. That event opens Whop's
  // hosted checkout in the OS default browser. When the user completes
  // checkout, Whop 302s to the backend `/whop/checkout-success` which
  // in turn 302s to `liquidclips://activate?token=<jwt>` — the deep
  // link handler stores the JWT and this gate flips silently on the
  // next tick (useAuth() cache flips on auth:signed-in / activation:complete).
  useEffect(() => {
    let disposed = false;
    let offOpenPanel: (() => void) | null = null;
    void import("./design-os/bridge").then(({ bus }) => {
      if (disposed) return;
      offOpenPanel = bus.on("auth:open-panel", () => {
        // 2026-07-05 · ship-day walk fix · route to the sign-in-or-
        // sign-up bridge (account.liquidclips.app/connect-desktop)
        // instead of dropping the user straight onto a paid-signup
        // checkout page. Existing users now see the Clerk sign-in
        // widget · new users see the "Get a membership" banner ·
        // Whop-link members see the "Continue with Whop" pill.
        // Fire-and-forget · toast fallback lives inside the helper.
        void openSignInOrSignUpBridge();
      });
    });
    return () => {
      disposed = true;
      offOpenPanel?.();
    };
  }, []);
  void resumeJwtFromKeychainForAuthAction;
  return <>{children}</>;
}

// BUG-007 sweep · Wave B1 (2026-07-12) — the `declare const __APP_VERSION__`
// used to live here to seed the flowTrace + logDiag boot metadata blocks
// above. Both now consume `runtimeVersionSync()` from
// `./lib/useRuntimeVersion`, which is the single module in `src/**` that
// still names the Vite `__APP_VERSION__` global. Grep guard in
// `lib/useRuntimeVersion.test.ts` enforces the count.
