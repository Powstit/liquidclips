// PayoutsView — Earn sub-tab "Payouts" body.
//
// Mirrors the inner JSX of components/payouts/PayoutsTab.tsx so the Earn
// rail can host the surface directly. Same data fetching + business logic
// as PayoutsTab — only the wrapper changes (no page-level shell needed
// because EarnLayout already supplies it).

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Wallet } from "lucide-react";
import { Card, Pill } from "../primitives";
import {
  meAffiliate,
  UnauthorizedError,
  type AffiliateMeResponse,
} from "../../lib/backend";
import { useBriefs } from "../../lib/briefs";
import { useSubmissions } from "../../lib/submissions";
import {
  earnedByCampaign,
  fmtDate,
  fmtUsd,
  paidThisMonth,
  recentPayoutsFromTracker,
  trackerTotals,
} from "../../lib/payoutsAggregations";
import { useCountUp } from "../../lib/useCountUp";
import { MoneySourceCard } from "../payouts/MoneySourceCard";

// Cache for affiliate data shared with AffiliateHero (same module-level
// pattern). 60s TTL keeps the network quiet without going stale.
const CACHE_TTL_MS = 60_000;
let _cache: { at: number; data: AffiliateMeResponse } | null = null;

function useAffiliateMe(): {
  data: AffiliateMeResponse | null;
  loading: boolean;
  signedOut: boolean;
} {
  const fresh = _cache && Date.now() - _cache.at < CACHE_TTL_MS;
  const [data, setData] = useState<AffiliateMeResponse | null>(fresh ? _cache!.data : null);
  const [loading, setLoading] = useState(!fresh);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await meAffiliate();
        if (cancelled) return;
        if (r) {
          _cache = { at: Date.now(), data: r };
          setData(r);
        }
      } catch (e) {
        if (e instanceof UnauthorizedError) setSignedOut(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, signedOut };
}

export function PayoutsView() {
  const { submissions } = useSubmissions();
  const { briefs } = useBriefs();
  const { data: affiliate, loading: affiliateLoading, signedOut } = useAffiliateMe();

  const totals = trackerTotals(submissions);
  const monthPaid = paidThisMonth(submissions);
  const campaigns = earnedByCampaign(submissions, briefs).slice(0, 5);
  const recents = recentPayoutsFromTracker(submissions, briefs, 8);

  const affiliateEarned = Number(affiliate?.affiliate.total_referral_earnings_usd) || 0;
  const totalPaidAll = totals.paid_usd + affiliateEarned;

  // Hero tile counts up on every change so newly-marked-paid clips
  // immediately feel like a payday, not a silent number flip.
  const paidThisMonthDisplay = useCountUp(monthPaid, { decimals: 2, prefix: "$" });
  const pendingDisplay = useCountUp(totals.pending_usd, { decimals: 2, prefix: "$" });
  const totalDisplay = useCountUp(totalPaidAll, { decimals: 2, prefix: "$" });

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          <Wallet size={12} strokeWidth={2} />
          payouts
        </div>
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Your money, one place.
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          whop pays for content rewards · liquid clips pays for affiliate signups
        </p>
      </header>

      {/* Hero stats — paid this month + pending + paid all-time */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="paid this month" value={paidThisMonthDisplay} tone="success" />
        <StatTile
          label="pending review"
          value={pendingDisplay}
          tone="fuchsia"
          subtitle={
            totals.pending_count > 0
              ? `${totals.pending_count} clip${totals.pending_count === 1 ? "" : "s"} awaiting whop review`
              : "nothing in flight"
          }
        />
        <StatTile label="paid all-time" value={totalDisplay} subtitle="whop + stripe" />
      </div>

      {/* Money sources — keep Whop branded loud */}
      <section className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          money sources
        </span>
        {signedOut ? (
          <Card padding="md" className="border-dashed">
            <p className="font-sans text-[13px] text-ink">
              Sign in to see your payout sources.
            </p>
          </Card>
        ) : affiliateLoading && !affiliate ? (
          <Card padding="md" className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-text-tertiary" />
            <span className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              loading
            </span>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MoneySourceCard
              source="whop"
              paidAllTime={totals.paid_usd}
              pending={totals.pending_usd}
              status="ready"
              manageUrl="https://whop.com/dashboard/payouts"
            />
            <MoneySourceCard
              source="stripe_connect"
              paidAllTime={affiliateEarned}
              pending={0}
              status={
                affiliate?.affiliate.payout_status === "ready" ? "ready" : "setup_required"
              }
              manageUrl={
                affiliate?.affiliate.partner_dashboard_url ||
                "https://partner.jnremployee.com"
              }
              setupUrl={
                affiliate?.affiliate.payout_setup_url ||
                "https://account.jnremployee.com/dashboard#payouts"
              }
            />
          </div>
        )}
      </section>

      {/* Per-campaign breakdown — closes the money loop visually */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            earned per campaign
          </span>
          {campaigns.length > 5 && (
            <Pill tone="neutral">+{campaigns.length - 5} more</Pill>
          )}
        </div>
        {campaigns.length === 0 ? (
          <Card padding="md" className="border-dashed">
            <p className="font-sans text-[13px] text-ink">No campaign earnings yet.</p>
            <p className="mt-1 font-sans text-[12px] text-text-secondary">
              Save a campaign on the Earn tab, log a post in Your Clips, mark it{" "}
              <span className="font-mono text-fuchsia-deep">paid</span> — and it
              shows here.
            </p>
          </Card>
        ) : (
          <Card padding="none" elevation="rest" className="overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_100px_80px] gap-3 border-b border-line bg-paper-elev/60 px-4 py-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              <span>campaign</span>
              <span className="text-right">clips</span>
              <span className="text-right">paid</span>
              <span className="text-right">pending</span>
            </div>
            {campaigns.map((c) => (
              <div
                key={c.brief_id ?? "__unattached__"}
                className="grid grid-cols-[1fr_80px_100px_80px] items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] last:border-b-0"
              >
                <span className="truncate font-sans text-ink">{c.brief_title}</span>
                <span className="text-right font-mono text-[11px] text-text-secondary">
                  {c.clip_count}
                </span>
                <span className="text-right font-mono text-[11px] font-medium text-[#34D399]">
                  {c.paid_usd > 0 ? fmtUsd(c.paid_usd) : "—"}
                </span>
                <span className="text-right font-mono text-[11px] text-fuchsia-deep">
                  {c.pending_usd > 0 ? fmtUsd(c.pending_usd) : "—"}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Recent payouts feed */}
      <section className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          recent payouts
        </span>
        {recents.length === 0 ? (
          <Card padding="md" className="border-dashed">
            <p className="font-sans text-[13px] text-text-secondary">
              No paid clips logged yet. Mark a tracked submission as{" "}
              <span className="font-mono text-fuchsia-deep">paid</span> and it lands here.
            </p>
          </Card>
        ) : (
          <Card padding="none" elevation="rest" className="overflow-hidden">
            {recents.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[60px_1fr_90px_80px] items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] last:border-b-0"
              >
                <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                  {fmtDate(r.at)}
                </span>
                <span className="truncate font-sans text-ink">{r.description}</span>
                <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
                  {r.source_label}
                </span>
                <span className="text-right font-mono text-[11px] font-medium text-[#34D399]">
                  {fmtUsd(r.amount_usd)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Explainer — tells first-timers where each $ comes from */}
      <section className="rounded-2xl border border-line bg-paper-elev/40 p-4">
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          how each source works
        </span>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="font-sans text-[13px] font-medium text-ink">
              Whop reward campaigns
            </span>
            <p className="font-sans text-[12px] leading-snug text-text-secondary">
              Whop pays you direct when your clips hit view targets they approve.
              Setup is automatic on the Whop side — your Whop account receives
              payouts on their schedule.{" "}
              <button
                type="button"
                onClick={() => void import("@tauri-apps/plugin-shell").then((m) => m.open("https://whop.com/dashboard/payouts"))}
                className="inline-flex items-center gap-1 text-fuchsia-deep hover:text-fuchsia"
              >
                Open Whop payouts <ExternalLink size={10} strokeWidth={2.25} />
              </button>
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-sans text-[13px] font-medium text-ink">
              Liquid Clips affiliate
            </span>
            <p className="font-sans text-[12px] leading-snug text-text-secondary">
              We pay 50% recurring on every customer you refer. Liquid Clips routes
              affiliate commissions through Stripe Connect — connect Stripe once and
              payouts arrive on Stripe's schedule.{" "}
              <button
                type="button"
                onClick={() =>
                  void import("@tauri-apps/plugin-shell").then((m) =>
                    m.open(
                      affiliate?.affiliate.payout_setup_url ||
                        "https://account.jnremployee.com/dashboard#payouts",
                    ),
                  )
                }
                className="inline-flex items-center gap-1 text-fuchsia-deep hover:text-fuchsia"
              >
                Manage Stripe Connect <ExternalLink size={10} strokeWidth={2.25} />
              </button>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "success" | "fuchsia";
}) {
  const valueColor =
    tone === "success"
      ? "text-[#34D399]"
      : tone === "fuchsia"
        ? "text-fuchsia-deep"
        : "text-ink";
  return (
    <Card padding="md" elevation="rest" className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
      </span>
      <span className={`font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] ${valueColor}`}>
        {value}
      </span>
      {subtitle && (
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          {subtitle}
        </span>
      )}
    </Card>
  );
}
