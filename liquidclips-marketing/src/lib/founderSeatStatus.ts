/**
 * Task F · Founder Access seat-status fail-safe reader.
 *
 * The marketing homepage's Founder CTA renders based on the server-
 * side snapshot returned by junior-backend `GET /founder/seat-status`.
 * When the fetch fails (network flake, backend down, cold-start
 * timeout), we DELIBERATELY default to `closed: false` so the CTA
 * stays visible — the Whop-side `seat_cap=12000` metadata on
 * `plan_VWj1uoy2RcOsg` is the ultimate enforcement rail, and a
 * networking blip should never silently hide the Founder CTA and
 * lose real signups.
 *
 * Read from server components only (no client-side `use client`
 * usage). If a client component ever needs this, wrap the fetch in
 * a Server Action so the request stays server-to-server.
 */

export interface FounderSeatStatus {
  used: number;
  remaining: number;
  closed: boolean;
  /** Cap constant mirrored from the backend so the UI can render
   *  "1,247 / 12,000 taken" without a magic number. */
  max_seats: number;
}

export const FOUNDER_MAX_SEATS_FALLBACK = 12_000;

/** Fail-safe default returned when the backend fetch errors. Keeps
 *  the CTA visible so a networking issue doesn't silently drop
 *  signups. */
export const OPEN_FALLBACK_STATUS: FounderSeatStatus = {
  used: 0,
  remaining: FOUNDER_MAX_SEATS_FALLBACK,
  closed: false,
  max_seats: FOUNDER_MAX_SEATS_FALLBACK,
};

/** Fetch timeout — the marketing page's SSR budget is tight, so we
 *  cut over to the fallback fast rather than block the render. */
const SEAT_STATUS_TIMEOUT_MS = 2_500;

function backendUrl(): string {
  const v = process.env.JUNIOR_BACKEND_URL;
  if (typeof v === "string" && v.length > 0) return v;
  return "https://api.liquidclips.app";
}

function isSeatStatusShape(x: unknown): x is FounderSeatStatus {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const isInt = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
  return (
    isInt(o.used) &&
    isInt(o.remaining) &&
    typeof o.closed === "boolean" &&
    isInt(o.max_seats)
  );
}

/**
 * Server-side fetch of `/founder/seat-status`. Never throws — errors
 * fall through to :data:`OPEN_FALLBACK_STATUS` so callers can render
 * unconditionally.
 */
export async function getFounderSeatStatus(): Promise<FounderSeatStatus> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEAT_STATUS_TIMEOUT_MS);
  try {
    const r = await fetch(`${backendUrl()}/founder/seat-status`, {
      method: "GET",
      headers: { "content-type": "application/json" },
      signal: ctrl.signal,
      // Cache for one minute — the counter moves slowly relative to
      // marketing page traffic, and stale data is safer than a slow
      // page render for the Founder CTA slot.
      next: { revalidate: 60 },
    });
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[founder] GET /founder/seat-status → ${r.status}`);
      return OPEN_FALLBACK_STATUS;
    }
    const body = (await r.json()) as unknown;
    if (!isSeatStatusShape(body)) {
      // eslint-disable-next-line no-console
      console.warn(
        "[founder] /founder/seat-status returned 200 with malformed shape · using open fallback",
      );
      return OPEN_FALLBACK_STATUS;
    }
    return body;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[founder] seat-status fetch failed:", err);
    return OPEN_FALLBACK_STATUS;
  } finally {
    clearTimeout(timer);
  }
}
