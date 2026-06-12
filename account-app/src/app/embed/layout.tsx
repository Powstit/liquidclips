// SURFACE: /embed/* shell — minimal chrome for the Tauri webview
// MAP TAGS: wraps every Earn-embed element so they render in the dark,
//           full-bleed frame that the desktop child webview expects.
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// What this layout does:
//   1. Strips the regular account-app chrome (`<Nav />`) from the parent body
//      via a single CSS rule — the root layout owns `<html>` / `<body>` in
//      Next.js App Router, so this nested layout can't replace them. The
//      `[data-embed-shell]` selector turns off the sticky nav and clears any
//      `<main>` padding so the embed paints edge-to-edge inside the webview.
//   2. Sets the viewport for a fixed-size webview (no zoom, no overflow).
//   3. Wraps children in <EmbedAuthBridge>, which:
//        - Reads Clerk's server-side userId from the satellite cookie (the
//          same path /dashboard uses today — verified working).
//        - Posts `lc:auth-request` to the desktop parent in case it has a
//          fresher LICENSE_JWT for license-bearer routes like /whop/bounties.
//
// The body's base colours (bg-paper text-ink — dark) are inherited from the
// root layout; account-app's globals.css already maps `--paper` to #0B0B10.

import type { Viewport } from "next";
import { auth, currentUser } from "@clerk/nextjs/server";
import { EmbedAuthBridge } from "@/components/embed/EmbedAuthBridge";
import { BACKEND_URL, normalizeTier, type EmbedTier } from "@/lib/embed-auth";

// Per-segment viewport meta. Next 16 reads this and emits the <meta> in the
// document head — no need to manually inject. Pinch-zoom disabled because
// the desktop webview is a fixed-size frame; pinch in a Tauri webview is a
// scroll, which would leave the surface stuck off-axis.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: false,
};

export default async function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Clerk satellite cookie path. dashboard/page.tsx already proves this works
  // on account.liquidclips.app — same cookie surface, same auth() call. The
  // post-message bridge in EmbedAuthBridge is the safety net for the rare
  // case where the Tauri child webview doesn't share cookies with the parent.
  const { userId } = await auth();
  const initialTier = userId ? await fetchInitialTier(userId) : null;

  // v0.7.55 — hard-positioned shell. Prior version relied on a
  // `body:has([data-embed-shell])` rule to hide the parent marketing <Nav>
  // (sticky z-50) and zero the parent <main> padding. When `:has()` failed
  // to apply in time (WebKit hydration race in the Tauri child webview), the
  // marketing nav covered the top of the embed and RouteSplash (fixed
  // inset-0 z-[100]) could blanket the whole surface — the "blank Earn"
  // symptom. Lifting the shell to `fixed inset-0 z-[200]` makes the embed
  // own the viewport regardless of what the root layout renders behind it.
  return (
    <div
      data-embed-shell="true"
      className="fixed inset-0 z-[200] overflow-y-auto bg-paper text-ink"
    >
      <EmbedAuthBridge initialUserId={userId ?? null} initialTier={initialTier}>
        {children}
      </EmbedAuthBridge>
    </div>
  );
}

// Server-side tier lookup. Same backend route /affiliate/me that dashboard
// uses — gated by an internal secret so this is safe to call from the server.
// Degrade silently to `null` so a backend hiccup falls back to whatever the
// post-message bridge resolves on the client.
async function fetchInitialTier(clerkUserId: string): Promise<EmbedTier> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return await fallbackClerkTier();
    const data = (await res.json()) as { customer?: { tier?: string | null } };
    return normalizeTier(data.customer?.tier ?? null);
  } catch {
    return await fallbackClerkTier();
  }
}

// If the backend is unreachable, read Clerk's publicMetadata.tier. Matches the
// dashboard's degrade path so the same user sees the same tier in both
// surfaces. Returns null when Clerk has nothing either.
async function fallbackClerkTier(): Promise<EmbedTier> {
  try {
    const u = await currentUser();
    const raw = (u?.publicMetadata?.tier as string | undefined) ?? null;
    return normalizeTier(raw);
  } catch {
    return null;
  }
}
