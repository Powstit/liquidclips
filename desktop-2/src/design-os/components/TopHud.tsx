/**
 * TopHud · the top compact glass-pill bar
 *
 * Phase 4B-rev rule: NEVER DSEG here. Pills are Inter + Geist Mono small caps.
 * Collision rule: each pill flex-shrinks/min-widths so the search expands and
 * fixed pills hold their own.
 *
 * UI-1 · adds the Clipper / Agency mode pill between News and Streak. Mode
 * is persisted in localStorage ("lc.mode") and broadcast on `mode:change`
 * so workstation defaults can adapt in UI-2.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bus, useEvent, type AppMode } from "../bridge";
import { clearJwt, clearJwtKeychainForAuthAction } from "../../lib/authStorage";
import { useAuth } from "../../lib/useAuth";
import { useRuntimeVersion } from "../../lib/useRuntimeVersion";
import { clearActivation } from "../../lib/activation";
import { hardRefresh } from "../../lib/hardRefresh";
import { unreadCount } from "../../inbox";
import { InboxSheet } from "../../shell/InboxSheet";
import { TrialStatusPill } from "./TrialStatusPill";
import { useTierCaps } from "../state/useTierCaps";
import { useMe } from "../state/useMe";
import { connectWhop } from "../../lib/whopConnect";
import { openWhopFounderCheckout } from "../../lib/whopCheckout";
import { lcDiag } from "../../lib/diagnosticLogger";
// Watchdog Rollout · id-02 (2026-07-06) · wraps the "Sign in" pill so
// a crash in the sign-in click handler renders KadeRepairScreen instead
// of white-screening the whole TopHud. Failures dispatch to HQ Admin
// for the Intercession LLM. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import "./TopHud.css";

// RC1 · P1-C (2026-07-11) — the `declare const __APP_VERSION__` was
// removed. The version pill now reads through `useRuntimeVersion()`
// which resolves the shell fallback internally when Tauri IPC is
// unavailable.

const MODE_STORAGE_KEY = "lc.mode";
const MODE_TOGGLED_BY_USER_KEY = "lc.mode-toggled-by-user";

function readPersistedMode(): AppMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return raw === "agency" ? "agency" : "clipper";
  } catch { return "clipper"; }
}

/**
 * 2026-07-05 · Whether the localStorage mode key was set BEFORE this
 * mount. Used by the tier-driven auto-flip effect to decide whether we
 * should nudge the user into Agency mode. Read at MODULE eval time
 * (via useRef initializer at mount) so the write effect at line 79
 * can't clobber the snapshot.
 */
function readPersistedModeRaw(): string | null {
  try { return window.localStorage.getItem(MODE_STORAGE_KEY); }
  catch { return null; }
}

function readUserToggledFlag(): boolean {
  try { return window.sessionStorage.getItem(MODE_TOGGLED_BY_USER_KEY) === "1"; }
  catch { return false; }
}

export interface TopHudProps {
  greetingEyebrow?: string;
  /** Free-form right-hand chips. Daniel: keep small. */
  newsCount?: number;
  streakDays?: number;
}

export function TopHud({
  greetingEyebrow = "Good evening ✦",
  // Beta-honest default — until an Inbox/Notifications surface ships in DOS,
  // we don't fake a NEWS count. The chip stays hidden when count is 0, and
  // re-appears the moment a real notifications hook starts pushing values.
  // Pairs with `Phase 6E-NewsChip-Hide` in TopHud.tsx render branch below.
  newsCount = 0,
  streakDays,
}: TopHudProps) {
  // RC1 state-drift trifecta · P0-2 (2026-07-11) — `userName`,
  // `userTier`, and `greetingName` props deleted. They enabled callers
  // to pass hardcoded "Free" / "Guest" strings that stayed on-screen
  // for signed-in users forever. Identity is now derived exclusively
  // from `useMe()` + `useTierCaps()` so TopHud can never disagree with
  // SideNav / SplashLeaderboard / MembershipGate.
  const tierCaps = useTierCaps();
  // 2026-07-05 · beta-walk P0 · TopHud rendered "Free" for every user
  // regardless of actual tier because the shell mounts <TopHud /> with
  // no tier prop. `platformRole === "admin"` shows "Admin" so Daniel
  // recognises himself instead of the mislabelled "Free". Otherwise
  // the honest label is the current tier name ("clipper" renders as
  // "Free" since that's the customer-facing name of the tier).
  const resolvedTier = (() => {
    if (tierCaps.platformRole === "admin") return "Admin";
    if (tierCaps.tier === "clipper") return "Free";
    return tierCaps.tier.charAt(0).toUpperCase() + tierCaps.tier.slice(1);
  })();
  const [mode, setMode] = useState<AppMode>(() => readPersistedMode());

  /**
   * 2026-07-05 · Snapshot of the persisted mode + user-toggled flag
   * captured ONCE at first mount. The write effect below runs on every
   * mode change so the raw localStorage value gets overwritten
   * immediately; keeping the mount-time snapshot in a ref lets the
   * auto-flip effect below know whether the user had a preference
   * BEFORE we ever wrote anything. If the ref is `null` here, the
   * mode key was empty (fresh install OR key cleared) — safe to nudge.
   */
  const persistedAtMountRef = useRef<string | null>(readPersistedModeRaw());
  const userToggledAtMountRef = useRef<boolean>(readUserToggledFlag());

  // Feature-honesty sweep · 2026-07-09 — the previous ⌘F focus listener
  // + Enter "coming soon" toast made the search feel active. It wasn't:
  // no backend index exists. Ref kept so future search wiring can reattach.
  // Cmd-F listener removed entirely; the kbd hint chip is also gone from
  // render below so the surface stops lying.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* noop */ }
    bus.emit("mode:change", { mode });
  }, [mode]);

  /**
   * 2026-07-05 · Auto-flip mode based on tier for first-launch users.
   *
   * Problem the fix solves: `tier` (from Whop plan) and `mode` (UI
   * pill) are independent axes. Founder Access buyers land on
   * `tier=agency` (via `apply_membership_tier(tier="autopilot")`) but
   * `mode` defaults to `"clipper"` because that's the localStorage
   * fallback. Agencies paying $99.99/mo would see Clipper chrome and
   * never discover the campaign builder / roster / invite tools they
   * bought.
   *
   * Rule:
   *   - Only nudge when tier data is REAL (real-http OR session-cache).
   *   - Only nudge when user has NOT persisted a mode preference from
   *     a prior session (persistedAtMountRef.current === null).
   *   - Only nudge when user has NOT manually toggled the pill this
   *     session (userToggledAtMountRef.current === false).
   *   - Agency tier OR admin platformRole → mode = "agency".
   *
   * After the nudge, subsequent user toggles are respected forever
   * (the write effect above persists the choice + userToggled flag).
   */
  useEffect(() => {
    if (tierCaps.source !== "real-http" && tierCaps.source !== "session-cache") return;
    if (persistedAtMountRef.current !== null) return;
    if (userToggledAtMountRef.current) return;
    const isAgencyLevel =
      tierCaps.tier === "agency" || tierCaps.platformRole === "admin";
    if (isAgencyLevel && mode !== "agency") {
      setMode("agency");
    }
  }, [tierCaps.source, tierCaps.tier, tierCaps.platformRole, mode]);

  /* 2026-06-26 · C2 hardening · TopHud's mode state used to be write-only
   * (emit mode:change when its own pill flipped, but never listen). That
   * left the .on class out-of-sync with any external mode flip — the
   * splash-and-agency-palette test emits mode:change programmatically
   * via window.__lcBus and the pill stayed on the prior mode. Subscribe
   * so external flips reach the pill render. setMode is idempotent for
   * the same value, so the round-trip with the emit effect above does
   * not create a feedback loop. */
  useEvent("mode:change", (p) => setMode(p.mode));

  // BUG-046 · the user pill in TopHud is the customer-visible avatar
  // affordance on every Design OS route. Until now it was a decorative
  // div — Settings was unreachable from the chrome. Convert into a real
  // dropdown menu (Settings / Notifications / Sign out · the last item
  // only when a JWT is actually present).
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unread, setUnread] = useState<number>(() => unreadCount());
  // P0-3 (RC1 state-drift trifecta · 2026-07-11) — was a local
  // `useState(!!getJwt())` + local bus/storage listener. Every consumer
  // that duplicated that pattern drifted from every other consumer on
  // signin. `useAuth()` is the canonical module-scope subscriber; every
  // caller now flips on the same tick.
  const { hasJwt } = useAuth();
  // RC1 · P1-C (2026-07-11) — was `__APP_VERSION__` (shell build-time
  // constant). Reads the ACTIVE runtime bundle version in Tauri; falls
  // back to the shell version in browser preview.
  const runtimeVersion = useRuntimeVersion();
  const menuRootRef = useRef<HTMLDivElement>(null);

  /* R7 · 2026-07-11 · 4-state identity pill derivation.
   * Reads the same canonical sources SideNav does so both surfaces
   * never drift:
   *   - `hasJwt` (via getJwt() + auth bus events above)
   *   - `useMe().snapshot.whopUserId` — null until Whop is linked
   *   - `useTierCaps().tier` — "agency" only when trusted-source
   *   - `useMe().snapshot.email` — for the @handle state
   *
   * Copy strings are Daniel-locked (see MAX_HANDOFF spec):
   *   noJwt          → "Start free · 10 clips"
   *   jwtNoWhop      → "Connect Whop"
   *   jwtWhopNonAgcy → "Unlock Agency · $99.99"
   *   agency         → "@handle · Agency"
   */
  const me = useMe();
  const handleFromEmail = useMemo(() => {
    const raw = me.snapshot?.email;
    if (!raw) return null;
    const local = raw.split("@")[0]?.trim();
    return local && local.length > 0 ? local : null;
  }, [me.snapshot?.email]);

  const identityState = useMemo<"noJwt" | "connectWhop" | "unlockAgency" | "agency">(() => {
    if (!hasJwt) return "noJwt";
    // Agency wins over "connect whop" — an agency user by definition
    // has a Whop link that resolved to the agency tier server-side.
    const trusted = tierCaps.source === "real-http" || tierCaps.source === "session-cache";
    if (trusted && tierCaps.tier === "agency") return "agency";
    if (!me.snapshot?.whopUserId) return "connectWhop";
    return "unlockAgency";
  }, [hasJwt, tierCaps.source, tierCaps.tier, me.snapshot?.whopUserId]);

  const identityCopy = useMemo(() => {
    switch (identityState) {
      case "noJwt":         return "Start free · 10 clips";
      case "connectWhop":   return "Connect Whop";
      case "unlockAgency":  return "Unlock Agency · $99.99";
      case "agency":        return handleFromEmail
        ? `@${handleFromEmail} · Agency`
        : "Agency";
    }
  }, [identityState, handleFromEmail]);

  // R7 · 2026-07-11 · identity pill click dispatcher.
  // Each of the 4 identity states routes to its real action:
  //   noJwt         → auth:open-panel (SimpleLoginPanel · email OTP)
  //   connectWhop   → connectWhop() (Whop OAuth via existing helper)
  //   unlockAgency  → openWhopFounderCheckout() (Agency $99.99 checkout)
  //   agency        → open the avatar menu (Account surface)
  // Every branch fires an audit tick + lcDiag so telemetry lands.
  const identityClick = useCallback(() => {
    try { lcDiag("identity_pill_clicked", { state: identityState }); } catch { /* non-fatal */ }
    switch (identityState) {
      case "noJwt":
        // R7 spec (Daniel-locked): noJwt click opens the SimpleLoginPanel
        // / OTP flow — NOT the Whop hosted checkout. WelcomeGate owns
        // the OTP surface; it un-mounts once `lc:welcome-acked` = "1"
        // OR a JWT lands. Sign-out semantics already re-mount it:
        // clear the ack flag + emit `auth:signed-out`, and WelcomeGate
        // flips acked=false → renders WelcomeRoute → SimpleLoginPanel.
        try {
          window.localStorage.removeItem("lc:welcome-acked");
        } catch { /* honest no-op */ }
        bus.emit("auth:signed-out", { reason: "manual" });
        break;
      case "connectWhop":
        void connectWhop().catch((e) => {
          bus.emit("toast", {
            kind: "error",
            title: "Couldn't open Whop",
            body: e instanceof Error ? e.message : "Please try again.",
          });
        });
        break;
      case "unlockAgency":
        void openWhopFounderCheckout();
        break;
      case "agency":
        setMenuOpen((v) => !v);
        break;
    }
    // Fire-and-forget audit tick so telemetry lands without blocking
    // the click. `void` is intentional; failures are silent.
    void fetch(`${(import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL ?? "https://api.liquidclips.app"}/audit/tick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action_id: `identity.${identityState}`, surface: "TopHud" }),
    }).catch(() => { /* silent · click doesn't wait on telemetry */ });
  }, [identityState]);

  /* FEATURE-001 · subscribe to inbox bus events so the badge updates
   * even when the InboxSheet is closed. Without this, the badge would
   * only refresh through the InboxSheet's onUnreadChange callback,
   * which means a new notification arriving in the background would
   * leave the badge stale until the user opens the sheet. */
  useEffect(() => {
    const refresh = () => setUnread(unreadCount());
    const off1 = bus.on("inbox:added", refresh);
    const off2 = bus.on("inbox:read", refresh);
    return () => { off1(); off2(); };
  }, []);

  /* P0-3 (RC1 state-drift trifecta · 2026-07-11) — the local bus + storage
   * subscribers previously installed here migrated to the module-scope
   * `useAuth()` hook (`src/lib/useAuth.ts`). One listener network for
   * every consumer eliminates the R7 "TopHud updated but SideNav / Editor
   * still show Guest" drift. Prior implementation preserved in git
   * history — the useAuth hook subscribes to the same three events
   * (`activation:complete` · `auth:signed-in` · `auth:signed-out`) plus
   * the cross-tab `storage` event. */

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRootRef.current) return;
      if (!menuRootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const goSettings = () => {
    setMenuOpen(false);
    bus.emit("nav:click", { route: "settings" });
  };
  const goNotifications = () => {
    setMenuOpen(false);
    setInboxOpen(true);
  };
  const doSignOut = () => {
    setMenuOpen(false);
    try { clearJwt(); } catch { /* honest no-op */ }
    // 2026-07-07 · cold-open lens P0-001 · clearJwt only wipes memory
    // + localStorage; the Keychain copy survived, so the next cold boot
    // rehydrated the stale JWT via resumeJwtFromKeychainForAuthAction
    // and WelcomeGate saw hasJwt() true → bypassed the login screen.
    // Fire-and-forget is fine: the presence file is authoritative for
    // rehydration, and Tauri invoke resolves before the next boot.
    void clearJwtKeychainForAuthAction();
    // 2026-07-07 · cold-open lens P0-002 · WelcomeGate + guest state
    // is keyed on these localStorage flags. Without clearing them, a
    // signed-out user drops straight into the anonymous shell instead
    // of the WelcomeRoute.
    try {
      window.localStorage.removeItem("lc:welcome-acked");
      window.localStorage.removeItem("lc:guest-mode");
      window.localStorage.removeItem("lc:guest-clips-remaining");
      window.localStorage.removeItem("lc:cold-lead-context");
      window.localStorage.removeItem("lc:checkout-email");
      window.localStorage.removeItem("lc:discount-code");
    } catch { /* honest no-op */ }
    try { clearActivation(); } catch { /* honest no-op */ }
    // P0-3 (RC1 · 2026-07-11) — removed `setHasJwt(false)`. `useAuth()`
    // now owns the flip; the `auth:signed-out` emit below cascades
    // through the module-scope subscriber and every consumer (TopHud,
    // MembershipGate, App, SplashLeaderboard) re-renders on the same
    // tick.
    // 2026-07-05 · beta-walk P0 · previously the toast copy told the
    // user to "reload the app to sign in again" — there's no reload
    // affordance in a Tauri window, so this stranded them. Instead,
    // emit `auth:signed-out` which the AuthGate listens for and
    // re-checks hasJwt() — that flips the shell back to
    // LoginActivation which already renders a working "Sign in with
    // Whop" CTA (wired through useAuthPanelBridge).
    bus.emit("auth:signed-out", {});
    bus.emit("toast", {
      kind: "info",
      title: "Signed out",
      body: "You're back at the sign-in screen.",
    });
  };

  return (
    <header className="lc-hud">
      <div className="lc-hud-greet">
        <span className="lc-hud-greet-eb">{greetingEyebrow}</span>
        {/* RC1 · P0-2 (2026-07-11) — greetingName prop deleted. Greeting
         *  reads @handle from useMe (mirrors SideNav identity strip) so
         *  the copy never claims "Guest" for a signed-in user. */}
        <span className="lc-hud-greet-name">
          {handleFromEmail ? `@${handleFromEmail}` : "Guest"}
        </span>
      </div>

      {/* Feature-honesty sweep · 2026-07-09 — search box was previously
       *  active-looking (accepted input, ⌘F focus, "coming soon" toast on
       *  Enter). No backend index exists. Now visually disabled:
       *   - `disabled` attr blocks input focus + typing entirely
       *   - opacity + `not-allowed` cursor signal dead surface
       *   - honest placeholder + title tooltip explain the state
       *   - kbd hint chip removed (nothing to trigger) */}
      <div
        className="lc-pill lc-pill-search is-disabled"
        title="Search lands in the next release · pick a route from the sidebar for now"
        data-testid="hud-search-disabled"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          placeholder="Search · lands in the next release"
          aria-label="Search (coming in the next release)"
          disabled
          aria-disabled="true"
          tabIndex={-1}
          readOnly
          value=""
        />
      </div>

      <div
        className="lc-pill lc-pill-mode"
        role="radiogroup"
        aria-label="App mode"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "clipper"}
          className={`lc-hud-mode-opt ${mode === "clipper" ? "on" : ""}`}
          onClick={() => {
            // 2026-06-23 · mark explicit user toggle so AgencyPreviewBanner
            // fires its first-time notification only on real intent, not
            // programmatic mode flips from tests or deep-link routes.
            try { window.sessionStorage.setItem("lc.mode-toggled-by-user", "1"); } catch { /* noop */ }
            setMode("clipper");
          }}
        >Clipper</button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "agency"}
          className={`lc-hud-mode-opt ${mode === "agency" ? "on" : ""}`}
          onClick={() => {
            try { window.sessionStorage.setItem("lc.mode-toggled-by-user", "1"); } catch { /* noop */ }
            setMode("agency");
          }}
        >Agency</button>
      </div>

      {/* Phase 6E-NewsChip-Hide — the inbox surface isn't wired yet, so a
          static "2 NEWS" chip is just a dead counter. Render only when a
          real signal pushes the count above zero (and at that point also
          wire an onClick to the inbox route — TBD). */}
      {newsCount > 0 && (
        <div className="lc-pill" role="status">
          <span className="lc-hud-dot" />
          <span>{newsCount} NEWS</span>
        </div>
      )}

      {/* v2.2.15 · trial countdown pill. Hides for paid users + non-trial
       *  states · so the workstation baseline (Guest/Free) doesn't drift. */}
      <TrialStatusPill />

      {/* 2026-07-05 · 2.2.24 · dummy-data purge. streakDays default
          was hardcoded to 7 · every user saw a fake "7 day" streak
          regardless of actual activity. Chip now hides when the prop
          is undefined and only renders when real streak data hydrates. */}
      {typeof streakDays === "number" && streakDays > 0 && (
        <div className="lc-pill lc-pill-streak">
          <img
            src="/brand/icons/metric/streak-flame.svg"
            alt=""
            style={{ width: 13, height: 13, filter: "drop-shadow(0 0 6px rgba(245,158,11,.55))" }}
          />
          <span className="lc-hud-streak-num">{streakDays}</span>
          <span className="lc-hud-streak-unit">day</span>
        </div>
      )}

      <div
        ref={menuRootRef}
        className="lc-hud-user-wrap"
        data-testid="avatar-orbit-root"
        data-menu-open={menuOpen ? "1" : "0"}
        style={{ position: "relative" }}
      >
        {/* 2026-07-05 · beta-walk P0 · version pill so Daniel can
            visually confirm which build he's looking at without
            digging into Diagnostics. Reads the __APP_VERSION__ Vite
            injects from package.json. */}
        <span
          className="lc-pill"
          data-testid="hud-version-pill"
          title="App version"
          style={{
            marginRight: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            padding: "3px 8px",
            color: "var(--color-ink-soft)",
            background: "rgba(20, 12, 22, 0.55)",
            border: "1px solid rgba(255, 26, 140, 0.20)",
            borderRadius: 9999,
          }}
        >
          {/* RC1 · P1-C (2026-07-11) — the pill used to render the
           *  build-time `__APP_VERSION__` even after a runtime hot-swap,
           *  so support calls "which version am I on?" got wrong
           *  answers. `useRuntimeVersion()` reads `runtime_info` in
           *  Tauri and falls back to the shell version in browser
           *  preview. Same `runtime_info` command UpdateBeacon +
           *  Settings already call — no new shell surface required. */}
          v{runtimeVersion.version}
        </span>
        {/* R7 · 2026-07-11 · 4-state identity pill.
            One pill, four copy states, four click destinations. See
            `identityState` + `identityClick` above for the derivation.
            `data-identity-state` lets Playwright + ship-lens verify
            the pill state directly; `data-testid="hud-sign-in"` is
            preserved for the pre-R7 tests that only cared about the
            noJwt case. Agency state opens the account menu (same as
            avatar click). */}
        <Watchdog
          id="identity/id-02/identity-pill"
          label="Identity pill"
          cluster="identity"
          source="src/design-os/components/TopHud.tsx:R7"
        >
          <button
            type="button"
            className="lc-pill lc-pill-user-btn"
            data-testid="hud-sign-in"
            data-identity-state={identityState}
            onClick={identityClick}
            aria-label={identityCopy}
            style={{
              marginRight: 6,
              padding: "6px 14px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-paper)",
              background: "var(--color-fuchsia)",
              border: "1px solid var(--color-fuchsia)",
              borderRadius: 9999,
              cursor: "pointer",
            }}
          >
            {identityCopy}
          </button>
        </Watchdog>
        <button
          type="button"
          className="lc-pill lc-pill-user lc-pill-user-btn"
          data-testid="avatar-orbit-button"
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <div className="lc-hud-avatar" aria-hidden="true" />
          <div className="lc-hud-user-text">
            {/* RC1 · P0-2 (2026-07-11) — userName prop deleted. Reads
             *  @handle from useMe so signed-in users never see "Guest"
             *  in the avatar pill. Falls back to "Guest" only when the
             *  user genuinely has no email in the /me snapshot. */}
            <span className="lc-hud-user-name">
              {handleFromEmail ? `@${handleFromEmail}` : "Guest"}
            </span>
            <span className="lc-hud-user-tier">{resolvedTier}</span>
          </div>
          {unread > 0 && (
            <span
              data-testid="avatar-orbit-badge"
              style={{
                marginLeft: 6,
                background: "rgba(255, 26, 140, 0.9)",
                color: "#fff",
                borderRadius: 9999,
                padding: "1px 7px",
                fontSize: 11,
              }}
            >{unread}</span>
          )}
        </button>

        {menuOpen && (
          <div
            role="menu"
            data-testid="avatar-orbit-menu"
            className="lc-hud-user-menu"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 208,
              padding: 6,
              borderRadius: 12,
              background: "rgba(20, 12, 22, 0.97)",
              border: "1px solid rgba(255, 26, 140, 0.32)",
              boxShadow: "0 12px 30px rgba(0, 0, 0, 0.55)",
              zIndex: 5_000,
            }}
          >
            <HudMenuItem
              testId="avatar-orbit-settings"
              label="Settings"
              onClick={goSettings}
            />
            <HudMenuItem
              testId="avatar-orbit-notifications"
              label={unread > 0 ? `Notifications · ${unread}` : "Notifications"}
              onClick={goNotifications}
            />
            {/* 2026-07-11 · Permanent "Refresh app" action. The three
             *  existing reload paths (UpdateBeacon staged-bundle prompt,
             *  BrowseOverlay reload button, raw Cmd+R webview shortcut)
             *  are all conditional or undiscoverable — a stuck user
             *  couldn't find any of them. This item sits directly above
             *  Sign out because the two share a "reset session" mental
             *  category · Refresh is the soft reset (keeps you signed
             *  in), Sign out is the hard reset. */}
            <HudMenuItem
              testId="avatar-orbit-refresh"
              label="Refresh app"
              title="Reload from a clean session"
              onClick={() => {
                setMenuOpen(false);
                void hardRefresh();
              }}
            />
            {hasJwt && (
              <HudMenuItem
                testId="avatar-orbit-signout"
                label="Sign out"
                onClick={doSignOut}
              />
            )}
          </div>
        )}

        <InboxSheet
          open={inboxOpen}
          onClose={() => setInboxOpen(false)}
          onUnreadChange={setUnread}
        />
      </div>
    </header>
  );
}

function HudMenuItem({
  testId, label, onClick, title,
}: { testId: string; label: string; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      title={title}
      style={{
        display: "block",
        width: "100%",
        padding: "8px 12px",
        borderRadius: 8,
        border: "0",
        background: "transparent",
        color: "rgba(255, 255, 255, 0.92)",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: 13,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255, 26, 140, 0.15)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );
}
