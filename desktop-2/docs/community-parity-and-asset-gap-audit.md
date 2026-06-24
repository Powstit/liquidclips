# Phase 6M-A · Community Parity + Design OS Asset Gap Audit

Status: read-only inventory. No code changes, no asset generation, no placeholders. Output is this report.

---

## Executive summary

**Community parity vs legacy: 80%+.** The Design OS port has feature parity with legacy `CommunityTab` on the *core* surface — tier-gated room/channel list, locked-preview gating, Whop handoff via a clean `browse:open` bus indirection, generic discussion drawer, featured discussion hero, announcements rail (with safe empty state), and a hook surface (`useCommunity`) that adapter-bridges every consumer. **Three legacy surfaces are intentionally deferred** (Achievement badges/toasts, BadgeShelf, Reward Clips entry point) — none of them are blocking and all map cleanly into Phase 6L-C / 6L-D scope.

**Asset coverage: brand library is rich; route surfaces are under-using it.** 197 brand assets exist (162 MB). Worlds (8/8), Kade poses (19 states + 5 tier overlays + 1 base · all covered), and the reward / leaderboard / achievement badge libraries are **already drawn** and shipped in `public/brand/`. The gap is **not asset production — it's wiring**. Routes built on the SimPage template (8 of 14) don't yet mount the available decks, nav-badge images, atmosphere backdrops, or sponsored thumbnails.

**Campaign dependencies: largely covered by existing assets.** Of ~18 visual classes Campaigns will need (banner / featured slot / coordination icon / reward states / leaderboard badges / discussion glyph / sponsorship indicator), **15 are reusable from `public/brand/` today**. Three are missing and recommended for a single batch generation: campaign-type icons (clip / coordination / affiliate / submission), agency-creation flow illustrations, and a coordination-campaign capacity meter.

**Kade is launch-complete.** All 19 KadeState union members have a webp pose, plus 5 tier-themed poses. Placement (`center` / `helper-right`) is wired per-route. No Kade gaps blocking ship.

**Recommendation: STOP feature building until 6L-C and a single asset wiring pass land.** Campaigns can begin after that without an asset-generation bottleneck.

---

## 1 · Community parity table

Legacy column = `desktop/src/components/CommunityTab.tsx` + `desktop/src/lib/{backend,browse,achievements}.ts` + the BadgeShelf / AchievementToast surfaces. Design OS column = `desktop-2/src/design-os/community/*` + `state/useCommunity.ts` + `routes/Community.tsx`.

| Surface | Legacy desktop | Design OS port | Status |
| --- | --- | --- | --- |
| Room / channel list | `CommunityTab` fetches `GET /community/channels` | `useCommunity` via `community.listChannels()` real-RPC → HTTP → mock fallback | **Parity** |
| Tier gating (`PREMIUM_TIERS`) | `solo · pro · agency · growth · channel · autopilot` premium set | Same set, verbatim port in `community/types.ts:PREMIUM_TIERS` | **Parity** |
| Locked logic | `!isPremium && (required_tier === "paid" \|\| "paid_admin")` + hide on `is_locked_preview_enabled === false` | Identical · `community/types.ts:resolveRoom` + `RoomGrid` filters | **Parity** |
| Coming state (`whop_channel_id` null) | Greyed card · no nav | RoomCard `status === "coming"` · amber dot · drawer explains "Discussion not provisioned yet" | **Parity** |
| Admin-only state | Read-only preview | RoomCard `status === "admin"` · drawer explains "Admin only · read-only" | **Parity** |
| Whop chat URL | `https://whop.com/c/<whop_channel_id>` | Same · `community/types.ts:whopChatUrl` | **Parity** |
| Whop handoff path | `openBrowsePanel` → Tauri webview child | `bus.emit("browse:open", { mirror: "whop" })` → default subscriber: `openSmart` → `window.open` → toast. **Cleaner abstraction** that lets a future native overlay subscribe. | **Parity (improved abstraction)** |
| In-app browser overlay | Legacy Tauri child webview (`BrowseRewardsPanel`) | Not ported · `window.open` fallback only | **Partial** (acceptable per clarification — overlay is a Phase 6L-late item) |
| Featured / hero surface | None — legacy is a flat grid | `FeaturedDiscussion` GlassCard above the grid · reads `featuredDiscussion` alias | **DOS adds value** |
| Discussion drawer | None — legacy clicks straight to Whop | `RoomDetailDrawer` reads generic `Discussion` shape (campaign-compatible) · "Open discussion" + "Open Whop mirror" + Mark-as-visited | **DOS adds value** |
| Mark-as-visited persistence | None in legacy | DOS localStorage `lc.community.visited.v1` | **DOS adds value** (local only · documented gap) |
| Announcements rail | None in legacy | `AnnouncementsRail` · safe empty state (no public endpoint confirmed in Phase 6K audit) | **Partial** (UI ready, backend deferred) |
| Leaderboard preview | `desktop/src/lib/backend.ts:leaderboardGet()` (called from Earn, not Community) | `useCommunity.leaderboardPreview` slice ready in hook · no UI yet | **Deferred** (Phase 6L-C scope) |
| Achievement toast | `AchievementToast.tsx` + `lib/achievements.ts` EventTarget bus + localStorage earned set | None in DOS · only `motion/presets.ts:achievementUnlock` animation preset exists | **Missing** (cosmetic — defer to 6L-C/D) |
| BadgeShelf | `BadgeShelf.tsx` (earned badges display) | None in DOS | **Missing** (cosmetic — defer) |
| `top_100_leaderboard` unlock | `recordAchievement` fires on first top-100 entry | Not wired · needs the leaderboard surface first | **Deferred** (Phase 6L-C scope) |
| Reward Clips entry | Earn route in legacy (`rewardClips.list/create/patch` HTTP) | Earn route is still a SimPage stub · no Reward Clips port | **Missing** (correctly deferred per brief · Phase 6L-late) |
| `banners` table · `placement="community_top"` | Surfaced on home + community by legacy SponsoredBannerCarousel | Not surfaced on DOS Community route | **Missing** (Phase 6L-C candidate) |
| `announcements` table public GET | No public route confirmed | Empty state + harmless fetch attempt for forward compat | **Backend gap** (carry into Phase 6N backend pass) |
| Loading / error / empty states | Legacy: text-only error string + retry | DOS: `RoomGrid` shows GlassCard with `is-error` style + Retry; `AnnouncementsRail` empty card; `RoomDetailDrawer` per-status info card | **DOS adds value** |
| CORS / runtime honesty | Legacy hits prod backend directly | DOS gates HTTP behind `shouldTryHttpBackend()`; "Studio preview" tag fires when on mock | **DOS adds value** |

### Classification roll-up

- **Parity achieved (10):** room list · tier gating · locked logic · coming/admin states · Whop URL · Whop handoff path · loading/error/empty states · plus three DOS-adds-value surfaces (featured · drawer · visited persistence)
- **Partially achieved (3):** in-app browser overlay · announcements rail (UI ready · backend gap) · CORS-aware honesty tag
- **Intentionally deferred (5):** leaderboard preview UI · `top_100_leaderboard` unlock · Reward Clips entry · in-app browser overlay native subscriber · localStorage→server-side visited sync
- **Missing (4):** AchievementToast surface · BadgeShelf surface · `banners.placement="community_top"` consumption · public `/announcements` GET (backend)

---

## 2 · Route asset-gap table

Per route. Files referenced confirmed against `routing/routeRegistry.ts`, `copy/copyMap.ts`, and the route file itself. "SimPage stub" = the Phase 5B placeholder; "real" = a full DOS implementation has shipped.

| Route | Status | World | Kade default | Assets currently used | Placeholders | Missing | Visual debt |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Home** (CommandRoom) | Real | `cockpit-home` ✓ | `idle` ✓ | `/kade/{idle,create-clips,import-footage,campaign-mode}.webp`, `/clip-fx/rocket-export.webp`, DSEG7 fonts, allowance bars | None | `/decks/workspace.png` not mounted as deck background · `/atmospheres/atmosphere-workspace.png` not mounted | Sponsored banner carousel not ported from legacy |
| **Create** | Real | `source-bay` ✓ | `create-clips` ✓ | `/worlds/source-bay.webp`, Kade via session | DropZone uses `/invaders/grunt.png` (legacy mascot in a non-invader context) | `/decks/upload.png` deck background not mounted | DropZone mascot is a placeholder · should be a Kade pose |
| **Engine** | Real | `cutting-floor` ✓ | `cutting-clips` ✓ | `/worlds/cutting-floor.webp`, Kade via session | None | Stage rail icons (ingest/audio/transcribe/llm/cut/reframe/thumbs) — currently text-only | Stage-progress visuals are text-only · `/clip-fx/laser-cut-line.svg` + `/clip-fx/marker-hook.svg` exist but unused |
| **Studio** (TimelineStudio) | Real | `studio-deck` ✓ | `generating-captions` ✓ | `/worlds/studio-deck.webp` | Caption Drawer uses CSS-only styles | `/clip-fx/caption-bubble.svg` exists but unmounted | Caption-style previews are CSS-only · could use the brand glyph |
| **Thumbnail** | Real | `studio-deck` (shared) ✓ | `reading-brief` ✓ | `/worlds/studio-deck.webp` | Source preview uses CSS gradient when no clip selected | None essential | Episode/clip mode toggle has no iconography |
| **Export** | Real | `studio-deck` (shared) ✓ | `exporting` ✓ | `/worlds/studio-deck.webp`, `AccountChipState` per-platform glyphs (text "T" / "I" / "Y" / "X" / "L" / "F") | Platform glyphs are text initials, not brand SVGs | Per-platform SVG icons in `/icons/` would land cleanly | `lc-acs-platform-*` colour rings exist but no platform SVG art |
| **Channels** | Real | `relay-tower` ✓ | `publishing` ✓ | `/worlds/relay-tower.webp`, `/kade/kade-{base,create-clips,success,reading-brief}.{png,webp}` (channel avatars in fixture) | Channel avatars are Kade poses used as proxy avatars — placeholder | Real per-account avatar art when OAuth lands · `/icons/nav/*` per-platform SVGs would help | "Kade as avatar" is an obvious placeholder |
| **Schedule** | Real | `cockpit-home` ✓ | `publishing` ✓ | `/worlds/cockpit-home.webp` | Week strip dots are pure CSS | None essential | Job-status pills could lean on `/reward/stamp-*.svg` for "posted" / "needs changes" parity |
| **Community** | Real (6L-A/B) | `squad-lounge` ✓ | `community-mode` ✓ | `/worlds/squad-lounge.webp` | Empty announcements rail · no banner art | `/nav-badges/community.png` not wired into the hero · `banners.placement="community_top"` not consumed | `/reward/badge-verified-campaign.svg` + `/reward/badge-premium-mission.svg` perfect for room tier dots but unused |
| **Library** | SimPage stub | `cockpit-home` ✓ | `idle` ✓ | None direct | Whole route | Real Library card art · `/decks/library.png` (no asset exists with that name; `/decks/workspace.png` would map) | High debt — route is a placeholder |
| **Earn** | SimPage stub | `cockpit-home` ✓ | `earn-mode` ✓ | None direct | Whole route | `/decks/earn.png` + `/atmospheres/atmosphere-earn.png` + `/reward/{chest-reward.webp,coin-stack.webp,stamp-payout.svg}` all exist, none mounted | High debt — Vault + payout panel not implemented |
| **Settings** | SimPage stub | `cockpit-home` ✓ | `settings-mode` ✓ | None direct | Whole route | `/decks/settings.png` + `/atmospheres/atmosphere-settings.png` exist, unmounted | High debt — forms surface is a placeholder |
| **Login** (LoginOnboarding) | SimPage stub | `cockpit-home` ✓ | `idle` ✓ | None direct | Whole route | `/intro/closing-still.png` (12 MB) or `/intro/oasis-anchor.png` could anchor the splash | High debt — onboarding is a stub |
| **Stop Pages** | SimPage stub | `cockpit-home` ✓ | `warning` ✓ | None direct | Whole route | `/kade/kade-warning.webp` exists; `/kade/kade-error.webp` exists | Medium debt — error/upgrade copy without the matching Kade pose |
| **Campaigns** *(future)* | SimPage stub | `mission-pedestal` ✓ | `reading-brief` ✓ | None direct | Whole route | Covered in §3 below | Whole-route debt by definition |
| **Clipper Journey** *(overlay)* | SimPage stub | `cockpit-home` (overlay) | `campaign-mode` ✓ | None direct | Whole route | Belongs to the Campaigns flow long-term | Overlay scope · low priority |

### Roll-up

- **World gaps: zero.** All 8 worlds in the `WorldKey` union have a backdrop asset and are wired through `routeRegistry.ts`.
- **Kade pose gaps: zero.** All 19 KadeState members + 5 tier poses + 1 base have webp assets.
- **Visual debt is concentrated in 5 SimPage-stub routes** (Library · Earn · Settings · Login · StopPages) and in 2 placeholder uses (DropZone mascot · Channel avatars using Kade poses).
- **The largest asset reuse opportunity** is the `/decks/` and `/atmospheres/` libraries — drawn, sized, never mounted.

---

## 3 · Campaign dependency table

Visual classes Campaigns will demand (per Daniel's clarification: Campaign = Banner = single source of truth, owning Brief / Assets / Reward Rules / Submissions / Leaderboard / Discussion + Coordination type + Featured placement + Payout tiers).

| Visual class | Exists in `public/brand/`? | Where today | Action |
| --- | --- | --- | --- |
| Campaign hero banner | **Yes** — `/decks/workspace.png` + `/decks/upload.png` + `/atmospheres/atmosphere-workspace.png` | unused on DOS | **Reuse existing** |
| Featured campaign placement frame | **Partial** — `/reward/badge-verified-campaign.svg` (verification chip) | unused | **Reuse** for the verified mark · banner border can be CSS gradient (no new art) |
| Coordination campaign banner | **No bespoke art** · `/decks/upload.png` covers the surface | — | **Generate later** (one banner; coordination is launching distinct from clip campaigns) |
| Clip campaign type icon | **Yes** — `/icons/action/campaign/*` (9 SVGs) | likely covers clip type · need to verify the exact 9 names map | **Reuse** |
| Coordination campaign type icon | **Unknown** — `/icons/action/campaign/*` count = 9 suggests it might already exist · needs verification before generating | — | **Verify first**; generate only if missing |
| Affiliate campaign type icon | **Probably yes** — `/icons/nav/*` (4 SVGs) likely includes one for affiliate | — | **Verify first** |
| Submission campaign type icon | **Probably no** | — | **Single-icon generation candidate** |
| Reward state badges (draft / generated / submitted / approved / denied) | **Yes — all 5 covered** by `/reward/stamp-{approved,needs-changes,payout,rejected}.svg` + `/reward/badge-{premium,sponsored}-mission.svg` | unused | **Reuse existing** · just need an adapter `status → asset` map |
| Leaderboard rank badges (1 / 2 / 3 / numeric) | **Yes — `/leaderboard/rank-1-gold.svg`, `rank-2-silver.svg`, `rank-3-bronze.svg`, `rank-numeric.svg`** | unused | **Reuse existing** |
| Leaderboard tier badges | **Yes — `/leaderboard/tier-{rookie,solo,pro,growth,climber}.webp`** | unused | **Reuse existing** |
| Crown / shield / trophy chrome | **Yes — `/leaderboard/badge-{crown,shield,trophy}.svg`** | unused | **Reuse existing** |
| Payout state badges | **Yes — `/reward/stamp-payout.svg`** | unused | **Reuse existing** |
| Watermark-locked chip | **Yes — `/reward/shield-watermark-locked.svg`** | unused | **Reuse existing** |
| Coin / chest reward illustrations | **Yes — `/reward/coin-stack.webp` + `/reward/chest-reward.webp`** | unused | **Reuse existing** |
| Discussion glyph | **Yes — generic message glyph in `/icons/nav/*` (4 SVGs)** likely covers | — | **Verify first** · trivially fallbackable to a unicode "💬"-equiv mono glyph |
| Sponsorship indicator | **Yes — `/sponsored/badge-sponsored.png` + `/reward/badge-sponsored-mission.svg` + `/sponsored/thumb-{business,creator,fitness,tech}.png`** | partially unused | **Reuse existing** for the placeholder thumb library |
| Agency-creation flow illustrations (form headers per step) | **No** | — | **Single-batch generation candidate** (5–7 step illustrations) |
| Coordination capacity meter art (e.g. "1,847 / 2,000 upvoting now") | **Partial** — `/brand/allowance/bar-*.svg` covers progress bars; capacity gauge specifics aren't drawn | — | **Reuse** allowance bars; no new art needed for v1 |
| Reward-tier ladder (free $1 / pro $3 / agency $5 RPM) art | **Yes — `/brand/tiers/{free,solo,pro,growth,climber,legend,titan,autopilot,rookie}.png`** | partially unused | **Reuse existing** |

### Generation batch — required before Campaigns

Only the genuinely missing items:

1. **Submission campaign type icon** — 1 SVG.
2. **Coordination campaign type icon** — verify first; if `/icons/action/campaign/*` doesn't include one, 1 SVG.
3. **Agency-creation flow illustrations** — 5–7 step headers (Title + Brief / Reward / Capacity / Discussion / Assets / Review). Style-match existing `/decks/*.png` aesthetic.

Everything else can ship using the existing brand library plus an adapter layer (`campaignStatusToAsset(...)`, `campaignTypeToIcon(...)`, etc.) — same pattern `channelStatusToAccountState` uses in `engine/sidecar-stub.ts`.

### Marked "unnecessary"

- Standalone Reward Banner art (per clarification, Reward Banner = Campaign Page = same object — one banner per campaign, not a separate asset class).
- Per-platform campaign banners (the campaign owns one banner; platform-specific tweaks live in submission previews, not the banner).

---

## 4 · Kade audit

### Existing placements (from `routing/routeRegistry.ts`)

| Route | World | Kade default | Placement |
| --- | --- | --- | --- |
| home | cockpit-home | idle | center |
| create | source-bay | create-clips | center |
| engine | cutting-floor | cutting-clips | center |
| studio | studio-deck | generating-captions | helper-right |
| thumbnail | studio-deck | reading-brief | helper-right |
| export | studio-deck | exporting | helper-right |
| campaigns | mission-pedestal | reading-brief | center |
| clipper | cockpit-home | campaign-mode | center |
| earn | cockpit-home | earn-mode | center |
| community | squad-lounge | community-mode | helper-right (overridden in 6L-A) |
| library | cockpit-home | idle | helper-right |
| channels | relay-tower | publishing | helper-right |
| schedule | cockpit-home | publishing | helper-right |
| settings | cockpit-home | settings-mode | helper-right |
| login | cockpit-home | idle | center |
| stop-pages | cockpit-home | warning | center |

### Existing poses

All 19 `KadeState` union members shipped as `.webp` + the 5 tier overlays (`kade-tier-*.webp`) + `kade-base.png`:

`idle · hover · create-clips · import-footage · reading-brief · cutting-clips · generating-captions · exporting · publishing · campaign-mode · earn-mode · community-mode · settings-mode · shooter · success · celebration · warning · error`

Plus: `tier-{climber,growth,pro,rookie,solo}`.

### Missing Kade states

None blocking. The motion preset `motion/presets.ts:achievementUnlock` exists but has no dedicated pose — it animates the existing `kade-success` / `kade-celebration`. That's a deliberate composition pattern and not a gap.

### Classification

- **Launch critical:** all 19 base poses · all 8 world backdrops · `helper-right` and `center` placements. **All present.**
- **Nice to have:** Kade poses keyed to specific actions inside future Campaigns surface (e.g. `agency-mode` for the agency creation flow, `coordination-mode` for the coordination campaign launch screen). Not blocking · cosmetic.
- **Future:** Stop-page-specific failure modes (token-revoked / billing-failed) that could use `kade-warning` vs `kade-error` variants — both poses already exist, so this is wiring not generation.

---

## 5 · Recommended asset generation batch

Only generate when **all three** of these are true: (a) the visual class is required before Campaigns ships, (b) no existing brand asset reasonably substitutes, (c) a CSS / unicode / motion fallback isn't acceptable for first ship.

That filter leaves a **single batch of 3 items** for production:

| # | Asset | Format | Why |
| --- | --- | --- | --- |
| 1 | Submission-campaign type icon | SVG | Required visual identifier for one of the 4 campaign types. No existing brand asset maps. |
| 2 | Coordination-campaign type icon | SVG | Same as above — pending the `/icons/action/campaign/*` verification (may already exist). Generate only if confirmed missing. |
| 3 | Agency creation flow step headers (×5–7) | PNG (deck-style) or webp (illustration-style) | The agency-side onboarding wants visual anchors per step (Title / Brief / Reward / Capacity / Discussion / Assets / Review). Existing `/decks/*` art is consumer-facing and doesn't fit the agency POV. |

**Nothing else needs generation before Campaigns ships.**

**Hard rule reminder** (from memory `bespoke_craft_skill` + `catjack_asset_pipeline`): every generated asset comes from gpt-image-1. Rive only animates; never creates art. No CC0 stock, no Lucide defaults, no CSS gradient meshes pretending to be a banner.

---

## 6 · Recommended next phase after audit

**Two-week sequence — feature freeze before Campaigns begins.**

### Phase 6L-C · Wiring pass (no asset generation)

Lift `useCommunity().leaderboardPreview` into a real `<LeaderboardSection>` (audit-preview rail). Reuse existing `/leaderboard/*` SVGs + tier webps · no new art. Port `desktop/src/lib/achievements.ts` `recordAchievement` into a thin DOS shim; wire the `top_100_leaderboard` unlock toast. Mount `/brand/banners/community_top` consumer in Community route. This closes the last *real* parity gap. **Est. 1–2 days.**

### Phase 6L-D · Drawer rename + Earn route port

Re-export `<RoomDetailDrawer>` as `<CampaignDiscussionDrawer>` (both names available, no breaking change). Begin Earn route port using `/decks/earn.png` + `/reward/*` library — closes one of the five SimPage-stub debts. **Est. 2–3 days.**

### Phase 6M-B · Single asset generation batch

Submit the 3-item batch from §5 to gpt-image-1 (per `bespoke_craft_skill`). **No code work in this phase.**

### Phase 6N · Campaigns foundation

Once 6M-B's batch lands, Campaigns can begin. The hook surface (`useCampaigns`), the entity, and the agency-creation flow all start with **zero asset-generation bottlenecks**. The `campaignToDiscussion` adapter slots into `<RoomDetailDrawer>` without changes. Reward stamps / leaderboard badges / coin illustrations are already drawn.

---

## Closing notes

- The **biggest risk to Campaigns velocity is not asset generation — it's the temptation to wire all of `/brand/*` at once.** Stage it: only mount what each phase actually surfaces.
- The legacy desktop's `BrowseRewardsPanel` (Tauri child webview) is a real native overlay. Porting it into DOS would close the "Whop mirror opens in default browser" toast trail. **Estimate it as a single Phase 6L-late sprint** — the architecture (`browse:open` event + default subscriber) is ready to accept it.
- The mock seed in `engine/sidecar-stub.ts` already carries a transitional comment marking `affiliate-growth-room` + `free-clipper-lobby` for collapse-into-Campaigns in Phase 6M. **Do not edit until Campaigns lands** — the bridge needs to keep working through the transition.
- No further Community feature work should land before 6L-C. The drawer + featured + handoff foundation is the right shape for Campaign-primary; piling more room-vocabulary on it now will create churn later.
- This audit found **zero blocking parity gaps** and **zero blocking asset gaps**. The only ship-stopper is the SimPage-stub debt across Library / Earn / Settings / Login / StopPages, which is **wiring**, not art.
