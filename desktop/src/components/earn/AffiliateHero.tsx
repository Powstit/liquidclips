import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Banknote,
  Copy as CopyIcon,
  ExternalLink,
  QrCode as QrCodeIcon,
  RotateCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import {
  meAffiliate,
  UnauthorizedError,
  type AffiliateBlock,
  type AffiliateCustomer,
  type AffiliateMeResponse,
  type PaymentVisibility,
} from "../../lib/backend";
import { Pencil } from "lucide-react";
import { TierAvatar, tierForEarnings, nextTierMilestone } from "../TierAvatar";
import { QrCode } from "../QrCode";
import { InfoHint } from "../InfoHint";
import { Avatar } from "../primitives";
import { useChosenAvatarId } from "../../lib/avatarChoice";
import { AvatarPicker } from "./AvatarPicker";

// AffiliateHero — top-of-Earn referral dashboard (0.4.30).
//
// Renders ONE card whose contents depend on the customer's state. Eleven
// states are covered explicitly, matching the scope agreed before build:
//
//   A. signed-out               — no license JWT in keychain
//   B. JWT rejected (401)       — handled globally by setOnUnauthorized
//                                 (App.tsx flips to needs-activation); we
//                                 fall back to the signed-out card so the
//                                 user never sees a broken state here
//   C. network error            — backend offline / 5xx
//   D. loading                  — first paint, skeleton
//   E. trial / free / can't earn — upgrade-to-Solo+ pitch + flow explainer
//   F. expired / canceled       — reactivation focus
//   G. paid but Whop fetch ✗    — retry + open partner dashboard
//   H. past_due                 — read-only dashboard with payment banner
//                                 (evaluated BEFORE the can-earn branch)
//   I. connected, zero earnings — full dashboard + zero-state copy
//   J. earning                  — full dashboard + qualification sub-state
//
// Stripe-paid customers see a small footnote explaining why Whop is in
// their dashboard (lazy-create-by-email path). Founders/admins get a
// chip and skip qualification.
//
// Cache: 60s in-memory. Mount loads cached value instantly, refetches in
// background. Manual refresh button on every error/fallback card.

type FetchState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: AffiliateMeResponse };

const CACHE_TTL_MS = 60_000;
let _cache: { at: number; data: AffiliateMeResponse } | null = null;

// Cross-component live signal for "Stripe Connect needs the user's attention
// right now" — true when the user is on the stripe_connect rail, has earned
// money, but hasn't finished onboarding. The EarnIconRail Link icon shows a
// fuchsia dot when this is true so the action is reachable from anywhere in
// the app, not only when the Affiliate popover is open.
const attentionListeners = new Set<(needs: boolean) => void>();
let _attention = false;

function setAttention(next: boolean): void {
  if (next === _attention) return;
  _attention = next;
  for (const l of attentionListeners) l(next);
}

function computeAttention(data: AffiliateMeResponse | null): boolean {
  if (!data) return false;
  const earned = Number(data.affiliate.total_referral_earnings_usd) || 0;
  return (
    data.affiliate.payout_provider === "stripe_connect" &&
    data.affiliate.payout_status === "setup_required" &&
    earned > 0
  );
}

export function useAffiliateAttention(): boolean {
  const [needs, setNeeds] = useState(_attention);
  useEffect(() => {
    attentionListeners.add(setNeeds);
    setNeeds(_attention);
    // Best-effort fetch on first mount in case AffiliateHero hasn't been
    // opened yet (the rail dot needs to be honest from first paint).
    if (!_cache) {
      meAffiliate()
        .then((data) => {
          if (data) {
            _cache = { at: Date.now(), data };
            setAttention(computeAttention(data));
          }
        })
        .catch(() => {
          /* signed-out / offline → attention stays false */
        });
    } else {
      setAttention(computeAttention(_cache.data));
    }
    return () => {
      attentionListeners.delete(setNeeds);
    };
  }, []);
  return needs;
}

export function AffiliateHero({ onSignIn }: { onSignIn?: () => void }) {
  const [state, setState] = useState<FetchState>(() =>
    _cache && Date.now() - _cache.at < CACHE_TTL_MS
      ? { kind: "ok", data: _cache.data }
      : { kind: "loading" },
  );

  const load = useCallback(async () => {
    try {
      const data = await meAffiliate();
      if (!data) {
        // web-preview path — no surface for now
        setState({ kind: "error", message: "Not available in web preview." });
        return;
      }
      _cache = { at: Date.now(), data };
      setAttention(computeAttention(data));
      setState({ kind: "ok", data });
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        setState({ kind: "signed-out" });
        setAttention(false);
        return;
      }
      setState({ kind: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Sprint #12 — refresh when the user returns from external onboarding
  // (Stripe Connect or Whop affiliate sign-up). Two paths:
  //  • deep-link callback `liquidclips://payout-return` → dispatches
  //    `junior:payout-updated` (see lib/activation.ts).
  //  • window focus — the bulletproof fallback if the user comes back via
  //    Cmd+Tab without clicking a deep-link.
  // Both are debounced via the cached state — load() is cheap and idempotent.
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("junior:payout-updated", refresh);
    window.addEventListener("junior:whop-auth", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("junior:payout-updated", refresh);
      window.removeEventListener("junior:whop-auth", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  // ── state → card mapping ───────────────────────────────────────────────
  if (state.kind === "loading") return <LoadingCard />;
  if (state.kind === "signed-out") return <SignedOutCard onSignIn={onSignIn} />;
  if (state.kind === "error") return <ErrorCard message={state.message} onRetry={() => void load()} />;

  const { customer, affiliate } = state.data;

  // H — past_due before can_earn so the user gets the dashboard + warning
  // (their earnings exist, they need to fix payment, not upgrade).
  if (customer.subscription_status === "past_due") {
    return <Dashboard customer={customer} affiliate={affiliate} payments={state.data.payments} onRefresh={() => void load()} variant="past-due" />;
  }

  if (!customer.can_earn) {
    const lapsed =
      customer.subscription_status === "expired" ||
      customer.subscription_status === "canceled" ||
      customer.subscription_status === "refunded";
    return lapsed ? <LapsedCard customer={customer} /> : <TrialCard customer={customer} />;
  }

  if (!affiliate.connected) {
    return <WhopFetchFailedCard affiliate={affiliate} onRetry={() => void load()} />;
  }

  return <Dashboard customer={customer} affiliate={affiliate} payments={state.data.payments} onRefresh={() => void load()} variant="live" />;
}

// ── shared shell ────────────────────────────────────────────────────────

function Shell({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "fuchsia";
}) {
  const border =
    tone === "warn"
      ? "border-[#DC2626]/40"
      : tone === "fuchsia"
      ? "border-fuchsia/40 shadow-[var(--glow-sm)]"
      : "border-line";
  return (
    <section className={`rounded-2xl border ${border} bg-paper-warm/30 p-6`}>
      {children}
    </section>
  );
}

function Eyebrow({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
      <Banknote className="h-3.5 w-3.5" strokeWidth={2} />
      {children}
      {hint && <InfoHint text={hint} />}
    </div>
  );
}

// ── A — signed-out ──────────────────────────────────────────────────────

function SignedOutCard({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <Shell>
      <Eyebrow>your referral business</Eyebrow>
      <h2 className="mt-2 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Activate Liquid Clips to see your earnings.
      </h2>
      <p className="mt-1 max-w-[520px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Solo+ subscribers earn 50% recurring on every customer they refer.
        Sign in to view your link, MRR, and lifetime commissions.
      </p>
      {onSignIn && (
        <button
          onClick={onSignIn}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
        >
          Sign in →
        </button>
      )}
    </Shell>
  );
}

// ── C — network error ───────────────────────────────────────────────────

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Shell tone="warn">
      <Eyebrow>your referral business</Eyebrow>
      <h2 className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">
        Couldn&apos;t reach Liquid Clips.
      </h2>
      <p className="mt-1 max-w-[520px] font-sans text-[12px] leading-relaxed text-text-secondary">
        {message}
      </p>
      <button
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
      >
        <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
        Retry
      </button>
    </Shell>
  );
}

// ── D — loading skeleton ────────────────────────────────────────────────

function LoadingCard() {
  return (
    <Shell>
      <Eyebrow>your referral business</Eyebrow>
      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-7 w-32 animate-pulse rounded-md bg-line" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded-md bg-line/60" />
          </div>
        ))}
      </div>
      <div className="mt-5 h-10 w-full animate-pulse rounded-xl bg-line/40" />
    </Shell>
  );
}

// ── E — trial / free / not paid yet ─────────────────────────────────────

function TrialCard({ customer }: { customer: AffiliateCustomer }) {
  const isFree = customer.tier === "free";
  return (
    <Shell>
      <Eyebrow>your referral business</Eyebrow>
      <h2 className="mt-2 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {isFree
          ? "Earn 50% recurring once you're on Solo+."
          : "Your trial unlocks earning when you upgrade."}
      </h2>
      <p className="mt-1 max-w-[560px] font-sans text-[13px] leading-relaxed text-text-secondary">
        {isFree
          ? "Free users keep clipping — paid subscribers earn 50% recurring on every customer they refer."
          : "Solo+ subscribers earn 50% recurring on every customer they refer."}
        {" "}You don&apos;t need to know how it works yet — when you upgrade, your link &amp; dashboard land here automatically.
      </p>
      <ul className="mt-3 flex flex-col gap-1 font-sans text-[13px] text-text-secondary">
        <li className="flex items-start gap-2">
          <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
          2 paid referrals unlock the 50% recurring rate
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
          Payouts via Whop &mdash; we never handle the money
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-fuchsia" />
          Lifetime recurring &mdash; not just first month
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void openExternal("https://account.liquidclips.app/upgrade")}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
        >
          See plans →
        </button>
        <button
          onClick={() => void openExternal("https://liquidclips.app/refer")}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
        >
          How the referral program works ↗
        </button>
      </div>
    </Shell>
  );
}

// ── F — expired / canceled / refunded ───────────────────────────────────

function LapsedCard({ customer: _customer }: { customer: AffiliateCustomer }) {
  return (
    <Shell tone="warn">
      <Eyebrow>your referral business</Eyebrow>
      <h2 className="mt-2 font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] text-ink">
        Your subscription lapsed &mdash; earnings paused.
      </h2>
      <p className="mt-1 max-w-[520px] font-sans text-[13px] leading-relaxed text-text-secondary">
        Past earnings stay safe in your Whop affiliate account. Reactivate to keep earning recurring commissions
        from new referrals.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void openExternal("https://account.liquidclips.app/upgrade")}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
        >
          Reactivate →
        </button>
        <button
          onClick={() => void openExternal("https://partner.liquidclips.app")}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          Open partner dashboard
        </button>
      </div>
    </Shell>
  );
}

// ── G — paid but Whop affiliate fetch failed ────────────────────────────

function WhopFetchFailedCard({
  affiliate,
  onRetry,
}: {
  affiliate: AffiliateBlock;
  onRetry: () => void;
}) {
  const setupUrl = affiliate.payout_setup_url || affiliate.partner_dashboard_url;
  const stripeConnect = affiliate.payout_provider === "stripe_connect";
  return (
    <Shell tone="warn">
      <Eyebrow>your referral business</Eyebrow>
      <h2 className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">
        {stripeConnect ? "Set up payouts with Stripe Connect." : "We couldn&apos;t load your Whop affiliate just now."}
      </h2>
      <p className="mt-1 max-w-[520px] font-sans text-[12px] leading-relaxed text-text-secondary">
        {stripeConnect
          ? "You can promote Liquid Clips without a Whop account. Connect Stripe so commissions have somewhere to land."
          : "Whop&apos;s API didn&apos;t respond, or your affiliate hasn&apos;t been created yet. Both fix themselves quickly — retry, or open your partner dashboard directly."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
          Retry
        </button>
        <button
          onClick={() => void openExternal(setupUrl)}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
        >
          {stripeConnect ? "Set up Stripe Connect" : "Open partner dashboard"}
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </Shell>
  );
}

// ── H + I + J — full dashboard ──────────────────────────────────────────

function Dashboard({
  customer,
  affiliate,
  payments,
  onRefresh,
  variant,
}: {
  customer: AffiliateCustomer;
  affiliate: AffiliateBlock;
  payments?: PaymentVisibility;
  onRefresh: () => void;
  /** "past-due" greys out the live indicators + adds a banner. */
  variant: "live" | "past-due";
}) {
  const pastDue = variant === "past-due";
  const earned = formatMoney(affiliate.total_referral_earnings_usd);
  const earnedUsd = Number(affiliate.total_referral_earnings_usd) || 0;
  const mrr = formatMoney(affiliate.monthly_recurring_revenue_usd);
  const active = affiliate.active_members_count ?? 0;
  const total = affiliate.total_referrals_count ?? 0;
  const isFounder = customer.founder;
  const isAdmin = customer.admin_override;
  const isStripe = customer.billing_provider === "clerk";
  const { avatarId } = useChosenAvatarId();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Founders + admins get a free pass on the unlock ladder so their picker
  // shows everything as available.
  const pickerEarned = isFounder || isAdmin ? Number.POSITIVE_INFINITY : earnedUsd;

  return (
    <Shell tone={pastDue ? "warn" : isFounder || isAdmin ? "fuchsia" : "neutral"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title="Choose your avatar — earn more to unlock more"
            className="group relative rounded-full transition-transform hover:scale-[1.06] focus:outline-none focus-visible:shadow-[var(--glow-sm)]"
          >
            <Avatar
              avatarId={avatarId}
              src={customer.image_url}
              name={customer.name}
              size="sm"
              ring={isFounder || isAdmin}
            />
            {/* Pencil overlay only on hover — signals "this is clickable, not
                just a profile picture." Background opaque so it reads over
                any avatar art behind it. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-ink/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            >
              <Pencil size={11} className="text-white" strokeWidth={2.5} />
            </span>
          </button>
          <Eyebrow hint="Your default referral link and QR. Use campaign links later when you want separate tracking.">
            your referral business
          </Eyebrow>
        </div>
        <div className="flex items-center gap-2">
          {(() => {
            // Sprint #18a — Earner-tier rank emblem. Climbs with lifetime
            // affiliate USD. Hover for the next milestone.
            const t = tierForEarnings(earnedUsd);
            const milestone = nextTierMilestone(earnedUsd);
            const title = milestone
              ? `Tier: ${t}. Next: ${milestone.next} at $${milestone.min_usd}`
              : `Tier: ${t} — top rank`;
            return (
              <span title={title} className="inline-flex items-center">
                <TierAvatar tier={t} size={36} />
              </span>
            );
          })()}
          {(isFounder || isAdmin) && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia bg-fuchsia-soft/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
              <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
              {isAdmin ? "Admin · all unlocked" : "Founder · 50% recurring unlocked"}
            </span>
          )}
          <button
            onClick={onRefresh}
            title="Refresh from Whop"
            className="text-text-tertiary hover:text-ink"
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {pastDue && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/10 px-4 py-3">
          <TriangleAlert className="h-4 w-4 shrink-0 text-[#DC2626]" strokeWidth={2.25} />
          <p className="flex-1 font-sans text-[12px] leading-snug text-text-secondary">
            <span className="text-ink">Payment past due</span> &mdash; earnings paused until your card is fixed.
          </p>
          <button
            onClick={() => void openExternal("https://account.liquidclips.app/billing")}
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-3.5 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Fix payment →
          </button>
        </div>
      )}

      {/* Stripe Connect setup callout — only fires when the user has actually
          earned commission but hasn't finished onboarding. Without earnings the
          banner is noise; with earnings it's the most urgent action on the page. */}
      {!pastDue &&
        affiliate.payout_provider === "stripe_connect" &&
        affiliate.payout_status === "setup_required" &&
        earnedUsd > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-fuchsia bg-fuchsia-soft/40 px-4 py-3 shadow-[var(--glow-sm)]">
          <Banknote className="h-4 w-4 shrink-0 text-fuchsia-deep" strokeWidth={2.25} />
          <p className="flex-1 font-sans text-[12px] leading-snug text-ink">
            <span className="font-medium">{earned} ready</span> &mdash; connect Stripe to receive your affiliate payouts.
          </p>
          <button
            onClick={() =>
              void openExternal(
                affiliate.payout_setup_url || "https://account.liquidclips.app/dashboard#payouts",
              )
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-3.5 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
          >
            Connect Stripe →
          </button>
        </div>
      )}

      {/* 2x2 figures grid. tabular-nums so they don't jitter on refresh. */}
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5">
        <Figure
          label="Earned all-time"
          value={earned}
          muted={pastDue}
          hint="Total commission earned from referred Liquid Clips customers."
        />
        <Figure
          label="Recurring"
          value={`${mrr} / mo`}
          muted={pastDue}
          hint="Monthly recurring revenue from active referred customers."
        />
        <Figure
          label="Active members"
          value={active.toLocaleString()}
          icon={Users}
          muted={pastDue}
          hint="Referred customers currently paying for Liquid Clips."
        />
        <Figure
          label="Total referrals"
          value={total.toLocaleString()}
          icon={Wallet}
          muted={pastDue}
          hint="All referrals Whop has tracked for your affiliate account."
        />
      </div>

      {/* Zero-state pitch — only when truly empty. */}
      {active === 0 && total === 0 && !pastDue && (
        <p className="mt-4 font-sans text-[13px] leading-relaxed text-text-secondary">
          Share your link to start earning &mdash; one paid referral counts toward the unlock.
        </p>
      )}

      {/* Referral link with copy + share. Disabled visually in past-due. */}
      {affiliate.referral_url && (
        <ReferralLinkRow url={affiliate.referral_url} disabled={pastDue} />
      )}

      {/* Qualification — hidden for founders/admins (already qualified). */}
      {!isFounder && !isAdmin && affiliate.qualification && !pastDue && (
        <QualificationRow q={affiliate.qualification} />
      )}

      <PaymentRoutingRow customer={customer} affiliate={affiliate} payments={payments} />

      {/* Sprint #12 polish — when Stripe payouts are live (status=active and
          earnings > 0), show a calm confirmation chip so the user trusts
          money is moving without having to leave the app. */}
      {affiliate.payout_provider === "stripe_connect" &&
        affiliate.payout_status === "ready" &&
        earnedUsd > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-paper-warm/50 px-3 py-1.5 font-sans text-[11px] text-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-fuchsia" aria-hidden />
            Stripe payouts active — commissions land within 7 days of conversion.
          </div>
        )}

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              void openExternal(
                affiliate.payout_provider === "stripe_connect"
                  ? affiliate.payout_setup_url || "https://account.liquidclips.app/dashboard#payouts"
                  : affiliate.partner_dashboard_url,
              )
            }
            className="inline-flex items-center gap-1.5 font-sans text-[12px] font-medium text-text-secondary hover:text-fuchsia-deep"
          >
            {affiliate.payout_provider === "stripe_connect"
              ? "Manage Stripe payouts"
              : "Open Whop partner dashboard"}
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <InfoHint
            text={
              affiliate.payout_provider === "stripe_connect"
                ? "Stripe handles your payout schedule and bank details. You can update either at any time."
                : "Whop hosts referral tracking, payout setup, and partner terms."
            }
          />
        </div>
        {isStripe && affiliate.payout_provider === "whop" && (
          <p className="text-right font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
            Whop powers referral tracking and payouts; your Liquid Clips plan stays on Stripe.
          </p>
        )}
      </div>
      {pickerOpen && (
        <AvatarPicker
          earnedUsd={pickerEarned}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Shell>
  );
}

function PaymentRoutingRow({
  customer,
  affiliate,
  payments,
}: {
  customer: AffiliateCustomer;
  affiliate: AffiliateBlock;
  payments?: PaymentVisibility;
}) {
  const fallback: PaymentVisibility = {
    app_subscription: {
      key: "app_subscription",
      label: "Liquid Clips subscription",
      provider: customer.billing_provider === "whop" ? "Whop" : "Stripe via Clerk",
      status: customer.subscription_status,
      manage_url: customer.billing_provider === "whop" ? "https://whop.com/jnremployee" : "https://account.liquidclips.app/dashboard",
      helper: customer.billing_provider === "whop"
        ? "Whop owns your subscription and card."
        : "Your app plan stays on Stripe via Clerk.",
      in_app: true,
    },
    reward_payouts: {
      key: "reward_payouts",
      label: "Content Reward payouts",
      provider: "Whop",
      status: "offloaded",
      manage_url: "https://whop.com/dashboard/payouts",
      helper: "Whop verifies reward views, approvals, and payouts.",
      in_app: false,
    },
    affiliate_payouts: {
      key: "affiliate_payouts",
      label: "Affiliate commissions",
      provider: affiliate.payout_provider === "stripe_connect" ? "Stripe Connect" : "Whop payouts",
      status: affiliate.payout_status || (affiliate.connected ? "ready" : "setup_required"),
      manage_url: affiliate.payout_setup_url || affiliate.partner_dashboard_url,
      helper: affiliate.payout_provider === "stripe_connect"
        ? "Connect Stripe so Liquid Clips can pay affiliate commissions directly."
        : "Whop tracks referrals and handles payout setup.",
      in_app: false,
    },
  };
  const p = payments ?? fallback;
  const rows = [p.app_subscription, p.reward_payouts, p.affiliate_payouts];

  return (
    <div className="mt-4 grid gap-2 rounded-xl border border-line bg-paper px-3 py-3 sm:grid-cols-3">
      {rows.map((r) => {
        const needsAttention = r.status === "setup_required";
        return (
          <button
            key={r.key}
            onClick={() => void openExternal(r.manage_url)}
            className={`rounded-lg p-2 text-left transition-colors -m-2 ${
              needsAttention
                ? "bg-fuchsia-soft/40 ring-1 ring-fuchsia/40 hover:bg-fuchsia-soft/60"
                : "hover:text-fuchsia-deep"
            }`}
            title={r.helper}
          >
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
              <ProviderBadge provider={r.provider} />
              {r.provider}
            </div>
            <div className="mt-1 font-sans text-[12px] font-medium text-ink">{r.label}</div>
            <div
              className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                needsAttention ? "font-semibold text-fuchsia-deep" : "text-text-tertiary"
              }`}
            >
              {needsAttention
                ? "setup needed →"
                : `${r.in_app ? "manage" : "opens outside"} · ${r.status}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Small monogram badges so the provider eyebrow is scannable as a brand,
// not just a text string. Brand-palette-safe: text colour stays on the
// fuchsia / ink scale; the chip background uses a subdued tint per provider
// for instant differentiation without smuggling new accent colours in.
function ProviderBadge({ provider }: { provider: string }) {
  const p = provider.toLowerCase();
  let letter = "•";
  let tone = "bg-paper-elev text-text-secondary border-line";
  if (p.startsWith("stripe")) {
    letter = "S";
    tone = "bg-[#635BFF]/15 text-[#A29BFF] border-[#635BFF]/30";
  } else if (p.startsWith("whop")) {
    letter = "W";
    tone = "bg-[#FF6B35]/15 text-[#FF9F76] border-[#FF6B35]/30";
  } else if (p.startsWith("clerk")) {
    letter = "C";
    tone = "bg-fuchsia-soft text-fuchsia-deep border-fuchsia/30";
  }
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[8px] font-semibold ${tone}`}
      aria-hidden
    >
      {letter}
    </span>
  );
}

function Figure({
  label,
  value,
  icon: Icon,
  muted,
  hint,
}: {
  label: string;
  value: string;
  icon?: typeof Users;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div
        className={`font-display text-[28px] font-bold leading-none tracking-[-0.025em] tabular-nums ${
          muted ? "text-text-tertiary" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
        {label}
        {hint && <InfoHint text={hint} />}
      </div>
    </div>
  );
}

function ReferralLinkRow({ url, disabled }: { url: string; disabled?: boolean }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className={`mt-5 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
        <input
          readOnly
          value={url}
          onClick={(e) => (e.target as HTMLInputElement).select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink focus:outline-none"
          spellCheck={false}
        />
        <button
          onClick={() => setShowQr((v) => !v)}
          disabled={disabled}
          title={showQr ? "Hide QR code" : "Show QR for this link"}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-sans text-[12px] font-medium transition-colors disabled:opacity-50 ${
            showQr
              ? "border-fuchsia bg-fuchsia-soft/40 text-fuchsia-deep"
              : "border-line bg-paper text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          }`}
        >
          <QrCodeIcon className="h-3.5 w-3.5" strokeWidth={2} />
          {showQr ? "Hide QR" : "QR"}
        </button>
        <InfoHint text="QR scans use the same referral link, so scans and clicks count together." />
        <CopyLinkButton url={url} disabled={disabled} />
      </div>
      {showQr && (
        <div className="mt-3 flex justify-center">
          <QrCode
            value={url}
            size={176}
            caption="Scan to try Liquid Clips"
            downloadName="junior-referral"
          />
        </div>
      )}
    </div>
  );
}

function CopyLinkButton({ url, disabled }: { url: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (disabled) return;
    try {
      await writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* swallow — keyboard fallback always available via input select */
    }
  }
  return (
    <button
      onClick={() => void copy()}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-fuchsia px-3 py-1 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
      title={copied ? "Copied" : "Copy your default Liquid Clips referral link."}
      aria-label="Copy your default Liquid Clips referral link."
    >
      <CopyIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function QualificationRow({ q }: { q: NonNullable<AffiliateBlock["qualification"]> }) {
  const need = q.paid_referrals_needed;
  const have = Math.min(q.paid_referrals_count, need);
  const qualified = q.qualified === true;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: need }).map((_, i) => (
          <span
            key={i}
            className={`inline-block h-3 w-3 rounded-full ${
              i < have ? "bg-fuchsia" : "border border-line bg-transparent"
            }`}
          />
        ))}
      </div>
      <div className="min-w-0 font-mono text-[11px] text-text-secondary">
        {qualified ? (
          <span className="inline-flex items-center gap-1.5 text-fuchsia-deep">
            <Sparkles className="h-3 w-3" strokeWidth={2.5} />
            50% recurring active
          </span>
        ) : (
          <>
            {have} / {need} paid referrals to unlock the 50% recurring rate
          </>
        )}
      </div>
      <InfoHint text="Two paid referrals unlock 50% recurring commission." />
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function formatMoney(usd: string | null): string {
  // Whop returns a string like "1247.00" or null. Coerce to number for
  // tabular formatting; if Whop ever returns a non-numeric (rare), fall
  // back to "$—" rather than crashing the dashboard.
  if (usd == null || usd === "") return "$0";
  const n = Number(usd);
  if (!Number.isFinite(n)) return "$—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n >= 100 ? 0 : 2,
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

// ---------- popover wrapper for the redesigned Earn icon rail ------------
// The rail's Link icon opens the full AffiliateHero inside a centered modal
// instead of taking up vertical space in the main feed. State + caching
// already lives in the component; the wrapper just controls visibility.

export function AffiliateHeroPopover({
  onClose,
  onSignIn,
}: {
  onClose: () => void;
  onSignIn?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[720px] rounded-3xl border border-line bg-paper-elev shadow-[var(--shadow-e3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-paper-warm hover:text-ink"
        >
          ✕
        </button>
        <div className="max-h-[80vh] overflow-y-auto p-4">
          <AffiliateHero onSignIn={onSignIn} />
        </div>
      </div>
    </div>
  );
}
