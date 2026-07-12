/**
 * RC1 Train B3 · diagnosticLogger persistence dual-write.
 *
 * Contract:
 *   * On flush, each event ALSO POSTs to /lcos/events/ingest as a
 *     separate request (fire-and-forget · one row per event server-side)
 *     alongside the existing /telemetry/diagnostic batch call.
 *   * The lcDiag API signature is unchanged — callers still pass
 *     (topic, data) and get void back.
 *   * A failure in the persistence write MUST NOT re-buffer events.
 *   * The stdout `/telemetry/diagnostic` flush stays the safety net.
 *
 * We DO NOT test console.log directly (dev-only path) — the module
 * calls console.log unconditionally inside lcDiag() and the flush
 * behaviour is what changed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { lcDiag, forceFlush } from './diagnosticLogger';

type FetchArgs = { input: RequestInfo | URL; init?: RequestInit };

function makeFetchSpy(status = 202): {
  fetchSpy: ReturnType<typeof vi.fn>;
  calls: FetchArgs[];
} {
  const calls: FetchArgs[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response('{"ok":true}', { status });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchSpy as unknown as typeof fetch;
  return { fetchSpy, calls };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request object
  return (input as Request).url;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('diagnosticLogger · persistence dual-write (B3)', () => {
  it('POSTs each event to /lcos/events/ingest during flush', async () => {
    const { calls } = makeFetchSpy(202);

    lcDiag('boot', { mode: 'test', runtime_version: '2.3.0' });
    lcDiag('sidecar_probe', { managed: true, elapsed_ms: 5 });

    await forceFlush();
    // Give the fire-and-forget persistence branch a microtask to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistCalls = calls.filter((c) =>
      urlOf(c.input).includes('/lcos/events/ingest'),
    );
    expect(persistCalls.length).toBe(2);

    // Verify the per-topic body shape lines up with the server contract.
    const topics = persistCalls
      .map((c) => JSON.parse(c.init?.body as string).topic)
      .sort();
    expect(topics).toEqual(['boot', 'sidecar_probe']);

    for (const c of persistCalls) {
      const body = JSON.parse(c.init?.body as string);
      expect(typeof body.topic).toBe('string');
      expect(typeof body.ts_ms).toBe('number');
      expect(typeof body.payload).toBe('object');
      expect(body.session_id).toMatch(/^s_/);
    }
  });

  it('still POSTs the batched /telemetry/diagnostic (safety net preserved)', async () => {
    const { calls } = makeFetchSpy(202);

    lcDiag('boot', { mode: 'test' });
    await forceFlush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const diagCalls = calls.filter((c) =>
      urlOf(c.input).includes('/telemetry/diagnostic'),
    );
    expect(diagCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(diagCalls[0].init?.body as string);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(1);
    expect(body.events[0].topic).toBe('boot');
  });

  it('does not re-buffer events when the persistence POST rejects', async () => {
    // Make /lcos/events/ingest 500 · but /telemetry/diagnostic 202. The
    // batch should NOT be re-added just because persistence failed.
    const calls: FetchArgs[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (urlOf(input).includes('/lcos/events/ingest')) {
        return new Response('{}', { status: 500 });
      }
      return new Response('{"ok":true}', { status: 202 });
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchSpy as unknown as typeof fetch;

    lcDiag('boot', { mode: 'test' });
    await forceFlush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A second flush must not re-attempt the same event.
    await forceFlush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistCalls = calls.filter((c) =>
      urlOf(c.input).includes('/lcos/events/ingest'),
    );
    expect(persistCalls.length).toBe(1);
  });

  it('is safe when fetch throws synchronously on the persistence call', async () => {
    const calls: FetchArgs[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (urlOf(input).includes('/lcos/events/ingest')) {
        throw new Error('network down');
      }
      return new Response('{"ok":true}', { status: 202 });
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchSpy as unknown as typeof fetch;

    lcDiag('boot', { mode: 'test' });
    // The forceFlush must not throw even though persistence errors.
    await expect(forceFlush()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Diagnostic still tried at least once.
    expect(
      calls.some((c) => urlOf(c.input).includes('/telemetry/diagnostic')),
    ).toBe(true);
  });
});
