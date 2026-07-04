import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AffiliateAgreementPageClient } from "./page-client";

// /affiliate/agreement — click-wrap Partner & Affiliate Agreement.
//
// Rendered as a full page (also embeddable inside a Tauri browse panel
// via the query string `?signature_required=true`). The page pulls the
// user's Whop identity + payout binding server-side so the receipt is
// bound at render time, not at signing time.
//
// Auth: Clerk session required. Unsigned users are redirected to /sign-in
// with a returnUrl of this same page.
//
// After signing, the client sets `window.opener.postMessage(...)` when
// embedded (Tauri) or navigates back to /wallet when standalone.

interface PageProps {
  searchParams: Promise<{ signature_required?: string; return_to?: string }>;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

interface AgreementStatus {
  signed: boolean;
  current_version: string;
  signed_version: string | null;
  signed_at: string | null;
  status: "active" | "frozen" | "revoked" | null;
  frozen_reason: string | null;
  require_resign: boolean;
}

interface AffiliateBridge {
  affiliate?: { affiliate_code?: string | null; affiliate_id?: string | null };
  billing?: { whop_user_id?: string | null; whop_wallet_address?: string | null };
}

async function fetchStatus(clerkUserId: string): Promise<AgreementStatus | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/agreement/status?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as AgreementStatus;
  } catch {
    return null;
  }
}

async function fetchBridge(clerkUserId: string): Promise<AffiliateBridge | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as AffiliateBridge;
  } catch {
    return null;
  }
}

export default async function AffiliateAgreementPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  const params = await searchParams;
  if (!userId) {
    const q = new URLSearchParams();
    q.set(
      "redirect_url",
      `/affiliate/agreement${params.signature_required ? "?signature_required=true" : ""}`,
    );
    redirect(`/sign-in?${q.toString()}`);
  }

  const [status, bridge] = await Promise.all([fetchStatus(userId), fetchBridge(userId)]);

  // Best-effort context — nulls are fine, the modal renders "(unbound)"
  // rather than failing.
  const whopUserId = bridge?.billing?.whop_user_id ?? null;
  const payoutAddress = bridge?.billing?.whop_wallet_address ?? null;

  // Clerk user email for display, not for signing.
  const client = await clerkClient();
  const user = await client.users.getUser(userId).catch(() => null);
  const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <AffiliateAgreementPageClient
      alreadySigned={status?.signed === true && status?.status === "active"}
      frozen={status?.status === "frozen"}
      frozenReason={status?.frozen_reason ?? null}
      requireResign={status?.require_resign === true}
      context={{ whopUserId, payoutAddress }}
      email={primaryEmail}
      returnTo={typeof params.return_to === "string" ? params.return_to : null}
    />
  );
}
