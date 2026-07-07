/**
 * Chat-moderation client · Stage 7.
 *
 * Fetchers for the 3 `/chat/messages/{id}/{hide|warn|mute24h}`
 * endpoints shipped in `junior-backend/app/routes/moderation.py`. Used
 * by the enabled context-menu buttons in
 * `desktop-2/src/design-os/components/ChatPanel.tsx`.
 *
 * Shape mirrors `src/lib/chat.ts` + `src/lib/agency.ts` — errors are
 * NEVER thrown; transport failures return `{state, error}` so the
 * caller can toast + roll back optimistically.
 */
import { getJwt } from "./authStorage";

export type ModerationConnectionState =
  | "ready"
  | "forbidden"
  | "offline"
  | "error";

export interface ModerationResult<T> {
  data: T | null;
  state: ModerationConnectionState;
  error: string | null;
  status: number | null;
}

export interface HideMessageOut {
  id: string;
  hidden: boolean;
  hidden_at: string | null;
  hidden_by_user_id: string | null;
  hide_reason: string | null;
}

export interface WarnOut {
  ok: boolean;
  message_id: string;
  target_user_id: string;
}

export interface Mute24hOut {
  ok: boolean;
  target_user_id: string;
  muted_until: string;
}

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function authHeader(): Record<string, string> {
  const jwt = getJwt();
  return jwt ? { authorization: `Bearer ${jwt}` } : {};
}

async function modFetch<T>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<ModerationResult<T>> {
  const jwt = getJwt();
  if (!jwt) {
    return {
      data: null,
      state: "forbidden",
      error: "Sign in to use moderation actions.",
      status: 401,
    };
  }
  try {
    const r = await fetch(`${backendUrl()}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...authHeader(),
      },
      body: JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      const t = await r.text();
      parsed = t ? JSON.parse(t) : null;
    } catch {
      parsed = null;
    }
    if (r.status === 401 || r.status === 403) {
      return {
        data: null,
        state: "forbidden",
        error: extractDetail(parsed) ?? "Not authorised for this action.",
        status: r.status,
      };
    }
    if (!r.ok) {
      return {
        data: null,
        state: "error",
        error: extractDetail(parsed) ?? `${path} returned ${r.status}.`,
        status: r.status,
      };
    }
    return { data: parsed as T, state: "ready", error: null, status: r.status };
  } catch {
    return {
      data: null,
      state: "offline",
      error: "Moderation is offline. Check your connection and retry.",
      status: null,
    };
  }
}

function extractDetail(parsed: unknown): string | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const d = detail as { message?: string; reason?: string };
    if (typeof d.message === "string") return d.message;
    if (typeof d.reason === "string") return d.reason;
  }
  return null;
}

export function postHideMessage(
  messageId: string,
  reason?: string,
): Promise<ModerationResult<HideMessageOut>> {
  return modFetch<HideMessageOut>(
    `/chat/messages/${encodeURIComponent(messageId)}/hide`,
    reason ? { reason } : {},
  );
}

export function postWarnMessage(
  messageId: string,
  reason?: string,
): Promise<ModerationResult<WarnOut>> {
  return modFetch<WarnOut>(
    `/chat/messages/${encodeURIComponent(messageId)}/warn`,
    reason ? { reason } : {},
  );
}

export function postMute24h(
  messageId: string,
  reason?: string,
): Promise<ModerationResult<Mute24hOut>> {
  return modFetch<Mute24hOut>(
    `/chat/messages/${encodeURIComponent(messageId)}/mute24h`,
    reason ? { reason } : {},
  );
}
