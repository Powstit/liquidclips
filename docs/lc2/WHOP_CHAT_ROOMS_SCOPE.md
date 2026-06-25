# Whop Chat Rooms — Liquid Clips desktop-2 Scope

Decision doc for wiring Whop chat into the desktop-2 `Community` route.

## 1. Product Surface

Whop chat exposes four distinct conversation types, all under one Chat product (`docs.whop.com/developer/guides/chat`):

| Surface | What it is | ID prefix |
|---|---|---|
| **Experience / Channel Chat** | Shared room attached to a Whop *experience* (a product/community space). Public to all members, moderation + read-only switches. | `chat_feed_…` |
| **DM (Direct Message)** | 1:1 or small group thread (up to 50 members) between users. Shows in user's DM list. | `feed_…` |
| **Group Chat** | Same primitive as DM, just multi-user. No separate channel type. | `feed_…` |
| **Support Chat** | 1:1 customer ↔ company thread with open/resolved workflow + team-inbox visibility. Returns existing thread if one exists. | `feed_…` |

There is **no "campaign-thread"** or **per-product sub-channel** primitive — everything is either an experience-scoped channel or a DM/feed.

Refs: `/developer/guides/chat`, `/developer/guides/chat/support-chats`, `/developer/guides/chat/quickstart`.

## 2. Auth + API

**Auth.** All chat endpoints accept *any* of: company API key, company-scoped JWT, **App API Key**, or user OAuth token — provided the token carries the right permission. Junior-backend already holds the App API Key, so we already have the credential.

Permissions: `chat:read`, `chat:message:create`, `chat:moderate`, `support_chat:create`, `support_chat:read`.

**Read.**
- `GET https://api.whop.com/api/v1/chat_channels?company_id=…` → paginated channel list (cursor `after`/`before`, `first`/`last`).
- List messages by channel via the SDK (`client.messages.list({ channelId })`) with auto-pagination.

**Write.**
- `POST https://api.whop.com/api/v1/messages` — body: `channel_id`, `content` (Markdown), optional `attachments[]`, `poll`, `replying_to_message_id`, `auto_detect_links`. Returns full Message object (reactions, mentions, poll votes, etc.).

**Realtime.** WebSocket at `wss://ws-prod.whop.com/ws/developer` streams DM + chat events for the authenticated principal. Rate limits not published; `429` is documented but no threshold.

## 3. Embedded vs API-Only

**Both options exist.** Whop ships an embeddable Chat element:

```ts
import { Elements, ChatSession, ChatElement } from "@whop/embedded-components-react-js";

<Elements>
  <ChatSession token={async () => fetch("/api/whop/chat-token").then(r => r.json())}>
    <ChatElement options={{ channelId: "chat_feed_xxx" }} style={{ height: "100dvh", width: "100%" }} />
  </ChatSession>
</Elements>
```

It loads from `https://apollo.elements.whop.com/release/elements.js`. Token is minted server-side via `POST /api/v1/access_tokens` with `company_id`, `user_id`, `scoped_actions`.

**Tauri compatibility unverified.** Docs cover React / vanilla JS / iOS only — no statement on cross-origin desktop wrappers. The element is iframe-style and depends on `apollo.elements.whop.com` cookies; CSP and third-party-cookie behavior inside a Tauri webview is a risk that needs a 30-min spike.

API-only is always a fallback (build our own UI on top of the messages + WebSocket APIs).

## 4. Cost + Tier Gating

Whop has **no plan tiers** — chat is free for all creators. Whop charges 2.7% + $0.30 per transaction + 3% platform fee on *sales*, but messaging itself is unmetered. No per-message cost, no published storage cap, no creator-plan paywall (`whop.com/network/pricing`).

## 5. Fit Assessment

| Liquid Clips use case | Best Whop surface | Gaps |
|---|---|---|
| **Clipper community** (hundreds chatting about clips) | Experience channel (`chat_feed_…`) on the LC company experience | None — exact fit. Moderation built-in. |
| **Agency room** (per-agency private) | One experience per agency → its own channel | Requires we *create a Whop experience per agency*; not free organizationally. Workable if agencies are themselves Whop tenants under our company. |
| **Campaign chat** (brand ↔ winning clippers) | Group DM (`feed_…`, ≤50 members) | 50-member cap is fine for "winning clippers." No per-campaign metadata on the feed — we'd track campaign↔feed mapping in junior-backend. |
| **Support DM** (clipper ↔ Daniel) | Support Chat (`feed_…`) | Perfect fit — open/resolved workflow + team inbox is exactly what we'd otherwise build. |

## 6. Build-vs-Defer Signal

- App API Key + backend proxy already in place.
- Embedded React element exists → no UI from scratch.
- Free, no tier gate.
- One real unknown: does `<ChatElement>` render inside a Tauri webview without cookie/CSP breakage?

Wiring the **Clipper community channel + Support DM** is a half-day if the Tauri spike passes; one extra day if we fall back to API-only and skin the messages list ourselves. Agency rooms + campaign chats need a Whop-experience-per-agency model that isn't decided yet — those are Phase 2 regardless.

## Recommendation

**Phase 2.** The embedded element is real and free, but the Tauri webview compatibility spike + per-agency-experience modeling push this past the 1–3 day ship window; cleanest path is to land v2.0 with the existing Community placeholder and wire Whop chat in the following sprint after a 30-min iframe-in-Tauri probe.
