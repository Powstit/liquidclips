import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { PricingCards } from "@/components/PricingCards";
import { ComparisonToggle } from "@/components/ComparisonToggle";

// /upgrade — landing the desktop app deep-links to when a free or lower-tier
// user clicks an upgrade CTA (drip-mode pill, free-tier clip blur, schedule
// gate, etc). Auth-required: if no session, send to sign-in then back here.
//
// Reuses the same PricingCards component as the dashboard's plan section, so
// the upgrade page IS the same surface the user sees inside their dashboard —
// no copy drift between the two entry points.

export const metadata = {
  title: "Upgrade Liquid Clips",
  description: "Pick a plan to unlock publishing, scheduling, and hosted AI.",
};

export default async function UpgradePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/upgrade");
  }
  const user = await currentUser();
  const currentTier =
    ((user?.publicMetadata?.tier as string | undefined) ?? "free") as
      | "free" | "solo" | "growth" | "autopilot" | "pro" | "agency";

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto flex max-w-[1080px] flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            upgrade
          </div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-[-0.025em] text-ink">
            Pick a plan, get back to work.
          </h1>
          <p className="max-w-[640px] font-sans text-[15px] leading-relaxed text-text-secondary">
            Liquid Clips bills monthly via Clerk. Switch plans or cancel any time from your dashboard.
            Currently on{" "}
            <span className="font-medium text-ink">
              {publicTierName(currentTier)}
            </span>
            .
          </p>
        </header>

        <PricingCards currentSlug={tierToSlug(currentTier)} />

        <ComparisonToggle currentSlug={tierToSlug(currentTier)} />

        <section className="rounded-2xl border border-line bg-paper-warm/30 p-6">
          <h2 className="font-display text-[18px] font-semibold tracking-[-0.015em] text-ink">
            Need more social accounts?
          </h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-secondary">
            Solo includes 5 connected social accounts, Pro includes 10, and Agency includes
            25 for client-heavy teams.
          </p>
        </section>
      </main>
    </div>
  );

}

// PricingCards uses public v2 slugs. Legacy backend/Clerk names are normalized
// here so existing users see the correct v2 label.
function tierToSlug(tier: "free" | "solo" | "growth" | "autopilot" | "pro" | "agency"): string {
  if (tier === "free") return "free_user";
  if (tier === "growth") return "pro";
  if (tier === "autopilot") return "agency";
  return tier;
}

function publicTierName(tier: "free" | "solo" | "growth" | "autopilot" | "pro" | "agency"): string {
  const slug = tierToSlug(tier);
  if (slug === "free_user") return "Free";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
