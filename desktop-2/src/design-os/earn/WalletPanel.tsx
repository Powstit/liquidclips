/**
 * WalletPanel · 2026-06-24 · the clipper-facing wallet surface for the
 * Liquid Clips desktop cockpit Earn tab.
 *
 * Replaces the "Withdraw $X" silent-success risk with an HONEST pipeline
 * money breakdown. Four hero stat cards (In Review · Approved · Paid ·
 * Rejected), a hero pipeline total, an approval-rate badge, a
 * per-campaign drill-in table, a last-10 activity feed, and an
 * env-gated withdraw block. When CARROT_WHOP_LIVE=false on the backend
 * the withdraw button is hidden by code — same component, env flip
 * shows it.
 *
 * Honest copy rules (Daniel-locked):
 *   - "Paid" only counts money that ACTUALLY moved (real Whop transfers
 *      land on User.carrot_total_paid_usd_cents · plus
 *      submission.status == "paid").
 *   - When withdraw is hidden, the panel says so plainly:
 *     "Withdrawals open once Liquid Clips finishes Whop wallet
 *      integration. Your earnings are tracked and safe."
 *   - Approval-rate badge celebrates >75%, stays neutral 50-75%, soft
 *     encouragement <50% — never adversarial.
 *   - "Beta" pill in the header tells the clipper this surface is
 *      pre-launch wallet UX · NOT a promise of withdrawal availability.
 *
 * Data: single `GET /me/wallet/summary` round-trip via wallet.ts.
 * Fallback: when the call returns null (offline / 401 / 5xx) the panel
 * renders the brand-aligned skeleton briefly then degrades to the empty
 * state · NEVER shows fake numbers.
 *
 * ⚠ IRON GATE IG-SOV-2.2-001 mirrors carrot economics · don't fork the
 * fee math here · always source from withdraw block (which the backend
 * resolves from whop_payments.py constants).
 */

import { useCallback, useEffect, useState } from "react";
import { bus } from "../bridge";
import { claimCarrot, getPayoutsPortal, onboardCarrot } from "../../lib/carrot";
import { openSmart } from "../../lib/openSmart";
import {
  fmtUsdCents,
  fmtViews,
  getWalletSummary,
  type WalletSummary,
} from "../../lib/wallet";
import { WalletStatCard } from "./WalletStatCard";
import { WalletCampaignTable } from "./WalletCampaignTable";
import { WalletActivityFeed } from "./WalletActivityFeed";
import { WalletEmptyState } from "./WalletEmptyState";
import { WalletLoadingSkeleton } from "./WalletLoadingSkeleton";
import "./WalletPanel.css";

const NEW_BADGE_STORAGE_KEY = "lc.wallet.first_seen_at.v1";
const NEW_BADGE_TTL_MS = 14 * 24 * 60 * 60 * 1_000; // 14 days

/** Tone bucket for the approval-rate pill. */
function approvalTone(pct: number): "high" | "mid" | "low" {
  if (pct >= 75) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

function approvalCopy(pct: number, decisions: number): string {
  if (decisions === 0) return "No decisions yet";
  if (pct >= 75) return `Approval rate · ${pct}% · strong work`;
  if (pct >= 50) return `Approval rate · ${pct}%`;
  return `Approval rate · ${pct}% · keep refining`;
}

/** Read or seed the NEW-badge first-seen timestamp from localStorage.
 *  Returns true if the badge should still render (within 14d). Safe in
 *  SSR / no-window environments — returns true so the badge renders
 *  during the brief preview-only run. */
function useNewBadgeVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = window.localStorage.getItem(NEW_BADGE_STORAGE_KEY);
      let seenAt: number;
      if (raw) {
        const parsed = Number(raw);
        seenAt = Number.isFinite(parsed) ? parsed : Date.now();
      } else {
        seenAt = Date.now();
        window.localStorage.setItem(NEW_BADGE_STORAGE_KEY, String(seenAt));
      }
      setVisible(Date.now() - seenAt < NEW_BADGE_TTL_MS);
    } catch { /* localStorage blocked · keep badge visible */ }
  }, []);
  return visible;
}

export function WalletPanel() {
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [withdrawing, setWithdrawing] = useState<boolean>(false);
  const showNewBadge = useNewBadgeVisible();

  const load = useCallback(async (kind: "initial" | "refresh") => {
    if (kind === "initial") setLoading(true);
    else setRefreshing(true);
    const s = await getWalletSummary();
    setSummary(s);
    if (kind === "initial") setLoading(false);
    else setRefreshing(false);
  }, []);

  useEffect(() => {
    void load("initial");
  }, [load]);

  const onRefresh = useCallback(() => {
    if (refreshing) return;
    bus.emit("toast", {
      kind: "info",
      title: "Refreshing wallet",
      body: "Checking your latest reward and payout activity.",
    });
    void load("refresh");
  }, [refreshing, load]);

  const onBrowseCampaigns = useCallback(() => {
    bus.emit("nav:click", { route: "campaigns" });
  }, []);

  const onWithdraw = useCallback(async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await claimCarrot();
      if (!("transfer_id" in res)) {
        bus.emit("toast", {
          kind: "warning",
          title: "Withdrawal failed",
          body: res.error,
        });
        return;
      }
      bus.emit("toast", {
        kind: "success",
        title: "Reward moved to Whop",
        body: `$${res.net_usd.toFixed(2)} ${res.currency.toUpperCase()} credited to your Whop balance · Liquid Clips fee $${res.fee_usd.toFixed(2)}`,
      });
      await load("refresh");
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawing, load]);

  const onSetupPayouts = useCallback(async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await onboardCarrot();
      if (!("onboarding_url" in res)) {
        bus.emit("toast", { kind: "warning", title: "Couldn't open Whop setup", body: res.error });
        return;
      }
      await openSmart(res.onboarding_url);
    } catch (err) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop setup",
        body: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawing]);

  const onOpenPayouts = useCallback(async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await getPayoutsPortal();
      if (!("url" in res)) {
        bus.emit("toast", { kind: "warning", title: "Couldn't open Whop payouts", body: res.error });
        return;
      }
      await openSmart(res.url);
    } catch (err) {
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't open Whop payouts",
        body: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawing]);

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="lc-wallet-shell" data-testid="wallet-panel" data-state="loading">
        <WalletLoadingSkeleton />
      </section>
    );
  }

  // ─── Network error · backend unreachable ─────────────────────────────
  if (!summary) {
    return (
      <section className="lc-wallet-shell" data-testid="wallet-panel" data-state="offline">
        <div className="lc-wallet">
          <WalletPanelHeader
            showNewBadge={showNewBadge}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
          <div className="lc-wallet-empty" data-testid="wallet-offline-state">
            <img
              className="lc-wallet-empty-art"
              src="/brand/reward/chest-reward.webp"
              alt=""
              aria-hidden="true"
            />
            <div>
              <h3 className="lc-wallet-empty-title">Wallet is briefly out of reach</h3>
              <p className="lc-wallet-empty-sub">
                We couldn't reach the wallet service right now. Your earnings
                are tracked and safe — try the refresh button above in a
                moment.
              </p>
            </div>
            <button
              type="button"
              className="lc-wallet-empty-cta"
              data-testid="wallet-offline-retry"
              onClick={onRefresh}
            >
              Try again ↻
            </button>
          </div>
        </div>
      </section>
    );
  }

  const { pipeline, stats, campaigns, recent_activity, withdraw } = summary;
  const isEmpty = stats.total_submissions === 0 && pipeline.paid_usd_cents === 0;

  // ─── Loaded state ────────────────────────────────────────────────────
  const decisions =
    // Re-derive on the wire for display copy · matches backend math.
    Math.round((stats.approval_rate_pct / 100) * stats.total_submissions);
  void decisions;

  const approvedUsd = pipeline.approved_usd_cents / 100;
  const meetsMin = approvedUsd >= withdraw.min_withdrawal_usd;
  const grossUsd = approvedUsd;
  const feeUsd = grossUsd * (withdraw.lc_fee_pct / 100);
  const netUsd = grossUsd - feeUsd;

  return (
    <section className="lc-wallet-shell" data-testid="wallet-panel" data-state={isEmpty ? "empty" : "loaded"}>
      <div className="lc-wallet">
        <WalletPanelHeader
          showNewBadge={showNewBadge}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />

        {/* Real Whop ledger balance. Liquid Clips owns presentation; Whop
            owns KYC, payout methods, and withdrawal execution. */}
        <div className="lc-wallet-balance-hero" data-testid="wallet-hero">
          <div className="lc-wallet-balance-content">
            <div className="lc-wallet-balance-status">
              <span className="lc-wallet-balance-provider">Whop balance</span>
              <span className="lc-wallet-balance-state" data-ready={String(withdraw.payout_ready)}>
                {withdraw.payout_ready ? "Connected" : "Not connected"}
              </span>
            </div>
            <span className="lc-wallet-balance-label">Available</span>
            <span className="lc-wallet-balance-amount" data-testid="wallet-hero-amount">
              {fmtUsdCents(withdraw.available_usd_cents)}
            </span>
            <div className="lc-wallet-balance-breakdown">
              <span>Pending <b>{fmtUsdCents(withdraw.pending_usd_cents)}</b></span>
              <span>Reserve <b>{fmtUsdCents(withdraw.reserve_usd_cents)}</b></span>
              <span>Pipeline <b>{fmtUsdCents(pipeline.total_pipeline_usd_cents)}</b></span>
            </div>
            <div className="lc-wallet-balance-actions">
              {!withdraw.payout_ready ? (
                <button
                  type="button"
                  className="lc-wallet-primary-action"
                  onClick={onSetupPayouts}
                  disabled={!withdraw.setup_available || withdrawing}
                >
                  {withdraw.setup_available ? "Create wallet" : "Wallet setup coming soon"}
                </button>
              ) : (
                <button
                  type="button"
                  className="lc-wallet-primary-action"
                  onClick={onOpenPayouts}
                  disabled={!withdraw.setup_available || withdrawing}
                >
                  Manage payouts on Whop ↗
                </button>
              )}
              <span className="lc-wallet-powered">Secure payouts powered by Whop</span>
            </div>
          </div>
          <img
            className="lc-wallet-balance-art"
            src="/brand/reward/coin-stack.webp"
            alt=""
            aria-hidden="true"
          />
        </div>

        <div className="lc-wallet-section-h lc-wallet-pipeline-head">
          <div>
            <h3 className="lc-wallet-section-h-title">Earnings pipeline</h3>
            <span className="lc-wallet-section-h-sub">
              Submission to payout, without mystery
            </span>
          </div>
          <div className="lc-wallet-pipeline-meta">
            <span>{fmtViews(stats.lifetime_views)} lifetime views</span>
            {stats.total_submissions > 0 && (
              <span
                className="lc-wallet-hero-approval"
                data-tone={approvalTone(stats.approval_rate_pct)}
                data-testid="wallet-approval-rate"
              >
                {approvalCopy(stats.approval_rate_pct, stats.total_submissions)}
              </span>
            )}
          </div>
        </div>

        {/* Four hero stat cards */}
        <div className="lc-wallet-stats" data-testid="wallet-stats-grid">
          <WalletStatCard
            tone="in-review"
            iconSrc="/brand/reward/stamp-needs-changes.svg"
            label="In Review"
            value={fmtUsdCents(pipeline.in_review_usd_cents)}
            footer="Awaiting campaign owner"
          />
          <WalletStatCard
            tone="approved"
            iconSrc="/brand/reward/stamp-approved.svg"
            label="Approved · Awaiting Payout"
            value={fmtUsdCents(pipeline.approved_usd_cents)}
            footer="Cleared to withdraw"
          />
          <WalletStatCard
            tone="paid"
            iconSrc="/brand/reward/stamp-payout.svg"
            label="Paid"
            value={fmtUsdCents(pipeline.paid_usd_cents)}
            footer="Money that moved"
          />
          <WalletStatCard
            tone="rejected"
            iconSrc="/brand/reward/stamp-rejected.svg"
            label="Rejected"
            value={fmtUsdCents(pipeline.rejected_usd_cents)}
            footer="Try a different angle"
          />
        </div>

        {/* Approved Liquid Clips rewards are credited to the connected Whop
            balance. Actual withdrawal remains inside Whop. */}
        {pipeline.approved_usd_cents > 0 && (withdraw.is_live ? (
          <div
            className="lc-wallet-withdraw is-live"
            data-testid="wallet-withdraw-live"
          >
            <div className="lc-wallet-withdraw-l">
              <span className="lc-wallet-withdraw-eb">
                Credit approved reward
              </span>
              <div className="lc-wallet-withdraw-breakdown">
                <span>Gross <b>${grossUsd.toFixed(2)}</b></span>
                <span>LC fee {withdraw.lc_fee_pct}% <b>−${feeUsd.toFixed(2)}</b></span>
                <span>Net <b>${netUsd.toFixed(2)} {withdraw.currency.toUpperCase()}</b></span>
                {withdraw.destination_wallet && (
                  <span>To <b>{withdraw.destination_wallet}</b></span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="lc-wallet-withdraw-cta"
              data-testid="wallet-withdraw-cta"
              onClick={
                !withdraw.payout_ready
                  ? onSetupPayouts
                  : onWithdraw
              }
              disabled={!withdraw.payout_ready || !meetsMin || withdrawing}
              title={
                !withdraw.payout_ready
                  ? "Complete identity and payout setup on Whop"
                  : meetsMin
                    ? `Credit ${fmtUsdCents(pipeline.approved_usd_cents)} to Whop`
                    : `$${withdraw.min_withdrawal_usd.toFixed(2)} minimum · keep clipping`
              }
            >
              {!withdraw.payout_ready
                ? "Set up payouts on Whop ↗"
                : meetsMin
                  ? `Claim earnings · ${fmtUsdCents(pipeline.approved_usd_cents)}`
                  : `$${withdraw.min_withdrawal_usd.toFixed(2)} minimum`}
            </button>
          </div>
        ) : (
          <div className="lc-wallet-withdraw" data-testid="wallet-withdraw-deferred">
            <div className="lc-wallet-withdraw-l">
              <span className="lc-wallet-withdraw-eb">Withdrawals · coming soon</span>
              <p className="lc-wallet-withdraw-line">
                This approved reward stays attributed to you. Balance credits
                open after the controlled Whop payout test passes.
              </p>
            </div>
          </div>
        ))}

        {isEmpty && <WalletEmptyState onBrowseCampaigns={onBrowseCampaigns} />}

        {/* Per-campaign drill-in table */}
        {campaigns.length > 0 && (
          <div className="lc-wallet-section">
            <div className="lc-wallet-section-h">
              <div>
                <h3 className="lc-wallet-section-h-title">Your campaign earnings</h3>
                <span className="lc-wallet-section-h-sub">
                  Liquid Clips submissions · Whop-linked rewards pay through Whop
                </span>
              </div>
              <span className="lc-wallet-section-h-sub">
                {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
              </span>
            </div>
            <WalletCampaignTable rows={campaigns} />
          </div>
        )}

        {/* Recent activity feed */}
        {recent_activity.length > 0 && (
          <div className="lc-wallet-section">
            <div className="lc-wallet-section-h">
              <h3 className="lc-wallet-section-h-title">Recent activity</h3>
              <span className="lc-wallet-section-h-sub">
                last {recent_activity.length}
              </span>
            </div>
            <WalletActivityFeed rows={recent_activity} />
          </div>
        )}

        <div className="lc-wallet-foot">
          {withdraw.is_live
            ? `Live Whop rail · ${withdraw.currency.toUpperCase()} balance credits`
            : "Honest pipeline · withdrawals gated until Whop integration ships"}
        </div>
      </div>
    </section>
  );
}

/* ──────── Header (extracted so the three render branches share it) ──── */

function WalletPanelHeader({
  showNewBadge,
  onRefresh,
  refreshing,
}: {
  showNewBadge: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="lc-wallet-head">
      <div className="lc-wallet-head-l">
          <span className="lc-wallet-eb">
            {showNewBadge && (
              <span className="lc-wallet-eb-new" data-testid="wallet-new-badge">New</span>
            )}
          Wallet · powered by Whop
        </span>
        <h2 className="lc-wallet-title">Your money, in one place</h2>
        <p className="lc-wallet-sub">
          Track campaign rewards, Liquid Clips bonuses, and money available on Whop.
        </p>
      </div>
      <div className="lc-wallet-head-r">
        <button
          type="button"
          className={`lc-wallet-refresh ${refreshing ? "is-spinning" : ""}`}
          data-testid="wallet-refresh"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh wallet"
        >
          <span className="lc-wallet-refresh-icon" aria-hidden="true">↻</span>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}
