"use client";

// v0.7.55 — Whop checkout embed wrapper. Client component because
// WhopCheckoutEmbed needs to mount an iframe in the DOM.
//
// Graceful disabled state when `planId` is empty so a missing env var
// renders an honest "checkout not configured" panel instead of crashing
// the iframe mount.

import { useRouter } from "next/navigation";
import { WhopCheckoutEmbed } from "@whop/checkout/react";

export function UpgradeCheckout({
  planId,
  returnUrl,
  email,
  affiliateCode,
}: {
  planId: string;
  returnUrl: string;
  email: string | null;
  affiliateCode: string | null;
}) {
  const router = useRouter();

  if (!planId) {
    return (
      <div className="flex flex-col gap-3 rounded-3xl border border-[#EAB308]/40 bg-[#EAB308]/10 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A87A00]">
          checkout not configured
        </p>
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          The Whop checkout plan id (
          <code className="rounded bg-paper-warm/40 px-1.5 py-0.5 font-mono text-[11px] text-ink">
            NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID
          </code>
          ) isn&apos;t set on this deployment. Manage your plan in the dashboard
          while we get the embedded path live.
        </p>
        <a
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
        >
          Open dashboard →
        </a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-paper-elev/40">
      <WhopCheckoutEmbed
        planId={planId}
        returnUrl={returnUrl}
        theme="dark"
        prefill={email ? { email } : undefined}
        affiliateCode={affiliateCode ?? undefined}
        skipRedirect
        onComplete={(_planId, _receiptId) => {
          // Keep the user inside the app — bounce them to the success
          // page so they can refresh entitlement + return to the desktop.
          router.push("/checkout/complete?status=success");
        }}
        fallback={
          <div className="grid h-[420px] place-items-center font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            loading checkout…
          </div>
        }
        styles={{ container: { paddingTop: 24, paddingBottom: 24 } }}
      />
    </div>
  );
}
