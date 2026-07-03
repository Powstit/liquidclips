// /agency/campaigns/new — create form. Gate matches /agency.

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin as isAdminEmail } from "@/lib/admin-allowlist";
import {
  isAgencyTier,
  normalizeAccountTier,
} from "@/lib/agency-tiers";
import { CampaignForm } from "../../_components/CampaignForm";

export const metadata = {
  title: "New campaign · Agency · Liquid Clips",
};

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

export default async function NewCampaignPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/agency/campaigns/new");
  const user = await currentUser();
  if (!user) redirect("/sign-in?redirect_url=/agency/campaigns/new");
  const email = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();

  const { tier, isAdmin } = await resolveTier(userId);
  const allowed = isAgencyTier(tier) || isAdmin || isAdminEmail(email);
  if (!allowed) redirect("/agency");

  return (
    <div className="mx-auto max-w-[840px] px-6 py-10">
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <Link href="/agency" className="hover:text-ink">
          ← Agency
        </Link>
        <span>new campaign</span>
      </div>
      <h1 className="mt-3 font-display text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
        Launch a campaign.
      </h1>
      <p className="mt-2 max-w-xl font-sans text-[14px] leading-relaxed text-text-secondary">
        Title, brief, Whop reward URL. You can edit everything after — but the
        slug is locked once saved.
      </p>

      <section className="mt-8 rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
        <CampaignForm mode="create" />
      </section>
    </div>
  );
}
