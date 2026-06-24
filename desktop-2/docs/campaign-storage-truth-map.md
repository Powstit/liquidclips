# Campaign Storage Truth Map · Phase 6N-B+

Status: read-only audit. No code, no schema, no fixture changes.
Verified by:
- grep over `src/design-os/engine/sidecar-stub.ts` for every `tryInvoke` (RPC) + `fetch` (HTTP) attempt
- ls + grep over `junior-backend/app/routes/*.py` for endpoint existence
- grep over `models.py` for SQLAlchemy tables backing each surface
- grep for every `localStorage` key in the DOS bundle

The audit answers: **for each datum surfaced in the Design OS today, where does it really live, and what happens when the user closes the app or sits down at a different machine?**

---

## Storage source legend

For the per-field tables below, the **Source** column uses these codes:

| Code | Meaning |
| --- | --- |
| **DB** | Railway Postgres · SQLAlchemy model under `junior-backend/app/models.py`; survives restart and machine change |
| **SA** | SQLAlchemy model exists but **no public read endpoint** today (e.g. table is admin-mutated only) — data is real on the server but not reachable from a clipper's desktop |
| **MOCK** | Hard-coded fixture inside `src/design-os/engine/sidecar-stub.ts`; **dies on tab refresh, never leaves the bundle** |
| **LS** | `localStorage` on the user's machine; survives restart, dies on machine change OR `Clear site data` |
| **WHOP** | Whop is the system of record (chat, payout settlement, content rewards); we read but don't own |
| **DERIVED** | Computed in the React layer from another source; never persisted |
| **OAUTH** | Third-party credential (Drive · Dropbox · etc.) needed to ingest — neither stored nor implemented yet |

The **Real-today** column means there's a non-mock code path the user actually hits right now (Tauri RPC OR HTTP fetch). When the Tauri shell isn't present and the backend is unreachable, the route quietly falls to MOCK — that's by design, but it does change what "real today" practically means in dev preview vs production install.

---

## Executive summary

**Headline:** Two of the nine surfaces are deeply real (Campaigns + Earnings), six are partly real (backed by a Railway table but with a sidecar gap that leaves the DOS reading mock today), and one is honestly stubbed (Asset Sources have no DB at all yet).

| Surface | Real today? | Mock today? | Survives restart? | Survives machine change? | Production ready? |
| --- | --- | --- | --- | --- | --- |
| **Campaigns** | ✓ HTTP `GET /campaigns` | ✓ fallback | ✓ DB | ✓ DB | ⚠ schema needs the 6N-A extensions before write paths land |
| **Submissions** | ✗ wire-up gap | UI stub only | ✓ DB exists (rows) | ✓ DB | ⚠ backend ready, frontend `POST` not wired |
| **Earnings** | ✓ HTTP `GET /me/reward-clips` | ✓ fallback | ✓ DB | ✓ DB | ✓ read · write (`POST/PATCH`) not yet wired in DOS |
| **Leaderboards** | ✓ HTTP `GET /leaderboard/earnings` | ✓ fallback | ✓ DB cache (6h cron) | ✓ DB | ✓ read |
| **Community channels** | ✓ HTTP `GET /community/channels` | ✓ fallback | ✓ DB | ✓ DB | ✓ read |
| **Asset Sources** | ✗ no DB table | ✓ inline JSON on mock Campaign rows | ✗ dies on refresh | ✗ | ✗ blocking for Phase 6N-D |
| **Discussions** | ✓ Whop mirror URL constructs from DB | ✓ visited set in LS | partial (Whop ✓ / visited LS) | Whop ✓ / visited ✗ | ✓ for Whop · native deferred |
| **Schedule jobs** | ✗ sidecar has no HTTP fallback today; backend `/schedules` is gated behind Postiz feature flag | ✓ pure mock in DOS | ✗ | ✗ | ⚠ backend exists but gated; DOS sidecar must add the HTTP fetch |
| **Channels (publishing)** | ✗ sidecar only RPC + mock | ✓ pure mock in DOS | ✗ | ✗ | ⚠ backend (`/channels`) + Ayrshare wiring exist; DOS sidecar must add the HTTP fetch |
| **Achievements** | ✗ | ✓ LS only | ✓ LS | ✗ | ⚠ first-paint UX only; no server-side persistence |

The **two biggest production gaps** before Campaigns reaches write paths:

1. **Asset Sources have no Railway table.** Today they're an in-mock JSON field on Campaign. Phase 6N-D needs a `campaign_asset_sources` table OR a JSON column with audit + ingestion metadata.
2. **Schedule + publishing Channels** read from mock in DOS even though the backend tables + endpoints already exist. The sidecar needs HTTP fetch parity for `/schedules` and `/channels` before a production install can reflect a real user's queue/connections.

---

## 1 · Campaigns

Backed by `SponsoredCampaign` (`junior-backend/app/models.py:578-657`, 45+ columns). Read by `GET /campaigns` (`junior-backend/app/routes/campaigns.py:216`, viewer-tier aware).

Frontend reads `campaigns.list()` / `campaigns.getBySlug()` in `engine/sidecar-stub.ts` · real-RPC → real-HTTP → 6-row mock fallback.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `id` · `slug` · `title` · `subtitle` · `description` | **DB** | ✓ | ✓ | ✓ | `description` not yet on table (6N-A flag); will add in 6N-C schema delta |
| `brand` · `businessUnit` | **DB** | ✓ | ✓ | ✓ | — |
| `campaignType` | **MOCK** | ✗ | ✗ | ✗ | Discriminator column doesn't exist yet (6N-A §2.2 flagged as critical add) |
| `status` | **DB** | ✓ | ✓ | ✓ | Enum needs `draft` added when agency creation lands |
| `placementQuality` + `placementMetadata` | **MOCK** | ✗ | ✗ | ✗ | Today inferred from `sort_order` + `is_invite_only`; new discriminator pending |
| `rewardPoolCents` · `fundedPct` · `minLcScore` | **DB** | ✓ | ✓ | ✓ | maps from `budget_cents` / `funded_pct` / `min_lc_score` |
| `payoutRules` (polymorphic) | **MOCK** | ✗ | ✗ | ✗ | Today three scalar columns (`rpm_cents` / `base_rpm_cents` / `premium_rpm_cents`); JSON column pending |
| `capacityTotal` · `capacityUsed` · `capacityWindow*` | **MOCK** | ✗ | ✗ | ✗ | Not on table today (pending 6N-A §2.4) |
| `deadline` · `durationLabel` | partial | partial | ✓ | ✓ | `duration_label` real; `deadline` pending |
| `targetPlatforms` · `targetGeos` · `targetHashtags` | **MOCK** | ✗ | ✗ | ✗ | Pending 6N-A §2.5 |
| `visibilityTiers` · `requiredTier` · `requiresMembership` | **DB** | ✓ | ✓ | ✓ | — |
| `tierRules` | **MOCK** | ✗ | ✗ | ✗ | Pending 6N-A §2.5 |
| `discussionProvider` | **MOCK** | ✗ | ✗ | ✗ | Inferred from `community_channel_id` today; explicit enum pending |
| `communityChannelId` | **DB** | ✓ | ✓ | ✓ | already on table |
| `assetSources[]` | **MOCK** | ✗ | ✗ | ✗ | see §6 below — no storage exists yet |
| `bannerUrl` · `featuredThumbUrl` | **DB** (banner) / **MOCK** (featured thumb) | partial | ✓ banner / ✗ featured | ✓ banner / ✗ featured | featured-thumb URL pending column |
| `whopUrl` · `whopCampaignId` · `whopCampaignUrl` · `affiliateEnabled` | **DB** | ✓ | ✓ | ✓ | — |

**Restart?** Yes for everything the DB carries (most of the row); mock-augmented fields snap back to defaults on refresh until the 6N-A schema delta lands.
**Machine change?** Same as restart — DB-backed travels, mock-backed doesn't.
**Production ready?** Read path is production-ready; **write path needs the schema delta** (6N-A → 6N-C) before agency creation can persist a full Campaign row.

---

## 2 · Submissions

Backed by `CampaignSubmission` (`junior-backend/app/models.py:511-562`) AND the parallel `RewardClip` (`models.py` reward_clips table, `/me/reward-clips`). Two adjacent concepts: submissions are the legacy moderated clip-submission flow; reward clips are the affiliate-tracking row. Both real.

Backend routes: `POST /submissions` · `GET /submissions/me` · `PATCH /submissions/{id}/status` (`junior-backend/app/routes/submissions.py:182, 422, 317`).

Frontend reads ❌ for submissions today. The Earn route reads RewardClips instead (§3). The Campaigns `<CampaignPageShell>` submission CTA is a **stub toast** — no `POST` wired.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| Submission rows (`campaign_submissions` table) | **DB** | ✗ from DOS | ✓ DB | ✓ DB | backend route exists; sidecar has no `submissions.*` API yet |
| Submission lifecycle (`submitted / accepted / forwarded / paid / rejected`) | **DB** | ✗ from DOS | ✓ DB | ✓ DB | watermark detector + manual mod review live; DOS would surface in 6N-C |
| Submission CTA on `<CampaignPageShell>` | **MOCK** | n/a (stub toast) | n/a | n/a | "Submission flow lands in Phase 6N-C" — explicit deferral |

**Restart?** DB rows survive (server-side). DOS sees nothing today regardless.
**Machine change?** Same — server-side, ready, just unwired in DOS.
**Production ready?** Backend ✓; **frontend wire-up is the gap.**

---

## 3 · Earnings (Reward Clips · Earn route)

Backed by `RewardClip` + `TrackingLink` tables. Read by `GET /me/reward-clips` (`junior-backend/app/routes/reward_clips.py:255`).

Frontend reads `earn.listRewardClips()` / `earn.summary()` in `sidecar-stub.ts` · real-RPC → real-HTTP → 8-row mock fallback. Confirmed at `sidecar-stub.ts:1553` (`fetch(${backendUrl()}/me/reward-clips, ...)`).

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `RewardClip.id` · `whopRewardId` · `whopRewardTitle` · `clipIdx` | **DB** | ✓ | ✓ | ✓ | — |
| `platform` · `accountLabel` · `campaignId` · `whopSubmissionId` · `status` | **DB** | ✓ | ✓ | ✓ | `status` enum: draft/generated/submitted/approved/denied/paid |
| `trackingLink.id` · `shortUrl` · `destinationUrl` · `affiliateId` · `clickCount` | **DB** | ✓ | ✓ | ✓ | click count populated by `/r/<id>` redirect endpoint |
| `EarnSummary.totalEarnedUsd` · `pendingPayoutsUsd` | **DERIVED** | ✓ (from real rows) | n/a | n/a | computed in `useEarnSummary` from `RewardClips × RPM` · re-derives every render |
| `EarnSummary.rpm` (RPM tier) | **DERIVED** from `useTierCaps()` | ✓ but mock tier | n/a | n/a | tier currently defaults to `pro` in `useTierCaps`; real tier comes from Whop subscription state (DB column `users.tier`) but DOS doesn't read it yet |
| Submission status filters | **DERIVED** | ✓ | n/a | n/a | grouped in `useRewardClips` |
| Payout settlement | **WHOP** | ✓ outside DOS | n/a | n/a | Whop content-reward queue owns the money flow once `whopSubmissionId` is set |

**Restart?** Yes — rows live on Railway.
**Machine change?** Yes — same.
**Production ready?** Read path ✓. **Write path (POST/PATCH) NOT wired in DOS** — the user can see their earnings but can't mint a new reward-clip row from the Campaigns surface yet.

---

## 4 · Leaderboards

Backed by `users.cached_lifetime_earnings_usd` + `cached_paid_referrals` + `cached_display_handle` + `cached_earnings_at` (6h cron refresh). Read by `GET /leaderboard/earnings` (`junior-backend/app/routes/leaderboard.py`).

Frontend reads `community.leaderboardPreview()` · real-RPC → real-HTTP → 5-row mock. Confirmed at `sidecar-stub.ts:1289`.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `LeaderboardPreviewRow.rank` · `displayHandle` · `lifetimeEarningsUsd` · `paidReferrals` | **DB** (cached columns) | ✓ | ✓ | ✓ | 6h staleness possible · drives the "Refreshes 6h" pill |
| `isCaller` flag | **DERIVED** (server matches caller's `users.id`) | ✓ | n/a | n/a | — |
| "Top 100" achievement unlock | **LS** + **DB** trigger | partial | ✓ on this machine | ✗ across machines | unlock recorded in localStorage (`lc.community.achievements.v1`); not synced |
| Caller-pinned outside-top-5 row | **DERIVED** | ✓ | n/a | n/a | — |

**Restart?** Yes — cached columns survive.
**Machine change?** Yes for the leaderboard itself. **Achievement unlocks do NOT survive a machine change** — the user re-earns "Top 100" on each device.
**Production ready?** Read ✓. Achievement persistence is the gap (cosmetic).

---

## 5 · Community channels

Backed by `community_channels` table (`models.py:680`). Read by `GET /community/channels?clerk_user_id=…` (`junior-backend/app/routes/community.py`).

Frontend reads `community.listChannels()` · real-RPC → real-HTTP → 9-row mock. Confirmed at `sidecar-stub.ts:1262`.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `channel.id · slug · name · purpose · whop_channel_id` | **DB** | ✓ | ✓ | ✓ | seeded by `scripts/seed_community_channels.py` |
| `required_tier · is_locked_preview_enabled · is_admin_only · section` | **DB** | ✓ | ✓ | ✓ | drives lockedness |
| Viewer tier (`viewer_tier`) | **DB** (per-caller) | ✓ | ✓ | ✓ | Clerk user → tier resolution |
| Mark-as-visited | **LS** | ✓ on this machine | ✓ on this machine | ✗ across machines | key `lc.community.visited.v1` |
| Announcements (rail empty state) | **NONE** today | n/a (empty) | n/a | n/a | no public `/announcements` GET confirmed by Phase 6K audit |
| Banners (`community_top` placement) | **SA** (admin-write only) | partial | DB ✓ (when set) | DB ✓ | sidecar attempts `GET /banners?placement=community_top`; admin endpoint exists, public list endpoint partial; falls to 1-row mock today |

**Restart?** Yes for channels; visited set survives.
**Machine change?** Yes for channels. **Visited set lost** on machine change (cosmetic).
**Production ready?** Read ✓. Banner public-GET endpoint surface is the only soft gap.

---

## 6 · Asset Sources

**This is the biggest gap in the entire system.** Asset Sources are *not* a database table today. The `Campaign.assetSources[]` field in `campaigns/types.ts` is read from inline JSON in the **mock campaign rows** — when the route resolves to real-HTTP, the response from `/campaigns` doesn't include asset_sources at all (the backend doesn't carry the column yet).

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `AssetSource.id · kind · label · url · externalId` | **MOCK** | ✗ | ✗ | ✗ | inline JSON in `sidecar-stub.ts` mock seed |
| `AssetSource.status` (`pending_link / ready / stale / error`) | **MOCK** | ✗ | ✗ | ✗ | — |
| `AssetSource.manifest` (file count / bytes / sample names) | **MOCK** | ✗ | ✗ | ✗ | needs Drive/Dropbox listing API + cache layer |
| Drive / Dropbox OAuth credentials | **OAUTH** (not implemented) | ✗ | ✗ | ✗ | no token storage exists yet |
| Whop assets | **WHOP** | ✗ from DOS | n/a | n/a | Whop owns them; we'd need to fetch via Whop API on demand |
| Direct upload payload | **NONE** | ✗ | ✗ | ✗ | no upload endpoint scoped yet |

**Restart?** No — refresh wipes everything.
**Machine change?** No — same.
**Production ready?** ✗ **Not implementable until Phase 6N-D delivers the `campaign_asset_sources` table + OAuth + ingestion.**

This is the **only surface in the audit that has no path to "real today"**, even partially.

---

## 7 · Discussions

Backed by `community_channels.whop_channel_id` (`chat_feed_*`) + the campaign-level `community_channel_id` FK (already on `sponsored_campaigns`). Discussion content (messages, reactions, comments) is owned by Whop — we don't store it.

Frontend reads `Discussion` shape via `channelToDiscussion()` (rooms) or `campaignToDiscussion()` (campaigns). `bus.emit("browse:open", { mirror: "whop" })` opens the Whop chat.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| Discussion URL (Whop) | **DB** (`whop_channel_id`) → **DERIVED** URL | ✓ | ✓ | ✓ | URL constructed `https://whop.com/c/<id>` |
| Discussion messages / reactions / comments | **WHOP** | ✓ outside DOS | ✓ on Whop's infra | ✓ | not our storage |
| Discussion provider (`whop / native / none`) | **MOCK** (inferred from presence today; explicit enum pending) | partial | ✓ | ✓ | new column added in 6N-A schema delta |
| Native discussion | **NONE** | ✗ | ✗ | ✗ | deferred to a future phase (Phase 6N-F per the audit) |
| "Mark as visited" toggle | **LS** | ✓ on this machine | ✓ on this machine | ✗ across machines | key `lc.community.visited.v1` |

**Restart?** Yes — Whop holds messages; LS visited set survives.
**Machine change?** Yes for Whop. ✗ visited set.
**Production ready?** Whop mirror ✓ (already in production for the legacy desktop). Native discussion is explicitly deferred.

---

## 8 · Schedule jobs

Backed by `Schedule` table + `/schedules` CRUD (`junior-backend/app/routes/schedules.py`). **Backend is real and live** but gated behind a Postiz feature flag (`schedule_one`) which returns 503 until `POSTIZ_CLIENT_ID/SECRET` are configured.

Frontend reads `schedule.listScheduledClips()` / `scheduleClip()` / `cancel` / `reschedule` / `retry` in `sidecar-stub.ts`. **All five RPCs only try `tryInvoke` then fall straight to mock — no HTTP fetch fallback exists today.** Confirmed at `sidecar-stub.ts:988, 1041, 1056, 1069, 1083`.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `ScheduledJob.id` · `clipTitle` · `platform` · `accountLabel` · `accountHandle` · `scheduledFor` · `status` · `retryCount` · `error` · `captionOverride` · `postUrl` | **MOCK** in DOS today | ✗ from DOS | ✗ | ✗ | backend `/schedules` exists but DOS sidecar doesn't fetch it |
| Cron firing of `scheduled → uploading → published` | **DB** (server cron) | ✓ outside DOS | ✓ | ✓ | runs on the backend regardless of what the desktop shows |
| Per-clip caption_by_account_id | **MOCK** in DOS today | ✗ | ✗ | ✗ | same gap |
| Job retry | **MOCK** in DOS today | ✗ | ✗ | ✗ | backend `POST /schedules/{id}/retry` exists; not consumed |

**Restart?** ✗ in DOS view — the in-memory mock resets. Real backend rows survive but DOS doesn't see them yet.
**Machine change?** ✗ in DOS view — same.
**Production ready?** Backend ✓ (gated). **Frontend sidecar needs to add HTTP fetch fallback to `/schedules` before any production install reflects a user's real queue.**

---

## 9 · Channels (publishing — TikTok / Instagram / YouTube / X / LinkedIn / Facebook)

Backed by `channels` table + `/channels` CRUD (`junior-backend/app/routes/channels.py` · GET/POST/PATCH/DELETE/refresh/relink). Ayrshare connection state in `social_connections` table + `/social/*` (connections / connect / disconnect / start-link / refresh-platforms).

Frontend reads `channels.list()` / `connect()` / `disconnect()` / `refresh()` in `sidecar-stub.ts`. **All four only try RPC then fall to mock — no HTTP fetch fallback.** Confirmed at `sidecar-stub.ts:757, 765, 811, 831`.

| Surfaced field | Source | Real today? | Survives restart? | Survives machine change? | Notes |
| --- | --- | --- | --- | --- | --- |
| `SidecarChannel.id` · `platform` · `label` · `handle` · `status` · `brandId` · `tierRequirement` · `ayrshareProfileKey` · `lastPublishAt` · `monthlyPostCount` · `tokenExpiresAt` · `createdAt` | **MOCK** in DOS today | ✗ from DOS | ✗ | ✗ | backend `/channels` exists; DOS sidecar doesn't fetch it |
| Recent posts (`recentPosts[]`) on each channel | **MOCK** | ✗ | ✗ | ✗ | could be derived from `/social/*` `history()` but not wired |
| OAuth handshake / token storage | **OAUTH** (via Ayrshare) | ✓ outside DOS | ✓ DB | ✓ DB | `/social/start-link` returns the Ayrshare hosted link; tokens stored server-side |
| Tier-cap gating (visible channels per platform) | **DERIVED** | ✓ | n/a | n/a | computed in `useChannels` from tier × seeded rows |

**Restart?** ✗ in DOS view — mock resets. Real backend rows survive.
**Machine change?** ✗ in DOS view — same.
**Production ready?** Backend ✓ + Ayrshare integration is live. **Frontend sidecar needs HTTP fetch fallback to `/channels` and `/social/connections`** before a production install reflects a user's real connected accounts.

---

## 10 · Localized state (achievements + visited rooms + persisted session)

| Key | What it stores | Source | Survives restart? | Survives machine change? |
| --- | --- | --- | --- | --- |
| `lc.community.achievements.v1` | Earned achievement ids (Set<string>) | **LS** | ✓ this machine | ✗ |
| `lc.community.visited.v1` | Visited room/discussion ids | **LS** | ✓ this machine | ✗ |
| `lc:engine:session:v1` | Engine session summary (selected clip · runtime mode · stage progress · etc.) | **LS** | ✓ this machine | ✗ |

**Production ready?** Cosmetic state only. A future "user preferences" sync would migrate these into a `users.preferences JSON` column or a small `user_local_state` table — not blocking ship.

---

## 11 · Where mock leaks into "production"

In a packaged Tauri install (`Liquid Clips.app`), the runtime is Tauri so `tryInvoke` is reachable, but the **Rust shell does not yet expose a `sidecar_call` for the DOS-shaped RPCs**. That means the route will:

1. Try `tryInvoke("list_channels", {})` → returns null (no handler).
2. Try `shouldTryHttpBackend()` → `window.__TAURI_INTERNALS__` is truthy → fires the HTTP path.
3. **For surfaces with HTTP fallback** (Campaigns / RewardClips / Leaderboard / Community / Banners / Announcements): real data flows.
4. **For surfaces without HTTP fallback** (Channels / Schedule): falls to mock.

So in a real install today, four surfaces would land on real data and two (Channels + Schedule) would show mock. **That's the production-ready gap to close before user-visible ship of the DOS Channels + Schedule routes.**

---

## 12 · Gap roll-up (what to fix, where, in what order)

### A · Hard blockers for production-ready writes (Phase 6N-C scope)

1. **Campaign schema delta** — add `campaign_type`, `description`, `payout_rules` JSON, `asset_sources` JSON or sibling table, `tier_rules` JSON, `placement_quality`, `placement_metadata`, `target_*` JSON columns, `discussion_provider`, `capacity_*`, `deadline`, `created_by`. Per 6N-A § Migration path.
2. **Sidecar HTTP fetch parity** for Channels and Schedule — add the same `shouldTryHttpBackend()` → `fetch(${backendUrl()}/channels)` + `/schedules` blocks the other surfaces already have.
3. **Submission `POST` wiring** — `<CampaignPageShell>` submission CTA → `POST /me/reward-clips` (RewardClip is the existing real table that carries the per-clip earn signal; CampaignSubmission is the moderation-flow row for sponsored campaigns. Decide which one the new agency flow targets and wire it — recommend `reward_clips` for clip campaigns + `campaign_submissions` for submission campaigns).

### B · Soft blockers (closeable in 6N-C with backend touch)

1. **Public `/announcements` GET endpoint** — currently admin-only; sidecar attempts and falls to empty.
2. **Public `/banners` GET endpoint** (for `community_top` placement) — currently admin-only.

### C · Deferred (Phase 6N-D and later)

1. **`campaign_asset_sources` table + OAuth** for Drive/Dropbox/Whop ingestion.
2. **Native discussion entity** (`lc_discussions` table).
3. **Featured/sponsored billing** rail.
4. **Achievement persistence** on the server (cosmetic).

---

## Closing notes

- The system has a **healthy real backend for most surfaces** — six of nine sit on Railway tables today, and the sidecar wraps them with the real-RPC → HTTP → mock pattern correctly for four (Campaigns / RewardClips / Leaderboard / Community).
- The **two surfaces that look real in screenshots but are honestly mock today** are Channels (publishing) and Schedule. Backend is there; the sidecar HTTP fetch isn't.
- The **one surface that has no DB at all** is Asset Sources. Phase 6N-D is the unblocker.
- The **localStorage burden is small** — three keys, all cosmetic. Nothing critical leans on it.
- A production user on a fresh install would see real Campaigns + Earnings + Leaderboard + Community + Discussion (via Whop) immediately; would see mock Channels + Schedule rows until the sidecar gap closes; would see no Asset Sources content until 6N-D.

This audit found **no surprises beyond the gaps already flagged in 6N-A** plus the channels/schedule HTTP-fetch gap, which is a new finding worth adding to the 6N-C plan.
