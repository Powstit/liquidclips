"use client";

import { useEffect, useRef, useState } from "react";
import { SignIn, useUser } from "@clerk/nextjs";

// /connect-desktop — the browser half of the desktop activation bridge.
//
// The Liquid Clips desktop opens this URL with a one-time ?challenge=<nonce>. Flow:
//   1. Not signed in → embedded Clerk sign-in, returns right back here.
//   2. Signed in → POST /api/desktop/connect { challenge } (server mints the
//      license JWT against the VERIFIED Clerk session).
//   3. Deep-link back to the desktop: junior://activate?token=<jwt>&challenge=…
//      The desktop verifies the challenge, stores the JWT, and flips signed-in.
//
// The challenge is stashed in sessionStorage so it survives the sign-in
// round-trip even if the redirect drops the query string.

type Phase =
  | { k: "loading" }
  | { k: "need_signin" }
  | { k: "minting" }
  | { k: "ready"; deepLink: string }
  | { k: "error"; msg: string };

const CHALLENGE_KEY = "jnr_connect_challenge";

// Whop True Login (desktop/docs/WHOP_TRUE_LOGIN_SCOPE.md). When the flag is
// off the button hides and the page behaves exactly like the Clerk-only
// flow. Toggle on Vercel without redeploy via NEXT_PUBLIC_WHOP_SIGNIN_ENABLED.
const WHOP_SIGNIN_ENABLED = process.env.NEXT_PUBLIC_WHOP_SIGNIN_ENABLED === "true";
const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.liquidclips.app";
const WHOP_AFFILIATE_URL = process.env.NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL ?? "";

// Set by the /auth/whop/callback when the OAuth path can't complete cleanly.
// Drives the inline banner so the user sees a specific reason, not the
// generic Clerk sign-in screen.
type WhopUrlState = "none" | "nomembership" | "cancelled" | "disabled" | "error";

function readChallenge(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("challenge");
  if (fromUrl) {
    try {
      sessionStorage.setItem(CHALLENGE_KEY, fromUrl);
    } catch {
      /* private mode — URL value still works for this load */
    }
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(CHALLENGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readWhopUrlState(): WhopUrlState {
  if (typeof window === "undefined") return "none";
  const q = new URLSearchParams(window.location.search);
  if (q.get("whop_nomembership") === "1") return "nomembership";
  if (q.get("whop_cancelled") === "1") return "cancelled";
  if (q.get("whop_disabled") === "1") return "disabled";
  if (q.get("whop_error")) return "error";
  return "none";
}

/**
 * 2026-07-05 · user-journey-lens + customer-journey-lens P0 · Whop
 * checkout-first arrival.
 *
 * `whop_checkout_success.py:145-158` redirects the "new Whop buyer
 * without a Clerk account" here with:
 *   /connect-desktop?whop_checkout=1&membership_id=<mid>&email=<enc>
 *
 * The buyer completed Whop checkout, has a paid trial, but has never
 * signed up on Clerk. If we required a `challenge` (as the OAuth flow
 * does) we would dead-end them at "Missing activation code."
 *
 * Instead, when we see `whop_checkout=1`:
 *   1. Not signed in → show Clerk sign-up with email prefilled.
 *   2. Signed in → POST /api/desktop/connect-whop-checkout with the
 *      `membership_id` (server drains PendingWhopMembership + mints
 *      JWT + returns license_jwt). Redirect to the deep link with
 *      `source=whop-checkout` so activation.ts skips the challenge
 *      check via the TRUSTED_CHALLENGELESS_SOURCES allowlist.
 */
interface WhopCheckoutContext {
  membershipId: string;
  email: string | null;
}

function readWhopCheckoutContext(): WhopCheckoutContext | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get("whop_checkout") !== "1") return null;
  const mid = q.get("membership_id");
  if (!mid) return null;
  return { membershipId: mid, email: q.get("email") };
}

export default function ConnectDesktopPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [challenge, setChallenge] = useState("");
  const [whopUrlState, setWhopUrlState] = useState<WhopUrlState>("none");
  const [whopCheckout, setWhopCheckout] = useState<WhopCheckoutContext | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const minted = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes React state with an external system — legitimate useEffect
    setChallenge(readChallenge());
    setWhopUrlState(readWhopUrlState());
    setWhopCheckout(readWhopCheckoutContext());
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes React state with an external system — legitimate useEffect
      setPhase({ k: "need_signin" });
      return;
    }
    // 2026-07-05 · new Whop-checkout arrival branch. If the URL carries
    // `whop_checkout=1&membership_id=X` we drain the pending membership
    // instead of demanding a challenge. See helper above.
    if (whopCheckout && !challenge) {
      if (minted.current) return;
      minted.current = true;
      void (async () => {
        setPhase({ k: "minting" });
        try {
          const res = await fetch("/api/desktop/connect-whop-checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ membership_id: whopCheckout.membershipId }),
          });
          if (!res.ok) {
            let msg = `Activation failed (HTTP ${res.status}). Please try again.`;
            try {
              const body = (await res.json()) as { detail?: string; error?: string };
              const detail = body?.detail || body?.error;
              if (typeof detail === "string" && detail.trim()) msg = detail;
            } catch { /* keep generic */ }
            setPhase({ k: "error", msg });
            return;
          }
          const data = (await res.json()) as { license_jwt?: string };
          if (!data.license_jwt) {
            setPhase({ k: "error", msg: "Activation response was incomplete. Please try again." });
            return;
          }
          const deepLink = `liquidclips://activate?token=${encodeURIComponent(
            data.license_jwt,
          )}&source=whop-checkout`;
          setPhase({ k: "ready", deepLink });
          window.location.href = deepLink;
        } catch {
          setPhase({ k: "error", msg: "Network error · retry from the desktop Sign in button." });
        }
      })();
      return;
    }
    if (!challenge) {
      setPhase({
        k: "error",
        msg: "Missing activation code. Re-open this from the Liquid Clips desktop app’s Sign in button.",
      });
      return;
    }
    if (minted.current) return;
    minted.current = true;

    void (async () => {
      setPhase({ k: "minting" });
      try {
        const res = await fetch("/api/desktop/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challenge }),
        });
        if (!res.ok) {
          // Surface the real server error rather than a guess — the upsert path
          // means a verified Clerk session should always succeed or expose a
          // genuine server-side problem. (The old "user not found, wait and
          // retry" copy was a workaround for a webhook race that this bridge
          // now self-heals.)
          let msg = `Activation failed (HTTP ${res.status}). Please try again.`;
          try {
            const body = (await res.json()) as { detail?: string; error?: string };
            const detail = body?.detail || body?.error;
            if (typeof detail === "string" && detail.trim()) msg = detail;
          } catch {
            /* response wasn't JSON — keep the generic message */
          }
          setPhase({ k: "error", msg });
          return;
        }
        const data = (await res.json()) as { license_jwt?: string };
        if (!data.license_jwt) {
          setPhase({ k: "error", msg: "Activation response was incomplete. Please try again." });
          return;
        }
        const deepLink = `liquidclips://activate?token=${encodeURIComponent(
          data.license_jwt,
        )}&challenge=${encodeURIComponent(challenge)}`;
        try {
          sessionStorage.removeItem(CHALLENGE_KEY);
        } catch {
          /* best-effort */
        }
        setPhase({ k: "ready", deepLink });
        // Hand back to the desktop. The OS shows an "Open Liquid Clips?" prompt; the
        // manual button below is the fallback if the auto-redirect is blocked.
        window.location.href = deepLink;
      } catch {
        setPhase({
          k: "error",
          msg: "Couldn’t reach Liquid Clips’s servers. Check your connection and retry.",
        });
      }
    })();
  }, [isLoaded, isSignedIn, challenge]);

  if (phase.k === "need_signin") {
    const back = `/connect-desktop?challenge=${encodeURIComponent(challenge)}`;
    const whopStartHref = challenge
      ? `${BACKEND_URL}/auth/whop/start?challenge=${encodeURIComponent(challenge)}`
      : "";
    return (
      <Shell eyebrow="connect desktop" title="Sign in to activate Liquid Clips.">
        <WhopBanner state={whopUrlState} />
        <SignIn
          routing="hash"
          signUpUrl={`/sign-up?redirect_url=${encodeURIComponent(back)}`}
          forceRedirectUrl={back}
          signUpForceRedirectUrl={back}
        />
        {WHOP_SIGNIN_ENABLED && whopStartHref && whopUrlState !== "disabled" && (
          <div className="flex w-full max-w-[440px] flex-col items-center gap-3">
            {/* Quiet category break — Clerk owns the "OR" vocabulary inside its widget. */}
            <span className="h-px w-full bg-line" />
            <a
              href={whopStartHref}
              className="w-full rounded-full border border-line bg-paper px-5 py-2.5 text-center font-sans text-[14px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
            >
              Continue with Whop
            </a>
            <p className="text-center font-sans text-[11px] text-text-tertiary">
              For members who bought via a creator link.
            </p>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell
      eyebrow="connect desktop"
      title={
        phase.k === "error" ? "Activation hit a snag." : "Activating Liquid Clips on this device…"
      }
    >
      <div className="flex w-full max-w-[440px] flex-col items-center gap-5">
        {phase.k !== "error" && (
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div className="h-full w-2/5 animate-[connect-bar_1.4s_ease-in-out_infinite] rounded-full bg-fuchsia" />
          </div>
        )}
        <p className="text-center font-mono text-[12px] uppercase tracking-[0.14em] text-text-secondary">
          {phase.k === "loading" && "preparing…"}
          {phase.k === "minting" && "issuing your license…"}
          {phase.k === "ready" && "returning you to Liquid Clips…"}
          {phase.k === "error" && phase.msg}
        </p>

        {phase.k === "ready" && (
          <a
            href={phase.deepLink}
            className="rounded-full bg-ink px-5 py-2.5 font-sans text-[14px] font-medium text-paper transition-colors hover:bg-fuchsia"
          >
            Open Liquid Clips →
          </a>
        )}
        {phase.k === "ready" && (
          <p className="text-center font-sans text-[12px] text-text-tertiary">
            If nothing happened, click “Open Liquid Clips”. You can close this tab once
            the desktop says you’re signed in.
          </p>
        )}
        {phase.k === "error" && (
          <button
            onClick={() => {
              minted.current = false;
              setChallenge(readChallenge());
              setPhase({ k: "loading" });
            }}
            className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink transition-colors hover:border-fuchsia"
          >
            Try again
          </button>
        )}
      </div>

      <style>{`@keyframes connect-bar{0%{transform:translateX(-100%)}50%{transform:translateX(120%)}100%{transform:translateX(280%)}}`}</style>
    </Shell>
  );
}

function WhopBanner({ state }: { state: WhopUrlState }) {
  if (state === "none") return null;

  if (state === "nomembership") {
    return (
      <div className="flex w-full max-w-[440px] flex-col items-center gap-3 rounded-2xl border border-line bg-paper px-5 py-4 text-center">
        <p className="font-sans text-[14px] font-medium text-ink">
          No Liquid Clips membership found on that Whop account.
        </p>
        <p className="font-sans text-[12px] text-text-secondary">
          You can pick one up below, or sign in with Google to use an existing
          direct account.
        </p>
        {WHOP_AFFILIATE_URL && (
          <a
            href={WHOP_AFFILIATE_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper transition-colors hover:bg-fuchsia"
          >
            Get a membership →
          </a>
        )}
      </div>
    );
  }

  // cancelled / disabled / error — single compact strip; the user can retry
  // Whop or fall through to the Clerk widget below.
  const msg: Record<Exclude<WhopUrlState, "none" | "nomembership">, string> = {
    cancelled: "Whop sign-in was cancelled. Try again or use Google below.",
    disabled: "Whop sign-in is temporarily unavailable. Use Google below.",
    error: "Whop sign-in hit an error. Try again or use Google below.",
  };
  return (
    <div className="w-full max-w-[440px] rounded-2xl border border-line bg-paper px-4 py-3 text-center font-sans text-[12px] text-text-secondary">
      {msg[state]}
    </div>
  );
}

function Shell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 bg-paper px-6 py-12">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          {eyebrow}
        </div>
        {/* Kade + Liquid Clips lockup · replaces the generic "/" glyph so
            the OS-browser activation page reads as Liquid Clips brand,
            not old LiquidLift. 2026-07-06. */}
        <div className="relative flex flex-col items-center gap-3">
          <div
            aria-hidden
            className="absolute -inset-6 rounded-full opacity-60 blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(255,26,140,0.55) 0%, rgba(255,26,140,0.18) 45%, transparent 72%)",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/kade-avatar.png"
            alt="Kade — Liquid Clips"
            width={112}
            height={112}
            className="relative z-[1] h-[112px] w-[112px] object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,0.35)]"
          />
          <span className="relative z-[1] inline-flex items-center gap-1 rounded-full bg-fuchsia px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-paper">
            liquid<span className="opacity-70">/</span>clips
          </span>
        </div>
        <h1 className="mt-2 max-w-[460px] text-center font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
