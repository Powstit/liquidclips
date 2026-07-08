# Deploy artifacts · edge-worker · 2026-07-08

Mandate rule 10 · produced BEFORE any production traffic switch.
This document is the pre-deploy review packet.

---

## 1. Route map

| Request path | Method | Layer served from | Worker action | Origin fallback |
|---|---|---|---|---|
| `/audit/state` | GET | L1 Cache API → L2 KV → L3 Railway | `cachedGet` · 30s TTL · 300s stale | Railway on cache miss + KV miss |
| `/hq/carousel/clips` | GET | L1 Cache API → L2 KV → L3 Railway | `cachedGet` · 60s TTL · 600s stale · email hashed | Railway on cache miss + KV miss |
| `/cold-leads/prep` | POST | Queue producer only | `queueColdLeadPrep` · HQ shared secret validate · 202 | Backend consumer at `/internal/queues/cold-leads-prep` |
| `/webhooks/whop` | POST | Queue producer only | `queueWhopWebhook` · Standard Webhooks HMAC validate · 202 | Backend consumer at `/internal/queues/whop-webhook` |
| `/desktop/connect` | POST | Proxy through to Railway | `proxyRailway` · 2500ms hard timeout | Railway origin |
| `/edge/ping` | GET | Worker only | Health probe · returns `{ok: true, edge: "liquid-clips"}` | none |
| any other path | any | Worker only | 404 `{ok: false, error: "not_found"}` | none |

Every other backend endpoint (`/sync`, `/me`, `/lc-ids/*`, `/wallet/*`,
`/sponsored/*`, `/whop/*`, admin routes) is NOT proxied — the desktop
app hits Railway directly for those. The Worker only owns the 5 routes
above.

## 2. KV namespace plan

Single namespace `LC_EDGE_KV`. Read-through cache only. Never used for
truth.

| Key format | Purpose | TTL (KV expirationTtl) | Sample content |
|---|---|---|---|
| `v1:audit-state` | Cached body of GET `/audit/state` | 300s | CachePayload JSON |
| `v1:carousel:<sha256-email-or-none>:<limit>:<campaign>` | Cached body of GET `/hq/carousel/clips` variant | 600s | CachePayload JSON |

Rules:
- No raw email. Email hashed via SHA-256 (`sha256Hex()` in src/index.ts:427)
  before it enters the cache key or any KV write.
- No user session data. No JWT truth. No wallet truth. No payment truth.
- Every value carries `{expiresAt, staleUntil}` so stale-while-revalidate
  returns something rather than 5xx-ing to the client.

Create with:
```
wrangler kv namespace create LC_EDGE_KV
```
Paste the returned ID into `wrangler.toml` `[[kv_namespaces]] id`.

## 3. Queue plan

Two queues + one dead-letter queue.

| Queue name | Producer | Consumer | Max batch | Timeout | Retries | DLQ |
|---|---|---|---|---|---|---|
| `lc-cold-leads-prep` | `queueColdLeadPrep` | Worker `queue()` → `POST /internal/queues/cold-leads-prep` | 25 | 5s | 5 | `lc-dead-letter` |
| `lc-whop-webhooks` | `queueWhopWebhook` | Worker `queue()` → `POST /internal/queues/whop-webhook` | 25 | 5s | 5 | `lc-dead-letter` |
| `lc-dead-letter` | (both queues on max_retries) | manual drain via `wrangler queues consumer add` | — | — | — | — |

Create with:
```
wrangler queues create lc-cold-leads-prep
wrangler queues create lc-whop-webhooks
wrangler queues create lc-dead-letter
```

Consumer payload shapes:
- `cold_leads_prep` → `{kind, idempotencyKey, receivedAt, payload}`.
  Idempotency key = SHA-256(`email|campaign_id`) unless caller provided one.
  Backend upsert dedupes on `(email, campaign_id)` UNIQUE.
- `whop_webhook` → `{kind, eventId, receivedAt, rawBody, headers}`.
  Backend replays into local `/webhooks/whop` which dedupes on
  `WebhookEventLog.external_id`.

## 4. Rollback plan

Rollback is one-directional and fully reversible. Steps to undo the
Worker entirely and put traffic back on Railway direct:

1. **DNS revert** — if the `api.liquidclips.app` DNS record was flipped
   to the Worker, restore its A/CNAME to point at
   `junior-backend-production.up.railway.app` (or the current Railway
   URL) via Cloudflare DNS panel. Immediate propagation on Cloudflare.
2. **Route removal** — `wrangler triggers` shows current Worker routes;
   `wrangler triggers delete <route>` removes them without deleting the
   Worker itself.
3. **Queue drain (optional)** — if queues have in-flight messages, let
   them drain first (typically < 1 min). If a message keeps failing,
   inspect `lc-dead-letter` via `wrangler queues list` + `wrangler queues
   consumer messages lc-dead-letter`.
4. **Consumer disable (optional)** — pause queue consumer with
   `wrangler queues consumer pause`. Producer keeps buffering during
   pause — buffered messages replay when consumer resumes.
5. **Backend rollback** — Railway consumer endpoints `/internal/queues/*`
   stay in the backend. They're harmless if the Worker isn't calling
   them and internal-secret gated regardless. No cleanup needed.

Rollback trigger conditions (any one is sufficient):
- k6 shows worse p95/error rate than baseline Railway numbers
- Cloudflare region outage detected via `edge/ping` probe failing
- Manual sign-off says pull it

## 5. k6 acceptance target

Rerun the same 5 scripts from earlier this session, targeting the Worker
URL instead of Railway direct. Acceptance thresholds per script:

| Script | Target URL prefix | Verdict criterion |
|---|---|---|
| `k6-audit-state.js` | Worker | p95 < 100ms · error rate < 1% · Railway origin hit count in same window drops ≥ 90% vs prior run |
| `k6-carousel-clips.js` | Worker | p95 < 100ms · error rate < 1% · Railway origin hit count drops ≥ 90% |
| `k6-desktop-connect.js` | Worker | p95 < 500ms · error rate < 1% · this proxies to Railway so p95 tracks origin |
| `k6-whop-webhook.js` | Worker · valid HMAC signed | p95 < 100ms · 100% 202 responses · signature-invalid variant returns 401 |
| `k6-cold-leads-prep.js` | Worker · valid HQ secret | p95 < 100ms · 100% 202 responses · missing-secret variant returns 401 |

Green verdict = ship. Any script red = block; open Cloudflare + Railway
logs, diagnose, iterate. `x-lc-edge-cache` response header tells you
where each request was served from (HIT / KV / ORIGIN / STALE / QUEUED
/ BYPASS).

## 6. Files changed

Branch: `edge/worker-ingestion`. Nothing merged to main.

**New files (5):**
- `edge-worker/package.json`
- `edge-worker/tsconfig.json`
- `edge-worker/wrangler.toml`
- `edge-worker/src/index.ts`
- `edge-worker/DEPLOY_ARTIFACTS.md` (this doc)
- `junior-backend/app/routes/internal_queues.py`

**Modified files (1):**
- `junior-backend/app/main.py` — one import + one `include_router` call
  for the new consumer endpoints.

**Untouched (rule 3):**
- No changes to `/desktop/connect`, `/sync`, `/me`, `/lc-ids/*`, wallet,
  agency campaigns, admin, or any auth/payment/JWT truth path.
- No changes to `webhooks_whop.py` — the consumer replays via HTTP.
- No changes to `cold_leads.py` — the consumer runs the same SQL inline
  (safer than importing a private function whose signature might
  change).

## 7. What Daniel still needs to hand me before deploy + k6

The mandate says don't ask for secrets in chat. Everything below goes
into `~/.claude-credentials/cloudflare.env` (mode 600) and is read from
there. I never echo any of these values.

Required:
```
CLOUDFLARE_ACCOUNT_ID=<from Cloudflare dashboard · Account Home · right sidebar>
CLOUDFLARE_API_TOKEN=<scoped token · Workers Scripts:Edit + KV Namespace:Edit + Queues:Edit + Cache Purge:Purge>
```

Also required outside the env file:
- **Workers Paid plan enabled** on the Cloudflare account (Queues + KV
  require paid tier, $5/mo).
- Confirmation on which subdomain the Worker should serve on:
  - Option A: `api.liquidclips.app` (moves the entire backend hostname
    to Cloudflare, then flip to Railway per route as needed via
    Worker routing)
  - Option B: `edge.liquidclips.app` (Worker gets its own hostname;
    desktop app config changes to point there)
  - Option C: use the default `liquid-clips-edge.<subdomain>.workers.dev`
    for k6-only testing, no DNS change yet

Recommended for the k6 proof: **Option C first**. Zero DNS risk, no
customer impact, no rollback complexity. Prove the Worker holds the
1M-user shape on `*.workers.dev`, then decide on the production
hostname.

## 8. Deploy sequence (only after Daniel's greenlight)

```
# From /Users/dipdip/code/jnr/edge-worker/
source ~/.claude-credentials/cloudflare.env
export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN

# 1. Create KV namespace, get ID, patch wrangler.toml
wrangler kv namespace create LC_EDGE_KV

# 2. Create the 3 queues
wrangler queues create lc-cold-leads-prep
wrangler queues create lc-whop-webhooks
wrangler queues create lc-dead-letter

# 3. Set the 3 secrets (interactive prompt for each)
wrangler secret put HQ_SHARED_SECRET
wrangler secret put WHOP_WEBHOOK_SECRET
wrangler secret put INTERNAL_QUEUE_SECRET

# 4. Deploy (stamps LC_BUILD_SHA)
wrangler deploy --var LC_BUILD_SHA=$(cd .. && git rev-parse --short HEAD)

# 5. Smoke test
curl -s https://liquid-clips-edge.<subdomain>.workers.dev/edge/ping
# expect: {"ok":true,"edge":"liquid-clips","build":"..."}
```

Backend deploy for the consumer endpoints:
```
cd /Users/dipdip/code/jnr/junior-backend
railway up --service junior-backend --detach
```

Then k6 dispatch:
```
gh workflow run k6.yml -f target=https://liquid-clips-edge.<subdomain>.workers.dev -f script=k6-audit-state.js
gh workflow run k6.yml -f target=https://liquid-clips-edge.<subdomain>.workers.dev -f script=k6-carousel-clips.js
gh workflow run k6.yml -f target=https://liquid-clips-edge.<subdomain>.workers.dev -f script=k6-cold-leads-prep.js
gh workflow run k6.yml -f target=https://liquid-clips-edge.<subdomain>.workers.dev -f script=k6-whop-webhook.js
gh workflow run k6.yml -f target=https://liquid-clips-edge.<subdomain>.workers.dev -f script=k6-desktop-connect.js
```

**HALT here per mandate rule 12.** No production DNS flip until Daniel
reviews per-endpoint verdicts.

## 9. Local dev

Everything above works locally without touching Cloudflare:
```
cd /Users/dipdip/code/jnr/edge-worker
npm run dev
# Wrangler starts a local Worker + local Miniflare KV + local queue mock
# Serve at http://localhost:8787
curl http://localhost:8787/edge/ping
```

## 10. Observability

Every response carries three custom headers:
- `x-lc-edge-cache: HIT | KV | ORIGIN | STALE | QUEUED | BYPASS`
- `x-lc-route: audit-state | carousel-clips | cold-leads-prep | whop-webhook | desktop-connect | edge-ping | unknown`
- `x-lc-build: <git sha>`

Debug a slow request by looking at the response headers first. If
`x-lc-edge-cache=ORIGIN` for a route that should be cached, either the
cache is cold (first request) or Railway is slow (check its own logs).
If it's `STALE`, Railway is failing and the edge is serving cached
copies to protect users.

## 11. What this DOES NOT do

Explicit list to avoid over-selling:
- Does not touch `/desktop/connect` semantics — proxied byte-for-byte.
- Does not touch JWT mint, signing, or renewal.
- Does not touch `/lc-ids/redeem` — stays on Railway.
- Does not touch `/sync`, `/me`, wallet, sponsored campaigns, admin.
- Does not implement rate limiting (deferred; Durable Objects when
  needed, scoped per-IP not global — mandate warns about global DOs).
- Does not migrate any data. No schema change on Railway. Backend
  schema is identical after this deploy.
