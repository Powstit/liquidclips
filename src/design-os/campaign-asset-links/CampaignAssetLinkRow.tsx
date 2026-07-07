/**
 * CampaignAssetLinkRow · Phase 6N-D v1 · read-only
 *
 * One row per CampaignAssetLink. Click → fires browse:open via the
 * existing bus indirection. `upload_note` rows render inline notes
 * only · no external open (there's no URL to follow).
 *
 * No connection state, no ingestion state, no last-sync · v1 brief
 * links don't have those. The v2 surface (Phase 6N-E+ ingestion) will
 * add a sibling AssetSourceStatusCard for the managed model.
 */

import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { CampaignAssetLink, CampaignAssetLinkType, CampaignAssetLinkVisibility } from "../engine/sidecar-stub";
import "./CampaignAssetLinkRow.css";

export interface CampaignAssetLinkRowProps {
  link: CampaignAssetLink;
  /** Override the default `browse:open` handler · e.g. tests. */
  onOpen?: (link: CampaignAssetLink) => void;
}

const TYPE_LABEL: Record<CampaignAssetLinkType, string> = {
  google_drive: "Drive",
  dropbox:      "Dropbox",
  whop:         "Whop",
  direct_url:   "Link",
  upload_note:  "Note",
};

const VISIBILITY_LABEL: Record<CampaignAssetLinkVisibility, string> = {
  all:      "Visible to all",
  joined:   "Joined only",
  approved: "Approved only",
};

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export function CampaignAssetLinkRow({ link, onOpen }: CampaignAssetLinkRowProps) {
  const isNote = link.type === "upload_note";

  const handleOpen = () => {
    if (isNote) return;
    if (onOpen) {
      onOpen(link);
      return;
    }
    if (!link.url) return;
    bus.emit("browse:open", {
      url: link.url,
      source: "campaign",
      title: link.title,
    });
  };

  return (
    <GlassCard
      density="quiet"
      className={`lc-cal-row is-${link.type} ${isNote ? "is-note" : ""}`}
      hoverLift={!isNote}
    >
      <div
        className="lc-cal-row-body"
        role={isNote ? undefined : "button"}
        tabIndex={isNote ? undefined : 0}
        onClick={isNote ? undefined : handleOpen}
        onKeyDown={isNote ? undefined : (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          }
        }}
        aria-label={isNote ? undefined : `Open ${link.title} in browser`}
      >
        <header className="lc-cal-row-head">
          <span className={`lc-cal-type is-${link.type}`}>{TYPE_LABEL[link.type]}</span>
          {link.required && (
            <span className="lc-cal-required">Required</span>
          )}
          <span className={`lc-cal-visibility is-${link.visibility}`} title={VISIBILITY_LABEL[link.visibility]}>
            {VISIBILITY_LABEL[link.visibility]}
          </span>
        </header>

        <h4 className="lc-cal-title">{link.title}</h4>

        {!isNote && link.url && (
          <span className="lc-cal-url" title={link.url}>
            {hostFromUrl(link.url)}
          </span>
        )}

        {link.notes && (
          <p className="lc-cal-notes">{link.notes}</p>
        )}

        {!isNote && (
          <footer className="lc-cal-foot">
            <span className="lc-cal-open">Open in browser →</span>
          </footer>
        )}
      </div>
    </GlassCard>
  );
}
