// v0.7.55 — /upgrade route (Whop embedded checkout).
//
// Per Daniel's locked architecture: Liquid Clips runs the upgrade flow
// via @whop/checkout's WhopCheckoutEmbed inside the app. The previous
// Clerk-billing pricing cards lived here; they're now reachable from
// /dashboard for users who want to manage an existing subscription.
//
// Architecture:
//   • Server component — Clerk auth gate, plan id from env, email
//     prefill from the signed-in user, affiliateCode from ?ref / ?affiliate.
//   • Checkout iframe handed off to a client wrapper (UpgradeCheckout)
//     so the WhopCheckoutEmbed React component can attach to DOM.
//   • Graceful disabled state when NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID is
//     missing — no crash, just an honest "checkout is not configured"
//     panel + link to the legacy dashboard plan picker.
//   • "Powered by Whop" badge sits above the iframe so the attribution
//     is one scan unit away from the actual checkout surface.
//
// Env vars:
//   NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID  — plan_XXX from the Whop dashboard.
//   NEXT_PUBLIC_WHOP_RETURN_URL        — optional override for the
//                                        post-checkout return URL.
//                                        Defaults to /checkout/complete
//                                        on the current host.

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UpgradeCheckout } from "./UpgradeCheckout";
import { PoweredByWhop } from "@/components/embed/PoweredByWhop";

export const metadata = {
  title: "Upgrade Liquid Clips",
  description: "Unlock no-watermark exports, $5 RPM, and 50% MRR.",
};

type SearchParams = Promise<{ ref?: string; affiliate?: string }>;

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // v0.7.55 P1-006 — read the affiliate code BEFORE the auth gate so we
  // can preserve it through the sign-in round-trip. Pre-fix the redirect
  // hard-coded `redirect_url=/upgrade` and the `?ref=`/`?affiliate=`
  // querystring was lost on every unauthed visit — affiliate links sent
  // to a logged-out user attributed zero conversions.
  const { ref, affiliate } = await searchParams;
  const affiliateCode = ref ?? affiliate ?? null;

  const { userId } = await auth();
  if (!userId) {
    const upgradeQuery = affiliateCode
      ? `/upgrade?ref=${encodeURIComponent(affiliateCode)}`
      : "/upgrade";
    redirect(`/sign-in?redirect_url=${encodeURIComponent(upgradeQuery)}`);
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const planId = process.env.NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID ?? "";
  const returnUrl =
    process.env.NEXT_PUBLIC_WHOP_RETURN_URL ??
    "https://liquidclips.app/checkout/complete";

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fuchsia">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            upgrade
          </div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[42px]">
            Unlock no-watermark exports, $5 RPM, and 50% MRR.
          </h1>
          <p className="max-w-[640px] font-sans text-[15px] leading-relaxed text-text-secondary">
            Liquid Clips Pro removes the watermark on every export, opens the
            premium reward ladder ($5 RPM vs $1 free), and unlocks the affiliate
            rail — 50% recurring on every paid user you refer.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <UpgradeFeature
            title="No-watermark exports"
            body="Every export ships clean. Required for the high-RPM brand campaigns and proof clips."
          />
          <UpgradeFeature
            title="$5 RPM premium ladder"
            body="Free clippers earn $1 RPM through the Whop bounty. Pro clippers earn $5 RPM total — the +$4 bonus is tracked on the Earn page."
          />
          <UpgradeFeature
            title="50% MRR for life"
            body="Refer two paid users, unlock 50% recurring commission on every paid customer you refer."
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
              checkout
            </div>
            <PoweredByWhop />
          </div>
          <UpgradeCheckout
            planId={planId}
            returnUrl={returnUrl}
            email={email}
            affiliateCode={affiliateCode}
          />
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line/40 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          <span>liquid clips · annual plans available on request</span>
          <a
            href="/dashboard"
            className="text-text-secondary transition-colors hover:text-fuchsia"
          >
            Manage existing subscription →
          </a>
        </footer>
      </main>
    </div>
  );
}

function UpgradeFeature({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-3xl border border-line bg-paper-elev/40 p-5">
      <h3 className="font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
        {title}
      </h3>
      <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
        {body}
      </p>
    </article>
  );
}
