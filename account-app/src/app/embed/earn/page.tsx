// v0.7.59 — JWT-first Earn embed (Path C). Server component is now a thin
// SSR pre-population stage: it tries Clerk `auth()` for the browser-cookie
// fast path, but NEVER short-circuits to a signed-out shell. The desktop
// Tauri child webview has its own cookie partition (no Clerk satellite
// cookie present), so the prior `if (!userId) return <EmbedSignedOutPanel />`
// branch turned the embed into a permanent "Sign in to link account" card
// + a black WKWebView the user could never escape.
//
// New responsibility split:
//   • Server (this file): optional pre-data fetch IF a Clerk session
//     cookie resolves. Always renders <EmbedEarnClient />, never blocks
//     on auth. WKWebView fires `PageLoadEvent::Finished` once the shell
//     parses → desktop watchdog (`earn-panel:loaded` at
//     src-tauri/src/earn_panel.rs:258) is satisfied.
//   • Client (EmbedEarnClient): listens to EmbedAuthBridge for the
//     LICENSE_JWT delivered via `lc:auth-jwt` postMessage from the
//     desktop. Uses Bearer auth on /me/affiliate + a clerk_user_id
//     derived from the JWT for /campaigns. Falls back to the cookie
//     userId if SSR resolved one. Shows a Reconnect panel if neither
//     auth source delivers within JWT_WAIT_MS.
//
// See desktop/docs/UI_MAP_embed_surfaces.md and the prior architecture
// notes inside EmbedAuthBridge.tsx / EmbedEarnClient.tsx for the full
// contract.

import { auth } from "@clerk/nextjs/server";
import { EmbedEarnClient } from "@/components/embed/EmbedEarnClient";
import type { SponsoredCampaign } from "@/components/embed/SponsoredCarousel";
import {
  BACKEND_URL,
  normalizeTier,
  type EmbedTier,
} from "@/lib/embed-auth";

type WhopLinkStatus = "linked" | "unlinked" | "unknown";

export default async function EmbedEarnPage() {
  // Best-effort Clerk lookup. NEVER blocks the render — failure or null is
  // expected on the desktop Tauri webview path and the client handles it.
  let userId: string | null = null;
  try {
    const result = await auth();
    userId = result.userId ?? null;
  } catch {
    userId = null;
  }

  // Cookie fast path: if SSR resolved a Clerk user, pre-populate the data
  // so a browser visit renders without a client-side fetch waterfall.
  // Desktop path (userId === null): we pass nulls and the client resolves
  // everything via the JWT bridge.
  let initialTier: EmbedTier = null;
  let initialLinkStatus: WhopLinkStatus | null = null;
  let initialCampaigns: SponsoredCampaign[] | null = null;

  if (userId) {
    const [affiliate, campaigns] = await Promise.all([
      fetchAffiliateServer(userId),
      fetchCampaignsServer(userId),
    ]);
    initialTier = affiliate.tier;
    initialLinkStatus = affiliate.linkStatus;
    initialCampaigns = campaigns;
  }

  return (
    <EmbedEarnClient
      initialUserId={userId}
      initialTier={initialTier}
      initialLinkStatus={initialLinkStatus}
      initialCampaigns={initialCampaigns}
    />
  );
}

/* ── server-only fetchers (cookie fast path) ─────────────────────── */

async function fetchAffiliateServer(
  clerkUserId: string,
): Promise<{ tier: EmbedTier; linkStatus: WhopLinkStatus }> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return { tier: null, linkStatus: "unknown" };
    const data = (await res.json()) as {
      customer?: { tier?: string | null; whop_connected?: boolean | null };
    };
    const tier = normalizeTier(data.customer?.tier ?? null);
    const linkStatus: WhopLinkStatus = data.customer?.whop_connected
      ? "linked"
      : "unlinked";
    return { tier, linkStatus };
  } catch {
    return { tier: null, linkStatus: "unknown" };
  }
}

async function fetchCampaignsServer(
  clerkUserId: string,
): Promise<SponsoredCampaign[]> {
  try {
    const r = await fetch(
      `${BACKEND_URL}/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      { cache: "no-store" },
    );
    if (!r.ok) return [];
    const j = (await r.json()) as { campaigns?: SponsoredCampaign[] };
    return Array.isArray(j.campaigns) ? j.campaigns : [];
  } catch {
    return [];
  }
}
