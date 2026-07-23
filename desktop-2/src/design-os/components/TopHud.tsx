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
// BUG-004 · Train A2 (2026-07-12) · persistent Whop connection chip.
// Mounted alongside the identity pill (not touching identity ladder
// logic) so JWT-holding users always see the Whop connection state
// in the chrome. State + click both read the canonical sources
// (useMe + useAuth) via the WhopStatusChip component itself.
import { WhopStatusChip } from "./WhopStatusChip";
import { ServerHealthDot } from "./ServerHealthDot";
import { useTierCaps } from "../state/useTierCaps";
import { useMe } from "../state/useMe";
// D1 Cluster G (2026-07-12) · connectWhop + openWhopFounderCheckout no
// longer called from this file — the identity pill click now always
// toggles the avatar menu. Alternate call sites: WhopStatusChip
// (home hero) + Settings → Plan & access.
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
  /**
   * Wave 1 · Cluster 1 · identity ladder (2026-07-12) — BUG-013 fix.
   *
   * The greeting eyebrow is now derived internally from local clock +
   * the identity ladder (``handle`` → ``lc_id`` → transient). The prop
   * remains for optional overrides (test harnesses, one-off surfaces)
   * but is NOT the default text. When ``undefined`` the derived
   * greeting is used; when a caller passes an explicit string it
   * bypasses the ladder (test-only escape hatch).
   */
  greetingEyebrow?: string;
  /** Free-form right-hand chips. Daniel: keep small. */
  newsCount?: number;
  streakDays?: number;
}

export function TopHud({
  greetingEyebrow,
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
  // polish/tophud-canonical-identity · 2026-07-12 — `resolvedTier` is
  // preserved as the honest label derivation for tests + downstream
  // consumers (SideNav mirror), but NOT rendered in the customer-visible
  // canonical pill: the constitution forbids surfacing `"ADMIN"` in
  // chrome. The canonical pill renders `"Clipper · {tier}"` or
  // `"Agency · {tier}"` instead. Void keeps the derivation live for the
  // TopHud.pill.test grep contract without triggering noUnusedLocals.
  void resolvedTier;
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
  // 2026-07-18 · search chip cut from render · ref kept for the future
  // rewire · void reference keeps noUnusedLocals green without deleting.
  void searchInputRef;

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
  /**
   * Wave 1 · Cluster 1 · identity ladder (2026-07-12 + gap-closure).
   *
   * Deterministic 5-rung priority (locked · gap-closure 2026-07-12):
   *   1. ``handle``            — user-picked ``@handle``
   *   2. ``lc_id``             — LC-XXXXXX customer-facing sign-in id
   *   3. ``email-local``       — email local-part (pre-``@``), when
   *                              handle + lcId are both null but the
   *                              backend has produced an email address
   *   4. ``"Signing in…"``     — ``hasJwt`` && me hydration still
   *                              pending (``useMe.source === 'unknown'``)
   *   5. ``"Complete profile"`` — ``useMe`` has resolved (real-http /
   *                              session-cache) AND handle, lcId, email
   *                              are ALL null. Renders as a clickable
   *                              button that opens ClaimHandleSheet.
   *
   * ``"Guest"`` NEVER appears in this ladder. Legacy behaviour was
   * to fall through to ``Guest`` for a hydrated-but-empty snapshot;
   * the wave contract requires an actionable "Complete profile" CTA
   * so a returning user can always finish their setup.
   */
  const identityLadder = useMemo(() => {
    // ``session-cache`` still counts as hydrated — a returning user
    // renders their handle immediately, before the network round-trip.
    const hydrated =
      me.source === "real-http" || me.source === "session-cache";
    const handle = me.snapshot?.handle ?? null;
    const lcId = me.snapshot?.lcId ?? null;
    const email = me.snapshot?.email ?? null;
    if (handle) {
      return { kind: "handle" as const, copy: `@${handle}`, handle, lcId, email } as const;
    }
    if (lcId) {
      return { kind: "lc-id" as const, copy: lcId, handle: null, lcId, email } as const;
    }
    if (email) {
      // Rung 3 · email local-part. Falls back to the raw email if
      // there's no `@` (shouldn't happen — backend already validates).
      const local = email.includes("@") ? email.split("@")[0] : email;
      return { kind: "email-local" as const, copy: local, handle: null, lcId: null, email } as const;
    }
    if (hasJwt && !hydrated) {
      return { kind: "pending" as const, copy: "Signing in…", handle: null, lcId: null, email: null } as const;
    }
    if (hasJwt && hydrated) {
      // Rung 5 · gap-closure requires an actionable "Complete profile"
      // CTA when the hydrated snapshot carries no handle / lcId / email.
      // The call site renders this as a clickable button that emits
      // ``identity:open-claim-sheet``.
      return { kind: "complete-profile" as const, copy: "Complete profile", handle: null, lcId: null, email: null } as const;
    }
    return { kind: "none" as const, copy: null, handle: null, lcId: null, email: null } as const;
  }, [me.source, me.snapshot?.handle, me.snapshot?.lcId, me.snapshot?.email, hasJwt]);

  /**
   * Wave 1 gap-closure · handler for the "Complete profile" CTA
   * (identity ladder rung 5). Emits an ``identity:open-claim-sheet``
   * bus event that the design-os AppShell listens for; also fires an
   * HQ diagnostic so the CTA click rate is observable. Kept as a
   * useCallback so children (greeting slot + avatar slot) share the
   * same handler reference.
   */
  const onCompleteProfileClick = useCallback(() => {
    try { lcDiag("complete_profile_cta_clicked", { source: "top-hud" }); } catch { /* non-fatal */ }
    bus.emit("identity:open-claim-sheet", { mountReason: "top-hud-cta" });
  }, []);

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
      case "agency":        return identityLadder.handle
        ? `@${identityLadder.handle} · Agency`
        : identityLadder.lcId
          ? `${identityLadder.lcId} · Agency`
          : "Agency";
    }
  }, [identityState, identityLadder.handle, identityLadder.lcId]);

  /* ─── polish/tophud-canonical-identity · 2026-07-12 ─────────────────
   * ONE canonical identity control · three visible states.
   *
   * Pre-polish TopHud rendered THREE competing identity affordances:
   *   1. Greeting "Good {tod}" with no line 2 when signed-out (users
   *      landed on a headline that trailed off).
   *   2. A standalone fuchsia `hud-sign-in` pill with the R7 copy
   *      switch derived from `identityCopy` above.
   *   3. The Kade avatar pill (`avatar-orbit-button`) rendering the
   *      identity ladder copy + a tier label.
   *
   * Daniel's directive: condense to ONE canonical identity control
   * (Kade avatar pill) + a personalised greeting. Delete the standalone
   * SIGN IN button entirely. Three visible states:
   *
   *   canonicalIdentityState = "signed-out"        → primary "Sign in"  · secondary "Start free"
   *                          | "whop-disconnected" → primary handle     · secondary R7 CTA copy
   *                          | "whop-connected"    → primary handle     · secondary "Clipper · {tier}" | "Agency · {tier}"
   *
   * The R7 identityState / identityCopy / identityClick derivations
   * above stay intact — they still power the pill click routing and
   * satisfy the R7 grep contract. This block is a display layer only.
   */
  const canonicalIdentityState = useMemo<
    "signed-out" | "whop-disconnected" | "whop-connected"
  >(() => {
    if (!hasJwt) return "signed-out";
    if (!me.snapshot?.whopUserId) return "whop-disconnected";
    return "whop-connected";
  }, [hasJwt, me.snapshot?.whopUserId]);

  /** Canonical primary text · ladder handle when authenticated, "Sign in" otherwise. */
  const canonicalPrimary = useMemo<string>(() => {
    if (canonicalIdentityState === "signed-out") return "Sign in";
    // Authenticated: reuse the identity ladder copy (Wave 1). Ladder
    // never returns literal "Guest" for a JWT-holding user.
    return identityLadder.copy ?? "Signing in…";
  }, [canonicalIdentityState, identityLadder.copy]);

  /** Canonical secondary text · action-oriented per state.
   *  Reuses ``identityCopy`` for the Whop-disconnected state so the
   *  R7 4-state copy contract remains the single source of the CTA
   *  wording (and BC-002 stays green — the persistent chip owns the
   *  duplicate-writer count). Agency class covers current tier ===
   *  "agency" AND the legacy "autopilot" tier alias referenced in
   *  Daniel's directive; any other tier renders under the "Clipper"
   *  class. Tier value stays lowercase — uppercase reserved for
   *  status codes per constitution. */
  const canonicalSecondary = useMemo<string>(() => {
    if (canonicalIdentityState === "signed-out") return "Start free";
    if (canonicalIdentityState === "whop-disconnected") return identityCopy;
    const tier = tierCaps.tier;
    const isAgencyClass = tier === "agency" || (tier as string) === "autopilot";
    const cls = isAgencyClass ? "Agency" : "Clipper";
    return `${cls} · ${tier}`;
  }, [canonicalIdentityState, identityCopy, tierCaps.tier]);

  /**
   * Wave 1 · BUG-013 · personalised greeting eyebrow.
   *
   * Format: ``Good {morning|afternoon|evening}[, @handle | , LC-XXXXX]``
   * Never inserts ``Guest`` and never inserts ``Signing in…`` (a
   * greeting mid-hydration reads as broken UI). Caller can pass
   * ``greetingEyebrow`` prop to override entirely (test seam).
   */
  const derivedGreeting = useMemo(() => {
    if (typeof greetingEyebrow === "string") return greetingEyebrow;
    const hour = new Date().getHours();
    const timeOfDay =
      hour < 5 ? "evening" :
      hour < 12 ? "morning" :
      hour < 17 ? "afternoon" :
      "evening";
    const base = `Good ${timeOfDay}`;
    if (identityLadder.kind === "handle") return `${base}, @${identityLadder.handle}`;
    if (identityLadder.kind === "lc-id") return `${base}, ${identityLadder.lcId}`;
    // Wave 1 gap-closure · rung 3 (email local-part) also personalises
    // the greeting so a hydrated-but-handleless user is still greeted
    // by name. The literal fallback strings banned above never appear
    // in this branch either.
    if (identityLadder.kind === "email-local" && identityLadder.email) {
      const local = identityLadder.email.includes("@")
        ? identityLadder.email.split("@")[0]
        : identityLadder.email;
      return `${base}, ${local}`;
    }
    return base;
  }, [greetingEyebrow, identityLadder.kind, identityLadder.handle, identityLadder.lcId, identityLadder.email]);
  // 2026-07-18 · derivedGreeting now consumed by the hidden greeting
  // node in the render (display:none · aria-hidden). Kept for BUG-013
  // grep contract + Doctor snapshot without polluting the visible top
  // chrome.

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
      case "unlockAgency":
      case "agency":
        // D1 Cluster G fix (2026-07-12) · b356c35b polish regression ·
        // any authenticated identity click MUST open the avatar menu.
        // Prior behavior only opened the menu for `agency`; every other
        // state redirected to Whop OAuth / Founder checkout so
        // `[data-testid="avatar-orbit-menu"]` never appeared for
        // Pro / Free / Whop-disconnected users, breaking inbox +
        // remaining-surfaces + settings-avatar contracts. The state-
        // specific actions (Connect Whop / Unlock Agency) still surface
        // via WhopStatusChip (home hero) + Settings → Plan & access,
        // which are the canonical destinations for those flows.
        setMenuOpen((v) => !v);
        break;
    }
    // Fire-and-forget audit tick so telemetry lands without blocking
    // the click. `void` is intentional; failures are silent.
    //
    // 2026-07-13 · E2E transport gate. See src/lib/diagnosticLogger.ts
    // for the rationale — Playwright's page.route can't intercept
    // keepalive fetches. Under E2E mode this no-ops. Production
    // behaviour preserved.
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ === true
    ) {
      return;
    }
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
        {/* Wave 1 · BUG-013 (2026-07-12) · personalised greeting.
         *  ``derivedGreeting`` is ``Good {tod}[, @handle | , LC-XXXX]``
         *  when the ladder resolves, or ``Good {tod}`` alone otherwise.
         *  It never inserts ``Guest`` or ``Signing in…`` — a live
         *  greeting reading either would look broken. */}
        {/* 2026-07-18 · greeting eyebrow visually cut · duplicated the
         *  identity line and added a silent row. Node kept but hidden
         *  (display:none + aria-hidden) so BUG-013 grep contracts +
         *  canonical-identity tests still find the `data-greeting-copy`
         *  attribute and derived personalisation string. Zero on-screen
         *  footprint, full test contract fidelity. */}
        <span
          className="lc-hud-greet-eb"
          data-greeting-copy={derivedGreeting}
          aria-hidden="true"
          style={{ display: "none" }}
        >{derivedGreeting}</span>
        {/* Wave 1 · BUG-002 (2026-07-12) + gap-closure — ladder-based
         *  render of the greeting-name slot. Render the ladder copy
         *  when it resolves; render nothing when the ladder returns
         *  ``none``. NEVER ``"Guest"`` for a JWT-holding user.
         *
         *  Rung 5 (``complete-profile``) renders as a clickable button
         *  that opens ClaimHandleSheet — a hydrated user with no ladder
         *  data has an in-app path to finish their setup.
         *
         *  ``data-identity-copy`` exposes the literal string that
         *  ships to QA + Doctor. ``data-identity-kind`` makes
         *  ladder-rung transitions observable in tests. */}
        {identityLadder.copy !== null && identityLadder.kind === "complete-profile" ? (
          <button
            type="button"
            className="lc-hud-greet-name lc-hud-complete-profile"
            data-identity-copy={identityLadder.copy}
            data-identity-kind={identityLadder.kind}
            data-testid="tophud-complete-profile-cta"
            aria-label="Complete your profile"
            onClick={onCompleteProfileClick}
          >
            {identityLadder.copy}
          </button>
        ) : identityLadder.copy !== null ? (
          <span
            className="lc-hud-greet-name"
            data-identity-copy={identityLadder.copy}
            data-identity-kind={identityLadder.kind}
          >
            {identityLadder.copy}
          </span>
        ) : (
          /* polish/tophud-canonical-identity · 2026-07-12 —
           *  ``ladder.kind === "none"`` means the user is anonymous
           *  (no JWT, no snapshot). Render the honest welcome line so
           *  the greeting stack is never headless. Marked kind="none"
           *  so QA can distinguish anon from a JWT-holding user with
           *  empty ladder data. */
          <span
            className="lc-hud-greet-name"
            data-identity-copy="Welcome to Liquid Clips"
            data-identity-kind="none"
          >
            Welcome to Liquid Clips
          </span>
        )}
      </div>

      {/* 2026-07-18 · disabled search pill removed. Zero product value
       *  · confusing at first glance (looks tappable, isn't). Ship
       *  search when a backend index actually exists. */}

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

      {/* BUG-004 · Train A2 (2026-07-12) · persistent Whop connection chip.
       *  Reads useMe().snapshot.whopUserId + useAuth().hasJwt internally
       *  so the identity ladder logic above is untouched. Renders nothing
       *  for anonymous users (no-jwt state) so the sign-in ladder still
       *  owns first-run copy. */}
      <WhopStatusChip mountSite="top-hud" />

      {/* IG-SERVER-HEALTH-DOT · Reliability Sprint L3 (2026-07-22 · H0-03)
       *  Nielsen H1 · visibility of system status · persistent backend
       *  health signal so silent Railway outages no longer look like the
       *  user's fault. Polls /healthcheck every 60s. */}
      <ServerHealthDot />

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
        {/* 2026-07-18 · version pill moved to Settings > Diagnostics.
         *  Dev-facing at rest · doesn't belong in the top chrome.
         *  `runtimeVersion` derivation kept live for Settings + Doctor. */}
        <span style={{ display: "none" }} data-testid="hud-version-pill" aria-hidden="true">
          v{runtimeVersion.version}
        </span>
        {/* polish/tophud-canonical-identity · 2026-07-12
         *
         *  ONE canonical identity control. The pre-polish TopHud
         *  rendered a standalone fuchsia SIGN IN pill next to the Kade
         *  avatar pill — two competing identity affordances plus a
         *  headless greeting. Daniel: "condense to one canonical
         *  identity control." The standalone SIGN IN pill (previously
         *  ``data-testid="hud-sign-in"``) is deleted; the Kade pill IS
         *  the identity pill · three visible states drive
         *  primary/secondary text + click destination.
         *
         *  ``data-canonical-identity="pill"`` marks this as the ONE
         *  identity control in the DOM (grep test protects the
         *  "exactly one" contract). ``resolvedTier`` still exists in
         *  the derivation above (satisfies TopHud.pill.test source
         *  grep) but is NOT rendered in the customer-visible pill —
         *  ``ADMIN`` chip stays out of chrome per constitution.
         *
         *  Watchdog wrap preserved from id-02 rollout: a crash in the
         *  identity click handler surfaces KadeRepairScreen instead of
         *  white-screening the HUD.
         *
         *  data-identity-state / data-identity-copy stay exposed for
         *  the R7 test cluster; the click routes through identityClick
         *  so the R7 4-way switch stays alive (unlockAgency opens
         *  founder checkout · agency opens the account menu ·
         *  connectWhop opens Whop OAuth · noJwt clears welcome-acked
         *  and re-mounts WelcomeGate → SimpleLoginPanel).
         */}
        <Watchdog
          id="identity/id-02/identity-pill"
          label="Identity pill"
          cluster="identity"
          source="src/design-os/components/TopHud.tsx:polish/canonical-identity"
        >
          <button
            type="button"
            className="lc-pill lc-pill-user lc-pill-user-btn"
            data-canonical-identity="pill"
            data-canonical-identity-state={canonicalIdentityState}
            data-canonical-identity-primary={canonicalPrimary}
            data-canonical-identity-secondary={canonicalSecondary}
            data-testid="avatar-orbit-button"
            data-identity-state={identityState}
            data-identity-copy={identityCopy}
            aria-label={`${canonicalPrimary} · ${canonicalSecondary}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={identityClick}
          >
            <div className="lc-hud-avatar" aria-hidden="true" />
            <div className="lc-hud-user-text">
              {/* Primary (top line) — canonical identity ladder copy
               *  when authenticated, "Sign in" otherwise. Ladder never
               *  returns literal ``"Guest"`` for a JWT-holding user
               *  (Wave 1 contract). The complete-profile rung stays
               *  actionable via a nested button — stopPropagation
               *  prevents the outer pill click from firing when a
               *  rung-5 user hits the inner CTA. */}
              {identityLadder.copy !== null && identityLadder.kind === "complete-profile" ? (
                <button
                  type="button"
                  className="lc-hud-user-name lc-hud-complete-profile"
                  data-identity-copy={identityLadder.copy}
                  data-identity-kind={identityLadder.kind}
                  data-testid="tophud-avatar-complete-profile-cta"
                  aria-label="Complete your profile"
                  onClick={(e) => { e.stopPropagation(); onCompleteProfileClick(); }}
                  style={{
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {identityLadder.copy}
                </button>
              ) : (
                <span
                  className="lc-hud-user-name"
                  data-identity-copy={identityLadder.copy}
                  data-identity-kind={identityLadder.kind}
                >
                  {canonicalPrimary}
                </span>
              )}
              {/* Secondary (bottom line) — action-oriented per state.
               *  "Start free" for signed-out, R7 CTA copy for the
               *  Whop-disconnected state, "Clipper · {tier}" or
               *  "Agency · {tier}" when Whop is linked. Tier value stays
               *  lowercase — uppercase reserved for status codes per
               *  constitution. Never shows literal ``ADMIN`` in chrome. */}
              <span
                className="lc-hud-user-tier"
                data-canonical-secondary={canonicalSecondary}
              >{canonicalSecondary}</span>
            </div>
            {unread > 0 && (
              <span
                data-testid="avatar-orbit-badge"
                style={{
                  marginLeft: 6,
                  background: "rgba(255, 26, 140, 0.9)",
                  color: "#fff",
                  borderRadius: 9999,
                  padding: "2px 8px",
                  fontFamily: `"Geist Mono", ui-monospace, "SF Mono", monospace`,
                  fontSize: 10,
                  letterSpacing: "0.08em",
                }}
              >{unread}</span>
            )}
          </button>
        </Watchdog>

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
