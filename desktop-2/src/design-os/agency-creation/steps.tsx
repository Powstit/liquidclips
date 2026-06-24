/**
 * Agency Creation Flow · 8 step components · Phase 6N-E v1
 *
 * Co-located in a single file because each step is a thin form panel
 * over the shared draft state. Spreading them across 8 files adds
 * import churn without commensurate clarity.
 *
 * Step 1 (Connect reward) is the only non-trivial step · the other
 * seven are thin inputs.
 */

import { useCallback, useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import { useCommunity } from "../state/useCommunity";
import { useCampaignAssetLinks } from "../state/useCampaignAssetLinks";
import { useWhopReward } from "../state/useWhopReward";
import { WhopRewardCard } from "./WhopRewardCard";
import { PaywallGate } from "../../components/paywall/PaywallGate";
import { notifyCampaignPublishBlocked } from "../../inbox/notify";
import { useBillingState } from "../../lib/billing/adapter";
import type {
  CampaignAssetLinkType,
  CampaignAssetLinkVisibility,
  CampaignAssetLinkCreate,
} from "../engine/sidecar-stub";
import type {
  AgencyCampaignBlock,
  AgencyCampaignPatch,
  AgencyCampaignType,
  WhopRewardSnapshot,
} from "../engine/sidecar-stub";
import "./steps.css";

/* ───────────────────────────── Step 1 ───────────────────────────── */

export interface StepConnectRewardProps {
  campaign: AgencyCampaignBlock | null;
  /** URL-first patch · URL is canonical · id is optional bonus. */
  onConnect: (input: { rewardUrl: string | null; rewardId: string | null; snapshot: WhopRewardSnapshot | null }) => Promise<void>;
  onInitialize: (input: { rewardUrl: string | null; rewardId: string | null; snapshot: WhopRewardSnapshot | null }) => Promise<void>;
  saving: boolean;
}

/** Whop's reward-creation dashboard URL. Stored here as a constant so
 *  a Whop rename is a one-line patch. Per the v1 brief: external Whop
 *  creation is the INTENDED safe flow, not a fallback. */
const WHOP_CREATE_REWARD_URL = "https://whop.com/dashboard/links/checkout";

export function StepConnectReward({ campaign, onConnect, onInitialize, saving }: StepConnectRewardProps) {
  const [input, setInput] = useState(campaign?.whopRewardUrl ?? campaign?.whopRewardId ?? "");
  const reward = useWhopReward();
  const [pasted, setPasted] = useState(false);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInput(text);
        setPasted(true);
        setTimeout(() => setPasted(false), 1200);
      }
    } catch {
      bus.emit("toast", { kind: "info", title: "Paste manually", body: "Browser blocked clipboard access. Paste with Cmd-V." });
    }
  }, []);

  const looksLikeUrl = (s: string) => /^https?:\/\//i.test(s.trim());

  /** URL-first patch · "Validate reward" tries enrichment. The user is
   *  free to skip it entirely · "Use this URL anyway" advances without
   *  validate. Neither path is treated as a failure. */
  const handleValidate = useCallback(async () => {
    if (!input.trim()) return;
    const r = await reward.validate(input);
    // URL-first patch · ALWAYS advance with whatever we have. The id is
    // optional. The URL is the source of truth.
    const rewardUrl = looksLikeUrl(input) ? input.trim() : null;
    const payload = { rewardUrl, rewardId: r.rewardId, snapshot: r.snapshot };
    if (campaign) {
      await onConnect(payload);
    } else {
      await onInitialize(payload);
    }
  }, [input, reward, campaign, onConnect, onInitialize]);

  /** URL-first patch · "Use this URL anyway" · skips validate and
   *  connects the URL straight through. Used when the agency knows the
   *  reward URL works but our App API Key can't enrich it (REST-only
   *  rewards, Partner-gated rewards, etc). */
  const handleUseUrlAnyway = useCallback(async () => {
    if (!input.trim()) return;
    const rewardUrl = looksLikeUrl(input) ? input.trim() : null;
    if (!rewardUrl) {
      bus.emit("toast", {
        kind: "info",
        title: "Paste a URL",
        body: "“Use this URL anyway” needs the full Whop reward URL.",
      });
      return;
    }
    const payload = { rewardUrl, rewardId: null, snapshot: null };
    if (campaign) {
      await onConnect(payload);
    } else {
      await onInitialize(payload);
    }
  }, [input, campaign, onConnect, onInitialize]);

  const handleOpenWhop = useCallback(() => {
    bus.emit("browse:open", {
      url: WHOP_CREATE_REWARD_URL,
      source: "campaign",
      mirror: "whop",
      title: "Create reward in Whop",
    });
  }, []);

  /** Show "Use this URL anyway" CTA whenever validate ran but couldn't
   *  extract an id, OR when the input is clearly a URL but the agency
   *  hasn't validated yet. */
  const showUseUrlAnyway =
    looksLikeUrl(input) &&
    (reward.result?.snapshotStatus === "not_attempted" ||
      reward.result?.snapshotStatus === "not_enriched" ||
      reward.result?.snapshotStatus === "unreachable" ||
      reward.result === null);

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Connect a Whop reward</h3>
        <p className="lc-step-sub">
          Whop Clipping Rewards are URL-first · the URL is the source of
          truth for funding, payout, and approval. Liquid Clips wraps
          the campaign experience around it.
        </p>
      </header>

      {/* Two co-equal options · NEITHER is "coming soon" */}
      <div className="lc-step-options">
        {/* Option A · Paste existing */}
        <GlassCard density="default" className="lc-step-option">
          <span className="lc-step-option-eb">Option A</span>
          <h4 className="lc-step-option-h">Connect existing Whop reward</h4>
          <p className="lc-step-option-body">Paste a Whop reward/bounty URL or id.</p>
          <div className="lc-step-input-row">
            <input
              type="text"
              className="lc-step-input"
              placeholder="https://whop.com/.../b_xxxxxxxx  or  bnty_xxxxxxxx"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={saving || reward.validating}
            />
            <button
              type="button"
              className={`lc-step-paste ${pasted ? "is-pasted" : ""}`}
              onClick={handlePaste}
              title="Paste from clipboard"
              aria-label="Paste from clipboard"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3" y="3" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <rect x="5.5" y="0.7" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="rgba(8,8,14,.9)" />
              </svg>
              <span>{pasted ? "Pasted" : "Paste"}</span>
            </button>
          </div>
          <div className="lc-step-cta-row">
            <button
              type="button"
              className="lc-step-cta-primary"
              onClick={handleValidate}
              disabled={saving || reward.validating || !input.trim()}
            >
              {reward.validating ? "Validating…" : "Validate reward"}
            </button>
            {showUseUrlAnyway && (
              <button
                type="button"
                className="lc-step-cta-secondary"
                onClick={handleUseUrlAnyway}
                disabled={saving || !input.trim()}
                title="Skip Whop snapshot fetch · use the URL as the source of truth"
              >
                Use this URL anyway →
              </button>
            )}
          </div>
          <span className="lc-step-option-note">
            “Validate” is bonus enrichment · skip it any time. The URL is
            the source of truth.
          </span>
        </GlassCard>

        {/* Option B · Create in Whop · co-equal · NOT "coming soon" */}
        <GlassCard density="default" className="lc-step-option is-create">
          <span className="lc-step-option-eb">Option B</span>
          <h4 className="lc-step-option-h">Create reward in Whop</h4>
          <p className="lc-step-option-body">
            Open Whop in your browser, create + fund a new reward, then
            return here and paste the URL into Option A.
          </p>
          <button type="button" className="lc-step-cta-primary" onClick={handleOpenWhop}>
            Open Whop ↗
          </button>
          <span className="lc-step-option-note">
            Whop's reward dashboard handles funding + sharing settings.
          </span>
        </GlassCard>
      </div>

      {/* Result preview · URL-first patch · always shows after validate,
          whether or not enrichment succeeded. */}
      {reward.result && (
        <div className="lc-step-result">
          <WhopRewardCard
            rewardId={reward.rewardId}
            rewardUrl={looksLikeUrl(input) ? input.trim() : null}
            rewardState={reward.rewardState}
            snapshotStatus={reward.snapshotStatus}
            snapshot={reward.snapshot}
            syncedAt={campaign?.whopRewardSyncedAt}
            lastError={reward.error}
            variant="full"
          />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Step 2 ───────────────────────────── */

export function StepTitleDescription({
  campaign,
  snapshot,
  onSave,
}: {
  campaign: AgencyCampaignBlock | null;
  snapshot: WhopRewardSnapshot | null;
  onSave: (payload: AgencyCampaignPatch) => Promise<void>;
}) {
  const [title, setTitle] = useState(campaign?.title ?? snapshot?.title ?? "");
  const [description, setDescription] = useState(campaign?.description ?? snapshot?.description ?? "");
  const [campaignType, setCampaignType] = useState<AgencyCampaignType>(
    campaign?.campaignType ?? snapshotToCampaignType(snapshot?.businessGoalType),
  );

  const handleSave = async () => {
    await onSave({ title, description, campaignType });
  };

  const whopUrl = campaign?.whopRewardUrl ?? null;
  const handleOpenWhopReward = () => {
    if (!whopUrl) return;
    bus.emit("browse:open", { url: whopUrl, mirror: "whop", source: "campaign" });
  };

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Title + brief</h3>
        <p className="lc-step-sub">
          The brief is what clippers read in-app · write it by hand so it
          mirrors the Whop reward rules exactly.
        </p>
      </header>

      <label className="lc-step-field">
        <span className="lc-step-label">Campaign title</span>
        <input className="lc-step-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {/* URL-first patch · "Mirror the Whop reward rules" subsection.
          The brief is the source clippers read inside Liquid Clips · we
          do NOT scrape Whop · the agency types this once, by hand. */}
      <div className="lc-step-mirror">
        <div className="lc-step-mirror-head">
          <span className="lc-step-mirror-eb">Mirror the Whop reward rules</span>
          {whopUrl && (
            <button type="button" className="lc-step-mirror-link" onClick={handleOpenWhopReward}>
              Open Whop reward to copy rules ↗
            </button>
          )}
        </div>
        <p className="lc-step-mirror-body">
          Whop owns funding + payout · Liquid Clips owns the brief clippers
          read in-app. Paste the reward rules here verbatim so clippers see
          the same eligibility, deadlines, and pay-out terms.
        </p>
      </div>

      <label className="lc-step-field">
        <span className="lc-step-label">Brief · mirror the Whop reward rules</span>
        <textarea
          className="lc-step-textarea"
          rows={7}
          placeholder="Eligibility · platforms · post requirements · deadline · payout per accepted submission · cap · …"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="lc-step-field">
        <span className="lc-step-label">Campaign type</span>
        <div className="lc-step-type-row">
          {(["clip", "coordination", "affiliate", "submission"] as AgencyCampaignType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`lc-step-type-chip ${campaignType === t ? "is-active" : ""}`}
              onClick={() => setCampaignType(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {snapshot?.businessGoalType && (
          <span className="lc-step-hint">
            Whop suggests <strong>{snapshot.businessGoalType.replace(/_/g, " ")}</strong> · maps to{" "}
            <strong>{snapshotToCampaignType(snapshot.businessGoalType)}</strong>.
          </span>
        )}
      </label>

      <div className="lc-step-foot">
        <button type="button" className="lc-step-cta-primary" onClick={handleSave}>
          Save + continue
        </button>
      </div>
    </div>
  );
}

function snapshotToCampaignType(goal: string | undefined): AgencyCampaignType {
  switch (goal) {
    case "clipping": return "clip";
    case "post_engagement":
    case "local_activation": return "coordination";
    case "owned_account_growth": return "affiliate";
    case "ugc_content":
    case "other":
    default: return "submission";
  }
}

/* ───────────────────────────── Step 3 ───────────────────────────── */

export function StepBannerThumb({
  campaign,
  onSave,
}: {
  campaign: AgencyCampaignBlock | null;
  onSave: (payload: AgencyCampaignPatch) => Promise<void>;
}) {
  const presets = [
    { url: "/brand/decks/workspace.png", label: "Workspace" },
    { url: "/brand/decks/upload.png", label: "Upload" },
    { url: "/brand/decks/earn.png", label: "Earn" },
    { url: "/brand/decks/learn.png", label: "Learn" },
    { url: "/brand/sponsored/thumb-creator.png", label: "Creator" },
    { url: "/brand/sponsored/thumb-business.png", label: "Business" },
    { url: "/brand/sponsored/thumb-tech.png", label: "Tech" },
    { url: "/brand/sponsored/thumb-fitness.png", label: "Fitness" },
  ];
  const [selected, setSelected] = useState(campaign?.bannerUrl ?? presets[0].url);

  const handleSave = async () => {
    await onSave({ bannerUrl: selected });
  };

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Banner</h3>
        <p className="lc-step-sub">Pick a banner from the brand library.</p>
      </header>

      <div className="lc-step-banner-grid">
        {presets.map((p) => (
          <button
            key={p.url}
            type="button"
            className={`lc-step-banner ${selected === p.url ? "is-selected" : ""}`}
            onClick={() => setSelected(p.url)}
          >
            <img src={p.url} alt={p.label} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <div className="lc-step-foot">
        <button type="button" className="lc-step-cta-primary" onClick={handleSave}>
          Save + continue
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Step 4 ─────────────────────────────
 *
 * P1-4 · Brief-link inline CRUD. Replaces the read-only display.
 *
 * Hard rules honored:
 *   - Link rows only · no Drive/Dropbox OAuth · no ingestion · no
 *     file picker · no upload infrastructure · no new schema.
 *   - Reuses useCampaignAssetLinks(slug) (Phase 6N-D v1) for all
 *     CRUD. No new endpoints. No new backend code.
 *   - The clipper-facing CampaignAssetLinksList / CampaignAssetLinkRow
 *     (read-only display in CampaignPageShell §6) is NOT modified.
 */

const ASSET_TYPE_OPTIONS: CampaignAssetLinkType[] = [
  "google_drive", "dropbox", "whop", "direct_url", "upload_note",
];

const ASSET_TYPE_LABEL: Record<CampaignAssetLinkType, string> = {
  google_drive: "Drive",
  dropbox:      "Dropbox",
  whop:         "Whop",
  direct_url:   "Link",
  upload_note:  "Note",
};

const VISIBILITY_OPTIONS: CampaignAssetLinkVisibility[] = ["all", "joined", "approved"];

const VISIBILITY_LABEL: Record<CampaignAssetLinkVisibility, string> = {
  all:      "All",
  joined:   "Joined",
  approved: "Approved",
};

/** Pure validation. No network. Returns user-facing error or null. */
function validateAssetLink(p: {
  type: CampaignAssetLinkType;
  title: string;
  url: string;
  notes: string;
}): string | null {
  const title = p.title.trim();
  const url = p.url.trim();
  const notes = p.notes.trim();
  if (!title) return "Title is required.";
  if (p.type === "upload_note") {
    if (!notes) return "Upload notes need a note body.";
    return null;
  }
  if (!url) return "URL is required.";
  if (!/^https?:\/\//i.test(url)) return "URL must start with http:// or https://";
  return null;
}

interface AssetLinkDraft {
  type: CampaignAssetLinkType;
  title: string;
  url: string;
  notes: string;
  required: boolean;
  visibility: CampaignAssetLinkVisibility;
}

function emptyDraft(): AssetLinkDraft {
  return {
    type: "google_drive",
    title: "",
    url: "",
    notes: "",
    required: false,
    visibility: "all",
  };
}

export function StepBriefLinks({ campaign }: { campaign: AgencyCampaignBlock | null }) {
  const slug = campaign?.slug ?? null;
  const api = useCampaignAssetLinks(slug);
  const [draft, setDraft] = useState<AssetLinkDraft>(emptyDraft());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AssetLinkDraft>(emptyDraft());

  /* Step 1 must succeed before assets can attach · slug is the FK. */
  if (!slug) {
    return (
      <div className="lc-step-body">
        <header className="lc-step-head">
          <h3 className="lc-step-title">Brief links / assets</h3>
          <p className="lc-step-sub">
            Paste links clippers need: Drive folders, Dropbox folders, Whop posts,
            brand kits, notes, or source footage. Liquid Clips opens them externally.
            We do not ingest files in v1.
          </p>
        </header>
        <div className="lc-step-empty">
          <p>Connect a Whop reward in Step 1 first · brief links attach to a campaign slug.</p>
        </div>
      </div>
    );
  }

  const handleAdd = async () => {
    const err = validateAssetLink(draft);
    if (err) { setValidationError(err); return; }
    setValidationError(null);
    const payload: CampaignAssetLinkCreate = {
      type: draft.type,
      title: draft.title.trim(),
      url: draft.type === "upload_note" ? "" : draft.url.trim(),
      notes: draft.notes.trim() || null,
      required: draft.required,
      visibility: draft.visibility,
      sortOrder: (api.links[api.links.length - 1]?.sortOrder ?? 0) + 1,
    };
    const created = await api.createLink(payload);
    if (created) {
      setDraft(emptyDraft());
      bus.emit("toast", { kind: "success", title: "Brief link added", body: created.title });
    }
  };

  const startEdit = (id: string) => {
    const existing = api.links.find((l) => l.id === id);
    if (!existing) return;
    setEditDraft({
      type: existing.type,
      title: existing.title,
      url: existing.url ?? "",
      notes: existing.notes ?? "",
      required: existing.required,
      visibility: existing.visibility,
    });
    setEditingId(id);
    setValidationError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const err = validateAssetLink(editDraft);
    if (err) { setValidationError(err); return; }
    setValidationError(null);
    await api.patchLink(editingId, {
      type: editDraft.type,
      title: editDraft.title.trim(),
      url: editDraft.type === "upload_note" ? "" : editDraft.url.trim(),
      notes: editDraft.notes.trim() || null,
      required: editDraft.required,
      visibility: editDraft.visibility,
    });
    setEditingId(null);
  };

  const handleRemove = async (id: string) => {
    const target = api.links.find((l) => l.id === id);
    if (!target) return;
    const ok = await api.removeLink(id);
    if (ok) {
      bus.emit("toast", { kind: "info", title: "Removed", body: target.title });
      if (editingId === id) setEditingId(null);
    }
  };

  const handleMove = async (id: string, direction: -1 | 1) => {
    const idx = api.links.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= api.links.length) return;
    const next = [...api.links];
    [next[idx], next[target]] = [next[target], next[idx]];
    await api.reorderLinks(next.map((l, i) => ({ id: l.id, sortOrder: i + 1 })));
  };

  const showUrl = draft.type !== "upload_note";

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Brief links / assets</h3>
        <p className="lc-step-sub">
          Paste links clippers need: Drive folders, Dropbox folders, Whop posts,
          brand kits, notes, or source footage. Liquid Clips opens them externally.
          We do not ingest files in v1.
        </p>
      </header>

      {/* Add form */}
      <GlassCard density="default" className="lc-step-bl-add">
        <span className="lc-step-bl-eb">Add a brief link</span>

        <div className="lc-step-bl-row-grid">
          <label className="lc-step-bl-field">
            <span className="lc-step-bl-label">Type</span>
            <div className="lc-step-bl-chip-row">
              {ASSET_TYPE_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`lc-step-bl-chip ${draft.type === t ? "is-active" : ""}`}
                  onClick={() => setDraft({ ...draft, type: t })}
                >
                  {ASSET_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </label>

          <label className="lc-step-bl-field">
            <span className="lc-step-bl-label">Title</span>
            <input
              type="text"
              className="lc-step-input"
              placeholder="What clippers will see"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>

          {showUrl && (
            <label className="lc-step-bl-field">
              <span className="lc-step-bl-label">URL</span>
              <input
                type="url"
                className="lc-step-input"
                placeholder="https://…"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </label>
          )}

          <label className="lc-step-bl-field">
            <span className="lc-step-bl-label">
              Notes {draft.type === "upload_note" ? "· required" : "· optional"}
            </span>
            <textarea
              className="lc-step-textarea"
              rows={2}
              placeholder={draft.type === "upload_note" ? "Tell clippers what to upload" : "Optional context"}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>

          <label className="lc-step-bl-field">
            <span className="lc-step-bl-label">Required</span>
            <button
              type="button"
              className={`lc-step-bl-toggle ${draft.required ? "is-on" : ""}`}
              onClick={() => setDraft({ ...draft, required: !draft.required })}
              aria-pressed={draft.required}
            >
              {draft.required ? "Required" : "Optional"}
            </button>
          </label>

          <label className="lc-step-bl-field">
            <span className="lc-step-bl-label">Visibility</span>
            <div className="lc-step-bl-chip-row">
              {VISIBILITY_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`lc-step-bl-chip ${draft.visibility === v ? "is-active" : ""}`}
                  onClick={() => setDraft({ ...draft, visibility: v })}
                >
                  {VISIBILITY_LABEL[v]}
                </button>
              ))}
            </div>
          </label>
        </div>

        {validationError && !editingId && (
          <p className="lc-step-bl-error">{validationError}</p>
        )}

        <div className="lc-step-cta-row">
          <button
            type="button"
            className="lc-step-cta-primary"
            onClick={handleAdd}
          >
            Add link
          </button>
          <button
            type="button"
            className="lc-step-cta-secondary"
            onClick={() => { setDraft(emptyDraft()); setValidationError(null); }}
          >
            Clear
          </button>
        </div>
      </GlassCard>

      {/* Existing links · edit/remove/reorder inline */}
      {api.loading ? (
        <div className="lc-step-loading">Loading…</div>
      ) : api.error ? (
        <div className="lc-step-error">{api.error}</div>
      ) : api.links.length === 0 ? (
        <div className="lc-step-empty">
          <p>No brief links yet · use the form above to add the first one.</p>
        </div>
      ) : (
        <div className="lc-step-bl-list">
          {api.links.map((link, i) => {
            const isEditing = editingId === link.id;
            if (isEditing) {
              const showEditUrl = editDraft.type !== "upload_note";
              return (
                <GlassCard key={link.id} density="default" className="lc-step-bl-row is-editing">
                  <div className="lc-step-bl-row-grid">
                    <label className="lc-step-bl-field">
                      <span className="lc-step-bl-label">Type</span>
                      <div className="lc-step-bl-chip-row">
                        {ASSET_TYPE_OPTIONS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`lc-step-bl-chip ${editDraft.type === t ? "is-active" : ""}`}
                            onClick={() => setEditDraft({ ...editDraft, type: t })}
                          >
                            {ASSET_TYPE_LABEL[t]}
                          </button>
                        ))}
                      </div>
                    </label>
                    <label className="lc-step-bl-field">
                      <span className="lc-step-bl-label">Title</span>
                      <input
                        type="text"
                        className="lc-step-input"
                        value={editDraft.title}
                        onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                      />
                    </label>
                    {showEditUrl && (
                      <label className="lc-step-bl-field">
                        <span className="lc-step-bl-label">URL</span>
                        <input
                          type="url"
                          className="lc-step-input"
                          value={editDraft.url}
                          onChange={(e) => setEditDraft({ ...editDraft, url: e.target.value })}
                        />
                      </label>
                    )}
                    <label className="lc-step-bl-field">
                      <span className="lc-step-bl-label">
                        Notes {editDraft.type === "upload_note" ? "· required" : "· optional"}
                      </span>
                      <textarea
                        className="lc-step-textarea"
                        rows={2}
                        value={editDraft.notes}
                        onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                      />
                    </label>
                    <label className="lc-step-bl-field">
                      <span className="lc-step-bl-label">Required</span>
                      <button
                        type="button"
                        className={`lc-step-bl-toggle ${editDraft.required ? "is-on" : ""}`}
                        onClick={() => setEditDraft({ ...editDraft, required: !editDraft.required })}
                        aria-pressed={editDraft.required}
                      >
                        {editDraft.required ? "Required" : "Optional"}
                      </button>
                    </label>
                    <label className="lc-step-bl-field">
                      <span className="lc-step-bl-label">Visibility</span>
                      <div className="lc-step-bl-chip-row">
                        {VISIBILITY_OPTIONS.map((v) => (
                          <button
                            key={v}
                            type="button"
                            className={`lc-step-bl-chip ${editDraft.visibility === v ? "is-active" : ""}`}
                            onClick={() => setEditDraft({ ...editDraft, visibility: v })}
                          >
                            {VISIBILITY_LABEL[v]}
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                  {validationError && (
                    <p className="lc-step-bl-error">{validationError}</p>
                  )}
                  <div className="lc-step-cta-row">
                    <button type="button" className="lc-step-cta-primary" onClick={handleSaveEdit}>Save</button>
                    <button type="button" className="lc-step-cta-secondary" onClick={() => { setEditingId(null); setValidationError(null); }}>Cancel</button>
                  </div>
                </GlassCard>
              );
            }
            return (
              <GlassCard key={link.id} density="quiet" className={`lc-step-bl-row is-${link.type}`}>
                <div className="lc-step-bl-row-head">
                  <span className={`lc-step-bl-type-pill is-${link.type}`}>{ASSET_TYPE_LABEL[link.type]}</span>
                  {link.required && <span className="lc-step-bl-required-pill">Required</span>}
                  <span className={`lc-step-bl-vis-pill is-${link.visibility}`}>{VISIBILITY_LABEL[link.visibility]}</span>
                </div>
                <h4 className="lc-step-bl-row-title">{link.title}</h4>
                {link.url && link.type !== "upload_note" && (
                  <span className="lc-step-bl-row-url" title={link.url}>{link.url}</span>
                )}
                {link.notes && (
                  <p className="lc-step-bl-row-notes">{link.notes}</p>
                )}
                <div className="lc-step-bl-row-actions">
                  <button
                    type="button"
                    className="lc-step-bl-icon-btn"
                    onClick={() => handleMove(link.id, -1)}
                    disabled={i === 0}
                    title="Move up"
                    aria-label="Move up"
                  >↑</button>
                  <button
                    type="button"
                    className="lc-step-bl-icon-btn"
                    onClick={() => handleMove(link.id, 1)}
                    disabled={i === api.links.length - 1}
                    title="Move down"
                    aria-label="Move down"
                  >↓</button>
                  <button
                    type="button"
                    className="lc-step-bl-icon-btn"
                    onClick={() => startEdit(link.id)}
                    title="Edit"
                    aria-label="Edit"
                  >Edit</button>
                  <button
                    type="button"
                    className="lc-step-bl-icon-btn is-danger"
                    onClick={() => handleRemove(link.id)}
                    title="Remove"
                    aria-label="Remove"
                  >Remove</button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Step 5 ───────────────────────────── */

export function StepDiscussion({
  campaign,
  onSave,
}: {
  campaign: AgencyCampaignBlock | null;
  onSave: (payload: AgencyCampaignPatch) => Promise<void>;
}) {
  const community = useCommunity();
  const [selected, setSelected] = useState(campaign?.businessUnit ?? "");

  const channels = community.channels.filter((c) => c.whop_channel_id);

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Discussion</h3>
        <p className="lc-step-sub">Pick the Whop chat that mirrors this campaign discussion.</p>
      </header>

      <div className="lc-step-channels">
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`lc-step-channel ${selected === c.business_unit ? "is-selected" : ""}`}
            onClick={() => setSelected(c.business_unit ?? "")}
          >
            <span className="lc-step-channel-name">{c.name}</span>
            <span className="lc-step-channel-tier">{c.required_tier}</span>
          </button>
        ))}
      </div>

      <div className="lc-step-foot">
        <button type="button" className="lc-step-cta-primary" onClick={() => onSave({ businessUnit: selected })}>
          Save + continue
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Step 6 ───────────────────────────── */

export function StepTargeting({
  campaign,
  snapshot,
  onSave,
}: {
  campaign: AgencyCampaignBlock | null;
  snapshot: WhopRewardSnapshot | null;
  onSave: (payload: AgencyCampaignPatch) => Promise<void>;
}) {
  const [tiers, setTiers] = useState<string[]>(campaign?.visibilityTiers ?? ["free", "solo", "pro", "agency"]);
  const [requiredTier, setRequiredTier] = useState(campaign?.requiredTier ?? "");

  const allTiers = ["free", "solo", "pro", "agency"];

  const platforms: string[] = [];
  if (snapshot?.allowYoutube) platforms.push("youtube");
  if (snapshot?.allowTiktok) platforms.push("tiktok");
  if (snapshot?.allowInstagram) platforms.push("instagram");
  if (snapshot?.allowX) platforms.push("x");

  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Targeting + visibility</h3>
        <p className="lc-step-sub">Platforms come from Whop. Tiers come from Liquid Clips.</p>
      </header>

      <div className="lc-step-field">
        <span className="lc-step-label">Whop-allowed platforms (read-only)</span>
        <div className="lc-step-platform-row">
          {platforms.length === 0 ? (
            <span className="lc-step-hint">Whop reward doesn't restrict platforms.</span>
          ) : (
            platforms.map((p) => (
              <span key={p} className="lc-step-platform-chip">{p}</span>
            ))
          )}
        </div>
      </div>

      <div className="lc-step-field">
        <span className="lc-step-label">Visible to tiers</span>
        <div className="lc-step-tier-row">
          {allTiers.map((t) => (
            <button
              key={t}
              type="button"
              className={`lc-step-tier-chip ${tiers.includes(t) ? "is-active" : ""}`}
              onClick={() => setTiers(tiers.includes(t) ? tiers.filter((x) => x !== t) : [...tiers, t])}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="lc-step-field">
        <span className="lc-step-label">Required tier (optional)</span>
        <div className="lc-step-tier-row">
          {["", ...allTiers].map((t) => (
            <button
              key={t || "none"}
              type="button"
              className={`lc-step-tier-chip ${requiredTier === t ? "is-active" : ""}`}
              onClick={() => setRequiredTier(t)}
            >
              {t || "none"}
            </button>
          ))}
        </div>
      </div>

      <div className="lc-step-foot">
        <button type="button" className="lc-step-cta-primary" onClick={() => onSave({ visibilityTiers: tiers, requiredTier })}>
          Save + continue
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Step 7 ───────────────────────────── */

export function StepFeatured({ onSave }: { onSave: (payload: AgencyCampaignPatch) => Promise<void> }) {
  const [missionLane, setMissionLane] = useState("");
  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Featured / sponsored (optional)</h3>
        <p className="lc-step-sub">Featured + sponsored billing wire-up lands in a later phase. Skip this step in v1.</p>
      </header>
      <label className="lc-step-field">
        <span className="lc-step-label">Mission lane (optional)</span>
        <input className="lc-step-input" placeholder="brand / main / training / sponsor" value={missionLane} onChange={(e) => setMissionLane(e.target.value)} />
      </label>
      <div className="lc-step-foot">
        <button type="button" className="lc-step-cta-primary" onClick={() => onSave({ missionLane: missionLane || undefined })}>
          Save + continue
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Step 8 ───────────────────────────── */

export function StepReviewPublish({
  campaign,
  publishing,
  publishErrors,
  onPublish,
  onRefresh,
}: {
  campaign: AgencyCampaignBlock | null;
  publishing: boolean;
  publishErrors: string[] | null;
  onPublish: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  if (!campaign) {
    return <div className="lc-step-body">No campaign loaded.</div>;
  }
  return (
    <div className="lc-step-body">
      <header className="lc-step-head">
        <h3 className="lc-step-title">Review + publish</h3>
        <p className="lc-step-sub">
          URL-first publish gate · URL + title + brief + type. Whop snapshot
          is bonus, never required.
        </p>
      </header>

      <WhopRewardCard
        rewardId={campaign.whopRewardId}
        rewardUrl={campaign.whopRewardUrl}
        rewardState={campaign.whopRewardState ?? "unlinked"}
        snapshotStatus={campaign.whopRewardSnapshotStatus}
        snapshot={campaign.whopRewardSnapshot}
        syncedAt={campaign.whopRewardSyncedAt}
        lastError={campaign.whopRewardLastError}
        onRefresh={onRefresh}
        variant="full"
      />

      <div className="lc-step-review-grid">
        <ReviewRow label="Slug" value={campaign.slug} />
        <ReviewRow label="Title" value={campaign.title} />
        <ReviewRow label="Type" value={campaign.campaignType} />
        <ReviewRow label="Status" value={campaign.status.replace("_", " ")} />
        <ReviewRow label="Tiers" value={campaign.visibilityTiers.join(", ")} />
        {campaign.requiredTier && <ReviewRow label="Required tier" value={campaign.requiredTier} />}
      </div>

      {publishErrors && publishErrors.length > 0 && (
        <div className="lc-step-publish-errors">
          <span className="lc-step-publish-errors-eb">Publish gate failed</span>
          <ul>
            {publishErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="lc-step-foot">
        {/* 2026-06-23 monetisation pass · Publish/Launch is the
         *  commitment point. Below Agency, the button still RENDERS and
         *  the draft is fully reviewable above; clicking it fires the
         *  campaign-specific upgrade flow instead of POSTing the publish:
         *    1. notifyCampaignPublishBlocked(campaignName) → inbox
         *    2. billing.adapter.startCheckout("agency") → checkout
         *  Agency users get the real onPublish handler. */}
        <PublishCtaGated
          campaignName={campaign.title || campaign.slug}
          publishing={publishing}
          onPublish={onPublish}
        />
      </div>
    </div>
  );
}

function PublishCtaGated({
  campaignName,
  publishing,
  onPublish,
}: {
  campaignName: string;
  publishing: boolean;
  onPublish: () => Promise<void>;
}) {
  const billing = useBillingState();
  return (
    <PaywallGate
      requiredTier="agency"
      action="Launch campaign"
      onUpgrade={() => {
        notifyCampaignPublishBlocked(campaignName);
        void billing.adapter.startCheckout("agency");
      }}
    >
      <button type="button" className="lc-step-cta-primary" onClick={onPublish} disabled={publishing}>
        {publishing ? "Publishing…" : "Publish campaign"}
      </button>
    </PaywallGate>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="lc-step-review-row">
      <span className="lc-step-review-label">{label}</span>
      <span className="lc-step-review-value">{value}</span>
    </div>
  );
}
