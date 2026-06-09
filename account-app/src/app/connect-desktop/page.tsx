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
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";
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

export default function ConnectDesktopPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [challenge, setChallenge] = useState("");
  const [whopUrlState, setWhopUrlState] = useState<WhopUrlState>("none");
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const minted = useRef(false);

  useEffect(() => {
    setChallenge(readChallenge());
    setWhopUrlState(readWhopUrlState());
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setPhase({ k: "need_signin" });
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
          signUpUrl="/sign-up"
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
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          {eyebrow}
        </div>
        <span
          className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
          aria-hidden
        >
          /
        </span>
        <h1 className="max-w-[460px] text-center font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
