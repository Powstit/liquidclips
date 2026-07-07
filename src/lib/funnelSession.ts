// Funnel session handoff · how the desktop app learns about the clips
// the user already generated on liquidclips.app.
//
// Resolution order:
//   1. ?session=<id> on the launch URL  (dev mode · tauri dev URL)
//   2. localStorage["lc.funnel.session.v1"]  (persists across launches)
//   3. clipboard scan for the session id  (paste-on-launch UX · optional)
//   4. null  (no session · fall through to normal LoginOnboarding)
//
// The fetch hits the marketing site directly · LC marketing currently
// runs at https://liquidclips.app/api/sessions/<id>. For local dev the
// `?api=http://localhost:3000` query overrides the host.

export type ClipEvidence = {
  id: string;
  index: number;
  title: string;
  viralScore: number;
  hookLine: string;
  estimatedReach: string;
  duration: string;
  transcriptWindow: string;
  thumbHue: number;
};

export type FunnelSession = {
  id: string;
  url: string;
  sourceTitle: string;
  sourceDuration: string;
  createdAt: number;
  clips: ClipEvidence[];
};

const STORAGE_KEY = "lc.funnel.session.v1";
const DEFAULT_API = "https://liquidclips.app";

function readQueryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function resolveApiBase(): string {
  const override = readQueryParam("api");
  if (override) return override.replace(/\/$/, "");
  return DEFAULT_API;
}

export function readSessionIdFromLaunch(): string | null {
  const fromQuery = readQueryParam("session");
  if (fromQuery && /^[a-z0-9]{6,}$/i.test(fromQuery)) return fromQuery;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[a-z0-9]{6,}$/i.test(stored)) return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function persistSessionId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearFunnelSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export async function fetchFunnelSession(id: string): Promise<FunnelSession | null> {
  try {
    const res = await fetch(`${resolveApiBase()}/api/sessions/${id}`, {
      credentials: "omit",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as FunnelSession;
    return data;
  } catch {
    return null;
  }
}
