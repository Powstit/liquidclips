# Junior — Notifications

**Status:** scope doc. Sign-off required before implementation.
**Owns:** how Junior reaches the user with updates, build notes, post results, quota warnings, brand voice messages.
**Cross-cuts:** desktop app, account-app, Junior Backend, Postiz webhooks.

---

## 1 · Goals

If any of these is missing, the product feels mute:

1. The user knows when a new build is available *and* what changed (release notes), not just "click to update."
2. When a scheduled post fires (or fails), the user finds out — not by opening Junior, but by macOS / Windows native notification.
3. Quota / billing changes (Free cap hit, Whop renewed, refund processed) surface inside the app the next time it opens.
4. Brand-voice messages from Junior appear in the same surface ("Morning. Finished the 90GB podcast you dropped in last night.") — this is the spec §3.9 chat-rotator pulled into the app, where it actually belongs.
5. One unified inbox so the user has one place to look. Not toast, not a banner, not a dock badge plus an email plus a Slack message.

---

## 2 · Taxonomy — what we notify about

| Category | Examples | Where it shows | Priority |
|---|---|---|---|
| **system_update** | "Junior 0.1.4 ready · 3 fixes · view notes" | in-app inbox + header banner (existing) | high |
| **post_published** | "Clip 04 went up on YouTube · 2,400 views" | inbox + native notification | medium |
| **post_failed** | "TikTok rejected clip 11. Trimmed to 58 s, retried, accepted." | inbox + native notification | high |
| **drip_summary** | "3 posts went out while you were away" | inbox (shown on next launch) | medium |
| **quota_warning** | "2 of 3 free videos used this month" | inbox after stage 4 finishes on Free | low |
| **billing** | "Channel tier active · paid_until 2026-06-21" or "Refund processed" | inbox | medium |
| **affiliate** | "First referral signed up — £24.50 MRR locked" | inbox | medium |
| **founder** | "You're seat #347 of 2,000. Welcome." | inbox + one-time onboarding card | high |
| **junior_message** | Brand-voice past-tense reports per spec §3.9 | inbox · large card · NEVER native | medium |
| **pipeline_event** | "Sidecar crashed during reframe. Cached up to stage 5 — re-open project to resume." | inbox | high |

**Categories explicitly NOT for v1:** marketing emails (Resend / Mailgun separate flow), in-app onboarding tours, A/B feature flags, in-app surveys.

---

## 3 · Surfaces — where the user encounters them

### 3.1 In-app inbox (the canonical home)

- **Bell icon in the header**, top-right next to the Settings button.
- A small fuchsia dot indicates unread; the dot is replaced by a `[12]` style count when there are >9 unread.
- Click → opens a right-side sheet (same component pattern as Settings, mirrored).
- Sheet shows a chronological list: newest first, grouped by day.
- Each row: eyebrow tag (category), title (Fraunces), one line of body (Geist), timestamp (Geist Mono).
- Action affordance: clicking a row either expands inline or routes (e.g. clicking a `post_published` opens the clip in the preview modal).

### 3.2 Native OS notifications (Tauri `plugin-notification`)

- For categories with priority `high` or `medium` AND when the app is NOT focused.
- macOS: Notification Center entry, banner on screen edge.
- Windows: Toast.
- Click the native notification → focuses Junior + opens the inbox to that row.
- **Quiet hours:** never between 22:00 and 08:00 local (per spec §3.10 voice — "Junior whispers"). Queued and shown the next morning.

### 3.3 Header banner (the one we have today)

- Reserved for `system_update` only.
- Once the user clicks the banner (install or dismiss), it's gone for that version.
- Continues to live in the inbox until marked read.

### 3.4 No surfaces we're adding

- **No email digests in v1.** (Junior Mail feature is a v1.2 candidate; out of scope here.)
- **No browser/web-app duplicate inbox** — desktop is the one place.
- **No SMS / WhatsApp.** That's Liquidsend's domain, not Junior's.

---

## 4 · Data model

### 4.1 Junior Backend Postgres

```sql
notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  category      text not null,             -- one of the §2 categories
  title         text not null,             -- displayed prominently
  body          text not null,             -- one or two sentences
  action_kind   text,                      -- 'open_clip' | 'open_url' | 'install_update' | null
  action_data   jsonb not null default '{}'::jsonb,  -- e.g. {clip_idx: 4, project_slug: '...'}
  priority      text not null default 'medium',      -- low | medium | high
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz not null default now(),

  -- For native-notification dedup across re-deliveries (e.g. webhook retries).
  external_dedup_key text unique
);

create index notifications_user_unread_idx
  on notifications (user_id, created_at desc)
  where read_at is null and dismissed_at is null;
```

### 4.2 Sidecar-local notifications (no backend round-trip)

Some notifications originate locally and never need to leave the machine — pipeline errors, sidecar crashes, "your laptop went to sleep mid-render." Those live in the project's `~/Junior/notifications-local.json` so they survive offline operation.

Local + remote merge in the inbox view at render time, sorted by timestamp.

---

## 5 · Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/notifications` | license JWT | Paginated list. Query: `?since=<iso>&limit=50&unread_only=true` |
| `POST` | `/notifications/:id/read` | license JWT | Marks one read (idempotent). |
| `POST` | `/notifications/read-all` | license JWT | Marks all read up to a `until` timestamp. |
| `DELETE` | `/notifications/:id` | license JWT | Dismisses (soft delete via `dismissed_at`). |
| `GET` | `/notifications/unread-count` | license JWT | Lightweight badge poll. |

### 5.1 How notifications get created

Server-side — every event hook that already exists writes one:

| Trigger | Category |
|---|---|
| Whop webhook `membership_went_valid` | `billing` ("Channel tier active") |
| Whop webhook `payment_succeeded` | `billing` ("Renewed for 30 days") |
| Whop webhook `membership_went_invalid` / refund | `billing` ("Subscription expired" / "Refund processed") |
| Whop affiliate webhook (first sale, payouts) | `affiliate` |
| Postiz webhook `post.published` | `post_published` |
| Postiz webhook `post.failed` | `post_failed` |
| Cron worker fires N schedules | `drip_summary` (rolled-up daily summary, not per-post) |
| `/usage/video-started` returns 402 OR remaining=1 | `quota_warning` |
| Tauri updater detects new release | `system_update` (only this one is generated client-side and also pushed to backend for inbox persistence) |

### 5.2 Polling vs push

- v1: **polling** — desktop hits `/notifications/unread-count` every 60 s while focused, every 5 min while backgrounded. Cheap.
- v1.5: **server-sent events** — single SSE stream on `/notifications/stream`. Lower latency, less load. Defer until we have >100 active sessions.
- Never: WebSockets. Overkill for this traffic.

---

## 6 · Voice + copy rules (binding)

Mirrors spec §3.10 + §3.9. Every notification follows:

- **Past tense for done things:** "Published clip 04 to YouTube." NOT "Junior is publishing…"
- **Plain verb for in-progress:** "Re-cutting clip 11." NOT "Junior is currently re-cutting…"
- **First-person ONLY in `junior_message` category:** "Finished the 90GB podcast." Everything else stays past-tense / plain-verb without a subject pronoun.
- **No exclamation marks. Ever.**
- **Specifics over vibes:** "2,400 views in 6h" beats "great engagement!"
- **Anchors on file paths and timestamps:** "Saved to ~/Junior/projects/ep-47/clips/" reinforces "lives on your computer."
- **No emojis.** Status dots (●○) and `→` arrows are fine.

### Example pairs

| Don't write | Write |
|---|---|
| "🎉 Your clip went viral!" | "Clip 04 hit 47k views on YouTube." |
| "Awesome — you have a new referral!" | "First referral signed up — £24.50 MRR locked." |
| "Oh no, TikTok rejected your clip." | "TikTok rejected clip 11. Trimmed to 58 s, re-uploaded, accepted." |
| "Your free trial is almost up!" | "2 of 3 free videos used this month. Upgrade unlocks unlimited." |

---

## 7 · Decisions explicitly made

- **One inbox, not multiple feeds.** No separate "build updates" / "post results" / "billing" tabs at v1. Category tags are filters, not separate inboxes.
- **Local notifications survive without backend.** A user offline for a week still sees their pipeline-error notifications when they open Junior.
- **Native OS notifications are opt-out, default on.** First-run flow asks once; setting in Settings → notifications.
- **Quiet hours 22:00–08:00 local** — Junior whispers, doesn't ping at night.
- **No marketing in the inbox.** This surface is signal-only. Onboarding cards and product announcements live in the marketing site / dashboard.
- **`junior_message` category gets a distinct visual treatment** — large card, fuchsia-soft background, brand-voice past-tense, no action button. It's the spec §3.9 chat-rotator surfaced inside the app for the first time.
- **No "Junior published 47 clips today" spam.** Drip / batch events are rolled into one `drip_summary` per day per user.
- **External dedup key required for webhook-originated rows.** Whop / Postiz retry; we never want a duplicate notification.

---

## 8 · UI components needed

1. `<NotificationBell />` — header icon + unread dot/count. Polls `/notifications/unread-count`.
2. `<NotificationSheet />` — right-side sheet, matches `<Settings />` shape. Lists merged remote + local notifications.
3. `<NotificationRow />` — eyebrow + title + body + timestamp + action affordance per category.
4. `<JuniorMessage />` — the large brand-voice card for `junior_message` category.
5. Tauri `plugin-notification` integration — fires native toasts for `high`/`medium` when unfocused.
6. Settings → notifications section — three toggles: native on/off, quiet hours, per-category opt-out.

---

## 9 · Implementation order (3 sub-sprints)

When code time arrives, build in this sequence:

1. **Backend** — `notifications` table, GET/POST/DELETE endpoints, integrate into existing Whop webhook handler (writes a `billing` row on each event). ~3 hr.
2. **Desktop** — `<NotificationBell />` + `<NotificationSheet />` + polling client, render unread count + list. Plain past-tense voice. ~4 hr.
3. **Native + niceties** — Tauri plugin-notification wiring, quiet hours, per-category opt-out toggles, `junior_message` brand-card variant. ~3 hr.

Total: ~10 hr.

---

## 10 · Out of scope (deferred)

- Email digests — Junior Mail (v1.2 candidate).
- Cross-device notification sync — single-device per user at v1.
- Push to mobile — there is no Junior mobile app.
- Per-platform notification customisation beyond OS native (no custom in-app sounds, no animated banners).
- Rich notification content (images, video previews) — text-only at v1; the in-app row can show a small thumbnail but the OS native toast is plain text.
- Per-clip "view stats" notifications (e.g. "clip 04 hit 10k") — requires platform analytics integration, which is post-v1.

---

**Sign-off:** Daniel reads §1–§7 and approves. Anything to flip — edit the doc first. Otherwise this is what the notifications system builds against.
