/**
 * k6-audit-state.js · SPRINT_FINAL §1F · 2026-07-07 (Max)
 *
 * Load test · GET /audit/state · the hottest read on the ship-gate
 * critical path. Every desktop client + audit-gate.sh + HQ health
 * dashboard reads it. Must survive 1M req/min at p95 < 500ms.
 *
 * Usage:
 *   TARGET_URL=https://junior-backend-production.up.railway.app \
 *   k6 run tests/k6/k6-audit-state.js
 *   # local dev:
 *   TARGET_URL=http://localhost:8000 k6 run tests/k6/k6-audit-state.js
 *
 * Pass/fail per handoff §Lane-4:
 *   - p95 < 500ms
 *   - zero 500-level responses
 *   - error rate < 0.1%
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = __ENV.TARGET_URL || 'http://localhost:8000';

export const options = {
  // 60s ramp-up · 5min sustained · 60s ramp-down
  stages: [
    { duration: '60s',  target: 16_667 }, // ~1M req/min at ~60 rps per VU
    { duration: '5m',   target: 16_667 },
    { duration: '60s',  target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed:   ['rate<0.001'],
    'checks{scenario:default}': ['rate>0.999'],
  },
};

export default function () {
  const res = http.get(`${TARGET}/audit/state`, {
    headers: { accept: 'application/json' },
    tags: { name: 'audit_state' },
  });
  check(res, {
    'status 200':                (r) => r.status === 200,
    'no 500-class':              (r) => r.status < 500,
    'body has blocking_findings':(r) => r.body && r.body.includes('blocking_findings'),
  });
  sleep(1);
}
