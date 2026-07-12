/**
 * SubmitToWhopModal · UI-3 · AU-B-1 prop-driven consolidation (2026-07-10).
 *
 * Slides up when a ClipCard / PublishModule button fires
 * `clip:open-submit { clipIdx, campaignId? }`. Stays in the workstation
 * — the clipper should not feel like they left the workflow.
 *
 * AU-B-1 · No FIXTURE_CAMPAIGN, no preview-campaign string, no default
 * campaignId fallback. The modal takes campaignId from the emitter (or
 * the mode-store as a legacy fallback while call sites migrate). No
 * submission ever fires without:
 *   - A real, resolved campaign (matched via
 *     `useCampaigns().getBySlug|getById`)
 *   - A linked Whop identity (`me.snapshot?.whopUserId`)
 * When either is missing, the CTA is disabled with a plain-English
 * reason. Backend rejects surface the real HTTP status/detail — no
 * fake "Submitted" toast.
 *
 * `submission_created { campaign_id, whop_user_id }` fires via lcDiag
 * on a successful backend 201/200 so HQ can walk the funnel from
 * clip:open-submit → submission_created.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { bus, useEvent } from "../bridge";
import { useModalPortal, useRegisterModal } from "./ModalPortal";
import type { Clip, Platform } from "../engine/types";
import { lcDiag } from "../../lib/diagnosticLogger";
import { useEngineSession } from "../state/useEngineSession";
import { STATUS_LABEL, STATUS_TONE, type ClipStatus } from "../engine/clipCardStatus";
import { WhopBoundaryCard } from "./WhopBoundaryCard";
import { getJwt } from "../../lib/authStorage";
import { useCampaigns } from "../state/useCampaigns";
import { useUserMode } from "../../shell/modeStore";
import { useMe } from "../state/useMe";
// Wave D1 · j015-runtime-update · treat submissions as protected
// under j004-connect-whop. Open modal OR in-flight submit blocks
// the RestartGate.
import { useProtectedJourney } from "../../lib/protectedJourney";
import "./SubmitToWhopModal.css";

// 2026-06-24 · backend URL helper · mirrors the pattern used in sidecar-stub
// for /channels and /schedules POSTs. Single env var override for staging.
function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/* Journey/campaigns-earn (2026-07-09) · removed the placeholder-slug
 * fixture campaign. Submit-to-Whop now REQUIRES a real active campaign
 * resolved via the mode-store (set when a clipper opens a campaign
 * detail page from the Campaigns route). No fake slug ships to prod:
 *   · When there's no active campaign → the primary CTA is disabled
 *     with plain-English copy explaining why.
 *   · When there's no Whop reward URL on the resolved campaign →
 *     same disabled treatment, honest reason.
 *   · Backend rejects surface the real HTTP status/detail — no fake
 *     "Submitted" toast.
 */

const PLATFORM_OPTIONS: ReadonlyArray<{ id: "tiktok" | "youtube" | "instagram" | "x"; label: string }> = [
  { id: "tiktok",    label: "TikTok" },
  { id: "youtube",   label: "YouTube" },
  { id: "instagram", label: "Instagram" },
  { id: "x",         label: "X" },
];

/**
 * R1 (2026-07-11) · permission_type is REQUIRED by the backend model
 * (`SubmissionCreateRequest.permission_type` in
 * `junior-backend/app/routes/submissions.py`). Enum values match the
 * `PermissionType` Literal on the Pydantic side — any drift here
 * → 422 on every submit. Keep in lockstep.
 */
type PermissionType = "my_own_footage" | "creator_licensed" | "transformative_commentary";

const PERMISSION_OPTIONS: ReadonlyArray<{ id: PermissionType; label: string; hint: string }> = [
  { id: "my_own_footage",              label: "My own footage",         hint: "I filmed / created this myself." },
  { id: "creator_licensed",            label: "Used with permission",   hint: "The creator gave me the green light." },
  { id: "transformative_commentary",   label: "Fair use / commentary",  hint: "Reaction, review, or transformative edit." },
];

function looksLikeUrl(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 10) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch { return false; }
}

export function SubmitToWhopModal() {
  const modalHost = useModalPortal();
  const session = useEngineSession();
  const camps = useCampaigns();
  const modeState = useUserMode();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [platform, setPlatform] = useState<"tiktok" | "youtube" | "instagram" | "x">("tiktok");
  const [postUrl, setPostUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  // R1 (2026-07-11) · permission_type is a required backend field.
  // No default — the clipper MUST pick one so we're not lying about
  // provenance on their behalf. Reset on close/open.
  const [permissionType, setPermissionType] = useState<PermissionType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // AU-B-1 · campaignId passed through by the `clip:open-submit`
  // emitter. When the caller supplies one (e.g. Campaigns row click
  // → PublishModule), it wins over the mode-store fallback. `null`
  // means "no campaign explicitly picked by this invocation."
  const [propCampaignId, setPropCampaignId] = useState<string | null>(null);

  // Wave D1 · j015-runtime-update · register the Whop connect
  // journey while the modal is open OR a POST is in flight. Blocks
  // the mandatory RestartGate mid-submit so the user's paid-post
  // ceremony is never interrupted by an update.
  useProtectedJourney("j004-connect-whop", open || submitting);

  // Gate 2 · Path B (2026-07-10) · new users MUST link Whop identity before
  // they can submit to any paid Whop job. Honest attribution requires
  // `users.whop_user_id` to be non-null on the backend row — otherwise the
  // submission goes into Junior's DB unattributed and the user sees
  // "pending → paid" that never moves. Block the CTA with a plain-English
  // reason until Whop identity is linked (populated by the Whop webhook
  // on first paid transaction). Loading state defaults to blocked so we
  // don't accidentally allow an unverified submit during hydrate.
  const hasWhopIdentity = !!me.snapshot?.whopUserId;
  const whopIdentityLoading = me.loading && !me.snapshot;

  /* AU-B-1 (2026-07-10) · campaignId is prop-driven. Priority:
   *   1. The `campaignId` passed on the `clip:open-submit` event (set
   *      by Campaigns row click → PublishModule emit path).
   *   2. Mode-store `activeCampaignId` as a legacy fallback for
   *      call sites that pre-date the event-level campaign_id (e.g.
   *      the ClipCard direct-submit flow when a campaign is already
   *      "active" from a prior route landing).
   *   3. Otherwise null — the modal never fabricates a slug + the
   *      CTA stays disabled with "Pick a campaign first."
   *
   * No preview-campaign, no default fallback, no FIXTURE_CAMPAIGN. If
   * neither source resolves a real campaign, the primary CTA is
   * disabled with an honest reason. */
  const activeCampaignId = propCampaignId ?? modeState.activeCampaignId;
  const activeCampaign = activeCampaignId
    ? (camps.getBySlug(activeCampaignId) ?? camps.getById(activeCampaignId))
    : null;
  const activeCampaignLabel = activeCampaign?.title ?? null;
  const activeWhopRewardUrl =
    activeCampaign?.whopRewardUrl ?? activeCampaign?.whopUrl ?? null;
  const hasCampaign = !!activeCampaign;
  const hasWhopReward = !!activeWhopRewardUrl;

  useEvent("clip:open-submit", (p) => {
    // Phase 2 finalization · Option B production-fixture-audit fix
    // (2026-07-10) · previously fell through to FIXTURE_PROJECT.clips
    // when session.project was null, which pushed the RickRoll URL
    // and "Uncle Daniel — Wednesday drop" strings into the production
    // bundle via SubmitToWhopModal even in production paths. Now the
    // modal refuses to open without a real session project, matching
    // the AU-B-1 prop-driven contract that campaigns must be real.
    if (!session.project?.clips) {
      lcDiag("submission_modal_blocked", { reason: "no_session_project" });
      return;
    }
    const c = session.project.clips.find((x) => x.idx === p.clipIdx);
    if (!c) return;
    setClip(c);
    setOpen(true);
    // AU-B-1 · adopt the caller-supplied campaignId when present.
    // Null clears any stale prop from a prior invocation.
    setPropCampaignId(p.campaignId ?? null);
    // The Whop submission event only supports the four short-video platforms.
    const SUBMIT_PLATFORMS = new Set<Platform>(["tiktok", "youtube", "instagram", "x"]);
    const firstSubmittable = (c.platforms ?? []).find((x) => SUBMIT_PLATFORMS.has(x));
    setPlatform((firstSubmittable as "tiktok" | "youtube" | "instagram" | "x" | undefined) ?? "tiktok");
    setPostUrl("");
    setUrlError(null);
    setPermissionType(null);
    setSubmitting(false);
  });

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · LIFO modal
  // registration replaces the ad-hoc Esc useEffect · avoids
  // double-dismiss when a nested confirm modal opens on top.
  useRegisterModal({ id: "submit-to-whop-designos", open, onEscape: () => close() });

  function close() {
    setOpen(false);
    setClip(null);
    setUrlError(null);
    setPropCampaignId(null);
    setPermissionType(null);
    setSubmitting(false);
  }

  async function submit() {
    if (!clip || submitting) return;
    // Gate 2 · Path B (2026-07-10) · block unattributed submits. New users
    // without a Whop identity would post a clip Junior can record but never
    // route to the Whop reward — the "pending → paid" cycle would never
    // move, and the clipper would think they're earning when they're not.
    // Refuse the submit and prompt Whop verification.
    if (!hasWhopIdentity) {
      setUrlError(
        "Verify your Whop account first · Submissions can't be paid out until your Whop identity is linked. " +
        "Buy any Whop plan (from $1) to link your account, then come back."
      );
      return;
    }
    // Journey/campaigns-earn (2026-07-09) · guard the real inputs.
    // Fake-submit protection: refuse to POST without a real campaign_id +
    // a validated post URL. No optimistic status flip runs before the
    // guard — the clipper never sees "Submitted" if we can't actually
    // reach the backend with a real campaign.
    if (!activeCampaign) {
      setUrlError("Open a paid campaign from the Campaigns tab, then come back to submit.");
      return;
    }
    if (!activeWhopRewardUrl) {
      setUrlError("This campaign has no Whop reward URL yet — the agency hasn't connected one, so submissions can't route.");
      return;
    }
    if (!looksLikeUrl(postUrl)) {
      setUrlError("Paste the full post URL — looks like a https:// link.");
      return;
    }
    // R1 (2026-07-11) · permission_type is a backend-required field.
    // A missing value → 422 before the row is written. Guard here so
    // the clipper picks it explicitly instead of the client fabricating
    // a default.
    if (!permissionType) {
      setUrlError("Pick how you got this footage — we won't file a permission claim on your behalf.");
      return;
    }

    // Diagnostic probe · logs which real campaign the submit references.
    try {
      const mod = await import("../../lib/diagnosticLogger");
      mod.lcDiag("whop_submit_prepare", {
        clip_idx: clip.idx,
        clip_title: (clip.title ?? "").slice(0, 60),
        campaign_id: activeCampaign.slug,
        campaign_source: camps.source,
        platform,
        post_url_len: postUrl.trim().length,
        has_jwt: !!getJwt(),
        active_project_slug: session.project?.slug ?? null,
        active_project_source: session.project ? "session.project" : "no_project_using_fixture",
      });
    } catch { /* logger import failed · non-fatal */ }

    // R1 (2026-07-11) · NO optimistic success. The prior wire fired
    // `submission_created` + a "Submitting to Whop…" toast BEFORE the
    // POST resolved, and the clipper watched "Submitted!" swap to
    // "Failed" on a 422. That's a lie about money state — the row
    // never landed. Wait for a real 2xx before we emit anything that
    // implies success, and keep the modal open + submitting so the
    // clipper knows we're still working.
    //
    // Payload matches junior-backend submissions.SubmissionCreateRequest:
    //   campaign_id · clip_url (HttpUrl) · moment_type ·
    //   permission_type · disclosure_confirmed
    // moment_type defaults to "viral" until the UI surfaces a
    // per-campaign picker (still on the R2/R3 sprint).

    setSubmitting(true);
    bus.emit("toast", {
      kind: "info",
      title: "Submitting to Whop…",
      body: `${clip.title} · sending to backend`,
    });

    try {
      const jwt = getJwt();
      if (!jwt) {
        // No JWT · honest fail · no optimistic state to revert. Customer
        // -safe copy (2026-07-09) — clipper voice, "Sign in again" fram
        // -ing.
        bus.emit("toast", {
          kind: "warning",
          title: "Sign in again",
          body: "Your session ran out. Sign in and re-submit — your clip is still saved.",
        });
        setSubmitting(false);
        return;
      }
      const r = await fetch(`${backendUrl()}/submissions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          campaign_id: activeCampaign.slug,
          clip_url: postUrl.trim(),
          moment_type: "viral",
          permission_type: permissionType,
          disclosure_confirmed: true,
        }),
      });
      if (r.status === 201 || r.status === 200) {
        // R1 (2026-07-11) · Confirmed 2xx — NOW flip the grid card,
        // emit the follow-through bus event, and fire the
        // `submission_created` HQ event. Prior wire fired all three
        // pre-flight and lied on 422. Order matters: status-change
        // first so ClipCard renders "Submitted" the instant the toast
        // lands.
        bus.emit("clip:status-change", { clipIdx: clip.idx, status: "submitted" });
        bus.emit("clip:submitted", {
          clipIdx: clip.idx,
          campaignSlug: activeCampaign.slug,
          platform,
          postUrl: postUrl.trim(),
          whopRewardUrl: activeWhopRewardUrl,
        });
        // AU-B-1 · HQ event · records the REAL campaign_id +
        // whop_user_id on every successful submission. `campaign_id`
        // is the resolved slug (matches the backend row), never the
        // preview/fixture prefix. Adds to Money Funnel HQ tab.
        try {
          const mod = await import("../../lib/diagnosticLogger");
          mod.lcDiag("submission_created", {
            campaign_id: activeCampaign.slug,
            whop_user_id: me.snapshot?.whopUserId ?? null,
          });
        } catch { /* logger import failed · non-fatal */ }
        bus.emit("toast", {
          kind: "success",
          title: "Submitted to Whop",
          body: `${clip.title} · waiting on review`,
        });
        close();
      } else {
        // 2026-07-09 · customer-safe rejection copy. No raw status
        // codes surfaced to users. Backend `detail` (already human)
        // wins when present. Plain-English map for the common
        // submission-reject codes; no fake success. Backend `detail`
        // may be a dict (watermark_detected payload) or a string.
        let detail = "";
        try {
          const payload: unknown = await r.json();
          const raw = (payload as { detail?: unknown })?.detail;
          if (typeof raw === "string") detail = raw;
          else if (raw && typeof raw === "object" && typeof (raw as { message?: unknown }).message === "string") {
            detail = (raw as { message: string }).message;
          }
        } catch { /* noop */ }
        let title = "Submission didn't send";
        let body = detail || `Whop didn't take the submission. Check the post URL and try again — your clip is still saved.`;
        if (r.status === 401 || r.status === 403) {
          title = "Sign in again";
          body = detail || "Your session ran out. Sign in and re-submit — your clip is still saved.";
        } else if (r.status === 404) {
          title = "Skill isn't live anymore";
          body = detail || "That paid post isn't running any more. Pick another from Earn.";
        } else if (r.status === 412) {
          title = "Daily cap hit";
          body = detail || "You've submitted the max for this skill today. Try again tomorrow.";
        } else if (r.status === 422) {
          title = "Fix the submission";
          body = detail || "Backend rejected the submission — check the post URL and required fields, then try again.";
        } else if (r.status === 429) {
          title = "Slow down a bit";
          body = detail || "Too many submissions right now. Wait a minute and try again.";
        }
        // R1 (2026-07-11) · Nothing to roll back — no optimistic
        // status flip fired. Surface the error inline so the clipper
        // stays in the modal + can fix + retry.
        setUrlError(body);
        bus.emit("toast", { kind: "warning", title, body });
        setSubmitting(false);
      }
    } catch (err) {
      // 2026-07-09 · route through the customer-safe classifier so
      // network failures never leak a raw `TypeError: Failed to fetch`
      // or a stack trace. Technical detail stays in the diagnostic
      // ring for the Settings → Beta diagnostics drawer.
      let safeTitle = "Network hiccup";
      let safeBody = "Couldn't reach the server. Check your Wi-Fi and try again.";
      let safeKind: "error" | "warning" | "info" = "warning";
      try {
        const mod = await import("../errors/customerSafeErrors");
        const safe = mod.humanErrorToast(err, { scenario: "whop" });
        safeTitle = safe.title;
        safeBody = safe.body;
        safeKind = safe.kind;
      } catch { /* noop · fall through to defaults */ }
      setUrlError(safeBody);
      bus.emit("toast", { kind: safeKind, title: safeTitle, body: safeBody });
      setSubmitting(false);
    }
  }

  function openWhop() {
    if (!activeWhopRewardUrl || !activeCampaign) return;
    bus.emit("browse:open", {
      url: activeWhopRewardUrl,
      source: "campaign",
      mirror: "whop",
      title: activeCampaign.title,
    });
  }

  if (!open || !clip || !modalHost) return null;

  // Show the predicted next status (always "submitted" for this modal).
  const currentStatus: ClipStatus = (clip.status as ClipStatus) ?? "ready";
  const dur = clip.duration_s ?? Math.max(1, clip.end - clip.start);

  return createPortal(
    <div className="lc-stwm-root" role="dialog" aria-modal="true" aria-label="Submit to Whop">
      <div className="lc-stwm-scrim" onClick={close} aria-hidden="true" />
      <div className="lc-stwm-panel">
        <header className="lc-stwm-head">
          <span className="lc-stwm-eb">Submit to Whop</span>
          <button type="button" className="lc-stwm-close" onClick={close} aria-label="Close">×</button>
        </header>

        {/* Clip preview */}
        <div className="lc-stwm-clip">
          {clip.vertical_path && (
            <img src={clip.vertical_path} alt="" className="lc-stwm-clip-thumb" />
          )}
          <div className="lc-stwm-clip-meta">
            <span className="lc-stwm-clip-title">{clip.title}</span>
            <span className="lc-stwm-clip-sub">
              {fmtSec(dur)} · LC {clip.score ?? "—"}
            </span>
            <span className={`lc-stwm-clip-status lc-clip-status-${STATUS_TONE[currentStatus]}`}>
              {STATUS_LABEL[currentStatus]}
            </span>
          </div>
        </div>

        {/* Campaign row · Journey/campaigns-earn (2026-07-09) · real
         *  active campaign resolved from mode-store. Empty state is
         *  honest: no fake "Preview campaign" label, no fake Whop URL. */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Campaign</span>
          <div
            className="lc-stwm-campaign"
            data-testid="stwm-active-campaign"
            data-campaign-slug={activeCampaign?.slug ?? "none"}
          >
            {activeCampaignLabel ?? "No campaign selected"}
          </div>
          {!hasCampaign && (
            <span className="lc-stwm-hint" data-testid="stwm-no-campaign-hint">
              Open a paid campaign from the Campaigns tab first — that's how we
              know which Whop reward this submission belongs to.
            </span>
          )}
        </div>

        {/* Whop reward URL */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Whop reward</span>
          {hasWhopReward ? (
            <div className="lc-stwm-row">
              <code className="lc-stwm-url">{activeWhopRewardUrl}</code>
              <button type="button" className="lc-stwm-ghost" onClick={openWhop}>
                Open on Whop ↗
              </button>
            </div>
          ) : (
            <span
              className="lc-stwm-hint"
              data-testid="stwm-no-whop-hint"
            >
              {hasCampaign
                ? "This campaign hasn't connected a Whop reward yet. Ask the agency to link one before submitting."
                : "The Whop reward URL appears once you pick a campaign."}
            </span>
          )}
        </div>

        {/* Platform posted on */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Posted on</span>
          <div className="lc-stwm-platforms" role="radiogroup">
            {PLATFORM_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={platform === opt.id}
                className={`lc-stwm-chip ${platform === opt.id ? "on" : ""}`}
                onClick={() => setPlatform(opt.id)}
              >{opt.label}</button>
            ))}
          </div>
        </div>

        {/* R1 (2026-07-11) · permission_type is a backend-required
         *  field. Every option maps 1:1 to the Pydantic enum in
         *  `submissions.py`. No default — the clipper picks so we
         *  don't file a permission claim for them. */}
        <div className="lc-stwm-field" data-testid="stwm-permission-field">
          <span className="lc-stwm-lbl">Where did this footage come from?</span>
          <div className="lc-stwm-platforms" role="radiogroup" aria-label="Footage permission">
            {PERMISSION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={permissionType === opt.id}
                className={`lc-stwm-chip ${permissionType === opt.id ? "on" : ""}`}
                onClick={() => { setPermissionType(opt.id); if (urlError) setUrlError(null); }}
                data-testid={`stwm-permission-${opt.id}`}
                title={opt.hint}
              >{opt.label}</button>
            ))}
          </div>
          {permissionType && (
            <span className="lc-stwm-hint">
              {PERMISSION_OPTIONS.find((o) => o.id === permissionType)?.hint}
            </span>
          )}
        </div>

        {/* Post URL */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Post URL</span>
          <input
            type="url"
            className={`lc-stwm-input ${urlError ? "err" : ""}`}
            placeholder="https://tiktok.com/@you/video/…"
            value={postUrl}
            onChange={(e) => { setPostUrl(e.target.value); if (urlError) setUrlError(null); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {urlError && <span className="lc-stwm-err">{urlError}</span>}
        </div>

        {/* Status arrow */}
        <div className="lc-stwm-arrow">
          <span className={`lc-stwm-chip-status lc-clip-status-${STATUS_TONE[currentStatus]}`}>
            {STATUS_LABEL[currentStatus]}
          </span>
          <span className="lc-stwm-arrow-line" aria-hidden="true">→</span>
          <span className="lc-stwm-chip-status lc-clip-status-fuchsia-glow">Submitted</span>
        </div>

        <WhopBoundaryCard variant="compact" />

        {/* Footer CTAs · Journey/campaigns-earn (2026-07-09) · honest
         *  disabled state. The primary button reveals WHY it's blocked
         *  via the title attribute so a hovered/keyboard user sees the
         *  reason. Reasons stack in a fixed priority order so the most
         *  actionable one surfaces first. */}
        {(() => {
          // Gate 2 · Path B (2026-07-10) · Whop identity guard sits FIRST
          // in the priority ladder. Users without linked Whop identity see
          // the "Verify" reason before anything else — no chance of typing
          // a post URL for a campaign they can't get paid on.
          const disableReason = whopIdentityLoading
            ? "Checking your Whop identity…"
            : !hasWhopIdentity
              ? "Verify your Whop account first — buy any Whop plan (from $1) to link, then re-open this."
              : !hasCampaign
                ? "Open a paid campaign from the Campaigns tab first."
                : !hasWhopReward
                  ? "This campaign hasn't connected a Whop reward URL yet."
                  : !postUrl.trim()
                    ? "Paste the URL of the post you published."
                    : !permissionType
                      ? "Pick how you got this footage."
                      : submitting
                        ? "Sending to Whop…"
                        : null;
          const disabled = disableReason !== null;
          return (
            <footer className="lc-stwm-foot">
              <button type="button" className="lc-stwm-ghost" onClick={close} disabled={submitting}>Cancel</button>
              <button
                type="button"
                className="lc-stwm-primary"
                onClick={submit}
                disabled={disabled}
                title={disableReason ?? "Send this submission to Whop"}
                data-testid="stwm-submit"
                data-disabled-reason={disableReason ?? ""}
              >
                {submitting
                  ? "Submitting…"
                  : !hasWhopIdentity && !whopIdentityLoading
                    ? "Verify Whop"
                    : "Submit"}
              </button>
            </footer>
          );
        })()}
      </div>
    </div>,
    modalHost,
  );
}

function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
