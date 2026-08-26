/**
 * SubmissionsReviewRoute · UI-3 · agency-only
 *
 * Lists clipper submissions to the agency's owned campaigns. Approve /
 * Reject calls the real agency-owner-scoped status endpoint and persists.
 *
 * Phase 3 (2026-08-26) · was fixture-only (`FIXTURE_SUBMISSIONS = []`)
 * with a stale "endpoint isn't reachable" banner — the endpoint has
 * been reachable since agency_campaigns.py shipped its submissions
 * read route; this route just never called it. Now fans out
 * `GET /agency/campaigns` → `GET /agency/campaigns/{slug}/submissions`
 * per owned campaign and merges, since the read is per-slug but this
 * screen shows one flat list.
 *
 * AU-B-5 (2026-07-10) · header said "agency-only" but the file had
 * ZERO tier gate — free-tier users could reach the full surface. Wrap
 * the route in `PaywallGate requiredTier="agency"` (overlay mode) so
 * non-agency users see the paywall preview banner over the dimmed
 * page. Fires `submissions_review_paywall_shown { tier }` when the
 * gate blocks so Money Funnel HQ picks up the drop-off.
 */

import { motion as fm } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { WhopBoundaryCard } from "../components/WhopBoundaryCard";
import { bus } from "../bridge";
import { presets } from "../motion";
import { ROUTE_HERO } from "../copy/copyMap";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { openInApp } from "../../lib/openInApp";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import { useTierCaps } from "../state/useTierCaps";
import { lcDiag } from "../../lib/diagnosticLogger";
import { agencyCampaigns, type AgencySubmission } from "../engine/sidecar-stub";
import "./SubmissionsReview.css";

type SubmissionStatus = "submitted" | "accepted" | "rejected" | "forwarded" | "paid";

/** Real-data row · merges an `AgencySubmission` with the campaign title
 *  the fan-out fetch already resolved, plus a platform guess derived
 *  from the posted URL's hostname (the backend doesn't persist platform
 *  as its own column — see junior-backend/app/models.py:CampaignSubmission). */
interface SubmissionRow {
  id: string;
  userId: string;
  campaignSlug: string;
  campaignTitle: string;
  clipUrl: string;
  platform: string;
  submittedAt: string; // ISO
  status: SubmissionStatus;
  payoutUsd: number;
  rejectionReason: string | null;
}

function guessPlatform(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("tiktok")) return "tiktok";
    if (host.includes("youtube") || host.includes("youtu.be")) return "youtube";
    if (host.includes("instagram")) return "instagram";
    if (host.includes("x.com") || host.includes("twitter")) return "x";
    return host;
  } catch {
    return "—";
  }
}

function toRow(s: AgencySubmission, campaignTitle: string): SubmissionRow {
  return {
    id: s.id,
    userId: s.user_id,
    campaignSlug: s.campaign_id,
    campaignTitle,
    clipUrl: s.clip_url,
    platform: guessPlatform(s.clip_url),
    submittedAt: s.created_at,
    status: (s.status as SubmissionStatus) ?? "submitted",
    payoutUsd: (s.payout_usd_cents ?? 0) / 100,
    rejectionReason: s.rejection_reason,
  };
}

const FILTERS: ReadonlyArray<{ id: "all" | SubmissionStatus; label: string }> = [
  { id: "all",       label: "All" },
  { id: "submitted", label: "Pending" },
  { id: "accepted",  label: "Approved" },
  { id: "rejected",  label: "Rejected" },
  { id: "paid",      label: "Paid" },
];

export function SubmissionsReviewRoute() {
  const hero = ROUTE_HERO["submissions"];
  const spec = ROUTE_REGISTRY["submissions"];
  const [items, setItems] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | SubmissionStatus>("all");
  // AU-B-5 · tier gate for the "agency-only" surface. When blocked,
  // PaywallGate renders the paywall preview banner + dims the child
  // route content. We also emit a HQ event so Money Funnel can see
  // the drop-off — fire-once-per-mount so the funnel counts unique
  // blocked views, not scroll-thrash.
  const tierCtx = useTierCaps();
  const isAgencyTier = tierCtx.tier === "agency";
  useEffect(() => {
    if (isAgencyTier) return;
    lcDiag("submissions_review_paywall_shown", { tier: tierCtx.tier });
    // Intentional single-fire per mount + tier change.
  }, [isAgencyTier, tierCtx.tier]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const campaigns = await agencyCampaigns.list();
      const perCampaign = await Promise.all(
        campaigns.map(async (c) => {
          const subs = await agencyCampaigns.submissions(c.slug);
          return subs.map((s) => toRow(s, c.title));
        }),
      );
      const merged = perCampaign
        .flat()
        .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
      setItems(merged);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = items.filter((s) => filter === "all" || s.status === filter);

  const review = async (row: SubmissionRow, decision: "approve" | "reject") => {
    const nextStatus = decision === "approve" ? "accepted" : "rejected";
    const result = await agencyCampaigns.setSubmissionStatus({
      slug: row.campaignSlug,
      submissionId: row.id,
      status: nextStatus,
    });
    if (!result) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't update submission",
        body: "The status change didn't save — check your connection and try again.",
      });
      return;
    }
    setItems((cur) => cur.map((s) => (s.id === row.id ? { ...s, status: nextStatus } : s)));
    bus.emit("submission:reviewed", { submissionId: row.id, decision });
    bus.emit("toast", {
      kind: decision === "approve" ? "success" : "info",
      title: decision === "approve" ? "Approved" : "Rejected",
      body: "The clipper has been notified.",
    });
  };

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="submissions"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      {/* AU-B-5 · Agency-only gate. Overlay mode dims the underlying
          route content and renders the paywall preview card centered —
          same pattern used by Campaigns Create + Analytics-Deep
          surfaces. Agency users see the plain children with no gate
          overlay. */}
      <PaywallGate
        requiredTier="agency"
        action="Review clipper submissions"
        mode="overlay"
      >
      <fm.div
        className="sim-stage lc-sr-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
        data-testid="submissions-review-stage"
        data-agency-only="true"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>{hero.eyebrow}</fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>{hero.h1}</fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>{hero.sub}</fm.p>
        </fm.div>

        {loadError && (
          <div
            className="lc-sr-coming-soon-banner"
            data-testid="submissions-load-error"
            style={{
              margin: "0 0 18px", padding: "14px 18px", borderRadius: 12,
              border: "1px solid rgba(255, 26, 140, 0.22)",
              background: "rgba(255, 26, 140, 0.08)",
              color: "rgba(255, 245, 250, 0.9)", fontSize: 13, lineHeight: 1.5,
            }}
          >
            <strong>Couldn't load submissions</strong>
            <span style={{ display: "block", marginTop: 4, opacity: 0.85 }}>{loadError}</span>
            <button
              type="button"
              className="lc-sr-filter"
              style={{ marginTop: 10 }}
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        )}

        <div className="lc-sr-layout" data-testid="submissions-layout" data-submissions-count={String(items.length)}>
          <main className="lc-sr-main">
            <nav className="lc-sr-filters" role="tablist" aria-label="Filter submissions">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  className={`lc-sr-filter ${filter === f.id ? "on" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span className="lc-sr-filter-count">
                    {f.id === "all" ? items.length : items.filter((s) => s.status === f.id).length}
                  </span>
                </button>
              ))}
            </nav>

            {loading ? (
              <div className="lc-sr-empty" data-testid="submissions-loading">
                <span className="lc-sr-empty-eb">Loading submissions…</span>
              </div>
            ) : visible.length === 0 ? (
              <div className="lc-sr-empty" data-testid="submissions-empty">
                <span className="lc-sr-empty-eb">No submissions yet</span>
                <span className="lc-sr-empty-body">Share your campaign link with clippers to receive their work here.</span>
              </div>
            ) : (
              <ul className="lc-sr-list">
                {visible.map((s) => (
                  <li key={s.id}>
                    <SubmissionRowView row={s} onReview={review} />
                  </li>
                ))}
              </ul>
            )}
          </main>

          <aside className="lc-sr-rail">
            <WhopBoundaryCard variant="full" />
          </aside>
        </div>
      </fm.div>
      </PaywallGate>
    </DesignOSAppShell>
  );
}

function SubmissionRowView({
  row, onReview,
}: { row: SubmissionRow; onReview: (row: SubmissionRow, d: "approve" | "reject") => void }) {
  const isPending = row.status === "submitted";
  const initial = row.userId.slice(0, 2).toUpperCase();
  return (
    <article className={`lc-sr-row lc-sr-row-${row.status}`}>
      <span className="lc-sr-avatar lc-sr-avatar-initial" aria-hidden="true">{initial}</span>
      <div className="lc-sr-meta">
        <span className="lc-sr-clip-title">{row.campaignTitle}</span>
        <span className="lc-sr-sub">
          {row.userId.slice(0, 10)} · {fmtAgo(row.submittedAt)} · {row.platform.toUpperCase()}
        </span>
        <a
          className="lc-sr-link"
          href={row.clipUrl}
          onClick={(event) => {
            event.preventDefault();
            void openInApp(row.clipUrl, { intent: "read-only" });
          }}
        >
          {row.clipUrl}
        </a>
        {row.status === "rejected" && row.rejectionReason && (
          <span className="lc-sr-sub" style={{ opacity: 0.75 }}>Reason: {row.rejectionReason}</span>
        )}
      </div>
      <div className="lc-sr-side">
        <span className={`lc-sr-status lc-sr-status-${row.status}`}>{row.status}</span>
        <span className="lc-sr-payout">${row.payoutUsd.toFixed(2)}</span>
        {isPending && (
          <div className="lc-sr-actions">
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  Reject is destructive (clipper doesn't get paid · no undo
             *  once persisted). Confirm before firing per §8
             *  confirmation-dialogs guideline. Approve stays one-tap. */}
            <button
              type="button"
              className="lc-sr-ghost"
              onClick={() => {
                if (window.confirm(`Reject this submission to "${row.campaignTitle}"?\n\nThe clipper will not receive a payout for this submission.`)) {
                  void onReview(row, "reject");
                }
              }}
            >
              Reject
            </button>
            <button type="button" className="lc-sr-primary" onClick={() => void onReview(row, "approve")}>Approve</button>
          </div>
        )}
      </div>
    </article>
  );
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
