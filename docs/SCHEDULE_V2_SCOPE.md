# Schedule v2 — Multi-channel scheduling + analytics

**Status:** SCOPE FOR APPROVAL — no code touched.
**Author:** Claude (Opus 4.7) · 2026-06-02 (rewritten after Daniel's "one-at-a-time + DDB pipeline waiting" clarification)
**Goal:** Daniel uses this for DDB revenue THIS WEEK. Build for ONE channel first; users add a 2nd, 3rd, etc. by repeating the same flow. No bulk wizards.

---

## The new mental model (simpler than v1)

```
USER
 └── CHANNELS (N per user, added ONE AT A TIME)
      ├── Channel A  ←  user runs in-app linker once  →  1 Ayrshare profile  →  1 TikTok handle
      ├── Channel B  ←  user runs in-app linker again →  1 Ayrshare profile  →  1 Reels handle
      └── …          (same flow, repeated)
 │
 └── SCHEDULES (per-channel)
      └── ANALYTICS (per-channel rollup + per-post detail)
```

**Each channel is fully independent.** No "bulk-link all 7 TikToks" wizard, no compare-N-channels-at-once dashboard. The user adds Channel A, schedules to it, sees analytics for it. Then comes back and adds Channel B same way.

Why this is better:
- Same flow scales from 1 channel → 30 channels with zero new UI
- No combinatorial "channel × platform × link state" UI complexity
- DDB launches at N=1 the day after this ships
- Adding channels feels like adding browser tabs, not "configuring a campaign"

---

## IA — Schedule becomes the command center

Top nav stays the same. Inside Schedule, three sub-tabs:

```
Schedule
├── Queue        ← calendar view, all upcoming + past posts across all channels
├── Channels     ← list of channel cards + "+ Add Channel" button (the only place channels live)
└── Analytics    ← per-channel + cross-channel rollup, ranked clip leaderboard
```

The existing Settings → Connections → Publishing-Ayrshare panel stays for the FREE / single-channel user only. Once a user has any row in `social_channels`, the legacy panel reads "Managed in Schedule → Channels →" and stops showing the paste-key form.

Workspace + Upload tab gain a **single channel-picker dropdown** in their publish modals — the same component used in Schedule's Queue. Picks one channel (or "all channels of a platform"), once.

---

## Data model

### New table `social_channels` (replaces `social_connections` for new users)

```sql
CREATE TABLE social_channels (
  id varchar PRIMARY KEY,                                       -- uuid
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label varchar NOT NULL,                                        -- user-facing name e.g. "DDB Beauty TikTok"
  platform varchar NOT NULL,                                     -- tiktok|instagram|youtube|x|linkedin|facebook|threads
  ayrshare_profile_key varchar NOT NULL UNIQUE,                  -- one Ayrshare sub-profile per channel
  ayrshare_ref_id varchar,                                        -- Ayrshare's internal ref
  handle varchar,                                                 -- @username, populated post-link via /user
  status varchar NOT NULL DEFAULT 'pending_link',                 -- pending_link|active|error|paused|deleted
  last_refreshed_at timestamptz,
  total_posts integer NOT NULL DEFAULT 0,                         -- denormalized fast counter
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);
CREATE INDEX ix_social_channels_user ON social_channels (user_id);
CREATE INDEX ix_social_channels_status ON social_channels (status);
```

### `schedules` refactor (existing table, columns added)

```sql
ALTER TABLE schedules ADD COLUMN channel_id varchar REFERENCES social_channels(id);
ALTER TABLE schedules ADD COLUMN caption_override text;            -- optional per-channel caption
ALTER TABLE schedules ADD COLUMN ayrshare_scheduled_post_id varchar;   -- for cancel
ALTER TABLE schedules ADD COLUMN actual_post_url varchar;            -- after publish
ALTER TABLE schedules ALTER COLUMN platform DROP NOT NULL;          -- channel implies platform
CREATE INDEX ix_schedules_channel ON schedules (channel_id);
```

Existing pending rows keep working (their old `platform` field + `social_connections.ayrshare_profile_key` still resolves). They never get a `channel_id`. Old rows phase out naturally as they fire or get cancelled.

### New table `post_analytics`

```sql
CREATE TABLE post_analytics (
  schedule_id varchar PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
  channel_id varchar NOT NULL REFERENCES social_channels(id),
  platform varchar NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  saves integer NOT NULL DEFAULT 0,
  engagement_rate numeric(5,2),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb                                                  -- Ayrshare raw response
);
CREATE INDEX ix_post_analytics_channel ON post_analytics (channel_id);
```

### Migration — backwards compatible

All ALTERs in `app/main.py` lifespan as idempotent `ADD COLUMN IF NOT EXISTS`. The first GET `/channels` for legacy users with a row in `social_connections` auto-backfills a single channel row labeled "Main account" so they don't lose access.

---

## Backend changes — exact files & line counts

| File | Change | New lines (~) |
|---|---|---|
| `app/models.py` | Add `SocialChannel` + `PostAnalytic` classes (alongside `SocialConnection`, which stays read-only) | +60 |
| `app/main.py` | Register `channels` + `analytics` routers · 4 idempotent ALTERs · 1 idempotent CREATE TABLE | +12 |
| `app/routes/channels.py` (NEW) | CRUD: POST/GET/PATCH/DELETE `/channels`, POST `/channels/{id}/start-link`, POST `/channels/{id}/refresh`, POST `/channels/{id}/relink` | ~220 |
| `app/routes/publish.py` (existing :77) | Extend `publish_now` with optional `channel_id` Form field. Resolves profile_key from channel.ayrshare_profile_key when set. Falls back to legacy single-profile flow if `platforms` only. | +20 modified |
| `app/routes/schedules.py` (existing) | Refactor `create_schedule` + `drip-batch` to accept `channel_id` per item. Forward to Ayrshare's scheduler immediately (closes the audit gap). DELETE schedule also cancels via Ayrshare. | +40 modified |
| `app/routes/analytics.py` (NEW) | GET `/analytics/overview`, GET `/analytics/channels/{id}`, GET `/analytics/posts/{schedule_id}`. Reads from post_analytics + Schedule joins. | ~150 |
| `app/cron.py` (existing :173) | Add `_refresh_analytics_tick` (30 min) + `_refresh_channel_status_tick` (6 hr). Register both in `start_cron()`. | +90 |
| `app/ayrshare.py` | **No changes.** `create_profile`, `post`, `analytics`, `cancel_scheduled` already exist + are used by the new routes. | 0 |
| `app/routes/social.py` | Keep alive for back-compat. Mark legacy in comments. No code changes. | 0 |

**Backend net: ~600 new lines, ~60 modified. 2-2.5 days of focused work.**

---

## Frontend changes — exact files

| File | Change | New lines (~) |
|---|---|---|
| `src/components/schedule/SchedulePage.tsx` (existing) | Refactor into 3-tab page: Queue / Channels / Analytics. Sub-tab state in URL hash for deep-linking. | +30 modified |
| `src/components/schedule/ChannelsManager.tsx` (NEW) | Grid of channel cards + "+ Add Channel" button. Empty state: prominent CTA. | ~200 |
| `src/components/schedule/ChannelCard.tsx` (NEW) | Per-channel card: platform icon, label, handle, status dot, 7d-views chip, hover-actions (rename / refresh / pause / delete) | ~140 |
| `src/components/schedule/AddChannelModal.tsx` (NEW) | "+ Add Channel" wizard. Step 1: pick platform + label. Step 2: opens Tauri WebView for Ayrshare link (reuses sprint #14d's `open_social_link_window`). Step 3: poll until linked. | ~180 |
| `src/components/schedule/ScheduleCalendar.tsx` (NEW) | 7-day calendar grid. X-axis = days, Y-axis = channels (collapsed by platform). Drag cards to reschedule. Click empty cell → schedule a clip. | ~280 |
| `src/components/schedule/AnalyticsView.tsx` (NEW) | Overview tiles (views/engagement) · channels table · top clips leaderboard · time-of-day heatmap. | ~220 |
| `src/components/schedule/ChannelPicker.tsx` (NEW) | Multiselect chips of channels grouped by platform. Used by PublishModal + UploadTab + ScheduleCalendar. | ~120 |
| `src/components/PublishModal.tsx` (existing) | Replace platforms multiselect with `<ChannelPicker />`. Add per-channel caption override. Existing "schedule one" tab already takes a datetime. | +40 modified |
| `src/components/upload/UploadTab.tsx` (existing) | Same — swap the platform pills for `<ChannelPicker />`. | +20 modified |
| `src/components/AyrshareConnectionPanel.tsx` (existing) | When user has channels in `social_channels`, hide the paste-key form; show "Managed in Schedule → Channels". | +15 modified |
| `src/lib/backend.ts` | Add `channels.*` client (list, create, startLink, refresh, rename, delete) + `analytics.*` client. Existing `publishNow` extended with `channel_id`. | +120 |
| `src/lib/sidecar.ts` | No changes (sidecar doesn't talk to channels). | 0 |
| `src/App.tsx` | Nothing — Schedule top-level nav already shipped in 0.4.51. SchedulePage handles sub-tabs internally. | 0 |
| `src/components/schedule/types.ts` (NEW) | Shared TS types: `Channel`, `ScheduleItem`, `AnalyticsRow`, `ChannelStatus`. | ~60 |

**Frontend net: ~1,420 new lines, ~95 modified. 2-2.5 days of focused work.**

---

## UI design — three sub-tabs of Schedule

### Sub-tab 1: **Queue** (default)

Top-of-page filters:
- Channel filter chips (multiselect, "All" by default)
- Status filter (Upcoming · Live · Failed · Canceled)
- Date range toggle (Next 7 / Next 30 / All)

Body:
- Default view: simple list of upcoming posts, newest first
  - Each row: thumbnail · clip title · channel icon+label · scheduled time · status badge · cancel button
- Toggle to calendar view (top-right):
  - 7-day grid, channels as rows, days as columns
  - Drag a card between cells to reschedule
  - Click empty cell → "Schedule a clip here" → picks a clip from Workspace projects

Empty state (no schedules):
> "No posts queued. Open the Workspace, pick a clip, and use the **Schedule** button to send it to a channel at a specific time."

### Sub-tab 2: **Channels**

Grid of channel cards (3 per row on desktop, 1 per row on narrow window). Each card:

```
┌─────────────────────────────────────┐
│  [TikTok icon]   DDB Beauty TikTok  │
│                  @ddbbeauty         │  
│                  ● active           │  ← green dot
│                                     │
│  12.3k views · 7d                   │
│  84 posts · 12 scheduled            │
│                                     │
│  [Refresh] [Rename] [Pause] [Delete]│
└─────────────────────────────────────┘
```

Top row (only when N≥1): big fuchsia **"+ Add Channel"** card with `+` icon. When N=0, this card is the only thing visible + 3× the size.

**"+ Add Channel" flow** (AddChannelModal):
- Step 1: Pick platform (TikTok / Reels / YouTube Shorts / X / LinkedIn / Threads — single-select)
- Step 2: Type a label ("DDB Beauty TikTok") — pre-filled with `<platform-name> #N`
- Step 3: Click "Continue → Link account"
- Step 4: Backend POST /channels creates the row + Ayrshare profile + returns link_url
- Step 5: Tauri WebView opens (reusing sprint #14d's `open_social_link_window`) → user OAuths the platform on Ayrshare's link page
- Step 6: User closes the window → modal polls `/channels/{id}` for `status='active'` (10s timeout) → success state shows the @handle Ayrshare pulled back
- Step 7: "All set — schedule your first post" CTA returns to Queue tab with this channel pre-filtered

Empty state (no channels):
> "Add your first channel to start scheduling.
> Each channel is one social account (one TikTok, one Reels handle).
> You can add more anytime — same flow, repeated."

### Sub-tab 3: **Analytics**

Filter chip row: time window (7d / 30d / 90d / all-time) + channel multiselect.

**Overview tiles (top row):**
- Total views (window) + delta-vs-prev-period
- Total engagement (likes + comments + shares)
- Best channel by views (label + view count)
- Best clip by views (clip title + view count)

**Channels table** (sortable):
| Channel | Posts | Views | Engagement | Rate |
|---|---|---|---|---|
| DDB Beauty TikTok | 28 | 142,330 | 8,440 | 5.9% |
| DDB Reels | 15 | 22,180 | 1,030 | 4.6% |

**Top clips leaderboard** (top 20 across all channels):
- Clip thumbnail · title · channel · platform · views · published date
- Click row → side panel with full per-channel breakdown (this clip's performance on each channel it posted to)

**Time-of-day heatmap** (per platform):
- 7×24 grid showing engagement by day-of-week × hour
- Highlights where the audience is hottest → suggests scheduling slots

Empty state (no published posts):
> "Numbers show up here once your first post goes live. Schedule one from the Workspace to get started."

---

## What connects to what (code map)

### Adding a channel

```
ChannelsManager → click "+ Add Channel"
  → AddChannelModal step 1-2 collects platform + label
  → backend.channels.create(platform, label)
    → POST /channels (channels.py:create_channel)
      → ayrshare.create_profile(title=label) returns {profileKey, refId}
      → INSERT social_channels (...) with status='pending_link'
      → returns {channel_id, link_url}
  → modal step 4 invoke('open_social_link_window', url=link_url)
    → Tauri opens WebView (social_link.rs reused as-is)
  → user OAuths their platform inside the window
  → window closes → 'social_link_closed' Tauri event fires
  → modal polls backend.channels.refresh(channel_id) every 2s for ~10s
    → POST /channels/{id}/refresh
      → hits Ayrshare /user with profile_key
      → updates social_channels.handle + status='active'
  → modal shows success → ChannelsManager re-fetches list
```

### Publishing to a channel

```
ResultsGrid → click "Publish" on clip → PublishModal opens
  → ChannelPicker shows channels grouped by platform
  → user picks 1 channel + caption + "now" or "at time"
  → backend.publishNow(jwt, {filePath, title, description, channelId, scheduledAt?})
    → POST /publish-now with channel_id
      → publish.py resolves profile_key from social_channels[channel_id]
      → ayrshare.media_upload(file, profile_key=channel.profile_key)
      → ayrshare.post(text, [channel.platform], [media_url], profile_key, scheduled_at)
      → If scheduled_at: INSERT schedules row with channel_id + ayrshare_scheduled_post_id
      → Else: returns immediate post_url
  → ResultsGrid shows success
```

### Drip-batch (multi-channel auto-spread)

```
DripCalendar → user picks N channels × N days → confirm
  → backend.schedules.dripBatch({project_slug, items: [{channel_id, clip_idx, scheduled_for}]})
    → POST /schedules/drip-batch
      → For each item:
        → resolve channel.ayrshare_profile_key
        → ayrshare.media_upload(clip.vertical_path)  [happens server-side via desktop pre-upload — see note below]
        → ayrshare.post(scheduled_at=item.scheduled_for, profile_key=channel.profile_key)
        → INSERT schedules row
      → returns the rows
```

**Note on file upload for drip-batch:** the current `/publish-now` takes a multipart file. For drip-batch we need to upload N files. Two options:
- **A: Desktop posts each clip via /publish-now with scheduled_at** — simple, reuses the existing endpoint per row. ~N HTTP calls. Already plumbed (0.4.51 just shipped `scheduled_at` on publish_now).
- **B: Add /schedules/drip-batch-upload multipart that accepts N files in one request** — fewer round-trips but new endpoint to maintain.

**Recommendation: Option A** for v1. The desktop loops over items, calls `publishNow({..., scheduledAt})` per row. 1-3s per upload; for a 14-day × 2-channel drip (28 items) that's ~30-60s with a progress bar. Acceptable. Option B is a follow-up if users complain.

### Cancelling a scheduled post

```
Queue → user clicks "Cancel" on a row
  → backend.schedules.cancel(id)
    → DELETE /schedules/{id}
      → fetch schedule row + its channel
      → ayrshare.cancel_scheduled(channel.profile_key, schedule.ayrshare_scheduled_post_id)
      → set schedule.status='canceled'
      → return 204
  → Queue re-fetches list, row gone
```

### Analytics refresh (background)

```
cron _refresh_analytics_tick (every 30 min):
  Get all schedules.status='published' from last 90 days, ORDER BY refreshed_at NULLS FIRST
  Take first 60
  For each schedule:
    channel = schedules.channel_id → social_channels
    response = ayrshare.analytics(channel.profile_key, schedule.ayrshare_scheduled_post_id)
    parse views/likes/comments/shares from response
    UPSERT post_analytics (schedule_id) with values + refreshed_at=now()
```

---

## Per-tier gating (proposed — your call)

Constrained by Ayrshare's plan (Business = 30 profiles):

| | Free | Solo | Pro | Agency |
|---|---|---|---|---|
| Channels max | 0 | 2 | 5 | 15 |
| Schedule (single) | ❌ | ✅ | ✅ | ✅ |
| Drip multi-channel | ❌ | ❌ | ✅ | ✅ |
| Per-channel caption | ❌ | ❌ | ✅ | ✅ |
| Analytics dashboard | ❌ | basic (views only) | full | full + CSV export |
| Cancel scheduled | ✅ | ✅ | ✅ | ✅ |

**At 30 paying users × Pro avg 4 channels = 120 profiles → over the 30 cap.** Either:
- Stay on Business + ~$5/profile/mo overage = $450/mo at that scale (still profitable)
- Upgrade to Enterprise ($1k+/mo, includes more profiles + white-label)

Recommendation: **stay on Business + pay overage** until 100+ Pro customers (~$1k/mo overage breakeven against Enterprise). Easier than re-negotiating mid-launch.

---

## Implementation phases (DDB-first)

**Phase 1 — DDB-ready MVP** (2 days, what you USE for DDB this week)
1. social_channels + post_analytics tables + idempotent ALTERs
2. /channels CRUD (create, list, refresh, delete)
3. SchedulePage refactor → 3 sub-tabs
4. ChannelsManager + AddChannelModal + ChannelCard
5. /publish-now extended with channel_id
6. PublishModal channel picker (single-select for v1)
7. Backend types + frontend client wiring

You can run DDB at this point: add 1 TikTok + 1 Reels, schedule posts from Workspace clips, see them fire.

**Phase 2 — Queue management + drip-fire** (1 day, follow-up week)
1. /schedules refactor — channel_id + Ayrshare scheduler bridge (drip-batch fires for real)
2. ScheduleCalendar grid (drag to reschedule)
3. /schedules DELETE → Ayrshare cancel
4. DripCalendar channel-aware

**Phase 3 — Analytics** (1.5 days)
1. /analytics/* endpoints + cron job
2. AnalyticsView (overview tiles + channels table + clips leaderboard)
3. Time-of-day heatmap

**Phase 4 — Polish** (0.5 day)
1. Per-channel caption override
2. Tier gating + upgrade walls
3. Empty states + error messages

**Total: ~5 days. DDB unblocked at end of Phase 1 (day 2).**

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Ayrshare profile cap (30) | Soft cap warning at 25; hard cap at 30; per-tier max_channels enforced server-side |
| User pastes wrong handle into channel label | "Refresh" button on card pulls current handle from Ayrshare; if mismatch, prompt to rename |
| Scheduled post fires but Ayrshare doesn't confirm | `_reconcile_published_tick` (existing) extended to flip status=failed if scheduled_for+15min passes without confirmation |
| Drip-batch fails mid-loop | Each /publish-now is independent; rows up to failure are persisted; UI shows "5 of 7 scheduled, 2 failed — retry?" |
| Ayrshare analytics rate-limits | 30-min server-side cache; max 60 posts per tick; client renders cached data with "updated X min ago" |
| Channel disconnected on Ayrshare side | `_refresh_channel_status_tick` (6h) catches; UI shows red dot + "reconnect" CTA |
| Cancel a published post | Disabled — published rows show "view on platform" only |
| Legacy `social_connections` users | Auto-backfilled into a single channel on first /channels GET |

---

## What I need before touching code

Four answers + "go":

1. **Tier caps**: Solo=2 / Pro=5 / Agency=15 (Ayrshare-budget-safe, my recommendation) — agree?
2. **IA**: confirm Schedule sub-tabs are Queue / Channels / Analytics (3 tabs inside Schedule)
3. **Phase split**: Phase 1 first (2 days, DDB-ready) then ship Phases 2-4 over the next week — OR ship-it-all in one push?
4. **DDB account label**: when I MVP-test the flow, want me to label the first sample channel "DDB Beauty TikTok" or another placeholder? (just a default label — you can rename)

End of scope v2. Awaiting confirm.
