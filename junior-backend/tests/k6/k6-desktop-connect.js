/**
 * k6-desktop-connect.js · SPRINT_FINAL §1F · 2026-07-07 (Max)
 *
 * Load test · POST /desktop/connect · 500K first-launch activations.
 * Every fresh cold-traffic install hits this to mint their license
 * JWT. Zero failures + p95 < 2s or LoginScreen appears frozen.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET = __ENV.TARGET_URL || 'http://localhost:8000';

export const options = {
  stages: [
    { duration: '60s', target: 1667 }, // 500K over 5 min at ~1 rps per VU
    { duration: '5m',  target: 1667 },
    { duration: '60s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed:   ['rate<0.001'],
  },
};

export default function () {
  const clerkId = `user_k6_${randomString(24)}`;
  const challenge = `ch_${randomString(32)}`;
  const body = JSON.stringify({ clerk_user_id: clerkId, challenge });
  const res = http.post(`${TARGET}/desktop/connect`, body, {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'desktop_connect' },
  });
  check(res, {
    'status 200':      (r) => r.status === 200,
    'returns jwt':     (r) => r.body && r.body.includes('license_jwt'),
    'no 5xx':          (r) => r.status < 500,
  });
  sleep(1);
}
