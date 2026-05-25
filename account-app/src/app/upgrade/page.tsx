import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Nav } from "@/components/Nav";
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
  title: "Upgrade Junior",
  description: "Pick a plan to unlock publishing, scheduling, and drip-mode.",
};

export default async function UpgradePage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/upgrade");
  }
  const user = await currentUser();
  const currentTier =
    ((user?.publicMetadata?.tier as string | undefined) ?? "free") as
      | "free" | "solo" | "growth" | "autopilot";

  return (
    <div className="min-h-screen bg-paper">
      <Nav />
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
            Junior bills monthly via Clerk. Switch plans or cancel any time from your dashboard.
            Currently on{" "}
            <span className="font-medium text-ink">
              {currentTier === "free" ? "Free" : capitalise(currentTier)}
            </span>
            .
          </p>
        </header>

        <PricingCards currentSlug={tierToSlug(currentTier)} />

        <ComparisonToggle currentSlug={tierToSlug(currentTier)} />

        <section className="rounded-2xl border border-line bg-paper-warm/30 p-6">
          <h2 className="font-display text-[18px] font-semibold tracking-[-0.015em] text-ink">
            Want lifetime access?
          </h2>
          <p className="mt-2 font-sans text-[14px] leading-relaxed text-text-secondary">
            Founder Lifetime is a one-time $500 — locks in Autopilot forever, no recurring charge.
            Sold through Whop because Clerk only handles recurring plans.
          </p>
          <a
            href="https://jnremployee.com/founder"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia hover:shadow-[0_8px_24px_rgba(255,26,140,0.25)]"
          >
            Founder Lifetime — $500 →
          </a>
        </section>
      </main>
    </div>
  );
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// PricingCards uses Clerk plan slugs (free_user, solo, growth, autopilot)
// while the rest of the codebase uses tier names. Translate here.
function tierToSlug(tier: "free" | "solo" | "growth" | "autopilot"): string {
  return tier === "free" ? "free_user" : tier;
}
