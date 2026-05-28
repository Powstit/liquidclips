"use client";

import { useState } from "react";

// Affiliate/partner bridge card. Data comes from the backend /affiliate/me,
// which get-or-creates the user's Whop affiliate by email — Whop stays the
// source of truth for the link, referrals, and earnings.
//
// For non-Whop affiliates (payout_provider === "stripe_connect"), the "Set up
// Stripe Connect" button no longer routes through a static href — it POSTs to
// /api/affiliate/stripe-connect which calls the backend, gets or creates a
// Stripe Connect Express account, mints a hosted onboarding URL, and we
// window.location.assign() the user to Stripe. This is the only path that
// actually creates the account; the static href is the fallback for when
// JavaScript is unavailable.

async function startStripeConnectOnboarding(): Promise<string | null> {
  try {
    const res = await fetch("/api/affiliate/stripe-connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Stripe Connect onboarding failed", res.status, detail);
      return null;
    }
    const body = (await res.json()) as { url?: string };
    return body.url ?? null;
  } catch (e) {
    console.error("Stripe Connect onboarding network error", e);
    return null;
  }
}

export type Qualification = {
  paid_referrals_count: number;
  paid_referrals_needed: number;
  verified_views_count: number | null;
  verified_views_needed: number;
  qualified: boolean | null;
};

export type AffiliateData = {
  connected: boolean;
  affiliate_id: string | null;
  referral_url: string | null;
  status: string | null;
  active_members_count: number | null;
  total_referrals_count: number | null;
  monthly_recurring_revenue_usd: string | null;
  total_referral_earnings_usd: string | null;
  qualification: Qualification | null;
  partner_dashboard_url: string;
  payout_provider: "whop" | "stripe_connect" | string;
  payout_status: "ready" | "setup_required" | "unavailable" | string;
  payout_setup_url: string;
};

export type PaymentRoute = {
  key: string;
  label: string;
  provider: string;
  status: string;
  manage_url: string;
  helper: string;
  in_app: boolean;
};

export type PaymentVisibility = {
  app_subscription: PaymentRoute;
  reward_payouts: PaymentRoute;
  affiliate_payouts: PaymentRoute;
};

export type CustomerData = {
  tier: string;
  subscription_status: string;
  founder: boolean;
  admin_override: boolean;
  can_earn: boolean;
  billing_provider: string;
  is_trial: boolean;
  remaining_exports: number | null;
  paid_until: string | null;
  whop_connected: boolean;
  referrer_affiliate_id: string | null;
};

export type AffiliateMeResponse = { customer: CustomerData; affiliate: AffiliateData; payments: PaymentVisibility };

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-display text-2xl font-semibold tracking-[-0.02em] text-ink">{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
    </div>
  );
}

export function AffiliateCard({ affiliate, canEarn }: { affiliate: AffiliateData; canEarn: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = affiliate.referral_url ?? "";
  const q = affiliate.qualification;
  const usesStripeConnect = affiliate.payout_provider === "stripe_connect";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the field is selectable as a manual fallback */
    }
  }

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia">partner · earn up to 50%</div>
          <h2 className="mt-2 font-display text-[clamp(20px,2vw,24px)] font-semibold tracking-[-0.02em] text-ink">
            Your referral link.
          </h2>
        </div>
        <a
          href={affiliate.partner_dashboard_url}
          target="_blank"
          rel="noreferrer"
          className="hidden shrink-0 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink hover:border-fuchsia sm:inline-block"
        >
          Full partner dashboard →
        </a>
      </div>

      <div className="mt-4 rounded-3xl border border-line bg-paper-warm/40 p-5">
        {affiliate.connected && url ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-[12px] text-ink"
              />
              <button
                onClick={copy}
                className="shrink-0 rounded-xl bg-ink px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:bg-fuchsia"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="active referrals" value={String(affiliate.active_members_count ?? 0)} />
              <Tile label="total referrals" value={String(affiliate.total_referrals_count ?? 0)} />
              <Tile label="referral mrr" value={affiliate.monthly_recurring_revenue_usd ?? "$0.00"} />
              <Tile label="lifetime earned" value={affiliate.total_referral_earnings_usd ?? "$0.00"} />
            </div>

            {q && (
              <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">qualifying for 50%</div>
                <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">
                  <span className="font-medium text-ink">{q.paid_referrals_count}/{q.paid_referrals_needed}</span> paid referrals
                  {" · "}
                  <span className="font-medium text-ink">
                    {q.verified_views_count == null ? "—" : q.verified_views_count.toLocaleString()}/{q.verified_views_needed.toLocaleString()}
                  </span>{" "}
                  verified views{q.verified_views_count == null ? " (tracked on Whop)" : ""}.{" "}
                  50% recurring commission starts from customer 3 onward once you qualify.
                  {q.qualified ? " You've qualified on paid referrals." : ""}
                </p>
              </div>
            )}

            {!canEarn && (
              <p className="mt-3 font-sans text-[12px] text-text-secondary">
                Your link works now. Earning requires an active paid plan (Solo or higher).
              </p>
            )}

            <p className="mt-4 font-sans text-[12px] text-text-tertiary">
              {usesStripeConnect
                ? "Liquid Clips pays affiliate commissions through Stripe Connect for affiliates who do not use Whop."
                : "Whop handles all tracking and payouts."}{" "}
              {usesStripeConnect ? (
                <StripeConnectButton
                  fallbackUrl={affiliate.payout_setup_url || affiliate.partner_dashboard_url}
                  label="Set up Stripe Connect"
                  className="text-fuchsia underline"
                />
              ) : (
                <a
                  href={affiliate.payout_setup_url || affiliate.partner_dashboard_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-fuchsia underline"
                >
                  Open the partner dashboard
                </a>
              )}{" "}
              {usesStripeConnect ? "to receive payouts." : "for your QR code, share buttons, and payout setup."}
            </p>
          </>
        ) : (
          <>
            <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
              We couldn&apos;t load a Whop affiliate record right now. If you do not use Whop,
              set up Stripe Connect so Liquid Clips can pay affiliate commissions directly.
            </p>
            {usesStripeConnect ? (
              <StripeConnectButton
                fallbackUrl={affiliate.payout_setup_url || affiliate.partner_dashboard_url}
                label="Set up Stripe Connect →"
                className="mt-4 inline-block rounded-xl bg-ink px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-paper hover:bg-fuchsia"
              />
            ) : (
              <a
                href={affiliate.payout_setup_url || affiliate.partner_dashboard_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-block rounded-xl bg-ink px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-paper hover:bg-fuchsia"
              >
                Open partner dashboard →
              </a>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StripeConnectButton({
  fallbackUrl,
  label,
  className,
}: {
  fallbackUrl: string;
  label: string;
  className: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const url = await startStripeConnectOnboarding();
    if (url) {
      window.location.assign(url);
      return;
    }
    setBusy(false);
    setErr(
      "Could not start Stripe Connect onboarding right now. Try again in a moment, or open the dashboard for manual setup.",
    );
  }

  return (
    <>
      <button onClick={onClick} disabled={busy} className={className}>
        {busy ? "Opening Stripe…" : label}
      </button>
      {err && (
        <div className="mt-2 font-sans text-[12px] text-[#DC2626]">
          {err}{" "}
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            open dashboard
          </a>
        </div>
      )}
    </>
  );
}
