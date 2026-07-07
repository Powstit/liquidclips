/**
 * FEATURE-001 · canonical inbox store.
 *
 * - Persisted to localStorage at `lc.inbox.messages.v1` (matches the
 *   `lc.<feature>.<...>.v<N>` convention used elsewhere in the app).
 * - Records are stored most-recent-first. Cap at 100 to keep the
 *   keystore from growing unbounded.
 * - All mutations emit a typed bus event so subscribers (InboxSheet,
 *   the avatar badge in TopHud, any harness) refresh without polling.
 */
import { bus } from "../design-os/bridge";
import type { EmailDelivery, InboxRecord } from "./types";

const STORAGE_KEY = "lc.inbox.messages.v1";
const SCHEMA_VERSION = 1 as const;
const MAX_RECORDS = 100;

interface Persisted {
  schemaVersion: typeof SCHEMA_VERSION;
  messages: InboxRecord[];
}

let cache: InboxRecord[] | null = null;

function readPersisted(): InboxRecord[] {
  if (cache) return cache;
  if (typeof window === "undefined") { cache = []; return cache; }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) { cache = []; return cache; }
    const obj = JSON.parse(raw) as Persisted | null;
    if (!obj || !Array.isArray(obj.messages)) { cache = []; return cache; }
    cache = obj.messages;
    return cache;
  } catch {
    cache = [];
    return cache;
  }
}

function writePersisted(messages: InboxRecord[]): void {
  cache = messages;
  if (typeof window === "undefined") return;
  try {
    const payload: Persisted = { schemaVersion: SCHEMA_VERSION, messages };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage may be full or unavailable · honest no-op */
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof (crypto as { randomUUID?: () => string }).randomUUID === "function") {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns a shallow copy of the current inbox. */
export function getAll(): InboxRecord[] {
  return [...readPersisted()];
}

export function get(id: string): InboxRecord | undefined {
  return readPersisted().find((r) => r.id === id);
}

export function unreadCount(): number {
  return readPersisted().reduce((n, r) => n + (r.readAt ? 0 : 1), 0);
}

export interface AddArgs {
  kind: InboxRecord["kind"];
  title: string;
  body: string;
  href?: string;
  ctaLabel?: string;
  email?: EmailDelivery;
}

export function add(args: AddArgs): InboxRecord {
  const record: InboxRecord = {
    id: makeId(),
    kind: args.kind,
    title: args.title,
    body: args.body,
    receivedAt: new Date().toISOString(),
    href: args.href,
    ctaLabel: args.ctaLabel,
    email: args.email,
  };
  const next = [record, ...readPersisted()].slice(0, MAX_RECORDS);
  writePersisted(next);
  bus.emit("inbox:added", { id: record.id, kind: record.kind });
  return record;
}

export function markRead(id: string): void {
  const messages = readPersisted();
  let changed = false;
  const next = messages.map((r) => {
    if (r.id === id && !r.readAt) {
      changed = true;
      return { ...r, readAt: new Date().toISOString() };
    }
    return r;
  });
  if (changed) {
    writePersisted(next);
    bus.emit("inbox:read", { id });
  }
}

export function markAllRead(): void {
  const messages = readPersisted();
  if (messages.every((r) => !!r.readAt)) return;
  const now = new Date().toISOString();
  writePersisted(messages.map((r) => (r.readAt ? r : { ...r, readAt: now })));
  bus.emit("inbox:read", { id: "*" });
}

/** Replace the EmailDelivery sub-object for `id`. Used by the email
 *  adapter to advance the lifecycle (sending → sent | failed | not_configured).
 *  Does nothing if the record has no email metadata to begin with. */
export function updateEmailDelivery(id: string, patch: Partial<EmailDelivery>): void {
  const messages = readPersisted();
  let changed = false;
  let nextStatus: EmailDelivery["status"] | undefined;
  const next = messages.map((r) => {
    if (r.id !== id) return r;
    if (!r.email) return r;
    changed = true;
    const merged: EmailDelivery = { ...r.email, ...patch };
    nextStatus = merged.status;
    return { ...r, email: merged };
  });
  if (changed && nextStatus) {
    writePersisted(next);
    bus.emit("inbox:email-state", { id, status: nextStatus });
  }
}

/** Test helper: drop every record + clear cache. Intended for the
 *  Playwright harness — exposed on `window.__lcInbox.clear()`. */
export function clear(): void {
  writePersisted([]);
}
