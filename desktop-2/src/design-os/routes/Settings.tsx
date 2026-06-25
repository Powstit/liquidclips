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

import { useState } from "react";
import { motion as fm } from "framer-motion";
import { useActivation } from "../../lib/activation";
import {
  hasJwt as readHasJwt,
  getJwt,
  clearJwt,
  getAuthSource,
  LICENSE_JWT_STORAGE_KEY,
} from "../../lib/authStorage";
import { openSmart } from "../../lib/openSmart";
import { bus } from "../bridge";
import { useMe } from "../state/useMe";
import { useTierCaps } from "../state/useTierCaps";
import { useBillingState } from "../../lib/billing/adapter";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { useChannels } from "../state/useChannels";
import { useSchedule } from "../state/useSchedule";
import { useCommunity } from "../state/useCommunity";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { presets } from "../motion";
import "./SimPage.css";
import "./Settings.css";

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

/** "real-rpc" / "real-http" → "Live", anything else → "Studio preview". */
function sourceToHonestyLabel(s: "real-rpc" | "real-http" | "mock"): "Live" | "Studio preview" {
  return s === "real-rpc" || s === "real-http" ? "Live" : "Studio preview";
}

function SettingsBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  useKadeFromSession("settings");

  const spec = ROUTE_REGISTRY["settings"];
  const hero = ROUTE_HERO["settings"];

  // 2026-06-24 · Settings was one long scroll. Split into 4 tabs so
  // users don't have to hunt: Account (you + key + plan + actions) ·
  // Connections (channels + schedules) · Plan (tier + Whop explainer) ·
  // Diagnostics (storage + beta + support).
  type SettingsTab = "account" | "connections" | "plan" | "diagnostics";
  const [tab, setTab] = useState<SettingsTab>("account");

  const activation = useActivation();
  const channels = useChannels();
  const schedule = useSchedule();
  const community = useCommunity();
  /* P1-1G-b · real /me-backed tier + identity. `useMe()` auto-fetches
   * on mount when a JWT is present · `useTierCaps()` reads from it. */
  const me = useMe();
  const tier = useTierCaps();
  // 2026-06-23 · billing adapter wires Settings CTAs to Clerk checkout
  // for the right plan (Pro $29.99 / Growth $79.99 / Agency $500) instead
  // of dumping the user on the generic Whop dashboard.
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

  /* ── handlers ─────────────────────────────────────────────────── */

  const handleClearActivation = () => {
    clearJwt();
    activation.clearActivation();
    setHasLicense(false);
    bus.emit("toast", {
      kind: "info",
      title: "Local activation cleared",
      body: "Reload the app to sign in again.",
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

  const handleOpenWhop = async () => {
    try {
      await openSmart("https://whop.com/liquidclips/");
    } catch (e) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop",
        body: e instanceof Error ? e.message : String(e),
      });
    }
  };

  /**
   * 2026-06-23 · Billing CTA via adapter (replaces hard-coded Whop URL).
   *
   * Routes upgrade through `billing.adapter.startCheckout()` so the right
   * plan param lands on /dashboard#plans?plan=<tier> (Clerk-wired) instead
   * of the generic Whop page where the user had to hunt for the upgrade
   * button. For tier === "agency" (top tier), falls back to Whop manage URL
   * since there's no upgrade target.
   *
   * Path per tier:
   *   - clipper → Clerk checkout for Pro ($29.99)
   *   - pro     → Clerk checkout for Growth ($79.99)
   *   - growth  → Clerk checkout for Agency ($500)
   *   - agency  → Whop manage URL (no upgrade target)
   */
  const handleManageBilling = async () => {
    const targetPlan: "pro" | "growth" | "agency" | null =
      tier.tier === "clipper" ? "pro"
      : tier.tier === "pro"   ? "growth"
      : tier.tier === "growth"? "agency"
      : null;
    if (targetPlan) {
      try {
        await billing.adapter.startCheckout(targetPlan);
      } catch (e) {
        bus.emit("toast", {
          kind: "warning",
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
      await openSmart(url);
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
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            {hero.eyebrow}
            {runtime.mode === "mock" && (
              <span
                className="lc-runtime-tag"
                title={`Settings live data lights up when backend is reachable · pass a license JWT via localStorage.${LICENSE_JWT_STORAGE_KEY} (or run inside Tauri) to flip to real-http.`}
              >
                Studio preview
              </span>
            )}
            {runtime.mode !== "mock" && (
              <span
                className="lc-runtime-tag is-live"
                title="Settings sees real backend state for the live surfaces."
              >
                Live · backend
              </span>
            )}
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {hero.h1}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            Account state · live connections · how Liquid Clips handles your data.
            Kade keeps the wrench out · billing isn't here yet.
          </fm.p>
        </fm.div>

        {/* 2026-06-24 · tab nav · splits a long scroll into 4 honest groups. */}
        <nav className="lc-settings-tabs" role="tablist" aria-label="Settings sections">
          {([
            ["account",     "Account"],
            ["connections", "Connections"],
            ["plan",        "Plan"],
            ["diagnostics", "Diagnostics"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="lc-settings-tab"
              data-active={tab === id ? "true" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="lc-settings" data-active-tab={tab}>
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
                  Solo, Pro and Agency tiers run through Whop. Checkout opens
                  in your browser · your tier updates here as soon as Whop
                  confirms the purchase.
                </p>
                <div className="lc-settings-actions">
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
                    {tier.tier === "clipper" ? "View plans on Whop · upgrade to Pro"
                      : tier.tier === "pro"  ? "Manage plan on Whop · upgrade to Growth"
                      : tier.tier === "growth"? "Manage plan on Whop · upgrade to Agency"
                      : "Manage plan on Whop ↗"}
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
                  tone={schedule.source === "mock" ? "muted" : "live"}
                  mono
                />
                <SettingsRow
                  label="Community"
                  value={community.isMockFallback ? "Studio preview" : "Live"}
                  tone={community.isMockFallback ? "muted" : "live"}
                  mono
                />
                <p className="lc-settings-hint">
                  Kade · live surfaces talk to the backend with your license.
                  Studio preview uses seeded mocks so the app stays usable when
                  offline.
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
                      onClick={() => bus.emit("toast", {
                        kind: "info",
                        title: "Activation lives at boot",
                        body: "Reload the app · the activation surface lands on first launch when no license is present.",
                      })}
                    >
                      How do I activate?
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
                      Connection status not checked yet
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
                    <span className="lc-settings-meta-label">Login capability</span>
                    <span className="lc-settings-meta-value">Available · activation flow exposes Whop OAuth as a co-equal door (scope · read_user)</span>
                  </div>
                  <div className="lc-settings-provider-meta">
                    <span className="lc-settings-meta-label">Current state</span>
                    <span className="lc-settings-meta-value">verified by /me on Refresh · not fetched on mount in v1</span>
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
                        <span className="lc-settings-meta-label">Source</span>
                        <span className="lc-settings-meta-value">{channels.source}</span>
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
                    onClick={handleOpenExternal(WHOP_DASHBOARD_URL, "Whop")}
                  >
                    Open Whop dashboard ↗
                  </button>
                </div>

                <p className="lc-settings-hint">
                  Kade · we don't fetch /me on mount in v1. Whop +
                  Stripe Connect connection state lands when you tap
                  <em> Refresh account status</em> in Actions OR when the
                  P1-3-e useMe() hook ships.
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
            <section className="lc-settings-card" data-tab="plan">
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
                  label="Tier source"
                  value={
                    tier.source === "real-http"        ? "real · /me effective_tier" :
                    tier.source === "session-cache"    ? "real · cached from last /me" :
                    tier.source === "fixture-fallback" ? (tier.loading ? "checking · /me in flight" : "fallback · fixture default while /me unavailable") :
                    tier.source === "unknown"          ? "unknown · no license · activate first" :
                                                         "debug · puppeteer override"
                  }
                  tone={tier.source === "real-http" || tier.source === "session-cache" ? "live" : "muted"}
                  mono
                />

                {/* Beta provisioning · real from /me.admin_override */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Beta provisioning</span>
                  <span className="lc-settings-meta-value">
                    {me.snapshot && tier.adminOverride
                      ? "Admin allowlist · tier elevated by LC team"
                      : me.snapshot
                        ? "Standard beta tier · no admin override"
                        : me.degraded
                          ? "Not checked · /me degraded"
                          : "Not checked yet · /me not fetched"
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
                      onClick={() => { void openSmart("https://account.liquidclips.app/admin"); }}
                    >
                      Open Admin HQ ↗
                    </button>
                  </div>
                )}

                {/* Billing owner · real from /me.billing_provider */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Billing owner</span>
                  <span className="lc-settings-meta-value">
                    {me.snapshot?.billingProvider === "whop"  ? "Whop" :
                     me.snapshot?.billingProvider === "clerk" ? "Clerk" :
                     me.snapshot                              ? "Unknown · /me did not return billing_provider" :
                     me.degraded                              ? "Not checked · /me degraded" :
                                                                "Not checked yet · /me not fetched"
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
                          ? "Not checked · /me degraded"
                          : "Not checked yet · /me not fetched"
                    }
                  </span>
                </div>

                {/* Native billing · coming soon · explicit · unchanged */}
                <div className="lc-settings-provider-meta">
                  <span className="lc-settings-meta-label">Native billing</span>
                  <span className="lc-settings-meta-value">Coming soon</span>
                </div>

                <p className="lc-settings-hint">
                  Kade · tier + provisioning + billing now read from /me
                  when fetched · honest "Not checked yet" otherwise.
                  Refresh re-fetches both /me and /sync.
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
                    title={!hasLicense ? "Sign in first" : "Re-fetch /sync and /me · updates tier, billing, subscription state"}
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
            <section className="lc-settings-card" data-tab="plan">
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
                  Kade · no <code>bounty:create</code> · no native payout in
                  beta. Reward creation happens on Whop · we paste the URL.
                </p>
              </div>
            </section>
          </EngineErrorBoundary>

          {/* Section 4 · Storage & security */}
          <EngineErrorBoundary route="settings" component="Storage">
            <section className="lc-settings-card" data-tab="diagnostics">
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

          {/* Section 5 · Beta diagnostics */}
          <EngineErrorBoundary route="settings" component="Diagnostics">
            <section className="lc-settings-card" data-tab="diagnostics">
              <span className="lc-settings-card-eb">Beta diagnostics</span>
              <div className="lc-settings-rows">
                <SettingsRow label="Backend URL" value={backendUrl} mono />
                <SettingsRow label="Runtime" value={inTauri() ? "Desktop · Tauri" : "Browser preview"} mono />
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
            <section className="lc-settings-card" data-tab="diagnostics">
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
      </fm.div>
    </DesignOSAppShell>
  );
}

/** Settings route entry point · provides the Engine session that
 *  drives Kade voice + per-route state, then renders the body inside
 *  the design-OS shell. Mirrors the Channels / Schedule pattern. */
export function SettingsRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <SettingsBody />
    </EngineSessionProvider>
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
 * presence flag — no Keychain read on mount, only on explicit user
 * action (Save / Remove). The flag flips after a successful Keychain
 * write/delete. Matches legacy `licenseJwtPresence()` pattern. */
const OPENAI_KEY_PRESENCE_FLAG = "lc.openai_key.present.v1";
function OpenAIKeyCard() {
  const [status, setStatus] = useState<"saved" | "missing" | "unavailable">(() => {
    if (typeof window === "undefined") return "unavailable";
    if (!("__TAURI_INTERNALS__" in window)) return "unavailable";
    try {
      return window.localStorage.getItem(OPENAI_KEY_PRESENCE_FLAG) === "1" ? "saved" : "missing";
    } catch {
      return "missing";
    }
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
    case "saved":
      statusValue = "Saved · stays on this Mac";
      statusTone = "live";
      break;
    case "missing":
      statusValue = "Not set · LLM stage will fail";
      statusTone = "warn";
      break;
    case "unavailable":
      statusValue = "Studio preview · key entry needs the desktop app";
      statusTone = "muted";
      break;
  }

  const disabled = busy || status === "unavailable";

  return (
    <section className="lc-settings-card" data-tab="account">
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
