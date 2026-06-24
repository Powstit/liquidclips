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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { bus, useEvent } from "../bridge";
import { useModalPortal } from "./ModalPortal";
import { FIXTURE_PROJECT, type Clip, type Platform } from "../engine/types";
import { STATUS_LABEL, STATUS_TONE, type ClipStatus } from "../engine/clipCardStatus";
import { WhopBoundaryCard } from "./WhopBoundaryCard";
import { getJwt } from "../../lib/authStorage";
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

/* FEATURE-002 · scrubbed named-campaign fixture. The slug/url shape
 * matches what Batch D will return once the real Whop campaign feed
 * is wired · this preview just shows generic copy. */
const FIXTURE_CAMPAIGN = {
  slug: "preview-campaign",
  label: "Preview campaign",
  whopRewardUrl: "https://whop.com/",
};

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
  const [open, setOpen] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [platform, setPlatform] = useState<"tiktok" | "youtube" | "instagram" | "x">("tiktok");
  const [postUrl, setPostUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  useEvent("clip:open-submit", (p) => {
    const c = FIXTURE_PROJECT.clips.find((x) => x.idx === p.clipIdx);
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    setClip(null);
    setUrlError(null);
  }

  async function submit() {
    if (!clip) return;
    if (!looksLikeUrl(postUrl)) {
      setUrlError("Paste the full post URL — looks like a https:// link.");
      return;
    }

    // 2026-06-24 · BEFORE the bus events fire (which optimistically flip the
    // grid card to "submitted"), attempt the real POST /submissions backend
    // call. The clipper sees the optimistic UI immediately; if the backend
    // rejects (404 campaign · 400 watermark detected · 429 rate-limit ·
    // 412 daily cap), we surface the error and revert via the bus.
    //
    // Payload matches junior-backend submissions.SubmissionCreateRequest:
    //   campaign_id · clip_url (HttpUrl) · moment_type · disclosure_confirmed
    // The campaign_id is the slug; moment_type defaults to "viral" until the
    // UI surfaces a per-campaign picker.

    // Fire optimistic UI first so the modal closes responsively.
    bus.emit("clip:status-change", { clipIdx: clip.idx, status: "submitted" });
    bus.emit("clip:submitted", {
      clipIdx: clip.idx,
      campaignSlug: FIXTURE_CAMPAIGN.slug,
      platform,
      postUrl: postUrl.trim(),
      whopRewardUrl: FIXTURE_CAMPAIGN.whopRewardUrl,
    });
    bus.emit("toast", {
      kind: "info",
      title: "Submitting to Whop…",
      body: `${clip.title} · sending to backend`,
    });
    close();

    // Real backend POST · runs in the background so the modal stays snappy.
    // Failure rolls back the optimistic status flip via a clip:status-change
    // event back to "ready" and surfaces an error toast.
    try {
      const jwt = getJwt();
      if (!jwt) {
        // No JWT · honest fail · revert + warn. The user can re-submit after
        // signing back in.
        bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
        bus.emit("toast", {
          kind: "warning",
          title: "Sign in required",
          body: "Sign in to submit a clip to a Whop content reward.",
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
          campaign_id: FIXTURE_CAMPAIGN.slug,
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
        let detail = "";
        try { detail = (await r.json())?.detail || ""; } catch { /* noop */ }
        bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
        bus.emit("toast", {
          kind: "warning",
          title: "Submission rejected",
          body: detail || `Backend returned ${r.status}. Try again.`,
        });
      }
    } catch (err) {
      // Network failure · revert + surface honest error.
      bus.emit("clip:status-change", { clipIdx: clip.idx, status: "ready" });
      bus.emit("toast", {
        kind: "warning",
        title: "Couldn't reach backend",
        body: err instanceof Error ? err.message : "Network error · try again.",
      });
    }
  }

  function openWhop() {
    bus.emit("browse:open", {
      url: FIXTURE_CAMPAIGN.whopRewardUrl,
      source: "campaign",
      mirror: "whop",
      title: FIXTURE_CAMPAIGN.label,
    });
  }

  if (!open || !clip || !modalHost) return null;

  // Show the predicted next status (always "submitted" for this modal).
  const currentStatus: ClipStatus = (clip.status as ClipStatus) ?? "ready";
  const dur = clip.duration_s ?? Math.max(1, clip.end - clip.start);

  return createPortal(
    <div className="lc-stwm-root" role="dialog" aria-label="Submit to Whop">
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

        {/* Campaign row */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Campaign</span>
          <div className="lc-stwm-campaign">{FIXTURE_CAMPAIGN.label}</div>
        </div>

        {/* Whop reward URL */}
        <div className="lc-stwm-field">
          <span className="lc-stwm-lbl">Whop reward</span>
          <div className="lc-stwm-row">
            <code className="lc-stwm-url">{FIXTURE_CAMPAIGN.whopRewardUrl}</code>
            <button type="button" className="lc-stwm-ghost" onClick={openWhop}>
              Open on Whop ↗
            </button>
          </div>
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

        {/* Footer CTAs */}
        <footer className="lc-stwm-foot">
          <button type="button" className="lc-stwm-ghost" onClick={close}>Cancel</button>
          <button
            type="button"
            className="lc-stwm-primary"
            onClick={submit}
            disabled={!postUrl.trim()}
          >Submit</button>
        </footer>
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
