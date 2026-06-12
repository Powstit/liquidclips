"use client";

// v0.7.55 (Uncle Daniel funnel — Phase 1) — clipper-facing bonus earnings.
//
// Reads GET /bonus-ledger/me with the license JWT (license-bearer auth, not
// Clerk). Whop pays the base $1 RPM directly; this surface tracks the
// +$4 premium bonus due to paid users with no-watermark exports. Closes
// the loop so a paid clipper who submits through Whop can SEE their
// pending bonus accrue here without leaving the Earn page.
//
// States:
//   • no JWT (free user / desktop not opened) → renders an upsell tile.
//   • JWT present + zero rows → empty state with concrete next action.
//   • JWT present + N rows → totals strip ($pending · $paid · count) +
//     a compact list of the 5 most recent rows.
//
// SURFACE: /embed/earn — sits between the SponsoredCarousel and the
//          BountyList so the user reads "here's the rate / here's what
//          I've earned / here are the bounties open right now."

import { useCallback, useEffect, useState } from "react";
import { useEmbedAuth } from "./EmbedAuthBridge";
import { PoweredByWhop } from "./PoweredByWhop";
import { BACKEND_URL } from "@/lib/embed-auth";

type LedgerRow = {
  id: string;
  whop_submission_id: string;
  whop_bounty_id: string | null;
  campaign_id: string | null;
  mission_lane: string | null;
  submitted_post_url: string;
  whop_status: string;
  approved_views: number;
  membership_status_at_export: string;
  export_watermark_status: string;
  base_payout_cents: number;
  premium_bonus_due_cents: number;
  total_effective_payout_cents: number;
  bonus_payout_status: string;
  bonus_marked_paid_at: string | null;
  ledger_created_at: string;
};

type Tier =
  | "free"
  | "solo"
  | "pro"
  | "agency"
  | "growth"
  | "channel"
  | "autopilot"
  | null;

const PREMIUM_TIERS: ReadonlyArray<Exclude<Tier, null>> = [
  "solo",
  "pro",
  "agency",
  "growth",
  "channel",
  "autopilot",
];

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BonusEarnings({ tier }: { tier: Tier }) {
  const { jwt, authStatus } = useEmbedAuth();
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPremium = !!tier && PREMIUM_TIERS.includes(tier as never);

  const fetchRows = useCallback(async () => {
    if (!jwt) return;
    setError(null);
    try {
      const r = await fetch(`${BACKEND_URL}/bonus-ledger/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
        cache: "no-store",
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${text ? ` — ${text}` : ""}`);
      }
      const j = (await r.json()) as { rows?: LedgerRow[] };
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — embed-internal debug surface, mirrors BountyList
    }
  }, [jwt]);

  useEffect(() => {
    if (!jwt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRows();
  }, [jwt, fetchRows]);

  // ── State 0: tier resolution failed (backend unreachable on the
  // server-side /affiliate/me call in page.tsx). v0.7.55 P1-003 — pre-
  // fix this state fell through to skeletons forever OR rendered the
  // "submit through Whop" empty state, both of which lie to the user
  // about their entitlement. Render an honest "couldn't read tier" card
  // so the user knows what's missing without us picking a side.
  if (tier === null) {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="rounded-2xl border border-line bg-paper-elev/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            tier resolution paused
          </p>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-text-secondary">
            Couldn&apos;t read your Liquid Clips tier. Reopen Earn from the
            desktop sidebar — when your tier resolves the bonus ledger
            renders here.
          </p>
        </div>
      </section>
    );
  }

  // ── State 1: free user without an active LC membership.
  // Render an honest preview tile instead of pretending the ledger exists
  // for them. The bonus rail is the paid-tier carrot, so this is the
  // moment to make the upgrade tangible.
  if (tier && !isPremium) {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="flex flex-col gap-3 rounded-3xl border border-line bg-paper-elev/40 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-[480px] flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
              upgrade unlocks
            </p>
            <p className="font-display text-[18px] font-semibold leading-snug tracking-[-0.015em] text-ink">
              +$4 RPM bonus on every approved Whop submission. Watermark-free
              exports. 50% MRR on referrals.
            </p>
            <p className="font-sans text-[12px] leading-relaxed text-text-secondary">
              Whop pays the base $1 RPM today. Liquid Clips pays your +$4 bonus
              when you upgrade and submit clean exports.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                window.parent.postMessage(
                  { type: "lc:open-auth", panel: "upgrade" },
                  "*",
                );
              } catch {
                /* not in an iframe — no-op */
              }
            }}
            className="shrink-0 rounded-full bg-fuchsia px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
          >
            Upgrade to Liquid Clips →
          </button>
        </div>
      </section>
    );
  }

  // ── State 2: premium user but desktop bridge hasn't shipped the JWT yet.
  if (!jwt && authStatus === "stalled") {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="rounded-2xl border border-[#EAB308]/40 bg-[#EAB308]/10 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A87A00]">
            bonus ledger paused
          </p>
          <p className="mt-1 font-sans text-[13px] text-text-secondary">
            Couldn&apos;t reach the desktop to pull your ledger. Reopen Earn from
            the Liquid Clips sidebar, or retry.
          </p>
        </div>
      </section>
    );
  }
  if (!jwt) {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[88px] animate-pulse rounded-2xl border border-line bg-paper-elev/40"
            />
          ))}
        </div>
      </section>
    );
  }

  // ── State 3: error.
  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="rounded-2xl border border-[#DC2626]/40 bg-[#DC2626]/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#F87171]">
            couldn&apos;t load bonus ledger
          </p>
          <pre className="mt-2 max-h-[120px] overflow-auto rounded-md border border-line bg-paper-warm/40 p-2.5 font-mono text-[11px] text-text-secondary">
            {error}
          </pre>
          <button
            type="button"
            onClick={() => void fetchRows()}
            className="mt-3 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  // ── State 4: empty.
  const list = rows ?? [];
  if (list.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <Heading subline="paid clippers track their +$4 RPM bonus here" />
        <div className="rounded-3xl border border-dashed border-line bg-paper-elev/30 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            no bonus rows yet
          </p>
          <p className="mt-1 font-sans text-[13px] leading-relaxed text-ink-soft">
            Submit a clip through Whop. When it&apos;s approved we mirror it
            here and start tracking your +$4 RPM bonus.
          </p>
        </div>
      </section>
    );
  }

  // ── State 5: populated.
  const totals = list.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.views += r.approved_views;
      acc.base += r.base_payout_cents;
      acc.bonus += r.premium_bonus_due_cents;
      if (r.bonus_payout_status === "paid") acc.bonusPaid += r.premium_bonus_due_cents;
      else acc.bonusPending += r.premium_bonus_due_cents;
      return acc;
    },
    { count: 0, views: 0, base: 0, bonus: 0, bonusPaid: 0, bonusPending: 0 },
  );

  const recent = list.slice(0, 5);

  return (
    <section className="flex flex-col gap-4">
      <Heading subline={`${totals.count} approved · ${totals.views.toLocaleString()} views tracked`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bonus pending" value={dollars(totals.bonusPending)} tone="fuchsia" />
        <Stat label="Bonus paid" value={dollars(totals.bonusPaid)} tone="ink" />
        <Stat
          label={
            <span className="inline-flex items-center gap-1.5">
              Whop base
              <PoweredByWhop size="xs" />
            </span>
          }
          value={dollars(totals.base)}
          tone="soft"
        />
        <Stat label="Total effective" value={dollars(totals.base + totals.bonus)} tone="ink" />
      </div>
      <ul className="flex flex-col gap-2">
        {recent.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-2xl border border-line bg-paper-elev/30 px-4 py-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-sans text-[13px] text-ink">
                <a
                  href={r.submitted_post_url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-fuchsia hover:underline"
                >
                  {r.submitted_post_url}
                </a>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {r.mission_lane ?? "lane —"} · {r.approved_views.toLocaleString()} views · whop {r.whop_status}
              </span>
            </div>
            <div className="flex items-center gap-3 md:gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                base
              </span>
              <span className="font-display text-[14px] font-semibold tabular-nums text-ink-soft">
                {dollars(r.base_payout_cents)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
                bonus
              </span>
              <span className="font-display text-[14px] font-semibold tabular-nums text-fuchsia">
                {dollars(r.premium_bonus_due_cents)}
              </span>
              <BonusStatusPill status={r.bonus_payout_status} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading({ subline }: { subline: string }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
        <CoinsIcon />
        your bonus ledger
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        {subline}
      </span>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  tone: "fuchsia" | "ink" | "soft";
}) {
  const color =
    tone === "fuchsia"
      ? "text-fuchsia"
      : tone === "soft"
        ? "text-ink-soft"
        : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-paper-elev/40 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </p>
      <p className={`mt-1 font-display text-[22px] font-semibold tabular-nums ${color}`}>
        {value}
      </p>
    </div>
  );
}

function BonusStatusPill({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? "border-fuchsia/60 bg-[#16A34A]/10 text-[#16A34A]"
      : status === "waived"
        ? "border-line bg-paper-elev text-text-tertiary"
        : "border-fuchsia/40 bg-fuchsia-soft/30 text-fuchsia-deep";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${tone}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  );
}

function CoinsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  );
}
