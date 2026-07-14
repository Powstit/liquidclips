/**
 * Announcement broadcast layer · v2.2.9
 *
 * Reads the `active_announcements` field from /sync and exposes it via
 * a small hook the AppShell consumes. Kept deliberately tiny — one
 * GET, no polling timer, refresh on activation:complete so a fresh
 * login lands the latest banners without waiting for the next session.
 *
 * Default-empty semantics are load-bearing: when /sync doesn't include
 * the field (mocked sync in visual tests, legacy backend, no JWT yet)
 * the hook returns []. The AnnouncementBanner renders nothing on an
 * empty list so the pinned Workstation visual baseline does not drift.
 */
import { useEffect, useState } from "react";

import { getJwt } from "./authStorage";
import { authedFetch } from "./authedFetch";
import { useEvent } from "../design-os/bridge";

export type AnnouncementSeverity = "info" | "warning" | "critical";
export type AnnouncementScope = "global" | "agency";

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body_markdown: string | null;
  severity: AnnouncementSeverity;
  scope: AnnouncementScope;
  agency_id: string | null;
  cta_text: string | null;
  cta_url: string | null;
  pinned: boolean;
}

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function coerceSeverity(value: unknown): AnnouncementSeverity {
  return value === "critical" || value === "warning" ? value : "info";
}

function coerceScope(value: unknown): AnnouncementScope {
  return value === "agency" ? "agency" : "global";
}

function normalise(raw: unknown): ActiveAnnouncement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  return {
    id: r.id,
    title: r.title,
    body_markdown: typeof r.body_markdown === "string" ? r.body_markdown : null,
    severity: coerceSeverity(r.severity),
    scope: coerceScope(r.scope),
    agency_id: typeof r.agency_id === "string" ? r.agency_id : null,
    cta_text: typeof r.cta_text === "string" ? r.cta_text : null,
    cta_url: typeof r.cta_url === "string" ? r.cta_url : null,
    pinned: r.pinned === true,
  };
}

export async function fetchActiveAnnouncements(): Promise<ActiveAnnouncement[]> {
  const jwt = getJwt();
  if (!jwt) return [];
  try {
    // L1 · 2026-07-11 · routed through authedFetch so a stale JWT
    // (401) triggers the global expired-session UX + hash-preserving
    // redirect without leaving the customer with a blank banner rail.
    const r = await authedFetch(`${lcBackendUrl()}/sync`, {
      cache: "no-store",
    });
    if (!r.ok) return [];
    const data: unknown = await r.json();
    if (!data || typeof data !== "object") return [];
    const list = (data as Record<string, unknown>).active_announcements;
    if (!Array.isArray(list)) return [];
    return list
      .map(normalise)
      .filter((row): row is ActiveAnnouncement => row !== null);
  } catch {
    return [];
  }
}

/** Mount-once + refresh-on-activation hook. Polling intentionally
 *  omitted — broadcasts are not so urgent that we need a heartbeat,
 *  and the session-sync caller above can call refresh() to force one. */
export function useAnnouncements(): {
  items: ActiveAnnouncement[];
  refresh: () => void;
} {
  const [items, setItems] = useState<ActiveAnnouncement[]>([]);

  useEffect(() => {
    let alive = true;
    fetchActiveAnnouncements()
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch(() => {
        /* swallow · hook is best-effort */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEvent("activation:complete", () => {
    fetchActiveAnnouncements()
      .then(setItems)
      .catch(() => {
        /* swallow */
      });
  });

  const refresh = (): void => {
    fetchActiveAnnouncements()
      .then(setItems)
      .catch(() => {
        /* swallow */
      });
  };

  return { items, refresh };
}
