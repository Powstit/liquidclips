/**
 * Liquid Clips edge worker · L1 Cache API → L2 KV → L3 Railway origin.
 *
 * Serves 4 of 5 hot endpoints entirely from Cloudflare's edge:
 *   GET  /audit/state             — cached 30s (public status)
 *   GET  /hq/carousel/clips       — cached 60s (login carousel)
 *   POST /cold-leads/prep         — queued, 202 in ~5ms
 *   POST /webhooks/whop           — HMAC verified at edge, queued, 202
 *
 * Passes through to Railway (proxied, no cache, no queue):
 *   POST /desktop/connect         — JWT mint, unique per response
 *
 * Every other path is NOT_FOUND at the Worker — the desktop app is
 * expected to hit the Railway origin for anything not listed above.
 * That means /sync, /me, /lc-ids/*, /wallet/*, /sponsored/*, etc. all
 * bypass the Worker entirely and stay on Railway.
 *
 * Codex mandate 2026-07-08 · rules 3-6 (safe surface), 7-8 (secrets),
 * 12 (HALT before prod cutover). Adapted for the Standard Webhooks
 * format Whop actually uses (see junior-backend/app/routes/webhooks_whop.py).
 */

export interface Env {
  LC_EDGE_KV: KVNamespace;
  COLD_LEADS_QUEUE: Queue;
  WHOP_WEBHOOK_QUEUE: Queue;

  /** Public Railway origin. Safe to commit. */
  BACKEND_ORIGIN: string;
  /** Build SHA, populated at deploy time via `wrangler deploy --var LC_BUILD_SHA=$(git rev-parse HEAD)`. */
  LC_BUILD_SHA: string;

  /** Shared secret matching require_hq_secret in junior-backend/app/routes/hq.py. */
  HQ_SHARED_SECRET: string;
  /** Standard Webhooks secret (whsec_… format, base64-encoded after prefix). */
  WHOP_WEBHOOK_SECRET: string;
  /** Internal-secret used by /internal/queues/* consumer endpoints on Railway. */
  INTERNAL_QUEUE_SECRET: string;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Types                                                              */
/* ═══════════════════════════════════════════════════════════════════ */

type CachePayload = {
  body: string;
  status: number;
  headers: Record<string, string>;
  expiresAt: number;
  staleUntil: number;
};

type QueueMessage =
  | {
      kind: "cold_leads_prep";
      idempotencyKey: string;
      receivedAt: string;
      payload: Record<string, unknown>;
    }
  | {
      kind: "whop_webhook";
      eventId: string;
      receivedAt: string;
      rawBody: string;
      headers: Record<string, string>;
    };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

/* ═══════════════════════════════════════════════════════════════════ */
/* Entrypoints — fetch() for incoming HTTP, queue() for batch drain    */
/* ═══════════════════════════════════════════════════════════════════ */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/audit/state") {
        return await cachedGet({
          request,
          env,
          ctx,
          route: "audit-state",
          upstreamPath: "/audit/state",
          ttlSeconds: 30,
          staleSeconds: 300,
          kvKey: "v1:audit-state",
        });
      }

      if (path === "/hq/carousel/clips") {
        const rawEmail = url.searchParams.get("cold_lead_email") || "";
        // Hash the email BEFORE it enters any cache key or log line.
        // Even the hash never touches request logs — only Cloudflare's
        // KV storage. Mandate rule 7.
        const emailHash = rawEmail
          ? await sha256Hex(rawEmail.trim().toLowerCase())
          : "none";
        const limit = url.searchParams.get("limit") || "";
        const campaign = url.searchParams.get("campaign_id") || "";
        const upstreamPath =
          "/hq/carousel/clips" +
          (rawEmail || limit || campaign
            ? "?" +
              new URLSearchParams({
                ...(rawEmail ? { cold_lead_email: rawEmail } : {}),
                ...(limit ? { limit } : {}),
                ...(campaign ? { campaign_id: campaign } : {}),
              }).toString()
            : "");
        return await cachedGet({
          request,
          env,
          ctx,
          route: "carousel-clips",
          upstreamPath,
          ttlSeconds: 60,
          staleSeconds: 600,
          kvKey: `v1:carousel:${emailHash}:${limit || "d"}:${campaign || "n"}`,
        });
      }

      if (path === "/cold-leads/prep") {
        return await queueColdLeadPrep(request, env);
      }

      if (path === "/webhooks/whop") {
        return await queueWhopWebhook(request, env);
      }

      if (path === "/desktop/connect") {
        return await proxyRailway(request, env, "/desktop/connect", "desktop-connect", 2500);
      }

      // Edge health probe — used by wrangler dev, by Cloudflare health
      // dashboard, and as a k6 warmup / rollback signal.
      if (path === "/edge/ping") {
        return json({ ok: true, edge: "liquid-clips", build: env.LC_BUILD_SHA || "dev" }, 200, env, "edge-ping");
      }

      return json({ ok: false, error: "not_found" }, 404, env, "unknown");
    } catch (err) {
      // Never leak raw exception details to the client. Log a structured
      // event server-side, return an opaque 500.
      const errName = err instanceof Error ? err.name : "unknown";
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ level: "error", where: "edge.fetch", path, errName, errMsg }));
      return json({ ok: false, error: "edge_error" }, 500, env, "edge-error", {
        "x-lc-error-class": errName,
      });
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body;
      try {
        const endpoint =
          body.kind === "whop_webhook"
            ? "/internal/queues/whop-webhook"
            : "/internal/queues/cold-leads-prep";

        const res = await fetch(`${env.BACKEND_ORIGIN}${endpoint}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": env.INTERNAL_QUEUE_SECRET,
            "x-lc-internal-queue": "1",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          throw new Error(`backend_queue_failed_${res.status}`);
        }
        msg.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            where: "edge.queue",
            kind: body.kind,
            errName: err instanceof Error ? err.name : "unknown",
            // Note: NO body content logged — mandate rule 7.
          }),
        );
        // Do not ack. Cloudflare retries per queue config; after max_retries
        // the message lands in `lc-dead-letter` for manual drain.
        msg.retry();
      }
    }
  },
};

/* ═══════════════════════════════════════════════════════════════════ */
/* L1/L2 cached-get pipeline                                          */
/* ═══════════════════════════════════════════════════════════════════ */

async function cachedGet(args: {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  route: string;
  upstreamPath: string;
  ttlSeconds: number;
  staleSeconds: number;
  kvKey: string;
}): Promise<Response> {
  const { request, env, ctx, route, upstreamPath, ttlSeconds, staleSeconds, kvKey } = args;

  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405, env, route);
  }

  const cache = caches.default;
  // Synthetic cache key — never uses the actual public URL so cache
  // isolation between routes is deterministic + doesn't leak sensitive
  // query params into the cache key surface.
  const cacheKey = new Request(`https://edge-cache.liquidclips.local/${route}/${kvKey}`, {
    method: "GET",
  });

  // L1 — Cache API. Serves without any subrequest at all.
  const l1 = await cache.match(cacheKey);
  if (l1) {
    return withEdgeHeaders(l1, env, route, "HIT");
  }

  const now = Date.now();

  // L2 — KV. Eventually consistent global read.
  const kvPayload = await env.LC_EDGE_KV.get<CachePayload>(kvKey, "json");
  if (kvPayload && kvPayload.expiresAt > now) {
    const res = payloadToResponse(kvPayload, env, route, "KV", ttlSeconds);
    // Warm L1 in the background so the next hit is HIT not KV.
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  // L3 — Railway origin. Hard 1200ms timeout on refresh so a slow
  // backend can never block the user's response.
  try {
    const originRes = await timeoutFetch(
      `${env.BACKEND_ORIGIN}${upstreamPath}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-lc-edge": "1",
        },
      },
      1200,
    );

    if (!originRes.ok) {
      throw new Error(`origin_${originRes.status}`);
    }

    const body = await originRes.text();
    const payload: CachePayload = {
      body,
      status: originRes.status,
      headers: {
        "content-type": originRes.headers.get("content-type") || "application/json; charset=utf-8",
      },
      expiresAt: now + ttlSeconds * 1000,
      staleUntil: now + staleSeconds * 1000,
    };
    const res = payloadToResponse(payload, env, route, "ORIGIN", ttlSeconds);

    // Warm both L1 + L2 in the background. User already got their response.
    ctx.waitUntil(
      Promise.all([
        env.LC_EDGE_KV.put(kvKey, JSON.stringify(payload), {
          // KV requires min 60s expirationTtl.
          expirationTtl: Math.max(60, staleSeconds),
        }),
        cache.put(cacheKey, res.clone()),
      ]),
    );

    return res;
  } catch (err) {
    // Stale fallback — if we have ANY KV value that's within its
    // staleUntil window, serve it rather than 5xx to the user.
    if (kvPayload && kvPayload.staleUntil > now) {
      return payloadToResponse(kvPayload, env, route, "STALE", 10);
    }

    console.error(
      JSON.stringify({
        level: "warn",
        where: "edge.cachedGet",
        route,
        errName: err instanceof Error ? err.name : "unknown",
      }),
    );
    return json({ ok: false, error: "origin_unavailable" }, 503, env, route, {
      "cache-control": "no-store",
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Write producers                                                    */
/* ═══════════════════════════════════════════════════════════════════ */

async function queueColdLeadPrep(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, env, "cold-leads-prep");
  }

  const provided = request.headers.get("x-hq-secret") || request.headers.get("x-hq-shared-secret") || "";
  if (!safeEqual(provided, env.HQ_SHARED_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401, env, "cold-leads-prep");
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, env, "cold-leads-prep");
  }

  // Idempotency key = deterministic hash of (email, campaign_id).
  // Duplicate producer messages fold into one consumer upsert.
  const emailForKey = String((payload as { email?: unknown }).email || "").toLowerCase();
  const campaignForKey = String(
    (payload as { campaign_id?: unknown }).campaign_id || "unknown",
  );
  const idempotencyKey =
    typeof (payload as { idempotency_key?: unknown }).idempotency_key === "string"
      ? String((payload as { idempotency_key?: unknown }).idempotency_key)
      : `cold:${await sha256Hex(`${emailForKey}|${campaignForKey}`)}`;

  await env.COLD_LEADS_QUEUE.send({
    kind: "cold_leads_prep",
    idempotencyKey,
    receivedAt: new Date().toISOString(),
    payload,
  });

  return json({ ok: true, queued: true, idempotencyKey }, 202, env, "cold-leads-prep", {
    "x-lc-edge-cache": "QUEUED",
  });
}

async function queueWhopWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, env, "whop-webhook");
  }

  const rawBody = await request.text();

  // Standard Webhooks format (Whop's actual protocol per
  // junior-backend/app/routes/webhooks_whop.py:311).
  const webhookId = request.headers.get("webhook-id") || "";
  const webhookTimestamp = request.headers.get("webhook-timestamp") || "";
  const webhookSignature = request.headers.get("webhook-signature") || "";

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return json({ ok: false, error: "missing_signature_headers" }, 401, env, "whop-webhook");
  }

  const valid = await verifyStandardWebhookSignature({
    webhookId,
    webhookTimestamp,
    body: rawBody,
    providedSignature: webhookSignature,
    secret: env.WHOP_WEBHOOK_SECRET,
  });
  if (!valid) {
    return json({ ok: false, error: "invalid_signature" }, 401, env, "whop-webhook");
  }

  // eventId lands on the consumer for idempotency dedup — matches the
  // backend's existing WebhookEventLog.external_id contract.
  let parsedId = "";
  try {
    const parsed = JSON.parse(rawBody) as {
      id?: string;
      event_id?: string;
      data?: { id?: string };
    };
    parsedId = parsed.id || parsed.event_id || parsed.data?.id || "";
  } catch {
    /* keep parsedId empty; fall through to webhook-id */
  }
  const eventId = webhookId || parsedId || (await sha256Hex(rawBody));

  await env.WHOP_WEBHOOK_QUEUE.send({
    kind: "whop_webhook",
    eventId,
    receivedAt: new Date().toISOString(),
    rawBody,
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": webhookSignature,
    },
  });

  return json({ ok: true, queued: true, eventId }, 202, env, "whop-webhook", {
    "x-lc-edge-cache": "QUEUED",
  });
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Railway proxy (for /desktop/connect — JWT mint stays on origin)   */
/* ═══════════════════════════════════════════════════════════════════ */

async function proxyRailway(
  request: Request,
  env: Env,
  upstreamPath: string,
  route: string,
  timeoutMs: number,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const upstream = new URL(`${env.BACKEND_ORIGIN}${upstreamPath}`);
  upstream.search = incomingUrl.search;

  // Preserve all client headers except Host (Cloudflare rewrites this
  // for us and the origin's TLS certificate matches Railway's hostname).
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("x-lc-edge", "1");

  const res = await timeoutFetch(
    upstream.toString(),
    {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    },
    timeoutMs,
  );

  return withEdgeHeaders(res, env, route, "BYPASS");
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Response helpers                                                   */
/* ═══════════════════════════════════════════════════════════════════ */

function payloadToResponse(
  payload: CachePayload,
  env: Env,
  route: string,
  cacheState: string,
  ttlSeconds: number,
): Response {
  return new Response(payload.body, {
    status: payload.status,
    headers: {
      ...payload.headers,
      "cache-control": `public, max-age=${ttlSeconds}`,
      "x-lc-edge-cache": cacheState,
      "x-lc-route": route,
      "x-lc-build": env.LC_BUILD_SHA || "dev",
    },
  });
}

function withEdgeHeaders(res: Response, env: Env, route: string, cacheState: string): Response {
  const next = new Response(res.body, res);
  next.headers.set("x-lc-edge-cache", cacheState);
  next.headers.set("x-lc-route", route);
  next.headers.set("x-lc-build", env.LC_BUILD_SHA || "dev");
  return next;
}

function json(
  body: unknown,
  status: number,
  env: Env,
  route: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "cache-control": "no-store",
      "x-lc-route": route,
      "x-lc-build": env.LC_BUILD_SHA || "dev",
      ...extraHeaders,
    },
  });
}

async function timeoutFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Crypto — Standard Webhooks signature verification                   */
/* ═══════════════════════════════════════════════════════════════════ */

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a Standard Webhooks signature (Whop's protocol as of 2026-06).
 *
 * Signed content = `{webhook-id}.{webhook-timestamp}.{body}` (utf-8).
 * Secret format:
 *   - `whsec_<base64>` — decode base64 after the prefix, use raw bytes
 *   - anything else    — use utf-8 encoding of the string (legacy `ws_`)
 * HMAC-SHA256 over signed content, base64 encode, compare against every
 * `v1,<sig>` in the space-separated `webhook-signature` header. Constant-time
 * compare per version.
 */
async function verifyStandardWebhookSignature(args: {
  webhookId: string;
  webhookTimestamp: string;
  body: string;
  providedSignature: string;
  secret: string;
}): Promise<boolean> {
  const { webhookId, webhookTimestamp, body, providedSignature, secret } = args;
  if (!secret) return false;

  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;

  let keyBytes: Uint8Array;
  if (secret.startsWith("whsec_")) {
    // Base64 body after the prefix.
    const b64 = secret.slice("whsec_".length);
    try {
      const bin = atob(b64);
      keyBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
    } catch {
      return false;
    }
  } else {
    keyBytes = new TextEncoder().encode(secret);
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedContent),
  );
  const expected = arrayBufferToBase64(mac);

  // The header may contain multiple space-separated versions, each
  // formatted `v<n>,<base64sig>`. Accept any v1 that matches.
  const parts = providedSignature.split(" ");
  for (const part of parts) {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) continue;
    if (safeEqual(expected, sig)) return true;
  }
  return false;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
  return out === 0;
}
