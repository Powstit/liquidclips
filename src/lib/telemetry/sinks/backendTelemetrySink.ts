/**
 * Backend telemetry sink · Step 5 Envelope → POST /telemetry/event.
 *
 * Non-blocking. Best-effort. A backend outage MUST NOT surface as a
 * user-visible error (Step 5 · adapter_failure_nonblocking guarantee).
 */

import type { Envelope, Sink } from "../index";

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

export const backendTelemetrySink: Sink = {
  name: "backend-telemetry",
  async receive(envelope: Envelope) {
    try {
      await fetch(`${lcBackendUrl()}/telemetry/event`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      });
    } catch {
      /* adapter swallows sink errors — no rethrow needed here, but the
       * try/catch keeps the promise-chain clean even in strict-mode
       * environments. */
    }
  },
};
