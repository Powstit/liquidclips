/**
 * Liquid Clips · Design OS · Event Bridge
 *
 * Tiny typed pub/sub used by Command Room (and future routes) to coordinate
 * cross-component reactions WITHOUT pulling everything into a single Zustand
 * store. Keep payloads small, immutable, and stateless.
 *
 * Events fired by user actions only — Kade NEVER fires its own state events.
 */

/* ============================================================
   Event map · all 6 channels Phase 5A wires
   ============================================================ */

export type KadeState =
  | "idle"
  | "hover"
  | "create-clips"
  | "import-footage"
  | "reading-brief"
  | "cutting-clips"
  | "generating-captions"
  | "exporting"
  | "publishing"
  | "campaign-mode"
  | "earn-mode"
  | "community-mode"
  | "settings-mode"
  | "shooter"
  | "success"
  | "celebration"
  | "warning"
  | "error";

export type RouteId =
  | "home" | "workstation"
  | "create" | "engine" | "studio" | "thumbnail" | "export"
  | "campaigns" | "clipper" | "earn" | "community" | "library"
  | "channels" | "schedule" | "settings" | "support"
  | "submissions"
  | "analytics"
  // Sprint D · agency campaign builder (own route so it stays
  // decoupled from Settings-mounted panels and the read-only
  // clipper-facing Campaigns discovery route).
  | "campaign-builder";

/** UI-1 · Clipper / Agency mode pill in TopHud. Stored in localStorage
 *  and broadcast on change so workstation defaults can adapt in UI-2. */
export type AppMode = "clipper" | "agency";

export type AllowanceState = "healthy" | "low" | "empty" | "unlimited";

/* ============================================================
   Engine-side channels · Phase 6B
   The tauri-adapter re-emits sidecar:* Tauri events into these.
   Routes / Kade / UI subscribe via useEvent() — they never touch
   Tauri directly. Keeps the engine independent from the shell.
   ============================================================ */

export type EngineStage =
  | "ingest"
  | "audio"
  | "transcribe"
  | "llm"
  | "cut"
  | "reframe"
  | "thumbs"
  | "bake"
  | "regenerate"
  | "lift"
  | "pick"
  | "thumbnail"
  | "export"
  | "captions";

export type EngineCompletionKind =
  | "ingest"
  | "lift"
  | "pick"
  | "regenerate"
  | "bake"
  | "thumbnail-batch"
  | "export"
  | "captions";

export type ToastKind = "info" | "success" | "warning" | "error";

export type LCEvents = {
  /** user hovered a nav item — Kade reacts per route */
  "nav:hover": { route: RouteId; kade: KadeState };
  /** user clicked a nav item — route should swap */
  "nav:click": { route: RouteId };
  /** Cross-route request to expose a specific agency Settings panel. */
  "settings:open-tab": {
    tab: "whop-sync" | "roster" | "payout-split" | "rules";
  };
  /** allowance state changed (manually for demo, real in Phase 5+) */
  "allowance:update": { state: AllowanceState; used: number; total: number };
  /** user clicked the bug-fix demo button */
  "bug:fix-demo": Record<string, never>;
  /** user clicked the payout demo button */
  "payout:demo": { amount: number };
  /** route changed — fires after AppShell's section.activated */
  "route:enter": { route: RouteId };

  /* ---- Engine channels (sidecar via tauri-adapter) ---- */

  /** Pipeline stage progress · re-emit of sidecar:*_progress. */
  "engine:progress": {
    stage: EngineStage;
    /** 0..1 normalized; null when sidecar emits indeterminate progress */
    percent: number | null;
    slug?: string;
    idx?: number;
    url?: string;
    /** Optional last-text-line snapshot (transcribe, llm). */
    note?: string;
    /** Per-clip ready count from sidecar stage_progress (cut/reframe/thumbs).
     *  Lets Workstation render "N of M ready" live. */
    segmentsDone?: number;
    segmentsTotal?: number;
  };
  /** Pipeline stage / job complete · re-emit of sidecar:*_complete. */
  "engine:complete": {
    kind: EngineCompletionKind;
    slug?: string;
    idx?: number;
    url?: string;
    /** Direct project payload embedded by the sidecar's bake_complete /
     *  regenerate_complete events. Lets the session hydrate without a
     *  follow-up get_project RPC — eliminates the silent-failure path
     *  where get_project returns nothing and the grid stays in skeleton. */
    project?: unknown;
  };
  /** Pipeline stage / job error · re-emit of sidecar:*_error. */
  "engine:error": {
    kind: EngineCompletionKind | "sidecar-died";
    slug?: string;
    idx?: number;
    url?: string;
    /** Raw error string from the sidecar. */
    error: string;
    /** Human-rendered version when humanError() ran inside the sidecar. */
    human?: string;
    /** Stable error code (e.g. "INGEST_TIMEOUT"). */
    code?: string;
  };

  /* ---- Shell-level channels ---- */

  /** A file was dropped onto the app (or paths were resolved from a drop). */
  "source:drop": { paths: string[] };
  /** Phase 6L-C · achievement unlocked. Fires once per badge id per
   *  browser (localStorage deduped via `recordAchievement`). AchievementToast
   *  + (future) BadgeShelf subscribe. */
  "achievement:unlocked": {
    id: string;
    title: string;
    blurb: string;
    /** Path to the badge asset · already-shipped art under `public/brand/`. */
    art: string;
  };
  /** Phase 6L-B · imperative "open this URL" request. Default subscriber
   *  routes into the globally mounted in-app Browser overlay.
   *  `mirror` distinguishes the temporary Whop mirror from a future
   *  native Liquid Clips discussion target. */
  "browse:open": {
    url: string;
    source?: "community" | "campaign" | "earn" | "settings" | "other";
    roomId?: string;
    mirror?: "whop" | "native";
    title?: string;
  };
  /** 2026-07-07 · Whop-action open telemetry. Fires from `openWhopAction()`
   *  before routing into the BrowseOverlay. Consumers: analytics adapter +
   *  ledger reconciler correlation (Sprint Final §1D). */
  "telemetry:whop-action": {
    action: string;
    url: string;
  };
  /** 2026-07-07 · Signals the referral pipeline tile to refresh count.
   *  Fired by CrewMatchTool after a successful invite log. */
  "crew:invite-sent": {
    recipient_email: string;
  };
  /** Imperative toast request — anyone can fire; ToastHost listens. */
  "toast": {
    kind: ToastKind;
    body: string;
    title?: string;
    /** Auto-dismiss in ms. Defaults to 4500 in the host. */
    ttl?: number;
  };

  /** UI-1 · Home tile asks the InlineCreatePanel to slide up. Tab hint
   *  routes Create Clips → "url", Import → "upload", Script → "script".
   *  UX-4 · Library tab folded into the My Clips tile (separate route). */
  "home:open-panel": { tab?: "url" | "upload" | "script" };

  /** UI-1 · Clipper / Agency pill flipped in TopHud. Workstation and
   *  campaign surfaces subscribe in UI-2. */
  "mode:change": { mode: AppMode };

  /** UI-3 · client-derived clip status changed (Draft / Ready / Scheduled
   *  / Posted / Submitted). Mock-only — sidecar gets the field in Batch D. */
  "clip:status-change": { clipIdx: number; status: "draft" | "ready" | "scheduled" | "posted" | "submitted" };

  /** 2026-06-23 · clip platform-targets changed. Emitted by ANY surface
   *  that lets the user pick platforms for a clip (ClipCard popover, the
   *  ClipPreviewShell editor picker). Every other surface that renders
   *  per-clip platform state listens and updates its local mirror so all
   *  views stay in sync. clip.platforms in the parent fixture is the
   *  initial seed only; mutations live on the event bus until the sidecar
   *  setClipPlatforms RPC lands. Daniel's spec 2026-06-23: "One source of
   *  truth. Editor picker and grid chips must stay in sync." */
  "clip:platforms-change": {
    clipIdx: number;
    platforms: import("../engine/types").Platform[];
  };

  /** UI-3 · ClipCard CTA fired — Workstation routes the action. Avoids
   *  threading onExport / onSubmit props through ResultsGrid. */
  "clip:open-export": { clipIdx: number };
  "clip:open-schedule": { clipIdx: number; outputPath?: string };
  "clip:open-submit": { clipIdx: number };
  /** BUG-031 · ClipCard "Edit" button fired — Workstation already focuses
   *  the clip via the onOpen callback chain, this event tells CockpitDock
   *  to force-open and land on the Reaction module. Mirrors clip:open-export
   *  which lands on Publish. */
  "clip:open-edit": { clipIdx: number };

  /** UI-3 · Clipper finished the Submit-to-Whop modal. Earn ledger adds a
   *  local "pending" row; Batch D will POST to the real Whop endpoint. */
  "clip:submitted": {
    clipIdx: number;
    campaignSlug?: string;
    platform: "tiktok" | "youtube" | "instagram" | "x";
    postUrl: string;
    whopRewardUrl?: string;
  };

  /** UI-3 · Agency clicked Approve / Reject in the Submissions Review. */
  "submission:reviewed": {
    submissionId: string;
    decision: "approve" | "reject";
  };

  /** UI-3 · Agency flipped a campaign's lifecycle state from the Manage
   *  popover. Mock-only — backend persistence lands in Batch D. */
  "campaign:lifecycle-change": {
    campaignSlug: string;
    status: "draft" | "live" | "paused" | "closed";
  };

  /* ---- Inbox channels (FEATURE-001) ---- */

  /** A new InboxRecord landed in the canonical inbox store. */
  "inbox:added": { id: string; kind: string };
  /** A record was marked read · id="*" means markAllRead. */
  "inbox:read": { id: string };
  /** An EmailDelivery sub-object transitioned. Surfaces "not_configured",
   *  "sending", "sent", or "failed" — never a fake "sent". */
  "inbox:email-state": { id: string; status: string };

  /* 2026-06-30 · Kade troubleshooting overlay channel. Distinct from the
   * existing KadeState pose enum (idle | cutting-clips | exporting ...).
   * Mood drives the wrapper around StickyKade · pose drives the inner
   * portrait. Pose stays route-driven; mood is event-driven so any
   * surface that detects a system warning can pulse Kade without
   * touching pose. */
  "kade:mood": { mood: "idle" | "thinking" | "alert" | "collapsed" };
  /** Speech-bubble payload paired with mood="alert". Auto-dismisses
   *  after ~12s unless replaced by a fresh speak event. */
  "kade:speak": { title: string; body: string; severity?: "info" | "warn" | "error" };
  /** Explicit dismiss · clears any active speech bubble immediately. */
  "kade:dismiss": Record<string, never>;

  /** 2026-06-30 · activation lifecycle signal.
   *  Fires AFTER handleActivationUrl() validates the challenge, stores
   *  the JWT, and lands the post-mint /sync + /me round-trip. Surfaces
   *  that hydrate user-scoped state (Settings carrot panel, WalletPanel)
   *  subscribe so their `useEffect(() => fetch(), [])` mounted-once
   *  fetch doesn't strand the page on stale "Temporarily unavailable"
   *  copy when the user activates while the route is already open. */
  /* J1 STRAND 1 fix · widened to include the "whop-checkout" source
   * emitted by junior-backend/app/routes/whop_checkout_success.py after
   * a cold-email buyer completes checkout · the desktop consumes the
   * challengeless deep link and forwards this source verbatim. */
  "activation:complete": { source: "clerk" | "whop" | "whop-checkout" | "unknown" };
  /** v2.2.15 · request the one-click upgrade modal to open. Fires from
   *  the TopHud TrialStatusPill and from paywall 402 responses. The
   *  UpgradeApprovalModal listens once at AppShell mount + opens on
   *  every event. */
  "trial:upgrade-request": { source: "hud-pill" | "clip-cap-402" | "settings" | "onboarding-card" };
  /** v2.2.15 · fired by the modal when the user completes the flow
   *  (approve, wait, or dismiss) so surfaces can refresh their trial
   *  state without waiting for the 30s /sync poll. */
  "trial:upgrade-resolved": { state: "approved" | "already_paid" | "unavailable" | "dismissed" };
  /** Sprint G.3 · Kade Reactive Onboarding. Fired ONCE per
   *  first-occurrence milestone per user. Emission is the sole
   *  responsibility of `desktop-2/src/lib/onboardingEmitter.ts` — no
   *  route / route helper / component is allowed to fire this event
   *  directly. The pre-commit lint at `scripts/lint_kade_decoupling.sh`
   *  enforces the discipline; KadeController subscribes and swaps its
   *  pose per `MILESTONE_TO_POSE`. Keeps the "Kade never fires its own
   *  state events" rule intact (line 8 of this file). */
  "onboarding:milestone": { milestone: OnboardingMilestone; at: string };

  /** 2026-07-05 · beta-walk P0 · fired by any surface that calls
   *  clearJwt() (TopHud sign-out, Settings clear-activation) so the
   *  AuthGate re-checks hasJwt() and swaps back to LoginActivation.
   *  Without this the JWT is nulled locally but the app stays on the
   *  authed shell rendering stale tier + a dead "reload the app to
   *  sign in again" toast with no way to re-enter the sign-in flow. */
  "auth:signed-out": Record<string, never>;
  /** 2026-07-05 · beta-walk P0 · imperative "open the Whop OAuth
   *  panel" request. AuthGate mounts the bridge that owns the panel
   *  (via useAuthPanelBridge) and listens for this event so any
   *  surface (Settings "How do I activate?" button, retention modals,
   *  paywall CTAs) can trigger sign-in without threading the
   *  openPanel callback through every intermediate component. */
  "auth:open-panel": Record<string, never>;

  /** 2026-07-06 · Kade Welcome path picker · fired when the user picks
   *  either "clipper" (guest mode · 10 free clips) or "agency"
   *  (immediate Whop checkout). Home + TopHud + paywall triggers read
   *  this to know which tier framing to render. */
  "mode:set": { mode: "clipper" | "agency" };

  /* Ship-lens Sovereign-Operator Protocol (2026-07-06) · fired by any
   * Watchdog when a wrapped node fails. Shell listens to surface the
   * KadeRepairScreen fallback + inbox notification. See
   * docs/PROTOCOL_SELF_HEALING_NODES.md. */
  "system:intercession": {
    nodeId: string;
    health: "green" | "yellow" | "red";
    failureScore: number;
    message: string;
    ts: number;
  };
};

/** Sprint G.3 · closed vocabulary — additive only. New keys land here
 *  first + then in `MILESTONE_TO_POSE` + then in the backend
 *  `app/onboarding_milestones.py::ALL_MILESTONE_KEYS`. The three must
 *  stay in sync; the pre-commit lint checks the client + backend key
 *  lists match at commit time. */
export type OnboardingMilestone =
  | "signed_up_at"
  | "first_launch_at"
  | "first_clip_at"
  | "first_publish_at"
  | "first_earn_view_at"
  | "first_bounty_submit"
  | "first_paid_referral"
  | "agency_owner_first_campaign"
  | "agency_owner_first_invite"
  | "agency_member_accepted_at";

export const ALL_ONBOARDING_MILESTONES: readonly OnboardingMilestone[] = [
  "signed_up_at",
  "first_launch_at",
  "first_clip_at",
  "first_publish_at",
  "first_earn_view_at",
  "first_bounty_submit",
  "first_paid_referral",
  "agency_owner_first_campaign",
  "agency_owner_first_invite",
  "agency_member_accepted_at",
] as const;

/* ============================================================
   Bus implementation · plain Map + Set, no deps
   ============================================================ */

type Handler<T> = (payload: T) => void;

class EventBus {
  private listeners = new Map<keyof LCEvents, Set<Handler<unknown>>>();

  on<K extends keyof LCEvents>(event: K, handler: Handler<LCEvents[K]>): () => void {
    const set =
      this.listeners.get(event) ??
      this.listeners.set(event, new Set()).get(event)!;
    set.add(handler as Handler<unknown>);
    return () => set.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof LCEvents>(event: K, payload: LCEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<LCEvents[K]>)(payload);
      } catch (e) {
        // Never let a bad handler kill the bus.
        // eslint-disable-next-line no-console
        console.warn("[lc:bus]", event, "handler threw:", e);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  /** P0-2 · subscriber-presence check for emitters that need a fallback
   *  when no handler is mounted (e.g. CampaignPageShell submission CTA
   *  relying on the browse:open default subscriber). Pure read · no
   *  behavior change. */
  hasListeners<K extends keyof LCEvents>(event: K): boolean {
    const set = this.listeners.get(event);
    return !!set && set.size > 0;
  }
}

export const bus = new EventBus();

/* BUG-047 · harness test seam · exposes the shared bus on window so
 * Playwright specs can emit `nav:click` (and any other event) from the
 * browser context without mounting a React component. Mirrors the
 * existing `window.__lcDebugSetTier` / `__lcDebugSetChannelPlatform`
 * pattern. Safe in production: simply attaches the bus reference; no
 * extra side effects, no exposure of secrets. */
if (typeof window !== "undefined") {
  const w = window as unknown as { __lcBus?: EventBus };
  if (!w.__lcBus) w.__lcBus = bus;
}
