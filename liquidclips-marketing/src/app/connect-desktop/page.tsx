"use client";

// v0.7.59 — Native /connect-desktop on the Clerk primary domain.
//
// Ported from account-app/src/app/connect-desktop/page.tsx so the page +
// every /_next/static/* asset it pulls resolve against the same Vercel
// deployment that owns liquidclips.app. The prior cross-Next rewrite
// returned the page HTML correctly but 404'd every CSS/JS chunk, giving
// the user a white unstyled "Activating Liquid Clips on this device…"
// page.
//
// Flow (unchanged):
//   1. ?challenge=<nonce> arrives from the desktop's startActivation().
//   2. Not signed in → embedded Clerk SignIn (hash routing) lands back
//      here on completion.
//   3. Signed in → POST /api/desktop/connect { challenge } against the
//      junior-backend proxy (next.config.ts keeps that rewrite alive).
//   4. Backend mints + returns license_jwt. We deep-link
//      liquidclips://activate?token=&challenge= and surface a manual
//      "Open Liquid Clips" fallback.
//
// The challenge is stashed in sessionStorage so it survives the Clerk
// sign-in round-trip even when the redirect drops the query string.

import { useEffect, useRef, useState } from "react";
import { SignIn, useUser } from "@clerk/nextjs";

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
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const minted = useRef(false);

  useEffect(() => {
    setChallenge(readChallenge());
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
          msg: "Couldn’t reach Liquid Clips’s servers. Check your connection and retry.",
        });
      }
    })();
  }, [isLoaded, isSignedIn, challenge]);

  if (phase.k === "need_signin") {
    const back = `/connect-desktop?challenge=${encodeURIComponent(challenge)}`;
    return (
      <Shell eyebrow="connect desktop" title="Sign in to activate Liquid Clips.">
        <SignIn
          routing="hash"
          signUpUrl={`/sign-up?redirect=${encodeURIComponent(back)}`}
          forceRedirectUrl={back}
          signUpForceRedirectUrl={back}
        />
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
