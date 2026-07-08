/**
 * DISTRIBUTED k6 · /hq/carousel/clips via Cloudflare edge Worker.
 * Budget: 600 VUs × 5 min = 50 VUh.
 *
 * Every desktop client's LoginScreen fetches this on mount. Highest
 * concentrated read burst during a viral / cold-email install day.
 * Cache TTL 60s, hashed cold_lead_email in cache key.
 *
 * Pass gate:
 *   - success rate ≥ 99% (status 200 · clips array present)
 *   - p95 < 300ms
 *   - error rate < 1%
 *   - no 5xx spike
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET =
  __ENV.TARGET_URL || 'https://liquid-clips-edge.liquidclips.workers.dev';

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
    http_req_duration: ['p(95)<300'],
    http_req_failed:   ['rate<0.01'],
    'checks{route:carousel-clips}': ['rate>0.99'],
  },
  cloud: {
    projectID: 8035712,
    name: 'edge-worker · /hq/carousel/clips · distributed',
    distribution: {
      'amazon:gb:london': { loadZone: 'amazon:gb:london', percent: 100 },
    },
  },
};

export default function () {
  const res = http.get(`${TARGET}/hq/carousel/clips`, {
    headers: { accept: 'application/json' },
    tags: { name: 'carousel_clips', route: 'carousel-clips' },
  });
  check(
    res,
    {
      'status 200':               (r) => r.status === 200,
      'no 5xx':                   (r) => r.status < 500,
      'body has clips array':     (r) => r.body && r.body.includes('"clips"'),
      'x-lc-route header':        (r) => r.headers['X-Lc-Route'] === 'carousel-clips',
      'x-lc-edge-cache header':   (r) => !!r.headers['X-Lc-Edge-Cache'],
    },
    { route: 'carousel-clips' },
  );
  sleep(1);
}
