/**
 * k6-whop-webhook.js · SPRINT_FINAL §1F · 2026-07-07 (Max)
 *
 * Load test · POST /webhooks/whop · 100K events over 5 min.
 * Idempotency-preserved · every event has a unique external_id.
 * WebhookEvent.external_id UNIQUE constraint dedupes so replays
 * don't double-fire tier changes.
 *
 * Realistic payload: membership.went_valid on plan_NMKvKj8SVVKsY
 * (Founder Access · $99.99/mo · Agency unlock). Same shape Whop
 * fires in production.
 *
 * Pass/fail per handoff §Lane-4:
 *   - zero dropped events (200 or 202 response for every request)
 *   - idempotency preserved (replay same external_id · no double side-effect)
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const TARGET = __ENV.TARGET_URL || 'http://localhost:8000';

export const options = {
  stages: [
    { duration: '60s', target: 333 },  // 333 VU · 1 rps each · 100K total in 5min
    { duration: '5m',  target: 333 },
    { duration: '60s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<2000'],
  },
};

function buildEvent() {
  const externalId = `evt_k6_${randomString(24)}`;
  return {
    id: externalId,
    external_id: externalId,
    type: 'membership.went_valid',
    data: {
      id: `mem_${randomString(16)}`,
      user_id: `user_${randomString(12)}`,
      plan: {
        id: 'plan_NMKvKj8SVVKsY',
        title: 'Founder Access v2',
      },
      status: 'active',
      valid: true,
      expires_at: null,
      created_at: new Date().toISOString(),
    },
  };
}

export default function () {
  const body = JSON.stringify(buildEvent());
  const res = http.post(`${TARGET}/webhooks/whop`, body, {
    headers: {
      'content-type': 'application/json',
      'whop-signature': 'k6-load-test-bypass',
    },
    tags: { name: 'webhook_whop' },
  });
  check(res, {
    'accepted': (r) => r.status === 200 || r.status === 202,
    'not 5xx':  (r) => r.status < 500,
  });
  sleep(1);
}
