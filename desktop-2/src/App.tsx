import { lazy, Suspense, useEffect, useState } from "react";
import { flowTrace } from "./lib/flowTrace";
import { FLOW_IDS } from "./contracts/flowRegistry";
import { BrowseOverlay, BrowserScrim } from "./components/browser";
import {
  initAuthStorage,
  hasJwt,
  hasJwtKeychainPresence,
  resumeJwtFromKeychainForAuthAction,
} from "./lib/authStorage";
import { attachQA, qaGateEnabled } from "./lib/qa";
import { mountDeepLinkSubscriber, type DeepLinkBootHandle } from "./lib/deepLinkBoot";
import { HardUpdateGate } from "./components/update/HardUpdateGate";
import { useActivation } from "./lib/activation";
import { readSessionIdFromLaunch, clearFunnelSession } from "./lib/funnelSession";
import { AssistedScheduleMonitor } from "./design-os/schedule/AssistedScheduleMonitor";

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
const LoginOnboardingRoute = lazy(() =>
  import("./design-os/routes/LoginOnboarding").then((m) => ({ default: m.LoginOnboardingRoute })),
);
const ClaimScreen = lazy(() =>
  import("./design-os/routes/ClaimScreen").then((m) => ({ default: m.ClaimScreen })),
);

/* Tiny first-paint fallback · matches brand background so the screen is
 * never white. No fonts, no images, no animation · the cheapest possible
 * frame so paint can land while the heavy modules stream in. */
function BootFallback(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b10",
      }}
    />
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
  const [splashAcked, setSplashAcked] = useState(skipIntro);
  const [splashReady, setSplashReady] = useState(false);

  useEffect(() => {
    flowTrace({
      flowId: FLOW_IDS.FLOW_000_APP_SHELL,
      sectionId: null,
      actionId: "app.mounted",
      status: "ok",
      metadata: { version: __APP_VERSION__ ?? "0.8.0-shell" },
    });
  }, []);

  // Simulate sidecar readiness after the brand-moment hold.
  useEffect(() => {
    const t = window.setTimeout(() => setSplashReady(true), 6_000);
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
      <Suspense fallback={<BootFallback />}>
        {!splashAcked && (
          <IntroSplash
            ready={splashReady}
            failed={false}
            onContinue={() => setSplashAcked(true)}
          />
        )}
        {splashAcked && (
          <FunnelGate>
            <AuthGate>
              <>
                <AppShell />
                <AssistedScheduleMonitor />
              </>
            </AuthGate>
          </FunnelGate>
        )}
        <InvadersOverlay />
        {/* Browser overlay (Lane 1) — never globally mounted; each component
            returns null unless the store says open. Kept eager · they're
            guard-rendered to null and add ~2KB. */}
        <BrowserScrim />
        <BrowseOverlay />
      </Suspense>
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

/* P1-1G-c · boot/auth gate.
 *
 * Decision matrix:
 *   - hasJwt() === false                  → render LoginOnboarding (no license)
 *   - hasJwt() === true · status: any    → render app (network/500 degraded is
 *                                          tolerated because JWT survives those)
 *
 * Re-evaluates on every activation snapshot transition · so notifyAuthFailure
 * (which clears the JWT + emits "failed") flips the gate back to
 * LoginOnboarding on the same tick · and a successful activation flips
 * the gate the other way.
 *
 * Network failure / 500 paths are explicitly NOT eviction-triggers · the
 * orchestrator only sets `degraded: true` and preserves the JWT · which
 * means hasJwt() stays true · gate stays open. */
function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const activation = useActivation();
  const [hasLicense, setHasLicense] = useState<boolean>(() => hasJwt());
  useEffect(() => {
    setHasLicense(hasJwt());
  }, [activation.status, activation.error, activation.lastTokenSource]);
  if (!hasLicense) {
    return <LoginOnboardingRoute />;
  }
  return <>{children}</>;
}

declare const __APP_VERSION__: string | undefined;
