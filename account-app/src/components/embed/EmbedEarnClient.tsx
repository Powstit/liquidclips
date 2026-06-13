"use client";

// v0.7.59 — JWT-first Earn embed (Path C).
//
// Replaces the prior server-side short-circuit (`if (!userId) return
// <EmbedSignedOutPanel />`) which depended on the Clerk satellite cookie
// being present in the desktop's child Tauri webview. That cookie isn't
// there: the Tauri child webview has its own isolated cookie partition,
// separate from both the user's Chrome and the desktop's parent webview.
// Result was a permanent signed-out shell + a black webview the user
// could never escape (their "nothing comes up on earn page" report).
//
// New contract (Daniel's directive, 2026-06-13):
//   1. Page always renders the client shell — never short-circuits server-side.
//   2. Loading state paints immediately. WKWebView fires PageLoadEvent::
//      Finished as soon as the shell HTML parses, so the desktop watchdog
//      (`earn-panel:loaded`, src-tauri/src/earn_panel.rs:258) is satisfied.
//   3. EmbedAuthBridge postMessages `lc:auth-request`; desktop replies
//      `lc:auth-jwt` with the cached LICENSE_JWT.
//   4. We decode the JWT's `clerk_user_id` claim and fetch /me/affiliate
//      (Bearer auth, license-bearer-friendly backend) + /campaigns. No
//      query-string token (per directive).
//   5. If no JWT arrives within JWT_WAIT_MS and no Clerk userId is in
//      context either, render the reconnect panel — visible, focusable,
//      with a Retry CTA that re-fires `lc:auth-request`.
//   6. Cookie path is now optional: when a browser visit lands here with
//      a valid Clerk session cookie, the SSR layout pre-populates
//      `initialUserId` + we use it as a secondary auth source. Desktop
//      Earn never requires it.
//
// This component is the ONLY consumer that handles the JWT-or-userId
// dual-mode auth. Downstream child components (SponsoredCarousel, etc.)
// receive resolved props and render off them.

import { useEffect, useState } from "react";
import { useEmbedAuth } from "./EmbedAuthBridge";
import {
  SponsoredCarousel,
  type SponsoredCampaign,
} from "./SponsoredCarousel";
import { BountyList } from "./BountyList";
import { BonusEarnings } from "./BonusEarnings";
import { AffiliateStripCta, ConnectStripeButton } from "./EarnEmbedCtas";
import {
  BACKEND_URL,
  normalizeTier,
  type EmbedTier,
} from "@/lib/embed-auth";

/** Wait for JWT bridge OR cookie-derived userId. Slightly longer than the
 *  bridge's 4s stall window so the bridge gets a chance to land its
 *  postMessage reply before we surface the reconnect panel. */
const JWT_WAIT_MS = 6000;

type WhopLinkStatus = "linked" | "unlinked" | "unknown";

type EarnDataState =
  | { kind: "loading" }
  | { kind: "reconnect" }
  | {
      kind: "ok";
      tier: EmbedTier;
      linkStatus: WhopLinkStatus;
      campaigns: SponsoredCampaign[];
    }
  | { kind: "error"; message: string };

export type EmbedEarnClientProps = {
  /** Browser-cookie fast path. Server-side `auth()` from the layout reads
   *  the Clerk satellite cookie; if it resolves, we render with the
   *  user's id already known and skip the JWT bridge wait. Null in the
   *  desktop case (cookie partition is empty there). */
  initialUserId: string | null;
  initialTier: EmbedTier;
  /** SSR-pre-populated payload from `page.tsx` for the cookie fast path.
   *  Null in the desktop case → we re-fetch client-side via the bridge. */
  initialLinkStatus: WhopLinkStatus | null;
  initialCampaigns: SponsoredCampaign[] | null;
};

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    // JWTs use base64url; standard atob wants base64 → swap chars + pad.
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "===".slice((payload.length + 3) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function jwtClerkUserId(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return null;
  // License JWTs the desktop receives carry `clerk_user_id` per the
  // junior-backend mint (junior-backend/app/routes/desktop.py).
  const cid = payload["clerk_user_id"];
  if (typeof cid === "string" && cid) return cid;
  // Fallback to standard `sub` if a future mint flips conventions.
  const sub = payload["sub"];
  return typeof sub === "string" && sub ? sub : null;
}

async function fetchEarnData(args: {
  jwt: string | null;
  userId: string | null;
}): Promise<{
  tier: EmbedTier;
  linkStatus: WhopLinkStatus;
  campaigns: SponsoredCampaign[];
} | null> {
  const { jwt, userId } = args;

  let clerkUserId: string | null = userId;
  if (!clerkUserId && jwt) clerkUserId = jwtClerkUserId(jwt);
  if (!clerkUserId) return null;

  const authHeader: HeadersInit = jwt
    ? { Authorization: `Bearer ${jwt}` }
    : {};

  const [affiliateRes, campaignsRes] = await Promise.all([
    fetch(`${BACKEND_URL}/me/affiliate`, {
      headers: authHeader,
      cache: "no-store",
    }).catch(() => null),
    fetch(
      `${BACKEND_URL}/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      { cache: "no-store" },
    ).catch(() => null),
  ]);

  // Affiliate — derive tier + Whop link state.
  let tier: EmbedTier = null;
  let linkStatus: WhopLinkStatus = "unknown";
  if (affiliateRes && affiliateRes.ok) {
    try {
      const data = (await affiliateRes.json()) as {
        customer?: { tier?: string | null; whop_connected?: boolean | null };
      };
      tier = normalizeTier(data.customer?.tier ?? null);
      linkStatus = data.customer?.whop_connected ? "linked" : "unlinked";
    } catch {
      linkStatus = "unknown";
    }
  }

  // Campaigns — public endpoint, personalized by clerk_user_id.
  let campaigns: SponsoredCampaign[] = [];
  if (campaignsRes && campaignsRes.ok) {
    try {
      const data = (await campaignsRes.json()) as {
        campaigns?: SponsoredCampaign[];
      };
      campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    } catch {
      campaigns = [];
    }
  }

  return { tier, linkStatus, campaigns };
}

export function EmbedEarnClient(props: EmbedEarnClientProps) {
  const { jwt, userId, requestAuth } = useEmbedAuth();

  // Cookie fast path: SSR already pre-populated the data — render directly.
  // Desktop path: server saw no cookie → initialLinkStatus + initialCampaigns
  // are null, we drop into the loading state and let the JWT bridge resolve.
  const [state, setState] = useState<EarnDataState>(() => {
    if (
      props.initialLinkStatus !== null &&
      props.initialCampaigns !== null
    ) {
      return {
        kind: "ok",
        tier: props.initialTier,
        linkStatus: props.initialLinkStatus,
        campaigns: props.initialCampaigns,
      };
    }
    return { kind: "loading" };
  });

  // Reconnect-timeout: if neither a JWT nor a Clerk userId resolves within
  // JWT_WAIT_MS, surface the reconnect panel. The bridge's own 4s stall
  // timer flips authStatus, but we own the visible-state decision here so
  // the desktop user always sees a real surface (not a blank shell).
  useEffect(() => {
    if (state.kind !== "loading") return;
    if (jwt || userId) return; // resolved
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      setState((cur) =>
        cur.kind === "loading" ? { kind: "reconnect" } : cur,
      );
    }, JWT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [state.kind, jwt, userId]);

  // When the bridge finally hands us a JWT (or a userId arrives), fire the
  // data fetch. Re-runs only when the auth inputs change; the `state.kind`
  // guard prevents re-fetching after we've landed in `ok` / `error`.
  useEffect(() => {
    if (state.kind === "ok" || state.kind === "error") return;
    if (!jwt && !userId) return;
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const fetched = await fetchEarnData({ jwt, userId });
        if (cancelled) return;
        if (fetched) {
          setState({ kind: "ok", ...fetched });
        } else {
          setState({ kind: "reconnect" });
        }
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // state.kind intentionally NOT in deps — we manage it ourselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwt, userId]);

  if (state.kind === "loading") return <LoadingShell />;
  if (state.kind === "reconnect")
    return <ReconnectPanel onRetry={requestAuth} />;
  if (state.kind === "error")
    return (
      <ErrorPanel
        message={state.message}
        onRetry={() => {
          setState({ kind: "loading" });
          requestAuth();
        }}
      />
    );

  // OK — render the real Earn surface.
  const { tier, linkStatus, campaigns } = state;
  return (
    <div className="flex w-full flex-col">
      <div className="h-2 bg-gradient-to-b from-fuchsia/30 via-fuchsia/10 to-transparent" />
      <AffiliateStrip linkStatus={linkStatus} />
      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-5 py-6">
        <ConnectionBadge status={linkStatus} />
        <SponsoredCarousel campaigns={campaigns} tier={tier} />
        <BonusEarnings tier={tier} />
        <BountyList userTier={tier} />
        <ManualEntry />
      </main>
    </div>
  );
}

/* ───── visible states ───── */

function LoadingShell() {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-start gap-5 px-5 py-12">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Loading your earnings…
      </h1>
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Talking to the Liquid Clips desktop to fetch your campaigns and Whop link status.
      </p>
      <div className="mt-2 h-[3px] w-full max-w-[280px] overflow-hidden rounded-full bg-line">
        <div className="h-full w-2/5 animate-[connect-bar_1.4s_ease-in-out_infinite] rounded-full bg-fuchsia" />
      </div>
      <style>{`@keyframes connect-bar{0%{transform:translateX(-100%)}50%{transform:translateX(120%)}100%{transform:translateX(280%)}}`}</style>
    </div>
  );
}

function ReconnectPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-start gap-5 px-5 py-12">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Reconnect to load your earnings.
      </h1>
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        We didn’t hear back from the Liquid Clips desktop in time. Sign in again
        on the desktop, then tap Retry — Earn populates as soon as the link lands.
      </p>
      <button
        type="button"
        data-testid="embed-reconnect-cta"
        onClick={onRetry}
        className="rounded-full border border-fuchsia bg-fuchsia px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.10em] text-white shadow-[0_0_0_1px_rgba(255,26,140,0.3),0_8px_28px_-12px_rgba(255,26,140,0.55)] transition-all hover:bg-fuchsia/90 focus:outline-none focus:ring-2 focus:ring-fuchsia/40"
      >
        Retry →
      </button>
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-start gap-4 px-5 py-12">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]" />
        earn — error
      </div>
      <h1 className="font-display text-[22px] font-semibold text-ink">
        Couldn’t load your earnings.
      </h1>
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-line bg-paper-warm/40 px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.10em] text-ink hover:border-fuchsia hover:text-fuchsia"
      >
        Retry →
      </button>
    </div>
  );
}

/* ───── inline sub-components (copied from page.tsx) ───── */

function AffiliateStrip({ linkStatus }: { linkStatus: WhopLinkStatus }) {
  const ctaLabel =
    linkStatus === "linked"
      ? "OPEN AFFILIATE DASHBOARD →"
      : linkStatus === "unknown"
        ? "OPEN AFFILIATE PANEL →"
        : "GET MY AFFILIATE LINK →";
  return (
    <div className="flex flex-col items-start gap-3 border-b border-line/40 px-6 py-4 md:flex-row md:items-center md:justify-between md:gap-6 md:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] md:text-[12px] md:tracking-[0.16em]">
        <span className="font-semibold text-fuchsia">Liquid Clips Affiliate</span>
        <span className="text-text-tertiary">·</span>
        <span className="normal-case tracking-normal text-ink-soft">
          Refer 2 paid users
        </span>
        <span className="text-text-tertiary">·</span>
        <span className="normal-case tracking-normal text-ink-soft">
          50% recurring lifetime
        </span>
        <span className="text-text-tertiary">·</span>
        <span className="normal-case tracking-normal text-ink-soft">
          pick Whop or Stripe payout
        </span>
      </div>
      <AffiliateStripCta label={ctaLabel} linkStatus={linkStatus} />
    </div>
  );
}

function ConnectionBadge({ status }: { status: WhopLinkStatus }) {
  if (status === "linked") {
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        whop linked · via Liquid Clips
      </span>
    );
  }
  if (status === "unlinked") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-fuchsia/40 bg-fuchsia-soft/20 p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia/40 bg-fuchsia-soft/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia-deep">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            connect to start earning
          </span>
        </div>
        <p className="max-w-[420px] font-sans text-[13px] leading-relaxed text-text-secondary">
          Liquid Clips pays affiliates two ways. Pick the route that fits — you
          only need one.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://whop.com/jnremployee"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-white transition-colors hover:bg-fuchsia-bright"
          >
            Sign up via Whop →
          </a>
          <ConnectStripeButton>Connect bank (Stripe) →</ConnectStripeButton>
        </div>
      </div>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-tertiary" />
      couldn&apos;t check whop status
    </span>
  );
}

function ManualEntry() {
  return (
    <details className="rounded-2xl border border-dashed border-line bg-paper-elev/40 p-4">
      <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:text-ink">
        Don&apos;t see the reward you want? Paste a Whop link →
      </summary>
      <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">
        Paste the Content Reward link in the desktop&apos;s Earn panel — Liquid Clips
        will pick up the reward and walk you through the brief.
      </p>
    </details>
  );
}
