// Lane 3 — SubmitToWhopModal.
//
// Opens from the Engine handoff "Submit to Whop rewards →" and from the
// EarnSection per-campaign submit button.
//
// AU-B-1 (2026-07-10) · consolidated onto the same prop-driven
// submission contract as `desktop-2/src/design-os/components/SubmitToWhopModal.tsx`.
// The primary variant handles the design-os workstation flow; this
// legacy Lane-3 variant handles the section-shell publish flow (still
// mounted from EditorSection).
//
// Rules match the primary variant:
//   - No FIXTURE_CAMPAIGN, no preview-campaign string
//   - No default campaignId fallback
//   - Modal accepts `campaignId: string | null` from the caller — no
//     invented slug ships to production
//   - Missing campaignId → disable submit CTA + show honest reason
//   - Successful submit emits `submission_created { campaign_id }` via
//     the same lcDiag event key so Money Funnel HQ picks up both
//     variants uniformly.
//
// Honesty rule (asserted by guard):
//   - Whop tracks views, approvals, and payouts.
//   - Liquid Clips never pretends to know your earnings.
//   - After you submit, your status lives on Whop.

import { useState } from "react";
import { usePublishStore } from "../../state/publishStore";
import { useRegisterModal } from "../../design-os/components/ModalPortal";
import { openInApp } from "../../lib/openInApp";
import { lcDiag } from "../../lib/diagnosticLogger";
import { useMe } from "../../design-os/state/useMe";

interface SubmitToWhopModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
  clipId?: string | null;
  /**
   * AU-B-1 · REQUIRED for a real submission to fire. Passed by the
   * caller (Campaigns row click → EditorSection). When `null` or
   * empty, the primary CTA is disabled with an honest reason and
   * `whopSubmitUrl` is never opened. Legacy callers that pass a
   * fixture slug (e.g. `cmp_fx_001`) are rejected at the CTA gate.
   */
  campaignId: string | null;
}

const LEGACY_FIXTURE_ID_PATTERN = /^cmp_fx_/i;

function whopSubmitUrl(campaignSlug: string, clipId?: string | null): string {
  const base = `https://whop.com/liquidclips/${campaignSlug}/submit`;
  return clipId ? `${base}?clip=${encodeURIComponent(clipId)}` : base;
}

export function SubmitToWhopModal({
  open,
  onClose,
  onSubmitted,
  clipId,
  campaignId,
}: SubmitToWhopModalProps) {
  const recordSubmission = usePublishStore((s) => s.recordSubmission);
  const me = useMe();

  // AU-B-1 · reject fixture slugs at the boundary. When the caller
  // passes `cmp_fx_001` (leaked from the legacy CampaignsSection), the
  // modal treats it as "no campaign" so the CTA disables + the honest
  // reason surfaces — the fixture never rides a real submission POST.
  const hasRealCampaign = !!campaignId && !LEGACY_FIXTURE_ID_PATTERN.test(campaignId);
  const resolvedCampaignId = hasRealCampaign ? campaignId : null;
  const campaignName = resolvedCampaignId
    ? `Campaign ${resolvedCampaignId}`
    : "No campaign selected";
  const campaignSlug = resolvedCampaignId?.replace(/^cmp_/, "") ?? null;

  // AU-B-1 · Gate 2 · Path B (2026-07-10 lock). New users MUST link
  // Whop identity before a submission ever routes. Blocked here + at
  // the primary variant so both surfaces enforce the same rule.
  const hasWhopIdentity = !!me.snapshot?.whopUserId;
  const whopIdentityLoading = me.loading && !me.snapshot;

  const [postedLink, setPostedLink] = useState("");
  const [note, setNote] = useState("");

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · LIFO modal
  // registration for Esc + shared scroll-lock via ModalPortal stack.
  useRegisterModal({ id: "submit-to-whop-modal", open, onEscape: onClose });

  if (!open) return null;

  const linkValid = postedLink.trim().length > 0;
  // AU-B-1 · CTA is disabled unless every hard-gate passes. Reasons
  // stack in priority order so the most-actionable one surfaces first.
  const disabledReason = whopIdentityLoading
    ? "Checking your Whop identity…"
    : !hasWhopIdentity
      ? "Connect Whop first — link your identity before submitting."
      : !hasRealCampaign
        ? "Pick a campaign first — open a paid campaign from the Campaigns tab."
        : !linkValid
          ? "Paste the URL of the post you published."
          : null;
  const valid = disabledReason === null;

  const submit = () => {
    if (!valid || !resolvedCampaignId || !campaignSlug) return;
    recordSubmission({
      campaignId: resolvedCampaignId,
      campaignName,
      clipId: clipId ?? null,
      postedLink: postedLink.trim(),
      note: note.trim(),
    });
    // AU-B-1 · HQ event · records the REAL campaign_id +
    // whop_user_id on every submission fired from this variant.
    // Matches the primary variant's emit shape for uniform HQ funnel.
    try {
      lcDiag("submission_created", {
        campaign_id: resolvedCampaignId,
        whop_user_id: me.snapshot?.whopUserId ?? null,
      });
    } catch { /* logger import failed · non-fatal */ }
    void openInApp(whopSubmitUrl(campaignSlug, clipId), { intent: "read-only" });
    onSubmitted("Opened Whop in Browse. Track approval there.");
    setPostedLink("");
    setNote("");
    onClose();
  };

  return (
    <div
      className="lc-scrim lc-whop-submit-scrim"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-lane3-slot="whop submit modal"
    >
      <div
        className="lc-modal lc-whop-submit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Submit to Whop rewards"
      >
        <div className="lc-whop-submit-head">
          <h3 className="lc-hud-title lc-whop-submit-title">Submit to Whop rewards</h3>
          <button
            type="button"
            className="lc-publish-close"
            aria-label="Close Whop submit modal"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="lc-whop-submit-eyebrow-row">
          <span className="lc-publish-chip lc-publish-campaign">
            <span className="lc-publish-chip-dot" />
            {campaignName}
          </span>
          <span className="lc-publish-chip lc-publish-watermark">
            <span className="lc-publish-chip-dot" />
            Watermark locked
          </span>
        </div>

        <div className="lc-publish-section">
          <div className="lc-publish-section-label">Posted link</div>
          <input
            type="url"
            className="lc-form-input lc-whop-submit-input"
            placeholder="https://www.tiktok.com/@you/video/…"
            value={postedLink}
            onChange={(e) => setPostedLink(e.target.value)}
          />
          <p className="lc-whop-submit-hint">
            Make sure this is a public post URL.
          </p>
        </div>

        <div className="lc-publish-section">
          <div className="lc-publish-section-label">Add a note (optional)</div>
          <textarea
            className="lc-publish-caption lc-whop-submit-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything Whop reviewers should know…"
          />
        </div>

        <div className="lc-whop-submit-honesty">
          <p>Whop tracks views, approvals, and payouts.</p>
          <p>Liquid Clips never pretends to know your earnings.</p>
          <p>After you submit, your status lives on Whop.</p>
        </div>

        <div className="lc-publish-footer">
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="lc-btn"
            data-variant="whop"
            disabled={!valid}
            onClick={submit}
            data-disabled-reason={disabledReason ?? ""}
            title={disabledReason ?? "Open Whop submission"}
          >
            Open Whop submission ↗
          </button>
        </div>

        <p className="lc-whop-submit-footnote">
          We log the link locally so you can revisit it later. Approval happens on Whop.
        </p>
      </div>
    </div>
  );
}
