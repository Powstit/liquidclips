# Chat Scope & Upgrade Path — 2026-07-08

Read-only scope. No code was edited. All backend line citations reference the
`main` branch as it sits in `/Users/dipdip/code/jnr` today.

---

## 1. Current wire state — what's in the code TODAY

Liquid Clips has **two chat surfaces in parallel** in the same codebase:

**A. Native chat** (`chat.py`) — the *actually-live* one. Custom REST + polling,
own persistence, own moderation. Built for the "global" and "agency-vip" rooms
the desktop app uses today.

**B. Whop-backed community channels** (`community.py` + `channels.py` admin CRUD
via `admin.py`) — a *directory* of tier-gated room cards, each with an optional
`whop_channel_id`. When a card is clicked, the paid user is either routed to
Whop chat (if `whop_channel_id` is set) or to the community landing (if null).
Whop chat itself is not natively rendered; it's a routing table.

These two surfaces do NOT talk to each other. That is the source of most of the
confusion below.

### Frontend UI components

| Surface | File | Role |
|---|---|---|
| Floating chat overlay | `desktop-2/src/design-os/components/ChatPanel.tsx:1-80` | Bottom-right slide-in. Header + channel tabs (global · agency-vip) + message list + composer + emoji/Pexels/Giphy tray. Pure React, no iframe. |
| Overlay toggle button | `desktop-2/src/design-os/components/ChatToggle.tsx:14-33` | Mounts `<ChatPanel>`. Mounted by `AppShell.tsx:146` (`{!hideStickyKade && <ChatToggle />}`). |
| Full-page Community route | `desktop-2/src/design-os/community/CommunityChatHome.tsx:85` | The `#/community` route. Reuses `MessageRow` + `MediaTray` from ChatPanel. Renders a static hard-coded `ROOMS` array (see below). |
| Route mount | `desktop-2/src/design-os/routes/Community.tsx:62` | Wraps `CommunityChatHome` in `EngineErrorBoundary`. |
| Room detail drawer | `desktop-2/src/design-os/community/RoomDetailDrawer.tsx` | Preview drawer for a tier-locked room (unverified whether it's currently rendered). |
| Client library | `desktop-2/src/lib/chat.ts:113-178` | REST client for `/chat/*`. `useChatChannel` hook polls `/chat/messages` every **10 s** (`chat.ts:384`). No WebSocket, no SSE. |
| Moderation client | `desktop-2/src/lib/chatModeration.ts` | REST wrappers for hide / warn / mute24h. |
| Community directory hook | `desktop-2/src/design-os/state/useCommunity.ts:8` | Calls `/community/channels` — the tier-gated card list. |
| Admin HQ tab | `account-app/src/components/admin/AdminHQ.tsx:2575-2830` | `CommunityChannelsTab` — CRUD for `community_channels` rows (slug, name, purpose, whop_channel_id, tier, section, sort). |
| Admin chat-role setter | `account-app/src/components/admin/HQCommandTabs.tsx:397, 602` | Sets a user's `chat_role` (mod / member) via `mutationsApi`. |

**Hard-coded room mismatch (⚠️):** `CommunityChatHome.tsx:36-67` ships a 5-room
list — `global`, `clippers-lounge`, `campaign-drops`, `fan-boost`, `agency-vip`.
Three of those (`clippers-lounge`, `campaign-drops`, `fan-boost`) carry
`pendingContract: "server rollout pending"` messages. The backend seed script
seeds **9 different rooms** (see §Seed). The two lists were never
reconciled — the full-page community route shows placeholder rooms while
the admin HQ manages a completely different set.

### Backend endpoints

Native chat (`junior-backend/app/routes/chat.py`, prefix `/chat`):

| Route | Line | Purpose |
|---|---|---|
| `GET /chat/messages` | `chat.py:318` | List messages in `global` or `agency-vip`. Keyset pagination by `before_id`. LEFT JOIN arcade high-score. |
| `POST /chat/message` | `chat.py:399` | Post to channel. Enforces `_can_access` gate + `chat_muted_until` gate (`chat.py:421`) + optional pin → Announcement bridge (`chat.py:450-469`). |
| `DELETE /chat/message/{id}/pin` | `chat.py:480` | Unpin. Deactivates linked Announcement row. |
| `GET /chat/media/giphy`, `GET /chat/media/pexels` | `chat.py:520, 557` | Server-side media search proxy so API keys stay off the desktop. Returns 503 with `*_setup_required` when key missing. |
| `POST /chat/game/score` | `chat.py:616` | Arcade high-score ratchet + anti-cheat gate. |
| `POST /chat/game/share` | `chat.py:689` | System-bot post to `global` celebrating a score. |
| `GET /chat/game/leaderboard` | `chat.py:727` | Top-N arcade scorers. |

Moderation (`junior-backend/app/routes/moderation.py`, prefix `/chat`):

| Route | Purpose |
|---|---|
| `POST /chat/messages/{id}/hide` | Server-side content scrub — sets `hidden_at`, `_serialise` returns `[removed by moderator]` (`chat.py:224-244`). |
| `POST /chat/messages/{id}/warn` | Audit log row against author. Notification insert deferred. |
| `POST /chat/messages/{id}/mute24h` | Sets `User.chat_muted_until = utcnow() + 24h`. Chat-scoped only — does NOT bleed into publish/earn/license gates. |

Community directory (`junior-backend/app/routes/community.py`):

| Route | Purpose |
|---|---|
| `GET /community/channels` | Tier-gated card list. Derives `locked` per caller (`community.py:100-135`). |

Admin CRUD for the community directory lives in `admin.py` (PATCH/POST/DELETE
`community/channels/{slug}`, called from AdminHQ `CommunityChannelsTab`).

### Data model

`junior-backend/app/models.py`:

- `ChatMessage` (`models.py:2135-2184`) — native message row. Fields: id · user_id
  (`"system-bot"` reserved) · username · avatar_url · channel · content · role ·
  pinned · announcement_id · created_at · hidden_at + hidden_by_user_id +
  hide_reason. No FK on user_id — a system-bot row survives user delete.
- `CommunityChannel` (`models.py:947-994`) — the *directory* row. slug + name +
  purpose + whop_channel_id + required_tier + business_unit + mission_lane +
  section + sort_order. This drives the admin HQ table, not native chat.
- `Announcement` (`models.py:1033-1064`) — pinned chat messages write a sibling
  row here so the banner stack picks it up.
- `User` chat-related columns (`models.py:164-173`) — `chat_muted_until`,
  `chat_role` ("member" | "mod" | ...). `chat_role="mod"` grants pin / hide /
  warn / mute powers via `_can_pin` (`chat.py:96-103`).

### Transport

**Polling. No WebSocket. No SSE.** `useChatChannel` calls `fetchChatHistory` on
mount and then on a `window.setInterval` of **10 000 ms**
(`desktop-2/src/lib/chat.ts:384, 514`). Confirmed absent: `grep -rn "WebSocket|
EventSource|StreamingResponse" junior-backend/app/routes/chat.py
community.py channels.py moderation.py` → 0 matches.

### Auth

License JWT. `Depends(current_user)` on every `/chat/*` route resolves the User
row from the JWT bearer token (see backend `CLAUDE.md` — Ed25519 30-day JWT
minted by `/desktop/connect`, auto-rotated in `/sync` when ≤5 days left). Role
badges are derived at INSERT time (`chat.py:70-80`) so tier changes don't
retroactively relabel history. `agency-vip` channel additionally requires
`user.whop_user_id` to be present (`chat.py:83-93`) — that's the tier gate.

### Admin HQ tab

The `Community Channels` tab (`AdminHQ.tsx:2575`) manages the **directory**
(`community_channels` table), not native chat rows. Columns: slug · name ·
whop_channel_id · required_tier · section · sort_order. It does NOT expose
native chat message moderation or a Whop-chat mirror — moderation is done
inline in the desktop chat panel via `chatModeration.ts`.

### Seed script

`junior-backend/scripts/seed_community_channels.py`:
- **9 channels seeded** by slug (upsert, safe to re-run):
  `announcements` · `free-clipper-lobby` · `premium-rewards-hq` ·
  `affiliate-growth-room` · `uncle-daniel-clips` · `viral-reaction-missions` ·
  `ddb-beauty-clips` · `ddb-fashion-clips` · `sponsor-campaigns`.
- Runs **automatically on backend lifespan startup** since `d849b69` (repo root
  `CLAUDE.md` — "Seed semantics"). Pre-set `whop_channel_id` survives re-run.
- These seeds populate the *directory* — they have **no relationship** to the
  two native channels (`global`, `agency-vip`) that the ChatPanel + native REST
  API actually serve.

---

## 2. Does it work end-to-end? (state audit)

Verdicts based on code-only inspection. No live smoke was run.

| Stage | Verdict | Evidence |
|---|---|---|
| User sees floating chat surface | ✅ | `AppShell.tsx:146` mounts `ChatToggle` (gated on `!hideStickyKade`). |
| User sees `#/community` full page | ✅ | `Community.tsx:62` mounts `CommunityChatHome`. |
| User sees room list — **ChatPanel** | ⚠️ | Only 2 rooms (global · agency-vip) hard-coded in the tab picker. Doesn't read the 9-seed directory. |
| User sees room list — **CommunityChatHome** | ❌ | Hard-coded 5-room `ROOMS` array (`CommunityChatHome.tsx:36-67`); 3 rooms carry `"server rollout pending"` placeholders and 0 rooms come from the 9-item backend seed. Admin HQ manages one dataset, the UI ships a different one. |
| User sees room list — **community directory cards** | ✅ | `useCommunity.ts` calls `/community/channels` which returns the 9 seeds with per-caller `locked`. Where those cards are rendered is unverified — grep the design-os pages for `useCommunity` usage. |
| User enters a room | ✅ (global/agency-vip only) | `sendChatMessageDetailed` (`chat.ts`) → `POST /chat/message`. |
| User sends a message | ✅ | `chat.py:399` inserts row, commits, returns 201. |
| Other users receive in real-time | ⚠️ | 10 s polling delay (`chat.ts:384`). Not "real-time" but functional at low volume. Concurrent-user cost: N clients × 6 polls/min against `/chat/messages` — fine for <100, straining at 1000. |
| Messages persist across restarts | ✅ | `ChatMessage` table, keyset-paginated history via `before_id` (`chat.py:352-378`). |
| Admin can moderate | ✅ | `moderation.py` — hide / warn / mute24h. Server-side content scrub confirmed at `chat.py:224-244`. `chat_muted_until` gate confirmed at `chat.py:421`. |
| New signup auto-joins default room | ✅ | `_seed_welcome_bot_message` (`chat.py:261-304`) fires on first `/sync`; system-bot row lands in `global` before the desktop's first `/chat/messages` poll. |
| Whop-backed rooms actually chat | ❓ | `whop_channel_id` is stored on `community_channels` but no code in this repo renders a Whop chat iframe. The routing rule ("paid users routed to Whop chat") is admin-tab hint text only (`AdminHQ.tsx:2683`). Whether the desktop opens Whop chat in the persistent-webview or does nothing when the user clicks a `whop_channel_id`-populated card is **unverified**. |
| `CommunityChatHome` full-page 3 pending rooms | ❌ | Explicit `pendingContract: "server rollout pending"` strings ship to users (`CommunityChatHome.tsx:47, 53, 59`). |

**Net:** native chat (`global` + `agency-vip`) is fully wired end-to-end.
The Whop-backed community directory is half-wired — admin CRUD works, seed
runs on boot, but the desktop full-page community route ships a stale
hard-coded room list that ignores the seed and shows 3 "coming soon"
placeholders to real users.

---

## 3. GitHub upgrade options

| Repo | Stars | Last commit | License | Notes |
|---|---|---|---|---|
| `RocketChat/EmbeddedChat` | 156 | 2026-07-01 | none declared | React component. Requires self-hosted Rocket.Chat server. Last tagged release `v0.0.2` (Jan 2023) — actively pushed but **no versioned release in 3+ years**. |
| `widgetbot-io/react-embed` | 17 | 2026-05-27 | AGPL-3.0 | Thin React iframe wrapper for the WidgetBot Discord widget. |
| `widgetbot-io/crate` | 72 | 2026-05-27 | AGPL-3.0 | Popup Discord widget. Free hosted service (widgetbot.io). |
| `element-hq/element-web` | 13 265 | 2026-07-08 | AGPL-3.0 | Full Matrix client. Heavy to embed — meant to run as its own app. |
| `zulip/zulip` | 25 462 | 2026-07-07 | Apache-2.0 | Full server + web app. Not embeddable in a Tauri React shell. |
| `mattermost/mattermost` | 38 354 | 2026-07-08 | MIT-adjacent | Full-stack collaboration platform. Same story as Zulip. |

**Tauri sandbox reality-check per option:**

- **Rocket.Chat EmbeddedChat** — React component, drops into desktop-2 as a
  child. Requires CORS enabled on the RC server + auth token exchange. Fits
  Tauri fine (no iframe / no cross-origin cookie games). But: no versioned
  release since v0.0.2 (2023), 156 stars, active but immature. Effort to embed:
  **10–20 h** (build packages, wire Clerk → RC user provisioning, style match).
  On-going: **$0** on Hetzner CX11 (self-host) or **$25/mo** on RC Cloud
  Starter. Users still leave the app in-thought if you use RC's default OAuth;
  you'd need SSO via Clerk-JWT-to-RC-token bridge.
- **WidgetBot / Discord** — iframe pointed at a Discord server. Users need a
  Discord account and must sign in inside the iframe. That **violates the
  "never leave the app" rule** from `~/.claude/memory/liquid_clips_browse_rewards.md`
  — read-only anon works, posting requires a full Discord auth loop.
- **Element (Matrix)** — self-host Synapse + Element. 2–3 day setup + moderation
  tooling. Overkill for <20 → 1000 users. Skip.
- **Zulip / Mattermost** — full servers. Skip. Same reason.

**Not evaluated but worth mentioning:** Stream Chat SDK (react-native-stream-chat)
is the "Cal.com-tier" hosted-chat option — polished React components, WebSocket
transport, threads, reactions, moderation. Free tier ≤ 25 MAU, then usage-based.
Zero self-host. Would need to be added to the list Daniel asked to research.

---

## 4. Three concrete paths

### Path 1 — Fix native chat (finish what's on disk)

What's actually broken:
1. `CommunityChatHome.tsx:36-67` — replace the hard-coded 5-room `ROOMS` array
   with a fetch off `/community/channels` (already wired via `useCommunity.ts`).
   Delete the 3 "server rollout pending" placeholders. **~3 h.**
2. Decide fate of `clippers-lounge` / `campaign-drops` / `fan-boost` — either
   add them to `ALLOWED_CHANNELS` in `chat.py:57` (widen native chat from 2
   channels to N) or drop them. **~4 h if widening — data model already
   supports arbitrary channel strings.**
3. Add WebSocket or SSE if concurrent-user projections exceed ~200. FastAPI
   supports WS natively; would take **~8 h** to migrate ChatPanel from polling.
   Not urgent at Daniel's current scale.
4. Verify the Whop-directory routing story: when a card has `whop_channel_id`
   set, does the desktop open the persistent-cookie webview at the Whop chat
   URL? Grep `whop_channel_id` in `desktop-2/src/` to confirm. **Unverified.
   ~1 h scope.**

**Total: 8–16 h.** Ongoing cost: **$0**. Risk: low — data model + REST + auth
+ moderation are all live and paid for.

### Path 2 — Rocket.Chat EmbeddedChat

Steps:
1. Provision Hetzner CX22 (~$5/mo) or Railway container, run Rocket.Chat.
2. Point DNS `chat.liquidclips.app`.
3. Configure Clerk-JWT → Rocket.Chat SSO (custom OAuth server).
4. Build EmbeddedChat packages, drop `<EmbeddedChat host="…" auth={…} />`
   into a new route.
5. Migrate the 9 seeded channels into Rocket.Chat rooms.
6. Retire `/chat/*` routes + `chat_messages` table (or freeze as archive).

**Total: 30–50 h. Ongoing: $5–25/mo.** Gains: real-time (WS built-in), threads,
reactions, file uploads, mobile app if needed. Losses: the arcade-score badge
bridge, the pin→Announcement bridge, the `chat_muted_until` cross-surface gate
— all of those would need custom RC plugins.

### Path 3 — Discord + WidgetBot

Steps:
1. Create Discord server + role structure.
2. Drop `<WidgetBot server="…" channel="…" />` iframe into ChatPanel.
3. Give up native moderation, JWT gating, and the arcade bridge.

**Total: 4–6 h. Ongoing: $0.** But: users **must sign into Discord** to post.
Read-only anon works. **This violates the "never leave the app" rule.** Only
viable as a *read-only community broadcast* surface where clippers just see
announcements — not as their chat home.

---

## 5. Recommendation

**Path 1 — finish native chat.** Daniel is a solo founder with <20 users today.
The end-to-end pipeline is already wired: JWT auth · persistence · moderation ·
pin→announcement bridge · arcade leaderboard · welcome-bot · admin HQ CRUD.
The only real gap is that `CommunityChatHome.tsx` ships a hard-coded room
list that ignores the 9-seed directory and surfaces 3 "coming soon"
placeholders — a **3-hour fetch-swap fixes the customer-facing embarrassment**,
and a **~4-hour ALLOWED_CHANNELS widening** lets any seeded room become a
native chat room. That's a half-day of solo work versus 30–50 h for
Rocket.Chat with negligible user-visible upside at this scale. WebSockets can
be added later when concurrent-user telemetry proves polling is straining the
Railway box; the current 10 s cadence handles the target 100-user month
comfortably. Path 2 is the right migration when Liquid Clips crosses ~500
concurrent active clippers; Path 3 breaks the sacred "never leave the app"
rule and should be dropped.

---

## 6. Handoff-ready spec (5-bullet execution plan per path)

### Path 1 (recommended)

- **[P1-1]** Read `desktop-2/src/design-os/community/CommunityChatHome.tsx:36-67`.
  Replace the hard-coded `ROOMS` array with a `useCommunity().channels` fetch;
  filter to non-locked rows for the viewer.
- **[P1-2]** Widen `ALLOWED_CHANNELS` in `junior-backend/app/routes/chat.py:57`
  from `{"global", "agency-vip"}` to include every seeded slug from
  `seed_community_channels.py`. Update `ChannelLit` literal type. Update
  `_can_access` to derive gating from the CommunityChannel `required_tier`
  column instead of hard-coded strings.
- **[P1-3]** Grep `whop_channel_id` across `desktop-2/src/`. Confirm whether
  clicking a card with a set `whop_channel_id` opens the persistent-cookie
  webview OR does nothing. If nothing: wire it via the existing
  `openInApp`/browse.rs webview per `~/.claude/memory/liquidclips_publish_walkaround.md`.
- **[P1-4]** Run the lens gate (ship-lens · user-journey-lens) against the
  Community route with 3 tier fixtures (free / paid / agency) to prove the
  card list renders truthfully off the seed and the ChatPanel opens each
  channel.
- **[P1-5]** Ship after Daniel green-lights per `feedback_no_push_until_confirmed`.
  No WebSocket work in this sprint.

### Path 2 (defer until >500 concurrent clippers)

- Provision Rocket.Chat on Railway with Postgres + Mongo persistence.
- Point `chat.liquidclips.app` at it; enable CORS.
- Build EmbeddedChat packages; write Clerk-JWT ↔ RC SSO bridge as a small
  FastAPI adapter route.
- Wire `<EmbeddedChat>` in a new `desktop-2` route behind a feature flag.
- Cut over one room at a time; freeze `chat_messages` inserts once green.

### Path 3 (not recommended)

- Only pursue if scoping a **read-only community broadcast** surface.
- Create Discord server + one public channel.
- Drop `<Widget server=… channel=…>` (WidgetBot React) into an announcements
  sub-route, NOT into ChatPanel.
- Explicitly document that clippers can read but not post from inside the app.
- Do not retire native chat.

---

## Summary

- Native `/chat/*` REST + polling stack is fully wired end-to-end for the 2
  hard-coded channels (`global`, `agency-vip`) — auth, persistence, moderation,
  pin bridge, welcome-bot, arcade leaderboard all live.
- The 9-seed community directory drives the admin HQ table but the desktop
  full-page `CommunityChatHome` ignores it, ships a stale 5-room hard-coded
  list, and surfaces 3 "server rollout pending" strings to users.
- Transport is 10 s polling — not real-time but adequate to ~200 users; no
  WebSocket, no SSE.
- **Recommendation: Path 1 (finish native chat).** Half-day of work removes the
  visible embarrassment and unlocks all 9 seeded rooms as native channels.
- Rocket.Chat swap is the right ~50 h move once >500 concurrent clippers are
  online. Discord/WidgetBot swap breaks the "never leave the app" rule and
  should be dropped from consideration.

File: `/Users/dipdip/code/jnr/CHAT_SCOPE_AND_UPGRADE_PATH_2026-07-08.md`
