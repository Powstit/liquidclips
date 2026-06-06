"use client";

import { useEffect, useState } from "react";
import { SignUp } from "@clerk/nextjs";
import { TestimonialPanel } from "@/components/TestimonialPanel";
import { track } from "@/lib/analytics";

// Two-column sign-up surface. Same shape as /sign-in. Affiliate cookie is
// captured into Clerk's unsafeMetadata at sign-up — that's the "first-touch
// forever" attribution behaviour from ~/Desktop/jnr/oauth-billing.md §6.

function readAffiliateRef(): string | null {
  if (typeof window === "undefined") return null;
  // First-touch cookie wins (set by the marketing ref-capture script). Fall
  // back to ?ref/?a on a direct account link (account.jnremployee.com/sign-up
  // ?ref=…) so attribution still locks into Clerk unsafeMetadata instead of
  // only landing in PostHog.
  const m = document.cookie.match(/(?:^|;\s*)jnr_ref=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const p = new URLSearchParams(window.location.search);
  const fromUrl = p.get("ref") || p.get("a");
  return fromUrl && /^[A-Za-z0-9_-]+$/.test(fromUrl) ? fromUrl.slice(0, 64) : null;
}

export default function SignUpPage() {
  const [affiliateId, setAffiliateId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const aff = readAffiliateRef();
    setAffiliateId(aff);
    setReady(true);
    // signup_started fires when the user lands on the form. affiliate_ref_captured
    // is a separate event so we can tell the difference between "saw the
    // form" and "arrived via a referral". Neither carries email.
    track("signup_started", { has_affiliate: !!aff });
    if (aff) track("affiliate_ref_captured", { affiliate_id: aff, surface: "signup" });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <section className="flex flex-col items-center px-6 pb-16 pt-12 sm:pt-20">
        <div className="flex w-full max-w-[460px] flex-col items-center gap-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            create your liquid clips account
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
