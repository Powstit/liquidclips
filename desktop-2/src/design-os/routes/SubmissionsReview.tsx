/**
 * SubmissionsReviewRoute · UI-3 · agency-only
 *
 * Lists clipper submissions to the agency's campaigns. Approve / Reject
 * flips local status; emits `submission:reviewed` for downstream surfaces.
 *
 * Mock-only · the fixture mirrors the shape Batch D will return from the
 * `/campaigns/:slug/submissions` endpoint.
 *
 * AU-B-5 (2026-07-10) · header said "agency-only" but the file had
 * ZERO tier gate — free-tier users could reach the full surface. Wrap
 * the route in `PaywallGate requiredTier="agency"` (overlay mode) so
 * non-agency users see the paywall preview banner over the dimmed
 * page. Fires `submissions_review_paywall_shown { tier }` when the
 * gate blocks so Money Funnel HQ picks up the drop-off.
 */

import { motion as fm } from "framer-motion";
import { useEffect, useState } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { WhopBoundaryCard } from "../components/WhopBoundaryCard";
import { bus, useEvent } from "../bridge";
import { presets } from "../motion";
import { ROUTE_HERO } from "../copy/copyMap";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { openInApp } from "../../lib/openInApp";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import { useTierCaps } from "../state/useTierCaps";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./SubmissionsReview.css";

type SubmissionStatus = "pending" | "approved" | "rejected" | "paid";

interface MockSubmission {
  id: string;
  clipper: string;
  avatar: string;
  campaign: string;
  clipTitle: string;
  platform: "tiktok" | "youtube" | "instagram" | "x";
  postUrl: string;
  submittedAt: string; // ISO
  status: SubmissionStatus;
  payoutUsd: number;
}

/* TASK 4 · agency launch readiness · the Submissions Review surface
 * is COMING SOON until Batch D wires the real `/campaigns/:slug/
 * submissions` endpoint. The previous fixture (5 preview rows) made
 * the screen LOOK live · launching with that pattern would mislead an
 * agency operator. Same honest-COMING-SOON pattern as BUG-042 Library
 * + BUG-046 InboxSheet · empty array + clear banner above the grid.
 *
 * The historical fixture is preserved as LEGACY_SUBMISSIONS_FIXTURE
 * for any future dev/storybook use · it is no longer read by the
 * route. */
const FIXTURE_SUBMISSIONS: MockSubmission[] = [];

/* eslint-disable @typescript-eslint/no-unused-vars */
const LEGACY_SUBMISSIONS_FIXTURE: MockSubmission[] = [
  {
    id: "sub-001", clipper: "@preview-clipper-01", avatar: "/brand/kade/kade-create-clips.webp",
    campaign: "Preview campaign",
    clipTitle: "Sample clip · pending review",
    platform: "tiktok",
    postUrl: "https://example.com/preview/clip-01",
    submittedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    status: "pending", payoutUsd: 25,
  },
  {
    id: "sub-002", clipper: "@preview-clipper-02", avatar: "/brand/kade/kade-publishing.webp",
    campaign: "Preview campaign",
    clipTitle: "Sample clip · pending review",
    platform: "youtube",
    postUrl: "https://example.com/preview/clip-02",
    submittedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    status: "pending", payoutUsd: 25,
  },
  {
    id: "sub-003", clipper: "@preview-clipper-03", avatar: "/brand/kade/kade-reading-brief.webp",
    campaign: "Preview campaign",
    clipTitle: "Sample clip · approved",
    platform: "instagram",
    postUrl: "https://example.com/preview/clip-03",
    submittedAt: new Date(Date.now() - 22 * 3600_000).toISOString(),
    status: "approved", payoutUsd: 25,
  },
  {
    id: "sub-004", clipper: "@preview-clipper-04", avatar: "/brand/kade/kade-success.webp",
    campaign: "Preview campaign",
    clipTitle: "Sample clip · paid",
    platform: "tiktok",
    postUrl: "https://example.com/preview/clip-04",
    submittedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    status: "paid", payoutUsd: 25,
  },
  {
    id: "sub-005", clipper: "@preview-clipper-05", avatar: "/brand/kade/kade-generating-captions.webp",
    campaign: "Preview campaign",
    clipTitle: "Sample clip · rejected",
    platform: "x",
    postUrl: "https://example.com/preview/clip-05",
    submittedAt: new Date(Date.now() - 60 * 3600_000).toISOString(),
    status: "rejected", payoutUsd: 0,
  },
];
/* eslint-enable @typescript-eslint/no-unused-vars */
void LEGACY_SUBMISSIONS_FIXTURE;

const FILTERS: ReadonlyArray<{ id: "all" | SubmissionStatus; label: string }> = [
  { id: "all",      label: "All" },
  { id: "pending",  label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "paid",     label: "Paid" },
];

export function SubmissionsReviewRoute() {
  const hero = ROUTE_HERO["submissions"];
  const spec = ROUTE_REGISTRY["submissions"];
  const [items, setItems] = useState<MockSubmission[]>(FIXTURE_SUBMISSIONS);
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

  // Allow downstream to mutate via bus (e.g. an external "mark as paid").
  useEvent("submission:reviewed", (p) => {
    setItems((cur) => cur.map((s) =>
      s.id === p.submissionId ? { ...s, status: p.decision === "approve" ? "approved" : "rejected" } : s
    ));
  });

  const visible = items.filter((s) => filter === "all" || s.status === filter);

  const review = (id: string, decision: "approve" | "reject") => {
    bus.emit("submission:reviewed", { submissionId: id, decision });
    bus.emit("toast", {
      kind: decision === "approve" ? "success" : "info",
      title: decision === "approve" ? "Approved" : "Rejected",
      body: "Whop will be notified.",
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
          route content (fixture list + honest coming-soon banner) and
          renders the paywall preview card centered — same pattern
          used by Campaigns Create + Analytics-Deep surfaces. Agency
          users see the plain children with no gate overlay. */}
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

        {/* TASK 4 · honest COMING SOON banner. The route remains mounted
         *  so the agency operator sees what's coming · no fake fixture
         *  rows underneath. Banner matches BUG-042 Library / BUG-046
         *  Inbox / Channels backend-offline copy pattern. */}
        <div
          className="lc-sr-coming-soon-banner"
          data-testid="submissions-coming-soon"
          data-state="coming-soon"
          style={{
            margin: "0 0 18px",
            padding: "14px 18px",
            borderRadius: 12,
            border: "1px solid rgba(255, 26, 140, 0.22)",
            background: "rgba(255, 26, 140, 0.08)",
            color: "rgba(255, 245, 250, 0.9)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Submissions · coming soon</strong>
          <span style={{ display: "block", marginTop: 4, opacity: 0.85 }}>
            The {`/campaigns/:slug/submissions`} endpoint isn't reachable from this
            build. Real clipper submissions land here once you connect a backend
            or install the desktop app with the agency review feed wired. No fake
            submissions are shown.
          </span>
        </div>

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

            {visible.length === 0 && (
              <div className="lc-sr-empty" data-testid="submissions-empty">
                <span className="lc-sr-empty-eb">No submissions yet</span>
                <span className="lc-sr-empty-body">Share your campaign link with clippers to receive their work here.</span>
              </div>
            )}

            <ul className="lc-sr-list">
              {visible.map((s) => (
                <li key={s.id}>
                  <SubmissionRow row={s} onReview={review} />
                </li>
              ))}
            </ul>
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

function SubmissionRow({
  row, onReview,
}: { row: MockSubmission; onReview: (id: string, d: "approve" | "reject") => void }) {
  const isPending = row.status === "pending";
  return (
    <article className={`lc-sr-row lc-sr-row-${row.status}`}>
      <img src={row.avatar} alt="" className="lc-sr-avatar" />
      <div className="lc-sr-meta">
        <span className="lc-sr-clip-title">{row.clipTitle}</span>
        <span className="lc-sr-sub">
          {row.clipper} · {fmtAgo(row.submittedAt)} · {row.platform.toUpperCase()}
        </span>
        <a
          className="lc-sr-link"
          href={row.postUrl}
          onClick={(event) => {
            event.preventDefault();
            void openInApp(row.postUrl, { intent: "read-only" });
          }}
        >
          {row.postUrl}
        </a>
      </div>
      <div className="lc-sr-side">
        <span className={`lc-sr-status lc-sr-status-${row.status}`}>{row.status}</span>
        <span className="lc-sr-payout">${row.payoutUsd}</span>
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
                if (window.confirm(`Reject "${row.clipTitle}"?\n\nThe clipper will not receive a payout for this submission.`)) {
                  onReview(row.id, "reject");
                }
              }}
            >
              Reject
            </button>
            <button type="button" className="lc-sr-primary" onClick={() => onReview(row.id, "approve")}>Approve</button>
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
