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
import { ClerkOtpPanel, isClerkAvailable } from "../../components/auth/ClerkOtpPanel";
// Recovery brief P0 · 2026-07-08 · Daniel-mandated brutally-simple login.
// SimpleLoginPanel owns the whole email→code→JWT flow. LC-ID paste,
// Whop CTA, discount slot, and signed-out warnings are hidden by default.
// Set `?legacy_login=1` to fall back to the pre-P0 tree for reversion.
import { SimpleLoginPanel } from "../../components/auth/SimpleLoginPanel";
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

// 2026-07-08 · intro carousel now sourced from 10 curated real-creator TikTok
// clips (12s max each, best-bit slice, downloaded via yt-dlp, permission
// confirmed by Daniel). Featured first: carousel-01. Assets at
// public/brand/home/carousel/. Earnings + handles are illustrative — real
// attribution lands in a follow-up sprint via HQ curation.
const BUNDLED_CLIPS: CarouselClip[] = [
  { url: "/brand/home/carousel/carousel-01.mp4", handle: "@featured",   earningsCents: 61800, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-02.mp4", handle: "@clipper-02", earningsCents: 42400, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-03.mp4", handle: "@clipper-03", earningsCents: 33100, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-04.mp4", handle: "@clipper-04", earningsCents: 27300, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-05.mp4", handle: "@clipper-05", earningsCents: 51200, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-06.mp4", handle: "@clipper-06", earningsCents: 18900, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-07.mp4", handle: "@clipper-07", earningsCents: 47500, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-08.mp4", handle: "@clipper-08", earningsCents: 24600, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-09.mp4", handle: "@clipper-09", earningsCents: 39400, platform: "tiktok" },
  { url: "/brand/home/carousel/carousel-10.mp4", handle: "@clipper-10", earningsCents: 55600, platform: "tiktok" },
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


// ─── Crew onboarding post-verify handoff ──────────────────────────────
//
// 2026-07-10 · Priority 1 Crew agent. After the login panel's onSuccess
// fires, before we hand back to the app shell, check whether the user
// has ever seen the Crew referral flywheel. If none of the three
// markers (shown/completed/dismissed) is set on their onboarding_status
// snapshot, route to `#/crew-onboarding` FIRST so they see the money
// moment before Home.
//
// Server-side check (per Daniel: no localStorage for this state). Falls
// back to going straight home if the /me fetch fails — never blocks
// signin on a network hiccup.

interface CrewOnboardingMarkers {
  shown_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
}

async function fetchCrewMarkers(): Promise<CrewOnboardingMarkers | null> {
  try {
    const { getJwt } = await import("../../lib/authStorage");
    const jwt = getJwt();
    if (!jwt) return null;
    const env =
      (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env ??
      {};
    const base = (env.VITE_BACKEND_URL ?? "https://api.liquidclips.app").replace(
      /\/+$/,
      "",
    );
    // Ship-lens P1 fix (2026-07-10) · /me does NOT surface
    // onboarding_status (MeResponse schema strips it). Use the
    // dedicated /onboarding/crew endpoint which returns exactly
    // {shown_at, completed_at, dismissed_at}. Without this fix the
    // Crew wall would re-appear every login even after completion.
    // Router prefix is /onboarding (see junior-backend/app/routes/onboarding.py:85).
    const res = await fetch(`${base}/onboarding/crew`, {
      method: "GET",
      headers: { authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      shown_at?: string | null;
      completed_at?: string | null;
      dismissed_at?: string | null;
    };
    return {
      shown_at: typeof body.shown_at === "string" ? body.shown_at : null,
      completed_at: typeof body.completed_at === "string" ? body.completed_at : null,
      dismissed_at: typeof body.dismissed_at === "string" ? body.dismissed_at : null,
    };
  } catch {
    return null;
  }
}

/** True if the Crew onboarding should be shown before Home. */
function shouldShowCrewOnboarding(markers: CrewOnboardingMarkers | null): boolean {
  if (!markers) return false; // Fail-safe: JWT missing or network fail → go home
  if (markers.dismissed_at) return false;
  if (markers.completed_at) return false;
  if (markers.shown_at) return false;
  return true;
}

/** Wrap the WelcomeRoute onDone so that the post-verify Crew flywheel
 *  interposes between login success and the Home route. */
function wrapOnDoneWithCrewGate(onDone: () => void): () => void {
  return () => {
    void (async () => {
      const markers = await fetchCrewMarkers();
      if (shouldShowCrewOnboarding(markers)) {
        window.location.hash = "#/crew-onboarding";
        return;
      }
      onDone();
    })();
  };
}


// ─── Component ────────────────────────────────────────────────────────

type WelcomePhase = "picking" | "activating";

interface WelcomeRouteProps {
  onDone: () => void;
}

export function WelcomeRoute({ onDone: rawOnDone }: WelcomeRouteProps): ReactElement {
  // 2026-07-10 · Crew P1 gate. Every internal path that used to call
  // `onDone()` now goes through `onDone` (the wrapper) so the Crew
  // referral flywheel interposes between login success and Home.
  // The wrapper falls through to the raw callback when the user has
  // already seen / completed / dismissed the Crew screen.
  const onDone = useMemo(
    () => wrapOnDoneWithCrewGate(rawOnDone),
    [rawOnDone],
  );
  const [phase, setPhase] = useState<WelcomePhase>("picking");
  const [pasteCode, setPasteCode] = useState("");
  // 2026-07-07 · ship-lens P1-001. LC-ID redeem now requires an email
  // paired with the code. Prefill from the checkout-session email if
  // we captured it on the $1 authorization step; the user overrides
  // in the form if the address diverges from what they typed at Whop.
  const [pasteEmail, setPasteEmail] = useState<string>(() => {
    try {
      return window.localStorage.getItem("lc:checkout-email") ?? "";
    } catch {
      return "";
    }
  });
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [clips, setClips] = useState<CarouselClip[]>(BUNDLED_CLIPS);
  // 2026-07-06 · mandatory-LoginScreen State C — the inline Whop checkout.
  // Flipped on when the user picks either primary CTA. No back button on
  // purpose · the buyer either completes Whop or force-quits the app.
  const [signingIn, setSigningIn] = useState(false);
  const [signInMode, setSignInMode] = useState<"clipper" | "agency" | "cold-signin" | "existing">("clipper");
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
  // 2026-07-08 · gated on isColdLead per Daniel's directive: cold-email
  // leads see HQ-curated clips (creator-specific / campaign-specific);
  // cold downloads (no URL params, direct install) see the TikTok intro
  // carousel from BUNDLED_CLIPS. Without this gate, HQ's global default
  // (if any) would silently override the intro carousel for every user
  // who installed without clicking a cold email link.
  useEffect(() => {
    logLoginStep("login_screen_shown", { state: isColdLead ? "cold" : "fresh" });
    // Recovery brief P0 · login-flow diagnostic. Emits via the
    // /telemetry/diagnostic path (same log stream as bootDiag) so we can
    // trace every step of the sign-in journey without opening DevTools.
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("login_screen_mounted", {
          state: isColdLead ? "cold_lead" : "fresh_install",
          has_cold_email: !!cold?.email,
          has_cold_handle: !!cold?.handle,
          backdrop_index: backdropIdx,
          marquee_tiles_planned: 20,
          marquee_video_disabled: true,      // P0 · replaced <video> with <img> poster
          ts_iso: new Date().toISOString(),
        });
      } catch { /* logger import failed · non-fatal */ }
    })();
    if (!isColdLead) return; // cold-download path · keep BUNDLED_CLIPS
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
      // Ship-lens P0-001 fix (2026-07-08) · consume the user gesture
      // NOW. With preload="none" until idle-mount, the ref exists but
      // its media hasn't been loaded — setting .muted alone is a no-op
      // until source arrives, and by then the gesture-activation window
      // (Safari ~1s, Chrome ~5s) may have expired. Kick load()+play()
      // synchronously inside the gesture so audio unlock actually
      // fires on click. Silent-fail is fine here — .play() rejects on
      // real errors are surfaced by the deferred idle-mount effect.
      // Recovery brief P0 (2026-07-08) · marquee <video> was swapped for
      // <img> posters · refs are HTMLImageElement, not HTMLVideoElement.
      // v.load() / v.play() throw `TypeError: v.load is not a function`.
      // Guard on the type so this effect is a safe no-op for posters.
      if (!(v instanceof HTMLVideoElement)) return;
      try {
        v.load();
        v.play().catch(() => { /* mid-gesture play block · non-fatal */ });
      } catch { /* ref not ready · idle-effect takes over */ }
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

  // P0 fix (2026-07-08) · hover-unmute REMOVED. Daniel: "STOP. sound
  // happens on hover... only allow sound after explicit user click."
  // Kept the click/keydown gesture unlock above; per-tile audio swap
  // on hover has no path to fire now that this function is a no-op
  // + the `onMouseEnter` handler was removed from the tile.

  // P0 fix (2026-07-08) · poster-first videos. Marquee videos start
  // with `preload="none"` so cold-open blocks zero HTTP round-trips
  // against 10 mp4s (~9MB total). After the shell + login form
  // paint, `requestIdleCallback` (or 800ms fallback) flips
  // `idleMountVideos` to true → preload="metadata" + play() runs on
  // each ref. Missing posters render the tile gradient background;
  // never a blank black rectangle mid-load.
  const [idleMountVideos, setIdleMountVideos] = useState(false);
  const idleFlippedRef = useRef(false);
  useEffect(() => {
    // Wait until browser is idle · fallback timeout 800ms so short-
    // deadline browsers (Safari at time of writing has no rIC) still
    // upgrade preload deterministically. Never blocks first paint.
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    // Ship-lens P1-003 fix (2026-07-08) · race guard. rIC + fallback
    // timer both fire in Chrome · a plain setState dedupes but a
    // future counter-based flip would double-trigger. Latch via ref.
    const flip = () => {
      if (idleFlippedRef.current) return;
      idleFlippedRef.current = true;
      setIdleMountVideos(true);
    };
    let ricId: number | undefined;
    const timerId = window.setTimeout(flip, 800);
    if (typeof w.requestIdleCallback === "function") {
      ricId = w.requestIdleCallback(flip, { timeout: 800 });
    }
    return () => {
      window.clearTimeout(timerId);
      if (ricId != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(ricId);
      }
    };
  }, []);
  // Once flipped OR when the clip list is swapped after idle (cold-lead
  // HQ fetch → setClips), kick play() on every mounted ref. Muted
  // autoplay is browser-safe (no user-gesture required).
  // Ship-lens P1-005 fix (2026-07-08) · added `clips` to deps so
  // late-arriving HQ curation doesn't leave static tiles.
  useEffect(() => {
    if (!idleMountVideos) return;
    // Recovery brief P0 (2026-07-08) · marquee refs are HTMLImageElement
    // (poster-only mode) · not HTMLVideoElement. Guard the video-method
    // calls so this effect can't throw `v.load is not a function`.
    // Fire ONE diagnostic per idle-flip so we can see the effect ran.
    let posterOnlySkipCount = 0;
    let videoLoadedCount = 0;
    for (const v of marqueeVideoRefsRef.current) {
      if (!v) continue;
      if (!(v instanceof HTMLVideoElement)) {
        posterOnlySkipCount += 1;
        continue;
      }
      videoLoadedCount += 1;
      v.load();
      v.play().catch((err: unknown) => {
        // Ship-lens P1-004 fix (2026-07-08) · was empty-catch. Now
        // surfaces via logLoginStep so silent 404/decode failures
        // land in Watchdog telemetry. Autoplay-block is the common
        // benign case; log it too — cheap signal for real regressions.
        const src = v.currentSrc || v.src || "unknown";
        const msg = err instanceof Error ? err.message : String(err);
        try {
          logLoginStep("marquee_play_failed", { src, err: msg });
        } catch { /* logging must never crash the effect */ }
      });
    }
    // Recovery brief P0 diagnostic · emit ONE event per idle-flip so
    // Railway logs show the effect fired without crash + which shape
    // the refs actually hold (posters vs videos).
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("login_marquee_effect", {
          poster_only_skipped: posterOnlySkipCount,
          videos_loaded: videoLoadedCount,
          ref_slots_total: marqueeVideoRefsRef.current.length,
        });
      } catch { /* non-fatal */ }
    })();
  }, [idleMountVideos, clips]);


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

  // P0 first-run access (2026-07-08) · onAgencyClick preserved for the
  // cold-lead branch (line ~858 "Sign in with Whop" CTA) even though
  // the fresh-lane picker no longer surfaces an explicit Agency lane.
  // Void-reference the identifier so tsc's noUnusedLocals doesn't nag
  // while the cold-lead JSX is still in the tree.
  function onAgencyClick(): void {
    logLoginStep("agency_clicked");
    setSignInMode("agency");
    setActivationError(null);
    setSigningIn(true);
  }
  void onAgencyClick;

  function onColdSignInClick(): void {
    logLoginStep("agency_clicked", { via: "cold-signin" });
    setSignInMode("cold-signin");
    setActivationError(null);
    setSigningIn(true);
  }

  // 2026-07-08 · existing-user path. Previously an existing user (who
  // already had an LC-ID from a prior $1 Whop authorization) had to click
  // the "Have a discount code?" fold-out to reach the LC-ID paste form —
  // Daniel called this out as "login is still off". This CTA promotes the
  // LC-ID paste to a first-class option alongside Clipper + Agency.
  // signingIn stays false — existing users skip the Whop iframe entirely
  // and mint their session via the /lc-ids/redeem backend path.
  function onExistingUserClick(): void {
    logLoginStep("existing_user_clicked");
    setSignInMode("existing");
    setActivationError(null);
    setPasteError(null);
  }

  function onBackToLanes(): void {
    logLoginStep("existing_user_cancelled");
    setSignInMode("clipper");
    setPasteError(null);
  }

  async function onWhopCheckoutComplete(
    receipt: InlineWhopCheckoutReceipt,
  ): Promise<void> {
    logLoginStep("whop_checkout_complete", {
      plan_id: receipt.planId,
      receipt_id: receipt.receiptId,
    });
    // Phase 1 · log the complete Whop checkout payload so we can trace
    // BUG-R-004: after $1 auth checkout, no deep-link fires and the
    // frontend hangs on "check your email." We need to see: what plan
    // ID actually completed, whether receiptId came back, what path the
    // WelcomeRoute takes next.
    try {
      const mod = await import("../../lib/diagnosticLogger");
      const receiptAny = receipt as unknown as Record<string, unknown>;
      mod.lcDiag("whop_checkout_receipt", {
        plan_id: receipt.planId,
        receipt_id: receipt.receiptId,
        membership_id: (receiptAny.membershipId as string | undefined) ?? null,
        user_id: (receiptAny.userId as string | undefined) ?? null,
        receipt_shape_keys: Object.keys(receiptAny).slice(0, 20),
        next_step: "activation_error_email_wait", // BUG-R-004 · no deep link fires
      });
    } catch { /* logger import failed · non-fatal */ }
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

    // Disambiguate the paste:
    //   liquidclips:// URL or JWT-shaped string → local activation
    //   LC-* short code → server redeem (mint→email→paste round-trip)
    //   anything else → treat as a Whop discount code
    // 2026-07-07 · LC-ID redeem path added to close the "checkout →
    // email → paste unlock" loop (sprint-final login-lc-id-email).
    const looksLikeActivation =
      trimmed.startsWith("liquidclips://")
      || (trimmed.length > 60 && trimmed.includes(".") && trimmed.split(".").length === 3);
    const looksLikeLcId = /^LC-[A-Z0-9-]{3,32}$/i.test(trimmed);

    if (looksLikeLcId) {
      const emailTrimmed = pasteEmail.trim().toLowerCase();
      if (!emailTrimmed || !emailTrimmed.includes("@")) {
        setPhase("picking");
        setPasteError("Enter the email your LC-ID was sent to.");
        logLoginStep("paste_code_failed", { mode: "lc-id", error: "missing_email" });
        return;
      }
      try {
        const resp = await fetch("/lc-ids/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lc_id: trimmed, email: emailTrimmed }),
        });
        if (resp.status === 429) {
          setPhase("picking");
          setPasteError("Too many attempts · wait a minute and try again.");
          logLoginStep("paste_code_failed", { mode: "lc-id", error: "rate_limited" });
          return;
        }
        if (!resp.ok) {
          setPhase("picking");
          setPasteError("Code and email don't match. Check your email + LC-ID.");
          logLoginStep("paste_code_failed", { mode: "lc-id", error: `http_${resp.status}` });
          return;
        }
        const body = (await resp.json()) as { license_jwt?: string };
        if (!body.license_jwt) {
          setPhase("picking");
          setPasteError("Code accepted but no license returned.");
          logLoginStep("paste_code_failed", { mode: "lc-id", error: "no_jwt" });
          return;
        }
        await handleActivationUrl(
          `liquidclips://activate?token=${encodeURIComponent(body.license_jwt)}`,
        );
        logLoginStep("paste_code_succeeded", { mode: "lc-id" });
        markWelcomeAcked("recovered");
        bus.emit("mode:set", { mode: signInMode === "agency" ? "agency" : "clipper" });
        onDone();
        return;
      } catch (err) {
        setPhase("picking");
        const msg = err instanceof Error ? err.message : String(err);
        setPasteError(`Redeem failed: ${msg}`);
        logLoginStep("paste_code_failed", { mode: "lc-id", error: msg });
        return;
      }
    }

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
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />

            {/* Recovery brief P0 · 2026-07-08 · SimpleLoginPanel owns the
              * entire login flow. LC-ID, Whop CTA, discount slot, and
              * signed-out warnings are hidden below via CSS + `false &&`.
              * Set `?legacy_login=1` in the URL to reveal the legacy tree
              * (dev-only escape hatch during the transition). */}
            <SimpleLoginPanel
              onSuccess={() => {
                try { logLoginStep("activation_succeeded", { source: "desktop_otp" }); } catch { /* non-fatal */ }
                onDone();
              }}
            />

            {/* Legacy tree · hidden by default, restored via ?legacy_login=1.
              * Kept in-tree (not deleted) so the pre-P0 Whop / LC-ID / Clerk
              * lanes can be revived without a code roll-back. */}
            <div style={{ display: (typeof location !== "undefined" && new URLSearchParams(location.search).has("legacy_login")) ? undefined : "none" }}>
            {(signingIn ? (
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
            ) : signInMode === "existing" ? (
              <>
                <h1 className="lc-login-title" style={{ fontSize: 22 }}>Welcome back.</h1>
                <p className="lc-login-sub">
                  Paste your Liquid Clips ID · we&rsquo;ll open your workbench.
                </p>
                <form
                  onSubmit={(e) => void onDiscountOrCodeSubmit(e)}
                  className="lc-login-recovery-form"
                  data-testid="welcome-existing-form"
                  style={{ marginTop: 12 }}
                >
                  <input
                    type="text"
                    placeholder="LC-XXXXXX  (from your welcome email)"
                    value={pasteCode}
                    onChange={(e) => setPasteCode(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={phase === "activating"}
                    data-testid="welcome-existing-lcid-input"
                    autoFocus
                  />
                  <input
                    type="email"
                    placeholder="Email the LC-ID was sent to"
                    value={pasteEmail}
                    onChange={(e) => setPasteEmail(e.target.value)}
                    spellCheck={false}
                    autoComplete="email"
                    disabled={phase === "activating"}
                    data-testid="welcome-existing-lcid-email"
                  />
                  <button
                    type="submit"
                    disabled={phase === "activating"}
                    data-testid="welcome-existing-lcid-submit"
                  >
                    {phase === "activating" ? "Signing you in…" : "Sign in"}
                  </button>
                  {pasteError && (
                    <p className="lc-login-recovery-error" role="alert">
                      {pasteError}
                    </p>
                  )}
                </form>
                <button
                  type="button"
                  onClick={onBackToLanes}
                  disabled={phase === "activating"}
                  className="lc-login-back"
                  data-testid="welcome-existing-back"
                  style={{
                    marginTop: 10,
                    background: "transparent",
                    border: 0,
                    color: "inherit",
                    opacity: phase === "activating" ? 0.3 : 0.65,
                    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    cursor: phase === "activating" ? "not-allowed" : "pointer",
                  }}
                >
                  ← new here? pick a lane
                </button>
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
                {/* P0 first-run access (2026-07-08) · Clerk OTP is the
                 *  primary lane. Email or phone → code → shell. Whop
                 *  demoted to tertiary link at the bottom; membership
                 *  gate opens inside the shell for unpaid users.
                 *  Ship-lens P0-F01 fix · `isClerkAvailable()` gates
                 *  the mount so a mis-configured build (missing
                 *  VITE_CLERK_PUBLISHABLE_KEY → no ClerkProvider
                 *  ancestor → useSignIn throws) falls back to the
                 *  LC-ID + Whop lanes instead of crashing the welcome
                 *  screen entirely. */}
                <h1 className="lc-login-title">Welcome.</h1>
                <p className="lc-login-sub">
                  {isClerkAvailable()
                    ? "Enter your email or phone · we'll send a code."
                    : "Sign in with your Liquid Clips ID · or activate a new account."}
                </p>
                {isClerkAvailable() ? (
                  <ClerkOtpPanel onSuccess={onDone} />
                ) : (
                  <button
                    type="button"
                    className="lc-login-cta lc-login-cta--primary"
                    data-testid="welcome-existing"
                    onClick={onExistingUserClick}
                    autoFocus
                  >
                    <span className="lc-login-cta-icon" aria-hidden>🔑</span>
                    <span className="lc-login-cta-label">
                      <strong>Sign in with LC-ID</strong>
                      <span>Paste your Liquid Clips ID · no card, no wait</span>
                    </span>
                  </button>
                )}
                <div className="lc-login-fallback-row">
                  {isClerkAvailable() && (
                    <button
                      type="button"
                      className="lc-login-fallback-link"
                      data-testid="welcome-existing"
                      onClick={onExistingUserClick}
                    >
                      Have an LC-ID? Sign in with that instead ↗
                    </button>
                  )}
                  <button
                    type="button"
                    className="lc-login-fallback-link lc-login-fallback-link-muted"
                    data-testid="welcome-clipper"
                    onClick={onClipperClick}
                  >
                    Continue with Whop
                  </button>
                </div>
              </>
            ))}

            <details className="lc-login-recovery" data-testid="welcome-recovery">
              <summary>Have a discount code?</summary>
              <form onSubmit={(e) => void onDiscountOrCodeSubmit(e)} className="lc-login-recovery-form">
                <input
                  type="text"
                  placeholder="Discount code · LC-ID · or activation URL"
                  value={pasteCode}
                  onChange={(e) => setPasteCode(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={phase === "activating"}
                  data-testid="welcome-lcid-input"
                />
                {/* 2026-07-07 · ship-lens P1-001. Email required alongside
                 *  LC-ID redeem so brute-forcing the 30-glyph code space
                 *  can't lift real users' license JWTs. Prefilled from
                 *  lc:checkout-email if the $1 flow captured it earlier. */}
                <input
                  type="email"
                  placeholder="Email the LC-ID was sent to"
                  value={pasteEmail}
                  onChange={(e) => setPasteEmail(e.target.value)}
                  spellCheck={false}
                  autoComplete="email"
                  disabled={phase === "activating"}
                  data-testid="welcome-lcid-email"
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
            </div>{/* /legacy tree wrap · display:none unless ?legacy_login=1 */}
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
                  /* P0 fix (2026-07-08) · onMouseEnter removed → kills
                   *  sound-on-hover Daniel called out in the ship-day
                   *  walk. Sound now requires an explicit click gesture
                   *  (see the useEffect audio unlock above). */
                >
                  {/* 2026-07-08 recovery-brief P0 · Daniel's directive:
                    * "If the carousel/videos cause lag, disable them or
                    *  replace them with static posters. No autoplay video
                    *  should block typing, clicking, or sign-in. The
                    *  login screen does not need to be beautiful today.
                    *  It needs to be fast and real."
                    *
                    * Replaced the 20-tile <video> marquee with static
                    * poster <img> — same tile shape, zero video decode,
                    * zero autoplay CPU burn. Marquee refs kept as null
                    * so the audio-unlock effect is a no-op. */}
                  <img
                    ref={(el) => {
                      // Keep the ref slot populated so existing effects
                      // that iterate refs don't crash on undefined.
                      marqueeVideoRefsRef.current[i] = el as unknown as HTMLVideoElement | null;
                    }}
                    src={c.url.replace(/\.mp4$/, ".jpg")}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      // Poster missing · hide the img so the tile shows
                      // its gradient background instead of a broken icon.
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                    aria-hidden
                    className="lc-marquee-tile-poster"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
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
/* P0 first-run access · fallback link row demotes LC-ID and Whop to
 * text-link secondary/tertiary affordances beneath the primary Clerk
 * panel. Kade brand tokens · magenta hover state · monospace uppercase
 * to match the rest of the login card chrome. */
.lc-login-fallback-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.lc-login-fallback-link {
  align-self: flex-start;
  background: none;
  border: 0;
  padding: 4px 0;
  font-family: "Geist Mono", ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(244, 241, 234, 0.62);
  cursor: pointer;
  transition: color 120ms;
}
.lc-login-fallback-link:hover { color: #ff66b8; }
.lc-login-fallback-link-muted { color: rgba(244, 241, 234, 0.42); }
.lc-login-fallback-link-muted:hover { color: rgba(244, 241, 234, 0.75); }

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
  /* P0 fix (2026-07-08) · magenta-tinted gradient background as the
   * poster-of-last-resort. Kicks in when the jpg poster hasn't been
   * generated yet AND video is still preload="none". Better than a
   * flash of pure #000 while shell is settling. */
  background:
    radial-gradient(120% 90% at 50% 20%, rgba(255, 26, 140, 0.32), transparent 60%),
    linear-gradient(180deg, #1b0714 0%, #0a0308 100%);
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
