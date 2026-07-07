/**
 * Export types · Phase 6H
 *
 * Mirrors the legacy desktop/src/lib/sidecar.ts export contract shapes
 * and Phase 6G audit §11.4 + §12 specs for multi-account targets.
 *
 * - ExportFormat / ExportPreset reuse the Studio ExportPanel union shape.
 * - TargetAccount + AccountState · 11-state canonical spec (§12.3).
 * - ExportJob · one row per (clip × target account × time) tuple.
 */

import type { Platform } from "../engine/types";

export type ExportFormat = "9:16" | "1:1" | "16:9" | "original";

export type ExportPreset = "tiktok" | "reels" | "shorts" | "linkedin" | "custom";

/* ============================================================
   Target accounts · per §12 spec
   ============================================================ */

export type AccountState =
  | "no-accounts"
  | "connected"
  | "scheduled"
  | "uploading"
  | "posted"
  | "failed"
  | "retrying"
  | "account-expired"
  | "plan-limit-reached"
  | "campaign-account-locked"
  | "active-target"
  /** Phase 6I-A · channel-lifecycle state for OAuth handshake in flight
   *  or first-link pending the Ayrshare webhook confirmation. Distinct from
   *  "uploading" which describes a *job* state. */
  | "pending-link";

export interface TargetAccount {
  id: string;
  platform: Platform;
  label: string;
  handle: string;
  avatar?: string;
  state: AccountState;
  /** Scheduled time when state === "scheduled" or "retrying". ISO UTC. */
  scheduledFor?: string;
  /** Retry count when state === "retrying" or "failed". */
  retryCount?: number;
  /** Next retry ETA when state === "retrying". ISO UTC. */
  retryEta?: string;
  /** Post URL when state === "posted". */
  postUrl?: string;
  /** Brand badge — Phase 7 will derive from brand_id; Phase 6H uses display only. */
  brandLabel?: string;
}

/** Tier-driven cap for accounts targeted per clip (§12.4). */
export const ACCOUNTS_PER_CLIP_CAP: Record<"clipper" | "pro" | "agency", number> = {
  clipper: 1,
  pro: 3,
  agency: 10,
};

/* ============================================================
   Export job · matches legacy Schedule row shape (1 per target × time)
   ============================================================ */

export interface ExportJob {
  id: string;
  clipIdx: number;
  clipTitle: string;
  format: ExportFormat;
  preset: ExportPreset;
  watermark: boolean;
  targetAccountId?: string;
  createdAt: string;
  status: "queued" | "rendering" | "complete" | "failed" | "canceled";
  durationS?: number;
  errorMessage?: string;
  outputPath?: string;
}

/* ============================================================
   Fixtures · Phase 6H demo data
   ============================================================ */

export const FIXTURE_TARGET_ACCOUNTS: TargetAccount[] = [
  { id: "acc-1", platform: "tiktok",    label: "TikTok · @uncle.daniel",       handle: "@uncle.daniel",       avatar: "/brand/kade/kade-base.png",            state: "active-target", brandLabel: "Uncle Daniel" },
  { id: "acc-2", platform: "tiktok",    label: "TikTok · @uncle.daniel.cuts",  handle: "@uncle.daniel.cuts",  avatar: "/brand/kade/kade-create-clips.webp",   state: "scheduled", scheduledFor: new Date(Date.now() + 3 * 3600_000).toISOString(), brandLabel: "Uncle Daniel" },
  { id: "acc-3", platform: "instagram", label: "Instagram · @ddbeauty",        handle: "@ddbeauty",            avatar: "/brand/kade/kade-success.webp",        state: "connected", brandLabel: "Uncle Daniel" },
  { id: "acc-4", platform: "youtube",   label: "YouTube · Uncle Daniel Daily", handle: "Uncle Daniel Daily",   avatar: "/brand/kade/kade-reading-brief.webp",  state: "posted", postUrl: "https://youtu.be/example", brandLabel: "Uncle Daniel" },
  { id: "acc-5", platform: "x",         label: "X · @uncledaniel",             handle: "@uncledaniel",         state: "failed", retryCount: 1, brandLabel: "Uncle Daniel" },
  { id: "acc-6", platform: "linkedin",  label: "LinkedIn · Daniel Diyepriye",  handle: "Daniel Diyepriye",     state: "retrying", retryCount: 2, retryEta: new Date(Date.now() + 4 * 60_000).toISOString(), brandLabel: "Uncle Daniel" },
];

export const FIXTURE_AVAILABLE_ACCOUNTS: TargetAccount[] = [
  // Connected but not yet selected for this clip
  { id: "acc-7", platform: "instagram", label: "Instagram · @ddbeauty.cuts",   handle: "@ddbeauty.cuts",       state: "connected", brandLabel: "Uncle Daniel" },
  { id: "acc-8", platform: "facebook",  label: "Facebook · Uncle Daniel",       handle: "Uncle Daniel",        state: "connected", brandLabel: "Uncle Daniel" },
  // Token expired · needs reconnect
  { id: "acc-9", platform: "tiktok",    label: "TikTok · @uncle.daniel.reels", handle: "@uncle.daniel.reels", state: "account-expired", brandLabel: "Uncle Daniel" },
  // Plan-limit locked (Pro tier cap reached on TikTok)
  { id: "acc-10", platform: "tiktok",   label: "TikTok · @uncle.daniel.live",  handle: "@uncle.daniel.live",  state: "plan-limit-reached", brandLabel: "Uncle Daniel" },
];

export const FIXTURE_EXPORT_HISTORY: ExportJob[] = [
  { id: "ex-1", clipIdx: 0, clipTitle: "The cold-open that actually works",       format: "9:16", preset: "tiktok",   watermark: false, targetAccountId: "acc-1", createdAt: new Date(Date.now() - 1800_000).toISOString(), status: "complete", durationS: 28, outputPath: "/projects/uncle-daniel-clip-squad-2026/clips/01-cold-open-vertical.mp4" },
  { id: "ex-2", clipIdx: 1, clipTitle: "Why most clippers fail by minute 4",      format: "1:1",  preset: "reels",    watermark: false, targetAccountId: "acc-3", createdAt: new Date(Date.now() - 3600_000).toISOString(), status: "complete", durationS: 55 },
  { id: "ex-3", clipIdx: 2, clipTitle: "The one rule nobody tells you about hooks", format: "16:9", preset: "shorts",  watermark: true,  targetAccountId: "acc-4", createdAt: new Date(Date.now() - 5400_000).toISOString(), status: "failed", errorMessage: "Codec mismatch · try H.264 preset" },
];
