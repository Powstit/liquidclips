// ship-lens v0.7.13 C5 — Contract hook for Kimi K-δ (Activity Orbit / Avatar inbox).
// Kimi consumes the events array to render orbiting particles + the panel
// inbox. Source events come from existing app-level CustomEvents that
// other surfaces already dispatch (junior:channel-linked, lc:publish-result,
// lc:payout). The hook persists unread state in localStorage so a reload
// doesn't drop the count to 0.

import { useCallback, useEffect, useState } from "react";

export type ActivityEventKind =
  | "channel-linked"
  | "channel-unlinked"
  | "publish-success"
  | "publish-failed"
  | "payout"
  | "bounty-match";

export type ActivityEvent = {
  id: string;
  kind: ActivityEventKind;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
};

export type UseActivityEventsResult = {
  events: ActivityEvent[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
};

const STORAGE_KEY = "lc:activity-events:v1";
const MAX_EVENTS = 50;

function loadFromStorage(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is ActivityEvent =>
        typeof e?.id === "string" &&
        typeof e?.kind === "string" &&
        typeof e?.title === "string" &&
        typeof e?.body === "string" &&
        typeof e?.timestamp === "number" &&
        typeof e?.read === "boolean",
      )
      .slice(0, MAX_EVENTS);
  } catch {
    return [];
  }
}

function persistToStorage(events: ActivityEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  } catch {
    /* localStorage unavailable — fine, the in-memory list still works */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useActivityEvents(): UseActivityEventsResult {
  const [events, setEvents] = useState<ActivityEvent[]>(loadFromStorage);

  const push = useCallback((kind: ActivityEventKind, title: string, body: string) => {
    const ev: ActivityEvent = {
      id: newId(),
      kind,
      title,
      body,
      timestamp: Date.now(),
      read: false,
    };
    setEvents((prev) => {
      const next = [ev, ...prev].slice(0, MAX_EVENTS);
      persistToStorage(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Channel linked → orbit particle.
    function onChannelLinked(e: Event) {
      const cid = (e as CustomEvent<{ cid?: string }>).detail?.cid ?? "";
      push("channel-linked", "Channel connected", cid ? `Linked ${cid}` : "A social channel was linked.");
    }
    function onChannelUnlinked(e: Event) {
      const cid = (e as CustomEvent<{ cid?: string }>).detail?.cid ?? "";
      push("channel-unlinked", "Channel disconnected", cid ? `Unlinked ${cid}` : "A social channel was disconnected.");
    }
    function onPublishResult(e: Event) {
      const detail = (e as CustomEvent<{ success?: boolean; platform?: string; url?: string }>).detail ?? {};
      if (detail.success) {
        push("publish-success", "Published", `${detail.platform ?? "social"}: ${detail.url ?? "post live"}`);
      } else {
        push("publish-failed", "Publish failed", `${detail.platform ?? "social"} — try again.`);
      }
    }
    function onPayout(e: Event) {
      const amount = (e as CustomEvent<{ amount?: number; currency?: string }>).detail?.amount;
      push("payout", "Payout received", amount ? `${amount} ${(e as CustomEvent).detail?.currency ?? "USD"} cleared.` : "A payout cleared.");
    }
    function onBountyMatch(e: Event) {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name ?? "a bounty";
      push("bounty-match", "Bounty match", `${name} matches your history — open Earn.`);
    }

    window.addEventListener("junior:channel-linked", onChannelLinked);
    window.addEventListener("junior:channel-unlinked", onChannelUnlinked);
    window.addEventListener("lc:publish-result", onPublishResult);
    window.addEventListener("lc:payout", onPayout);
    window.addEventListener("lc:bounty-match", onBountyMatch);

    return () => {
      window.removeEventListener("junior:channel-linked", onChannelLinked);
      window.removeEventListener("junior:channel-unlinked", onChannelUnlinked);
      window.removeEventListener("lc:publish-result", onPublishResult);
      window.removeEventListener("lc:payout", onPayout);
      window.removeEventListener("lc:bounty-match", onBountyMatch);
    };
  }, [push]);

  const markRead = useCallback((id: string) => {
    setEvents((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, read: true } : e));
      persistToStorage(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setEvents((prev) => {
      const next = prev.map((e) => ({ ...e, read: true }));
      persistToStorage(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    persistToStorage([]);
  }, []);

  const unreadCount = events.reduce((n, e) => (e.read ? n : n + 1), 0);

  return { events, unreadCount, markRead, markAllRead, clear };
}
