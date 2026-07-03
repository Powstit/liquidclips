/**
 * Desktop error sink · every failure envelope also POSTs a compact
 * summary to /telemetry/desktop-error so the backend can fingerprint
 * + dedupe into DesktopErrorGroup rows (Step 6).
 *
 * Offline buffer with jittered exponential retry so a network partition
 * doesn't lose reports. Bounded queue prevents infinite growth if the
 * backend is down long-term.
 */

import type { Envelope, Sink } from "../index";

const MAX_QUEUE = 100;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 60_000;

interface QueuedItem {
  body: Record<string, unknown>;
  attempts: number;
}

const queue: QueuedItem[] = [];
let flushing = false;

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function envelopeToDesktopError(env: Envelope): Record<string, unknown> {
  return {
    event: env.event,
    app_version: env.release,
    os:
      typeof navigator !== "undefined"
        ? (navigator.platform || "unknown").toLowerCase()
        : "unknown",
    arch:
      typeof navigator !== "undefined"
        ? ((navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "unknown")
        : "unknown",
    release: env.release,
    feature_id: env.feature_id,
    route: env.route,
    stable_error_code: env.stable_error_code,
    message: env.failure ?? undefined,
    user_ref: env.actor.kind === "internal" ? env.actor.id : null,
    environment: env.environment,
  };
}

function jitteredDelay(attempts: number): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempts);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

async function tryDeliver(item: QueuedItem): Promise<boolean> {
  try {
    const res = await fetch(`${lcBackendUrl()}/telemetry/desktop-error`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item.body),
    });
    // 4xx (except 429) are permanent — don't retry.
    if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 429) {
      return true; // discard
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function scheduleFlush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const item = queue[0];
      if (!item) break;
      const delivered = await tryDeliver(item);
      if (delivered) {
        queue.shift();
        continue;
      }
      item.attempts += 1;
      const delay = jitteredDelay(item.attempts);
      await new Promise((r) => setTimeout(r, delay));
      if (item.attempts > 12) {
        // ~1h of backoff · give up on this item · move on
        queue.shift();
      }
    }
  } finally {
    flushing = false;
  }
}

export const desktopErrorSink: Sink = {
  name: "desktop-error",
  receive(envelope: Envelope) {
    if (envelope.success && !envelope.stable_error_code) return;
    if (queue.length >= MAX_QUEUE) queue.shift(); // drop oldest
    queue.push({ body: envelopeToDesktopError(envelope), attempts: 0 });
    void scheduleFlush();
  },
};
