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

// Brand-first referral URL: lands visitor on jnremployee.com, where a small
// ref-capture script (see /tmp/jnr-deploy/ref-capture.js on the marketing site)
// stores the affiliate id in a cookie and appends ?a=<id> to every whop.com
// link on the page. Attribution survives the brand-first funnel.
function buildReferralUrl(affiliateId: string, marketingHost = "jnremployee.com"): string {
  return `https://${marketingHost}/?ref=${affiliateId}`;
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
              <a href="https://jnremployee.com/affiliates" className="rounded-full border border-line bg-paper px-5 py-3 text-sm font-medium text-ink hover:border-fuchsia">
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

  const referralUrl = affiliate ? buildReferralUrl(affiliate.id) : "";
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
      <Nav username={session.username ?? session.name} />

      <main className="mx-auto max-w-[820px] px-5 py-10 sm:py-14">
        <header className="mb-8">
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Welcome, {greetingName}.
          </h1>
          <p className="mt-2 text-text-secondary sm:text-lg">
            Your referral link is ready. Earn <strong className="text-ink">50% of referred customers&rsquo; payments</strong> while they stay paid and you keep an active Junior subscription.
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-text-tertiary">
            Solo or up qualifies. Commissions pause if your subscription lapses and resume when you reactivate. Paid only on referred customers&rsquo; successful payments; already-paid commissions are never clawed back except for fraud or abuse.
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

        {/* Use Junior — guidance for new affiliates */}
        <div className="mb-10 rounded-2xl border border-line bg-paper-warm/60 p-5 sm:p-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Want to use Junior too?
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            See exactly what your link sells.
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Junior v1.0 desktop app ships in 10 weeks. Until then, try the live demo and see your audience exactly what they&apos;ll get.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
              href="https://app.jnremployee.com"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper hover:bg-fuchsia"
            >
              Open the live demo →
            </a>
            <a
              href="https://jnremployee.com/changelog"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-fuchsia hover:underline"
            >
              v1.0 build progress →
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
            <a className="text-fuchsia hover:underline" href="https://whop.com/jnremployee/forums-83fovyATgXDQpO/app/" target="_blank" rel="noopener noreferrer">
              Join the build community →
            </a>
            <a className="text-fuchsia hover:underline" href="https://whop.com/dashboard" target="_blank" rel="noopener noreferrer">
              Set up payouts →
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
