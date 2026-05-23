"use client";

import { useEffect, useState } from "react";
import { SignUp } from "@clerk/nextjs";
import { TestimonialPanel } from "@/components/TestimonialPanel";

// Two-column sign-up surface. Same shape as /sign-in. Affiliate cookie is
// captured into Clerk's unsafeMetadata at sign-up — that's the "first-touch
// forever" attribution behaviour from ~/Desktop/jnr/oauth-billing.md §6.

function readAffiliateCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)jnr_ref=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function SignUpPage() {
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAffiliateId(readAffiliateCookie());
    setReady(true);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <section className="flex flex-col items-center px-6 pb-16 pt-12 sm:pt-20">
        <div className="flex w-full max-w-[460px] flex-col items-center gap-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            create your junior
          </div>

          <span
            className="inline-grid h-[44px] w-[44px] place-items-center rounded-lg bg-fuchsia font-mono text-[22px] font-bold leading-none text-paper"
            aria-hidden
          >
            /
          </span>

          <h1 className="text-center font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[36px]">
            Start clipping in{" "}
            <em className="not-italic text-fuchsia">two minutes</em>.
          </h1>

          {affiliateId && (
            <div className="w-full rounded-xl border border-fuchsia-soft bg-fuchsia-soft/30 px-4 py-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
              Referred · attribution locked
            </div>
          )}

          {ready && (
            <SignUp
              unsafeMetadata={affiliateId ? { affiliate_id: affiliateId } : undefined}
              forceRedirectUrl="/dashboard"
              signInUrl="/sign-in"
            />
          )}
        </div>
      </section>

      <TestimonialPanel orientation="below" />
    </div>
  );
}
