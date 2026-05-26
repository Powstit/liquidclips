"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { track } from "@/lib/analytics";

// /get — post-purchase onboarding landing. Affiliate-referred buyers land here
// AFTER paying on Whop; Whop redirects to account.jnremployee.com/get?ref=<affId>.
//
// Two jobs:
//   1) First-touch affiliate capture. Mirrors marketing/ref-capture.js exactly
//      (same ?ref/?a parsing, same regex, no-overwrite, 1yr, SameSite=Lax,
//      scoped to .jnremployee.com) so attribution survives the redirect even
//      though the buyer may have arrived without ever hitting the marketing JS.
//   2) Link the just-purchased Whop plan to the signed-in Clerk account by
//      POSTing { clerk_user_id, email } to the Junior backend, then confirming
//      the plan is live and pointing the buyer at the download.

// --- first-touch affiliate capture --------------------------------------
// Byte-for-byte the same rules as marketing/ref-capture.js. IDs only;
// first-touch wins (never overwrite an existing capture). Best-effort —
// attribution must never break the page.
function captureFirstTouchRef(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    let ref = params.get("ref") || params.get("a");
    if (!ref) return;
    ref = ref.trim().slice(0, 64);
    // Affiliate ids are alphanumeric + _ - only. Reject anything else.
    if (!/^[A-Za-z0-9_-]+$/.test(ref)) return;
    // First-touch: do not overwrite an existing referral.
    if (/(?:^|;\s*)jnr_ref=/.test(document.cookie)) return;
    const oneYear = 60 * 60 * 24 * 365;
    // Share across apex + subdomains (account., partner.) so signup can read it.
    const domain = /(^|\.)jnremployee\.com$/.test(location.hostname)
      ? "; domain=.jnremployee.com"
      : "";
    document.cookie =
      "jnr_ref=" +
      encodeURIComponent(ref) +
      "; path=/; max-age=" +
      oneYear +
      domain +
      "; SameSite=Lax";
  } catch {
    /* attribution is best-effort — never break the page */
  }
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "http://localhost:8000";

type LinkState =
  | { status: "idle" }
  | { status: "linking" }
  | { status: "linked"; tier: string }
  | { status: "not_linked" }
  | { status: "error" };

type RedeemState =
  | { status: "idle" }
  | { status: "redeeming" }
  | { status: "redeemed"; tier: string }
  | { status: "failed"; reason?: string };

export default function GetPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [link, setLink] = useState<LinkState>({ status: "idle" });
  // Guard against double-fire: useUser can re-render and StrictMode mounts
  // effects twice in dev. We only ever want one POST to /onboarding/link-whop.
  const linkFired = useRef(false);
  // Analytics: ensure get_page_viewed fires exactly once, after Clerk loads so
  // the signed_in bool is accurate.
  const viewFired = useRef(false);
  // ?claim=<token> → a different-email claim link was opened. Read synchronously
  // so the auto-link effect can skip when we're redeeming a claim instead.
  const [claimToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const t = new URLSearchParams(window.location.search).get("claim");
    return t ? t.trim().slice(0, 200) : null;
  });
  const [redeem, setRedeem] = useState<RedeemState>({ status: "idle" });
  const redeemFired = useRef(false);

  // Capture the affiliate ref on mount, regardless of auth state, so a buyer
  // who lands signed-out still gets first-touch attribution before signing in.
  useEffect(() => {
    captureFirstTouchRef();
  }, []);

  // Analytics: page view. signed_in only meaningful once Clerk has loaded.
  useEffect(() => {
    if (!isLoaded || viewFired.current) return;
    viewFired.current = true;
    track("get_page_viewed", { signed_in: !!isSignedIn, has_claim_token: !!claimToken });
  }, [isLoaded, isSignedIn, claimToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    if (claimToken) return;  // redeeming a claim link — don't also auto-link
    if (linkFired.current) return;
    linkFired.current = true;

    const email = user.primaryEmailAddress?.emailAddress ?? "";
    setLink({ status: "linking" });

    (async () => {
      track("whop_link_started");
      try {
        const res = await fetch(`${BACKEND_URL}/onboarding/link-whop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clerk_user_id: user.id, email }),
        });
        if (!res.ok) {
          track("whop_link_failed", { reason: "http_error" });
          setLink({ status: "error" });
          return;
        }
        const data: { linked?: boolean; tier?: string } = await res.json();
        if (data.linked) {
          track("whop_link_succeeded", { tier: data.tier ?? undefined });
          setLink({ status: "linked", tier: data.tier ?? "your plan" });
        } else {
          // No pending entitlement found for this email — distinct from a
          // network/server failure. Dashboards use this to measure the
          // "bought with a different email" drop rate.
          track("whop_link_not_found", { tier: data.tier ?? undefined });
          setLink({ status: "not_linked" });
        }
      } catch {
        track("whop_link_failed", { reason: "exception" });
        setLink({ status: "error" });
      }
    })();
  }, [isLoaded, isSignedIn, user, claimToken]);

  // Redeem a ?claim token once signed in. The backend requires the SAME signed-in
  // user that requested it, so opening the emailed link while signed into the
  // right account is the second half of the ownership proof.
  useEffect(() => {
    if (!claimToken || !isLoaded || !isSignedIn || !user) return;
    if (redeemFired.current) return;
    redeemFired.current = true;
    setRedeem({ status: "redeeming" });
    track("whop_claim_redeem_started");

    (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/onboarding/claim-whop/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clerk_user_id: user.id, token: claimToken }),
        });
        const data: { linked?: boolean; tier?: string; reason?: string } =
          await res.json().catch(() => ({}));
        if (res.ok && data.linked) {
          track("whop_claim_succeeded", { tier: data.tier ?? undefined });
          setRedeem({ status: "redeemed", tier: data.tier ?? "your plan" });
        } else {
          track("whop_claim_failed", { reason: data.reason ?? "redeem_error" });
          setRedeem({ status: "failed", reason: data.reason });
        }
      } catch {
        track("whop_claim_failed", { reason: "exception" });
        setRedeem({ status: "failed" });
      }
    })();
  }, [claimToken, isLoaded, isSignedIn, user]);

  return (
    <div className="mx-auto max-w-[760px] px-6 py-20 sm:px-8 sm:py-28">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        you&apos;re in
      </div>

      <h1 className="mt-6 font-display text-[clamp(36px,6vw,64px)] font-bold leading-[1.02] tracking-[-0.04em] text-ink">
        Thanks for buying — <em className="not-italic text-fuchsia">let&apos;s set you up</em>.
      </h1>

      {!isLoaded ? (
        <LoadingCard />
      ) : !isSignedIn ? (
        <SignedOutPanel claimToken={claimToken} />
      ) : claimToken ? (
        <RedeemPanel redeem={redeem} />
      ) : (
        <SignedInPanel
          link={link}
          clerkUserId={user?.id ?? ""}
          email={user?.primaryEmailAddress?.emailAddress ?? ""}
        />
      )}

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        <span>account.jnremployee.com</span>
        <div className="flex flex-wrap gap-5">
          <a href="https://jnremployee.com" className="hover:text-ink">jnremployee.com →</a>
          <a href="https://jnremployee.com/refunds" className="hover:text-ink">refunds</a>
          <a href="https://jnremployee.com/privacy" className="hover:text-ink">privacy</a>
        </div>
      </footer>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
      <p className="font-sans text-[15px] leading-relaxed text-text-secondary">
        Loading your account…
      </p>
    </div>
  );
}

function SignedOutPanel({ claimToken }: { claimToken: string | null }) {
  const dest = claimToken ? `/get?claim=${encodeURIComponent(claimToken)}` : "/get";
  const enc = encodeURIComponent(dest);
  return (
    <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        one quick step
      </div>
      <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
        {claimToken ? "Sign in to claim your purchase." : "Sign in to attach your plan."}
      </h2>
      <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
        {claimToken
          ? "Sign in to the Junior account you want the purchase attached to, then we'll finish the claim automatically."
          : "Your purchase is safe. Create your Junior account (or sign in) and we'll link the plan you just bought to it automatically — then you're ready to download."}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          href={`/sign-up?redirect_url=${enc}`}
          className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
        >
          Create account →
        </Link>
        <Link
          href={`/sign-in?redirect_url=${enc}`}
          className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

function SignedInPanel({ link, clerkUserId, email }: { link: LinkState; clerkUserId: string; email: string }) {
  if (link.status === "linked") {
    return (
      <div className="mt-12 rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-7 sm:p-8">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          all set
        </div>
        <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          You&apos;re on {capitalise(link.tier)}.
        </h2>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Your plan is linked to this account. Grab the app and start clipping — your tier
          unlocks the moment you sign in on the desktop. Junior runs locally, so you&apos;ll add
          your own OpenAI key for clip selection (hosted AI is in private beta).
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/download"
            onClick={() => track("desktop_download_clicked", { source: "get" })}
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
          >
            Download Junior →
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (link.status === "not_linked") {
    return (
      <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          almost there
        </div>
        <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          We couldn&apos;t match your purchase yet.
        </h2>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Whop can take a minute to confirm a fresh purchase. Refresh this page in a moment — if it
          still doesn&apos;t link, make sure you bought with the same email as this account, then
          reach out and we&apos;ll sort it fast.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/get"
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
          >
            Refresh ↻
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
          >
            Go to dashboard
          </Link>
        </div>

        <div className="mt-7 border-t border-line pt-6">
          <ClaimForm clerkUserId={clerkUserId} signedInEmail={email} />
        </div>
      </div>
    );
  }

  if (link.status === "error") {
    return (
      <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          hmm
        </div>
        <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          Something hiccuped linking your plan.
        </h2>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Your purchase is safe. Refresh to try again — your account and dashboard are still here in
          the meantime.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/get"
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
          >
            Try again ↻
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // idle | linking
  return (
    <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        linking
      </div>
      <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
        Linking your plan…
      </h2>
      <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
        Hold tight — we&apos;re attaching your purchase to this account. This only takes a second.
      </p>
    </div>
  );
}

function ClaimForm({ clerkUserId, signedInEmail }: { clerkUserId: string; signedInEmail: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || state === "sending") return;
    setState("sending");
    track("whop_claim_started");
    try {
      await fetch(`${BACKEND_URL}/onboarding/claim-whop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clerk_user_id: clerkUserId,
          signed_in_email: signedInEmail,
          whop_purchase_email: value,
        }),
      });
      // Backend always returns { ok: true } (generic — never reveals if a
      // purchase exists). Fire the event here to signal the request completed.
      track("whop_claim_email_requested");
    } catch {
      /* response is intentionally generic — always show the same confirmation */
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">check your email</div>
        <p className="mt-2 max-w-[520px] font-sans text-[14px] leading-relaxed text-text-secondary">
          If a purchase exists for that address, we sent a secure claim link to it. Open the link
          (good for 20 minutes) while signed into this account to finish.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="whop-email" className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        Bought with a different Whop email?
      </label>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="whop-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Whop purchase email"
          className="w-full flex-1 rounded-xl border border-line bg-paper px-4 py-2.5 font-sans text-[15px] text-ink outline-none focus:border-fuchsia"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="shrink-0 rounded-xl bg-ink px-5 py-2.5 font-sans text-[15px] font-medium text-paper transition hover:bg-fuchsia disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : "Send claim link"}
        </button>
      </div>
      <p className="mt-3 max-w-[520px] font-sans text-[12px] leading-relaxed text-text-tertiary">
        Use this only if you paid on Whop with a different email than your Junior account. We&apos;ll
        send a secure claim link to the Whop purchase email.
      </p>
    </form>
  );
}

function RedeemPanel({ redeem }: { redeem: RedeemState }) {
  if (redeem.status === "redeemed") {
    return (
      <div className="mt-12 rounded-3xl border border-fuchsia-soft bg-fuchsia-soft/30 p-7 sm:p-8">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" /> claimed
        </div>
        <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          You&apos;re on {capitalise(redeem.tier)}.
        </h2>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          Your purchase is now attached to this account. Grab the app and start clipping.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/download"
            onClick={() => track("desktop_download_clicked", { source: "claim" })}
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] sm:w-auto"
          >
            Download Junior →
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (redeem.status === "failed") {
    return (
      <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">claim link</div>
        <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
          This claim link didn&apos;t work.
        </h2>
        <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
          It may have expired (links last 20 minutes), already been used, or belong to a different
          account. Open <span className="font-mono text-[13px]">/get</span> again to request a fresh link.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/get"
            className="w-full rounded-full bg-ink px-6 py-3 text-center font-sans text-[15px] font-medium text-paper transition-all hover:bg-fuchsia sm:w-auto"
          >
            Request a new link
          </Link>
          <Link
            href="/dashboard"
            className="w-full rounded-full border border-line bg-paper px-6 py-3 text-center font-sans text-[15px] font-medium text-ink transition-colors hover:border-fuchsia sm:w-auto"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 rounded-3xl border border-line bg-paper-warm/50 p-7 sm:p-8">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" /> claiming
      </div>
      <h2 className="mt-2 font-display text-[clamp(24px,4vw,28px)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
        Claiming your purchase…
      </h2>
      <p className="mt-3 max-w-[520px] font-sans text-[15px] leading-relaxed text-text-secondary">
        Verifying your claim link and attaching the purchase to this account.
      </p>
    </div>
  );
}

function capitalise(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
