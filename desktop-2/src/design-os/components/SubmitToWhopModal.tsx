/**
 * SubmitToWhopModal · UI-3
 *
 * Slides up when a ClipCard Submit button fires `clip:open-submit`. Stays in
 * the workstation — the clipper should not feel like they left the workflow.
 *
 * Content (per spec):
 *   - Selected clip preview (thumbnail + title + duration + status pill)
 *   - Campaign name (single-fixture for UI-3; multi-select in Batch D)
 *   - Whop reward URL block + "Open on Whop" → emits `browse:open`
 *   - Platform posted on (single-select chips)
 *   - Post URL input (validated)
 *   - Boundary copy: "Liquid Clips prepares the submission. Whop handles
 *     approval and payout."
 *   - Status arrow: Ready → Submitted
 *   - Cancel · Submit (disabled until post URL valid)
 *
 * Mock-only · on submit, emits `clip:status-change` + `clip:submitted` and
 * closes. Batch D POSTs to the real Whop endpoint.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { bus, useEvent } from "../bridge";
import { useModalPortal, useRegisterModal } from "./ModalPortal";
import { FIXTURE_PROJECT, type Clip, type Platform } from "../engine/types";
import { useEngineSession } from "../state/useEngineSession";
import { STATUS_LABEL, STATUS_TONE, type ClipStatus } from "../engine/clipCardStatus";
import { WhopBoundaryCard } from "./WhopBoundaryCard";
import { getJwt } from "../../lib/authStorage";
import { useCampaigns } from "../state/useCampaigns";
import { useUserMode } from "../../shell/modeStore";
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
  const [open, setOpen] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [platform, setPlatform] = useState<"tiktok" | "youtube" | "instagram" | "x">("tiktok");
  const [postUrl, setPostUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  /* Journey/campaigns-earn (2026-07-09) · resolve the ACTIVE campaign
   * from the mode-store. `activeCampaignId` holds a slug once the clipper
   * has opened a campaign from the Campaigns route (see
   * routes/Campaigns.tsx:setActiveCampaignId). When null, no campaign is
   * selected and the primary submission CTA is disabled with an honest
   * reason. */
  const activeCampaignId = modeState.activeCampaignId;
  const activeCampaign = activeCampaignId
    ? (camps.getBySlug(activeCampaignId) ?? camps.getById(activeCampaignId))
    : null;
  const activeCampaignLabel = activeCampaign?.title ?? null;
  const activeWhopRewardUrl =
    activeCampaign?.whopRewardUrl ?? activeCampaign?.whopUrl ?? null;
  const hasCampaign = !!activeCampaign;
  const hasWhopReward = !!activeWhopRewardUrl;

  useEvent("clip:open-submit", (p) => {
    // Ship-lens Batch 2 P1-BATCH2-003 fix (2026-07-06) · was reading
    // clip metadata unconditionally from FIXTURE_PROJECT.clips even
    // when a real bake had populated session.project.clips · the
    // Whop submission dialog surfaced fixture title/idx/platforms.
    // Prefer the live session · fall through to fixture only when no
    // project is loaded (preview / dev harness).
    const clips = session.project?.clips ?? FIXTURE_PROJECT.clips;
    const c = clips.find((x) => x.idx === p.clipIdx);
    if (!c) return;
    setClip(c);
    setOpen(true);
    // The Whop submission event only supports the four short-video platforms.
    const SUBMIT_PLATFORMS = new Set<Platform>(["tiktok", "youtube", "instagram", "x"]);
    const firstSubmittable = (c.platforms ?? []).find((x) => SUBMIT_PLATFORMS.has(x));
    setPlatform((firstSubmittable as "tiktok" | "youtube" | "instagram" | "x" | undefined) ?? "tiktok");
    setPostUrl("");
    setUrlError(null);
  });

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · LIFO modal
  // registration replaces the ad-hoc Esc useEffect · avoids
  // double-dismiss when a nested confirm modal opens on top.
  useRegisterModal({ id: "submit-to-whop-designos", open, onEscape: () => close() });

  function close() {
    setOpen(false);
    setClip(null);
    setUrlError(null);
  }

  async function submit() {
    if (!clip) return;
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

    // 2026-06-24 · BEFORE the bus events fire (which optimistically flip the
    // grid card to "submitted"), attempt the real POST /submissions backend
    // call. The clipper sees the optimistic UI immediately; if the backend
    // rejects (404 campaign · 400 watermark detected · 429 rate-limit ·
    // 412 daily cap), we surface the error and revert via the bus.
    //
    // Payload matches junior-backend submissions.SubmissionCreateRequest:
    //   campaign_id · clip_url (HttpUrl) · moment_type · disclosure_confirmed
    // The campaign_id is the real active-campaign slug; moment_type
    // defaults to "viral" until the UI surfaces a per-campaign picker.

    // Fire optimistic UI first so the modal closes responsively.
    bus.emit("clip:status-change", { clipIdx: clip.idx, status: "submitted" });
    bus.emit("clip:submitted", {
      clipIdx: clip.idx,
      campaignSlug: activeCampaign.slug,
      platform,
      postUrl: postUrl.trim(),
      whopRewardUrl: activeWhopRewardUrl,
    });
    bus.emit("toast", {
      kind: "info",
      title: "Submitting to Whop…",
      body: `${clip.title} · sending to backend`,
    });
    close();

    // Real backend POST · runs in the background so the modal stays snappy.
    // Failure rolls back the optimistic status flip via a clip:status-change
    // event back to "ready" and surfaces an error toast with plain-English
    // copy (no raw stack traces).
    try {
      const jwt = getJwt();
      if (!jwt) {
        // No JWT · honest fail · revert + warn. Customer-safe copy
        // (2026-07-09) — clipper voice, banned word "bounty" swapped
        // for "paid post" language via `Sign in again` framing.
        bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
        bus.emit("toast", {
          kind: "warning",
          title: "Sign in again",
          body: "Your session ran out. Sign in and re-submit — your clip is still saved.",
        });
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
          disclosure_confirmed: true,
        }),
      });
      if (r.status === 201 || r.status === 200) {
        bus.emit("toast", {
          kind: "success",
          title: "Submitted to Whop",
          body: `${clip.title} · waiting on review`,
        });
      } else {
        // 2026-07-09 · customer-safe rejection copy. No raw status
        // codes surfaced to users. Backend `detail` (already human)
        // wins when present. Plain-English map for the common
        // submission-reject codes; no fake success.
        let detail = "";
        try { detail = (await r.json())?.detail || ""; } catch { /* noop */ }
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
        } else if (r.status === 429) {
          title = "Slow down a bit";
          body = detail || "Too many submissions right now. Wait a minute and try again.";
        }
        bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
        bus.emit("toast", { kind: "warning", title, body });
      }
    } catch (err) {
      // 2026-07-09 · route through the customer-safe classifier so
      // network failures never leak a raw `TypeError: Failed to fetch`
      // or a stack trace. Technical detail stays in the diagnostic
      // ring for the Settings → Beta diagnostics drawer.
      bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
      void (async () => {
        try {
          const mod = await import("../errors/customerSafeErrors");
          const safe = mod.humanErrorToast(err, { scenario: "whop" });
          bus.emit("toast", { kind: safe.kind, title: safe.title, body: safe.body });
        } catch {
          bus.emit("toast", {
            kind: "warning",
            title: "Network hiccup",
            body: "Couldn't reach the server. Check your Wi-Fi and try again.",
          });
        }
      })();
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
          const disableReason = !hasCampaign
            ? "Open a paid campaign from the Campaigns tab first."
            : !hasWhopReward
              ? "This campaign hasn't connected a Whop reward URL yet."
              : !postUrl.trim()
                ? "Paste the URL of the post you published."
                : null;
          const disabled = disableReason !== null;
          return (
            <footer className="lc-stwm-foot">
              <button type="button" className="lc-stwm-ghost" onClick={close}>Cancel</button>
              <button
                type="button"
                className="lc-stwm-primary"
                onClick={submit}
                disabled={disabled}
                title={disableReason ?? "Send this submission to Whop"}
                data-testid="stwm-submit"
                data-disabled-reason={disableReason ?? ""}
              >
                Submit
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
