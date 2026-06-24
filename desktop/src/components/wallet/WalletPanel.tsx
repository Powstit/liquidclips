/**
 * WalletPanel · 2026-06-25 · the clipper-facing wallet surface for the
 * Liquid Clips desktop cockpit Earn tab.
 *
 * Replaces the "Withdraw $X" silent-success risk with an HONEST pipeline
 * money breakdown. Four hero stat cards (In Review · Approved · Paid ·
 * Rejected), a hero pipeline total, an approval-rate badge, a
 * per-campaign drill-in table, a last-10 activity feed, and an
 * env-gated withdraw block.
 *
 * Ported from desktop-2/src/design-os/earn/WalletPanel.tsx for the
 * LEGACY desktop/ shell (v0.7.79). Adaptation notes vs desktop-2:
 *   • Drops GlassCard wrapper — replaced with `.lc-wallet-shell` plain
 *     div styled in WalletPanel.css. The legacy shell has no GlassCard
 *     primitive.
 *   • Drops `bus.emit("nav:click", { route: "campaigns" })` — the
 *     desktop/ shell has no design-os bridge. The Browse Campaigns CTA
 *     dispatches a window CustomEvent `lc:wallet-browse-campaigns` that
 *     EarnTab can wire to its sub-tab switcher in a follow-up (and is a
 *     no-op-safe noop today).
 *   • Drops `claimCarrot()` + bus toast emission — desktop/ does not yet
 *     have the carrot/whop transfer wrapper. The withdraw block is
 *     therefore HIDDEN until withdraw.is_live === true on the backend,
 *     at which point the "Withdraw" button renders but currently dispatches
 *     a graceful toast saying the wire is shipping in the v2 cockpit.
 *     desktop-2 owns the live transfer wrapper.
 *
 * Honest copy rules (Daniel-locked):
 *   - "Paid" only counts money that ACTUALLY moved.
 *   - When withdraw is hidden, the panel says so plainly.
 *   - Approval-rate badge celebrates >75%, stays neutral 50-75%, soft
 *     encouragement <50% — never adversarial.
 *   - "Beta" pill in the header signals this surface is pre-launch
 *     wallet UX · NOT a promise of withdrawal availability.
 *
 * Data: single `GET /me/wallet/summary` round-trip via wallet.ts.
 * Fallback: when the call returns null (offline / 401 / 5xx) the panel
 * renders the brand-aligned skeleton briefly then degrades to the
 * offline state · NEVER shows fake numbers.
 */

import { useCallback, useEffect, useState } from "react";
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

/** Emit a global toast via the lc:toast event bus (handled by
 *  GlobalToastHost mounted in App.tsx). */
function toast(kind: "success" | "error" | "info", message: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("lc:toast", { detail: { kind, message } }),
    );
  } catch { /* best-effort */ }
}

export function WalletPanel() {
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
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

  // v0.7.79 — re-fetch on the same auth-ready signal EarnTab listens to,
  // so the wallet wakes up the moment the user finishes activation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAuthReady = () => void load("refresh");
    window.addEventListener("lc:desktop-auth-ready", onAuthReady);
    return () => window.removeEventListener("lc:desktop-auth-ready", onAuthReady);
  }, [load]);

  const onRefresh = useCallback(() => {
    if (refreshing) return;
    void load("refresh");
  }, [refreshing, load]);

  // Browse Campaigns CTA — broadcast an intent the EarnTab parent can
  // wire to its sub-tab switcher later. Today it's a graceful no-op +
  // toast so the user has affordance feedback.
  const onBrowseCampaigns = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent("lc:wallet-browse-campaigns"));
      } catch { /* best-effort */ }
    }
    toast("info", "Scroll down to the campaigns grid to pick one.");
  }, []);

  // Withdraw CTA — desktop/ does not yet ship the carrot/whop transfer
  // wrapper (desktop-2 owns it). When backend flips withdraw.is_live the
  // button renders; clicking surfaces the honest "shipping in v2" toast.
  const onWithdraw = useCallback(() => {
    toast(
      "info",
      "Withdrawals ship in the v2 cockpit. Your approved earnings are tracked and safe.",
    );
  }, []);

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="lc-wallet-shell" data-testid="wallet-panel" data-state="loading">
        <WalletLoadingSkeleton />
      </div>
    );
  }

  // ─── Network error · backend unreachable ─────────────────────────────
  if (!summary) {
    return (
      <div className="lc-wallet-shell" data-testid="wallet-panel" data-state="offline">
        <div className="lc-wallet">
          <WalletPanelHeader
            showNewBadge={showNewBadge}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
          <div className="lc-wallet-empty" data-testid="wallet-offline-state">
            <WalletOfflineMark />
            <div>
              <h3 className="lc-wallet-empty-title">Wallet is briefly out of reach</h3>
              <p className="lc-wallet-empty-sub">
                We couldn&rsquo;t reach the wallet service right now. Your earnings
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
      </div>
    );
  }

  const { pipeline, stats, campaigns, recent_activity, withdraw } = summary;
  const isEmpty = stats.total_submissions === 0 && pipeline.paid_usd_cents === 0;

  // ─── Empty state · zero submissions, zero paid ───────────────────────
  if (isEmpty) {
    return (
      <div className="lc-wallet-shell" data-testid="wallet-panel" data-state="empty">
        <div className="lc-wallet">
          <WalletPanelHeader
            showNewBadge={showNewBadge}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
          <WalletEmptyState onBrowseCampaigns={onBrowseCampaigns} />
          <div className="lc-wallet-foot">
            Earnings tracked end-to-end · withdrawals open once Whop integration ships
          </div>
        </div>
      </div>
    );
  }

  // ─── Loaded state ────────────────────────────────────────────────────
  const approvedUsd = pipeline.approved_usd_cents / 100;
  const meetsMin = approvedUsd >= withdraw.min_withdrawal_usd;
  const grossUsd = approvedUsd;
  const feeUsd = grossUsd * (withdraw.lc_fee_pct / 100);
  const netUsd = grossUsd - feeUsd;

  return (
    <div className="lc-wallet-shell" data-testid="wallet-panel" data-state="loaded">
      <div className="lc-wallet">
        <WalletPanelHeader
          showNewBadge={showNewBadge}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />

        {/* Hero pipeline total + approval rate */}
        <div className="lc-wallet-hero" data-testid="wallet-hero">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="lc-wallet-hero-eb">Pipeline total</span>
            <span className="lc-wallet-hero-num" data-testid="wallet-hero-amount">
              {fmtUsdCents(pipeline.total_pipeline_usd_cents)}
            </span>
          </div>
          <div className="lc-wallet-hero-meta">
            <span className="lc-wallet-hero-meta-l">Lifetime views</span>
            <span className="lc-wallet-hero-meta-v" data-testid="wallet-lifetime-views">
              {fmtViews(stats.lifetime_views)}
            </span>
          </div>
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

        {/* Four hero stat cards */}
        <div className="lc-wallet-stats" data-testid="wallet-stats-grid">
          <WalletStatCard
            tone="in-review"
            glyph="⏳"
            label="In Review"
            value={fmtUsdCents(pipeline.in_review_usd_cents)}
            footer="Awaiting campaign owner"
          />
          <WalletStatCard
            tone="approved"
            glyph="✓"
            label="Approved · Awaiting Payout"
            value={fmtUsdCents(pipeline.approved_usd_cents)}
            footer="Cleared to withdraw"
          />
          <WalletStatCard
            tone="paid"
            glyph="$"
            label="Paid"
            value={fmtUsdCents(pipeline.paid_usd_cents)}
            footer="Money that moved"
          />
          <WalletStatCard
            tone="rejected"
            glyph="×"
            label="Rejected"
            value={fmtUsdCents(pipeline.rejected_usd_cents)}
            footer="Try a different angle"
          />
        </div>

        {/* Withdraw section · env-gated · only renders the button when live */}
        {withdraw.is_live ? (
          <div
            className="lc-wallet-withdraw is-live"
            data-testid="wallet-withdraw-live"
          >
            <div className="lc-wallet-withdraw-l">
              <span className="lc-wallet-withdraw-eb">Withdraw to Whop wallet</span>
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
              onClick={onWithdraw}
              disabled={!meetsMin}
              title={
                meetsMin
                  ? `Withdraw ${fmtUsdCents(pipeline.approved_usd_cents)}`
                  : `$${withdraw.min_withdrawal_usd.toFixed(2)} minimum · keep clipping`
              }
            >
              {meetsMin
                ? `Withdraw ${fmtUsdCents(pipeline.approved_usd_cents)}`
                : `$${withdraw.min_withdrawal_usd.toFixed(2)} minimum to withdraw`}
            </button>
          </div>
        ) : (
          <div className="lc-wallet-withdraw" data-testid="wallet-withdraw-deferred">
            <div className="lc-wallet-withdraw-l">
              <span className="lc-wallet-withdraw-eb">Withdrawals · coming soon</span>
              <p className="lc-wallet-withdraw-line">
                Withdrawals open once Liquid Clips finishes Whop wallet
                integration. Your earnings are tracked and safe — every dollar
                above stays attributed to you.
              </p>
            </div>
          </div>
        )}

        {/* Per-campaign drill-in table */}
        {campaigns.length > 0 && (
          <div className="lc-wallet-section">
            <div className="lc-wallet-section-h">
              <h3 className="lc-wallet-section-h-title">Per campaign</h3>
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
            ? `Live Whop rail · ${withdraw.currency.toUpperCase()} payouts`
            : "Honest pipeline · withdrawals gated until Whop integration ships"}
        </div>
      </div>
    </div>
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
          <span className="lc-wallet-eb-beta" data-testid="wallet-beta-badge">Beta</span>
          Wallet
        </span>
        <h2 className="lc-wallet-title">Your pipeline</h2>
        <p className="lc-wallet-sub">
          Every dollar tracked from submission through approval to payout · no
          silent surprises.
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

/* Brand-aligned offline mark · custom inline SVG (no Lucide, no stock). */
function WalletOfflineMark() {
  return (
    <svg
      className="lc-wallet-empty-art"
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="lcWalletOfflineGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ff66b8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ff1a8c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="48" cy="48" r="44" fill="url(#lcWalletOfflineGlow)" />
      <circle cx="48" cy="48" r="28" stroke="#ff66b8" strokeWidth="1.5" fill="none" opacity="0.55" />
      <path d="M48 32 V52" stroke="#ff66b8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="62" r="2.5" fill="#ff66b8" />
    </svg>
  );
}
