/**
 * FEATURE-001 · Resend delivery adapter.
 *
 * The desktop app must NEVER talk to api.resend.com directly — that
 * would put the Resend API key into the bundle. Instead we POST to a
 * backend endpoint at `${VITE_NOTIFICATIONS_API_BASE}/notify/email` that
 * proxies to Resend with the key kept server-side.
 *
 * If the base URL is not set (current state of the project · no Resend
 * wiring exists yet on the backend either), the adapter advances every
 * email-worthy record to status="not_configured" with an honest error
 * string. It does NOT pretend to send.
 *
 * Test seam: `window.__lcEmailBase` overrides the env-var read so the
 * Playwright harness can verify "sending → failed" and "retry failed"
 * paths without touching real network.
 */
import { get, updateEmailDelivery } from "./store";

function getEmailBase(): string | null {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __lcEmailBase?: string };
    if (typeof w.__lcEmailBase === "string" && w.__lcEmailBase.length > 0) {
      return w.__lcEmailBase;
    }
  }
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const v = env?.VITE_NOTIFICATIONS_API_BASE;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* not in a Vite runtime · honest fall-through */ }
  return null;
}

/** Resolve a partial-success state for a record:
 *  - record vanished → no-op
 *  - record has no email metadata → no-op
 *  - backend not configured → "not_configured"
 *  - fetch OK → "sent"
 *  - fetch !OK or threw → "failed" with error string
 */
export async function dispatchEmail(id: string): Promise<void> {
  const record = get(id);
  if (!record || !record.email) return;

  const attempts = (record.email.attempts ?? 0) + 1;
  const lastAttemptAt = new Date().toISOString();

  const base = getEmailBase();
  if (!base) {
    updateEmailDelivery(id, {
      status: "not_configured",
      provider: null,
      attempts,
      lastAttemptAt,
      error: "VITE_NOTIFICATIONS_API_BASE is not set · Resend backend is not wired.",
    });
    return;
  }

  updateEmailDelivery(id, {
    status: "sending",
    attempts,
    lastAttemptAt,
    error: undefined,
  });

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/notify/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: record.kind,
        title: record.title,
        body: record.body,
        href: record.href,
      }),
    });
    if (!res.ok) {
      updateEmailDelivery(id, {
        status: "failed",
        error: `Backend returned ${res.status} ${res.statusText}`,
      });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { message_id?: unknown };
    const messageId = typeof json.message_id === "string" ? json.message_id : undefined;
    updateEmailDelivery(id, {
      status: "sent",
      provider: "resend",
      messageId,
      error: undefined,
    });
  } catch (e) {
    updateEmailDelivery(id, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Retry policy: only re-dispatch records currently in "failed" state.
 *  Spec: "add Resend retry only for failed email events." */
export async function retryEmail(id: string): Promise<void> {
  const record = get(id);
  if (!record || !record.email) return;
  if (record.email.status !== "failed") return;
  await dispatchEmail(id);
}
