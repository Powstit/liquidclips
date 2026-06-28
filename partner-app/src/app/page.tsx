import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { ensureAffiliate } from "@/lib/whop";
import { brand } from "@/lib/brand";
import { Nav } from "@/components/Nav";
import { ReferralLink } from "@/components/ReferralLink";
import { ShareButtons } from "@/components/ShareButtons";
import { StatTiles } from "@/components/StatTiles";
import { ReferralQR } from "@/components/ReferralQR";
import { TrackOnMount } from "@/components/Track";

export const dynamic = "force-dynamic";

// Whop returns "$0.00" style strings. Parse into numbers.
function parseUsd(s: string | number | undefined | null): number {
  if (typeof s === "number") return s;
  if (!s) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Referral URL → Liquid Clips-owned checkout (account.liquidclips.app/checkout),
// which embeds the Whop checkout and passes the affiliate username code through
// as ?a=<code>. Whop's checkout does not accept the internal aff_* record ID.
// The customer stays on a Liquid Clips-branded page (no generic Whop
// storefront), Whop still attributes + pays the affiliate, and on completion
// returns to /get to link the account. Override the base via
// NEXT_PUBLIC_WHOP_CHECKOUT_URL if needed.
function buildReferralUrl(affiliateCode: string): string {
  const base = process.env.NEXT_PUBLIC_WHOP_CHECKOUT_URL ?? "https://account.liquidclips.app/checkout";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}a=${encodeURIComponent(affiliateCode)}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const error = params?.error;
  const session = await readSession();

  // If an OAuth error came back, show it — don't bounce to marketing (creates loop).
  if (error) {
    return (
      <div className="min-h-screen bg-paper">
        <Nav />
        <main className="mx-auto max-w-[640px] px-5 py-14">
          <div className="rounded-2xl border border-fuchsia/30 bg-fuchsia-soft/40 p-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">Sign-in didn&apos;t complete</div>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Something blocked the handshake.</h1>
            <p className="mt-3 text-text-secondary">
              Whop reported: <code className="rounded bg-paper-warm px-2 py-1 font-mono text-sm">{error}</code>
            </p>
            <p className="mt-3 text-sm text-text-secondary">
              Most common cause: a third-party cookie blocker (Brave / Safari ITP / a strict extension) preventing the session cookie from saving.
              Try a fresh incognito window in Chrome or Firefox.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/auth/whop/start" className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper hover:bg-fuchsia">
                Try again →
              </a>
              <a href="https://liquidclips.app/affiliates" className="rounded-full border border-line bg-paper px-5 py-3 text-sm font-medium text-ink hover:border-fuchsia">
                Back to /affiliates
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!session) redirect(`${brand.marketingUrl}/affiliates`);

  let affiliate: Awaited<ReturnType<typeof ensureAffiliate>> | null = null;
  let failureNote: string | null = null;

  try {
    affiliate = await ensureAffiliate(session.userId);
  } catch (e) {
    console.error("[partner] ensureAffiliate failed:", e);
    failureNote = `Couldn't reach Whop. We'll retry. (${String(e).slice(0, 120)})`;
  }

  const affiliateCode = affiliate?.user?.username?.trim() ?? "";
  const referralUrl = affiliateCode ? buildReferralUrl(affiliateCode) : "";
  if (affiliate && !affiliateCode && !failureNote) {
    failureNote = "Whop has not assigned a checkout code to this affiliate yet. Retry shortly.";
  }
  const activeMrrUsd = parseUsd(affiliate?.monthly_recurring_revenue_usd);
  const lifetimeEarnedUsd = parseUsd(affiliate?.total_referral_earnings_usd);
  // "This month" tile reflects current MRR — accurate for the current billing cycle.
  // TODO v1.1: when /payouts page lands, query payouts.list for true queued amount.
  const pendingPayoutUsd = activeMrrUsd;
  const activeMembers = affiliate?.active_members_count ?? 0;
  const totalReferrals = affiliate?.total_referrals_count ?? 0;

  const isEmpty = totalReferrals === 0;

  // Best-available identity: Google/OAuth name > @username > email prefix > "there"
  const greetingName = session.name
    ?? (session.username ? `@${session.username}` : null)
    ?? (affiliate?.user?.name ?? (affiliate?.user?.username ? `@${affiliate.user.username}` : null))
    ?? session.email?.split("@")[0]
    ?? "there";
  const firstName = (session.name ?? affiliate?.user?.name ?? "").split(" ")[0] || greetingName;
  const displayName = firstName;

  return (
    <div className="min-h-screen bg-paper">
      <TrackOnMount
        event="partner_dashboard_viewed"
        properties={{
          // Use the actual affiliate record id — this is what joins to
          // referral URLs (?ref=affiliate.id) and backend attribution
          // (User.affiliate_id). Username is a display name, not a join key.
          affiliate_id: affiliate?.id ?? null,
          has_affiliate: !!affiliate,
        }}
      />
      {/* Fire once when a non-empty referral URL renders — lets us track
          how many affiliates successfully see their link on first load. */}
      {referralUrl && (
        <TrackOnMount
          event="affiliate_checkout_link_viewed"
          properties={{ affiliate_id: affiliate?.id ?? null }}
        />
      )}
      <Nav username={session.username ?? session.name} />

      <main className="mx-auto max-w-[820px] px-5 py-10 sm:py-14">
        <header className="mb-8">
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Welcome, {greetingName}.
          </h1>
          <p className="mt-2 text-text-secondary sm:text-lg">
            Your referral link is ready. Earn <strong className="text-ink">30% of each referred customer&apos;s first payment</strong>, then unlock 50% recurring commission once you reach Qualified Partner status.
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-text-tertiary">
            An active paid Liquid Clips membership is required. Commission pauses if your membership lapses and resumes when you reactivate. Refunds, chargebacks, fraud, and abuse remain ineligible.
          </p>
        </header>

        {failureNote && (
          <div className="mb-6 rounded-xl border border-line bg-paper-warm p-4 text-sm text-text-secondary">
            {failureNote}
          </div>
        )}

        {referralUrl && (
          <div className="mb-6">
            <ReferralLink url={referralUrl} />
          </div>
        )}

        {referralUrl && (
          <div className="mb-10">
            <ReferralQR url={referralUrl} />
          </div>
        )}

        <div className="mb-10 border-t border-line pt-8">
          <ShareButtons referralUrl={referralUrl || brand.marketingUrl} username={displayName} />
        </div>

        {/* Qualification target */}
        <div className="mb-10 rounded-2xl border border-line bg-paper-warm/60 p-5 sm:p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Your qualification target
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Unlock 50% recurring commission.
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Reach the paid-referral milestone to qualify:
          </p>
          <div className="mt-4">
            <div className="rounded-xl border border-line bg-paper p-4">
              <div className="font-display text-2xl font-semibold text-fuchsia">2</div>
              <div className="mt-1 text-sm text-ink">referred paid customers</div>
              <div className="mt-1 text-xs text-text-tertiary">using your tracked link · each active for 7 days</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-text-secondary">
            Before qualification, eligible referrals pay <strong className="text-ink">30% of their first payment</strong>. After qualification, Whop applies 50% to future recurring payments from eligible referred customers.
          </p>
        </div>

        {/* Affiliate FAQ + terms PDF */}
        <div className="mb-10 rounded-2xl border border-line bg-paper-warm/60 p-5 sm:p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Affiliate FAQ
          </div>
          <dl className="mt-3 space-y-4 text-sm">
            <div>
              <dt className="font-medium text-ink">When do I earn commission?</dt>
              <dd className="mt-1 text-text-secondary">You can earn 30% of an eligible referral&apos;s first payment while unqualified. Two paid referrals that remain active for 7 days unlock 50% recurring.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Do my first two paid customers earn commission?</dt>
              <dd className="mt-1 text-text-secondary">Yes. Each eligible first payment can earn 30%. Once both referrals clear the 7-day hold, your rate upgrades to 50% recurring.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Do campaign views qualify me?</dt>
              <dd className="mt-1 text-text-secondary">No. Whop-verified campaign views can earn separate Content Reward payouts, but affiliate qualification is based on referred paid customers.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Who pays me?</dt>
              <dd className="mt-1 text-text-secondary">Whop handles affiliate payouts. Complete your payout setup there, including Stripe Connect if Whop prompts for it.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Do free signups count?</dt>
              <dd className="mt-1 text-text-secondary">They can count as tracked referrals, but commission is paid only on successful paid-customer payments after qualification.</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">Do fake views or self-referrals count?</dt>
              <dd className="mt-1 text-text-secondary">No. Bot traffic, invalid traffic, duplicate accounts, self-referrals, refunds, and chargebacks are excluded.</dd>
            </div>
          </dl>
          <a
            href="https://account.liquidclips.app/refer#terms"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            Read affiliate terms &amp; conditions →
          </a>
        </div>

        {/* Product guidance for new affiliates */}
        <div className="mb-10 rounded-2xl border border-line bg-paper-warm/60 p-5 sm:p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Want to use Liquid Clips too?
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            See exactly what your link sells.
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Download the desktop app and see exactly what your audience gets when they follow your link.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="https://liquidclips.app/download"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-fuchsia"
            >
              Download Liquid Clips →
            </a>
            <a
              href="https://liquidclips.app/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-fuchsia hover:underline"
            >
              See what&apos;s new →
            </a>
          </div>
        </div>

        <div className="border-t border-line pt-8">
          <StatTiles
            activeMrrUsd={activeMrrUsd}
            pendingPayoutUsd={pendingPayoutUsd}
            lifetimeEarnedUsd={lifetimeEarnedUsd}
          />
          {affiliate && !isEmpty && (
            <p className="mt-4 text-sm text-text-secondary">
              {activeMembers} active customer{activeMembers === 1 ? "" : "s"} · {totalReferrals} total referral{totalReferrals === 1 ? "" : "s"} ·{" "}
              {affiliate.customer_retention_rate ?? "—"} retention
            </p>
          )}
          {isEmpty && (
            <p className="mt-4 text-sm text-text-secondary">
              No referrals yet. Drop your link in one post — clips, podcasts, tweet threads. Numbers start moving within days.
            </p>
          )}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 font-mono text-xs text-text-tertiary">
          <span className="inline-flex items-center gap-2">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia-bright" />
            {affiliate ? `aff_${affiliate.id.slice(4, 10)}… · ${affiliate.status}` : "syncing…"}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <a className="text-fuchsia hover:underline" href="https://whop.com/liquidclips" target="_blank" rel="noopener noreferrer">
              Join the build community →
            </a>
            <a className="text-fuchsia hover:underline" href="https://whop.com/dashboard" target="_blank" rel="noopener noreferrer">
              Set up Whop payouts / Stripe Connect →
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
