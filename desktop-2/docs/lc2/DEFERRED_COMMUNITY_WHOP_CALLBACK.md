# Deferred Community / Whop callback — LC2_PRESERVE §3

Status: **Deferred to a later Community/Whop lane.**

## Why deferred

Section 3 of `LC2_PRESERVE.md` (Community — tier-gated Whop rooms + browse-panel callback) is intentionally **not** installed in Phase 1 because it touches several systems that require their own focused lane:

- **Tauri commands**: `open_browse_panel`, `close_browse_panel`, `is_browse_panel_open`, `browse_back`, `browse_forward`, `browse_reload`.
- **WebKit panel lifecycle**: Rust-side child webview creation, `browse_panel:loaded` / `browse_panel:error` events, 10 s load timeout re-arm logic.
- **Backend endpoint**: `GET {BACKEND_URL}/community/channels` (real API dependency, no-auth public list).
- **Whop URLs and tier gates**: `WHOP_COMMUNITY_URL`, per-room `https://whop.com/c/${whop_channel_id}`, `PREMIUM_TIERS` set with legacy aliases.
- **Tier-gate behaviour**: paid/free room locking, admin-only preview rules, upgrade CTAs.

These are real integration surfaces. They should be implemented after the Phase 1 shell-magic pieces (splash + Invaders) are stable, and only when the Community lane is explicitly prioritized.

## What is NOT in this codebase

- No `src/lib/browse.ts` browse-panel bridge.
- No `open_browse_panel` / `close_browse_panel` / `browse_back` / `browse_forward` / `browse_reload` commands.
- No `is_browse_panel_open` state.
- No `GET /community/channels` backend call.
- No WHOP community routing in `src/App.tsx`.
- No tier-gate logic or legacy tier aliases.
- No browse-panel timeout re-arm logic.

## Phase 1 installed instead

- `src/lib/intro.ts`
- `src/overlays/IntroSplash.tsx`
- `src/lib/invaders/*`
- `src/overlays/invaders/*`
- `public/brand/intro/*`
- `public/brand/invaders/*`

## When to return

Revisit this file when:

1. The Rust side has a dedicated `src-tauri/src/browse.rs` with the 6 commands + 2 events.
2. The backend `/community/channels` endpoint is confirmed live and CORS-allowed for Tauri localhost origins.
3. The Whop community URL and tier model are finalized.
4. The design is ready to replace the current `src/sections/community/CommunitySection.tsx` placeholder.

Iron-gate proposal: `IG-LC2-010 Community ↔ Whop callback contract`.
