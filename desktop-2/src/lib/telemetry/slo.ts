/**
 * IG-SLO-DEFINED · Service Level Objectives · launch gate contract.
 *
 * Three canonical SLOs the industry uses for production readiness:
 *   1. error_rate            · target < 1%   · window = 24h rolling
 *   2. crash_free_session    · target > 99.5% · window = 24h rolling
 *   3. p95_latency_ms        · target < 2000ms · window = 1h rolling
 *
 * Launch gate: all three green on staging for 7 consecutive days.
 *
 * Client-side computes a live snapshot from recent envelopes for the
 * dev diagnostic tile; the authoritative 7-day pass/fail is computed
 * server-side by `scripts/slo-check.sh` querying PostHog + Sentry.
 *
 * Sources (per Reliability Sprint research 2026-07-22):
 *   Google SRE Book · Service Level Objectives chapter
 *   Datadog SLO best practices 2026
 *   Sentry release-health + performance monitoring 2026
 */

import type { Envelope } from "./envelope.ts";

export interface SloTargets {
  errorRateMax: number;
  crashFreeSessionMin: number;
  p95LatencyMsMax: number;
}

export const SLO_TARGETS: SloTargets = Object.freeze({
  errorRateMax: 0.01,
  crashFreeSessionMin: 0.995,
  p95LatencyMsMax: 2000,
});

export interface SloSnapshot {
  errorRate: number;
  crashFreeSession: number;
  p95LatencyMs: number;
  sampleSize: number;
  windowStart: string;
  breaches: readonly SloName[];
}

export type SloName = "error_rate" | "crash_free_session" | "p95_latency_ms";

const RECENT_WINDOW = 2000;
let buf: Envelope[] = [];
let windowStart = new Date().toISOString();

export function sloRecord(envelope: Envelope): void {
  buf.push(envelope);
  if (buf.length > RECENT_WINDOW) buf.shift();
}

export function sloReset(): void {
  buf = [];
  windowStart = new Date().toISOString();
}

export function sloSnapshot(): SloSnapshot {
  const snap = buf.slice();
  const total = snap.length;
  const failures = snap.filter((e) => e.success === false).length;
  const errorRate = total === 0 ? 0 : failures / total;

  const sessions = new Map<string, boolean>();
  for (const e of snap) {
    const prev = sessions.get(e.session_id) ?? true;
    sessions.set(e.session_id, prev && e.success !== false);
  }
  const crashFree =
    sessions.size === 0
      ? 1
      : Array.from(sessions.values()).filter((clean) => clean).length /
        sessions.size;

  const durations = snap
    .map((e) => e.duration_ms)
    .filter((d): d is number => typeof d === "number" && d >= 0)
    .sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.floor(durations.length * 0.95) - 1);
  const p95 = durations.length === 0 ? 0 : durations[p95Index];

  const breaches: SloName[] = [];
  if (errorRate > SLO_TARGETS.errorRateMax) breaches.push("error_rate");
  if (crashFree < SLO_TARGETS.crashFreeSessionMin)
    breaches.push("crash_free_session");
  if (p95 > SLO_TARGETS.p95LatencyMsMax) breaches.push("p95_latency_ms");

  return {
    errorRate,
    crashFreeSession: crashFree,
    p95LatencyMs: p95,
    sampleSize: total,
    windowStart,
    breaches,
  };
}
