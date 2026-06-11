// Submission portal modal (sprint #14c — Minecraft Story Clip Challenge).
//
// Two-step flow:
//   1. Form — clip URL, source URL, moment type, hook, why, permission,
//      disclosure confirmation.
//   2. Result — success acknowledgment OR watermark-rejection with one-tap
//      upgrade CTA.
//
// Server-side watermark detection runs in POST /submissions; on a 422 with
// `code: watermark_detected`, the WatermarkDetectedError carries the upgrade
// URL we surface here. Cannot be bypassed by the client.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, Lock, X } from "lucide-react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { humanError } from "../../lib/sidecar";
import {
  createSubmission,
  listActiveCampaigns,
  type CampaignDescriptor,
  type MomentType,
  type PermissionType,
  WatermarkDetectedError,
} from "../../lib/backend";
import heroImg from "../../assets/minecraft/hero.png";
import momentsGrid from "../../assets/minecraft/moments-grid.png";
import { track } from "../../lib/analytics";

const MOMENT_LABELS: Record<MomentType, string> = {
  betrayal: "Betrayal",
  war_declaration: "War declaration",
  villain_speech: "Villain speech",
  underdog_victory: "Underdog victory",
  emotional_confession: "Emotional confession",
  friendship: "Friendship",
  moral_choice: "Moral choice",
  final_battle: "Final battle",
  plot_twist: "Plot twist",
  lore_reveal: "Lore reveal",
  funny_moment: "Funny moment",
};

const PERMISSION_LABELS: Record<PermissionType, string> = {
  my_own_footage: "My own Minecraft footage",
  creator_licensed: "Creator who publicly licenses clipping",
  transformative_commentary: "Public commentary / reaction with my own framing",
};

type State =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "watermarked"; reason: string; upgradeUrl: string }
  | { kind: "success"; submissionId: string }
  | { kind: "error"; message: string };

export function SubmissionPortal({ onClose }: { onClose: () => void }) {
  const [campaigns, setCampaigns] = useState<CampaignDescriptor[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [loadingCampaign, setLoadingCampaign] = useState(true);
  const [state, setState] = useState<State>({ kind: "form" });

  // Form fields
  const [clipUrl, setClipUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [momentType, setMomentType] = useState<MomentType>("betrayal");
  const [hookTimestamp, setHookTimestamp] = useState("");
  const [whyThisMoment, setWhyThisMoment] = useState("");
  const [permissionType, setPermissionType] = useState<PermissionType>("my_own_footage");
  const [disclosureConfirmed, setDisclosureConfirmed] = useState(false);

  const campaign = campaigns.find((c) => c.id === selectedCampaignId) ?? campaigns[0] ?? null;

  useEffect(() => {
    track("mc_submission_portal_opened");
    let cancelled = false;
    void (async () => {
      const list = await listActiveCampaigns();
      if (!cancelled) {
        setCampaigns(list);
        if (list.length > 0) {
          setSelectedCampaignId(list[0].id);
        }
        setLoadingCampaign(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keyboard trap fix — Escape closes the modal so keyboard-only users can
  // exit. Without this, Tab + Esc were dead ends because the close button was
  // the only escape route and required mouse navigation through the hero strip.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!campaign) return;
    track("mc_submission_attempted", { campaign_id: campaign.id, moment_type: momentType });
    setState({ kind: "submitting" });
    try {
      const result = await createSubmission({
        campaign_id: campaign.id,
        clip_url: clipUrl,
        source_url: sourceUrl || undefined,
        moment_type: momentType,
        hook_timestamp: hookTimestamp || undefined,
        why_this_moment: whyThisMoment || undefined,
        permission_type: permissionType,
        disclosure_confirmed: disclosureConfirmed,
      });
      track("mc_submission_accepted", { campaign_id: campaign.id, moment_type: momentType });
      setState({ kind: "success", submissionId: result.id });
    } catch (e) {
      if (e instanceof WatermarkDetectedError) {
        track("mc_submission_blocked_watermark", { campaign_id: campaign.id });
        setState({ kind: "watermarked", reason: e.message, upgradeUrl: e.upgradeUrl });
        return;
      }
      track("mc_submission_failed_network", { campaign_id: campaign.id });
      setState({ kind: "error", message: humanError(e) });
    }
  }

  const canSubmit =
    !!campaign &&
    clipUrl.trim().length > 0 &&
    momentType.length > 0 &&
    permissionType.length > 0 &&
    disclosureConfirmed;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-paper/85 backdrop-blur-md p-6"
      onClick={onClose}
      role="presentation"
    >
      {/* Task #69 — HUD chrome wrap for the campaign submission modal.
          Frame sits on the outer container so corner brackets paint
          outside the overflow-y-auto scroller. See docs/RPO_VISUAL_LANGUAGE.md. */}
      <div
        className="hud-frame relative w-full max-w-3xl"
        style={{ borderRadius: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-3xl border border-line bg-paper shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
        {/* Hero strip */}
        <div className="relative h-36 overflow-hidden rounded-t-3xl">
          <img src={heroImg} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/40 to-transparent" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-paper/90 text-text-secondary backdrop-blur-sm hover:bg-paper hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-7 pb-7 pt-1">
          {loadingCampaign ? (
            <CampaignLoading />
          ) : !campaign ? (
            <NoCampaign onClose={onClose} />
          ) : state.kind === "success" ? (
            <SuccessState
              submissionId={state.submissionId}
              onClose={onClose}
              onSubmitAnother={() => {
                setClipUrl("");
                setSourceUrl("");
                setMomentType("betrayal");
                setHookTimestamp("");
                setWhyThisMoment("");
                setPermissionType("my_own_footage");
                setDisclosureConfirmed(false);
                setState({ kind: "form" });
              }}
            />
          ) : state.kind === "watermarked" ? (
            <WatermarkedState
              reason={state.reason}
              upgradeUrl={state.upgradeUrl}
              onBack={() => setState({ kind: "form" })}
            />
          ) : (
            <FormBody
              campaign={campaign}
              campaigns={campaigns}
              selectedCampaignId={selectedCampaignId}
              onSelectCampaign={setSelectedCampaignId}
              clipUrl={clipUrl}
              setClipUrl={setClipUrl}
              sourceUrl={sourceUrl}
              setSourceUrl={setSourceUrl}
              momentType={momentType}
              setMomentType={setMomentType}
              hookTimestamp={hookTimestamp}
              setHookTimestamp={setHookTimestamp}
              whyThisMoment={whyThisMoment}
              setWhyThisMoment={setWhyThisMoment}
              permissionType={permissionType}
              setPermissionType={setPermissionType}
              disclosureConfirmed={disclosureConfirmed}
              setDisclosureConfirmed={setDisclosureConfirmed}
              onSubmit={() => void submit()}
              submitting={state.kind === "submitting"}
              error={state.kind === "error" ? state.message : null}
              canSubmit={canSubmit}
            />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ── Sub-views ────────────────────────────────────────────────────────────

function CampaignLoading() {
  return (
    <div className="grid place-items-center py-16">
      <Loader2 className="animate-spin text-fuchsia" size={28} />
    </div>
  );
}

function NoCampaign({ onClose }: { onClose: () => void }) {
  return (
    <div className="py-12 text-center">
      <h2 className="font-display text-[22px] font-semibold text-ink">No active campaigns right now</h2>
      <p className="mt-2 font-sans text-[14px] text-text-secondary">
        Check back soon — new sponsored campaigns launch every few weeks.
      </p>
      <button
        onClick={onClose}
        className="mt-5 rounded-full bg-ink px-5 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia"
      >
        Close
      </button>
    </div>
  );
}

function FormBody({
  campaign,
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  clipUrl, setClipUrl,
  sourceUrl, setSourceUrl,
  momentType, setMomentType,
  hookTimestamp, setHookTimestamp,
  whyThisMoment, setWhyThisMoment,
  permissionType, setPermissionType,
  disclosureConfirmed, setDisclosureConfirmed,
  onSubmit, submitting, error, canSubmit,
}: {
  campaign: CampaignDescriptor;
  campaigns: CampaignDescriptor[];
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string) => void;
  clipUrl: string; setClipUrl: (v: string) => void;
  sourceUrl: string; setSourceUrl: (v: string) => void;
  momentType: MomentType; setMomentType: (v: MomentType) => void;
  hookTimestamp: string; setHookTimestamp: (v: string) => void;
  whyThisMoment: string; setWhyThisMoment: (v: string) => void;
  permissionType: PermissionType; setPermissionType: (v: PermissionType) => void;
  disclosureConfirmed: boolean; setDisclosureConfirmed: (v: boolean) => void;
  onSubmit: () => void; submitting: boolean; error: string | null; canSubmit: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia-deep">
          {campaign.title} · ${campaign.rpm_usd.toFixed(2)} rpm
        </p>
        <h2 className="mt-1 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Submit a clip
        </h2>
        <p className="mt-1 font-sans text-[13px] text-text-secondary">
          Earned per 1,000 verified views. Daily best: ${campaign.daily_bonus_usd}. Weekly winner: ${campaign.weekly_bonus_usd}.
        </p>
      </header>

      {campaigns.length > 1 && (
        <Field label="Campaign" required>
          <select
            value={selectedCampaignId ?? ""}
            onChange={(e) => onSelectCampaign(e.target.value)}
            className="w-full rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-sans text-[13px] text-ink focus:border-fuchsia focus:outline-none"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Clip URL (the public post on TikTok/Reels/YouTube Shorts)" required>
        <input
          type="url"
          value={clipUrl}
          onChange={(e) => setClipUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@you/video/..."
          className="w-full rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none focus:shadow-[var(--glow-sm)]"
        />
      </Field>

      <Field label="Source video URL (the long-form video you clipped from)">
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none focus:shadow-[var(--glow-sm)]"
        />
      </Field>

      <Field label="Moment type" required>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {campaign.moment_types.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMomentType(m)}
              className={`rounded-xl border px-3 py-2 font-sans text-[11px] font-medium transition-colors ${
                m === momentType
                  ? "border-fuchsia bg-fuchsia-soft text-fuchsia-deep"
                  : "border-line bg-paper-elev text-text-secondary hover:border-fuchsia/50 hover:text-ink"
              }`}
            >
              {MOMENT_LABELS[m as MomentType] ?? m}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Hook timestamp (when in your clip the moment lands)">
          <input
            type="text"
            value={hookTimestamp}
            onChange={(e) => setHookTimestamp(e.target.value)}
            placeholder="0:03"
            className="w-full rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
          />
        </Field>
        <Field label="Source permission" required>
          <select
            value={permissionType}
            onChange={(e) => setPermissionType(e.target.value as PermissionType)}
            className="w-full rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-sans text-[13px] text-ink focus:border-fuchsia focus:outline-none"
          >
            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Why did this moment matter? (1-2 sentences)">
        <textarea
          value={whyThisMoment}
          onChange={(e) => setWhyThisMoment(e.target.value)}
          rows={2}
          maxLength={600}
          placeholder="The alliance breaks the second Pearl confesses she's been spying for the other faction…"
          className="w-full resize-none rounded-xl border border-line bg-paper-elev px-4 py-2.5 font-sans text-[13px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
        />
      </Field>

      <label className="flex items-start gap-3 rounded-xl border border-line bg-paper-elev p-3.5 hover:border-fuchsia/50">
        <input
          type="checkbox"
          checked={disclosureConfirmed}
          onChange={(e) => setDisclosureConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-fuchsia"
        />
        <span className="font-sans text-[13px] leading-snug text-ink">
          My clip caption or video description includes <span className="font-mono text-fuchsia-deep">#ad</span> or <span className="font-mono text-fuchsia-deep">#sponsored</span>.{" "}
          <span className="text-text-tertiary">(FTC compliance — required.)</span>
        </span>
      </label>

      {error && (
        <p className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3 font-mono text-[11px] text-[var(--color-danger-bright)]">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <><Loader2 size={14} className="animate-spin" /> Checking your clip…</>
        ) : (
          <>Submit clip</>
        )}
      </button>

      <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        Submissions run a watermark check. Free-tier exports are rejected — upgrade to Solo or Pro for clean export.
      </p>
    </div>
  );
}

function WatermarkedState({
  reason,
  upgradeUrl,
  onBack,
}: {
  reason: string;
  upgradeUrl: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full border border-fuchsia bg-fuchsia-soft text-fuchsia-deep">
        <Lock size={28} strokeWidth={2.25} />
      </span>
      <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Free-tier watermark detected
      </h2>
      <p className="max-w-md font-sans text-[14px] leading-relaxed text-text-secondary">
        {reason}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => {
            track("mc_upgrade_cta_clicked", { source: "watermark_rejected" });
            void openExternal(upgradeUrl);
          }}
          className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
        >
          Upgrade to remove watermark
          <ExternalLink size={14} strokeWidth={2.25} />
        </button>
        <button
          onClick={onBack}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-tertiary hover:text-ink"
        >
          Back to form
        </button>
      </div>
      <img
        src={momentsGrid}
        alt=""
        className="mt-6 w-full rounded-2xl opacity-30"
      />
    </div>
  );
}

function SuccessState({
  submissionId,
  onClose,
  onSubmitAnother,
}: {
  submissionId: string;
  onClose: () => void;
  onSubmitAnother: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full border border-fuchsia bg-fuchsia-soft text-fuchsia-deep">
        <Check size={28} strokeWidth={2.25} />
      </span>
      <h2 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        Clip submitted
      </h2>
      <p className="max-w-md font-sans text-[14px] leading-relaxed text-text-secondary">
        Your clip passed the watermark check. We're reviewing it for the campaign — you'll see status updates in the Earn tab.
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        submission id · {submissionId.slice(0, 12)}…
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onClose}
          className="rounded-full border border-line bg-paper px-5 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia"
        >
          Close
        </button>
        <button
          onClick={onSubmitAnother}
          className="rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia-bright"
        >
          Submit another clip
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
        {label}
        {required && <span className="ml-1 text-fuchsia">*</span>}
      </span>
      {children}
    </label>
  );
}

// AlertTriangle is unused but imported intentionally for future error-state polish
void AlertTriangle;
