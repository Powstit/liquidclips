/**
 * Settings · P1-2 · Beta-honest settings route
 *
 * Replaces the Phase 5B SimPage placeholder. Renders the smallest real
 * Settings surface that gives a beta user confidence about:
 *   - whether they're signed in
 *   - which surfaces are live vs studio-preview
 *   - what Liquid Clips does vs what Whop does
 *   - where the license JWT lives (and how to clear it)
 *   - which backend the app is talking to
 *   - basic actions: clear local activation · refresh account · open Whop
 *
 * Hard rules honored (locked):
 *   - No billing.
 *   - No native Keychain · no Rust commands · no 401 self-heal.
 *   - No new OAuth scopes · no bounty:create.
 *   - No tier enforcement (just display).
 *   - No provider secret storage.
 *   - No payment upgrades.
 *   - No native reward engine, no social OAuth.
 *
 * Reuses (design-OS):
 *   - useActivation()                 (P1-1D activation snapshot)
 *   - hasJwt() / getJwt() /
 *     clearJwt() / getAuthSource() /
 *     LICENSE_JWT_STORAGE_KEY         (P1-1B authStorage)
 *   - clearActivation()               (P1-1D activation lifecycle)
 *   - useChannels / useSchedule /
 *     useCommunity                    (existing source labels)
 *   - openSmart                       (Tauri-shell + window.open fallback)
 *   - bus.emit("toast", …)            (existing toast convention)
 */

import { useEffect, useState } from "react";
import { motion as fm } from "framer-motion";
import { useActivation, beginActivation } from "../../lib/activation";
import {
  hasJwt as readHasJwt,
  getJwt,
  clearJwt,
  clearJwtKeychainForAuthAction,
  getAuthSource,
  LICENSE_JWT_STORAGE_KEY,
} from "../../lib/authStorage";
import { openSmart } from "../../lib/openSmart";
import { openInApp } from "../../lib/openInApp";
import { SafeImg } from "../../components/safe";
import {
  getCarrot,
  getPayoutsPortal,
  onboardCarrot,
  type CarrotSnapshot,
} from "../../lib/carrot";
import { bus, useEvent } from "../bridge";
import { useMe } from "../state/useMe";
import { useTierCaps } from "../state/useTierCaps";
import { useBillingState } from "../../lib/billing/adapter";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { RosterPanel } from "./agency-panels/RosterPanel";
import { PayoutSplitPanel } from "./agency-panels/PayoutSplitPanel";
import { RulesPanel } from "./agency-panels/RulesPanel";
import { WhopSyncPanel } from "./agency-panels/WhopSyncPanel";
// ag-01 (2026-07-06) · Sovereign-Operator Protocol · workspace-creation
// on Liquid Clips is implicit (agencies are User rows flipped by
// tier/mode) so there is no dedicated "create workspace" form to wrap.
// The Agency-tabs section IS the workspace-creation UI — the moment mode
// flips to "agency" the owner sees the roster + payout-split + rules
// panels. Wrapping the section here keeps the mode-flip crash-resilient.
import { Watchdog } from "../../lib/watchdog";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { useChannels } from "../state/useChannels";
import { useSchedule } from "../state/useSchedule";
import { useCommunity } from "../state/useCommunity";
import { useMode } from "../bridge/useMode";
import { usePresencePreference } from "../../lib/presencePreference";
import { AffiliateWidget } from "../earn/AffiliateWidget";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { presets } from "../motion";
import "../earn/AffiliateWidget.css";
import "./SimPage.css";
import "./Settings.css";

type SettingsTab =
  | "account"
  | "payouts"
  | "devices"
  | "notifications"
  | "support"
  | "advanced"
  | "streaks"
  | "referrals"
  | "whop-sync"
  | "roster"
  | "payout-split"
  | "rules";

interface SettingsTabSpec {
  id: SettingsTab;
  label: string;
  icon?: string;
}

const COMMON_SETTINGS_TABS: readonly SettingsTabSpec[] = [
  { id: "account", label: "Account" },
  { id: "payouts", label: "Payouts" },
  { id: "devices", label: "Devices", icon: "/brand/settings/devices.svg" },
  { id: "notifications", label: "Notifications", icon: "/brand/settings/notifs.svg" },
  { id: "support", label: "Support" },
  { id: "advanced", label: "Advanced", icon: "/brand/settings/advanced.svg" },
];

const CLIPPER_SETTINGS_TABS: readonly SettingsTabSpec[] = [
  { id: "streaks", label: "Streaks" },
  { id: "referrals", label: "Referrals & QR" },
];

const AGENCY_SETTINGS_TABS: readonly SettingsTabSpec[] = [
  { id: "whop-sync", label: "Whop Sync" },
  { id: "roster", label: "Roster", icon: "/brand/settings/roster.svg" },
  { id: "payout-split", label: "Payout split" },
  { id: "rules", label: "Rules" },
];

/** Backend URL helper · mirrors sidecar-stub + activation.ts. Inlined
 *  to keep Settings self-contained. */
function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Customer-facing availability, without exposing implementation modes. */
function sourceToHonestyLabel(
  s: "real-rpc" | "real-http" | "mock" | "assisted-local",
): "Live" | "Unavailable" | "On this Mac" {
  if (s === "assisted-local") return "On this Mac";
  return s === "real-rpc" || s === "real-http" ? "Live" : "Unavailable";
}

function SettingsBody() {
  const session = useEngineSession();
  useKadeFromSession("settings");

  const spec = ROUTE_REGISTRY["settings"];

  // 2026-06-24 · Settings was one long scroll. Split into 4 tabs so
  // users don't have to hunt: Account (you + key + plan + actions) ·
  // Connections (channels + schedules) · Plan (tier + Whop explainer) ·
  // Diagnostics (storage + beta + support).
  const [tab, setTab] = useState<SettingsTab>("account");
  useEvent("settings:open-tab", ({ tab: requestedTab }) => {
    setTab(requestedTab);
  });
  const mode = useMode();
  const { visibility, setVisibility } = usePresencePreference();
  const modeTabs = mode === "agency" ? AGENCY_SETTINGS_TABS : CLIPPER_SETTINGS_TABS;
  const availableTabs = [...COMMON_SETTINGS_TABS, ...modeTabs];

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === tab)) setTab("account");
  }, [mode, tab]);

  const activation = useActivation();
  const channels = useChannels();
  const schedule = useSchedule();
  const community = useCommunity();
  /* P1-1G-b · real /me-backed tier + identity. `useMe()` auto-fetches
   * on mount when a JWT is present · `useTierCaps()` reads from it. */
  const me = useMe();
  const tier = useTierCaps();
  // Billing adapter opens the plan-aware Whop checkout. Pricing pivot
  // 2026-07-06 · ONE paid plan · Agency $99.99/mo. Legacy Pro/Growth
  // still exist in PLAN_CATALOG for backend compat but no user-facing
  // surface should offer them until 100 Agency users unlock the ladder.
  const billing = useBillingState();
  const [hasLicense, setHasLicense] = useState<boolean>(() => readHasJwt());
  const [refreshing, setRefreshing] = useState(false);
  const [copyEcho, setCopyEcho] = useState<string | null>(null);

  const authSource = getAuthSource();
  const backendUrl = lcBackendUrl();

  /* ── derived account state ────────────────────────────────────── */

  // Activation state line · prefers the live state machine. Falls back
  // to "Active license" when the user has a JWT from a prior session.
  let activationStateLabel = "Not activated";
  let activationStateTone: "live" | "warn" | "muted" = "muted";
  if (activation.status === "waiting" || activation.status === "activating") {
    activationStateLabel = activation.status === "waiting" ? "Waiting for sign-in" : "Activating…";
    activationStateTone = "warn";
  } else if (activation.status === "activated") {
    activationStateLabel = activation.degraded ? "Active · sync pending" : "Active license";
    activationStateTone = "live";
  } else if (activation.status === "failed") {
    activationStateLabel = "Activation failed";
    activationStateTone = "warn";
  } else if (hasLicense) {
    activationStateLabel = "Active license · saved from a prior session";
    activationStateTone = "live";
  }

  /* P1-1G-b · prefer /me · fall back to activation snapshot when /me
   * hasn't returned yet · final fallback "unknown" for honesty. */
  const emailLabel = me.snapshot?.email ?? activation.email ?? "unknown";
  const tierLabel = tier.tier.toUpperCase();
  const sourceLabel =
    activation.lastTokenSource === "whop"
      ? "Whop sign-in"
      : activation.lastTokenSource === "clerk"
        ? "Email / Clerk"
      : hasLicense ? "Saved earlier" : "—";
  const identityName = emailLabel === "unknown"
    ? "Clipper"
    : emailLabel.split("@")[0]?.trim() || "Clipper";
  const identityInitial = identityName.slice(0, 1).toUpperCase();

  /* ── handlers ─────────────────────────────────────────────────── */

  const handleClearActivation = () => {
    clearJwt();
    // 2026-07-07 · cold-open lens P0-001 · Keychain copy must go too, or
    // the next cold boot rehydrates the stale JWT and WelcomeGate skips
    // the login screen entirely.
    void clearJwtKeychainForAuthAction();
    // 2026-07-07 · cold-open lens P0-002 · clear the WelcomeGate + guest
    // localStorage flags so the shell returns to the WelcomeRoute instead
    // of the anonymous surface.
    try {
      window.localStorage.removeItem("lc:welcome-acked");
      window.localStorage.removeItem("lc:guest-mode");
      window.localStorage.removeItem("lc:guest-clips-remaining");
      window.localStorage.removeItem("lc:cold-lead-context");
      window.localStorage.removeItem("lc:checkout-email");
      window.localStorage.removeItem("lc:discount-code");
    } catch { /* honest no-op */ }
    activation.clearActivation();
    setHasLicense(false);
    // 2026-07-05 · beta-walk P0 · previously the toast told the user
    // to reload the app — dead end in Tauri. Now we emit
    // `auth:signed-out` so the AuthGate re-checks hasJwt() and swaps
    // the whole shell back to LoginActivation (which owns the working
    // Whop sign-in surface). See App.tsx AuthGate for the listener.
    bus.emit("auth:signed-out", {});
    bus.emit("toast", {
      kind: "info",
      title: "Local activation cleared",
      body: "You're back at the sign-in screen.",
    });
  };

  const handleCopyStorageKey = async () => {
    try {
      await navigator.clipboard.writeText(LICENSE_JWT_STORAGE_KEY);
      setCopyEcho(LICENSE_JWT_STORAGE_KEY);
      setTimeout(() => setCopyEcho(null), 1500);
    } catch {
      // Browser blocked clipboard · show inline.
      setCopyEcho(LICENSE_JWT_STORAGE_KEY);
      setTimeout(() => setCopyEcho(null), 2200);
    }
  };

  const handleRefreshAccount = async () => {
    const jwt = getJwt();
    if (!jwt) {
      bus.emit("toast", {
        kind: "info",
        title: "Not signed in",
        body: "Sign in first to refresh account status.",
      });
      return;
    }
    setRefreshing(true);
    try {
      const r = await fetch(`${backendUrl}/sync`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${jwt}` },
      });
      if (!r.ok) {
        bus.emit("toast", {
          kind: "warning",
          title: "Refresh failed",
          body: `Backend returned ${r.status}.`,
        });
        return;
      }
      const data = await r.json() as { tier?: string; new_license_jwt?: string };
      if (data.new_license_jwt) {
        // Silent rotation · authStorage already throws-safe.
        try {
          (await import("../../lib/authStorage")).setJwt(data.new_license_jwt);
        } catch { /* preserve original · refresh is best-effort */ }
      }
      bus.emit("toast", {
        kind: "success",
        title: "Account refreshed",
        body: data.tier ? `Tier: ${data.tier}` : "Backend reached · no changes.",
      });
    } catch (e) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't reach backend",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * Connect Whop · launches the backend OAuth bridge in the OS browser.
   * beginActivation() mints + persists a fresh challenge nonce; the
   * backend echoes it back through Whop's authorize → callback flow and
   * eventually fires liquidclips://activate?token=…&challenge=…&source=whop
   * which the deep-link subscriber (deepLinkBoot.ts) routes into the
   * activation state machine. Strict OS-browser handoff — Whop blocks
   * the in-app iframe via CSP frame-ancestors.
   */
  const [connectingWhop, setConnectingWhop] = useState(false);
  const handleConnectWhop = async () => {
    if (connectingWhop) return;
    setConnectingWhop(true);
    try {
      const challenge = beginActivation();
      const url = `${lcBackendUrl()}/auth/whop/start?challenge=${encodeURIComponent(challenge)}`;
      await openInApp(url);
      bus.emit("toast", {
        kind: "info",
        title: "Connecting Whop",
        body: "Finish the sign-in in your browser. We'll wake the app when it's done.",
      });
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't start Whop sign-in",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConnectingWhop(false);
    }
  };

  /* /me/carrot state · drives the Payouts & Security card below. Reads
   * on mount; refreshes after any onboard/manage action so the section
   * flips from "Set up payouts" to "Manage payouts" without a full page
   * round-trip. Failure → null (panel renders an honest unavailable
   * state, never fake numbers). */
  const [carrot, setCarrot] = useState<CarrotSnapshot | null>(null);
  const [carrotLoading, setCarrotLoading] = useState(true);
  const [carrotBusy, setCarrotBusy] = useState(false);

  const refreshCarrot = async () => {
    setCarrotLoading(true);
    try {
      const snap = await getCarrot();
      setCarrot(snap);
    } finally {
      setCarrotLoading(false);
    }
  };

  useEffect(() => {
    void refreshCarrot();
  }, []);

  /* 2026-06-30 · activation:complete rehydration · if the user fires the
   * Whop OAuth flow while the Settings tab is already open, the panel's
   * useEffect[] above only ran once on mount and the carrot state sits
   * at "Temporarily unavailable" forever. Refetch on every activation
   * landing so the panel flips from guest → connected without a manual
   * route round-trip. */
  useEvent("activation:complete", () => {
    void refreshCarrot();
  });

  const handleSetupPayouts = async () => {
    if (carrotBusy) return;
    setCarrotBusy(true);
    try {
      const res = await onboardCarrot();
      if (!("onboarding_url" in res)) {
        bus.emit("toast", {
          kind: "warning",
          title: "Couldn't open Whop setup",
          body: res.error,
        });
        return;
      }
      await openInApp(res.onboarding_url);
      bus.emit("toast", {
        kind: "info",
        title: "Finish payout setup on Whop",
        body: "Come back here once Whop confirms your account.",
      });
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop setup",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCarrotBusy(false);
      void refreshCarrot();
    }
  };

  const handleManagePayouts = async () => {
    if (carrotBusy) return;
    setCarrotBusy(true);
    try {
      const res = await getPayoutsPortal();
      if (!("url" in res)) {
        bus.emit("toast", {
          kind: "warning",
          title: "Couldn't open Whop payouts",
          body: res.error,
        });
        return;
      }
      await openInApp(res.url);
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop payouts",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCarrotBusy(false);
    }
  };

  const handleOpenWhop = async () => {
    try {
      await openInApp("https://whop.com/@me/settings/memberships");
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop",
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /**
   * Billing CTA via the shared Whop adapter.
   *
   * Routes upgrade through `billing.adapter.startCheckout()` so the selected
   * plan lands directly in the embedded Whop checkout. Agency users open
   * Whop's management surface because they are already on the top tier.
   *
   * Pricing pivot 2026-07-06 (LOCKED) · ONE paid plan · Agency $99.99/mo.
   * Every non-agency tier upgrades directly to Agency (no Pro/Growth
   * step-ladder while those tiers are deferred).
   *   - clipper → Whop checkout for Agency ($99.99)
   *   - pro     → Whop checkout for Agency ($99.99)  (legacy compat)
   *   - growth  → Whop checkout for Agency ($99.99)  (legacy compat)
   *   - agency  → Whop manage URL (no upgrade target)
   */
  const handleManageBilling = async () => {
    const targetPlan: "pro" | "growth" | "agency" | null =
      tier.tier === "agency" ? null : "agency";
    if (targetPlan) {
      // LC-UI-P0-001: check the outcome and surface a toast if checkout
      // never actually opened. Mock + opener-failure paths must NOT slip
      // through as silent success.
      try {
        const outcome = await billing.adapter.startCheckout(targetPlan);
        if (!outcome.ok) {
          bus.emit("toast", {
            kind: "error",
            title: "Couldn't open checkout",
            body:
              outcome.error ??
              "Open Whop in your browser and pick the plan from there.",
          });
        }
      } catch (e) {
        bus.emit("toast", {
          kind: "error",
          title: "Couldn't open checkout",
          body: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    // Top tier · no upgrade target · open Whop manage page.
    return handleOpenWhop();
  };

  /* P1-3-a · Support contact handlers · NO backend, NO ticketing. */

  const SUPPORT_EMAIL = "hello@liquidclips.app";
  const DOCS_URL = "https://liquidclips.app/docs";
  const PRIVACY_URL = "https://liquidclips.app/privacy";
  const TERMS_URL = "https://liquidclips.app/terms";

  const [emailCopyEcho, setEmailCopyEcho] = useState(false);

  const handleCopySupportEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setEmailCopyEcho(true);
      setTimeout(() => setEmailCopyEcho(false), 1500);
    } catch {
      setEmailCopyEcho(true);
      setTimeout(() => setEmailCopyEcho(false), 2200);
    }
  };

  const handleOpenMail = async () => {
    const subject = encodeURIComponent("Beta · Liquid Clips · ");
    try {
      await openSmart(`mailto:${SUPPORT_EMAIL}?subject=${subject}`);
    } catch (e) {
      bus.emit("toast", {
        kind: "info",
        title: "Open mail manually",
        body: `${SUPPORT_EMAIL} · we couldn't launch your default mail client.`,
      });
    }
  };

  const handleOpenExternal = (url: string, label: string) => async () => {
    try {
      await openInApp(url);
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: `Couldn't open ${label}`,
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /* P1-3-b · Connected accounts handlers · no new OAuth, no new backend. */

  const WHOP_DASHBOARD_URL = "https://whop.com/liquidclips/";

  const handleOpenChannelsRoute = () => {
    if (typeof window === "undefined") return;
    window.location.hash = "#/channels";
  };

  /* ── render ───────────────────────────────────────────────────── */
  /* P1-2A · routed through DesignOSAppShell · world="cockpit-home" ·
   * Kade in helper-right per ROUTE_REGISTRY["settings"]. Sim-* route
   * grammar (sim-eb / sim-h1 / sim-sub / sim-stage / sim-welcome) +
   * lc-runtime-tag honesty pills match Channels / Schedule. */

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="settings"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage lc-settings-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <div className="lc-route-head" data-kade-anchor data-route-title="Settings">
          <div className="lc-settings-heading">
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  primary route heading now <h1> for screen-reader nav. */}
            <h1 className="lc-route-head-eb">Settings</h1>
            <span className="lc-settings-heading-copy">
              {mode === "agency" ? "agency cockpit" : "clipper cockpit"}
            </span>
          </div>
          <div className="lc-route-head-pills">
            <span
              className={`lc-runtime-tag ${hasLicense ? "is-live" : ""}`}
            >
              {hasLicense ? "Account connected" : "Account unavailable"}
            </span>
          </div>
        </div>

        <section className="lc-settings-identity" aria-label="Account identity">
          <div className="lc-settings-avatar" aria-hidden="true">{identityInitial}</div>
          <div className="lc-settings-identity-copy">
            <strong>{identityName}</strong>
            <span>
              {emailLabel === "unknown" ? "@handle unavailable" : emailLabel}
            </span>
            <small>
              {tierLabel} · {activationStateLabel}
            </small>
          </div>
          <div className="lc-settings-identity-state">
            <span className="lc-settings-identity-tier">{mode === "agency" ? "Agency" : tierLabel}</span>
            <button
              type="button"
              className="lc-settings-presence"
              data-online={visibility === "online" ? "true" : "false"}
              aria-pressed={visibility === "online"}
              onClick={() => setVisibility(visibility === "online" ? "invisible" : "online")}
            >
              <span aria-hidden="true" />
              {visibility === "online" ? "Online" : "Invisible"}
            </button>
          </div>
        </section>

        <div className="lc-settings-cockpit">
          <nav className="lc-settings-tabs" role="tablist" aria-label="Settings sections">
            <span className="lc-settings-tab-group">Common</span>
            {COMMON_SETTINGS_TABS.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls="settings-active-pane"
                className="lc-settings-tab"
                data-active={tab === id ? "true" : undefined}
                onClick={() => setTab(id)}
              >
                {icon ? <SafeImg src={icon} fallback="hide" alt="" aria-hidden="true" /> : <span aria-hidden="true">◇</span>}
                {label}
              </button>
            ))}
            <span className="lc-settings-tab-group">
              {mode === "agency" ? "Agency" : "Clipper"}
            </span>
            {modeTabs.map(({ id, label, icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="lc-settings-tab"
              data-active={tab === id ? "true" : undefined}
              onClick={() => setTab(id)}
            >
              {icon ? <SafeImg src={icon} fallback="hide" alt="" aria-hidden="true" /> : <span aria-hidden="true">◇</span>}
              {label}
            </button>
          ))}
          </nav>

          <div
            className="lc-settings"
            id="settings-active-pane"
            role="tabpanel"
            data-active-tab={tab}
            aria-label={availableTabs.find((item) => item.id === tab)?.label ?? "Settings"}
          >
          <section className="lc-settings-card lc-settings-capability" data-tab="notifications">
            <SafeImg src="/brand/settings/notifs.svg" fallback="hide" alt="" aria-hidden="true" />
            <span className="lc-settings-card-eb">Notifications</span>
            <strong>Notification preferences are not connected yet.</strong>
            <p className="lc-settings-hint">
              The inbox currently exposes product notices only. No preference
              switches are shown until a server-backed notification contract exists.
            </p>
          </section>

          <section className="lc-settings-card lc-settings-capability" data-tab="devices">
            <SafeImg src="/brand/settings/devices.svg" fallback="hide" alt="" aria-hidden="true" />
            <span className="lc-settings-card-eb">Devices &amp; connections</span>
            <strong>Session revocation is not available from the current backend.</strong>
            <p className="lc-settings-hint">
              Verified service connections remain listed below. No invented device
              names, locations, or last-seen times are displayed.
            </p>
          </section>

          <section className="lc-settings-card lc-settings-capability" data-tab="streaks">
            <span className="lc-settings-card-eb">Streaks</span>
            <strong>Streak history is awaiting a real account data source.</strong>
            <p className="lc-settings-hint">
              This pane will stay empty rather than presenting a hard-coded streak.
            </p>
          </section>

          <div className="lc-settings-special" data-tab="referrals">
            <AffiliateWidget />
            <p className="lc-settings-policy">
              Handle changes are validated by the server. Redirect and cooldown
              policy will appear here when the backend returns those fields; the
              desktop does not invent change limits or dates.
            </p>
          </div>

          {/* ag-01 (2026-07-06) · Watchdog wraps the entire Agency-tab
              section so a mid-render crash in any panel keeps the
              Settings shell alive. Agency workspace creation is the
              mode/tier flip itself; this IS that surface. */}
          <Watchdog
            id="agency/ag-01/create-workspace"
            label="Agency workspace section"
            cluster="agency"
            source="src/design-os/routes/Settings.tsx:agency-tab-group"
          >
            <>
              {/* Path A follow-through · live Whop-sync panel (was placeholder). */}
              {me.snapshot?.userId ? (
                <EngineErrorBoundary route="settings" component="AgencyWhopSync">
                  <WhopSyncPanel agencyId={me.snapshot.userId} />
                </EngineErrorBoundary>
              ) : null}

              {/* Sprint C · Live agency panels — replaces the previous
                  "Server contract required" placeholders. Agency ID equals
                  the signed-in owner's backend user id (agencies are User
                  rows per app/routes/agency.py). The panels only render
                  here because Settings.tsx already gates the whole section
                  on mode === "agency"; a Free/Solo user in agency mode sees
                  the AgencyPreviewBanner upgrade wall above these cards. */}
              {me.snapshot?.userId ? (
                <EngineErrorBoundary route="settings" component="AgencyRoster">
                  <RosterPanel agencyId={me.snapshot.userId} />
                </EngineErrorBoundary>
              ) : null}
              {me.snapshot?.userId ? (
                <EngineErrorBoundary route="settings" component="AgencyPayoutSplit">
                  <PayoutSplitPanel agencyId={me.snapshot.userId} />
                </EngineErrorBoundary>
              ) : null}
              {me.snapshot?.userId ? (
                <EngineErrorBoundary route="settings" component="AgencyRules">
                  <RulesPanel agencyId={me.snapshot.userId} />
                </EngineErrorBoundary>
              ) : null}
            </>
          </Watchdog>

          {/* Section 1 · Account */}
          <EngineErrorBoundary route="settings" component="Account">
            <section className="lc-settings-card" data-tab="account">
              <span className="lc-settings-card-eb">Account</span>
              <div className="lc-settings-rows">
                <SettingsRow
                  label="Activation"
                  value={activationStateLabel}
                  tone={activationStateTone}
                />
                <SettingsRow label="Email" value={emailLabel} />
                <SettingsRow label="Tier" value={tierLabel} pill />
                <SettingsRow label="Door" value={sourceLabel} />
                {activation.degraded && (
                  <p className="lc-settings-degraded">
                    Local activation succeeded · last refresh didn't reach the
                    backend. The app retries automatically. You can also tap
                    <em> Refresh account status</em> below.
                  </p>
                )}
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 1a · OpenAI key (Batch C · 2026-06-20).
              Free tier needs the user's key so stage_llm (moment-finding)
              can run locally. Stored via Tauri Keychain commands —
              see src-tauri/src/lib.rs `openai_key_*`. Python sidecar
              reads the same Keychain entry via secrets_store.py. */}
          <EngineErrorBoundary route="settings" component="OpenAIKey">
            <OpenAIKeyCard />
          </EngineErrorBoundary>

          {/* TASK 2 · Upgrade card · bridges to the proven Whop checkout
              flow. The Whop plans page already lists Solo / Pro / Agency
              with live pricing + webhook-driven tier mutation on the
              backend. We just link out. */}
          <EngineErrorBoundary route="settings" component="UpgradePlaceholder">
            <section className="lc-settings-card" data-tab="account">
              <span className="lc-settings-card-eb">Upgrade</span>
              <div className="lc-settings-rows">
                <SettingsRow
                  label="Tier"
                  value={tier.tier === "clipper" ? "Free · ready to upgrade" : `${tierLabel} · paid plan active`}
                  tone={tier.tier === "clipper" ? "muted" : "live"}
                />
                <p className="lc-settings-degraded" style={{ marginTop: 4 }}>
                  Agency ($99.99/mo) runs through Whop. Sign-up is free ·
                  checkout opens in your browser · your tier updates here as
                  soon as Whop confirms the purchase.
                </p>
                <div className="lc-settings-actions" data-whop-linked={me.snapshot?.whopUserId ? "1" : "0"}>
                  {/* Connect Whop · OAuth bridge. Mints a fresh activation
                      challenge, opens api.liquidclips.app/auth/whop/start
                      in the OS browser, and the deep-link subscriber wakes
                      the app on liquidclips://activate completion.
                      Gated on whopUserId absence · the moment /me resolves a
                      Whop link this CTA disappears and the Manage-plan
                      action below becomes the sole Whop affordance. */}
                  {!me.snapshot?.whopUserId && (
                    <button
                      type="button"
                      className="lc-settings-cta lc-settings-cta-primary"
                      data-testid="settings-connect-whop"
                      onClick={() => { void handleConnectWhop(); }}
                      disabled={connectingWhop}
                    >
                      {connectingWhop ? "Opening Whop…" : "Connect Whop · sign in ↗"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    data-testid="settings-upgrade-whop"
                    data-upgrade-state={tier.tier === "clipper" ? "available" : tier.tier === "agency" ? "top" : "paid"}
                    data-billing-source={billing.source}
                    /* 2026-06-23 · data-open-url preserved for test contract
                       compatibility · agency-tier fallback opens Whop manage
                       page · other tiers route via billing.adapter to Clerk
                       checkout for the right plan. */
                    data-open-url="https://whop.com/liquidclips/"
                    onClick={() => { void handleManageBilling(); }}
                  >
                    {tier.tier === "clipper" ? "Upgrade to Agency on Whop · $99.99/mo"
                      : tier.tier === "agency" ? "Manage plan on Whop ↗"
                      /* Legacy Pro/Growth users pre-pricing-pivot land here.
                       * Post-pivot 2026-07-06 there's ONE paid plan (Agency),
                       * so any non-clipper / non-agency tier is treated as an
                       * agency upgrade target rather than surfacing the
                       * deferred Pro/Growth ladder. */
                      : "Upgrade to Agency on Whop · $99.99/mo"}
                  </button>
                </div>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 2 · Connection status */}
          <EngineErrorBoundary route="settings" component="ConnectionStatus">
            <section className="lc-settings-card" data-tab="connections">
              <span className="lc-settings-card-eb">Connection status</span>
              <div className="lc-settings-rows">
                <SettingsRow
                  label="Channels"
                  value={sourceToHonestyLabel(channels.source)}
                  tone={channels.source === "mock" ? "muted" : "live"}
                  mono
                />
                <SettingsRow
                  label="Schedule"
                  value={sourceToHonestyLabel(schedule.source)}
                  tone="live"
                  mono
                />
                <SettingsRow
                  label="Community"
                  value={community.isMockFallback ? "Unavailable" : "Live"}
                  tone={community.isMockFallback ? "muted" : "live"}
                  mono
                />
                <p className="lc-settings-hint">
                  Live services use your local activation. Unavailable services
                  can be retried without affecting exported clips.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 3 · Connected accounts · P1-3-b · beta blocker B2.
           *  Honest provider state · no fake "Connected" pills.
           *  Surfaces only signals we ACTUALLY know about client-side. */}
          <EngineErrorBoundary route="settings" component="ConnectedAccounts">
            <section className="lc-settings-card" data-tab="connections">
              <span className="lc-settings-card-eb">Connected accounts</span>
              <div className="lc-settings-rows">

                {/* P1-3-b · refined per the deeper audit · 3-state vocab
                 *  (Connected / Not connected / Not checked yet) applied
                 *  per provider based on what we can ACTUALLY verify. */}

                {/* Liquid Clips · hasJwt() is synchronous and authoritative
                 *  client-side. Never "Not checked yet" · we always know. */}
                <div className="lc-settings-provider">
                  <div className="lc-settings-provider-head">
                    <span className="lc-settings-provider-name">Liquid Clips</span>
                    <span
                      className={`lc-settings-row-value tone-${hasLicense ? "live" : "muted"} is-mono`}
                    >
                      {hasLicense ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p className="lc-settings-provider-body">
                    Activation handshake · drives your tier + entitlements.
                    License JWT lives on this device only.
                  </p>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Storage</span>
                    <span className="lc-settings-meta-value">
                      {authSource === "tauri-keychain" ? "macOS Keychain" : "Browser localStorage"}
                    </span>
                  </div>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Session state</span>
                    <span className="lc-settings-meta-value">
                      {activation.status === "activated" ? "active this run" : hasLicense ? "loaded from storage" : "no license present"}
                    </span>
                  </div>
                  {!hasLicense && (
                    <button
                      type="button"
                      className="lc-settings-cta lc-settings-cta-quiet"
                      // 2026-07-05 · beta-walk P0 · previously fired a
                      // toast telling the user to reload the app. Now
                      // dispatches `auth:open-panel` which the AuthGate
                      // handles by opening the Whop OAuth panel over
                      // the app — same action as the LoginActivation
                      // primary CTA.
                      onClick={() => bus.emit("auth:open-panel", {})}
                    >
                      Sign in with Whop
                    </button>
                  )}
                </div>

                {/* Whop · 2 distinct facts kept SEPARATE per Daniel's spec:
                 *    (a) login capability EXISTS (backend /auth/whop/start
                 *        co-equal Clerk door · scope=read_user · documented
                 *        in WHOP_TRUE_LOGIN_SCOPE.md)
                 *    (b) current connection state requires /me's whop_user_id
                 *        which we don't fetch on mount yet (P1-3-e scope).
                 *  Status pill reflects (b) only · capability statement is
                 *  body copy. */}
                <div className="lc-settings-provider">
                  <div className="lc-settings-provider-head">
                    <span className="lc-settings-provider-name">Whop</span>
                    <span className="lc-settings-row-value tone-muted is-mono">
                      {me.snapshot?.whopUserId ? "Connected" : "Not connected"}
                    </span>
                  </div>
                  <p className="lc-settings-provider-body">
                    <strong>Whop owns</strong> · reward submissions · reward
                    approval · payout tracking · withdrawals · reward
                    settlement.
                    <br />
                    <strong>Liquid Clips owns</strong> · campaign workspace ·
                    campaign briefs · clip generation · campaign coordination
                    · clipping workflow.
                  </p>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Sign in</span>
                    <span className="lc-settings-meta-value">Whop sign-in is available</span>
                  </div>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Current state</span>
                    <span className="lc-settings-meta-value">Use Refresh account status to verify</span>
                  </div>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    onClick={handleOpenExternal(WHOP_DASHBOARD_URL, "Whop")}
                  >
                    Open Whop ↗
                  </button>
                </div>

                {/* Ayrshare · per-channel state is REAL · useChannels exposes
                 *  status:ChannelStatus per row. Count actually-connected
                 *  channels for the status pill. */}
                {(() => {
                  const connectedCount = channels.channels.filter((c) => c.status === "connected").length;
                  const sourceKnown = channels.source !== "mock";
                  let pill: string;
                  let tone: "live" | "muted";
                  if (!sourceKnown) {
                    pill = "Connection status not checked yet";
                    tone = "muted";
                  } else if (connectedCount === 0) {
                    pill = "Not connected";
                    tone = "muted";
                  } else {
                    pill = `Connected · ${connectedCount} channel${connectedCount === 1 ? "" : "s"}`;
                    tone = "live";
                  }
                  return (
                    <div className="lc-settings-provider">
                      <div className="lc-settings-provider-head">
                        <span className="lc-settings-provider-name">Ayrshare</span>
                        <span className={`lc-settings-row-value tone-${tone} is-mono`}>{pill}</span>
                      </div>
                      <p className="lc-settings-provider-body">
                        Social account publishing + scheduling. Per-channel
                        connect state (YouTube · TikTok · Instagram · X) lives
                        in the Channels route.
                      </p>
                      <div className="lc-settings-provider-meta">
                        <span className="lc-settings-meta-label">Service</span>
                        <span className="lc-settings-meta-value">
                          {sourceKnown ? "Available" : "Unavailable"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="lc-settings-cta lc-settings-cta-secondary"
                        onClick={handleOpenChannelsRoute}
                      >
                        {connectedCount > 0 ? "Manage Channels →" : "Open Channels →"}
                      </button>
                    </div>
                  );
                })()}

                {/* Stripe Connect · DB has stripe_connect_* columns on User
                 *  but /me doesn't expose them today · /stripe-connect/me
                 *  endpoint exists but desktop-2 doesn't read it in v1.
                 *  Honest: "Not checked yet" · NOT "Not connected" because
                 *  we genuinely haven't asked. */}
                <div className="lc-settings-provider">
                  <div className="lc-settings-provider-head">
                    <span className="lc-settings-provider-name">Stripe Connect</span>
                    <span className="lc-settings-row-value tone-muted is-mono">
                      Connection status not checked yet
                    </span>
                  </div>
                  <p className="lc-settings-provider-body">
                    Reserved for native Liquid Clips payout rails ·
                    <strong> coming soon</strong>. Today, payouts settle on
                    Whop · this row is informational.
                  </p>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Beta payouts</span>
                    <span className="lc-settings-meta-value">via Whop</span>
                  </div>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Native payouts</span>
                    <span className="lc-settings-meta-value">Coming soon</span>
                  </div>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    data-open-url="https://whop.com/dashboard/"
                    onClick={handleOpenExternal(WHOP_DASHBOARD_URL, "Whop")}
                  >
                    Open Whop dashboard ↗
                  </button>
                </div>

                <p className="lc-settings-hint">
                  Use <em>Refresh account status</em> to verify Whop and payout
                  connections without leaving this page.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 4 · Plan & access · P1-3-c · beta blocker B3.
           *  No fake "Active" / "Paid" pills. Honest source labels.
           *  Tier comes from the activation snapshot (real but possibly
           *  stale). Subscription state + billing owner + admin override
           *  all require /me on mount · P1-3-e scope · until then they
           *  read "Not checked yet". */}
          <EngineErrorBoundary route="settings" component="PlanAccess">
            <section className="lc-settings-card" data-tab="payouts">
              <span className="lc-settings-card-eb">Plan &amp; access</span>
              <div className="lc-settings-rows">

                {/* P1-1G-b · tier now reads from useTierCaps() which
                 *  prefers /me effective_tier · falls back to fixture
                 *  with honest source label. */}
                <SettingsRow
                  label="Tier"
                  value={tier.tier.toUpperCase()}
                  pill={tier.source === "real-http" || tier.source === "session-cache"}
                  tone={tier.source === "real-http" || tier.source === "session-cache" ? "live" : "muted"}
                  mono={tier.source !== "real-http" && tier.source !== "session-cache"}
                />
                <SettingsRow
                  label="Account status"
                  value={
                    tier.source === "real-http"        ? "Verified just now" :
                    tier.source === "session-cache"    ? "Verified previously" :
                    tier.source === "unavailable" ? (tier.loading ? "Checking account…" : "Could not verify") :
                    tier.source === "unknown"          ? "Sign in to verify" :
                                                         "Test override"
                  }
                  tone={tier.source === "real-http" || tier.source === "session-cache" ? "live" : "muted"}
                  mono
                />

                {/* Beta provisioning · real from /me.admin_override */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Access</span>
                  <span className="lc-settings-meta-value">
                    {me.snapshot && tier.adminOverride
                      ? "Admin access"
                      : me.snapshot
                        ? "Standard access"
                        : me.degraded
                          ? "Could not verify"
                          : "Not checked yet"
                    }
                  </span>
                </div>

                {/* TASK 2 · admin-only link to HQ (account.liquidclips.app/admin).
                 *  Bridges the LC team to the existing AdminHQ surface in
                 *  account-app. Rendered only when /me reports an admin
                 *  override · standard customers never see it. */}
                {tier.adminOverride && (
                  <div className="lc-settings-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="lc-settings-cta lc-settings-cta-secondary"
                      data-testid="settings-open-hq"
                      data-open-url="https://account.liquidclips.app/admin"
                      onClick={() => { void openInApp("https://account.liquidclips.app/admin"); }}
                    >
                      Open Admin HQ ↗
                    </button>
                  </div>
                )}

                {/* Billing owner · real from /me.billing_provider */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Billing provider</span>
                  <span className="lc-settings-meta-value">
                    {me.snapshot?.billingProvider === "whop"  ? "Whop" :
                     me.snapshot?.billingProvider === "clerk" ? "Clerk" :
                     me.snapshot                              ? "Not available" :
                     me.degraded                              ? "Could not verify" :
                                                                "Not checked yet"
                    }
                  </span>
                </div>

                {/* Subscription state · real from /me.subscription_status */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Subscription status</span>
                  <span className="lc-settings-meta-value">
                    {me.snapshot?.subscriptionStatus
                      ? `${me.snapshot.subscriptionStatus}${me.snapshot.paidUntil ? ` · until ${me.snapshot.paidUntil}` : ""}`
                      : me.snapshot
                        ? "no subscription on file"
                        : me.degraded
                          ? "Could not verify"
                          : "Not checked yet"
                    }
                  </span>
                </div>

                {/* Native billing · coming soon · explicit · unchanged */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Plan management</span>
                  <span className="lc-settings-meta-value">Managed in your browser</span>
                </div>

                <p className="lc-settings-hint">
                  Refresh verifies your plan, access, billing provider, and
                  subscription status.
                </p>

                <div className="lc-settings-actions">
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    onClick={async () => {
                      /* P1-1G-b · refresh BOTH /sync (rotation +
                       *  toast) and /me (snapshot for tier/billing). */
                      await Promise.all([
                        handleRefreshAccount(),
                        me.reload(),
                      ]);
                    }}
                    disabled={refreshing || tier.loading || !hasLicense}
                    title={!hasLicense ? "Sign in first" : "Verify plan, billing, and subscription status"}
                  >
                    {refreshing || tier.loading ? "Refreshing…" : "Refresh to verify"}
                  </button>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    onClick={handleOpenExternal(WHOP_DASHBOARD_URL, "Whop")}
                    title="Manage Whop membership in your browser · payouts + reward state live there"
                  >
                    Manage on Whop ↗
                  </button>
                </div>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 5 · Whop role */}
          <EngineErrorBoundary route="settings" component="WhopRole">
            <section className="lc-settings-card" data-tab="payouts">
              <span className="lc-settings-card-eb">What Whop does · what Liquid Clips does</span>
              <div className="lc-settings-prose">
                <p>
                  <strong>Whop</strong> handles reward submission, tracking,
                  approval, and payout for Whop-backed campaigns. We never write
                  submission state or payouts inside Liquid Clips.
                </p>
                <p>
                  <strong>Liquid Clips</strong> handles campaign pages, briefs,
                  asset links, clip generation, scheduling, leaderboards, and
                  analytics. The campaign experience is ours · the money truth
                  is Whop's.
                </p>
                <p className="lc-settings-prose-small">
                  Reward creation, approval, and payout stay on Whop. Liquid
                  Clips keeps the creation and tracking workflow in one place.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 4 · Storage & security */}
          <EngineErrorBoundary route="settings" component="Storage">
            <section className="lc-settings-card" data-tab="advanced">
              <span className="lc-settings-card-eb">Storage &amp; security</span>
              <div className="lc-settings-rows">
                <SettingsRow
                  label="License source"
                  value={authSource === "tauri-keychain" ? "macOS Keychain" : "Browser localStorage"}
                  tone="muted"
                  mono
                />
                <SettingsRow
                  label="Roadmap"
                  value="macOS Keychain · P1-1F"
                  tone="muted"
                  mono
                />
                <p className="lc-settings-hint">
                  Kade · your license is stored locally for now · keychain lands
                  later. No provider secrets sit on this device.
                </p>
                <button
                  type="button"
                  className="lc-settings-cta lc-settings-cta-quiet"
                  onClick={handleClearActivation}
                  disabled={!hasLicense && activation.status === "idle"}
                  title={
                    !hasLicense && activation.status === "idle"
                      ? "No saved activation to clear"
                      : "Remove the saved license · forces re-activation on next launch"
                  }
                >
                  Clear local activation
                </button>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Payouts & Security · GET /me/carrot drives the rendered state.
              State machine:
                · carrotLoading → "Checking…" · spinner equivalent · no
                  action buttons rendered until the snapshot resolves.
                · carrot === null (backend unreachable / fetch errored) →
                  "Temporarily unavailable" · honest about the failure ·
                  action buttons HIDDEN so users don't fire RPCs against
                  a dead backend and get confusing toasts.
                · carrot exists, wallet not onboarded → "Not connected" +
                  Set up payouts CTA → POST /me/carrot/onboard.
                · carrot exists, wallet onboarded → "Connected · Whop
                  manages the wallet" + Manage payouts CTA →
                  POST /me/carrot/payouts-portal.
              Beta badge gates on `!carrot.is_live` to auto-hide when
              Railway flips CARROT_WHOP_LIVE=true. */}
          <EngineErrorBoundary route="settings" component="PayoutsAndSecurity">
            <section
              className="lc-settings-card"
              data-tab="payouts"
              data-testid="settings-payouts-card"
              data-carrot-state={
                carrotLoading ? "loading"
                : !carrot ? "unavailable"
                : carrot.wallet?.onboarded ? "onboarded"
                : "not-onboarded"
              }
            >
              <span className="lc-settings-card-eb">Payouts &amp; security</span>
              <div className="lc-settings-rows">
                <SettingsRow
                  label="Whop payout account"
                  value={
                    carrotLoading
                      ? "Checking…"
                      : !carrot
                        ? "Temporarily unavailable"
                        : carrot.wallet?.onboarded
                          ? "Connected · Whop manages the wallet"
                          : "Not connected"
                  }
                  tone={
                    !carrot
                      ? "warn"
                      : carrot.wallet?.onboarded
                        ? "live"
                        : "muted"
                  }
                />
                {carrot?.economics && (
                  <SettingsRow
                    label="Liquid Clips fee"
                    value={`${carrot.economics.lc_protocol_fee_pct}% · min withdraw $${carrot.economics.min_withdrawal_usd.toFixed(2)}`}
                    tone="muted"
                    mono
                  />
                )}
                <p className="lc-settings-hint">
                  {!carrot && !carrotLoading
                    ? "Kade · we couldn't reach the payouts service right now. Your earnings are still tracked · we'll retry on next launch."
                    : "Kade · we credit approved rewards to your Whop balance. Whop handles identity, KYC, and the actual transfer to your bank or crypto wallet."}
                </p>
                <div className="lc-settings-actions">
                  {/* Actions only render when we have a live carrot
                      snapshot to act on. Null state above already tells
                      the user the service is unavailable · firing
                      onboard/portal RPCs here would just emit confusing
                      toasts. */}
                  {carrot && !carrot.wallet?.onboarded && (
                    <button
                      type="button"
                      className="lc-settings-cta lc-settings-cta-primary"
                      data-testid="settings-carrot-onboard"
                      onClick={() => { void handleSetupPayouts(); }}
                      disabled={carrotBusy || carrotLoading}
                    >
                      {carrotBusy ? "Opening Whop…" : "Set up payouts on Whop ↗"}
                    </button>
                  )}
                  {carrot?.wallet?.onboarded && (
                    <button
                      type="button"
                      className="lc-settings-cta lc-settings-cta-secondary"
                      data-testid="settings-carrot-portal"
                      onClick={() => { void handleManagePayouts(); }}
                      disabled={carrotBusy}
                    >
                      {carrotBusy ? "Opening Whop…" : "Manage payouts on Whop ↗"}
                    </button>
                  )}
                  {/* Beta badge · gated on the backend's carrot.is_live flag
                      so it auto-hides the moment Railway flips
                      CARROT_WHOP_LIVE=true. Keeps the beta cohort eyes-open
                      about the mock-onboarding state until the real Whop
                      rail goes live. */}
                  {carrot && !carrot.is_live && (
                    <span
                      className="lc-payouts-beta-badge"
                      data-testid="settings-payouts-beta-badge"
                      aria-label="Beta · payouts opening soon"
                    >
                      Beta · payouts opening soon
                    </span>
                  )}
                </div>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 5 · Beta diagnostics */}
          <EngineErrorBoundary route="settings" component="Diagnostics">
            <section className="lc-settings-card" data-tab="advanced">
              <span className="lc-settings-card-eb">Beta diagnostics</span>
              <div className="lc-settings-rows">
                <SettingsRow label="Backend URL" value={backendUrl} mono />
                <SettingsRow label="Runtime" value={inTauri() ? "Desktop · Tauri" : "Browser preview"} mono />
                {/* 2026-06-25 · Runtime Update v1 · live frontend bundle version.
                    Reads runtime_info() Tauri command — staged bundle if
                    present, else bundled dist. */}
                <RuntimeVersionRow />
                <SettingsRow label="Storage source" value={authSource} mono />
                <div className="lc-settings-key-row">
                  <div>
                    <span className="lc-settings-key-label">JWT storage key</span>
                    <code className="lc-settings-key-code">{LICENSE_JWT_STORAGE_KEY}</code>
                  </div>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-quiet lc-settings-cta-compact"
                    onClick={handleCopyStorageKey}
                    aria-label="Copy JWT storage key name"
                    title="Copies the storage KEY NAME · never the token value"
                  >
                    {copyEcho ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="lc-settings-hint">
                  The token itself is never displayed. Copy the key name only ·
                  use it to inspect your own browser devtools if you need to.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 6 · Support contact · P1-3-a · beta blocker B1.
           *  Lives BEFORE Actions so a stuck user finds it without
           *  having to scroll past the Refresh button first. */}
          <EngineErrorBoundary route="settings" component="Support">
            <section className="lc-settings-card" data-tab="support">
              <span className="lc-settings-card-eb">Support &amp; help</span>
              <div className="lc-settings-rows">
                <p className="lc-settings-hint">
                  Kade · before you email, tap <em>Copy diagnostics</em> in the
                  next phase (lands in P1-3-f) so we can read the same state
                  you can.
                </p>

                {/* Support email · copy + open mail */}
                <div className="lc-settings-key-row">
                  <div>
                    <span className="lc-settings-key-label">Beta support email</span>
                    <code className="lc-settings-key-code">{SUPPORT_EMAIL}</code>
                  </div>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-quiet lc-settings-cta-compact"
                    onClick={handleCopySupportEmail}
                    aria-label="Copy support email"
                    title="Copy the address · doesn't open your mail client"
                  >
                    {emailCopyEcho ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="lc-settings-actions">
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    onClick={handleOpenMail}
                    title="Open your default mail client with the subject pre-filled"
                  >
                    Open mail client ↗
                  </button>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-secondary"
                    onClick={handleOpenExternal(DOCS_URL, "Docs")}
                    title="Open Liquid Clips docs in your browser"
                  >
                    Read docs ↗
                  </button>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-quiet"
                    onClick={handleOpenExternal(PRIVACY_URL, "Privacy")}
                  >
                    Privacy ↗
                  </button>
                  <button
                    type="button"
                    className="lc-settings-cta lc-settings-cta-quiet"
                    onClick={handleOpenExternal(TERMS_URL, "Terms")}
                  >
                    Terms ↗
                  </button>
                </div>

                <p className="lc-settings-hint">
                  Beta feedback channel · this is a beta. Bugs, weird states,
                  copy nits, world-feel notes · all welcome. We read every
                  email.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 7 · Actions */}
          <EngineErrorBoundary route="settings" component="Actions">
            <section className="lc-settings-card" data-tab="account">
              <span className="lc-settings-card-eb">Actions</span>
              <div className="lc-settings-actions">
                <button
                  type="button"
                  data-testid="settings-refresh-account"
                  className="lc-settings-cta lc-settings-cta-secondary"
                  onClick={handleRefreshAccount}
                  disabled={refreshing || !hasLicense}
                  title={!hasLicense ? "Sign in first" : "Re-fetch tier from the backend"}
                >
                  {refreshing ? "Refreshing…" : "Refresh account status"}
                </button>
                <button
                  type="button"
                  className="lc-settings-cta lc-settings-cta-secondary"
                  data-open-url="https://whop.com/dashboard/"
                  onClick={handleOpenWhop}
                >
                  Open Whop dashboard ↗
                </button>
              </div>
              <p className="lc-settings-hint">
                Kade · more actions (sign out · in-app sign in panel · native
                Keychain) land in a later phase. Today's beta keeps the surface
                small and honest.
              </p>
            </section>
          </EngineErrorBoundary>
          </div>
        </div>
      </fm.div>
    </DesignOSAppShell>
  );
}

/** Settings route entry point · provides the Engine session that
 *  drives Kade voice + per-route state, then renders the body inside
 *  the design-OS shell. Mirrors the Channels / Schedule pattern. */
export function SettingsRoute() {
  // Watchdog Rollout · id-06 shared (2026-07-06) · outer boundary
  // aggregates identity/id-06/settings-connections + id-07 profile
  // + id-08 notifications under one node. C2's inner ag-01 Agency-tab
  // Watchdog at :685 remains its own boundary; same-nodeId aggregation
  // applies at HQ Admin dashboard.
  return (
    <Watchdog
      id="identity/id-06/settings-body"
      label="Settings (connections · profile · notifications)"
      cluster="identity"
      source="src/design-os/routes/Settings.tsx:1494"
    >
      <EngineSessionProvider resetOnRouteEnter>
        <SettingsBody />
      </EngineSessionProvider>
    </Watchdog>
  );
}

/* ─── OpenAI key card (Batch C · 2026-06-20) ────────────────────────── */
/**
 * Free tier needs the user's OpenAI key for stage_llm (clip moment-finding).
 * Stored via Tauri Keychain commands (`openai_key_get` / `openai_key_set` /
 * `openai_key_delete` in src-tauri/src/lib.rs). The Python sidecar reads
 * the same Keychain entry via `python-sidecar/secrets_store.py` so no
 * Python change is needed.
 *
 * UI states:
 *   loading  → "Checking…" status, both buttons disabled
 *   saved    → "Saved · stays on this Mac" tone=live, Save (replace) + Remove
 *   missing  → "Not set · LLM stage will fail" tone=warn, Save only
 *
 * Web preview / no-Tauri fallback: shows "Studio preview · key entry needs
 * the desktop app" with the buttons disabled.
 */
/* 2026-06-24 · IG-014 mirror — was reading `openai_key_get` from Keychain
 * on every Settings mount, which triggered the macOS Keychain Access
 * prompt every time the user opened Settings. Now uses a localStorage
 * presence mirror — no Keychain read on mount, only on explicit user
 * action (Save / Remove). Rust and Python share the same presence file,
 * so the status cannot stay red after a successful save. */
const OPENAI_KEY_PRESENCE_FLAG = "lc.openai_key.present.v1";
function OpenAIKeyCard() {
  const [status, setStatus] = useState<"checking" | "saved" | "missing" | "unavailable">(() => {
    if (typeof window === "undefined") return "unavailable";
    if (!("__TAURI_INTERNALS__" in window)) return "unavailable";
    try {
      return window.localStorage.getItem(OPENAI_KEY_PRESENCE_FLAG) === "1" ? "saved" : "checking";
    } catch {
      return "checking";
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const presence = await invoke<Record<string, boolean>>("secret_presence_get");
        if (cancelled) return;
        const saved = presence.OPENAI_API_KEY === true;
        setStatus(saved ? "saved" : "missing");
        try {
          if (saved) window.localStorage.setItem(OPENAI_KEY_PRESENCE_FLAG, "1");
          else window.localStorage.removeItem(OPENAI_KEY_PRESENCE_FLAG);
        } catch { /* swallow */ }
      } catch {
        if (!cancelled) setStatus("missing");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    const key = draft.trim();
    if (!key) {
      bus.emit("toast", { kind: "warning", title: "Empty key", body: "Paste a key first." });
      return;
    }
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("openai_key_set", { key });
      try { window.localStorage.setItem(OPENAI_KEY_PRESENCE_FLAG, "1"); } catch { /* swallow */ }
      setStatus("saved");
      setDraft("");
      bus.emit("toast", { kind: "success", title: "OpenAI key saved", body: "Stored in your macOS Keychain." });
    } catch (e) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't save key",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("openai_key_delete");
      try { window.localStorage.removeItem(OPENAI_KEY_PRESENCE_FLAG); } catch { /* swallow */ }
      setStatus("missing");
      bus.emit("toast", { kind: "info", title: "OpenAI key removed", body: "stage_llm will fail until you add a new one." });
    } catch (e) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't remove key",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  let statusValue: string;
  let statusTone: "live" | "warn" | "muted";
  switch (status) {
    case "checking":
      statusValue = "Checking secure storage…";
      statusTone = "muted";
      break;
    case "saved":
      statusValue = "Saved · stays on this Mac";
      statusTone = "live";
      break;
    case "missing":
      statusValue = "Not set · required for clip analysis";
      statusTone = "warn";
      break;
    case "unavailable":
      statusValue = "Secure key storage is available in the desktop app";
      statusTone = "muted";
      break;
  }

  const disabled = busy || status === "checking" || status === "unavailable";

  return (
    <section className="lc-settings-card" data-tab="advanced">
      <span className="lc-settings-card-eb">OpenAI key</span>
      <div className="lc-settings-rows">
        <SettingsRow label="Status" value={statusValue} tone={statusTone} />
        <input
          type="password"
          placeholder="sk-..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          style={{
            background: "rgba(0,0,0,0.30)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "#f5f6fa",
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 12.5,
            padding: "9px 12px",
            outline: "none",
            opacity: disabled ? 0.55 : 1,
          }}
        />
        <p className="lc-settings-degraded" style={{ marginTop: 4 }}>
          Required on Free tier for clip moment-finding. Pro tier (hosted compute)
          ships after the engine port. Key never leaves your machine.
        </p>
        <div className="lc-settings-actions">
          <button
            type="button"
            className="lc-settings-cta lc-settings-cta-secondary"
            onClick={() => void onSave()}
            disabled={disabled || draft.trim().length === 0}
            title={
              disabled
                ? "Sign in first"
                : draft.trim().length === 0
                  ? "Enter your API key first"
                  : undefined
            }
            style={disabled || draft.trim().length === 0 ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
          >
            {status === "saved" ? "Replace key" : "Save key"}
          </button>
          {status === "saved" && (
            <button
              type="button"
              className="lc-settings-cta lc-settings-cta-quiet"
              onClick={() => void onDelete()}
              disabled={busy}
              style={busy ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
            >
              Remove key
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── Runtime version row (Runtime Update v1 · Phase 1) ──────────────
 *
 * 2026-06-25 · reads `runtime_info()` Tauri command. Active bundle
 * version + source (bundled vs staged) + last-check status + a "Check
 * now" button that forces an immediate manifest poll. Listens for the
 * `lc:runtime-staged` Tauri event so the row refreshes the moment a
 * new bundle is staged (no polling). See `src-tauri/src/runtime.rs`. */
interface RuntimeInfoShape {
  active_version: string;
  source: "bundled" | "staged" | string;
  staged_bundle_path: string | null;
  last_check: { at: string; result: string; manifest_version: string | null } | null;
  manifest_url: string;
  channel: string;
}

function RuntimeVersionRow() {
  const [info, setInfo] = useState<RuntimeInfoShape | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      setUnavailable(true);
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<RuntimeInfoShape>("runtime_info");
      setInfo(data);
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => {
    void refresh();
    let cleanup: (() => void) | undefined;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("lc:runtime-staged", () => void refresh());
        cleanup = off;
      })();
    }
    return () => { if (cleanup) cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCheckNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("runtime_check_now");
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[runtime] check_now failed:", e);
    } finally {
      setBusy(false);
    }
  };

  if (unavailable) {
    return <SettingsRow label="Runtime version" value="Browser preview" mono />;
  }
  if (!info) {
    return <SettingsRow label="Runtime version" value="checking…" mono />;
  }

  const sourceLabel = info.source === "staged" ? "hosted runtime" : "bundled with app";
  const value = `${info.active_version} · ${sourceLabel}`;
  const lastCheck = info.last_check?.result ?? "never";

  return (
    <>
      <SettingsRow label="Runtime version" value={value} mono tone={info.source === "staged" ? "live" : "muted"} />
      <SettingsRow label="Last runtime check" value={lastCheck} mono />
      <div className="lc-settings-key-row">
        <div>
          <span className="lc-settings-key-label">Runtime channel</span>
          <code className="lc-settings-key-code">{info.channel}</code>
        </div>
        <button
          type="button"
          className="lc-settings-cta lc-settings-cta-quiet lc-settings-cta-compact"
          onClick={onCheckNow}
          disabled={busy}
          aria-label="Check for runtime update"
          title="Force an immediate /runtime/manifest.json poll"
        >
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>
    </>
  );
}

/* ─── Primitives (co-located for cohesion) ──────────────────────────── */

interface SettingsRowProps {
  label: string;
  value: string;
  /** Visual tone of the value. */
  tone?: "live" | "warn" | "muted";
  /** Render value as a Geist Mono pill (used for tier). */
  pill?: boolean;
  /** Render value in monospace (URLs, source labels). */
  mono?: boolean;
}

function SettingsRow({ label, value, tone = "muted", pill, mono }: SettingsRowProps) {
  return (
    <div className="lc-settings-row">
      <span className="lc-settings-row-label">{label}</span>
      {pill ? (
        <span className="lc-settings-row-pill">{value}</span>
      ) : (
        <span className={`lc-settings-row-value tone-${tone} ${mono ? "is-mono" : ""}`}>
          {value}
        </span>
      )}
    </div>
  );
}
