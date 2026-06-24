# Phase 6K · Community Audit

Status: read-only inventory. No code, no refactor, no asset work, no backend changes. Output of this phase is this report.

The headline finding: **Community is already shipped in the legacy desktop app**. The hard parts (tier gating, Whop chat-feed handoff, leaderboard cache, reward-clip ↔ Whop bounty linkage, seed channels) are wired and live. The job for Phase 6L is **port, not build** — wrap the existing endpoints/components in Design OS chrome and resist re-implementing what already works.

---

## 1 · Community inventory

### 1.1 Legacy desktop (`/Users/dipdip/code/jnr/desktop/`)

**Routes**

| File | What it does |
| --- | --- |
| `desktop/src/App.tsx:101-102` | Imports `CommunityTab` and `BrowseRewardsPanel`. |
| `desktop/src/App.tsx:2194` | `<RoomShell roomKey="community" align="top" atmosphere="community"><CommunityTab /></RoomShell>` — the single mount point. View-kind dispatcher; no React Router. |
| `desktop/src/App.tsx:3293` | `<BrowseRewardsPanel />` — in-app Whop browser sibling. |

**Components**

| File | What it does |
| --- | --- |
| `desktop/src/components/CommunityTab.tsx` (478 LOC) | Main panel. Renders tier-gated room cards (Announcements · Free Lobby · Premium Rewards HQ · Affiliate Growth · Uncle Daniel · Viral Reaction · DDB Beauty/Fashion · Sponsor Campaigns). Locked/unlocked states. Click routes through `openBrowsePanel(whop_channel_id)`. |
| `desktop/src/components/BrowseRewardsPanel.tsx` | In-app Tauri webview that loads Whop chat feed URLs. The actual chat surface lives in Whop's web UI — desktop just hosts the iframe-equivalent. |
| `desktop/src/components/AchievementToast.tsx` | Toast for achievement unlocks; supports `top_100_leaderboard`. |
| `desktop/src/components/BadgeShelf.tsx` | Earned badge display. |

**Hooks / state**

- No custom `useCommunity*` / `useLeaderboard*` / `useFeed*` hooks.
- Community room cards read tier via `useTier()`.
- Achievements: `desktop/src/lib/achievements.ts` — localStorage-backed earned set + `EventTarget` bus that emits `unlocked` on `recordAchievement(id)`.

**Services / API**

| Function | Endpoint | Returns |
| --- | --- | --- |
| `desktop/src/lib/backend.ts:leaderboardGet()` | `GET /leaderboard/earnings` | Top 100 affiliates + caller_rank + caller_entry + refreshed_at + total_ranked. 6h cache. |
| `desktop/src/lib/backend.ts:rewardClips.list()` | `GET /me/reward-clips` | RewardClip + tracking-link rows. |
| `desktop/src/lib/backend.ts:rewardClips.create()` | `POST /me/reward-clips` | Mint reward clip + tracking link. |
| `desktop/src/lib/backend.ts:rewardClips.patch()` | `PATCH /me/reward-clips/{id}` | Bind Whop submission + update display metadata. |
| `desktop/src/lib/browse.ts:openBrowsePanel(url)` | n/a | Routes a community channel URL to the Tauri webview. |
| `desktop/src/lib/browse.ts:WHOP_COMMUNITY_URL` | constant | `https://whop.com/liquidclips/` — community landing. |

**Sidecar / IPC**

- `desktop/src/lib/sidecar.ts` — **no community RPC methods**. Community is Whop-backed, not sidecar-backed. Reward clips ride the backend HTTP layer, not the Python sidecar.

**Event channels**

- `desktop/src/lib/achievements.ts` — `unlocked` event on a private `EventTarget`. No central `community:*` / `feed:*` / `leaderboard:*` bus.

### 1.2 Backend (`/Users/dipdip/code/jnr/junior-backend/`)

**Public routes** — `app/routes/community.py` (134 LOC)

| Endpoint | Behaviour |
| --- | --- |
| `GET /community/channels?clerk_user_id=...` | Returns `{ channels: CommunityChannel[], viewer_tier }`. Derives `locked` per channel from `required_tier` + caller tier. Rows with `is_locked_preview_enabled=false` are hidden from locked viewers. |

**Admin routes** — `app/routes/admin.py`

| Endpoint | Behaviour |
| --- | --- |
| `GET /admin/community/channels` | Section + sort_order ordered. |
| `POST /admin/community/channels` | Create with `CommunityChannelPayload`. |
| `PATCH /admin/community/channels/{slug}` | Partial update. |
| `DELETE /admin/community/channels/{slug}` | Remove. |

**Leaderboard** — `app/routes/leaderboard.py` (146 LOC)

| Endpoint | Behaviour |
| --- | --- |
| `GET /leaderboard/earnings` | JWT-authed, desktop-only. Top 100 affiliate earners. Excludes admins + users with no cached `display_handle`. 6h refresh via cron. |

**Reward clips** — `app/routes/reward_clips.py` (281 LOC)

| Endpoint | Behaviour |
| --- | --- |
| `POST /me/reward-clips` | Create + mint tracking link. |
| `GET /me/reward-clips` | List for caller, `created_at desc`. |
| `PATCH /me/reward-clips/{rclip_id}` | Bind Whop submission id + status (draft \| generated \| submitted \| approved \| denied). |

**Models** — `app/models.py`

| Table | Key columns |
| --- | --- |
| `community_channels` | id · slug (uniq, idx) · name · purpose · whop_channel_id (nullable, `chat_feed_*` from Whop) · required_tier (free \| free_paid \| paid \| paid_admin) · business_unit (idx: liquid_clips \| uncle_daniel \| ddb_beauty \| ddb_fashion \| sponsors) · mission_lane (training \| main \| brand \| sponsor) · is_admin_only · is_locked_preview_enabled · section (idx: announcements \| free_lobby \| paid_core \| mission) · sort_order (idx) · created_at · updated_at |
| `reward_clips` | id (`rclip_*`) · owner_user_id (fk users, CASCADE) · whop_reward_id (idx) · whop_reward_title · clip_idx · platform · account_label · campaign_id (idx) · tracking_link_id (fk tracking_links, SET NULL) · whop_submission_id (idx) · status · created_at · updated_at |
| `users` (leaderboard cache) | cached_lifetime_earnings_usd · cached_paid_referrals · cached_display_handle · cached_earnings_at |
| `banners` | Includes `placement="community_top"` slot. |
| `announcements` | Admin posts surfaced in Announcements room + dashboard. `kind: mission_drop \| payout \| rule_change \| deadline \| other`. |

**Seed script**

- `junior-backend/scripts/seed_community_channels.py` — idempotent seed of 9 channels (announcements · free-clipper-lobby · premium-rewards-hq · affiliate-growth-room · uncle-daniel-clips · viral-reaction-missions · ddb-beauty-clips · ddb-fashion-clips · sponsor-campaigns). Runs on FastAPI lifespan startup. Per repo CLAUDE.md: pre-existing values pasted via Admin HQ (e.g. `whop_channel_id`) survive every redeploy.

### 1.3 Design OS port (`/Users/dipdip/code/jnr/desktop-2/`)

| Surface | Status |
| --- | --- |
| `src/design-os/routes/Community.tsx` | **SimPage stub**. world: `squad-lounge`, defaultKade: `community-mode`. Hard-coded key panel ("Squad rank #09 ▲4") + 3 micro-interactions. |
| `src/design-os/routing/routeRegistry.ts` | RouteSpec: world `squad-lounge`, kade `community-mode`, kadePlacement `center`. |
| `src/design-os/copy/copyMap.ts` | NAV_LABEL: "Community". HERO: eyebrow "Squad lounge" / h1 "Find your squad" / sub "Whop rooms, leaderboards, Uncle Daniel's drops. Kade waves the holograms in." STATES: empty/loading/success/warning/error. CTA: "Find your squad". |
| `src/fixtures/fakeCommunity.ts` | Phase-5B simulator fixtures: announcements · free-clipper-lobby · uncle-daniel-clips · viral-reaction-missions · premium-rewards-hq. Shape: `{ tier: "free"\|"paid", unread, href, slug, name }`. **Not** the backend `CommunityChannel` shape. |
| `src/state/browseOverlay.ts` | Zustand store. `openWith(url, intent)` opens the in-app browser overlay. Already mapped to `browse-campaign` intent — same surface campaigns use. |
| `src/sections/community/CommunitySection.tsx` | Phase-5B simulator section. Renders `fakeCommunity` grid; click → `useBrowseOverlay().openWith(href, "browse-campaign")`. **Demonstrates the click-into-overlay handoff but uses fixtures, not the backend.** |
| `src/design-os/state/useChannels.ts` | Unrelated — this is the **social-publishing channels** hook from Phase 6I (TikTok/IG/etc accounts). Different domain from Community channels. Don't confuse the namespaces. |

---

## 2 · Workflow map

```
   ┌──────────────────────────────────────────────────────────────┐
   │  Community route (legacy: CommunityTab · DOS: Community.tsx) │
   └────────────────────────┬─────────────────────────────────────┘
                            │
                            │  list channels
                            ▼
        GET /community/channels?clerk_user_id=...
                            │
                            ▼
          ┌─────────────────────────────────┐
          │ for each row in {channels}      │
          │   render Room Card              │
          │     · name · purpose · section  │
          │     · required_tier (gate)      │
          │     · whop_channel_id (target)  │
          │     · is_locked_preview_enabled │
          └─────────────────┬───────────────┘
                            │
                            │  click connected card
                            ▼
            openBrowsePanel(whop_channel_id)
        (legacy: Tauri webview · DOS: browseOverlay)
                            │
                            ▼
                Whop chat feed renders inside the app
                   (likes / comments / reactions
                    are all owned by Whop, not Junior)

   ┌──────────────────────────────────────────────────────────────┐
   │  Leaderboard (legacy: invoked from Earn · no Community UI)   │
   └────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
              GET /leaderboard/earnings (JWT)
                            │
                            ▼
        Top 100 affiliate earners + caller_rank + caller_entry
        (cache refresh: 6h cron · `users.cached_*` columns)
                            │
                            ▼
        Achievement: `top_100_leaderboard` records on the bus

   ┌──────────────────────────────────────────────────────────────┐
   │  Reward Clips (live)                                         │
   └────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
        Whop bounty appears → user picks clip + platform + account
                            │
                            ▼
              POST /me/reward-clips  (mint tracking link)
                            │
                            ▼
            User posts the clip on the target platform
                            │
                            ▼
        PATCH /me/reward-clips/{id}  (bind whop_submission_id)
                            │
                            ▼
       Tracking link records clicks → payout flows through Whop
```

**What this implies for Phase 6L:**
- The drawer surfaces (room detail, profile, reactions) **belong to Whop** — we don't own them. We own the launcher.
- The leaderboard is a single read endpoint + a cached column on `users`. Trivial to surface.
- Reward Clips are a richer flow but already exist. Port the legacy form, don't redesign the contract.
- "Wall of Clippers" doesn't exist in the legacy app or backend. **It's a new ask** — flag it as Phase 6L scope decision, not port work.
- "Achievements" exists only as a localStorage badge set. No backend persistence. Treat as cosmetic until backend lands.

---

## 3 · Lego brick map

Move-unchanged column reflects "can the code move into Design OS as-is" — most legacy components are tightly coupled to legacy shell classes (`lc-hud-*`, `RoomShell`, atmosphere props). Logic survives; chrome doesn't.

| Feature | Existing file | Dependencies | Move unchanged? | Wrapper needed? | DOS mount slot | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| Channel list fetch | `backend.ts:leaderboardGet` adjacent / new `backend.ts:communityChannels()` (not present — see §5) | `fetch` + `BACKEND_URL` + JWT helper | No (not yet authored) | — | `engine/sidecar-stub.ts` shim → `state/useCommunity.ts` hook | Low |
| Channel render | `CommunityTab.tsx` (478 LOC) | tier hook, `openBrowsePanel`, tier copy, legacy shell CSS | No — chrome is legacy | Yes — rewrite as DOS `<RoomCard>` reading new hook | `routes/Community.tsx` body | Medium (UX parity work) |
| Whop browse handoff | `lib/browse.ts:openBrowsePanel` (legacy) · `state/browseOverlay.ts` (DOS) | Tauri webview | DOS overlay already exists | No | Already wired | Low |
| Locked / preview state | `CommunityTab.tsx` + backend `is_locked_preview_enabled` | tier | No (chrome rewrite) | Yes — DOS LockedCard | Inside `<RoomCard>` | Low |
| Announcements rail | Inferred from `announcements` table + Announcements channel | Backend endpoint TBD (audit could not confirm a public `/announcements` GET) | No | Yes — needs new hook + UI | Top of Community route OR Home cockpit | Medium |
| Leaderboard | `backend.ts:leaderboardGet` + `previewLeaderboard()` fallback | JWT, cached columns | Yes (data layer) / No (UI) | Yes — wrap into DOS `<LeaderboardTable>` | New tab/section in Community route | Low |
| Reward Clips list | `backend.ts:rewardClips.list/create/patch` | JWT, Whop submission ids | Yes (data layer) / No (UI) | Yes — DOS Drawer for create + patch | Community route Rewards section OR dedicated Rewards drawer | Medium |
| Achievement badges | `lib/achievements.ts` + `AchievementToast.tsx` + `BadgeShelf.tsx` | localStorage, EventTarget | Logic yes, UI no | Yes — DOS ToastHost + Drawer | ToastHost (already used by `bus.emit("toast", …)`) + Settings/Profile drawer | Low |
| Wall of Clippers | **Does not exist** | — | n/a | n/a | New work, Phase 6L scope | High (new ask) |
| Squad/activity feed | **Does not exist** in backend | Whop owns chat feed | n/a | n/a | Whop overlay (already) | n/a |
| Reactions / likes / comments | **Owned by Whop** inside the chat feed | Whop iframe | n/a | n/a | n/a | n/a |
| Notifications | localStorage achievement toasts only | — | Yes | Use existing DOS `bus.emit("toast", …)` | ToastHost | Low |
| Banner placement `community_top` | `banners` table + admin endpoints | Banner API | Yes (backend already shaped) | DOS GlassCard banner | Hero row on Community route | Low |

---

## 4 · Design OS plug-point map

The Design OS primitives the Community port already has at its disposal:

| DOS primitive | Where it fits |
| --- | --- |
| **Route shell** (`DesignOSAppShell world="squad-lounge"`) | `routes/Community.tsx` — already wired via `ROUTE_REGISTRY["community"]`. |
| **Kade state** (`useKadeFromSession("community")`) | Drives default Kade pose (`community-mode`) + transitions on success/error. |
| **GlassCard** | Room cards · leaderboard rows · reward clip cards · banner slot · empty state. |
| **MetricBoard** | Leaderboard stat strip (your rank · this week · earnings total) + per-room unread totals if surfaced. |
| **AccountChipState** | Optional inside Reward Clip cards to render the target social account (we already have `chip` variant). Reuse — do not invent a new chip. |
| **Drawer** (right-side, portal-to-body) | Reward Clip create / patch · Achievement badge shelf · Channel detail (only if not deferred to Whop overlay). |
| **ModalPortal** | Hosts the drawers; `AddAccountPopover` precedent. |
| **EngineErrorBoundary route="community" component="<Name>"** | Wrap every section — pattern matches Channels / Schedule routes. |
| **ToastHost** (`bus.emit("toast", …)`) | Achievement unlocks · reward clip status changes · "rank up" / "rank down" notices. |
| **BakeErrorStrip** | Existing primitive — picks up `kind: "publish"` / `kind: "reward"` errors automatically. |
| **browseOverlay** (`useBrowseOverlay().openWith`) | Click a connected room → opens Whop chat feed inside the existing overlay. **This is the single most important reused brick.** |
| **PlanLimitStrip** equivalent | Not needed for Community per se — but the locked-tier card pattern from Channels (`is-locked` state) is the right look. |

What's **not** a fit and should be flagged:
- No DOS `Tab` primitive yet. The legacy CommunityTab uses inline pill-tabs (section: Announcements / Free Lobby / Paid Core / Mission). Either build a minimal `<SectionTabs>` in the route, or render sections as vertical columns. Recommend vertical for Phase 6L.
- No DOS `LeaderboardTable` primitive. Reuse GlassCard rows + AccountChipState avatars; do not invent a new table component.

---

## 5 · Data + runtime truth

| Surface | Data source | Real / mock / Whop-dependent | Read-only-first ready? |
| --- | --- | --- | --- |
| Channel list | `GET /community/channels` | **Real backend** (seeded, live) | **Yes** |
| Channel chat feed | Whop chat_feed_* via in-app browser | **Whop-dependent** | **Yes** (overlay already works) |
| Locked / preview gating | Backend computed (`required_tier` + caller tier) | **Real** | Yes |
| Banner (community_top) | `GET /banners?placement=community_top` (verify endpoint name in `routes/banners.py`) | **Real** | Yes |
| Announcements | `announcements` table | **Real** (admin-authored) | Yes (read) |
| Leaderboard | `GET /leaderboard/earnings` | **Real** (6h cache via `users.cached_*`) | Yes |
| Reward Clips | `/me/reward-clips` GET/POST/PATCH + Whop submission ids | **Real** but **Whop-dependent** for submission lifecycle | Read-only first; defer create/patch to 6L step 5 |
| Achievement badges | localStorage only | **Mock** | Yes (cosmetic) |
| Wall of Clippers | **No backend** | Does not exist | **No** — needs backend + Phase 6L scope decision |
| Squad / activity feed | **No backend** | Whop owns the chat-feed analog | Likely never (defer to Whop) |
| Reactions / likes / comments | **Owned by Whop** | Whop chat | Don't build |
| Notifications | localStorage + EventTarget | **Mock** | Replace with bus toasts |

**Campaign-dependent surfaces:** Reward Clips reference `campaign_id` (nullable string). The Campaigns route is **not** built yet in DOS. Reward Clips can ship without Campaigns — the field is optional and the existing legacy form treats it as a passthrough string.

**Whop-dependent surfaces:** every chat / reaction / comment. Phase 6L should *not* try to build a native chat — keep the overlay handoff intact.

---

## 6 · Missing pieces

### Already works (port faithfully)
- Channel list endpoint + 9 seeded channels.
- Tier-gating logic on the backend.
- Whop chat handoff via overlay.
- Leaderboard backend + cache.
- Reward Clips CRUD.
- Banner / announcement tables.

### Broken / partial
- **No frontend hook for `/community/channels`** exists in either codebase. Legacy CommunityTab is reading from somewhere else — verify whether it currently hits the real endpoint or is still on legacy fixtures (audit could not confirm 100% from this pass; spot-check before 6L step 2).
- **No frontend hook for `/leaderboard/earnings`** exists outside of `backend.ts:leaderboardGet` itself. Legacy app calls it from the Earn surface; Community surface never displays it.
- **`announcements` table has no public endpoint** confirmed in this audit. Either it's gated through admin only, or it's surfaced via a different route. Verify `junior-backend/app/routes/` for a public announcements GET before Phase 6L step 1.
- **No `useFakeCommunity → real CommunityChannel` shape adapter**. The DOS simulator fixture shape (`{ tier, unread, href, slug, name }`) does NOT match the backend shape (`{ id, slug, name, purpose, whop_channel_id, required_tier, business_unit, mission_lane, is_admin_only, is_locked_preview_enabled, section, sort_order }`). Shape adapter is small but required.

### Must be rebuilt
- The chrome: every legacy `lc-hud-*` card and `RoomShell` wrap. New DOS components reading from the new hook.

### Should be redesigned
- **Tier-locked card affordance**. Legacy CommunityTab uses inline lock pills + greyed body. Aim for the Channels tile-locked pattern instead — `AccountChipState` precedent shows the visual idiom DOS settles on.

### Can defer
- Reward Clips **create/patch** flow — port the read-only list first, gate Whop-binding flow behind a 6L sub-step.
- Achievement badge shelf — cosmetic; toast on unlock is enough for first ship.
- Wall of Clippers — flag as scope decision before any work. **Not present in legacy.**

---

## 7 · Phase 6L build order (easiest → hardest)

1. **`useCommunity` hook** (`src/design-os/state/useCommunity.ts`)
   - Shim into `engine/sidecar-stub.ts` (`community.listChannels({ clerkUserId })` → real-Tauri-first / `fetch(BACKEND_URL + '/community/channels')` mock fallback).
   - Return shape: `{ channels, viewerTier, loading, error, reload }` + grouped views (`bySection`, `byMissionLane`, `lockedCount`, `unreadCount` if we can carry that — the backend does not currently expose unread; carry zero until it does).
   - Reuse the `useChannels()` template wholesale.
   - **Risk: low.** **Size: ~150 LOC.**

2. **`<CommunityRoute>` shell + RoomGrid (read-only)**
   - Replace SimPage stub with `DesignOSAppShell world="squad-lounge"`.
   - Hero (reuse `ROUTE_HERO.community` already in `copyMap.ts`).
   - `<RoomGrid>` → groups by `section` (announcements · free_lobby · paid_core · mission) → `<RoomCard>` per row.
   - `<RoomCard>` reads `(channel, locked)` and renders the locked/unlocked variant.
   - Click connected room → `bus.emit("browse:open", { url: whopChannelUrl })` → reuse `useBrowseOverlay().openWith` OR the new DOS browser overlay if one was added since.
   - Every section wrapped in `EngineErrorBoundary route="community" component="<Name>"`.
   - **Risk: low–medium** (UX polish parity work). **Size: ~400 LOC + CSS.**

3. **Banner + Announcements rail**
   - Top of Community route: GlassCard banner (`placement="community_top"`) + announcement list (latest 3, `kind`-coloured dot).
   - If no public `/announcements` endpoint exists, gate behind a one-line backend ticket and ship 6L without it (do not block).
   - **Risk: low.** **Size: ~120 LOC.**

4. **Profile / channel-detail Drawer**
   - Optional — only if we want a native preview before the Whop overlay opens. The brief lists "profile/detail drawer" as next-after-read-only.
   - Drawer body: room name · purpose · tier badge · business_unit + mission_lane chips · "Open in browser" CTA.
   - For Phase 6L this could *just* be a richer card hover state — defer the drawer if time-constrained.
   - **Risk: low.** **Size: ~200 LOC.**

5. **`<LeaderboardSection>`**
   - New section beneath the rooms (or behind a tab).
   - `useLeaderboard()` hook → `leaderboardGet()` (already exists in `desktop/src/lib/backend.ts`; port the function).
   - GlassCard rows. Caller row pinned even when outside top 100 (using `caller_entry`). Refresh time shown in a `lc-runtime-tag`-style pill.
   - On rank-up event vs cached previous, fire `bus.emit("toast", { kind: "success", title: "Ranked up!" })` and `recordAchievement("top_100_leaderboard")` if first time in top 100.
   - **Risk: low.** **Size: ~250 LOC + CSS.**

6. **Wall of Clippers (scope decision before any code)**
   - Backend does not exist. Either:
     - (a) Defer entirely and remove from 6L brief.
     - (b) Build as a frontend-only roll-up of the leaderboard data (no new backend) — visually distinct grid of avatars + handles + rank chips.
     - (c) Spec a new backend endpoint (out of 6L scope).
   - Recommendation: (a) for 6L, revisit when Profile pages exist.
   - **Risk: high (new product surface).**

7. **Rewards / campaign integration (port-then-extend)**
   - Phase 6L-Late step.
   - `useRewardClips()` hook → `backend.ts:rewardClips.*`. Read-only list inside Community first.
   - Create/patch flow → DOS Drawer reusing `ScheduleFromExportDrawer` chrome patterns (target chip + datetime input + status select).
   - Campaign linkage is a passthrough field; do not build Campaign UI here.
   - **Risk: medium.** **Size: ~500 LOC + CSS.**

---

## Closing notes

- Resist the urge to reinvent Whop. Every reaction / comment / like belongs to Whop. We own the door, not the room.
- `useChannels` (social publishing channels) and the new `useCommunity` (Whop chat channels) are separate namespaces. Keep them apart in imports and docs — they will collide otherwise.
- The legacy `CommunityTab.tsx` (478 LOC) is the single richest source of business logic. Read it line-by-line before writing any DOS replacement; do not re-derive tier rules from the brief.
- The seed script + admin endpoints are stable. Daniel's pasted `whop_channel_id` values survive every deploy. **Do not regenerate or migrate the slug list** — it's intentional state.
- This audit found **no Phase 6L blockers** beyond confirming the public `/announcements` endpoint situation. Ship 6L on the assumption it must be added; degrade gracefully if not.
