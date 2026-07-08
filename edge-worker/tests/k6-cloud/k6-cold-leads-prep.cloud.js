/**
 * DISTRIBUTED k6 · /cold-leads/prep via Cloudflare edge Worker.
 * Budget: 200 VUs × 5 min = 17 VUh.
 *
 * Queue producer test. Worker validates HQ shared secret at edge,
 * drops payload in `lc-cold-leads-prep` Cloudflare Queue, returns
 * 202 in ~5ms. Backend consumer drains asynchronously.
 *
 * Auth: pass `-e HQ_SECRET=<value>` when launching so the header
 * is set. Value is the same as HQ_READ_SECRET on the Railway backend.
 *
 * Pass gate:
 *   - success rate ≥ 99% (status 202 · body has queued=true)
 *   - p95 < 200ms (queue producer should be very fast)
 *   - no 5xx spike
 *   - `x-lc-edge-cache: QUEUED` header present
 *   - `x-lc-route: cold-leads-prep` present
 *
 * Post-run: DISTRIBUTED_PROOF.md must record queue depth before/during/
 * after (via wrangler queues list · lc-cold-leads-prep) so we can
 * verify consumer kept up.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET =
  __ENV.TARGET_URL || 'https://liquid-clips-edge.liquidclips.workers.dev';
const HQ_SECRET = __ENV.HQ_SECRET || '';

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
    'checks{route:cold-leads-prep}': ['rate>0.99'],
  },
  cloud: {
    projectID: 8035712,
    name: 'edge-worker · /cold-leads/prep · distributed',
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
  if (!HQ_SECRET) {
    throw new Error(
      'HQ_SECRET env var required. Launch with: k6 cloud run -e HQ_SECRET=<value> <script>',
    );
  }
}

export default function () {
  const body = JSON.stringify({
    email: `k6-${__VU}-${__ITER}-${randomString(6)}@k6-loadtest.invalid`,
    handle: `@k6_${__VU}_${__ITER}`,
    campaign_id: `k6-distributed-proof`,
    preview_clip_url: `https://cdn.k6.local/preview-${__ITER}.mp4`,
    platform: 'tiktok',
  });

  const res = http.post(`${TARGET}/cold-leads/prep`, body, {
    headers: {
      'content-type': 'application/json',
      'x-hq-secret': HQ_SECRET,
    },
    tags: { name: 'cold_leads_prep', route: 'cold-leads-prep' },
  });

  check(
    res,
    {
      'status 202':               (r) => r.status === 202,
      'no 5xx':                   (r) => r.status < 500,
      'body has queued:true':     (r) => r.body && r.body.includes('"queued":true'),
      'x-lc-route header':        (r) => r.headers['X-Lc-Route'] === 'cold-leads-prep',
      'x-lc-edge-cache QUEUED':   (r) => r.headers['X-Lc-Edge-Cache'] === 'QUEUED',
    },
    { route: 'cold-leads-prep' },
  );
  sleep(1);
}
