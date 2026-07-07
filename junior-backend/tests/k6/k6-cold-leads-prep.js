/**
 * k6-cold-leads-prep.js · SPRINT_FINAL §1F · 2026-07-07 (Max)
 *
 * Load test · POST /cold-leads/prep · HQ bulk upload path.
 * 100K rows in 5 min · zero data loss (HTTP-level; row-level dedupe
 * verified separately via idempotency key in the payload).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET = __ENV.TARGET_URL || 'http://localhost:8000';
const INTERNAL_SECRET = __ENV.INTERNAL_API_SECRET || 'k6-load-test';

export const options = {
  stages: [
    { duration: '60s', target: 333 }, // 100K rows in 5 min · one row per request
    { duration: '5m',  target: 333 },
    { duration: '60s', target: 0 },
  ],
  thresholds: {
    http_req_failed:   ['rate<0.001'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const email = `cold_${randomString(20)}@k6.test`;
  const body = JSON.stringify({
    idempotency_key: `k6_${randomString(24)}`,
    rows: [
      {
        email,
        handle: `k6_${randomString(8)}`,
        campaign_id: 'cmp_k6_stress',
        preview_clip_url: 'https://liquidclips.app/preview/k6-fixture.mp4',
      },
    ],
  });
  const res = http.post(`${TARGET}/cold-leads/prep`, body, {
    headers: {
      'content-type':      'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    tags: { name: 'cold_leads_prep' },
  });
  check(res, {
    'accepted': (r) => r.status === 200 || r.status === 201 || r.status === 202,
    'no 5xx':   (r) => r.status < 500,
  });
  sleep(1);
}
