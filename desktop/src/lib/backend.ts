import { sidecar, type DripSlot } from "./sidecar";

// Junior Backend client. Talks to localhost:8000 in dev, https://api.jnremployee.com
// once Sprint 4 deploys to Railway.
//
// The license JWT lives in the OS keychain (Sprint 3 secrets infra). We fetch
// it lazily so we can keep the helper sync at the surface but resilient when
// the user hasn't activated yet.

const BACKEND_URL = "http://localhost:8000";

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

async function authedFetch(path: string, init: RequestInit & { jwt?: string | null } = {}): Promise<Response> {
  const { jwt: maybeJwt, headers, ...rest } = init;
  const jwt = maybeJwt ?? (await licenseJwt());
  if (!jwt) {
    throw new Error(
      "no license JWT — paste one in Settings → API keys (JUNIOR_LICENSE_JWT) to enable schedule + publish."
    );
  }
  return fetch(`${BACKEND_URL}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
      ...(headers ?? {}),
    },
  });
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

export type ConnectionPlatform = "youtube" | "tiktok" | "instagram" | "x";

export type PlatformConnection = {
  integration_id: string;
  platform: ConnectionPlatform;
  label: string;
  account_handle: string;
  disabled: boolean;
};

export type ConnectionsList = {
  connections: PlatformConnection[];
  connection_count: number;
  max_connections: number | null;
  can_connect_more: boolean;
};

export const backend = {
  health: () => fetch(`${BACKEND_URL}/healthcheck`).then((r) => r.json()),

  connections: {
    list: async (jwt: string): Promise<ConnectionsList> => {
      if (isWebPreview()) return previewConnectionsList();
      const res = await authedFetch("/connections", { jwt });
      if (!res.ok) throw new Error(`connections list failed: HTTP ${res.status}`);
      return (await res.json()) as ConnectionsList;
    },
    startConnect: async (jwt: string, platform: ConnectionPlatform): Promise<{ redirect_url: string }> => {
      if (isWebPreview()) return previewStartConnect(platform);
      const res = await authedFetch(`/connections/${platform}/connect`, { method: "POST", jwt });
      if (res.status === 402) {
        const body = await res.json().catch(() => ({}));
        throw new QuotaExceededError(body.detail || "Upgrade to add another connection.");
      }
      if (!res.ok) throw new Error(`connect failed: HTTP ${res.status}`);
      return res.json();
    },
    disconnect: async (jwt: string, integrationId: string) => {
      if (isWebPreview()) {
        previewDisconnectPlatform(integrationId);
        return;
      }
      await authedFetch(`/connections/${integrationId}`, { method: "DELETE", jwt });
    },
  },

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
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      throw new QuotaExceededError(body.detail || "Publishing requires Solo or higher.");
    }
    if (!res.ok) {
      throw new Error(`publish-now failed: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as PublishedTarget[];
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

export type Tier = "free" | "solo" | "growth" | "autopilot";

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
};

export async function meStatus(): Promise<MeStatus | null> {
  if (isWebPreview()) return null;
  try {
    const res = await authedFetch("/me");
    if (!res.ok) return null;
    return (await res.json()) as MeStatus;
  } catch {
    return null;
  }
}

// ── Web preview: platform connections ───────────────────────────────────

const PREVIEW_CONNECTIONS_KEY = "junior:preview-connections:v1";

function previewConnectionsList(): ConnectionsList {
  const stored = previewLoad<PlatformConnection[]>(PREVIEW_CONNECTIONS_KEY, () => []);
  // Free preview shows up to 4 platforms once connected; the demo tier in
  // previewSyncStatus() is Solo (2 cap) — readable across both.
  const status = previewSyncStatus();
  const max = status.features.platform_connections_max;
  return {
    connections: stored,
    connection_count: stored.length,
    max_connections: max,
    can_connect_more: max == null || stored.length < max,
  };
}

async function previewStartConnect(platform: ConnectionPlatform): Promise<{ redirect_url: string }> {
  // Simulate the time the real OAuth handshake takes, then optimistically
  // add the connection to the local store so the picker updates as if the
  // user returned from a real consent flow.
  await new Promise((r) => setTimeout(r, 1500));
  const stored = previewLoad<PlatformConnection[]>(PREVIEW_CONNECTIONS_KEY, () => []);
  if (!stored.some((c) => c.platform === platform)) {
    stored.push({
      integration_id: `int_preview_${platform}_${Math.random().toString(36).slice(2, 8)}`,
      platform,
      label: ({ youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", x: "X" })[platform],
      account_handle: "@youraccount",
      disabled: false,
    });
    previewSave(PREVIEW_CONNECTIONS_KEY, stored);
  }
  return { redirect_url: "preview://connected" };
}

function previewDisconnectPlatform(integrationId: string) {
  const stored = previewLoad<PlatformConnection[]>(PREVIEW_CONNECTIONS_KEY, () => []);
  previewSave(PREVIEW_CONNECTIONS_KEY, stored.filter((c) => c.integration_id !== integrationId));
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

// Helper used by hooks that need the JWT off the keychain.
// Until the sidecar exposes a secret_get(name), we read it via a one-shot
// "set" round-trip elsewhere or have the caller pass it explicitly.
export async function readLicenseJwtViaSidecar(): Promise<string | null> {
  // Stub — see comment above. The right move is to add `method_secret_get`
  // to sidecar.py that returns OPENAI_API_KEY / JUNIOR_LICENSE_JWT. We avoid
  // exposing keys to the frontend in general, but the license JWT is meant
  // to flow through the desktop, so this one is OK.
  void sidecar;
  return null;
}
