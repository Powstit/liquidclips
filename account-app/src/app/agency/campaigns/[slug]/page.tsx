// /agency/campaigns/[slug] — detail surface.
// Gate matches /agency. The detail view ships as a client island so the
// tab state lives in-place without round-tripping.

import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin as isAdminEmail } from "@/lib/admin-allowlist";
import {
  isAgencyTier,
  normalizeAccountTier,
} from "@/lib/agency-tiers";
import { CampaignDetailClient } from "./CampaignDetailClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

type AgencyMe = { customer?: { tier?: string; admin_override?: boolean } };

async function resolveTier(userId: string): Promise<{
  tier: string;
  isAdmin: boolean;
}> {
  let tier = "free";
  let adminOverride = false;
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const j = (await res.json()) as AgencyMe;
      tier = j.customer?.tier ?? "free";
      adminOverride = !!j.customer?.admin_override;
    }
  } catch {
    /* fall through */
  }
  return { tier: normalizeAccountTier(tier), isAdmin: adminOverride };
}

type PageProps = { params: Promise<{ slug: string }> };

export default async function CampaignDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId)
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent(`/agency/campaigns/${slug}`)}`,
    );
  const user = await currentUser();
  if (!user)
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent(`/agency/campaigns/${slug}`)}`,
    );
  const email = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();

  const { tier, isAdmin } = await resolveTier(userId);
  const allowed = isAgencyTier(tier) || isAdmin || isAdminEmail(email);
  if (!allowed) redirect("/agency");

  return <CampaignDetailClient slug={slug} />;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return {
    title: `${slug} · Agency · Liquid Clips`,
  };
}
