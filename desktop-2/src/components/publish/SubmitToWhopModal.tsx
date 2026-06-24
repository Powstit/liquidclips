// Lane 3 — SubmitToWhopModal.
//
// Opens from the Engine handoff "Submit to Whop rewards →" and from the
// EarnSection per-campaign submit button.
//
// Honesty rule (asserted by guard):
//   - Whop tracks views, approvals, and payouts.
//   - Liquid Clips never pretends to know your earnings.
//   - After you submit, your status lives on Whop.
//
// Local behaviour: record the posted link + note in publishStore.submissions
// AND open the Whop submission page in the system browser. No backend write,
// no fake approval status.

import { useState } from "react";
import { usePublishStore } from "../../state/publishStore";
import { getCampaignById } from "../../fixtures/fakeCampaigns";
import { getModeState } from "../../shell/modeStore";

interface SubmitToWhopModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted: (message: string) => void;
  clipId?: string | null;
  defaultCampaignId?: string | null;
}

function whopSubmitUrl(campaignSlug: string, clipId?: string | null): string {
  const base = `https://whop.com/liquidclips/${campaignSlug}/submit`;
  return clipId ? `${base}?clip=${encodeURIComponent(clipId)}` : base;
}

export function SubmitToWhopModal({
  open,
  onClose,
  onSubmitted,
  clipId,
  defaultCampaignId,
}: SubmitToWhopModalProps) {
  const recordSubmission = usePublishStore((s) => s.recordSubmission);

  const campaignId = defaultCampaignId ?? getModeState().activeCampaignId;
  const campaign = campaignId ? getCampaignById(campaignId) : undefined;
  const campaignName = campaign?.name ?? "No active campaign";
  const campaignSlug = campaign?.id?.replace(/^cmp_/, "") ?? "rewards";

  const [postedLink, setPostedLink] = useState("");
  const [note, setNote] = useState("");

  if (!open) return null;

  const valid = postedLink.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    recordSubmission({
      campaignId: campaign?.id ?? null,
      campaignName: campaign?.name ?? null,
      clipId: clipId ?? null,
      postedLink: postedLink.trim(),
      note: note.trim(),
    });
    window.open(whopSubmitUrl(campaignSlug, clipId), "_blank", "noopener");
    onSubmitted("Opened on Whop. Track approval there.");
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
