"use client";

// v0.7.70 — Whop-primary sign-in on /connect-desktop.
//
// Architecture (LOCKED 2026-06-24 — memory liquid-clips-whop-lead-decision):
//   Whop owns auth / subs / agents / community / payouts. Clerk stays as
//   the SECONDARY door — backwards-compat for users created before the
//   Whop-primary flip plus a fallback when Whop is down.
//
// /connect-desktop is the browser half of the desktop activation bridge.
// The Liquid Clips desktop opens this URL with a one-time ?challenge=<nonce>.
//
// Sign-in flow (Whop primary):
//   1. ?challenge=<nonce> arrives from the desktop's startActivation().
//   2. Page renders TWO doors:
//        • PRIMARY  → "Sign in with Whop" (fuchsia, top of fold)
//          → 302 /api/whop-oauth/start?challenge=… → same-origin shim
//          → 302 to backend /auth/whop/start
//          → Whop consent → backend /auth/whop/callback
//          → backend mints license JWT → 302 liquidclips://activate?…
//        • SECONDARY → "Sign in with email" (Clerk, collapsed by default)
//          → POST /api/desktop/connect on success
//          → 302 liquidclips://activate?…
//   3. Either path ends at the same deep-link — desktop verifies the
//      challenge, stores the JWT, flips signed-in. No restart, no paste.
//
// The challenge is stashed in sessionStorage so it survives the Clerk
// sign-in round-trip even when the redirect drops the query string.

import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";

import { ClerkFallbackBlock } from "@/components/connect-desktop/ClerkFallbackBlock";
import { WhopBanner } from "@/components/connect-desktop/WhopBanner";
import { WhopSignInButton } from "@/components/connect-desktop/WhopSignInButton";
import {
  WHOP_ENABLED,
  buildAffiliateUrl,
  isValidChallenge,
  readWhopUrlState,
  type WhopUrlState,
} from "@/lib/whop-oauth";

type Phase =
  | { k: "loading" }
  | { k: "need_signin" }
  | { k: "minting" }
  | { k: "ready"; deepLink: string }
  | { k: "error"; msg: string };

const CHALLENGE_KEY = "lc_connect_challenge";

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
        msg: "Missing activation code. Re-open this from the Liquid Clips desktop app's Sign in button.",
      });
      return;
    }
    if (minted.current) return;
    minted.current = true;

    void (async () => {
      setPhase({ k: "minting" });
      try {
        // /api/desktop/* is still proxied to account-app via next.config.ts —
        // server-side proxy doesn't have the CSS/JS asset problem.
        const res = await fetch("/api/desktop/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challenge }),
        });
        if (!res.ok) {
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
        // Hand back to the desktop. The OS shows an "Open Liquid Clips?" prompt;
        // the manual button below is the fallback if the auto-redirect is blocked.
        window.location.href = deepLink;
      } catch {
        setPhase({
          k: "error",
          msg: "Couldn't reach Liquid Clips's servers. Check your connection and retry.",
        });
      }
    })();
  }, [isLoaded, isSignedIn, challenge]);

  if (phase.k === "need_signin") {
    const back = `/connect-desktop?challenge=${encodeURIComponent(challenge)}`;

    // Same-origin start URL. Only render if (a) we have a valid challenge,
    // (b) Whop feature flag is on, and (c) the URL state isn't telling us
    // Whop is disabled at the backend (env vars missing on Railway).
    const whopStartHref =
      WHOP_ENABLED &&
      whopUrlState !== "disabled" &&
      isValidChallenge(challenge)
        ? `/api/whop-oauth/start?challenge=${encodeURIComponent(challenge)}`
        : "";

    // When the Whop button is unavailable (flag off OR no challenge), reveal
    // the Clerk widget immediately — there's no point burying it behind a
    // disclosure click when it's the only working door.
    const clerkMode = whopStartHref ? "cta" : "open";

    return (
      <Shell eyebrow="connect desktop" title="Sign in to activate Liquid Clips.">
        <WhopBanner state={whopUrlState} affiliateUrl={buildAffiliateUrl()} />

        {/* PRIMARY — Whop. Shown first / above the fold per
            liquid-clips-whop-lead-decision. */}
        {WHOP_ENABLED && (
          <WhopSignInButton href={whopStartHref} />
        )}

        {/* SECONDARY — Clerk fallback. Always rendered (the FALLBACK rule);
            collapsed by default so it doesn't compete with the primary CTA. */}
        <ClerkFallbackBlock backUrl={back} mode={clerkMode} />
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
            If nothing happened, click &ldquo;Open Liquid Clips&rdquo;. You can close this tab once
            the desktop says you&rsquo;re signed in.
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
