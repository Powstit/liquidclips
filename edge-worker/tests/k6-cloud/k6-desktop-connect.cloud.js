/**
 * DISTRIBUTED k6 · /desktop/connect via Cloudflare edge Worker (proxied).
 * Budget: 300 VUs × 5 min = 25 VUh.
 *
 * This route is NOT cached, NOT queued — it proxies through the Worker
 * to Railway for a fresh Ed25519 JWT mint. This test measures the
 * Worker-proxy overhead + Railway JWT mint latency.
 *
 * We test with NO internal secret so Railway returns 401 — that's the
 * fastest observable response and proves the Worker→Railway proxy hop
 * is holding up under geo-distributed load without introducing a
 * serialization bottleneck.
 *
 * Pass gate:
 *   - p95 < 500ms (proxy overhead only, not real JWT mint)
 *   - 401 rate ≥ 99% (correct behavior for unauth)
 *   - no 5xx spike
 *   - `x-lc-route: desktop-connect` header present
 *   - `x-lc-edge-cache: BYPASS` header present
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
        { duration: '30s', target: 300 },
        { duration: '4m',  target: 300 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    'checks{route:desktop-connect}': ['rate>0.99'],
  },
  cloud: {
    projectID: 8035712,
    name: 'edge-worker · /desktop/connect · distributed',
    distribution: {
      'amazon:us:ashburn':    { loadZone: 'amazon:us:ashburn',    percent: 20 },
      'amazon:us:portland':   { loadZone: 'amazon:us:portland',   percent: 20 },
      'amazon:gb:london':     { loadZone: 'amazon:gb:london',     percent: 20 },
      'amazon:de:frankfurt':  { loadZone: 'amazon:de:frankfurt',  percent: 20 },
      'amazon:sg:singapore':  { loadZone: 'amazon:sg:singapore',  percent: 20 },
    },
  },
};

export default function () {
  const res = http.post(
    `${TARGET}/desktop/connect`,
    JSON.stringify({ clerk_user_id: `k6-test-${__VU}-${__ITER}` }),
    {
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      tags: { name: 'desktop_connect', route: 'desktop-connect' },
    },
  );
  check(
    res,
    {
      'auth rejected (401)':      (r) => r.status === 401,
      'no 5xx':                   (r) => r.status < 500,
      'x-lc-route header':        (r) => r.headers['X-Lc-Route'] === 'desktop-connect',
      'x-lc-edge-cache BYPASS':   (r) => r.headers['X-Lc-Edge-Cache'] === 'BYPASS',
    },
    { route: 'desktop-connect' },
  );
  sleep(1);
}
