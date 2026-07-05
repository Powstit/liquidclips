import { useState } from "react";
import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { navigateTo } from "../../shell/routes";
import { bus } from "../../design-os/bridge";
import { useBrowseOverlay } from "../../state/browseOverlay";
// Phase 8 · Mount #4 · catalog block hoisted to Section B port.
import { CatalogCarousel } from "../../routes/catalog/CatalogCarousel";
// Phase 8 · Mount #6 · cold-email recipient preview.
import { EmbedPreviewCard } from "../../routes/campaign-builder/EmbedPreviewCard";

// 2026-07-05 · 2.2.24 · dummy-data purge. Previously seeded from
// `fakeCampaigns` fixture · every new user saw the same 3 demo
// campaigns regardless of state. Now starts empty · users create
// their first campaign via CreateCampaignModal. The type stays
// imported so createCampaign() below preserves its typed shape.
// Backend wire (GET /campaigns) lands in a follow-up sprint.
import type { FakeCampaign } from "../../fixtures/fakeCampaigns";

export function CampaignsSection() {
  const openOverlay = useBrowseOverlay((s) => s.openWith);
  const [campaigns, setCampaigns] = useState<FakeCampaign[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [watermarkCampaign, setWatermarkCampaign] = useState<FakeCampaign | null>(null);
  const selected = campaigns.find((c) => c.id === selectedId) ?? campaigns[0];

  function createCampaign(name: string, handle: string) {
    const next: FakeCampaign = {
      id: `cmp_fx_${String(campaigns.length + 1).padStart(3, "0")}`,
      name,
      ownerHandle: handle,
      status: "draft",
      sourceTitle: "Untitled source",
      sourceDurationSec: 0,
      watermarkHandle: handle,
      watermarkPosition: "bottom",
      rewardPoolUrl: `https://whop.com/liquidclips/rewards/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"))}`,
      inviteUrl: `https://whop.com/liquidclips/join/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"))}`,
      communityUrl: `https://whop.com/c/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"))}`,
      clipperCount: 0,
      outputClipIds: [],
      ownerTier: "free",
    };
    setCampaigns([next, ...campaigns]);
    setSelectedId(next.id);
    setCreateOpen(false);
  }

  return (
    <>
      <div className="lc-section-header">
        <div>
          <span className="lc-section-eyebrow">
            <span className="lc-section-eyebrow-dot" /> agency · creator surface
          </span>
          <h1 className="lc-section-title">Campaigns</h1>
          <p className="lc-section-subtitle">
            Stamp content with a locked watermark, brief clippers, hand rewards off to Whop. The Set-Watermark composer
            opens from the active campaign card.
          </p>
          <div className="lc-section-pills">
            <span className="lc-id-pill">{SECTION_IDS.SECTION_CAMPAIGNS}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_016_CAMPAIGN_CREATE}</span>
            <span className="lc-id-pill">{FLOW_IDS.FLOW_018_WATERMARK_COMPOSER}</span>
          </div>
        </div>
        <button type="button" className="lc-btn" data-variant="primary" onClick={() => setCreateOpen(true)}>
          + Create campaign
        </button>
      </div>

      {selected && (
        <div className="lc-campaign lc-mt-16">
          <div className="lc-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span className="lc-hud-eyebrow">active campaign</span>
              <h3 className="lc-campaign-title">{selected.name}</h3>
            </div>
            <div className="lc-row">
              <span className="lc-pill" data-tone="ok"><span className="lc-pill-dot" /> whop · configured</span>
              <span className="lc-pill" data-tone="ok"><span className="lc-pill-dot" /> clippers · open</span>
            </div>
          </div>

          <div className="lc-campaign-stamp">
            <div className="lc-campaign-stamp-preview" />
            <div>
              <div className="lc-campaign-stamp-meta">watermark · {selected.watermarkHandle} · bottom-right</div>
              <div className="lc-hud-body" style={{ marginTop: 4 }}>
                Locked across every clip. Removed only if {selected.ownerHandle} approves.
              </div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <button type="button" className="lc-btn" data-variant="ghost" data-size="sm" onClick={() => setWatermarkCampaign(selected)}>
                Set watermark →
              </button>
            </div>
          </div>

          <div className="lc-row">
            <button
              type="button"
              className="lc-btn"
              data-variant="primary"
              onClick={() => {
                /* Gate 5 (2026-06-26) — this legacy CampaignsSection is
                 * mounted under the hidden `#/campaign` hash. The
                 * SimulatorRouter that subscribes to `nav:click` only
                 * lives under `#/home`, so emitting before navigating
                 * was a silent no-op. Force the design-os shell back up
                 * first, then emit on the next tick. */
                if (window.location.hash !== "#/home") {
                  window.location.hash = "#/home";
                }
                window.setTimeout(() => {
                  bus.emit("nav:click", { route: "clipper" });
                }, 30);
              }}
            >
              Open brief
            </button>
            <button type="button" className="lc-btn" data-variant="whop" onClick={() => openOverlay(selected.rewardPoolUrl, "browse-campaign")}>
              Set rewards on Whop →
            </button>
            <button type="button" className="lc-btn" data-variant="secondary" onClick={() => openOverlay(selected.inviteUrl, "browse-campaign")}>
              Invite clippers
            </button>
            <button type="button" className="lc-btn" data-variant="ghost" onClick={() => navigateTo(SECTION_IDS.SECTION_EDITOR, { campaignId: selected.id })}>
              Review · {selected.outputClipIds.length} submissions
            </button>
          </div>
        </div>
      )}

      {/* Phase 8 · Mount #4 (2026-07-04) · CatalogCarousel replaces the
          legacy lc-hud-card grid. Section B ported the full 6-state
          carousel (empty · loading · partial · ready · error · focused)
          with its own scrubber. `selectedId` state above the carousel is
          still consumed by the "active campaign" header block, so
          `setSelectedId` stays reachable via the wrapping campaign
          detail card — the grid card selection UI is retired.
          `onClipClick` intentionally NOT wired: CatalogCarousel's
          Tile shape is not FakeCampaign, and Layer 4 (F7) will pass
          real tiles once /yt/batch-lookup lands. */}
      <CatalogCarousel />

      {/* Phase 8 · Mount #6 (2026-07-04) · EmbedPreviewCard nested
          below the catalog as the campaign builder's cold-email
          recipient preview. Shows what a target clipper sees when the
          sender's outreach email lands + the "Claim my 10 clips" CTA
          renders on liquidclips.app/preview/<token>. Section B's port
          defaults `initialState` to `populated` (the money-ready
          case). `showScrubber` is dev-only. `onCta` intentionally
          NOT wired: the CTA click routes to
          `handleActivationUrl`/funnel-session already at the
          preview page — the sender-side preview is decorative until
          the campaign builder gains a real preview-video-id field
          (out of Phase 8 scope). */}
      <div className="campaign-preview-slot">
        <EmbedPreviewCard
          showScrubber={import.meta.env.DEV}
        />
      </div>

      {createOpen && (
        <CreateCampaignModal onClose={() => setCreateOpen(false)} onCreate={createCampaign} />
      )}
      {watermarkCampaign && (
        <WatermarkComposerModal campaign={watermarkCampaign} onClose={() => setWatermarkCampaign(null)} />
      )}
    </>
  );
}

function CreateCampaignModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, handle: string) => void }) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  return (
    <div className="lc-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lc-modal">
        <span className="lc-hud-eyebrow">create campaign</span>
        <h2 className="lc-hud-title">New campaign</h2>
        <p className="lc-hud-body" style={{ marginTop: 6 }}>This is a UI skeleton. No real campaign record is written.</p>
        <label className="lc-form-label" style={{ marginTop: 16 }}>
          Campaign name
          {/* BUG-004 sister sweep · placeholder example was branded with the
              legacy demo campaign name. Generic example so the field reads
              honestly for any new customer. */}
          <input className="lc-form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Audience Campaign" />
        </label>
        <label className="lc-form-label" style={{ marginTop: 12 }}>
          Owner handle
          <input className="lc-form-input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
        </label>
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="lc-btn" data-variant="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="lc-btn" data-variant="primary" disabled={!name.trim() || !handle.trim()} onClick={() => onCreate(name.trim(), handle.trim())}>Create</button>
        </div>
      </div>
    </div>
  );
}

function WatermarkComposerModal({ campaign, onClose }: { campaign: FakeCampaign; onClose: () => void }) {
  const [handle, setHandle] = useState(campaign.watermarkHandle);
  const [position, setPosition] = useState(campaign.watermarkPosition);
  return (
    <div className="lc-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lc-modal">
        <span className="lc-hud-eyebrow">watermark composer</span>
        <h2 className="lc-hud-title">Campaign stamp</h2>
        <p className="lc-hud-body" style={{ marginTop: 6 }}>This stamp rides locked on every clipper export. Clippers cannot remove it.</p>
        <label className="lc-form-label" style={{ marginTop: 16 }}>
          Stamp handle
          <input className="lc-form-input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" />
        </label>
        <label className="lc-form-label" style={{ marginTop: 12 }}>
          Position
          <select className="lc-form-input" value={position} onChange={(e) => setPosition(e.target.value as "bottom" | "top" | "corner")}>
            <option value="bottom">Bottom</option>
            <option value="top">Top</option>
            <option value="corner">Corner</option>
          </select>
        </label>
        <div
          style={{
            marginTop: 16,
            aspectRatio: "9 / 16",
            maxWidth: 160,
            background: "linear-gradient(180deg, rgba(255,26,140,0.18), rgba(255,26,140,0.04))",
            borderRadius: 16,
            border: "1px solid var(--color-line)",
            display: "flex",
            alignItems: position === "top" ? "flex-start" : position === "bottom" ? "flex-end" : "center",
            justifyContent: position === "corner" ? "flex-end" : "center",
            padding: 12,
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            textShadow: "0 1px 4px rgba(0,0,0,.7)",
          }}
        >
          {handle || "@handle"}
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="lc-btn" data-variant="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="lc-btn" data-variant="primary" onClick={onClose}>Save stamp (simulated)</button>
        </div>
      </div>
    </div>
  );
}
