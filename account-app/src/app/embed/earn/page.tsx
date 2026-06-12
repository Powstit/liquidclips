// ship-lens v0.7.7: fix #8 — ConnectionBadge reads real Whop link state instead of lying `linked={true}`
// SURFACE: Earn tab (becomes webview) — /embed/earn
// MAP TAGS:
//   (O #7 — proof of identity) Connection badge
//   (O #5)                     SponsoredBannerCarousel (featured + sponsored)
//   (O #5)(O #6)               Bounty list
//   (O #6 — fallback path)     Manual submission entry
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// What ships:
//   • Server component — Clerk `auth()` reads the satellite cookie (same path
//     /dashboard uses) and `/campaigns` is fetched server-side so the page
//     paints campaigns immediately, no client waterfall.
//   • Bounty list fetches on the client because /whop/bounties is gated by
//     the desktop's LICENSE_JWT (license-bearer header), not the Clerk
//     session — the JWT arrives via the EmbedAuthBridge post-message reply.
//   • Click-through never opens external URLs from inside the webview. Each
//     card posts `lc:nav` / `lc:start-bounty` to the desktop parent, which
//     routes natively. Keeps the Tauri CSP narrow and the back-button sane.

import { auth } from "@clerk/nextjs/server";
import { SponsoredCarousel, type SponsoredCampaign } from "@/components/embed/SponsoredCarousel";
import { BountyList } from "@/components/embed/BountyList";
import { EmbedSignedOutPanel } from "@/components/embed/EmbedSignedOutPanel";
import {
  AffiliateStripCta,
  ConnectStripeButton,
} from "@/components/embed/EarnEmbedCtas";
import { BACKEND_URL, normalizeTier, type EmbedTier } from "@/lib/embed-auth";

export default async function EmbedEarnPage() {
  const { userId } = await auth();

  // Not signed in → polite, nav-less panel. The embed shell strips the
  // regular Clerk header, so we can't link the user to /sign-in from here
  // without breaking out of the webview. Tell them to sign in from the
  // desktop's account panel instead.
  if (!userId) {
    return <EmbedSignedOutPanel />;
  }

  // Same /affiliate/me read as the embed layout's tier resolver. We pull it
  // again here (not from a context, which would force this page to be a
  // client component) so the campaigns can render server-side with the
  // correct visibility gating already applied — no flash of locked content.
  //
  // We now also read the Whop link state from the SAME call — the customer
  // shape already carries `whop_connected: bool(user.whop_user_id)` (see
  // junior-backend/app/routes/affiliate.py:165). Three honest states:
  //   • "linked"    — backend confirmed Whop user id is present
  //   • "unlinked"  — backend responded, Whop user id is empty
  //   • "unknown"   — backend errored / non-OK — we say so out loud rather
  //                   than rendering a confident "not linked" lie.
  const affiliate = await fetchAffiliate(userId);
  const tier = affiliate.tier;
  const linkStatus = affiliate.linkStatus;

  // Public route — no auth needed for /campaigns. Server-side fetch keeps the
  // markup deterministic; the carousel never has to render a "loading" state.
  // v0.7.55 (Uncle Daniel funnel) — pass clerk_user_id so the backend
  // derives `your_rpm_cents` + `is_premium_caller` per campaign and the
  // carousel can paint the ladder ($1 free / $5 premium) without a
  // client-side tier guess.
  const campaigns = await fetchCampaigns(userId);

  // v0.7.54 — layout matches demo-pages.html lines 338-438. Top affiliate
  // strip drives the headline CTA; ConnectionBadge stays as a secondary
  // pill so the link state is still verifiable here; cinematic hero
  // carousel replaces the grid; BountyList + ManualEntry kept below per
  // product decision (demo is aspirational top-of-page; real bounties +
  // fallback path remain reachable on the same surface).
  return (
    <div className="flex w-full flex-col">
      {/* Top reflection glint — mirrors the demo's fuchsia top-edge */}
      <div className="h-2 bg-gradient-to-b from-fuchsia/30 via-fuchsia/10 to-transparent" />

      <AffiliateStrip linkStatus={linkStatus} />

      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-5 py-6">
        {/* (O #7 — proof of identity) Connection badge — server-rendered.
            Reads /affiliate/me on the server so the link state is honest from
            the first paint. The desktop-side Whop badge ("source: keychain /
            iframe") lives natively on the parent; this badge mirrors what the
            user can verify HERE. */}
        <ConnectionBadge status={linkStatus} />

        {/* (O #5) Sponsored rewards — cinematic 2-col hero carousel. */}
        <SponsoredCarousel campaigns={campaigns} tier={tier} />

        {/* (O #5)(O #6) Bounty list — client-side fetch because /whop/bounties
            needs the LICENSE_JWT (license-bearer auth, not Clerk). The Start CTA
            posts `lc:start-bounty` to the desktop parent. The submission status
            pill row underneath polls every 8s. */}
        <BountyList userTier={tier} />

        {/* (O #6 — fallback path) Manual entry. Collapsed by default so the
            surface lands on the primary "Pick / Start" flow. */}
        <ManualEntry />
      </main>
    </div>
  );
}

/* ── Affiliate strip (top-of-page CTA row, per demo) ─────────────── */

// Matches demo-pages.html line 345-357: single-row strip with fuchsia
// eyebrow + bullet-separated value props + headline CTA on the right.
// The CTA destination follows linkStatus — when the user is already
// linked, "Open my affiliate dashboard" routes them to the desktop's
// affiliate settings panel; when unlinked, the demo's "GET MY AFFILIATE
// LINK" copy stays. Posts `lc:nav` so the desktop intercepts.
function AffiliateStrip({ linkStatus }: { linkStatus: WhopLinkStatus }) {
  // v0.7.54 P1-001 — "unknown" is the backend-unreachable state. Pre-fix
  // we lied "GET MY AFFILIATE LINK →" as if the user was definitely
  // unlinked. Now neutral copy that opens the affiliate panel so the user
  // can see whatever state is canonical from there.
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

/* ── Server-side fetchers ────────────────────────────────────────── */

/** Three honest states for the Whop connection badge.
 *  Splitting "unknown" from "unlinked" matters because the user's next action
 *  differs — for "unknown" we should not promise they're unlinked when our
 *  check itself failed. */
type WhopLinkStatus = "linked" | "unlinked" | "unknown";

type AffiliateInfo = {
  tier: EmbedTier;
  linkStatus: WhopLinkStatus;
};

async function fetchAffiliate(clerkUserId: string): Promise<AffiliateInfo> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return { tier: null, linkStatus: "unknown" };
    // junior-backend/app/routes/affiliate.py:165 — whop_connected = bool(user.whop_user_id).
    // That's the single source of truth for "did this user finish the Whop
    // link step on desktop?" — no need to parse a status string.
    const data = (await res.json()) as {
      customer?: { tier?: string | null; whop_connected?: boolean | null };
    };
    const tier = normalizeTier(data.customer?.tier ?? null);
    const linkStatus: WhopLinkStatus = data.customer?.whop_connected
      ? "linked"
      : "unlinked";
    return { tier, linkStatus };
  } catch {
    // Network/DNS/Railway 502 etc. We say "unknown" so the badge doesn't
    // claim "not linked" when we genuinely couldn't ask.
    return { tier: null, linkStatus: "unknown" };
  }
}

async function fetchCampaigns(clerkUserId?: string): Promise<SponsoredCampaign[]> {
  try {
    const url = clerkUserId
      ? `${BACKEND_URL}/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`
      : `${BACKEND_URL}/campaigns`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { campaigns?: SponsoredCampaign[] };
    return Array.isArray(j.campaigns) ? j.campaigns : [];
  } catch {
    return [];
  }
}

/* ── Inline sub-components ───────────────────────────────────────── */

function ConnectionBadge({ status }: { status: WhopLinkStatus }) {
  // Three honest renderings — never lie about what we know.
  // The CTA copy differs by state so the user's next action is clear inside
  // the webview (which has no native nav back to /sign-in / settings).
  if (status === "linked") {
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        whop linked · via Liquid Clips
      </span>
    );
  }
  if (status === "unlinked") {
    // v0.7.41 — Was a dead pill that said "link whop on desktop" with no
    // button or path forward. Beta users read it as "Whop not signed in"
    // and had nowhere to go. Now: a real CTA panel with both affiliate
    // paths (Whop sign-up + Stripe Connect via desktop). Architecture
    // contract: Liquid Clips pays affiliates two ways — Whop runs payouts
    // for Whop-signup users; Clerk users connect a bank via Stripe.
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
  // "unknown" — backend was unreachable. Distinct copy + tone so the user
  // doesn't read this as "we confirmed you're not linked".
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-tertiary" />
      couldn&apos;t check whop status
    </span>
  );
}

function ManualEntry() {
  // The desktop has a richer ManualBountyPrompt with platform + reward fields.
  // The embed exposes the same FALLBACK path with the minimal "paste a Whop
  // link" affordance — the heavier modal lives on the desktop because pasting
  // a source URL is fundamentally a desktop-side action (file picker etc).
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

// ship-lens v0.7.12: SignedOutPanel extracted to a client component
// because React Server Components can't pass inline onClick functions to
// children. The v0.7.11 inline version rendered the error-boundary digest
// instead of the panel (the "Earn page is blank" bug). Live at
// components/embed/EmbedSignedOutPanel.tsx with the "use client" directive.
