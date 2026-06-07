// ship-lens v0.7.7: fix #9 — meStatus now returns a discriminated union ({ kind: "ok" | "expired" | "signed-out" }) so callers can distinguish "JWT was rejected" from "never signed in" — Settings consumes the union to fire the re-activate banner, legacy email-only callsites use the meStatusLegacy() shim.
import { sidecar, humanError as sidecarHumanError, type DripSlot } from "./sidecar";
import { reportDesktopError } from "./telemetry";

// ─── User-journey-lens timeouts ──────────────────────────────────────────
// authedFetch wraps every HTTPS call. Without an explicit per-request timeout
// a dropped TCP socket can hang the UI promise for the OS default (60-300s),
// which strands the user staring at a permanent spinner mid-demo.
//
// Reads (GET/HEAD) get a tighter 30s cap; writes can take longer (publish,
// upload, transcribe) so they get 60s. Callers can still pass their own
// AbortSignal via init.signal — we union ours with theirs so caller cancel
// still works (e.g. user navigates away).
const REQUEST_TIMEOUT_GET_MS = 30_000;
const REQUEST_TIMEOUT_WRITE_MS = 60_000;

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

// v0.7.x — Railway now hosts BOTH api.liquidclips.app (new canonical) and
// api.jnremployee.com (legacy, both pointing at the same service). PROD
// stays on jnremployee.com until Let's Encrypt finishes issuing the
// liquidclips.app cert end-to-end. CSP allows both hosts so the flip is a
// one-line bump once SSL is green.
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

// ─── 401 storm dampener (mid-priority finding #5) ────────────────────────
// Several authed calls fire in parallel at boot (sync, /me, /me/affiliate,
// notifications, channels). If the license JWT is stale, all of them 401 in a
// burst and each one used to call onUnauthorized + secretDelete. The user saw
// two flashes of the activation prompt or — worse — the second secretDelete
// raced the first and the keychain ended up in an inconsistent state.
//
// We collapse the storm to a single fire within a 5s window. The first 401
// flips the flag, runs the side-effects, and starts a 5s timer. Subsequent
// 401s in the window still throw UnauthorizedError (the caller is still
// unauthorized — they shouldn't proceed) but skip the global handler.
const UNAUTHORIZED_WINDOW_MS = 5_000;
let unauthorizedFired = false;
let unauthorizedResetTimer: ReturnType<typeof setTimeout> | null = null;

// Self-heal on a rejected license JWT (401): the stored token is stale/expired/
// rotated. Drop ONLY the license token (Whop + other secrets stay), notify the
// app so it flips to needs-activation + shows the prompt, and throw a typed
// error so callers don't surface raw "HTTP 401" noise. The token is now gone,
// so the next authed call hits the no-JWT guard instead of retrying the bad one.
async function handleUnauthorized(route: string): Promise<never> {
  if (unauthorizedFired) {
    // Inside the dedupe window — still throw so the caller knows the request
    // failed, but DON'T re-fire the global handler / re-delete the secret.
    throw new UnauthorizedError("license rejected — please sign in to Liquid Clips again");
  }
  unauthorizedFired = true;
  if (unauthorizedResetTimer) clearTimeout(unauthorizedResetTimer);
  unauthorizedResetTimer = setTimeout(() => {
    unauthorizedFired = false;
    unauthorizedResetTimer = null;
  }, UNAUTHORIZED_WINDOW_MS);
  try {
    await sidecar.secretDelete("LICENSE_JWT");
  } catch {
    /* best-effort — clearing must never throw out of the auth path */
  }
  void reportDesktopError("license_rejected", { route, http_status: 401, error_code: "UnauthorizedError" });
  onUnauthorized?.();
  throw new UnauthorizedError("license rejected — please sign in to Liquid Clips again");
}

// ─── Backend-error normaliser (finding #9) ──────────────────────────────
// Most call sites used `throw new Error("...failed: HTTP " + status)` for
// every non-2xx, which means a 5xx (server hiccup, retry-friendly) and a 422
// (user-actionable input error) look identical to the caller. Calling this
// helper lets the catcher branch on `BackendOfflineError` for "retry / show
// offline UI" vs a plain Error for "show this message to the user".
function backendErrorFor(label: string, res: Response): Error {
  if (res.status >= 500 && res.status <= 599) {
    return new BackendOfflineError(`HTTP ${res.status}`);
  }
  return new Error(`${label}: HTTP ${res.status}`);
}

// ─── Idempotency-key generator (finding #2) ──────────────────────────────
// crypto.randomUUID is available in every Tauri webview but defensively fall
// back so this file compiles in jsdom-style tests too.
function cryptoRandomId(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch { /* noop */ }
  // Non-crypto fallback — only used when crypto.randomUUID is unavailable, which
  // shouldn't happen in production. Good enough for client-side dedupe keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Cache of recently-sent clip_ids → last-known remaining_exports + timestamp.
// See backend.clipExported for why this exists. Module-level so it survives
// across re-renders within the same desktop session.
const _recentExports = new Map<string, { at: number; remaining: number | null }>();

// Pull a header value out of a HeadersInit regardless of which of the three
// shapes TS allows it to be (Headers, [k,v][], Record<string,string>). Used to
// detect `Idempotency-Key` / `X-Idempotency-Key` so we know when retrying a
// write is safe.
function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  const lower = name.toLowerCase();
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) if (k.toLowerCase() === lower) return v;
    return null;
  }
  const rec = headers as Record<string, string>;
  for (const k of Object.keys(rec)) if (k.toLowerCase() === lower) return rec[k];
  return null;
}

async function authedFetch(path: string, init: RequestInit & { jwt?: string | null } = {}): Promise<Response> {
  const { jwt: maybeJwt, headers, signal: callerSignal, ...rest } = init;
  const jwt = maybeJwt ?? (await licenseJwt());
  if (!jwt) {
    throw new UnauthorizedError("not activated — sign in to Liquid Clips to continue.");
  }
  // Retry transient failures (network drop, 5xx, 429) with exponential backoff.
  // Read methods always retry (safely idempotent at the protocol level). Write
  // methods retry ONLY when the caller passed an Idempotency-Key — without one,
  // a network-blip retry could double-submit (duplicate notification dismiss,
  // duplicate clip-export charge). With one, the backend is contractually
  // expected to dedupe replays, so two attempts with 500/1500ms back-off is safe.
  const method = (rest.method ?? "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  const idempotencyKey = readHeader(headers, "Idempotency-Key") ?? readHeader(headers, "X-Idempotency-Key");
  const canRetry = isRead || idempotencyKey !== null;
  const maxAttempts = canRetry ? (isRead ? 3 : 2) : 1;
  // Read back-off: 200ms, 600ms (existing tuning).
  // Write back-off: 500ms, 1500ms (slower because writes are usually slower).
  const backoffMs = (attempt: number): number =>
    isRead ? 200 * Math.pow(3, attempt) : (attempt === 0 ? 500 : 1500);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Per-attempt AbortController — required because fetch() has no built-in
    // timeout. Without this a dropped TCP / dead WiFi pins the promise until
    // the OS gives up (60-300s), which in the demo path = permanent spinner.
    // We also chain the caller's AbortSignal if they passed one so user-cancel
    // (navigating away, hitting Esc on a modal) still aborts cleanly.
    const timeoutMs = isRead ? REQUEST_TIMEOUT_GET_MS : REQUEST_TIMEOUT_WRITE_MS;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
    // If the caller aborted before we started, surface that immediately.
    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timeoutId);
        throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason), { once: true });
    }
    let res: Response;
    let timedOut = false;
    try {
      res = await fetch(`${BACKEND_URL}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt}`,
          ...(headers ?? {}),
        },
      });
    } catch (e) {
      // Distinguish our timeout from a caller cancel from a real network drop.
      // controller.abort("timeout") gives signal.reason === "timeout"; AbortError
      // from the caller signal bubbles as a separate AbortError instance.
      timedOut = controller.signal.aborted && controller.signal.reason === "timeout";
      lastErr = e;
      clearTimeout(timeoutId);

      // Caller-initiated abort — don't retry, propagate the abort.
      if (callerSignal?.aborted) {
        throw e;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => window.setTimeout(r, backoffMs(attempt)));
        continue;
      }
      if (timedOut) {
        void reportDesktopError("request_timeout", {
          route: routeFor(path),
          error_code: "RequestTimeoutError",
          message: `timeout after ${timeoutMs}ms`,
        });
        throw new RequestTimeoutError("Request timed out — check your connection and retry");
      }
      void reportDesktopError("backend_offline", {
        route: routeFor(path),
        error_code: (e as Error)?.name ?? "NetworkError",
        message: String(e),
      });
      throw new BackendOfflineError("can't reach Liquid Clips — check your connection and retry.");
    }
    clearTimeout(timeoutId);
    // 429 + 5xx are transient — retry when allowed (reads always; writes only
    // if Idempotency-Key was set so backend can dedupe).
    if (canRetry && (res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < maxAttempts - 1) {
      await new Promise((r) => window.setTimeout(r, backoffMs(attempt)));
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
  // v0.6.41 — Ayrshare webhook fills this on publish so ScheduleQueue can
  // render the live URL alongside the platform glyph.
  live_url?: string | null;
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

// v0.7.0 (Sprint 2) — Sponsored Rewards. Mirrors junior-backend/app/routes/campaigns.py.
export type SponsoredCampaign = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  subtitle: string | null;
  type: "public" | "coming_soon" | "funded" | "invite_only" | "recurring";
  status: "coming_soon" | "partially_funded" | "funded" | "live" | "closed";
  rpm_cents: number;
  budget_cents: number;
  funded_pct: number;
  duration_label: string | null;
  whop_url: string;
  banner_url: string | null;
  eligibility: string[];
  visibility_tiers: string[];
  min_lc_score: number;
  cta_text: string;
  sort_order: number;
};

export const backend = {
  health: () => fetch(`${BACKEND_URL}/healthcheck`).then((r) => r.json()),

  campaignsList: async (): Promise<SponsoredCampaign[]> => {
    const r = await fetch(`${BACKEND_URL}/campaigns`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.campaigns) ? j.campaigns : [];
  },

  publishNow: async (
    jwt: string,
    args: {
      filePath: string;
      title: string;
      description: string;
      /** Legacy path: list of platforms to post to via the user's single
       * SocialConnection profile_key. Ignored when channelId is set. */
      platforms: ConnectionPlatform[];
      /** Schedule v2 channel path: post to this one channel's Ayrshare
       * profile. Backend infers the single platform from the channel.
       * When set, `platforms` is ignored. */
      channelId?: string | null;
      /** Optional ISO-8601 future timestamp. When set, the post is queued
       * via Ayrshare's native scheduler instead of firing immediately. */
      scheduledAt?: string | null;
    },
  ): Promise<PublishedTarget[]> => {
    // Tauri lets us POST a file by reading it from the local FS and packing into FormData.
    // TODO(lens): large clips (>200MB) should stream via a chunked Tauri sidecar
    // upload instead of materialising the whole file as Uint8Array in the
    // renderer's JS heap. Today we ship a hard guard at 500MB so a 1.4GB long-form
    // export doesn't OOM the webview and crash the app silently.
    const { readFile, stat } = await import("@tauri-apps/plugin-fs");
    const MAX_DIRECT_PUBLISH_BYTES = 500 * 1024 * 1024;
    try {
      const meta = await stat(args.filePath);
      if (typeof meta.size === "number" && meta.size > MAX_DIRECT_PUBLISH_BYTES) {
        throw new PayloadTooLargeError("Clip is too large to publish directly — use Schedule instead");
      }
    } catch (e) {
      // Re-throw our guard; tolerate a missing stat() (older plugin version).
      if (e instanceof PayloadTooLargeError) throw e;
      // else: best-effort probe — fall through to the readFile path. The
      // backend will reject oversize uploads with 413, which surfaces below.
    }
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
    if (args.channelId) {
      form.append("channel_id", args.channelId);
    }
    if (args.scheduledAt) {
      form.append("scheduled_at", args.scheduledAt);
    }
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
      // finding #9: distinguish 5xx (retry / offline UI) from 4xx (user-actionable)
      if (res.status >= 500) {
        throw new BackendOfflineError(`HTTP ${res.status}`);
      }
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
    if (!res.ok) {
      if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
      throw new Error(`schedule failed: HTTP ${res.status} ${await res.text()}`);
    }
    return res.json();
  },

  schedules: {
    list: async (jwt: string, opts: { project_slug?: string; limit?: number } = {}) => {
      if (isWebPreview()) return previewSchedules();
      const params = new URLSearchParams();
      if (opts.project_slug) params.set("project_slug", opts.project_slug);
      if (opts.limit) params.set("limit", String(opts.limit));
      const res = await authedFetch(`/schedules?${params}`, { jwt });
      if (!res.ok) throw backendErrorFor("schedules list failed", res);
      return (await res.json()) as ScheduleDto[];
    },
    cancel: async (jwt: string, id: string) => {
      if (isWebPreview()) {
        previewCancelSchedule(id);
        return;
      }
      const res = await authedFetch(`/schedules/${id}`, { method: "DELETE", jwt });
      if (!res.ok) throw backendErrorFor("cancel failed", res);
    },
    // v0.6.41 — Ayrshare retry. Server resets a failed row's status to
    // "pending" and clears its error so the existing cron picks it up
    // again. Backend gates this on `status === "failed"`.
    retry: async (jwt: string, id: string) => {
      if (isWebPreview()) return;
      const res = await authedFetch(`/schedules/${id}/retry`, { method: "POST", jwt });
      if (!res.ok) throw backendErrorFor("retry failed", res);
    },
  },

  notifications: {
    list: async (jwt: string, opts: { unread_only?: boolean; limit?: number } = {}) => {
      if (isWebPreview()) return previewNotifications();
      const params = new URLSearchParams();
      if (opts.unread_only) params.set("unread_only", "true");
      if (opts.limit) params.set("limit", String(opts.limit));
      const res = await authedFetch(`/notifications?${params}`, { jwt });
      if (!res.ok) throw backendErrorFor("notifications list failed", res);
      return (await res.json()) as NotificationDto[];
    },
    unreadCount: async (_jwt: string) => {
      if (isWebPreview()) return previewNotifications().filter((n) => !n.read_at).length;
      const res = await authedFetch("/notifications/unread-count", { jwt: _jwt });
      if (!res.ok) throw backendErrorFor("unread-count failed", res);
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
    // v0.6.18 — Desktop-callable create. Used on pipeline completion to drop
    // a "clips finished" row into the inbox so a user who navigated away
    // returns to a lit-up bell + actionable card.
    create: async (
      jwt: string,
      payload: {
        category: "pipeline_event" | "junior_message";
        title: string;
        body: string;
        priority?: "low" | "medium" | "high";
        action_kind?: string;
        action_data?: Record<string, unknown>;
        external_dedup_key?: string;
      },
    ) => {
      if (isWebPreview()) return null;
      const res = await authedFetch("/notifications", {
        method: "POST",
        jwt,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw backendErrorFor("notification create failed", res);
      return (await res.json()) as NotificationDto;
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
      if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
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
      throw backendErrorFor("usage call failed", res);
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
  //
  // ─── Idempotency (finding #2) ────────────────────────────────────────
  // App.tsx loops this call inside chargeExports() — if a network retry or
  // a double-click on Export fires it twice for the same clip, the counter
  // double-debits and a Free user can be wrongly walled. We send
  // X-Idempotency-Key on every call so the backend can dedupe replays of
  // the SAME logical export. The frontend ALSO holds a 30s in-memory Set of
  // recently-sent clip ids; if we see the same id twice within the window we
  // skip the network call and return the cached previous response.
  // TODO(backend): honor X-Idempotency-Key in junior-backend's
  // /usage/clip-exported route — store (user_id, key) -> response for 60s and
  // replay the prior response on duplicate. Until backend ships that, the
  // frontend dedupe is the only guard.
  clipExported: async (
    jwt: string,
    opts: { clipId?: string } = {},
  ): Promise<{ remaining_exports: number | null }> => {
    const clipId = opts.clipId;
    if (clipId) {
      const cached = _recentExports.get(clipId);
      if (cached && Date.now() - cached.at < 30_000) {
        // Same id within 30s window — backend has already recorded it.
        // Return the prior counter so the caller's accounting stays consistent.
        return { remaining_exports: cached.remaining };
      }
    }
    // Stable key per logical export attempt: clipId if known (so a retry of
    // THIS attempt dedupes), otherwise a fresh UUID per call.
    const idempotencyKey = clipId ? `clip-exported:${clipId}` : `clip-exported:${cryptoRandomId()}`;
    const res = await authedFetch("/usage/clip-exported", {
      method: "POST",
      jwt,
      headers: { "X-Idempotency-Key": idempotencyKey },
    });
    if (res.status === 402) {
      void reportDesktopError("export_capped", { route: "export", http_status: 402, error_code: "QuotaExceededError" });
      const body = await res.json().catch(() => ({}));
      throw new QuotaExceededError(
        body.detail || "Your 100 free clip exports are used up.",
      );
    }
    if (!res.ok) {
      throw backendErrorFor("clip-exported call failed", res);
    }
    const body = (await res.json()) as { remaining_exports: number | null };
    if (clipId) {
      _recentExports.set(clipId, { at: Date.now(), remaining: body.remaining_exports });
      // Trim the Set so it can't grow unbounded across a long session.
      if (_recentExports.size > 256) {
        const firstKey = _recentExports.keys().next().value;
        if (firstKey !== undefined) _recentExports.delete(firstKey);
      }
    }
    return body;
  },

  // Reward Clips — bridges a generated Junior clip to a Whop Content Reward
  // submission AND a Junior tracking link (clicks/signups/paid/MRR). The
  // tracking_link is minted server-side in the same transaction as create.
  rewardClips: {
    list: async (jwt: string): Promise<RewardClipBlock[]> => {
      const res = await authedFetch("/me/reward-clips", { jwt });
      if (!res.ok) throw backendErrorFor("reward-clips list failed", res);
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
      if (!res.ok) throw backendErrorFor("reward-clip create failed", res);
      const body = (await res.json()) as { reward_clip: RewardClipBlock };
      return body.reward_clip;
    },
    patch: async (jwt: string, id: string, patch: RewardClipPatchInput): Promise<RewardClipBlock> => {
      const res = await authedFetch(`/me/reward-clips/${id}`, {
        method: "PATCH",
        jwt,
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw backendErrorFor("reward-clip patch failed", res);
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
/** Tri-state quota probe (finding #8). Callers used to receive `null` for both
 * "no license" AND "backend hiccuped", which means a 5xx upstream of the
 * pipeline silently ran the user's quota-bearing job without a debit. Now we
 * distinguish:
 *  - { kind: "ok", ... }       → backend confirmed, pipeline can proceed
 *  - { kind: "unknown", reason } → transient (offline / 5xx / no license).
 *                                  Caller decides: retry, or ask the user to
 *                                  retry in a moment, or proceed leniently
 *                                  (currently App.tsx does the latter — it
 *                                  reads "unknown" and runs the pipeline).
 *  - throws QuotaExceededError  → user hit the cap; show the upgrade wall.
 */
export type QuotaCheck =
  | { kind: "ok"; tier: string; remaining: number | null }
  | { kind: "unknown"; reason: string };

export async function maybeCheckQuota(): Promise<QuotaCheck> {
  let jwt: string | null = null;
  try {
    const r = await import("./sidecar").then((m) => m.sidecar.licenseJwtRead());
    jwt = r.value;
  } catch (e) {
    return { kind: "unknown", reason: `keychain unavailable: ${String(e)}` };
  }
  if (!jwt) return { kind: "unknown", reason: "no license" };
  try {
    const row = await backend.startVideoUsage(jwt);
    return { kind: "ok", tier: row.tier, remaining: row.remaining };
  } catch (e) {
    if (e instanceof QuotaExceededError) throw e;
    if (e instanceof UnauthorizedError) {
      // 401 already flipped the app to needs-activation; downstream pipeline
      // can run as unauthenticated.
      return { kind: "unknown", reason: "unauthorized" };
    }
    // BackendOfflineError / RequestTimeoutError / unknown — caller decides
    // whether to proceed or warn the user. Old behavior was silent null →
    // we keep that lenient default at the call site, but surface the reason
    // so the UI can show a transient warning ("we couldn't confirm your
    // remaining quota — proceeding").
    return { kind: "unknown", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Legacy shim — preserves the OLD null-on-transient contract so App.tsx
 * keeps compiling while it's refactored to the new tri-state. See finding #8.
 * @deprecated Use maybeCheckQuota() (returns QuotaCheck) instead. */
export async function maybeCheckQuotaLegacy(): Promise<{ tier: string; remaining: number | null } | null> {
  const result = await maybeCheckQuota();
  if (result.kind === "ok") return { tier: result.tier, remaining: result.remaining };
  return null;
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

/** Thrown by authedFetch when a request exceeds the per-method timeout
 * (30s reads, 60s writes). Without this, a dropped TCP can hang the UI
 * promise for the OS default 60-300s — which mid-demo looks like Liquid Clips
 * is broken. Catchers should surface "Network slow — try again" and re-enable
 * whatever action the user took. See finding #1. */
export class RequestTimeoutError extends Error {
  readonly kind = "request_timeout" as const;
}

/** Thrown by publishNow when the source clip exceeds the in-memory upload
 * ceiling (500MB today). The user should be routed to Schedule (which streams)
 * instead of having the webview try to materialise 1.4GB as a Uint8Array and
 * OOM the renderer. See finding #6. */
export class PayloadTooLargeError extends Error {
  readonly kind = "payload_too_large" as const;
}

// ─── humanize backend errors (finding #10) ───────────────────────────────
// Pair this with sidecar.ts's humanError() so every layer produces consistent
// friendly strings. The point: screens don't need to know our error taxonomy —
// they just print humanizeBackendError(e) and it picks the right message.
export function humanizeBackendError(e: unknown): string {
  if (e instanceof RequestTimeoutError) return "Network slow — try again.";
  if (e instanceof BackendOfflineError) return "Can't reach Liquid Clips right now. Check your connection and retry.";
  if (e instanceof UnauthorizedError) return "Your session expired. Sign in to Liquid Clips again.";
  if (e instanceof QuotaExceededError) return e.message || "You've hit your plan's limit. Upgrade to keep going.";
  if (e instanceof PayloadTooLargeError) return e.message || "Clip is too large to publish directly — use Schedule instead.";
  // Fall through to the sidecar's pattern-matcher so we don't duplicate its
  // long list of HTTP / Python / network heuristics.
  return sidecarHumanError(e);
}

/** Re-export of sidecar.humanError under a stable name from this layer.
 * Screens that already import humanError from sidecar keep working; new code
 * that touches network-only errors can pull it from here. See finding #10. */
export { sidecarHumanError as humanError };

// Tier names match junior-backend/app/features.py FEATURES_BY_TIER. Legacy
// 'growth' / 'autopilot' are kept here for backend compatibility — the
// _LEGACY_TIER_ALIASES map on the backend converts them to 'pro' / 'agency'
// transparently. Public-facing copy in TIER_COPY (useTier.ts) uses Pro / Agency.
export type Tier = "free" | "solo" | "pro" | "agency" | "growth" | "autopilot";

// Convenience alias — matches the name the user-journey-lens findings used.
export type TierName = Tier;

// ─── Cached-tier helpers (finding #4) ────────────────────────────────────
// syncStatus() used to silent-degrade to {tier: "free"} on transient errors,
// which means a paying user could briefly see fake upgrade walls when the
// backend hiccuped. The new contract throws BackendOfflineError instead —
// callers should fall back to the last-known tier persisted via these helpers.
// They're best-effort; localStorage failures (private browsing, quota) just
// log and continue.
const CACHED_TIER_KEY = "junior:cached-tier:v1";

export function readCachedTier(): TierName | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHED_TIER_KEY);
    if (!raw) return null;
    // Validate it's one of the known tiers — if we ever rename them this
    // catches stale stored values cleanly.
    const valid: TierName[] = ["free", "solo", "pro", "agency", "growth", "autopilot"];
    return valid.includes(raw as TierName) ? (raw as TierName) : null;
  } catch {
    return null;
  }
}

export function writeCachedTier(t: TierName): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHED_TIER_KEY, t);
  } catch {
    /* localStorage quota or private browsing — best-effort */
  }
}

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
  // True when the user's email is on JUNIOR_ADMIN_EMAILS. useTier forces
  // "agency" capabilities in this case so a founder demo isn't blocked by its
  // own upgrade walls. Optional for back-compat with older backends.
  admin_override?: boolean;
};

/**
 * Pulls the current subscription state from Junior Backend.
 *
 * Contract (finding #4):
 *  - null              → user has no JWT (unactivated). Settings then defaults
 *                        to the marketing Upgrade flow instead of branching.
 *  - SyncStatus        → backend responded with a real subscription row.
 *  - throws            → backend transport / 5xx error. Callers should fall
 *                        back to readCachedTier() rather than silently
 *                        downgrading to "free" (which previously caused paid
 *                        users to see fake upgrade walls during a hiccup).
 *                        Catching is required; UnauthorizedError still bubbles.
 *
 * On a successful response we also write the tier to localStorage so the next
 * transient failure has something better than "free" to fall back to.
 */
export async function syncStatus(): Promise<SyncStatus | null> {
  if (isWebPreview()) return previewSyncStatus();
  const res = await authedFetch("/sync");
  if (res.status === 404) return null; // backend has no row for this user
  if (!res.ok) {
    // 5xx / 429 / unexpected status — surface as a transport error so the
    // caller can decide whether to fall back to the cached tier or retry.
    throw backendErrorFor("sync failed", res);
  }
  const body = (await res.json()) as SyncStatus;
  if (body?.tier) writeCachedTier(body.tier);
  return body;
}

/** Legacy shim — preserves the OLD null-on-error contract for any caller
 * that hasn't been refactored to handle the throw. Prefer the typed syncStatus()
 * + readCachedTier() pair for new code. Marked deprecated so the audit can
 * delete remaining callers in a follow-up. See finding #4.
 * @deprecated Use syncStatus() + readCachedTier() instead. */
export async function syncStatusLegacy(): Promise<SyncStatus | null> {
  try {
    return await syncStatus();
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
  if (!res.ok) throw backendErrorFor("affiliate fetch failed", res);
  return (await res.json()) as AffiliateMeResponse;
}


/**
 * v0.7.7 ship-lens fix #9 — meStatus discriminated union.
 *
 * The previous contract returned `MeStatus | null` and silently lumped
 * three very different states into the same `null`:
 *   - never signed in (no JWT in keychain)        — UnauthorizedError caught
 *   - stale / expired JWT (401 from /me)          — UnauthorizedError caught
 *   - transport hiccup (network, 5xx, DNS)        — generic Error caught
 *
 * Settings then rendered the same "Sign in to your Liquid Clips account"
 * card for all three, so a paying user whose token expired silently looked
 * identical to a fresh install. They never saw "your session expired —
 * re-activate this device" because the code couldn't tell.
 *
 * The new return type distinguishes:
 *   - { kind: "ok", data }       — backend returned the row.
 *   - { kind: "expired" }        — JWT rejected (401). User had a token
 *                                  but it's no longer valid; fire the
 *                                  re-activation banner.
 *   - { kind: "signed-out" }     — no JWT at all OR backend offline.
 *                                  Existing "Sign in" copy applies.
 *
 * The legacy `meStatus()` callsites used `.catch(() => null)` over this
 * function — kept compatible by adding `meStatusLegacy()`. New callers
 * (Settings) read the union directly.
 */
export type MeStatusResult =
  | { kind: "ok"; data: MeStatus }
  | { kind: "expired" }
  | { kind: "signed-out" };

export async function meStatus(): Promise<MeStatusResult> {
  if (isWebPreview()) return { kind: "signed-out" };
  try {
    const res = await authedFetch("/me");
    if (!res.ok) {
      // The 401-path is caught by authedFetch + handleUnauthorized and
      // thrown as UnauthorizedError below; this branch covers 5xx / 404
      // / unexpected statuses. Treat as "signed-out" so the user sees
      // the Sign-in card rather than a misleading "session expired"
      // banner when the backend is simply unreachable.
      return { kind: "signed-out" };
    }
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
    return { kind: "ok", data: body };
  } catch (e) {
    // UnauthorizedError = the JWT was present but rejected. Surface as
    // "expired" so Settings can render the fuchsia re-activate banner.
    // Any other thrown error is a transport hiccup — collapse to
    // "signed-out" (caller falls back to cached state).
    if (e instanceof UnauthorizedError) return { kind: "expired" };
    return { kind: "signed-out" };
  }
}

/**
 * Legacy callers that haven't been refactored to the union. Returns the old
 * `MeStatus | null` contract: ok → data, otherwise → null. The boot-time
 * /sync race in App.tsx, useTier, AvatarOrbit, AvatarPanel use this shim
 * because they only ever consumed `.email` for the admin-fallback check —
 * none of them rendered the expired banner. New callers should consume
 * meStatus() directly so the expired state can land where it matters.
 * @deprecated Prefer meStatus() — the union carries the "expired" signal.
 */
export async function meStatusLegacy(): Promise<MeStatus | null> {
  const r = await meStatus();
  return r.kind === "ok" ? r.data : null;
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
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
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

// ── Schedule v2: multi-channel + analytics ────────────────────────────

export type ChannelPlatform =
  | "tiktok" | "instagram" | "youtube" | "x" | "linkedin" | "facebook" | "threads";

// ship-lens v0.7.8 P1 — `unlinked` distinguishes "platform revoked my access"
// (TikTok session expired, I disconnected on the social side) from
// `pending_link` ("I never finished the OAuth dance"). Backend stamps
// last_unlinked_at when it lands; surfaces as "Disconnected — reconnect" copy.
export type ChannelStatus =
  | "pending_link" | "active" | "error" | "paused" | "deleted" | "unlinked";

export type Channel = {
  id: string;
  label: string;
  platform: ChannelPlatform;
  handle: string | null;
  status: ChannelStatus;
  total_posts: number;
  last_refreshed_at: string | null;
  created_at: string;
};

export type ChannelCreateResponse = {
  channel: Channel;
  link_url: string;
};

export async function listChannels(): Promise<Channel[]> {
  if (isWebPreview()) return [];
  try {
    const res = await authedFetch("/channels");
    if (!res.ok) return [];
    return (await res.json()) as Channel[];
  } catch {
    return [];
  }
}

export async function createChannel(input: { platform: ChannelPlatform; label: string }): Promise<ChannelCreateResponse> {
  if (isWebPreview()) {
    return {
      channel: { id: "ch_preview", label: input.label, platform: input.platform, handle: null, status: "pending_link", total_posts: 0, last_refreshed_at: null, created_at: new Date().toISOString() },
      link_url: `https://app.ayrshare.com/social-accounts?profileKey=preview&platforms=${encodeURIComponent(input.platform)}`,
    };
  }
  const res = await authedFetch("/channels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't create channel: HTTP ${res.status}`);
  }
  return res.json();
}

export async function patchChannel(id: string, patch: { label?: string; status?: "active" | "paused" }): Promise<Channel> {
  const res = await authedFetch(`/channels/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't update channel: HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteChannel(id: string): Promise<void> {
  const res = await authedFetch(`/channels/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't delete channel: HTTP ${res.status}`);
  }
}

export async function refreshChannel(id: string): Promise<Channel> {
  const res = await authedFetch(`/channels/${id}/refresh`, { method: "POST" });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't refresh channel: HTTP ${res.status}`);
  }
  return res.json();
}

export async function relinkChannel(id: string): Promise<{ link_url: string; channel: Channel }> {
  const res = await authedFetch(`/channels/${id}/relink`, { method: "POST" });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't relink channel: HTTP ${res.status}`);
  }
  return res.json();
}

// One-click probe of a channel's live state. Hits the admin-side diagnose
// endpoint which inspects the Ayrshare profile, the last 10 webhooks, and
// returns a recommended_action string the UI can show verbatim. Used by the
// "Diagnose" affordance on pending_link channels (ChannelCard + InlineScheduler
// rescue UI) so the user / admin can see WHY a link hasn't completed without
// digging through backend logs.
export async function diagnoseChannel(id: string): Promise<{
  channel: Channel;
  ayrshare: {
    profile_found: boolean;
    platforms_linked: Array<{ platform: string; handle: string | null; status: string }>;
    raw_response: string;
  };
  last_10_webhooks: Array<{ received_at: string; event_type: string; status: string; processing_ms: number; signature_ok: boolean; error: string | null }>;
  recommended_action: string;
}> {
  const res = await authedFetch(`/admin/channels/${id}/diagnose`, { method: "POST" });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't diagnose channel: HTTP ${res.status}`);
  }
  return res.json();
}

// ── Analytics ─────────────────────────────────────────────────────────

export type AnalyticsWindow = "7d" | "30d" | "90d" | "all";

export type AnalyticsOverview = {
  window: AnalyticsWindow;
  total_views: number;
  total_engagement: number;
  total_posts: number;
  best_channel: { id: string; label: string; platform: string; views: number } | null;
  best_clip: { schedule_id: string; title: string; views: number; platform: string; post_url: string | null } | null;
};

export type ChannelAnalyticsRow = {
  channel_id: string;
  label: string;
  platform: string;
  handle: string | null;
  posts: number;
  views: number;
  engagement: number;
  engagement_rate: number | null;
};

export type ChannelDetail = {
  channel_id: string;
  label: string;
  platform: string;
  handle: string | null;
  window: AnalyticsWindow;
  total_posts: number;
  total_views: number;
  total_engagement: number;
  top_clips: Array<{ schedule_id: string; clip_title: string; scheduled_for: string | null; post_url: string | null; views: number; likes: number }>;
};

export async function analyticsOverview(window: AnalyticsWindow = "30d"): Promise<AnalyticsOverview | null> {
  if (isWebPreview()) return null;
  try {
    const res = await authedFetch(`/analytics/overview?window=${window}`);
    if (!res.ok) return null;
    return (await res.json()) as AnalyticsOverview;
  } catch { return null; }
}

export async function analyticsChannels(window: AnalyticsWindow = "30d"): Promise<ChannelAnalyticsRow[]> {
  if (isWebPreview()) return [];
  try {
    const res = await authedFetch(`/analytics/channels?window=${window}`);
    if (!res.ok) return [];
    return (await res.json()) as ChannelAnalyticsRow[];
  } catch { return []; }
}

export async function analyticsChannelDetail(id: string, window: AnalyticsWindow = "30d"): Promise<ChannelDetail | null> {
  if (isWebPreview()) return null;
  try {
    const res = await authedFetch(`/analytics/channels/${id}?window=${window}`);
    if (!res.ok) return null;
    return (await res.json()) as ChannelDetail;
  } catch { return null; }
}

/** v0.6.0 — In-app social linking. Calls /social/start-link which mints
 * an Ayrshare JWT + returns a deep-linked hosted URL the desktop opens in
 * the user's real browser. Google blocks OAuth from embedded WebViews, so
 * browser-based linking is required for YouTube/Google and safer for Meta/
 * Instagram too. When `platform` is set the user lands directly on that
 * platform's OAuth, so the experience reads as "Sign in with X" rather than
 * "Sign in to Ayrshare first." */
export async function socialStartLink(
  platform?: "youtube" | "tiktok" | "instagram" | "x" | "facebook" | "linkedin",
): Promise<{ link_url: string; profile_key_set: boolean }> {
  if (isWebPreview()) {
    return { link_url: "https://app.ayrshare.com/auth?demo=1", profile_key_set: true };
  }
  const qs = platform ? `?platform=${encodeURIComponent(platform)}` : "";
  const res = await authedFetch(`/social/start-link${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Couldn't start linking: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get the user's social-connection state (finding #3).
 *
 * Contract:
 *  - SocialConnectionState   → backend returned a row (may have platforms: [])
 *  - "no-connection"          → backend returned 404 OR an empty/missing row.
 *                               Caller should route the user to Settings →
 *                               Connections to link one.
 *  - throws BackendOfflineError → transport / 5xx / RequestTimeoutError.
 *                               Caller should render an "offline" / retry
 *                               surface, NOT the "connect a profile" CTA.
 *  - throws UnauthorizedError  → already self-healed by handleUnauthorized.
 *
 * Old contract was nullable, which collapsed "no row" and "backend down" into
 * the same state — PublishModal then sent the user to Settings to "connect"
 * during what was actually a temporary 503.
 */
// ─── socialGetConnection split (finding #3) ──────────────────────────────
// The strict version distinguishes "no row" from "backend down" so the UI
// can decide between "Connect a profile" CTA and "We're offline, retry" copy.
// We can't touch the existing callers in this pass, so the public
// socialGetConnection() name keeps its old null-on-anything contract for
// back-compat and new code is asked to migrate to socialGetConnectionStrict().

export async function socialGetConnectionStrict(): Promise<SocialConnectionState | "no-connection"> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["tiktok", "youtube"], active: true };
  }
  const res = await authedFetch("/social/connections");
  if (res.status === 404) return "no-connection";
  if (!res.ok) {
    // 5xx / 429 / unexpected — surface transport error rather than mis-signal
    // "go connect a profile" to a user whose backend is briefly down.
    throw backendErrorFor("social connections failed", res);
  }
  const body = (await res.json()) as SocialConnectionState;
  // Empty-row case: backend returned 200 with no platforms and not connected.
  // Treat as "no-connection" so the UI shows the same CTA as a 404.
  if (!body || (!body.connected && (!body.platforms || body.platforms.length === 0))) {
    return "no-connection";
  }
  return body;
}

/** Back-compat wrapper — preserves the OLD null-on-anything contract so
 * AyrshareConnectionPanel / PublishModal / SchedulePage / InlineScheduler /
 * DirectPublishQueue keep compiling untouched. Catches the BackendOfflineError
 * + collapses "no-connection" → null. New code should call
 * socialGetConnectionStrict() so the UI can tell "backend down" apart from
 * "user has no row" — see finding #3 for the journey-lens reason.
 *
 * TODO(callers): migrate these sites to socialGetConnectionStrict() and
 * handle the throw + "no-connection" literal:
 *   - src/components/AyrshareConnectionPanel.tsx (line 54)
 *   - src/components/PublishModal.tsx (line 159)
 *   - src/components/schedule/SchedulePage.tsx (line 82)
 *   - src/components/clips-feed/InlineScheduler.tsx (lines 101, 130)
 *   - src/components/upload/DirectPublishQueue.tsx (line 95)
 *
 * @deprecated Use socialGetConnectionStrict() instead. */
export async function socialGetConnection(): Promise<SocialConnectionState | null> {
  try {
    const result = await socialGetConnectionStrict();
    return result === "no-connection" ? null : result;
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
    if (res.status >= 500) throw new BackendOfflineError(`HTTP ${res.status}`);
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
  if (!res.ok) throw backendErrorFor("refresh failed", res);
  return (await res.json()) as SocialConnectionState;
}

export async function socialDisconnectPlatform(platform: string): Promise<SocialConnectionState> {
  if (isWebPreview()) {
    return { connected: true, profile_key_set: true, platforms: ["youtube"], active: true };
  }
  const res = await authedFetch(`/social/disconnect/${encodeURIComponent(platform)}`, { method: "DELETE" });
  if (!res.ok) throw backendErrorFor("disconnect failed", res);
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
        title: "Welcome to Liquid Clips.",
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
