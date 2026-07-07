/**
 * LoginScreen · post-splash 3-column layout · login left · Kade backdrop
 * center · marquee of real clip MP4s right.
 *
 * Ships 2026-07-06 v4 (preview → production port). Two states:
 *
 *   State A · fresh install (unknown user)
 *     Center → Kade backdrop (rotating between 8 concepts every 12s)
 *     Left   → "Pick your lane" · clipper + agency CTAs · discount code slot
 *     Right  → marquee of bundled demo clips + HQ-curated feed
 *
 *   State B · cold-traffic lead (email + handle already known via HQ)
 *     Center → same Kade backdrop rotation
 *     Left   → "Welcome, @handle" · single Sign-in CTA · discount code slot
 *     Right  → marquee (bundled + HQ · shared with State A; cold-lead
 *              `preview_clip_url` is captured for future personalization
 *              but not yet rendered in the marquee stream — follow-up).
 *
 * Cold-traffic detection:
 *   The download link HQ sends carries ?e=<email>&u=<handle>&c=<campaign>
 *   in the launch URL. Desktop reads it on first launch and stores it in
 *   `lc:cold-lead-context`. Any later launch reads the stored context so
 *   the user gets the personalized welcome even after they close the app
 *   and reopen it.
 *
 * Marquee sound:
 *   All 16 tiles (8 clips doubled for seamless loop) mount muted. First
 *   user click OR keypress anywhere unlocks audio + unmutes the tile
 *   closest to viewport center. Hover after that swaps audio between
 *   tiles (single-active player). preload="metadata" keeps CPU + network
 *   sane while all tiles animate.
 *
 * Whop-authorization language:
 *   Copy explicitly says "Whop authorization required" (card on file · $0
 *   charged for free tier) so users understand the SaaS-standard capture-
 *   before-app pattern. Not a paywall — just a hold on file so we can map
 *   conversion.
 *
 * Post-Whop-checkout activation:
 *   Ship-lens P0-001 (2026-07-06) — `/desktop/connect-from-checkout` is
 *   server-secret-gated and can't be called from the client. So Whop
 *   completion shows the "check your email for LC-ID" state; user pastes
 *   the LC-ID (received via Resend) into the recovery form to activate.
 *   A public sibling endpoint (Whop-API-verified) is a planned follow-up.
 *
 * Cold-traffic play (why this converts):
 *   - Proof before ask (marquee + Kade key visual)
 *   - Named greeting (State B)
 *   - Discount codes as retention lever, not just recovery
 *
 * Resolves the login-fall-over cluster + serves as the front door for
 * cold-email cohorts. Watchdog-wrapped under identity/id-09/login-screen.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  isQaModeActive,
  WHOP_FOUNDER_PLAN_ID,
  WHOP_QA_TEST_PLAN_ID,
  WHOP_AUTHORIZATION_PLAN_ID,
} from "../../lib/whopCheckout";
import { handleActivationUrl, getActivationSnapshot } from "../../lib/activation";
import { bus } from "../bridge";
import { Watchdog } from "../../lib/watchdog";
import { logLoginStep } from "../../lib/loginTelemetry";
import { PoweredByWhop } from "../../components/brand/PoweredByWhop";
import {
  InlineWhopCheckout,
  type InlineWhopCheckoutReceipt,
} from "../../components/checkout/InlineWhopCheckout";

const LC_WELCOME_ACKED_KEY = "lc:welcome-acked";
const LC_GUEST_MODE_KEY = "lc:guest-mode";
const LC_GUEST_CLIPS_REMAINING_KEY = "lc:guest-clips-remaining";
const LC_COLD_LEAD_KEY = "lc:cold-lead-context";
const GUEST_CLIP_QUOTA = 10;
const CAROUSEL_ENDPOINT = "/hq/carousel/clips";

// ─── Cold-lead context ────────────────────────────────────────────────

export interface ColdLeadContext {
  email?: string;
  handle?: string;
  campaign_id?: string;
  preview_clip_url?: string;
  captured_at?: string;
}

/** Read cold-lead context from URL params on first launch and persist. */
function captureColdLeadFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("e");
    const handle = params.get("u");
    const campaign = params.get("c");
    const preview = params.get("d");
    // Only capture when at least one identifier is present. Missing = fresh install.
    if (!email && !handle && !campaign && !preview) return;
    const existing = readColdLead();
    const merged: ColdLeadContext = {
      email: email ?? existing?.email,
      handle: handle ?? existing?.handle,
      campaign_id: campaign ?? existing?.campaign_id,
      preview_clip_url: preview ?? existing?.preview_clip_url,
      captured_at: existing?.captured_at ?? new Date().toISOString(),
    };
    window.localStorage.setItem(LC_COLD_LEAD_KEY, JSON.stringify(merged));
  } catch {
    /* non-fatal */
  }
}

export function readColdLead(): ColdLeadContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LC_COLD_LEAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed != null ? (parsed as ColdLeadContext) : null;
  } catch {
    return null;
  }
}

// ─── Guest / welcome flags ────────────────────────────────────────────

export function hasAckedWelcome(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LC_WELCOME_ACKED_KEY) === "1";
  } catch {
    return true;
  }
}

export function isGuestMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(LC_GUEST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function readGuestClipsRemaining(): number | null {
  if (typeof window === "undefined") return null;
  if (!isGuestMode()) return null;
  try {
    const raw = window.localStorage.getItem(LC_GUEST_CLIPS_REMAINING_KEY);
    if (raw == null) return GUEST_CLIP_QUOTA;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : GUEST_CLIP_QUOTA;
  } catch {
    return null;
  }
}

export function decrementGuestClipsRemaining(): number {
  if (typeof window === "undefined") return 0;
  const current = readGuestClipsRemaining() ?? GUEST_CLIP_QUOTA;
  const next = Math.max(0, current - 1);
  try {
    window.localStorage.setItem(LC_GUEST_CLIPS_REMAINING_KEY, String(next));
  } catch {
    /* non-fatal */
  }
  return next;
}

export function isGuestQuotaExhausted(): boolean {
  if (!isGuestMode()) return false;
  return (readGuestClipsRemaining() ?? GUEST_CLIP_QUOTA) <= 0;
}

function markWelcomeAcked(mode: "clipper" | "agency" | "recovered" | "cold-signin"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LC_WELCOME_ACKED_KEY, "1");
    if (mode === "clipper") {
      window.localStorage.setItem(LC_GUEST_MODE_KEY, "1");
      if (window.localStorage.getItem(LC_GUEST_CLIPS_REMAINING_KEY) == null) {
        window.localStorage.setItem(LC_GUEST_CLIPS_REMAINING_KEY, String(GUEST_CLIP_QUOTA));
      }
    } else {
      window.localStorage.removeItem(LC_GUEST_MODE_KEY);
    }
  } catch {
    /* non-fatal */
  }
}

// ─── Carousel content ─────────────────────────────────────────────────

interface CarouselClip {
  url: string;
  handle: string;
  earningsCents?: number;
  platform?: string;
  campaignId?: string;
}

const BUNDLED_CLIPS: CarouselClip[] = [
  { url: "/demos/03-money-moment.mp4",       handle: "@clipsbyava",   earningsCents: 42400, platform: "tiktok" },
  { url: "/demos/01-clipping.mp4",           handle: "@daniel.clips", earningsCents: 18900, platform: "youtube_shorts" },
  { url: "/demos/07-cold-email-preview.mp4", handle: "@marcus.clips", earningsCents: 51200, platform: "instagram_reels" },
  { url: "/demos/04-wallet-payouts.mp4",     handle: "@june.paid",    earningsCents: 27300, platform: "tiktok" },
  { url: "/demos/02-login-activation.mp4",   handle: "@rileyclips",   earningsCents: 33100, platform: "youtube_shorts" },
  { url: "/demos/06-in-app-browser.mp4",     handle: "@zaraedits",    earningsCents: 61800, platform: "tiktok" },
  { url: "/demos/05-cancellation-save.mp4",  handle: "@leo.paid",     earningsCents: 24600, platform: "instagram_reels" },
  { url: "/demos/03-money-moment.mp4",       handle: "@nova.cuts",    earningsCents: 47500, platform: "youtube_shorts" },
];

// Kade backdrop rotation — 8 concepts generated 2026-07-06 via gpt-image-1.
// Assets in public/brand/. Rotation swaps every BACKDROP_ROTATION_MS unless
// user pins one via a manual pick. Dark themes flip contrast tokens for the
// login card + Powered-by-Whop lockup.
type BackdropKey =
  | "hero"
  | "hero-dark"
  | "presenter"
  | "conceptA"
  | "conceptB"
  | "conceptC"
  | "conceptD"
  | "conceptE";

interface Backdrop {
  key: BackdropKey;
  src: string;
  /** Dark backdrops flip [data-bg] so text tokens invert to light. */
  isDark: boolean;
}

const BACKDROPS: Backdrop[] = [
  { key: "hero",       src: "/brand/login-kade-hero-01.png",        isDark: false },
  { key: "hero-dark",  src: "/brand/login-kade-hero-dark-01.png",   isDark: true  },
  { key: "presenter",  src: "/brand/login-kade-presenter-01.png",   isDark: false },
  { key: "conceptA",   src: "/brand/login-kade-concept-A.png",      isDark: false },
  { key: "conceptB",   src: "/brand/login-kade-concept-B.png",      isDark: true  },
  { key: "conceptC",   src: "/brand/login-kade-concept-C.png",      isDark: false },
  { key: "conceptD",   src: "/brand/login-kade-concept-D.png",      isDark: false },
  { key: "conceptE",   src: "/brand/login-kade-concept-E.png",      isDark: true  },
];

const BACKDROP_ROTATION_MS = 12000;

async function fetchHqClips(
  cold?: ColdLeadContext | null,
  signal?: AbortSignal,
): Promise<CarouselClip[]> {
  try {
    const base = typeof window !== "undefined"
      ? (window as unknown as { __LC_BACKEND_URL__?: string }).__LC_BACKEND_URL__
      : undefined;
    const url = new URL((base ?? "https://api.liquidclips.app") + CAROUSEL_ENDPOINT);
    if (cold?.email) url.searchParams.set("cold_lead_email", cold.email);
    if (cold?.campaign_id) url.searchParams.set("campaign_id", cold.campaign_id);
    // Ship-lens P1-006: 8s timeout so slow HQ endpoint doesn't stall the
    // LoginScreen initial paint. Bundled clips render immediately anyway.
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(), 8000);
    const combined = signal
      ? { signal: mergeAbort(signal, timeoutCtrl.signal) }
      : { signal: timeoutCtrl.signal };
    try {
      const r = await fetch(url.toString(), {
        headers: { accept: "application/json" },
        ...combined,
      });
      if (!r.ok) return [];
      const data = (await r.json()) as { clips?: CarouselClip[] };
      return Array.isArray(data.clips) ? data.clips : [];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

/** Merge two AbortSignals · aborts on either. Node/whatwg polyfill-safe. */
function mergeAbort(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbortA = (): void => ctrl.abort(a.reason);
  const onAbortB = (): void => ctrl.abort(b.reason);
  a.addEventListener("abort", onAbortA, { once: true });
  b.addEventListener("abort", onAbortB, { once: true });
  return ctrl.signal;
}

function formatEarnings(cents?: number): string {
  if (cents == null || cents <= 0) return "";
  return `$${(cents / 100).toFixed(0)} earned`;
}


// ─── Component ────────────────────────────────────────────────────────

type WelcomePhase = "picking" | "activating";

interface WelcomeRouteProps {
  onDone: () => void;
}

export function WelcomeRoute({ onDone }: WelcomeRouteProps): ReactElement {
  const [phase, setPhase] = useState<WelcomePhase>("picking");
  const [pasteCode, setPasteCode] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [clips, setClips] = useState<CarouselClip[]>(BUNDLED_CLIPS);
  // 2026-07-06 · mandatory-LoginScreen State C — the inline Whop checkout.
  // Flipped on when the user picks either primary CTA. No back button on
  // purpose · the buyer either completes Whop or force-quits the app.
  const [signingIn, setSigningIn] = useState(false);
  const [signInMode, setSignInMode] = useState<"clipper" | "agency" | "cold-signin">("clipper");
  const [activationError, setActivationError] = useState<string | null>(null);
  // Backdrop rotation state · pinned=true stops the auto-rotate timer
  // (fires when the user manually clicks a tile — implicit "I want this").
  const [backdropIdx, setBackdropIdx] = useState(0);
  const [backdropPinned] = useState(false);
  const currentBackdrop = BACKDROPS[backdropIdx];
  // Audio unlock state · browsers block unmuted autoplay until a user
  // gesture. First click anywhere unmutes the tile closest to viewport
  // center. See preview §login-screen-preview.html:1109.
  const audioUnlockedRef = useRef(false);
  const currentlyAudibleVideoRef = useRef<HTMLVideoElement | null>(null);
  const marqueeVideoRefsRef = useRef<Array<HTMLVideoElement | null>>([]);

  // Capture cold-lead context from URL params on mount (idempotent).
  // Ship-lens P1-003: useMemo for side-effect is anti-pattern (React can
  // double-invoke in Strict Mode / skip in production optimizations). Use
  // useEffect for the write, useMemo for the read.
  useEffect(() => { captureColdLeadFromUrl(); }, []);
  const cold = useMemo<ColdLeadContext | null>(() => readColdLead(), []);
  const isColdLead = Boolean(cold && (cold.handle || cold.email));

  // Fetch HQ curated clips on mount · fall back to bundled silently.
  useEffect(() => {
    logLoginStep("login_screen_shown", { state: isColdLead ? "cold" : "fresh" });
    // Ship-lens P1-006: pass the AbortController's signal so an unmount
    // during the pending fetch cancels the network request, not just the
    // state write. Prevents accidental setClips on an unmounted component.
    const ctrl = new AbortController();
    let cancelled = false;
    void (async () => {
      const hq = await fetchHqClips(cold, ctrl.signal);
      if (cancelled) return;
      if (hq.length > 0) setClips(hq);
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [cold, isColdLead]);

  // (Single-video carousel replaced by the always-running marquee below.
  // The right column loops all clips continuously via CSS translateX.)

  // Backdrop auto-rotate every BACKDROP_ROTATION_MS · stops when pinned.
  useEffect(() => {
    if (backdropPinned) return;
    if (BACKDROPS.length <= 1) return;
    const t = setInterval(() => {
      setBackdropIdx((i) => (i + 1) % BACKDROPS.length);
    }, BACKDROP_ROTATION_MS);
    return () => clearInterval(t);
  }, [backdropPinned]);

  // First user gesture anywhere unlocks audio + unmutes the marquee tile
  // closest to viewport center. Keyboard press also unlocks (a11y).
  useEffect(() => {
    function centeredTileVideo(): HTMLVideoElement | null {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      let best: HTMLVideoElement | null = null;
      let bestDist = Infinity;
      for (const v of marqueeVideoRefsRef.current) {
        if (!v) continue;
        const r = v.getBoundingClientRect();
        if (r.right < 0 || r.left > window.innerWidth) continue;
        const midX = (r.left + r.right) / 2;
        const midY = (r.top + r.bottom) / 2;
        const d = Math.hypot(midX - cx, midY - cy);
        if (d < bestDist) { bestDist = d; best = v; }
      }
      return best;
    }
    function unmuteVideo(v: HTMLVideoElement | null): void {
      if (!v) return;
      const prev = currentlyAudibleVideoRef.current;
      if (prev && prev !== v) prev.muted = true;
      v.muted = false;
      v.volume = 0.6;
      currentlyAudibleVideoRef.current = v;
    }
    function unlockOnFirstGesture(): void {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;
      unmuteVideo(centeredTileVideo());
    }
    document.addEventListener("click", unlockOnFirstGesture, { capture: true });
    document.addEventListener("keydown", unlockOnFirstGesture, { capture: true, once: true });
    return () => {
      document.removeEventListener("click", unlockOnFirstGesture, { capture: true });
      document.removeEventListener("keydown", unlockOnFirstGesture, { capture: true });
    };
  }, []);

  // Per-tile hover-swap after audio is unlocked. Called from tile onMouseEnter.
  function handleMarqueeTileHover(v: HTMLVideoElement | null): void {
    if (!audioUnlockedRef.current) return;
    if (!v) return;
    const prev = currentlyAudibleVideoRef.current;
    if (prev && prev !== v) prev.muted = true;
    v.muted = false;
    v.volume = 0.6;
    currentlyAudibleVideoRef.current = v;
  }


  const totalEarnings = useMemo(() => {
    return clips.reduce((sum, c) => sum + (c.earningsCents ?? 0), 0);
  }, [clips]);
  const clipperCount = useMemo(() => clips.length * 87, [clips.length]);

  function onClipperClick(): void {
    logLoginStep("clipper_clicked");
    setSignInMode("clipper");
    setActivationError(null);
    setSigningIn(true);
  }

  function onAgencyClick(): void {
    logLoginStep("agency_clicked");
    setSignInMode("agency");
    setActivationError(null);
    setSigningIn(true);
  }

  function onColdSignInClick(): void {
    logLoginStep("agency_clicked", { via: "cold-signin" });
    setSignInMode("cold-signin");
    setActivationError(null);
    setSigningIn(true);
  }

  async function onWhopCheckoutComplete(
    receipt: InlineWhopCheckoutReceipt,
  ): Promise<void> {
    logLoginStep("whop_checkout_complete", {
      plan_id: receipt.planId,
      receipt_id: receipt.receiptId,
    });
    // Ship-lens P0-001 (2026-07-06): the previous inline-activation POST
    // to /desktop/connect-from-checkout fail-closes at the backend on
    // missing x-internal-secret · that header can't be safely embedded
    // in a client bundle. Canonical mint path is the Whop webhook →
    // Resend email → user pastes LC-ID via the recovery form below.
    // Show that state immediately instead of a 401 dance. Public sibling
    // endpoint (Whop-API-verified from-the-client) is a follow-up task.
    logLoginStep("whop_checkout_awaiting_email");
    setActivationError(
      "Card on file · check your email for a sign-in ID from Liquid Clips. Paste it into 'Have a discount code?' to open the app.",
    );
  }

  // Plan resolution (LOCKED 2026-07-06 · Whop-authorization architecture):
  //   - "I want to make clips"  → Gate 1 · WHOP_AUTHORIZATION_PLAN_ID
  //                                 ($1 one_time · card required · free
  //                                 tier gated by 10-clip local cap +
  //                                 feature ransom paywalls)
  //   - "I run an agency"       → Gate 2 · WHOP_FOUNDER_PLAN_ID
  //                                 ($99.99/mo Agency · immediate charge ·
  //                                 unlocks everything)
  //   - Cold-signin (State B)   → Gate 1 (assume clipper intent · they
  //                                 upgrade via ransom paywalls after)
  //   - QA mode                 → $2 test plan · same rail, safe seat
  //
  // Whop refuses any $0 plan with forced card entry (verified 2026-07-06
  // via 4-shape API probe). $1.00 is the absolute floor. This is the
  // min-viable Whop-native card-on-file trust wall.
  const activePlanId = isQaModeActive()
    ? WHOP_QA_TEST_PLAN_ID
    : signInMode === "agency"
      ? WHOP_FOUNDER_PLAN_ID
      : WHOP_AUTHORIZATION_PLAN_ID;

  async function onDiscountOrCodeSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    logLoginStep("paste_code_attempted");
    const trimmed = pasteCode.trim();
    if (!trimmed) {
      setPasteError("Enter a discount code or paste your activation URL.");
      return;
    }
    setPhase("activating");
    setPasteError(null);

    // Disambiguate: liquidclips:// URL or JWT-shaped string → activation;
    // else assume discount code and bounce to Whop checkout with the
    // promo query param (Whop's own promo handler picks it up).
    const looksLikeActivation =
      trimmed.startsWith("liquidclips://")
      || (trimmed.length > 60 && trimmed.includes(".") && trimmed.split(".").length === 3);

    if (looksLikeActivation) {
      try {
        const url = trimmed.startsWith("liquidclips://")
          ? trimmed
          : `liquidclips://activate?token=${encodeURIComponent(trimmed)}`;
        await handleActivationUrl(url);
        // Ship-lens P1-001 (2026-07-06): handleActivationUrl NEVER throws
        // per its contract in lib/activation.ts:368. Failure paths emit
        // {status:'failed'} silently. Read the post-await snapshot before
        // acking · otherwise a bad JWT paste silently drops the user into
        // the shell with no valid session.
        const snap = getActivationSnapshot();
        if (snap.status !== "activated") {
          setPhase("picking");
          const err = snap.error || "activation didn't complete";
          logLoginStep("paste_code_failed", { mode: "activation", error: err });
          setPasteError(`Activation failed: ${err}`);
          return;
        }
        logLoginStep("paste_code_succeeded", { mode: "activation" });
        // Preserve the mode the user picked before the email round-trip.
        // markWelcomeAcked("recovered") tags them as recovery-path; the
        // bus event carries the picked mode so the shell lands them in
        // the right home tab (clipper vs agency).
        markWelcomeAcked("recovered");
        bus.emit("mode:set", {
          mode: signInMode === "agency" ? "agency" : "clipper",
        });
        onDone();
        return;
      } catch (err) {
        // Defensive · reserved for imported activation modules that DO
        // throw despite the contract. handleActivationUrl itself doesn't.
        setPhase("picking");
        const msg = err instanceof Error ? err.message : String(err);
        logLoginStep("paste_code_failed", { mode: "activation", error: msg });
        setPasteError(`Activation failed: ${msg}`);
        return;
      }
    }

    // Treat as a Whop discount code. Store so the inline embed can pick it
    // up as an affiliateCode-equivalent later, then flip into State C so
    // the user completes the Whop hold inside the app. No browser hop.
    try {
      window.localStorage.setItem("lc:discount-code", trimmed);
    } catch {
      /* non-fatal */
    }
    logLoginStep("paste_code_succeeded", { mode: "discount-code" });
    setPhase("picking");
    setSignInMode("cold-signin");
    setActivationError(null);
    setSigningIn(true);
  }

  return (
    <Watchdog
      id="identity/id-09/login-screen"
      label="Post-splash LoginScreen (clips carousel + login picker)"
      cluster="identity"
      source="src/design-os/routes/WelcomeRoute.tsx"
    >
      <div
        className="lc-login-root"
        data-testid="welcome-route-root"
        data-phase={phase}
        data-state={signingIn ? "checkout" : (isColdLead ? "cold" : "fresh")}
        data-bg={currentBackdrop.key}
        data-bg-dark={currentBackdrop.isDark ? "1" : "0"}
        style={{
          ["--lc-backdrop-image" as string]: `url('${currentBackdrop.src}')`,
        }}
      >
        <style>{LOGIN_STYLES}</style>

        {/* LEFT · Login picker (State A/B) or full-width Whop checkout (State C).
            Grid cell 1. Kade shines through the empty CENTER grid cell (see CSS). */}
        <section className="lc-login-picker">
          <div className="lc-login-picker-inner">
            <img
              src="/brand/assets/wordmark-text.png"
              alt="Liquid Clips"
              className="lc-login-logo"
            />

            {signingIn ? (
              <>
                <h1 className="lc-login-title" style={{ fontSize: 24 }}>Authorize to continue.</h1>
                <p className="lc-login-sub">
                  Card on file with Whop · we&rsquo;ll email your Liquid Clips ID to sign in.
                </p>
                <InlineWhopCheckout
                  planId={activePlanId}
                  email={cold?.email}
                  onComplete={(receipt) => void onWhopCheckoutComplete(receipt)}
                />
                {activationError && (
                  <p
                    className="lc-login-recovery-error"
                    role="alert"
                    style={{ marginTop: 12 }}
                    data-testid="welcome-checkout-fallback-hint"
                  >
                    {activationError}
                  </p>
                )}
              </>
            ) : isColdLead ? (
              <>
                <h1 className="lc-login-title">Welcome, {cold?.handle ?? cold?.email ?? "clipper"}.</h1>
                <p className="lc-login-sub">
                  Your preview is on the left. Sign in and I&rsquo;ll load the rest of your clips.
                </p>
                <div className="lc-login-cta-col">
                  <button
                    type="button"
                    className="lc-login-cta lc-login-cta--primary"
                    data-testid="welcome-cold-signin"
                    onClick={onColdSignInClick}
                    autoFocus
                  >
                    <span className="lc-login-cta-icon" aria-hidden>✨</span>
                    <span className="lc-login-cta-label">
                      <strong>Sign in with Whop</strong>
                      <span>$1 Whop authorization · card on file</span>
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="lc-login-title">Pick your lane.</h1>
                <p className="lc-login-sub">
                  $1 Whop authorization · card on file · unlocks free clipping.
                </p>
                <div className="lc-login-cta-col">
                  <button
                    type="button"
                    className="lc-login-cta lc-login-cta--primary"
                    data-testid="welcome-clipper"
                    onClick={onClipperClick}
                    autoFocus
                  >
                    <span className="lc-login-cta-icon" aria-hidden>🎬</span>
                    <span className="lc-login-cta-label">
                      <strong>I want to make clips</strong>
                      <span>10 clips free · upgrade to unlock everything</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className="lc-login-cta lc-login-cta--secondary"
                    data-testid="welcome-agency"
                    onClick={onAgencyClick}
                  >
                    <span className="lc-login-cta-icon" aria-hidden>💼</span>
                    <span className="lc-login-cta-label">
                      <strong>I run an agency</strong>
                      <span>$0 today · $99.99/mo after · everything unlocked</span>
                    </span>
                  </button>
                </div>
              </>
            )}

            <details className="lc-login-recovery" data-testid="welcome-recovery">
              <summary>Have a discount code?</summary>
              <form onSubmit={(e) => void onDiscountOrCodeSubmit(e)} className="lc-login-recovery-form">
                <input
                  type="text"
                  placeholder="Discount code · or paste activation URL"
                  value={pasteCode}
                  onChange={(e) => setPasteCode(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={phase === "activating"}
                  data-testid="welcome-lcid-input"
                />
                <button type="submit" disabled={phase === "activating"} data-testid="welcome-lcid-submit">
                  {phase === "activating" ? "Applying…" : "Apply"}
                </button>
                {pasteError && (
                  <p className="lc-login-recovery-error" role="alert">
                    {pasteError}
                  </p>
                )}
              </form>
            </details>

            {/* Whop is the auth + card-capture rail · attribution required
             *  by Whop's partner-brand guidelines. Skill reference:
             *  ~/.claude/skills/powered-by-whop/. */}
            <div className="lc-login-powered-by">
              <PoweredByWhop size="sm" />
            </div>
          </div>
        </section>

        {/* RIGHT · Marquee of real clip MP4s. Kade fills the CENTER grid
            cell via the ::before backdrop (no DOM in the middle column).
            First user click unlocks audio + unmutes the center-most tile;
            hover after that swaps audio between tiles (single-active
            player). Hidden in State C (checkout) so the Whop iframe gets
            full width. */}
        <section className="lc-login-carousel" aria-label="Recent clips from Liquid Clips users">
          <div className="lc-marquee" data-testid="login-marquee">
            <div className="lc-marquee-track">
              {[...clips, ...clips].map((c, i) => (
                <div
                  key={`${c.url}-${i}`}
                  className="lc-marquee-tile"
                  onMouseEnter={(e) => {
                    const v = e.currentTarget.querySelector<HTMLVideoElement>("video");
                    handleMarqueeTileHover(v);
                  }}
                >
                  <video
                    ref={(el) => {
                      marqueeVideoRefsRef.current[i] = el;
                    }}
                    src={c.url}
                    muted
                    autoPlay
                    playsInline
                    loop
                    /* Ship-lens P1-004: 16 tiles = 16 decoders. preload=
                       "metadata" lets Chromium/WKWebView pull just the
                       moov box for autoplay-eligible tiles instead of
                       streaming full MP4 body on mount (~5.5MB of demos). */
                    preload="metadata"
                    aria-hidden
                  />
                  <div className="lc-marquee-tile-scrim" aria-hidden />
                  {formatEarnings(c.earningsCents) && (
                    <span className="lc-marquee-tile-earn">${((c.earningsCents ?? 0) / 100).toFixed(0)}</span>
                  )}
                  <span className="lc-marquee-tile-audio" aria-label="muted">🔇</span>
                  <span className="lc-marquee-tile-handle">{c.handle}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="lc-login-carousel-stats">
            <span className="lc-login-carousel-stats-num">{clipperCount.toLocaleString()}</span> clippers ·{" "}
            <span className="lc-login-carousel-stats-num">${(totalEarnings / 100).toFixed(0)}</span> paid last week
          </p>
        </section>
      </div>
    </Watchdog>
  );
}


const LOGIN_STYLES = `
/* ─── Ink tokens · flip per data-bg-dark ─────────────────────────────── */
.lc-login-root {
  --lc-ink:       #1a1424;
  --lc-ink-soft:  rgba(26, 20, 36, 0.72);
  --lc-ink-mute:  rgba(26, 20, 36, 0.55);
}
.lc-login-root[data-bg-dark="1"] {
  --lc-ink:       #f4f1ea;
  --lc-ink-soft:  rgba(244, 241, 234, 0.78);
  --lc-ink-mute:  rgba(244, 241, 234, 0.55);
}

/* ─── 3-column shell · login LEFT · Kade CENTER · marquee RIGHT ─────── */
.lc-login-root {
  position: fixed;
  inset: 0;
  z-index: 99900;
  display: grid;
  grid-template-columns:
    minmax(340px, 22%)     /* login LEFT */
    minmax(0, 1fr)         /* Kade CENTER · takes whatever's left */
    minmax(560px, 56%);    /* marquee RIGHT · flush to shell edge */
  color: var(--lc-ink);
  background: #f4f1ea;
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  animation: lc-login-fade-in 260ms ease-out;
  overflow: hidden;
}
.lc-login-root[data-bg-dark="1"] {
  background: #0b0b16;
}
@keyframes lc-login-fade-in { from { opacity: 0 } to { opacity: 1 } }

/* ─── Kade backdrop layer (::before) ─────────────────────────────────
   Scaled 130% wide + positioned 12% right so Kade lands INSIDE the
   center empty column. Crossfades on backdrop swap. */
.lc-login-root::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: var(--lc-backdrop-image);
  background-size: 130% auto;
  background-position: 12% center;
  background-repeat: no-repeat;
  z-index: 0;
  pointer-events: none;
  transition: background-image 800ms ease-in-out;
}

/* ─── Adaptive frost pane · left 46% only · flips per theme ────────── */
.lc-login-root::after {
  content: "";
  position: absolute;
  inset: 0;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 26%, transparent 46%);
          mask-image: linear-gradient(90deg, #000 0%, #000 26%, transparent 46%);
  backdrop-filter: blur(8px) saturate(0.90);
  -webkit-backdrop-filter: blur(8px) saturate(0.90);
  background:
    linear-gradient(90deg,
      rgba(255,241,232,0.72) 0%,
      rgba(255,241,232,0.55) 22%,
      rgba(255,241,232,0.18) 38%,
      transparent 46%);
  z-index: 0;
  pointer-events: none;
}
.lc-login-root[data-bg-dark="1"]::after {
  background:
    linear-gradient(90deg,
      rgba(11,11,22,0.78) 0%,
      rgba(11,11,22,0.58) 22%,
      rgba(11,11,22,0.20) 38%,
      transparent 46%);
}

/* Login picker column · grid col 1 · centered content · symmetric padding */
.lc-login-picker {
  order: 0;
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  padding: 40px 32px;
}
.lc-login-picker-inner {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

/* Marquee column · grid col 3 · flush to shell edge on the right */
.lc-login-carousel {
  order: 2;
  grid-column: 3;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 20px;
  padding: 24px 0;
  min-width: 0;
  overflow: hidden;
}

/* State C · Whop checkout takes the full shell width (marquee hidden,
   picker widens to fit the 520px iframe). Also hides the Powered-by-Whop
   line at the bottom of the picker so it doesn't duplicate the notch. */
.lc-login-root[data-state="checkout"] {
  grid-template-columns: 1fr 0 0;
}
.lc-login-root[data-state="checkout"] .lc-login-carousel { display: none; }
.lc-login-root[data-state="checkout"] .lc-login-picker-inner { max-width: 560px; }
.lc-login-root[data-state="checkout"] .lc-login-powered-by { display: none; }
.lc-login-root[data-state="checkout"]::before,
.lc-login-root[data-state="checkout"]::after { opacity: 0.35; }

/* ─── Text-only LC wordmark logo (no invader icon per Daniel 2026-07-06) ── */
.lc-login-logo {
  display: block;
  height: 32px;
  width: auto;
  margin-bottom: 6px;
  /* light bg: darken the wordmark outline strokes so they read */
  filter: brightness(0.24) contrast(1.4) saturate(1.2);
}
.lc-login-root[data-bg-dark="1"] .lc-login-logo {
  filter: brightness(1.05) contrast(1.1);
}

.lc-login-title {
  margin: 4px 0 0;
  font-family: var(--font-display, "Geist", -apple-system, sans-serif);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--lc-ink);
  line-height: 1.1;
}
.lc-login-sub {
  margin: 0 0 14px;
  font-size: 14px;
  color: var(--lc-ink-soft);
  line-height: 1.5;
  max-width: 100%;
}

.lc-login-cta-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.lc-login-cta {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 18px;
  border: 0;
  border-radius: 14px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.lc-login-cta:hover { transform: translateY(-1px) }
.lc-login-cta--primary {
  background: linear-gradient(180deg, #ff1a8c, #d40d70);
  color: #ffffff;
  box-shadow:
    0 10px 22px rgba(255,26,140,0.35),
    0 0 0 1px rgba(255,255,255,0.06) inset;
}
.lc-login-cta--secondary {
  background: rgba(0,0,0,0.04);
  color: var(--lc-ink);
  border: 1px solid rgba(0,0,0,0.10);
}
.lc-login-root[data-bg-dark="1"] .lc-login-cta--secondary {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.10);
}
.lc-login-cta--secondary:hover { border-color: rgba(255,26,140,0.5) }
.lc-login-cta-icon { font-size: 24px; line-height: 1; }
.lc-login-cta-label { display: flex; flex-direction: column; gap: 2px; }
.lc-login-cta-label strong { font-size: 15px; font-weight: 600; letter-spacing: 0; }
.lc-login-cta-label span {
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  opacity: 0.78;
}

/* ─── Marquee v2 · 8 tiles doubled · left-fade mask · flush right ───── */
.lc-marquee {
  position: relative;
  width: 100%;
  max-width: 100%;
  height: 460px;
  overflow: hidden;
  background: transparent;
  /* fade in from LEFT (blends into Kade's negative space) · flush RIGHT */
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 100%);
          mask-image: linear-gradient(90deg, transparent 0%, #000 6%, #000 100%);
}
.lc-marquee-track {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 24px;
  padding: 14px 0;
  align-items: center;
  animation: lc-marquee-slide 50s linear infinite;
  will-change: transform;
}
@keyframes lc-marquee-slide {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.lc-marquee-tile {
  flex: 0 0 auto;
  width: 246px;
  height: 432px;
  border-radius: 22px;
  overflow: hidden;
  background: #000;
  position: relative;
  box-shadow:
    0 20px 42px rgba(0,0,0,0.42),
    0 0 0 1px rgba(255, 26, 140, 0.18) inset,
    0 0 32px rgba(255, 26, 140, 0.12);
  isolation: isolate;
  transition:
    transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1),
    box-shadow 220ms ease-out;
  cursor: pointer;
}
.lc-marquee-tile:hover {
  transform: scale(1.06);
  box-shadow:
    0 30px 60px rgba(0,0,0,0.55),
    0 0 0 1px rgba(255, 26, 140, 0.45) inset,
    0 0 60px rgba(255, 26, 140, 0.35);
  z-index: 5;
}
.lc-marquee-tile video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; z-index: 1;
}
.lc-marquee-tile-scrim {
  position: absolute; inset: auto 0 0 0;
  height: 40%;
  background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.75) 100%);
  z-index: 2; pointer-events: none;
}
.lc-marquee-tile-earn {
  position: absolute; top: 12px; left: 12px; z-index: 3;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ff1a8c, #d40d70);
  color: #ffffff;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 12px rgba(255, 26, 140, 0.35);
}
.lc-marquee-tile-audio {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  font-size: 16px; opacity: 0.62;
  transition: opacity 220ms ease;
}
.lc-marquee-tile:hover .lc-marquee-tile-audio { opacity: 0; }
.lc-marquee-tile-handle {
  position: absolute; left: 14px; right: 14px; bottom: 12px; z-index: 3;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 12px; font-weight: 700; color: #ffffff;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 8px rgba(0,0,0,0.7);
}

.lc-login-carousel-stats {
  margin: 0;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lc-ink-mute);
  text-align: center;
}
.lc-login-carousel-stats-num { color: #ff1a8c; font-weight: 700; }
.lc-login-root[data-bg-dark="1"] .lc-login-carousel-stats-num { color: #ff66b8; }

/* ─── Discount/recovery collapse ─────────────────────────────────────── */
.lc-login-recovery {
  width: 100%;
  margin-top: 8px;
  border-top: 1px solid rgba(0,0,0,0.10);
  padding-top: 14px;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  color: var(--lc-ink-mute);
  text-align: left;
}
.lc-login-root[data-bg-dark="1"] .lc-login-recovery {
  border-top-color: rgba(255,255,255,0.10);
}
.lc-login-recovery summary {
  cursor: pointer;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lc-ink-soft);
  padding: 4px 0;
  outline: none;
}
.lc-login-recovery summary:hover { color: #ff1a8c }
.lc-login-recovery-form {
  display: flex; flex-direction: column; gap: 8px; margin-top: 8px;
}
.lc-login-recovery-form input {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(0,0,0,0.10);
  color: var(--lc-ink);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}
.lc-login-root[data-bg-dark="1"] .lc-login-recovery-form input {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.10);
}
.lc-login-recovery-form input:focus { border-color: rgba(255,26,140,0.5) }
.lc-login-recovery-form button {
  padding: 10px 14px;
  border-radius: 10px;
  border: 0;
  background: #ff1a8c;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.lc-login-recovery-form button:disabled { opacity: 0.6; cursor: progress }
.lc-login-recovery-error {
  margin: 4px 0 0;
  color: #d40d70;
  font-size: 11px;
}
.lc-login-root[data-bg-dark="1"] .lc-login-recovery-error {
  color: #ff8ab8;
}

/* ─── Powered by Whop · auto-flip per theme ──────────────────────────── */
.lc-login-powered-by {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  opacity: 0.85;
}

/* Below 900px · stack rows: login on top, marquee below (Kade fades) */
@media (max-width: 900px) {
  .lc-login-root {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    overflow-y: auto;
  }
  .lc-login-root::before { background-size: cover; background-position: center; opacity: 0.35; }
  .lc-login-carousel {
    order: 1;
    grid-column: 1;
    padding: 8px 0 24px;
  }
  .lc-marquee { height: 320px; }
  .lc-marquee-tile { width: 180px; height: 320px; }
  .lc-login-title { font-size: 24px }
}
`;
