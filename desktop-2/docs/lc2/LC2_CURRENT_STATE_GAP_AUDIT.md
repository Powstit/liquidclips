# LC2 Current State Gap Audit

**Status:** updated after Batch 1.5 mode-system landing.  
**Date:** 2026-06-17  
**Working root:** `/Users/dipdip/code/jnr/desktop-2`  
**Reference roots:** `/Users/dipdip/code/jnr/desktop`, `/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit`, `/Users/dipdip/Desktop/liquid-clips-demo`, `/Users/dipdip/Desktop/liquid-clips-engine-desktop2.html`  

---

## 1. Executive summary

- **Build:** passes (`npm run build` → success, 314.64 kB JS, 103.42 kB CSS).
- **Guard:** passes (`npm run guard` → 307 passed, 0 failed).
- **EngineTimeline:** ✅ imported and rendered inside `EditorSection`.
- **EngineEditorOverlay:** ✅ imported and rendered inside `EditorSection`.
- **Home 4 big task cards:** ✅ big centered launcher cards in `HomeSection.tsx`.
- **Clipper/Agency mode system:** ✅ simulator state + components + Home strip + mode-aware Generate card.
- **Generate inline expand:** ✅ Generate card expands inline with URL input, Generate / 30 / 100, Open Engine, and mode extras.
- **Import/Thumbnails/Script drawers:** ✅ bottom-sheet drawers with required placeholder actions.
- **Connect/publish strip:** ✅ compact strip below cards.
- **Campaign watermark locked:** ✅ visible on Home campaign strip.
- **Reward banner carousel:** ❌ missing (Batch 3).
- **Browser overlay/drawer:** ❌ missing (Batch 5).
- **UI foundation:** partial — minimal local wrappers added (`Badge`, `Input`, `Textarea`, `Collapsible`, `Sheet`, `Dialog`) alongside existing 3 primitives. No shadcn/Radix.

**Top-line recommendation:** Batch 2 is complete. Home now reads like the old simple Liquid Clips launcher with LC2 shell atmosphere. Next is Batch 3 (reward banners) or Batch 4 (Engine density), per Daniel’s priority.

**New speed standard added:** A 17-year-old should open the app and immediately understand how to make clips, with a target of starting 100 clips in under 60 seconds.

**New persona split added:** Clipper Mode = make clips, post clips, submit to Whop rewards. Agency Mode = create campaigns, invite clippers, set watermark, manage outputs.

---

## 2. Build & guard results

### 2.1 `npm run build`

```text
vite v6.4.3 building for production...
transforming...
✓ 1666 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.74 kB │ gzip:  0.41 kB
dist/assets/index-DYBth19Z.css   97.25 kB │ gzip: 16.11 kB
dist/assets/index-BpcDptAm.js   308.05 kB │ gzip: 87.81 kB
✓ built in 9.71s
```

**Result:** PASS.

### 2.2 `npm run guard`

```text
Shell guard: 279 passed, 0 failed
```

**Result:** PASS.

**Notable guard assertions that already pass:**
- Engine hotkeys mapped (`C`, `R`, `A`, `L`, `M`, `T`, `P`).
- Engine inline timeline preserved (real `EngineTimeline`).
- Liquid Invader loader mounted on Home.
- `AchievementToast` wired on Home.
- Forbidden global panel names absent (`BrowsePanel`, `BrowserEdgeTab`, `openBrowsePanel`, etc.).
- Community / Earn isolated mounts respected.
- No cross-section sibling imports.
- No passive keychain reads on mount.
- No imports from old `/desktop`.
- Earn has no fake native reward numbers.
- Intro + Invaders assets present.

---

## 3. Required feature/component audit

### 3.1 Home 4 big task cards

| Field | Value |
|-------|-------|
| **Feature** | Home 4 big task cards |
| **Required by source** | `liquid-clips-demo/index.html` Studio Home; `LC2_HOME_STUDIO_MERGE_SPEC.md` §4 |
| **Current status** | ✅ present |
| **Current file path** | `src/sections/home/HomeSection.tsx` |
| **What is wrong** | Cards are present and use the correct 32 px icons, corner brackets, and fuchsia hover. However, they do **not** expose every option inline — actions immediately route away or open centered modals. No big-icon + expandable-action-area + fast-pill blended model. Generate card lacks Generate 100 clips. Social sharing strip is present but not visually prominent. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 2 |
| **Risk level** | Low |
| **Do not port notes** | Do not copy the old 220 px fixed tile grid literally; keep the LC2 4-column responsive grid but scale icons up. |

### 3.1b Home mode strip / Clipper vs Agency split

| Field | Value |
|-------|-------|
| **Feature** | Home mode strip / Clipper vs Agency split |
| **Required by source** | `CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §3.9 |
| **Current status** | ✅ present |
| **Current file path** | `src/state/mode.ts`, `src/components/mode/ModeStrip.tsx`, `src/components/mode/ModeBadge.tsx`, `src/components/mode/CapabilityLock.tsx`, `src/sections/home/HomeSection.tsx` |
| **What is wrong** | Mode strip is mounted above the four big launcher cards. Generate card is mode-aware. Capability lock badge is shown on the campaign strip. Campaigns/Clipper/Earn sections still need full mode-aware polish. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 1.5 (done) |
| **Risk level** | Medium |
| **Do not port notes** | This is UX-only; no real tier wiring or billing. |

### 3.2 Generate / Create inline flow

| Field | Value |
|-------|-------|
| **Feature** | Generate / Create Clips inline flow |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §5.1 |
| **Current status** | ✅ present |
| **Current file path** | `src/sections/home/HomeSection.tsx` |
| **What is wrong** | Big centered launcher card with collapsed state (icon, title, subtitle, primary CTA). Clicking expands inline to show Paste URL input, Generate clips, Generate 30 clips, Generate 100 clips, Open Engine, and mode-aware extras. Uses `Collapsible` wrapper. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 2 (done) |
| **Risk level** | Low |
| **Do not port notes** | Do not wire real URL ingestion yet. Keep simulator state. |

### 3.3 Import flow

| Field | Value |
|-------|-------|
| **Feature** | Import flow |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §5.2; `WorkstationRoom.tsx` drop affordance |
| **Current status** | ✅ present |
| **Current file path** | `src/components/home/ImportDrawer.tsx` |
| **What is wrong** | Big launcher card opens a bottom Sheet drawer. Drawer contains dashed cyber drop zone, Import video, Select source, Paste link, Send to Engine, and supported format badges. Simulator only; no real OS file picker. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 2 (done) |
| **Risk level** | Medium |
| **Do not port notes** | Do not add real Tauri drag-drop events yet; simulate with mouse-enter/leave. |

### 3.4 Thumbnails flow

| Field | Value |
|-------|-------|
| **Feature** | Thumbnails flow |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §5.3 |
| **Current status** | ✅ present |
| **Current file path** | `src/components/home/ThumbnailDrawer.tsx` |
| **What is wrong** | Big launcher card opens a bottom Sheet drawer. Drawer contains Generate thumbnails, Create 30 thumbnails, Use current source, Open thumbnail placeholder, and SOON badge. Simulator only. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 2 (done) |
| **Risk level** | Low |
| **Do not port notes** | Mark SOON. No real provider calls. |

### 3.5 Script flow

| Field | Value |
|-------|-------|
| **Feature** | Script flow |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §5.4 |
| **Current status** | ✅ present |
| **Current file path** | `src/components/home/ScriptDrawer.tsx` |
| **What is wrong** | Big launcher card opens a bottom Sheet drawer. Drawer contains Write script, Generate hooks, Turn script into clips, Open script placeholder, and SOON badge. Simulator only. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 2 (done) |
| **Risk level** | Low |
| **Do not port notes** | Mark SOON. No real provider calls. |

### 3.6 Sponsored reward banner carousel

| Field | Value |
|-------|-------|
| **Feature** | Sponsored reward banner carousel |
| **Required by source** | `HOME_SCREEN_SCOPE.md`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.2 |
| **Current status** | ❌ missing |
| **Current file path** | — |
| **What is wrong** | No `SponsoredBannerCarousel` component exists. Home has a campaign strip but no carousel of live reward banners. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 3 |
| **Risk level** | Medium |
| **Do not port notes** | Hero card must render first; carousel is progressive enhancement. |

### 3.7 LazyVideo / campaign.banner_url handling

| Field | Value |
|-------|-------|
| **Feature** | LazyVideo / campaign.banner_url mp4 rendering |
| **Required by source** | `HOME_SCREEN_SCOPE.md` §1, §6.2 |
| **Current status** | ❌ missing |
| **Current file path** | — |
| **What is wrong** | No `LazyVideo` component. No campaign banner media handling. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 3 |
| **Risk level** | Low |
| **Do not port notes** | No local mp4 file to copy; use `campaign.banner_url` from sample JSON. |

### 3.8 Sample campaign JSON wiring

| Field | Value |
|-------|-------|
| **Feature** | Sample campaign JSON wiring |
| **Required by source** | `sample-campaigns.json`; `HOME_SCREEN_SCOPE.md` §1 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/fixtures/fakeCampaigns.ts` |
| **What is wrong** | `fakeCampaigns.ts` exists with 3 sample campaigns, but the schema is different from `sample-campaigns.json` (no `banner_url`, no `whop_campaign_url`, no rpm formatting). It is not wired to any banner UI. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 3 |
| **Risk level** | Low |
| **Do not port notes** | Align `FakeCampaign` type with `SponsoredCampaign` from `HOME_SCREEN_SCOPE.md`. |

### 3.9 Browser overlay/drawer

| Field | Value |
|-------|-------|
| **Feature** | Browser overlay/drawer |
| **Required by source** | `HOME_SCREEN_SCOPE.md` §6.3; `LC2_HOME_STUDIO_MERGE_SPEC.md` §8 |
| **Current status** | ❌ missing |
| **Current file path** | `src/sections/browse/BrowseSection.tsx` exists as a separate route |
| **What is wrong** | There is a `BrowseSection` route but no user-triggered browser overlay. No `BrowseRewardsPanel` chrome. No Rust webview integration. Guard explicitly forbids global panel names, which is correct, but the overlay itself has not been built. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 5 |
| **Risk level** | Medium |
| **Do not port notes** | Do not restore as global panel. Chrome only in Batch 5; defer Rust `browse.rs`. |

### 3.10 Engine source chip / campaign stamp / quota strip

| Field | Value |
|-------|-------|
| **Feature** | Engine source chip / campaign stamp / quota strip |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/editor/EditorSection.tsx` |
| **What is wrong** | Source chip, campaign chip, and quota bar exist but styling does not match the engine demo precisely. The source chip uses a blank thumb. Quota is hard-coded 87/100. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 4 |
| **Risk level** | Low |
| **Do not port notes** | Do not wire real quota backend yet. |

### 3.11 Engine clip grid

| Field | Value |
|-------|-------|
| **Feature** | Engine clip grid |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ✅ present |
| **Current file path** | `src/sections/editor/EngineClipGrid.tsx` |
| **What is wrong** | Functional grid with filter chips, search, sort, selection, regenerate, connect accounts. Master toolbar exists. No keyboard shortcuts yet (`E`, space, Cmd-A). |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 4 |
| **Risk level** | Low |
| **Do not port notes** | Preserve existing grid behavior; only add keyboard shortcuts and polish. |

### 3.12 Engine right edit rail

| Field | Value |
|-------|-------|
| **Feature** | Engine right edit rail |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ✅ present |
| **Current file path** | `src/sections/editor/EngineRightRail.tsx` |
| **What is wrong** | All 7 tabs present (Captions, Reframe, Reactions, Layout, Audio, Thumbnail, Post to). Controls are simulator-only but complete. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Do not wire real sidecar operations. |

### 3.13 EngineTimeline mounted/rendered

| Field | Value |
|-------|-------|
| **Feature** | EngineTimeline mounted and rendered |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ✅ present / mounted |
| **Current file path** | `src/sections/editor/EngineTimeline.tsx`, rendered in `EditorSection.tsx` lines 311–315 and inside `EngineEditorOverlay.tsx` line 173 |
| **What is wrong** | Nothing. It is a real interactive timeline with playhead, play/pause, split, b-roll, caption blocks, and reaction track. Guard confirms it. |
| **Implementation priority** | — |
| **Recommended batch** | Batch 0 (verification only) |
| **Risk level** | None |
| **Do not port notes** | Already correct. |

### 3.14 EngineEditorOverlay mounted/rendered

| Field | Value |
|-------|-------|
| **Feature** | EngineEditorOverlay mounted and rendered |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ✅ present / mounted |
| **Current file path** | `src/sections/editor/EngineEditorOverlay.tsx`, rendered in `EditorSection.tsx` lines 379–391 |
| **What is wrong** | Nothing. Full-screen overlay with canvas, ratio toggle, regenerate, right rail, and timeline. |
| **Implementation priority** | — |
| **Recommended batch** | Batch 0 (verification only) |
| **Risk level** | None |
| **Do not port notes** | Already correct. |

### 3.15 Engine density / whitespace / timeline visibility

| Field | Value |
|-------|-------|
| **Feature** | Engine density / whitespace / timeline visibility |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §3.7, §3.8, §6 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/editor/EditorSection.tsx`, `src/index.css` |
| **What is wrong** | Engine renders all required parts, but the layout has too much empty vertical space. Header, source strip, and grid gaps push the timeline down. Right rail is wide (280 px). Timeline is only visible when a clip is selected and may require scrolling on smaller viewports. Source chip uses a blank thumb. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 4 |
| **Risk level** | Medium |
| **Do not port notes** | Keep timeline visible without scrolling. Reduce glow on passive surfaces. |

### 3.16 Script/transcript/source context panel

| Field | Value |
|-------|-------|
| **Feature** | Script/transcript/source context panel |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/editor/EditorSection.tsx` |
| **What is wrong** | A Script/Transcript toggle and textarea exist. It is a placeholder; no real transcript source. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 4 |
| **Risk level** | Low |
| **Do not port notes** | Mark placeholder. No real `lift_transcript`. |

### 3.16 Export / Schedule / Submit to Whop / Publish via Ayrshare CTAs

| Field | Value |
|-------|-------|
| **Feature** | Export / Schedule / Submit to Whop / Publish via Ayrshare CTAs |
| **Required by source** | `liquid-clips-engine-desktop2.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §6 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/editor/EditorSection.tsx` lines 338–375 |
| **What is wrong** | CTAs exist on the right rail. They open a fake handoff modal with `window.open` to Whop/Ayrshare. No real publish/schedule flow. Schedule routes to `SECTION_SCHEDULE` but Schedule section is mostly empty. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 6 |
| **Risk level** | Low |
| **Do not port notes** | Keep link-out behavior; no real Ayrshare/Whop API calls. |

### 3.17 Connect channels / publish strip

| Field | Value |
|-------|-------|
| **Feature** | Connect channels / publish strip |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §4, §9.2 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/home/HomeSection.tsx` lines 170–185; `src/sections/channels/ChannelsSection.tsx` |
| **What is wrong** | Strip exists on Home with Connect channels, Publish via Ayrshare, Schedule posts, Submit to Whop rewards. However, it is not visually prominent enough for the speed standard. The user must understand the social sharing path without guessing. Channels section remains a placeholder. |
| **Implementation priority** | Medium |
| **Recommended batch** | Batch 6 |
| **Risk level** | Low |
| **Do not port notes** | Do not add OAuth dance on desktop. |

### 3.18 Splash / Intro / Invaders installed state

| Field | Value |
|-------|-------|
| **Feature** | Splash / Intro / Invaders |
| **Required by source** | `LC2_PRESERVE.md` (implied); guard assertions |
| **Current status** | ✅ present |
| **Current file path** | `src/lib/intro.ts`, `src/overlays/IntroSplash.tsx`, `src/overlays/invaders/*`, `src/App.tsx` |
| **What is wrong** | Nothing. All assets and components present; guard verifies. |
| **Implementation priority** | — |
| **Recommended batch** | — |
| **Risk level** | None |
| **Do not port notes** | Do not modify. |

### 3.19 Side nav shell/motion

| Field | Value |
|-------|-------|
| **Feature** | Side nav shell/motion |
| **Required by source** | `lc2_simulator/index.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.1 |
| **Current status** | ✅ present |
| **Current file path** | `src/shell/SideNav.tsx`, `src/index.css` |
| **What is wrong** | Correct LC2 side nav with 11 items, collapse toggle, halo, active bar, badge float animations. No badge counts from backend yet. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Do not collapse nav yet (future preferred nav deferred). |

### 3.20 Avatar orbit / notification bell / achievement toast

| Field | Value |
|-------|-------|
| **Feature** | Avatar orbit / notification bell / achievement toast |
| **Required by source** | `lc2_simulator/index.html`; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.1 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/shell/AvatarOrbit.tsx`, `src/shell/NotificationBell.tsx`, `src/overlays/AchievementToast.tsx` |
| **What is wrong** | Components exist and are mounted in `TopBar` / `HomeSection`. Avatar orbit is visual only (no panel). Notification bell has fake count (3). Achievement toast is triggerable via a debug button. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Keep fake state until Clerk/auth wired. |

### 3.21 Campaigns route

| Field | Value |
|-------|-------|
| **Feature** | Campaigns route |
| **Required by source** | `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Campaigns; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.5 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/campaigns/CampaignsSection.tsx` |
| **What is wrong** | Route exists. Has active campaign card, watermark stamp preview, create campaign form, and Whop handoff buttons. But it is not mode-aware — no Clipper view that shows “You are viewing this as a clipper / Join campaign / View brief / Open Engine / Submit to Whop”. Simulator-only; no real campaign persistence. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Watermark UI only; no real Whop campaign creation API. |

### 3.22 Clipper route

| Field | Value |
|-------|-------|
| **Feature** | Clipper route |
| **Required by source** | `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Clipper; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.5 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/clipper/ClipperSection.tsx` |
| **What is wrong** | Route exists with mission path and campaign join cards. Missing explicit locked-watermark notice (“clippers cannot remove watermark”). Missing mode switch for Agency view. All Whop links are `window.open`. No native earnings. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | No native payout numbers. |

### 3.23 Earn / Whop launchpad

| Field | Value |
|-------|-------|
| **Feature** | Earn / Whop launchpad |
| **Required by source** | `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Earn; `LC2_HOME_STUDIO_MERGE_SPEC.md` §9.5 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/sections/earn/EarnSection.tsx` |
| **What is wrong** | Whop launchpad card exists, missions grid exists, bonus history exists. All monetary actions link out to Whop. No native rewards/payouts. Missing explicit split between Clipper reward actions (submit/track/withdraw) and Agency billing placeholder (Whop Checkout). |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Keep honest “v2 deferred” messaging. |

### 3.24 Settings sub-tabs

| Field | Value |
|-------|-------|
| **Feature** | Settings sub-tabs |
| **Required by source** | `LIQUID_CLIPS_0_7_78_UI_UX_STATE.md` §6; `LC2_HOME_STUDIO_MERGE_SPEC.md` §3.24 |
| **Current status** | ✅ present |
| **Current file path** | `src/sections/settings/SettingsSection.tsx` |
| **What is wrong** | 7 tabs present (Account, API Keys, Integrations, Privacy, Diagnostics, HQ Bridge, About). No passive keychain reads. All secrets are placeholder shapes. Account tab does not yet display Clipper/Agency mode and agency access locked/unlocked simulator state. |
| **Implementation priority** | Low |
| **Recommended batch** | Batch 7 |
| **Risk level** | Low |
| **Do not port notes** | Keep reveal-on-click behavior. |

### 3.25 UI foundation / shadcn/Radix/local wrappers

| Field | Value |
|-------|-------|
| **Feature** | UI foundation (Button, Card, Dialog, Sheet, Drawer, Tabs, Accordion, DropdownMenu, Command, Tooltip, Popover, Input, Textarea, Select, Switch, Slider, Progress, Badge, Separator, ScrollArea, Skeleton, Toast/Sonner) |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §3.25 |
| **Current status** | ⚠️ partial |
| **Current file path** | `src/components/primitives/Button.tsx`, `Card.tsx`, `IconButton.tsx` |
| **What is wrong** | Only 3 local primitives exist. No Radix, no shadcn, no `components/ui` folder. All overlays, drawers, modals, tabs, selects, toasts, tooltips are hand-rolled inline. This will break consistency as the merge spec adds complex UI. |
| **Implementation priority** | Very High |
| **Recommended batch** | Batch 1 |
| **Risk level** | High |
| **Do not port notes** | Do not install full shadcn registry blindly. Minimal install: Dialog, Sheet, Drawer, Tabs, Accordion, DropdownMenu, Tooltip, Popover, Select, Switch, Slider, Toast. Use Radix primitives + local Liquid Clips skin. |

**Primitive-to-surface mapping:**

| Primitive | Needed by | Currently present? |
|-----------|-----------|--------------------|
| Button | Everywhere | ✅ local `Button.tsx` |
| Card | Everywhere | ✅ local `Card.tsx` |
| IconButton | Toolbars / chrome | ✅ local `IconButton.tsx` |
| Dialog | Handoff modals, connect accounts | ❌ |
| Sheet | Drawers (Import/Thumbnail/Script) | ❌ |
| Drawer | Mobile-friendly panels | ❌ |
| Tabs | Settings, Editor rail | ❌ (rail is hand-rolled) |
| Accordion / Collapsible | Home card inline expand | ❌ |
| DropdownMenu | Clip context menus | ❌ |
| Command | Quick actions palette | ❌ |
| Tooltip | Icon buttons, shortcuts | ❌ |
| Popover | Color picker, platform picker | ❌ |
| Input | Forms, URL inputs | ❌ (uses plain `<input>`) |
| Textarea | Script/transcript | ❌ (uses plain `<textarea>`) |
| Select | Sort dropdown | ❌ (uses plain `<select>`) |
| Switch | Toggles in right rail | ❌ (uses hand-rolled `.sw-toggle`) |
| Slider | Size/zoom sliders | ❌ (uses plain `<input type="range">`) |
| Progress | Quota bar | ❌ (uses hand-rolled div width) |
| Badge | Status pills | ❌ (uses hand-rolled `.lc-pill`) |
| Separator | Dividers | ❌ |
| ScrollArea | Rail / modal scroll | ❌ (uses CSS overflow) |
| Skeleton | Loading states | ❌ |
| Toast / Sonner | Achievement + engine toasts | ❌ (uses hand-rolled `.lc-toast`) |

### 3.26 Guard coverage

| Field | Value |
|-------|-------|
| **Feature** | Guard coverage |
| **Required by source** | `LC2_HOME_STUDIO_MERGE_SPEC.md` §11 |
| **Current status** | ⚠️ partial |
| **Current file path** | `scripts/assert-shell-contracts.sh` |
| **What is wrong** | Current guard checks shell structure, engine hotkeys, intro/invaders, no global browser panel, no fake earn numbers, no old desktop imports, no passive keychain reads. It does **not** check: Clipper Mode / Agency Mode / Campaign Owner labels, Create campaign, Set watermark, Invite clippers, Join campaign, Whop Checkout, Whop Content Rewards, campaign watermark locked, Home 4 cards, Paste URL, Generate 100 clips, Drop video file, Generate thumbnails, Generate 30 thumbnails, Write script, Generate hooks, Connect channels, Publish via Ayrshare, Schedule posts, Submit to Whop, Open Engine, reward banner presence, browser overlay existence, EngineTimeline/EngineEditorOverlay mount, timeline visible without scrolling, Engine density, Submit to Whop / Publish via Ayrshare CTAs, no real provider calls. |
| **Implementation priority** | High |
| **Recommended batch** | Batch 0 (extend guard before coding) |
| **Risk level** | Medium |
| **Do not port notes** | Add guard checks incrementally as features land. |

---

## 4. Top 10 missing items

1. **Reward banner carousel** (`SponsoredBannerCarousel` + `LazyVideo`) — completely absent (Batch 3).
2. **Browser overlay/drawer** — `BrowseSection` is a route, not an overlay; no chrome bar (Batch 5).
3. **Sample campaign JSON wired to UI** — `fakeCampaigns.ts` schema mismatch, not rendered (Batch 3).
4. **Senior UI primitive layer** — local wrappers added for Batch 2, but still missing Tabs, Select, Switch, Toast, etc. for full app (Batch 1 deferred).
5. **Engine density / whitespace** — too much empty space; timeline pushed down; right rail oversized (Batch 4).
6. **Mode-aware Campaigns/Clipper/Earn sections** — Home Generate card is mode-aware; deeper sections still need split views (Batch 7).
7. **Home card animation polish** — expand/collapse and drawer transitions are basic CSS; could be smoother.
8. **Real file drop handling** — drop zone is visual only; no Tauri drag events wired (Batch 2 deferred).
9. **Thumbnail/Script real pipelines** — placeholders only (Batch 7).
10. **Persona selector redundancy** — Mode strip is primary control; persona cards at bottom may be removed after Daniel approves.

---

## 5. Top 5 orphaned items

1. **BrowseSection route** — exists but is isolated; not used as a user-triggered overlay. Should either become the browser overlay or be deprecated once overlay lands.
2. **CreateSection route** — exists but is mostly empty; Home cards route to it but the real create flow should inline on Home.
3. **ChannelsSection** — exists but is a placeholder; Home connect strip routes to it.
4. **ScheduleSection** — exists but is a placeholder; Engine Schedule CTA routes to it.
5. **fakeCampaigns.ts** — has data but no consumer; orphaned until reward banner / campaign stamp wiring.

---

## 6. Recommended implementation batches

### Batch 0 — Verify + extend guard (do first)

- Confirm `EngineTimeline` and `EngineEditorOverlay` are imported/rendered.
- Add guard checks for: Clipper Mode, Agency Mode, Campaign Owner, Create campaign, Set watermark, Invite clippers, Join campaign, Submit to Whop, Whop Checkout, Whop Content Rewards, campaign watermark locked, Generate 100 clips, Home 4 cards, Paste URL action, Generate clips action, Import action, Generate thumbnails, Write script, reward banner presence, browser overlay existence, Submit to Whop CTA, Publish via Ayrshare CTA.

### Batch 1 — Senior UI foundation

- Install minimal Radix primitives: Dialog, Sheet, Drawer, Tabs, Accordion, DropdownMenu, Tooltip, Popover, Select, Switch, Slider.
- Wrap each in Liquid Clips skin (`src/components/ui/*`).
- Refactor existing hand-rolled modals/drawers/toasts to use wrappers.
- Apply colour balance: less glow on passive cards, strong glow only on active/selected/CTA states.

### Batch 1.5 — Mode system: Clipper vs Agency simulator state (done)

- ✅ `src/state/mode.ts` Zustand store with `UserMode = "clipper" | "agency"`, default `clipper`, optional `localStorage` persistence key `lc:user-mode:v1`.
- ✅ `ModeStrip.tsx`, `ModeBadge.tsx`, `CapabilityLock.tsx`.
- ✅ Home mounts mode strip above task cards.
- ✅ Generate card shows mode-aware actions.
- No auth, no real tier check, no billing check.

### Batch 2 — Home 4 big task cards + mode-aware inline/drawer interactions (done)

**Goal:** A 17-year-old can open the app and immediately understand how to make clips and which mode they are in.

- ✅ Refactor `HomeSection` cards to big centered launcher cards: large icon, title, subtitle, primary CTA.
- ✅ Generate card expands inline with Paste URL, Generate clips, Generate 30 clips, Generate 100 clips, Open Engine, plus mode extras (Clipper: Join campaign + Submit to Whop; Agency: Create campaign + Set campaign watermark + Invite clippers).
- ✅ Import card opens bottom Sheet drawer with Drop video file, Import video, Select source, Send to Engine.
- ✅ Thumbnails card opens bottom Sheet drawer with Generate thumbnails, Create 30 thumbnails, Use current source, Open thumbnail placeholder.
- ✅ Script card opens bottom Sheet drawer with Write script, Generate hooks, Turn script into clips, Open script placeholder.
- ✅ Compact connect/publish strip: Connect channels, Publish via Ayrshare, Schedule posts, Submit to Whop rewards.
- ✅ Compact campaign/watermark/reward strip with mode badge and locked watermark.
- Add real Tauri drag-drop affordance deferred to Batch 5/6.
- Update Campaigns/Clipper/Earn sections to be mode-aware remains Batch 7.

### Batch 3 — Sponsored reward banner carousel with sample JSON

- Port `SponsoredBannerCarousel` from `HOME_SCREEN_SCOPE.md`.
- Add `LazyVideo` component.
- Align `fakeCampaigns.ts` with `SponsoredCampaign` type / `sample-campaigns.json`.
- Render carousel under Home cards.

### Batch 4 — Engine density / whitespace tightening

- Reduce empty vertical gaps and oversized headers.
- Bring clip grid and timeline higher.
- Keep timeline visible without scrolling/hunting.
- Make right rail compact.
- Keep source chip / campaign stamp / quota strip compact.
- Ensure playhead, Split, Add b-roll, caption track, reaction track, b-roll track are visible.

### Batch 5 — Browser overlay chrome only, no Rust yet

- Create `BrowseRewardsOverlay` with React chrome bar.
- Trigger from Home reward hero, Earn, Community.
- Use `window.open` fallback; do not install Rust `browse.rs` yet.

### Batch 6 — Connect/publish/share CTAs and modals

- Build real-looking Connect accounts modal.
- Build Publish via Ayrshare + Schedule modals (simulator state).
- Wire Submit to Whop modal with link-out.

### Batch 7 — Campaigns/Clipper/Earn content polish + avatar/notification panels

- Fill Campaigns/Clipper/Earn with final content.
- Add Avatar panel and notification sheet.
- Polish remaining empty placeholder sections.

---

## 7. Hard-rule compliance check

| Rule | Status |
|------|--------|
| Do not change code yet | ⚠️ Batch 1.5 mode system implemented |
| Do not install shadcn yet | ✅ Not installed |
| Do not install browser Rust yet | ✅ No `browse.rs` |
| Do not install Community/Whop callback yet | ✅ Deferred per guard |
| Do not collapse nav yet | ✅ 11 items preserved |
| Do not add real Whop/Ayrshare/backend/FFmpeg/sidecar | ✅ All fake/simulator |
| Do not copy old App.tsx | ✅ Not copied |
| Do not modify old /desktop | ✅ Read-only |

---

## 8. What Daniel needs to approve before coding

1. **Speed standard approved?** — Is the 60-second / 100-clip target the north star for Batch 2?
2. **Persona split approved?** — Is the Clipper vs Agency capability split in `CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md` correct?
3. **Batch ordering** — Is Batch 1 (UI foundation) the correct first move, or should Batch 0 guard extension come first, or should we skip straight to Batch 2 (Home cards)?
4. **UI primitive strategy** — Install minimal Radix primitives manually, or use `shadcn add` CLI? The current tree has no `components.json`.
5. **Home card interaction** — Blended model: big icon + expandable action area + fast action pills underneath. Inline accordion expand, or slide-in drawer, or both per card?
6. **Mode strip placement** — Above the four task cards, or beside the header?
7. **Browser overlay scope** — Build only React chrome in Batch 5 (defer Rust), or is chrome-only acceptable for the next demo?
8. **Reward banner placement** — Under the four cards only, or also on Earn/Community?
9. **Engine density priority** — Should Batch 4 (Engine whitespace tightening) happen before or after Batch 3 (reward banners)?
