/**
 * DISTRIBUTED k6 · /audit/state via Cloudflare edge Worker.
 *
 * Runs from 5 AWS regions concurrently via k6 Cloud so we prove
 * multi-edge cache behavior, not single-region-runner saturation.
 *
 * Budget: 600 VUs × 5 min = 50 VUh. Fits free tier (500 VUh/mo).
 * Distribution: 20% per region across 5 regions.
 *
 * Pass gate (matches DISTRIBUTED_PROOF standard 2026-07-08):
 *   - success rate ≥ 99% (status 200 · body has gates)
 *   - p95 < 500ms
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
        { duration: '30s', target: 600 },
        { duration: '4m',  target: 600 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '15s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.01'],
    'checks{route:audit-state}': ['rate>0.99'],
  },
  cloud: {
    projectID: 8035712,
    name: 'edge-worker · /audit/state · distributed',
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
  const res = http.get(`${TARGET}/audit/state`, {
    headers: { accept: 'application/json' },
    tags: { name: 'audit_state', route: 'audit-state' },
  });
  check(
    res,
    {
      'status 200':               (r) => r.status === 200,
      'no 5xx':                   (r) => r.status < 500,
      'body has gates':           (r) => r.body && r.body.includes('"gates"'),
      'x-lc-route header set':    (r) => r.headers['X-Lc-Route'] === 'audit-state',
      'x-lc-edge-cache header':   (r) => !!r.headers['X-Lc-Edge-Cache'],
    },
    { route: 'audit-state' },
  );
  sleep(1);
}
