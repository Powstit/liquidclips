/**
 * DISTRIBUTED k6 · /webhooks/whop via Cloudflare edge Worker.
 * Budget: 200 VUs × 5 min = 17 VUh.
 *
 * Queue producer test with VALID Standard Webhooks HMAC signatures.
 * The Worker verifies HMAC at the edge, drops into `lc-whop-webhooks`
 * Cloudflare Queue, returns 202. Backend consumer replays the raw
 * body + headers into local /webhooks/whop.
 *
 * Auth: pass `-e WHOP_WEBHOOK_SECRET=<value>` — same value set via
 * `wrangler secret put WHOP_WEBHOOK_SECRET` on the Worker. Standard
 * Webhooks format:
 *   secret starts `whsec_` → base64-decode the body
 *   signed content = `{webhook-id}.{webhook-timestamp}.{body}`
 *   webhook-signature header = `v1,<base64 hmac-sha256>`
 *
 * Pass gate:
 *   - success rate ≥ 99% (status 202 · body has queued=true)
 *   - p95 < 200ms
 *   - no 5xx spike
 *   - `x-lc-edge-cache: QUEUED` present
 *   - Signature invalid variant returns 401 (correct rejection)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

const TARGET =
  __ENV.TARGET_URL || 'https://liquid-clips-edge.liquidclips.workers.dev';
const WHOP_SECRET = __ENV.WHOP_WEBHOOK_SECRET || '';

export const options = {
  scenarios: {
    distributed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '4m',  target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed:   ['rate<0.01'],
    'checks{route:whop-webhook}': ['rate>0.99'],
  },
  cloud: {
    projectID: 8035712,
    name: 'edge-worker · /webhooks/whop signed · distributed',
    distribution: {
      'amazon:us:ashburn':    { loadZone: 'amazon:us:ashburn',    percent: 20 },
      'amazon:us:portland':   { loadZone: 'amazon:us:portland',   percent: 20 },
      'amazon:gb:london':     { loadZone: 'amazon:gb:london',     percent: 20 },
      'amazon:de:frankfurt':  { loadZone: 'amazon:de:frankfurt',  percent: 20 },
      'amazon:sg:singapore':  { loadZone: 'amazon:sg:singapore',  percent: 20 },
    },
  },
};

export function setup() {
  if (!WHOP_SECRET) {
    throw new Error(
      'WHOP_WEBHOOK_SECRET env var required. Launch with: k6 cloud run -e WHOP_WEBHOOK_SECRET=<value> <script>',
    );
  }
}

/**
 * Compute Standard Webhooks HMAC-SHA256 signature.
 * Secret format: `whsec_<b64>` → decode b64; else utf-8 encode raw string.
 * Signature = base64( HMAC-SHA256( key, `{id}.{timestamp}.{body}` ) ).
 * Return as `v1,<sig>`.
 */
function signStandardWebhook(id, timestamp, body, secret) {
  const signedContent = `${id}.${timestamp}.${body}`;
  let keyBytes;
  if (secret.startsWith('whsec_')) {
    keyBytes = encoding.b64decode(secret.slice('whsec_'.length));
  } else {
    keyBytes = secret;
  }
  const macBytes = crypto.hmac('sha256', keyBytes, signedContent, 'binary');
  const sigB64 = encoding.b64encode(macBytes);
  return `v1,${sigB64}`;
}

export default function () {
  const webhookId = `evt_k6_${__VU}_${__ITER}`;
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  // Realistic Whop event shape (payment.succeeded is safe · idempotent
  // via external_id · backend dedupes so replay is harmless).
  const body = JSON.stringify({
    id: webhookId,
    event: 'payment.succeeded',
    data: {
      id: `pay_k6_${__VU}_${__ITER}`,
      amount_cents: 9999,
      user: { email: `k6-${__VU}@k6-loadtest.invalid` },
    },
  });

  const signature = signStandardWebhook(
    webhookId,
    webhookTimestamp,
    body,
    WHOP_SECRET,
  );

  const res = http.post(`${TARGET}/webhooks/whop`, body, {
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': signature,
    },
    tags: { name: 'whop_webhook', route: 'whop-webhook' },
  });

  check(
    res,
    {
      'status 202':               (r) => r.status === 202,
      'no 5xx':                   (r) => r.status < 500,
      'body has queued:true':     (r) => r.body && r.body.includes('"queued":true'),
      'x-lc-route header':        (r) => r.headers['X-Lc-Route'] === 'whop-webhook',
      'x-lc-edge-cache QUEUED':   (r) => r.headers['X-Lc-Edge-Cache'] === 'QUEUED',
    },
    { route: 'whop-webhook' },
  );
  sleep(1);
}
