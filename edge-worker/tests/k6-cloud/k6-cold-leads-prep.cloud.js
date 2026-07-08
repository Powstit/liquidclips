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
        { duration: '30s', target: 100 },
        { duration: '4m',  target: 100 },
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
      'amazon:de:frankfurt': { loadZone: 'amazon:de:frankfurt', percent: 100 },
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

  // Every 10th iteration fires WITHOUT the correct secret so we prove
  // the Worker's edge auth rejection stays fast + honest at scale.
  // Tagged separately so metrics split per-variant in k6 Cloud.
  const isInvalid = __ITER % 10 === 0;
  const secretHeader = isInvalid ? 'invalid-hq-secret-value' : HQ_SECRET;
  const variant = isInvalid ? 'invalid-auth' : 'valid-auth';

  const res = http.post(`${TARGET}/cold-leads/prep`, body, {
    headers: {
      'content-type': 'application/json',
      'x-hq-secret': secretHeader,
    },
    tags: { name: 'cold_leads_prep', route: 'cold-leads-prep', variant },
  });

  if (isInvalid) {
    check(
      res,
      {
        'invalid-auth · status 401':  (r) => r.status === 401,
        'invalid-auth · no 5xx':      (r) => r.status < 500,
      },
      { route: 'cold-leads-prep', variant: 'invalid-auth' },
    );
  } else {
    check(
      res,
      {
        'valid-auth · status 202':          (r) => r.status === 202,
        'valid-auth · no 5xx':              (r) => r.status < 500,
        'valid-auth · body has queued:true':(r) => r.body && r.body.includes('"queued":true'),
        'valid-auth · x-lc-route header':   (r) => r.headers['X-Lc-Route'] === 'cold-leads-prep',
        'valid-auth · x-lc-edge-cache QUEUED':(r) => r.headers['X-Lc-Edge-Cache'] === 'QUEUED',
      },
      { route: 'cold-leads-prep', variant: 'valid-auth' },
    );
  }
  sleep(1);
}
