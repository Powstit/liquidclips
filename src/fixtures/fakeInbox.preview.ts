/**
 * fakeInbox · fixture messages for the Inbox shell.
 *
 * Real backend wiring lives in a future sprint. Until then the Inbox
 * sheet (opened from NotificationBell) reads from this list so beta
 * testers see something honest when they click the bell.
 */

export type InboxKind =
  | "welcome"
  | "campaign"
  | "clip-ready"
  | "system"
  | "reward";

export interface FakeInboxMessage {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  receivedAt: string;
  unread: boolean;
  /** Optional CTA — opens via openSmart() if absolute, hash route if `#/…`. */
  href?: string;
  ctaLabel?: string;
}

/* BUG-046 · empty initial inbox. The previous fixture seeded 5 fake
 * messages (3 unread) that drove a fake "3 unread" badge on the
 * NotificationBell + a fake Inbox sheet pretending to show messages
 * from "Liquid Clips" that the customer never received. With no real
 * notification backend wired, the honest default is zero.
 *
 * The historical fixture is preserved as LEGACY_INBOX_FIXTURE for any
 * future dev-only Storybook use · not read by production code. */
export const fakeInbox: FakeInboxMessage[] = [];

/* eslint-disable @typescript-eslint/no-unused-vars */
const LEGACY_INBOX_FIXTURE: FakeInboxMessage[] = [
  {
    id: "msg_fx_001",
    kind: "welcome",
    title: "Welcome to the Liquid Clips beta",
    body: "You're one of the first testers in. Tell us what breaks: hello@liquidclips.app.",
    receivedAt: "2026-06-19T18:00:00Z",
    unread: true,
    href: "mailto:hello@liquidclips.app",
    ctaLabel: "Email us",
  },
  {
    id: "msg_fx_002",
    kind: "system",
    title: "Beta build · 0.8.0",
    body: "The clip engine runs in preview mode this build. Real ingest lands in 0.8.1.",
    receivedAt: "2026-06-19T17:30:00Z",
    unread: true,
  },
  {
    id: "msg_fx_003",
    kind: "campaign",
    title: "New campaign · Uncle Daniel Audience Zero",
    body: "An agency campaign just opened in your tier. Open Campaigns to read the brief.",
    receivedAt: "2026-06-19T12:14:00Z",
    unread: true,
    href: "#/campaigns",
    ctaLabel: "Open Campaigns",
  },
  {
    id: "msg_fx_004",
    kind: "clip-ready",
    title: "Demo · 4 clips ready in Engine",
    body: "Your sample run finished. Open the Engine to preview the cuts.",
    receivedAt: "2026-06-18T20:42:00Z",
    unread: false,
    href: "#/engine",
    ctaLabel: "Open Engine",
  },
  {
    id: "msg_fx_005",
    kind: "reward",
    title: "Reward unlocked · First clip badge",
    body: "Earn a badge every time you ship your first clip in a new campaign.",
    receivedAt: "2026-06-17T09:11:00Z",
    unread: false,
  },
];
/* eslint-enable @typescript-eslint/no-unused-vars */
void LEGACY_INBOX_FIXTURE;

export function unreadCount(list: ReadonlyArray<FakeInboxMessage> = fakeInbox): number {
  return list.reduce((n, m) => n + (m.unread ? 1 : 0), 0);
}
