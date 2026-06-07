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
import { BACKEND_URL, normalizeTier, type EmbedTier } from "@/lib/embed-auth";

export default async function EmbedEarnPage() {
  const { userId } = await auth();

  // Not signed in → polite, nav-less panel. The embed shell strips the
  // regular Clerk header, so we can't link the user to /sign-in from here
  // without breaking out of the webview. Tell them to sign in from the
  // desktop's account panel instead.
  if (!userId) {
    return <SignedOutPanel />;
  }

  // Same /affiliate/me read as the embed layout's tier resolver. We pull it
  // again here (not from a context, which would force this page to be a
  // client component) so the campaigns can render server-side with the
  // correct visibility gating already applied — no flash of locked content.
  const tier = await fetchTier(userId);

  // Public route — no auth needed for /campaigns. Server-side fetch keeps the
  // markup deterministic; the carousel never has to render a "loading" state.
  const campaigns = await fetchCampaigns();

  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-5 py-6">
      {/* (O #7 — proof of identity) Connection badge — server-rendered
          since we already know whether Clerk identified the user. The
          desktop-side Whop badge ("source: keychain / iframe") lives natively
          on the parent; this badge mirrors what the user can verify HERE. */}
      <ConnectionBadge linked />

      {/* (O #5) Sponsored rewards — featured video row + image banner carousel.
          1:1 port of desktop SponsoredBannerCarousel; tier-gating preserved. */}
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
  );
}

/* ── Server-side fetchers ────────────────────────────────────────── */

async function fetchTier(clerkUserId: string): Promise<EmbedTier> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { customer?: { tier?: string | null } };
    return normalizeTier(data.customer?.tier ?? null);
  } catch {
    return null;
  }
}

async function fetchCampaigns(): Promise<SponsoredCampaign[]> {
  try {
    const r = await fetch(`${BACKEND_URL}/campaigns`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { campaigns?: SponsoredCampaign[] };
    return Array.isArray(j.campaigns) ? j.campaigns : [];
  } catch {
    return [];
  }
}

/* ── Inline sub-components ───────────────────────────────────────── */

function ConnectionBadge({ linked }: { linked: boolean }) {
  if (linked) {
    return (
      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-paper-warm/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        whop linked · via Liquid Clips
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-fuchsia/40 bg-fuchsia-soft/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia-deep">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
      whop not linked
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

function SignedOutPanel() {
  // No links out — the embed shell has no nav so we can't bounce the user
  // anywhere. The desktop wraps this surface and handles activation natively.
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-col items-start gap-5 px-5 py-12">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        earn
      </div>
      <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Sign in to your desktop app first.
      </h1>
      <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
        Open Liquid Clips on your machine and sign in — this surface picks up
        your account automatically once the desktop is connected.
      </p>
    </main>
  );
}
