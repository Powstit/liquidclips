/**
 * k6-carousel-clips.js · SPRINT_FINAL §1F · 2026-07-07 (Max)
 *
 * Load test · GET /hq/carousel/clips · public endpoint the
 * LoginScreen mounts on cold-start to render the carousel. Must
 * survive 500K req/min at p95 < 300ms · fast because it's the first
 * thing every user sees.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const TARGET = __ENV.TARGET_URL || 'http://localhost:8000';

export const options = {
  stages: [
    { duration: '60s', target: 8_333 }, // 500K req/min
    { duration: '5m',  target: 8_333 },
    { duration: '60s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed:   ['rate<0.001'],
  },
};

export default function () {
  const res = http.get(`${TARGET}/hq/carousel/clips`, {
    headers: { accept: 'application/json' },
    tags: { name: 'carousel_clips' },
  });
  check(res, {
    'status 200': (r) => r.status === 200,
    'has items':  (r) => r.body && (r.body.includes('items') || r.body.includes('clips') || r.body.startsWith('[')),
    'no 5xx':     (r) => r.status < 500,
  });
  sleep(1);
}
