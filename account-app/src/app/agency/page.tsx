// /agency — agency landing. Lists the signed-in user's campaigns.
//
// Server component handles the gate (auth + tier resolution). Free /
// solo / pro users see the "Upgrade to Agency" panel. Agency-tier and
// admin users see the campaign list.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin as isAdminEmail } from "@/lib/admin-allowlist";
import {
  isAgencyTier,
  normalizeAccountTier,
} from "@/lib/agency-tiers";
import { CampaignList } from "./_components/CampaignList";

export const metadata = {
  title: "Agency · Liquid Clips",
  description: "Launch + manage your clipping campaigns.",
};

type AgencyMe = { customer?: { tier?: string; admin_override?: boolean } };

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

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
    /* fall through to email-based admin check */
  }
  return { tier: normalizeAccountTier(tier), isAdmin: adminOverride };
}

export default async function AgencyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/agency");
  const user = await currentUser();
  if (!user) redirect("/sign-in?redirect_url=/agency");
  const email = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();

  const { tier, isAdmin } = await resolveTier(userId);
  const adminFromEmail = isAdminEmail(email);
  const allowed = isAgencyTier(tier) || isAdmin || adminFromEmail;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-10">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        agency
      </div>
      <h1 className="mt-3 font-display text-[clamp(32px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
        Your campaigns.
      </h1>
      <p className="mt-2 max-w-2xl font-sans text-[15px] leading-relaxed text-text-secondary">
        Launch a clipping mission, link a Whop reward, review submissions, and
        watch the payout settle. Liquid Clips runs the surface; Whop owns
        funding + approval.
      </p>

      <div className="mt-8">
        {allowed ? (
          <CampaignList />
        ) : (
          <UpgradePanel currentTier={tier} />
        )}
      </div>
    </div>
  );
}

function UpgradePanel({ currentTier }: { currentTier: string }) {
  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-6 sm:p-10">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        agency tier required
      </div>
      <h2 className="mt-3 font-display text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.02em] text-ink">
        Launch campaigns on the Agency plan.
      </h2>
      <p className="mt-3 max-w-xl font-sans text-[14px] leading-relaxed text-text-secondary">
        You&apos;re on <strong className="text-ink">{currentTier}</strong> today.
        Agency adds white-label, sub-accounts, and the ability to create
        clipping campaigns clippers can take. Upgrade to unlock the surface.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/upgrade"
          className="rounded-full bg-fuchsia px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright"
        >
          Upgrade to Agency
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-line bg-paper px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-ink"
        >
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
