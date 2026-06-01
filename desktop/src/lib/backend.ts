import { sidecar, type DripSlot } from "./sidecar";
import { reportDesktopError } from "./telemetry";

// Map a backend path to a coarse "route" for telemetry grouping (no ids/PII).
function routeFor(path: string): string {
  const p = path.split("?")[0];
  if (p.startsWith("/notifications")) return "inbox";
  if (p.startsWith("/schedules")) return "queue";
  if (p.startsWith("/sync")) return "sync";
  if (p.startsWith("/connections")) return "connections";
  if (p.startsWith("/usage")) return "export";
  if (p.startsWith("/me")) return "account";
  if (p.startsWith("/whop") || p.startsWith("/bounties") || p.startsWith("/submissions")) return "earn";
  if (p.startsWith("/publish")) return "publish";
  return p;
}

// Junior Backend client. Production builds talk to https://api.jnremployee.com
// (LIVE on Railway). `npm run tauri dev` targets localhost:8000 so the desktop
// can be driven against a local FastAPI instance.
//
// Selection (compile-time, baked by Vite):
//   • VITE_BACKEND_URL  — explicit override, wins everywhere when set. Lets a
//     dev point at staging / a tunnel without editing source.
//   • import.meta.env.DEV — true under `tauri dev` / `vite dev`, false for
//     `tauri build` / `vite build`. Dev defaults to local, prod to the
//     deployed API. This is THE production flip: a shipped (built) app has
//     DEV=false, so it resolves to https://api.jnremployee.com.
//
// The license JWT lives in the OS keychain (Sprint 3 secrets infra). We fetch
// it lazily so we can keep the helper sync at the surface but resilient when
// the user hasn't activated yet.

const PROD_BACKEND_URL = "https://api.jnremployee.com";
const DEV_BACKEND_URL = "http://localhost:8000";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ??
  (import.meta.env.DEV ? DEV_BACKEND_URL : PROD_BACKEND_URL);

/** True in the deployed web preview (app.jnremployee.com), false in Tauri.
 * Detected by absence of the Tauri injection marker. Used to short-circuit
 * backend HTTP calls with demo data so Queue / Inbox / Settings render
 * believable state without an actual Junior Backend running. */
function isWebPreview(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri 2 injects __TAURI_INTERNALS__ into the global before any user code
  // runs. Its absence means we're in a browser tab.
  return !("__TAURI_INTERNALS__" in window);
}

async function licenseJwt(): Promise<string | null> {
  // Sidecar reads the encrypted JWT out of the OS keychain. Returns null if
  // the user hasn't activated yet — callers treat the missing token gracefully.
  try {
    const res = await sidecar.licenseJwtRead();
    return res.value;
  } catch {
    return null;
  }
}

// Central "license rejected" hook. App.tsx registers a handler that flips the
// app to signed-out + shows the activation prompt. Fired once per 401 from ANY
// authed call (Inbox, Queue, Sync, Connections, Earn, usage/export) — no
// per-screen wiring needed.
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// Self-heal on a rejected license JWT (401): the stored token is stale/expired/
// rotated. Drop ONLY the license token (Whop + other secrets stay), notify the
// app so it flips to needs-activation + shows the prompt, and throw a typed
// error so callers don't surface raw "HTTP 401" noise. The token is now gone,
// so the next authed call hits the no-JWT guard instead of retrying the bad one.
async function handleUnauthorized(route: string): Promise<never> {
  try {
    await sidecar.secretDelete("LICENSE_JWT");
  } catch {
    /* best-effort — clearing must never throw out of the auth path */
  }
  void reportDesktopError("license_rejected", { route, http_status: 401, error_code: "UnauthorizedError" });
  onUnauthorized?.();
  throw new UnauthorizedError("license rejected — please sign in to Junior again");
}

async function authedFetch(path: string, init: RequestInit & { jwt?: string | null } = {}): Promise<Response> {
  const { jwt: maybeJwt, headers, ...rest } = init;
  const jwt = maybeJwt ?? (await licenseJwt());
  if (!jwt) {
    throw new UnauthorizedError("not activated — sign in to Junior to continue.");
  }
  // Retry transient failures (network drop, 5xx, 429) with exponential backoff.
  // Only retries idempotent reads; non-GET requests bail on the first failure
  // so we don't double-submit (e.g. duplicate notification dismiss).
  const method = (rest.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxAttempts = idempotent ? 3 : 1;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}${path}`, {
        ...rest,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt}`,
          ...(headers ?? {}),
        },
      });
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        // exponential backoff: 200ms, 600ms
        await new Promise((r) => window.setTimeout(r, 200 * Math.pow(3, attempt)));
        continue;
      }
      void reportDesktopError("backend_offline", {
        route: routeFor(path),
        error_code: (e as Error)?.name ?? "NetworkError",
        message: String(e),
      });
      throw new BackendOfflineError("can't reach Junior — check your connection and retry.");
    }
    // 429 + 5xx are transient — retry on idempotent reads.
    if (idempotent && (res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < maxAttempts - 1) {
      await new Promise((r) => window.setTimeout(r, 200 * Math.pow(3, attempt)));
      continue;
    }
    if (res.status === 401) await handleUnauthorized(routeFor(path));
    return res;
  }
  // Shouldn't reach — loop always returns or throws — but TS needs a path.
  throw new BackendOfflineError(`backend unreachable after ${maxAttempts} attempts: ${String(lastErr)}`);
}

export type NotificationDto = {
  id: string;
  category:
    | "system_update"
    | "post_published"
    | "post_failed"
    | "drip_summary"
    | "quota_warning"
    | "billing"
    | "affiliate"
    | "founder"
    | "junior_message"
    | "pipeline_event";
  title: string;
  body: string;
  priority: "low" | "medium" | "high";
  action_kind: string | null;
  action_data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type ScheduleDto = {
  id: string;
  project_slug: string;
  clip_idx: number;
  clip_title: string;
  platform: string;
  scheduled_for: string;     // ISO
  status: "pending" | "uploading" | "scheduled" | "published" | "failed" | "canceled";
  post_url: string | null;
  error: string | null;
  created_at: string;
};

export type PublishedTarget = {
  platform: string;
  post_url: string;
  posted_at: string;
  postiz_post_id: string;
};

// Platform-name union used as a label-key throughout the publish UI.
// The legacy per-platform OAuth model (PlatformConnection / ConnectionsList /
// backend.connections.{list,startConnect,disconnect}) was removed when
// PublishModal moved to Ayrshare in sprint #3 — Ayrshare's /social endpoints
// returning { platforms: string[] } are the new source of truth (see
// socialGetConnection / SocialConnectionState below).
export type ConnectionPlatform = "youtube" | "tiktok" | "instagram" | "x";

// --- Reward Clips + Tracking Links (mirrors junior-backend/app/routes/reward_clips.py)
export type TrackingLinkBlock = {
  id: string;
  short_url: string;            // jnremployee.com/r/{id} — encode this in the QR
  destination_url: string;
  affiliate_id: string | null;
  platform: string | null;
  account_label: string | null;
  campaign_id: string | null;
  label: string | null;
  disabled: boolean;
  click_count: number;
};

export type RewardClipBlock = {
  id: string;
  whop_reward_id: string;
  whop_reward_title: string | null;
  clip_idx: number;
  platform: string | null;
  account_label: string | null;
  campaign_id: string | null;
  whop_submission_id: string | null;
  status: string | null;        // draft | generated | submitted | approved | denied (loose)
  tracking_link: TrackingLinkBlock | null;
  created_at: string;
  updated_at: string;
};

export type RewardClipCreateInput = {
  whop_reward_id: string;
  whop_reward_title?: string | null;
  clip_idx: number;
  platform?: string | null;
  account_label?: string | null;
  campaign_id?: string | null;
  destination_url?: string | null;
};

export type RewardClipPatchInput = {
  whop_submission_id?: string | null;
  platform?: string | null;
  account_label?: string | null;
  campaign_id?: string | null;
  status?: string | null;
};

export const backend = {
  health: () => fetch(`${BACKEND_URL}/healthcheck`).then((r) => r.json()),

  publishNow: async (
    jwt: string,
    args: {
      filePath: string;
      title: string;
      description: string;
      platforms: ("youtube" | "tiktok" | "x")[];
    },
  ): Promise<PublishedTarget[]> => {
    // Tauri lets us POST a file by reading it from the local FS and packing into FormData.
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(args.filePath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "video/mp4" }),
      args.filePath.split("/").pop() || "clip.mp4",
    );
    form.append("title", args.title);
    form.append("description", args.description);
    form.append("platforms", args.platforms.join(","));
    const res = await fetch(`${BACKEND_URL}/publish-now`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (res.status === 401) await handleUnauthorized("publish");
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      throw new QuotaExceededError(body.detail || "Publishing requires Solo or higher.");
    }
    if (res.status === 412) {
      // Backend: no social_connections row yet. Surface a clear next step
      // instead of dumping the raw 412 body to the user.
      throw new Error("Connect a social profile in Settings → Connections before publishing.");
    }
    if (!res.ok) {
      throw new Error(`publish-now failed: HTTP ${res.status} ${await res.text()}`);
    }
    // P1 (Ayrshare) returns {results: [{platform, post_url, post_id, status, error}]}.
    // Translate to the legacy PublishedTarget[] shape so PublishModal doesn't have
    // to know about the swap. Failed-platform entries become a thrown error so the
    // modal's error banner shows up.
    const body = await res.json() as { results?: Array<{ platform: string; post_url: string | null; post_id: string | null; status: string; error?: string | null }> } | PublishedTarget[];
    const results = Array.isArray(body) ? body : (body.results ?? []);
    const ok: PublishedTarget[] = [];
    const failed: string[] = [];
    for (const r of results) {
      // Legacy shape — keep as-is.
      if ("posted_at" in r && r.posted_at) {
        ok.push(r as PublishedTarget);
        continue;
      }
      const ayr = r as { platform: string; post_url: string | null; post_id: string | null; status: string; error?: string | null };
      if (ayr.status === "published" && ayr.post_url) {
        ok.push({
          platform: ayr.platform,
          post_url: ayr.post_url,
          posted_at: new Date().toISOString(),
          postiz_post_id: ayr.post_id ?? "",
        });
      } else {
        failed.push(`${ayr.platform}: ${ayr.error || ayr.status}`);
      }
    }
    if (ok.length === 0 && failed.length > 0) {
      throw new Error(`publish failed — ${failed.join(" · ")}`);
    }
    return ok;
  },

  scheduleOne: async (
    jwt: string,
    args: {
      projectSlug: string;
      clipIdx: number;
      clipTitle: string;
      verticalPath: string;
      platform: "youtube" | "tiktok" | "x";
      scheduledFor: string;
    },
  ) => {
    const res = await authedFetch("/schedules", {
      method: "POST",
      jwt,
      body: JSON.stringify({
        project_slug: args.projectSlug,
        clip_idx: args.clipIdx,
        clip_title: args.clipTitle,
        vertical_path: args.verticalPath,
        platform: args.platform,
        scheduled_for: args.scheduledFor,
      }),
    });
    if (!res.ok) throw new Error(`schedule failed: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  },

  schedules: {
    list: async (jwt: string, opts: { project_slug?: string; limit?: number } = {}) => {
      if (isWebPreview()) return previewSchedules();
      const params = new URLSearchParams();
      if (opts.project_slug) params.set("project_slug", opts.project_slug);
      if (opts.limit) params.set("limit", String(opts.limit));
      const res = await authedFetch(`/schedules?${params}`, { jwt });
      if (!res.ok) throw new Error(`schedules list failed: HTTP ${res.status}`);
      return (await res.json()) as ScheduleDto[];
    },
    cancel: async (jwt: string, id: string) => {
      if (isWebPreview()) {
        previewCancelSchedule(id);
        return;
      }
      const res = await authedFetch(`/schedules/${id}`, { method: "DELETE", jwt });
      if (!res.ok) throw new Error(`cancel failed: HTTP ${res.status}`);
    },
  },

  notifications: {
    list: async (jwt: string, opts: { unread_only?: boolean; limit?: number } = {}) => {
      if (isWebPreview()) return previewNotifications();
      const params = new URLSearchParams();
      if (opts.unread_only) params.set("unread_only", "true");
      if (opts.limit) params.set("limit", String(opts.limit));
      const res = await authedFetch(`/notifications?${params}`, { jwt });
      if (!res.ok) throw new Error(`notifications list failed: HTTP ${res.status}`);
      return (await res.json()) as NotificationDto[];
    },
    unreadCount: async (_jwt: string) => {
      if (isWebPreview()) return previewNotifications().filter((n) => !n.read_at).length;
      const res = await authedFetch("/notifications/unread-count", { jwt: _jwt });
      if (!res.ok) throw new Error(`unread-count failed: HTTP ${res.status}`);
      return ((await res.json()) as { unread: number }).unread;
    },
    markRead: async (jwt: string, id: string) => {
      if (isWebPreview()) {
        previewMarkRead(id);
        return;
      }
      await authedFetch(`/notifications/${id}/read`, { method: "POST", jwt });
    },
    markAllRead: async (jwt: string) => {
      if (isWebPreview()) {
        previewMarkAllRead();
        return;
      }
      await authedFetch("/notifications/read-all", { method: "POST", jwt });
    },
    dismiss: async (jwt: string, id: string) => {
      if (isWebPreview()) {
        previewDismiss(id);
        return;
      }
      await authedFetch(`/notifications/${id}`, { method: "DELETE", jwt });
    },
  },

  scheduleDripBatch: async (slug: string, slots: DripSlot[], jwt: string) => {
    const items = slots.map((s) => ({
      project_slug: slug,
      clip_idx: s.clip_idx,
      clip_title: s.clip_title,
      vertical_path: s.vertical_path,
      platform: s.platform,
      scheduled_for: s.scheduled_for,
    }));
    const res = await authedFetch("/schedules/drip-batch", {
      method: "POST",
      jwt,
      body: JSON.stringify({ project_slug: slug, items }),
    });
    if (!res.ok) {
      throw new Error(`drip-batch failed: HTTP ${res.status} ${await res.text()}`);
    }
    return res.json();
  },

  startVideoUsage: async (jwt: string) => {
    const res = await authedFetch("/usage/video-started", { method: "POST", jwt });
    if (res.status === 402) {
      const body = await res.json();
      throw new QuotaExceededError(body.detail || "Free tier cap reached.");
    }
    if (!res.ok) {
      throw new Error(`usage call failed: HTTP ${res.status}`);
    }
    return res.json();
  },

  // Counts ONE successful clip export against the 100-export starter pass.
  // Call only after a real export lands on disk — never for previews, drafts,
  // or failed runs. Paid/founder users are never capped (the backend returns
  // remaining_exports: null and never 402s for them).
  //
  // Returns the post-increment `remaining_exports` (null = unlimited). Throws
  // QuotaExceededError on 402 so the caller can raise the upgrade wall.
  clipExported: async (jwt: string): Promise<{ remaining_exports: number | null }> => {
    const res = await authedFetch("/usage/clip-exported", { method: "POST", jwt });
    if (res.status === 402) {
      void reportDesktopError("export_capped", { route: "export", http_status: 402, error_code: "QuotaExceededError" });
      const body = await res.json().catch(() => ({}));
      throw new QuotaExceededError(
        body.detail || "Your 100 free clip exports are used up.",
      );
    }
    if (!res.ok) {
      throw new Error(`clip-exported call failed: HTTP ${res.status}`);
    }
    return (await res.json()) as { remaining_exports: number | null };
  },

  // Reward Clips — bridges a generated Junior clip to a Whop Content Reward
  // submission AND a Junior tracking link (clicks/signups/paid/MRR). The
  // tracking_link is minted server-side in the same transaction as create.
  rewardClips: {
    list: async (jwt: string): Promise<RewardClipBlock[]> => {
      const res = await authedFetch("/me/reward-clips", { jwt });
      if (!res.ok) throw new Error(`reward-clips list failed: HTTP ${res.status}`);
      const body = (await res.json()) as { reward_clips: RewardClipBlock[] };
      return body.reward_clips;
    },
    create: async (jwt: string, input: RewardClipCreateInput): Promise<RewardClipBlock> => {
      const res = await authedFetch("/me/reward-clips", {
        method: "POST",
        jwt,
        body: JSON.stringify(input),
      });
      if (res.status === 502) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Couldn't reach Whop to set up the tracking link — retry shortly.");
      }
      if (!res.ok) throw new Error(`reward-clip create failed: HTTP ${res.status}`);
      const body = (await res.json()) as { reward_clip: RewardClipBlock };
      return body.reward_clip;
    },
    patch: async (jwt: string, id: string, patch: RewardClipPatchInput): Promise<RewardClipBlock> => {
      const res = await authedFetch(`/me/reward-clips/${id}`, {
        method: "PATCH",
        jwt,
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`reward-clip patch failed: HTTP ${res.status}`);
      return (await res.json()) as RewardClipBlock;
    },
  },
};

/**
 * Optional quota guard — called before runPipeline / runPipelineFromUrl.
 *
 * Returns `null` if the user has no license JWT (offline / unactivated).
 * Throws `QuotaExceededError` if Free-tier cap is hit.
 * Returns the usage row otherwise.
 */
export async function maybeCheckQuota(): Promise<{ tier: string; remaining: number | null } | null> {
  try {
    const { value: jwt } = await import("./sidecar").then((m) => m.sidecar.licenseJwtRead());
    if (!jwt) return null;
    return await backend.startVideoUsage(jwt);
  } catch (e) {
    if (e instanceof QuotaExceededError) throw e;
    // No license / backend offline / network — let the pipeline run anyway.
    // The user gets unlimited until they activate; we error-tolerantly accept that.
    return null;
  }
}

export class QuotaExceededError extends Error {
  readonly kind = "quota_exceeded" as const;
}

/** Thrown by the authed layer when the license JWT is missing or rejected (401).
 * By the time callers see this, handleUnauthorized has already cleared the stale
 * token + fired the signed-out callback — treat it as "needs activation", not an
 * error to surface raw. */
export class UnauthorizedError extends Error {
  readonly kind = "unauthorized" as const;
}

/** Thrown by the authed layer when the backend can't be reached (network
 * failure). Screens should show a friendly "can't reach Junior — retry" state
 * rather than a raw error; the failure is already reported to telemetry. */
export class BackendOfflineError extends Error {
  readonly kind = "backend_offline" as const;
}

// Tier names match junior-backend/app/features.py FEATURES_BY_TIER. Legacy
// 'growth' / 'autopilot' are kept here for backend compatibility — the
// _LEGACY_TIER_ALIASES map on the backend converts them to 'pro' / 'agency'
// transparently. Public-facing copy in TIER_COPY (useTier.ts) uses Pro / Agency.
export type Tier = "free" | "solo" | "pro" | "agency" | "growth" | "autopilot";

export type FeatureMap = {
  video_quota_monthly: number | null;        // null = unlimited
  multi_ratio_export: boolean;
  broll_overlay: boolean;
  hook_burnin: boolean;
  byo_openai_key_required: boolean;
  hosted_transcribe: boolean;
  hosted_llm: boolean;
  platform_connections_max: number;
  priority_support: boolean;
  drip_scheduling: boolean;
  project_memory: boolean;
  cross_platform_timing: boolean;
  founder_community: boolean;
};

export type SyncStatus = {
  tier: Tier;
  founder: boolean;
  subscription_status: string;
  paid_until: string | null;
  billing_provider: "whop" | "clerk";
  features: FeatureMap;
  // Free clip exports left on the starter pass. null = unlimited (paid/founder)
  // — when null we never show the export gate or the "X free exports left"
  // counter. Backend-authoritative; do not derive client-side.
  remaining_exports: number | null;
};

/**
 * Pulls the current subscription state from Junior Backend. Returns null when
 * the user has no JWT (unactivated) — Settings then defaults to the marketing
 * Upgrade flow instead of branching.
 */
export async function syncStatus(): Promise<SyncStatus | null> {
  if (isWebPreview()) return previewSyncStatus();
  try {
    const res = await authedFetch("/sync");
    if (!res.ok) return null;
    return (await res.json()) as SyncStatus;
  } catch {
    return null;
  }
}


// Canonical "who am I" answer from the backend. Used by Settings → Account
// to surface what the backend actually thinks vs what Clerk or the keychain
// might be saying. Source of truth for tier/admin/billing — never derive
// from Clerk publicMetadata alone.
export type MeStatus = {
  backend_user_id: string;
  clerk_id: string | null;
  email: string | null;
  whop_user_id: string | null;
  affiliate_id: string | null;
  raw_tier: string;
  raw_founder: boolean;
  effective_tier: string;
  effective_founder: boolean;
  admin_override: boolean;
  subscription_status: string;
  billing_provider: "whop" | "clerk";
  whop_backend_key_configured: boolean;
  // Mirrors SyncStatus.remaining_exports — null = unlimited (paid/founder).
  remaining_exports: number | null;
  // P2 matrix v2 — social-account ceiling. tier base + 5 per prepaid pack
  // ($40 each). Founders / admins are uncapped (returned as 9999 sentinel).
  account_limit: number;
  extra_accounts_purchased: number;
  clips_created: number;
};

// ── Affiliate / referral dashboard (0.4.30) ─────────────────────────────
//
// Mirrors junior-backend AffiliateMeResponse — single GET that returns
// both the customer's earning gates AND their Whop affiliate stats in one
// shot. The AffiliateHero component in the Earn tab branches on these
// fields to render every state from "signed out" through "earning + qualified."

export type AffiliateQualification = {
  paid_referrals_count: number;
  paid_referrals_needed: number;       // backend constant: 2
  verified_views_count: number | null; // Whop owns view truth; null when not exposed here
  verified_views_needed: number;       // backend constant: 11000
  qualified: boolean | null;           // true = paid threshold met; null = view-path / pending
};

export type AffiliateBlock = {
  connected: boolean;
  affiliate_id: string | null;
  referral_url: string | null;
  status: string | null;
  active_members_count: number | null;
  total_referrals_count: number | null;
  monthly_recurring_revenue_usd: string | null;
  total_referral_earnings_usd: string | null;
  qualification: AffiliateQualification | null;
  partner_dashboard_url: string;       // always present, falls back to partner.jnremployee.com
  payout_provider: "whop" | "stripe_connect" | string;
  payout_status: "ready" | "setup_required" | "unavailable" | string;
  payout_setup_url: string;
};

export type AffiliateCustomer = {
  tier: string;                        // free | solo | growth | autopilot
  subscription_status: string;         // trial | trialing | active | past_due | expired | canceled | refunded | admin
  founder: boolean;
  admin_override: boolean;
  can_earn: boolean;
  billing_provider: "whop" | "clerk";
  is_trial: boolean;
  remaining_exports: number | null;
  paid_until: string | null;
  whop_connected: boolean;
  referrer_affiliate_id: string | null;
  // Optional — backend may add the customer's display name + avatar URL
  // (Clerk image_url for Stripe customers, Whop profile_picture for Whop).
  // GIF avatars supported natively via <img>. Until backend exposes these,
  // the UI shows initials derived from `name` or `•` if both are absent.
  name?: string | null;
  image_url?: string | null;
};

export type PaymentRoute = {
  key: string;
  label: string;
  provider: string;
  status: string;
  manage_url: string;
  helper: string;
  in_app: boolean;
};

export type PaymentVisibility = {
  app_subscription: PaymentRoute;
  reward_payouts: PaymentRoute;
  affiliate_payouts: PaymentRoute;
};

export type AffiliateMeResponse = {
  customer: AffiliateCustomer;
  affiliate: AffiliateBlock;
  payments: PaymentVisibility;
};

/** GET /me/affiliate — license-JWT-auth. Returns null on web-preview only.
 *  Network/5xx → throws (caller renders the error-state card). */
export async function meAffiliate(): Promise<AffiliateMeResponse | null> {
  if (isWebPreview()) return null;
  const res = await authedFetch("/me/affiliate");
  if (!res.ok) throw new Error(`affiliate fetch failed: HTTP ${res.status}`);
  return (await res.json()) as AffiliateMeResponse;
}


export async function meStatus(): Promise<MeStatus | null> {
  if (isWebPreview()) return null;
  try {
    const res = await authedFetch("/me");
    if (!res.ok) return null;
    const body = (await res.json()) as MeStatus;
    // Wire backend_user_id into the telemetry user_ref so Admin HQ can group
    // errors by user without us sending an email / JWT / Clerk id. Best-effort —
    // the import is deferred so we don't bring telemetry into the web preview.
    try {
      const { setTelemetryUserRef } = await import("./telemetry");
      setTelemetryUserRef(body.backend_user_id ?? null);
    } catch {
      /* telemetry module unavailable — silently skip */
    }
    return body;
  } catch {
    return null;
  }
}

// ── Social connections (P1 — Ayrshare) ─────────────────────────────────
//
// One profile key per user. Set via Settings → Connections; PublishModal
// reads `platforms` to pre-fill checkboxes and 412s the user back to
// Settings if they try to publish without one.

// ── Sponsored Campaigns + Submissions (sprint #14c) ─────────────────────
// Minecraft Story Clip Challenge is the first wrapped campaign. Clipper
// exports a clip via Liquid Lift, posts it publicly, submits the URL here.
// Backend runs watermark detection — Free-tier exports are blocked at this
// step, which is the conversion engine.

export type MomentType =
  | "betrayal" | "war_declaration" | "villain_speech" | "underdog_victory"
  | "emotional_confession" | "friendship" | "moral_choice" | "final_battle"
  | "plot_twist" | "lore_reveal" | "funny_moment";

export type PermissionType = "my_own_footage" | "creator_licensed" | "transformative_commentary";

export type CampaignDescriptor = {
  id: string;
  title: string;
  tagline: string;
  payout_model: "rpm" | "flat";
  rpm_usd: number;
  daily_bonus_usd: number;
  weekly_bonus_usd: number;
  total_budget_usd: number;
  moment_types: MomentType[];
  platforms: string[];
  min_age: number;
  disclosure_tag_required: boolean;
  whop_campaign_id: string | null;
};

export type SubmissionResponse = {
  id: string;
  status: "submitted" | "rejected" | "accepted" | "forwarded" | "paid";
  campaign_id: string;
  clip_url: string;
  moment_type: string;
  watermark_detected: boolean;
  watermark_reason: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type SubmissionCreateInput = {
  campaign_id: string;
  clip_url: string;
  source_url?: string;
  moment_type: MomentType;
  hook_timestamp?: string;
  why_this_moment?: string;
  permission_type: PermissionType;
  disclosure_confirmed: boolean;
};

export class WatermarkDetectedError extends Error {
  upgradeUrl: string;
  submissionId: string;
  constructor(reason: string, upgradeUrl: string, submissionId: string) {
    super(reason);
    this.name = "WatermarkDetectedError";
    this.upgradeUrl = upgradeUrl;
    this.submissionId = submissionId;
  }
}

export async function listActiveCampaigns(): Promise<CampaignDescriptor[]> {
  if (isWebPreview()) {
    return [{
      id: "minecraft_v1",
      title: "Minecraft Story Clip Challenge",
      tagline: "Get paid to clip the moments stories turn",
      payout_model: "rpm",
      rpm_usd: 2.5,
      daily_bonus_usd: 50,
      weekly_bonus_usd: 250,
      total_budget_usd: 4900,
      moment_types: ["betrayal", "war_declaration", "villain_speech", "underdog_victory", "emotional_confession", "friendship", "moral_choice", "final_battle", "plot_twist", "lore_reveal", "funny_moment"],
      platforms: ["tiktok", "instagram", "youtube_shorts"],
      min_age: 18,
      disclosure_tag_required: true,
      whop_campaign_id: null,
    }];
  }
  try {
    const res = await authedFetch("/submissions/campaigns/active");
    if (!res.ok) return [];
    return (await res.json()) as CampaignDescriptor[];
  } catch {
    return [];
  }
}

export async function createSubmission(input: SubmissionCreateInput): Promise<SubmissionResponse> {
  if (isWebPreview()) {
    return {
      id: "sub_preview_demo",
      status: "submitted",
      campaign_id: input.campaign_id,
      clip_url: input.clip_url,
      moment_type: input.moment_type,
      watermark_detected: false,
      watermark_reason: null,
      rejection_reason: null,
      created_at: new Date().toISOString(),
    };
  }
  const res = await authedFetch("/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail ?? {};
    if (detail.code === "watermark_detected") {
      throw new WatermarkDetectedError(
        detail.message ?? "Watermark detected — re-export without watermark and try again.",
        detail.upgrade_url ?? "https://account.jnremployee.com/upgrade?reason=watermark",
        detail.submission_id ?? "",
      );
    }
    throw new Error(detail.message ?? body.detail ?? `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Submission failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SubmissionResponse;
}

export async function listMySubmissions(): Promise<SubmissionResponse[]> {
  if (isWebPreview()) return [];
  try {
    const res = await authedFetch("/submissions/me");
    if (!res.ok) return [];
    return (await res.json()) as SubmissionResponse[];
  } catch {
    return [];
  }
}

// ── Doctrine library (Uncle Daniel — sprint #14c) ───────────────────────

export type DoctrineEpisode = {
  id: string;
  episode_number: number | null;
  title: string;
  category: string | null;
  description: string | null;
  thumbnail_url: string | null;
  youtube_url: string | null;
  duration_min: number | null;
  published: boolean;
};

export async function listDoctrineEpisodes(category?: string): Promise<DoctrineEpisode[]> {
  if (isWebPreview()) return [];
  try {
    const path = category ? `/doctrine/episodes?category=${encodeURIComponent(category)}` : "/doctrine/episodes";
    const res = await authedFetch(path);
    if (!res.ok) return [];
    return (await res.json()) as DoctrineEpisode[];
  } catch {
    return [];
  }
}

export async function listDoctrineCategories(): Promise<string[]> {
  if (isWebPreview()) return [];
  try {
    const res = await authedFetch("/doctrine/categories");
    if (!res.ok) return [];
    return (await res.json()) as string[];
  } catch {
    return [];
  }
}

export type LeaderboardEntry = {
  rank: number;
  display_handle: string;
  lifetime_earnings_usd: string;   // stringified decimal
  paid_referrals: number;
  is_caller: boolean;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  caller_rank: number | null;
  caller_entry: LeaderboardEntry | null;
  refreshed_at: string | null;   // ISO timestamp; UI renders relative
  total_ranked: number;
};

export async function leaderboardGet(): Promise<LeaderboardResponse | null> {
  if (isWebPreview()) {
    // Preview demo: a plausible top-10 board with the caller at rank 4.
    return previewLeaderboard();
  }
  try {
    const res = await authedFetch("/leaderboard/earnings");
    if (!res.ok) return null;
    return (await res.json()) as LeaderboardResponse;
  } catch {
    return null;
  }
}

export type SocialConnectionState = {
  connected: boolean;
  profile_key_set: boolean;
  platforms: string[];
  active: boolean;
};

export async function socialGetConnection(): Promise<SocialConnectionState | null> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["tiktok", "youtube"], active: true };
  }
  try {
    const res = await authedFetch("/social/connections");
    if (!res.ok) return null;
    return (await res.json()) as SocialConnectionState;
  } catch {
    return null;
  }
}

export async function socialConnect(profileKey: string): Promise<SocialConnectionState> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["tiktok", "youtube"], active: true };
  }
  const res = await authedFetch("/social/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile_key: profileKey }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`connect failed: HTTP ${res.status} ${body}`);
  }
  return (await res.json()) as SocialConnectionState;
}

export async function socialRefreshPlatforms(): Promise<SocialConnectionState> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["tiktok", "youtube"], active: true };
  }
  const res = await authedFetch("/social/refresh-platforms", { method: "POST" });
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`);
  return (await res.json()) as SocialConnectionState;
}

export async function socialDisconnectPlatform(platform: string): Promise<SocialConnectionState> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["youtube"], active: true };
  }
  const res = await authedFetch(`/social/disconnect/${encodeURIComponent(platform)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`disconnect failed: HTTP ${res.status}`);
  return (await res.json()) as SocialConnectionState;
}

// ── Web preview demo data ───────────────────────────────────────────────
// Used only when running at app.jnremployee.com (no Junior Backend behind
// it). Lets the three top-bar panels render realistic state for screenshots
// and the trial-before-download flow without standing up FastAPI in front.

function previewSyncStatus(): SyncStatus {
  const renewal = new Date();
  renewal.setMonth(renewal.getMonth() + 1);
  return {
    tier: "solo",
    founder: false,
    subscription_status: "active",
    paid_until: renewal.toISOString(),
    billing_provider: "whop",
    remaining_exports: null, // demo tier is Solo (paid) → uncapped, no gate
    features: {
      video_quota_monthly: null,
      multi_ratio_export: true,
      broll_overlay: true,
      hook_burnin: true,
      byo_openai_key_required: false,
      hosted_transcribe: true,
      hosted_llm: true,
      platform_connections_max: 4,
      priority_support: false,
      drip_scheduling: true,
      project_memory: false,
      cross_platform_timing: true,
      founder_community: false,
    },
  };
}

const PREVIEW_SCHEDULES_KEY = "junior:preview-schedules:v1";
const PREVIEW_NOTIFICATIONS_KEY = "junior:preview-notifications:v1";

function previewLoad<T>(key: string, seed: () => T): T {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      const fresh = seed();
      window.localStorage.setItem(key, JSON.stringify(fresh));
      return fresh;
    }
    return JSON.parse(raw) as T;
  } catch {
    return seed();
  }
}

function previewSave<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage quota or private-browsing — silently noop */
  }
}

function previewSchedules(): ScheduleDto[] {
  return previewLoad<ScheduleDto[]>(PREVIEW_SCHEDULES_KEY, () => {
    const now = Date.now();
    const hour = 3600_000;
    return [
      {
        id: "sch_001",
        project_slug: "sample-podcast-clip",
        clip_idx: 0,
        clip_title: "The $4k/day prompt nobody told you about",
        platform: "youtube",
        scheduled_for: new Date(now + 2 * hour).toISOString(),
        status: "scheduled",
        post_url: null,
        error: null,
        created_at: new Date(now - hour).toISOString(),
      },
      {
        id: "sch_002",
        project_slug: "sample-podcast-clip",
        clip_idx: 1,
        clip_title: "Why review-mining beats keyword research",
        platform: "tiktok",
        scheduled_for: new Date(now + 6 * hour).toISOString(),
        status: "scheduled",
        post_url: null,
        error: null,
        created_at: new Date(now - hour).toISOString(),
      },
      {
        id: "sch_003",
        project_slug: "sample-podcast-clip",
        clip_idx: 2,
        clip_title: "The exact prompt structure (line by line)",
        platform: "x",
        scheduled_for: new Date(now + 18 * hour).toISOString(),
        status: "pending",
        post_url: null,
        error: null,
        created_at: new Date(now - hour).toISOString(),
      },
      {
        id: "sch_004",
        project_slug: "sample-podcast-clip",
        clip_idx: 3,
        clip_title: "Walking through a real niche, end to end",
        platform: "youtube",
        scheduled_for: new Date(now - 4 * hour).toISOString(),
        status: "published",
        post_url: "https://youtube.com/shorts/preview-id",
        error: null,
        created_at: new Date(now - 8 * hour).toISOString(),
      },
    ];
  });
}

function previewCancelSchedule(id: string) {
  const cur = previewSchedules();
  previewSave(
    PREVIEW_SCHEDULES_KEY,
    cur.map((s) => (s.id === id ? { ...s, status: "canceled" as const } : s)),
  );
}

function previewNotifications(): NotificationDto[] {
  return previewLoad<NotificationDto[]>(PREVIEW_NOTIFICATIONS_KEY, () => {
    const now = Date.now();
    const min = 60_000;
    return [
      {
        id: "ntf_001",
        category: "junior_message",
        title: "Welcome to Junior.",
        body: "I clip long videos into ready-to-post shorts. Drop a file or paste a link to see what I do — you can use this preview without an account.",
        priority: "medium",
        action_kind: null,
        action_data: {},
        read_at: null,
        created_at: new Date(now - 2 * min).toISOString(),
      },
      {
        id: "ntf_002",
        category: "post_published",
        title: "Your YouTube Short is live.",
        body: "Walking through a real niche, end to end — published to your YouTube channel.",
        priority: "low",
        action_kind: "open_url",
        action_data: { url: "https://youtube.com/shorts/preview-id" },
        read_at: null,
        created_at: new Date(now - 4 * 3600_000).toISOString(),
      },
      {
        id: "ntf_003",
        category: "drip_summary",
        title: "Drip is rolling.",
        body: "3 of your 8 clips have gone out this week across YouTube, TikTok, and X. 5 still to go.",
        priority: "low",
        action_kind: null,
        action_data: {},
        read_at: new Date(now - 24 * 3600_000).toISOString(),
        created_at: new Date(now - 28 * 3600_000).toISOString(),
      },
      {
        id: "ntf_004",
        category: "quota_warning",
        title: "10 free clip exports left.",
        body: "You've used 90 of your 100 free exports. Continue clipping with Solo for unlimited exports.",
        priority: "medium",
        action_kind: "upgrade",
        action_data: {},
        read_at: new Date(now - 48 * 3600_000).toISOString(),
        created_at: new Date(now - 52 * 3600_000).toISOString(),
      },
    ];
  });
}

function previewMarkRead(id: string) {
  const cur = previewNotifications();
  const now = new Date().toISOString();
  previewSave(
    PREVIEW_NOTIFICATIONS_KEY,
    cur.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)),
  );
}

function previewMarkAllRead() {
  const cur = previewNotifications();
  const now = new Date().toISOString();
  previewSave(
    PREVIEW_NOTIFICATIONS_KEY,
    cur.map((n) => ({ ...n, read_at: n.read_at ?? now })),
  );
}

function previewDismiss(id: string) {
  const cur = previewNotifications();
  previewSave(
    PREVIEW_NOTIFICATIONS_KEY,
    cur.filter((n) => n.id !== id),
  );
}

function previewLeaderboard(): LeaderboardResponse {
  // 10-entry demo board with the caller (you) at rank 4. Lets the marketing
  // preview show a realistic surface without standing up the backend.
  const top: LeaderboardEntry[] = [
    { rank: 1,  display_handle: "viperclips",    lifetime_earnings_usd: "8420.00", paid_referrals: 47, is_caller: false },
    { rank: 2,  display_handle: "marquise_m",    lifetime_earnings_usd: "5180.50", paid_referrals: 29, is_caller: false },
    { rank: 3,  display_handle: "lavendermood",  lifetime_earnings_usd: "3960.00", paid_referrals: 24, is_caller: false },
    { rank: 4,  display_handle: "you",           lifetime_earnings_usd: "2410.00", paid_referrals: 14, is_caller: true  },
    { rank: 5,  display_handle: "tcg_skylar",    lifetime_earnings_usd: "1985.75", paid_referrals: 13, is_caller: false },
    { rank: 6,  display_handle: "kit_atlanta",   lifetime_earnings_usd: "1640.00", paid_referrals: 11, is_caller: false },
    { rank: 7,  display_handle: "shorts_sage",   lifetime_earnings_usd: "1310.00", paid_referrals:  9, is_caller: false },
    { rank: 8,  display_handle: "cassiej",       lifetime_earnings_usd: "1190.50", paid_referrals:  8, is_caller: false },
    { rank: 9,  display_handle: "ringtone_devon",lifetime_earnings_usd: " 980.00", paid_referrals:  7, is_caller: false },
    { rank: 10, display_handle: "lola_minor",    lifetime_earnings_usd: " 820.25", paid_referrals:  6, is_caller: false },
  ];
  return {
    entries: top,
    caller_rank: 4,
    caller_entry: null,
    refreshed_at: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    total_ranked: 312,
  };
}

// Helper used by hooks that need the JWT off the keychain.
// Until the sidecar exposes a secret_get(name), we read it via a one-shot
// "set" round-trip elsewhere or have the caller pass it explicitly.
export async function readLicenseJwtViaSidecar(): Promise<string | null> {
  // Stub — see comment above. The right move is to add `method_secret_get`
  // to sidecar.py that returns OPENAI_API_KEY / LICENSE_JWT. We avoid
  // exposing keys to the frontend in general, but the license JWT is meant
  // to flow through the desktop, so this one is OK.
  void sidecar;
  return null;
}
