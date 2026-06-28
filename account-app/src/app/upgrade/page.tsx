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
import { normalizeWhopPlanKey, WHOP_PLANS } from "@/lib/whopPlans";

export const metadata = {
  title: "Upgrade Liquid Clips",
  description: "Unlock no-watermark exports, $5 RPM, and 50% MRR.",
};

type SearchParams = Promise<{
  plan?: string;
  a?: string;
  ref?: string;
  affiliate?: string;
}>;

function safeAffiliateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_-]+$/.test(code) ? code : null;
}

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
  const { plan: requestedPlan, a, ref, affiliate } = await searchParams;
  const planKey = normalizeWhopPlanKey(requestedPlan);
  const selectedPlan = WHOP_PLANS[planKey];
  const incomingAffiliateCode = safeAffiliateCode(a ?? ref ?? affiliate);

  const { userId } = await auth();
  if (!userId) {
    const params = new URLSearchParams({ plan: planKey });
    if (incomingAffiliateCode) params.set("a", incomingAffiliateCode);
    const upgradeQuery = `/upgrade?${params.toString()}`;
    redirect(`/sign-in?redirect_url=${encodeURIComponent(upgradeQuery)}`);
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  // Existing users already have immutable first-touch attribution stored in
  // Clerk unsafeMetadata by the signup flow. Prefer that locked value over a
  // URL parameter so a later link can never steal an established referral.
  const lockedAffiliateCode = safeAffiliateCode(
    user?.unsafeMetadata?.affiliate_id,
  );
  let affiliateCode = lockedAffiliateCode ?? incomingAffiliateCode;
  const backendUrl =
    process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ??
    "https://api.liquidclips.app";
  const metadataStatus =
    typeof user?.publicMetadata?.subscription_status === "string"
      ? user.publicMetadata.subscription_status.toLowerCase()
      : "";
  const metadataWhopUser =
    typeof user?.publicMetadata?.whop_user_id === "string"
      ? user.publicMetadata.whop_user_id
      : "";
  let manageExistingMembership =
    !!metadataWhopUser &&
    (metadataStatus === "active" ||
      metadataStatus === "trialing" ||
      metadataStatus === "past_due");
  try {
    const response = await fetch(
      `${backendUrl}/affiliate/me?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        headers: {
          "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        },
        cache: "no-store",
      },
    );
    if (response.ok) {
      const payload = (await response.json()) as {
        customer?: {
          billing_provider?: string;
          subscription_status?: string;
          referrer_affiliate_id?: string | null;
        };
      };
      affiliateCode =
        safeAffiliateCode(payload.customer?.referrer_affiliate_id) ??
        affiliateCode;
      const status = payload.customer?.subscription_status?.toLowerCase();
      manageExistingMembership =
        payload.customer?.billing_provider === "whop" &&
        (status === "active" || status === "trialing" || status === "past_due");
    }
  } catch {
    // The checkout remains available when the account-state probe is down.
    // Whop itself still prevents malformed payment attempts.
  }

  const returnUrl =
    `https://account.liquidclips.app/checkout/complete?plan=${planKey}`;

  return (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto flex w-full max-w-[920px] flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fuchsia">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            upgrade
          </div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-[-0.025em] text-ink md:text-[42px]">
            Upgrade to Liquid Clips {selectedPlan.name}.
          </h1>
          <p className="max-w-[640px] font-sans text-[15px] leading-relaxed text-text-secondary">
            {selectedPlan.summary} Whop handles checkout, receipts, plan changes,
            and cancellation.
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
          {manageExistingMembership ? (
            <div className="rounded-3xl border border-line bg-paper-elev/40 p-6">
              <h2 className="font-display text-[20px] font-semibold text-ink">
                Change your existing plan in Whop.
              </h2>
              <p className="mt-2 max-w-[620px] font-sans text-[14px] leading-relaxed text-text-secondary">
                You already have a Liquid Clips membership. Whop&apos;s billing
                portal changes plans without creating a duplicate subscription.
                It also holds your receipts, payment method, and cancellation.
              </p>
              <a
                href="https://whop.com/@me/settings/memberships"
                className="mt-5 inline-flex rounded-full bg-fuchsia px-5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white"
              >
                Open Whop billing →
              </a>
            </div>
          ) : (
            <UpgradeCheckout
              planId={selectedPlan.planId}
              planKey={planKey}
              returnUrl={returnUrl}
              email={email}
              affiliateCode={affiliateCode}
            />
          )}
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
