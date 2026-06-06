// v0.7.0 — Affiliate landing. The destination of every "Get my affiliate link"
// CTA across the product (sponsored banner on desktop, welcome email, founder
// emails). Lays out terms + the payout-rail split (Whop vs Stripe Connect) so
// the user can pick how they get paid before they ever start referring.
//
// Auth-soft: viewable signed-out (so an unauthed referrer landing from the
// banner can still read terms + understand the offer). Action CTA gates on
// auth and bounces to /sign-in then back here.

import Link from "next/link";

export const metadata = {
  title: "Liquid Clips Affiliate — 50% MRR for life",
  description:
    "Refer two paid Liquid Clips users and unlock 50% recurring commission on every customer you refer — lifetime. Pick Whop or Stripe Connect as your payout rail.",
};

const FUCHSIA = "#FF1A8C";

export default function ReferPage() {
  return (
    <main className="min-h-screen bg-[#050507] text-[#F5EFE7]">
      {/* Hero */}
      <section className="mx-auto flex max-w-[920px] flex-col items-start gap-5 px-6 pt-16 pb-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fuchsia)]">
          ● live · public · affiliate program
        </p>
        <h1 className="font-serif text-[64px] font-semibold leading-[1.02] tracking-[-0.025em] text-[#F5EFE7]">
          50% MRR.{" "}
          <span className="text-[var(--fuchsia)]">For life.</span>
        </h1>
        <p className="max-w-[640px] font-sans text-[16px] leading-relaxed text-[#C9C0C5]">
          Refer two paid Liquid Clips users and unlock <strong className="text-[#F5EFE7]">50% recurring commission</strong> on every customer you bring in — lifetime, not just first month. Pick how you get paid below.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--fuchsia)] px-6 py-3 font-sans text-[14px] font-semibold text-white shadow-[0_0_28px_rgba(255,26,140,0.45)] transition-colors hover:bg-[var(--fuchsia-bright)]"
          >
            Get my affiliate link →
          </Link>
          <a
            href="#terms"
            className="inline-flex items-center gap-2 rounded-full border border-[#3a2530] bg-[#1a0f18] px-6 py-3 font-sans text-[14px] font-medium text-[#C9C0C5] transition-colors hover:border-[var(--fuchsia)] hover:text-white"
          >
            Read the terms ↓
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-[920px] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
          how it works
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              n: "01",
              title: "Share your link",
              body: "Every Liquid Clips account gets a unique referral link in the dashboard. Drop it in bios, content, and conversations.",
            },
            {
              n: "02",
              title: "Two paid referrals unlock the rate",
              body: "When two of the people you refer become paying Liquid Clips customers, the 50% recurring rate goes live on every customer you've referred — past and future.",
            },
            {
              n: "03",
              title: "We pay you forever",
              body: "Every month they pay Liquid Clips, you earn 50% of their subscription. As long as they stay paying — you keep getting paid. No 30-day window, no first-month-only.",
            },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-[#231423] bg-[#0F0F14] p-5"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
                step {s.n}
              </div>
              <h3 className="mt-2 font-serif text-[20px] font-semibold leading-tight tracking-[-0.015em] text-[#F5EFE7]">
                {s.title}
              </h3>
              <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-[#B5AFB2]">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Payout split */}
      <section className="mx-auto max-w-[920px] px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
          pick your payout rail
        </p>
        <h2 className="mt-3 font-serif text-[28px] font-semibold tracking-[-0.02em] text-[#F5EFE7]">
          Whop. Or Stripe.
        </h2>
        <p className="mt-2 max-w-[640px] font-sans text-[14px] text-[#C9C0C5]">
          You only set this up once. Pick the rail that matches where you already get paid for content work.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--fuchsia)] bg-[#15151B] p-6">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
              option a · creator default
            </div>
            <h3 className="mt-3 font-serif text-[22px] font-semibold text-[#F5EFE7]">Whop</h3>
            <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-[#B5AFB2]">
              The same Whop wallet your Content Reward payouts already land in. One identity, one payout cycle. Best for clippers who already have a Whop account.
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-[#C9C0C5]">
              <li>· Monthly payout via Whop's standard cycle</li>
              <li>· Tax handled by Whop's W-8/W-9 collection</li>
              <li>· No extra accounts to manage</li>
            </ul>
            <Link
              href="/dashboard"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--fuchsia)] px-5 py-2.5 font-sans text-[13px] font-semibold text-white"
            >
              Set up Whop payout →
            </Link>
          </div>

          <div className="rounded-2xl border border-[#231423] bg-[#0F0F14] p-6">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#B5AFB2]">
              option b · direct deposit
            </div>
            <h3 className="mt-3 font-serif text-[22px] font-semibold text-[#F5EFE7]">Stripe Connect</h3>
            <p className="mt-2 font-sans text-[13.5px] leading-relaxed text-[#B5AFB2]">
              Direct bank deposit via a Stripe Connect Express account. Best for affiliates outside the Whop ecosystem or who prefer their own ledger.
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-[#C9C0C5]">
              <li>· Direct deposit to your bank, ~2 business days</li>
              <li>· Stripe handles KYC + 1099 / tax forms</li>
              <li>· $5 minimum payout before a transfer fires</li>
            </ul>
            <Link
              href="/dashboard#payouts"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#3a2530] bg-[#1a0f18] px-5 py-2.5 font-sans text-[13px] font-semibold text-white"
            >
              Set up Stripe Connect →
            </Link>
          </div>
        </div>
      </section>

      {/* TERMS & CONDITIONS */}
      <section id="terms" className="mx-auto max-w-[920px] px-6 py-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
          terms & conditions
        </p>
        <h2 className="mt-3 font-serif text-[28px] font-semibold tracking-[-0.02em] text-[#F5EFE7]">
          The fine print.
        </h2>
        <p className="mt-2 max-w-[680px] font-sans text-[14px] leading-relaxed text-[#C9C0C5]">
          These terms govern your participation in the Liquid Clips Affiliate Program. By generating an affiliate link or accepting a payout, you agree to all clauses below.
        </p>

        <ol className="mt-6 list-decimal space-y-4 pl-5 text-[14px] leading-relaxed text-[#C9C0C5]">
          <li>
            <strong className="text-[#F5EFE7]">Eligibility.</strong> Any Liquid Clips user (free or paid) can join the affiliate program by activating their referral link in the dashboard. Liquid Clips reserves the right to refuse or terminate affiliate status at its sole discretion.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Qualification threshold.</strong> The 50% recurring commission rate activates after <strong className="text-[#F5EFE7]">two of your referrals have become paying Liquid Clips customers and remained in good standing for at least 7 days</strong>. Before qualification, you earn the standard 30% first-month commission on each paid referral.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Commission structure.</strong> Once qualified, you earn 50% of each referred customer's paid Liquid Clips subscription, for as long as they remain a paying customer — including renewals, plan upgrades, and account-pack add-ons. Commission is calculated on the net subscription revenue Liquid Clips receives after payment-processor fees and refunds.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Lifetime guarantee.</strong> "Lifetime" means the lifetime of the customer's paying account. If the customer cancels, pauses, or downgrades, commission pauses or recalculates accordingly. If they return as a paying customer later, commission resumes.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Payout rails.</strong> You may choose either Whop or Stripe Connect as your payout rail in the dashboard. You may switch once per quarter. Liquid Clips does not handle funds directly — Whop or Stripe holds your balance.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Payout cycle.</strong> Commissions clear on the rail's standard schedule (Whop: monthly; Stripe: rolling, subject to Stripe's payout schedule for your account). A $5 minimum applies before a Stripe transfer fires; sub-$5 balances roll to the next cycle.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Attribution window.</strong> A referral is attributed to your link on a <strong className="text-[#F5EFE7]">first-touch, 30-day cookie</strong> basis. If a user clicks your link, doesn't sign up immediately, but returns within 30 days and converts to paying, you receive the commission. After 30 days the attribution expires.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Self-referrals prohibited.</strong> You may not refer yourself, members of your immediate household, or accounts you control. Liquid Clips uses IP, payment-instrument, and device fingerprints to detect self-referrals. Violations void commission and may terminate affiliate status.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Fraud + spam prohibited.</strong> No paid-search bidding on "Liquid Clips" or trademark-confused terms. No spamming forums, comments, or unsolicited DMs. No bot traffic, click farms, or incentivised signups (paying users to sign up under your link in exchange for cash, gift cards, or services). Detected fraud forfeits all commissions earned to date.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Trademark + content use.</strong> You may use the "Liquid Clips" name and brand mark in promotional content for the affiliate program. You may not register domains containing "liquidclips", "liquid-clips", or confusingly similar marks. You may not represent yourself as an employee, officer, or official spokesperson of Liquid Clips.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Tax responsibility.</strong> You are responsible for declaring affiliate income to your local tax authority. Whop issues 1099s in the US where required; Stripe Connect issues 1099-K for US affiliates over the federal threshold. For non-US affiliates, Whop/Stripe collect W-8 forms at onboarding.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Right to terminate.</strong> Liquid Clips may suspend or terminate any affiliate account at any time, for any reason — including but not limited to fraud, trademark abuse, brand misalignment, or program closure. Earned and approved commissions through the date of termination remain payable; commission accruing after termination is forfeit.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Program changes.</strong> Liquid Clips may change commission rates, qualification thresholds, payout cycles, and program terms with 30 days' written notice via email. Existing referrals at the time of a change keep their existing commission rate until the change date.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Refunds + chargebacks.</strong> If a referred customer refunds or charges back within 30 days of purchase, the commission on that purchase is voided and clawed back from your next payout cycle.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">Governing law.</strong> These terms are governed by the laws of England and Wales. Disputes will be resolved in the courts of London, UK.
          </li>
          <li>
            <strong className="text-[#F5EFE7]">No employment.</strong> The affiliate relationship is independent. You are not an employee, agent, or franchisee of Liquid Clips. You have no authority to bind Liquid Clips to any contract or represent it in any capacity beyond promoting the referral link.
          </li>
        </ol>

        <p className="mt-8 max-w-[680px] font-mono text-[11px] uppercase tracking-[0.14em] text-[#7A7672]">
          Last updated: 2026-06-04 · Reply to{" "}
          <a href="mailto:hello@liquidclips.app" className="text-[var(--fuchsia)] hover:underline">
            hello@liquidclips.app
          </a>{" "}
          with any questions before joining.
        </p>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-[920px] px-6 pb-20 pt-4">
        <div className="rounded-3xl border-2 border-[var(--fuchsia)] bg-[#15151B] p-8 shadow-[0_0_36px_rgba(255,26,140,0.25)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fuchsia)]">
            ready to start
          </p>
          <h2 className="mt-2 font-serif text-[32px] font-semibold tracking-[-0.02em] text-[#F5EFE7]">
            Get your link. Pick your payout. Start earning.
          </h2>
          <p className="mt-2 max-w-[640px] font-sans text-[14px] text-[#C9C0C5]">
            Your unique referral link lives on your dashboard. Set up Whop or Stripe Connect there too — both pre-wired.
          </p>
          <div className="mt-5">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--fuchsia)] px-6 py-3 font-sans text-[14px] font-semibold text-white shadow-[0_0_28px_rgba(255,26,140,0.45)] transition-colors hover:bg-[var(--fuchsia-bright)]"
            >
              Open my dashboard →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
