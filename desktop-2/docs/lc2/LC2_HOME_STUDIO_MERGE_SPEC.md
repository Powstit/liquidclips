# LC2 Home / Studio / Engine Merge Spec

**Status:** spec-only — do not implement yet.  
**Scope lock date:** 2026-06-17  
**Target tree:** `/Users/dipdip/code/jnr/desktop-2`  
**Reference tree (read-only):** `/Users/dipdip/code/jnr/desktop` (v0.7.78)  

---

## 1. Purpose

We have the right pieces in three places, but they are not yet mapped into one coherent app. This document defines how to merge them:

1. **Old functional Home / Workstation UX** (`liquid-clips-demo/index.html`)
2. **New LC2 shell / nav / motion** (`lc2_simulator/index.html`)
3. **New Engine editing suite** (`liquid-clips-engine-desktop2.html`)
4. **Old reward banner + in-app browser** (`HOME_SCREEN_SCOPE.md`)
5. **New Campaigns / Clipper / Earn lanes** (`LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md`)

---

## 2. Source references mapped

| # | Reference path | Was it mapped? | What we take from it |
|---|----------------|----------------|----------------------|
| 1 | `/Users/dipdip/Desktop/liquid-clips-demo/index.html` | ✅ Yes | Old Home layout, 4 big task icons, simple “what do you want to do?” entry point, icon scale / immediate clarity, tile hover language. |
| 2 | `/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit/03_DEMO_HTML_MOCKUPS/lc2_simulator/index.html` | ✅ Yes | Side nav, topbar, avatar orbit, notification bell, achievement toast, shell motion, route transitions, atmosphere, HUD card corners, cockpit tile perspective. |
| 3 | `/Users/dipdip/Desktop/liquid-clips-engine-desktop2.html` | ✅ Yes | Engine workstation: clip grid, source chip, campaign stamp, quota/export strip, edit overlay, right rail, timeline, publish/schedule/Whop/Ayrshare handoffs. |
| 4 | `/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit/05_FEATURE_MAP/HOME_SCREEN_SCOPE.md` | ✅ Yes | `SponsoredBannerCarousel`, `LazyVideo` campaign banner, `BrowseRewardsPanel` / browser panel, Tauri webview wiring, campaign sample data. |
| 5 | `/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit/05_FEATURE_MAP/home_screen_assets/sample-campaigns.json` | ✅ Yes | Offline campaign sample data (mp4 / image / locked). |
| 6 | `/Users/dipdip/Desktop/LIQUID_CLIPS_0_7_78_UI_UX_STATE.md` | ✅ Yes | Current app shell anatomy, route-less state machine, Workbench rules, Earn sub-surface, Schedule/Projects/Library/Community structure, guard rules (e.g. no fake numbers). |
| 7 | `/Users/dipdip/Desktop/LIQUID_CLIPS_2_MASTER_REFERENCE.md` | ✅ Yes | Service inventory, build-vs-rent matrix, brand tokens, deep-link scheme, backend URLs. |
| 8 | `/Users/dipdip/Desktop/LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` | ✅ Yes | Section ownership, doors matrix, provider tags (`[BUILD]`, `[WHOP]`, `[AYR]`, `[BACKEND]`, `[v2]`), honest rules (no fake payout numbers). |
| 9 | `/Users/dipdip/code/jnr/desktop-2` | ✅ Yes | Current React + Tauri skeleton: `AppShell`, `SideNav`, `TopBar`, `HomeSection`, `EditorSection`, hash router, fake fixtures. |

**All nine references were read and mapped.**

---

## 3. Design principles for the merge

### 3.1 Home is task-first, not dashboard-first
The Home screen must answer “What do you want to make?” with four large, immediately readable cards. Metrics and campaigns sit underneath, not above.

### 3.2 Overlay-first navigation
Do not send the user to a new full screen for every sub-task. Use inline expand / drawer / overlay / modal while the user is still in the same intent.

### 3.3 Browser panel is user-triggered only
The in-app browser from v0.7.78 must not be globally mounted. It opens as an overlay / drawer for Whop / rewards / community browse flows.

### 3.4 Engine components must be mounted, not orphaned
`EngineTimeline` and `EngineEditorOverlay` already exist in `desktop-2/src/sections/editor/`. They must remain rendered inside `EditorSection`; any future refactor preserves their import and render.

### 3.5 No fake native payout numbers
Per `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md`, v1 Earn links out to Whop. Do not render views, submissions, or payouts we cannot fetch.

### 3.6 Offline-first reward banners
Reward banners use the sample JSON until the backend `GET /campaigns` exists. No real backend integration in this batch.

### 3.7 Speed and clarity standard (new)
The app must be designed for speed and clarity, not just visual polish.

**Core user standard:** A 17-year-old should open Liquid Clips and immediately understand how to make clips.

**Target outcome:** User can start making 100 clips in under 60 seconds.

That requires:
- No confusing dashboard-first flow.
- No hidden primary actions.
- No hunting for Paste URL.
- No unclear social sharing path.
- No buried timeline.
- No overpowering colour/glow that fights the UI.

**Speed test (manual, after implementation):**
1. Open app after splash.
2. Click Generate / Create Clips.
3. Paste URL.
4. Click Generate 100 clips.
5. See generation/progress state.
6. Land in Engine.
7. See clips + timeline.
8. See Publish/Whop handoff.

If this path is not obvious, the Home UX has failed.

### 3.8 Visual priority hierarchy (new)
Decorative glow must never outrank product actions.

1. Primary user action
2. Active workflow
3. Clip/output results
4. Timeline/editing controls
5. Rewards/social handoffs
6. Decorative brand motion

**Colour balance rule:**
- Dark premium base.
- Fuchsia as action/accent only.
- Less glow on passive cards.
- Strong glow only on active/selected/CTA states.
- Reduce background intensity where it fights readability.
- Keep text high contrast.
- Avoid every card competing for attention.

The app should feel premium and energetic, not noisy.

### 3.9 Clipper vs Agency mode split (new)
The app must clearly answer in 10 seconds:

- **Clipper Mode** = make clips, post clips, submit to Whop rewards.
- **Agency Mode** = create clipping campaigns, invite clippers, set campaign watermark, manage outputs.

**Mode strip on Home:** Add a visible toggle above or beside the four task cards:
- “I am clipping for a campaign”
- “I am creating a campaign”

This is a guide, not a blocker. The four task cards remain available to both modes, but primary CTAs shift:
- **Clipper selected** → Join campaign / Generate clips / Submit to Whop.
- **Agency selected** → Create campaign / Set watermark / Invite clippers.

**Capability ownership:**
- Liquid Clips owns: campaign creation UX, watermark composer, clip engine, publishing handoff UX.
- Whop owns in v1: agency tier payments (Whop Checkout), clipper reward tracking/submissions/payouts (Whop Content Rewards).

See `CLIPPER_VS_AGENCY_CAPABILITY_SPLIT.md` for the full capability matrix.

### 3.10 Agency Partner Program / subscription unlock messaging (new)

The app must clearly explain what agencies unlock when they subscribe.

Agency unlock message:

```text
Create clipping campaigns.
Invite clippers.
Lock your campaign watermark.
Launch reward campaigns through Whop.
Share your affiliate link.
Earn 50% MRR from every paid clipper you refer.
```

**Ownership:**

- Whop owns checkout, subscriptions, affiliate/referral tracking, and payouts.
- Liquid Clips owns the UX, copy, dashboard cards, copy-link button, and link-out.

**Generate 100 clips gate:**

- `Generate 100 clips` always appears.
- Free/trial users see it with an upgrade lock label.
- Paid/agency users see it unlocked.
- No real billing wiring.

**Affiliate link UX:**

- Copy-link button with simulator URL.
- Track on Whop link-out.
- No native payout tracking.

See `AGENCY_PARTNER_PROGRAM.md` for full spec.

---

## 4. Final Home layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LC2 Shell: side nav + topbar (avatar orbit, bell, title, watermark)        │
├─────────────────────────────────────────────────────────────────────────────┤
│  HOME CANVAS                                                                │
│  1. Header                                                                  │
│     • Eyebrow: “workstation”                                                │
│     • Headline: “What do you want to make?”                                 │
│     • Subtitle explaining the four intents                                  │
│     • Status pills: tier/quota, connected channels, active campaign         │
│                                                                             │
│  2. Mode strip (Clipper / Agency)                                           │
│     • “I am clipping for a campaign”                                        │
│     • “I am creating a campaign”                                            │
│                                                                             │
│  3. Four large icon cards (2×2, then 1×4 on wide)                           │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│     │  Generate   │ │   Import    │ │ Thumbnails  │ │   Script    │        │
│     │ /Create     │ │             │ │             │ │             │        │
│     └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘        │
│                                                                             │
│  4. Sponsored reward banner carousel (under the four cards)                 │
│     • Hero card + branded carousel from HOME_SCREEN_SCOPE.md                │
│                                                                             │
│  5. Compact campaign / watermark / reward setup strip                       │
│     • Active campaign chip, missions count, engine status, manage button    │
│     • Mode-aware: Clipper sees join/missions; Agency sees create/manage     │
│                                                                             │
│  6. Connect + publish strip                                                 │
│     • Connect channels, Publish via Ayrshare, Schedule, Submit to Whop      │
│                                                                             │
│  7. Recent clips / recent projects strip                                    │
│                                                                             │
│  8. Persona selector (clipper vs campaign owner) — compact footer row       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Four Home cards — required actions

**Card interaction model (new):**
- Big simple card icon at rest.
- Expandable action area when clicked/focused.
- Fast action pills/buttons underneath the card icon.
- Do not force the user to leave Home just to discover options.
- Mode changes visible guidance and primary CTAs, never blocks access.

### 5.1 Mode strip
Home must show a mode strip above the four task cards:

```text
I am clipping for a campaign
I am creating a campaign
```

This changes visible guidance, not app access. Do not block the user.

### 5.2 Generate / Create Clips
All modes show:

```text
Paste YouTube URL
Generate clips
Generate 30 clips
Generate 100 clips
Open Engine
```

**Clipper mode also shows:**

```text
Join campaign
Submit to Whop
```

**Agency mode also shows:**

```text
Create campaign
Set campaign watermark
Invite clippers
```

**Interaction:** This is the most obvious path. Card expands inline to show the URL input + fast action pills. Primary flow: `Paste URL → Generate → Engine`. “Open Engine” routes to `SECTION_EDITOR`.

### 5.3 Import
Must expose clearly:

```text
Drop video file
Import video
Select source
Send to Engine
```

**Interaction:** Click opens an import drawer with a clear drop zone. Drag-and-drop over the whole Home canvas shows the cyan dashed drop affordance from `WorkstationRoom.tsx`.

### 5.4 Thumbnails
Must expose clearly:

```text
Generate thumbnails
Generate 30 thumbnails
Use current source
Open thumbnail placeholder
```

**Interaction:** Click opens a thumbnail drawer / placeholder overlay. Mark future/placeholder features honestly if not real yet.

### 5.5 Script
Must expose clearly:

```text
Write script
Generate hooks
Turn script into clips
Open script placeholder
```

**Interaction:** Click opens a script drawer. Mark future/placeholder features honestly if not real yet.

### 5.6 Social sharing strip (new)
The user must understand how to post/share. Add visible access to:

```text
Connect channels
Publish via Ayrshare
Schedule posts
Submit to Whop rewards
```

These can remain simulator placeholders, but the route/intent must be obvious. Do not bury social sharing in a route the user has to guess.

---

## 6. Final Studio / Engine layout

The Studio / Engine is the main workstation accessed from Home via “Open Engine” or after import/generate.

**Density and whitespace rule (new):** The Engine must feel like a dense workstation / timeline suite / fast edit room, not a dashboard with editing hidden below.

- Reduce empty vertical gaps.
- Reduce oversized headers.
- Bring clip grid and timeline higher.
- Keep timeline visible without scrolling/hunting.
- Make right rail compact.
- Keep source chip / campaign stamp / quota strip compact.
- Do not let shell chrome push the timeline away.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPACT ENGINE HEADER                                                      │
│  • Brand / source chip (thumb + title + duration)                           │
│  • Campaign stamp (avatar + name + watermark handle + locked)               │
│  • Quota bar (exports left)                                                 │
│  • Generate more clips · Export all CTAs                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  SOURCE / IMPORT / GENERATE STRIP                                           │
│  • Import button · URL input · Generate clips · Generate more · Split       │
│  • Script / Transcript context panel                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  CLIP RESULTS GRID                                                          │
│  • Filter chips (All / Score 80+ / Under 30s / Has reaction)                │
│  • Search + sort                                                            │
│  • Clip cards with score, moment, duration, platform badges                 │
│  • Edit / regenerate / connect-account actions per card                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  SELECTED CLIP PREVIEW + RIGHT EDIT RAIL (when overlay open)                │
│  • Canvas 9:16 / 4:5 / 1:1 / 16:9                                          │
│  • Captions / Reframe / Reactions / Layout / Audio / Thumbnail / Post to    │
├─────────────────────────────────────────────────────────────────────────────┤
│  REAL TIMELINE (EngineTimeline — already in desktop-2)                      │
│  • Ruler, video track with waveform, caption blocks, reaction block         │
│  • Playhead, split, trim handles, add b-roll                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  BOTTOM HANDOFF STRIP                                                       │
│  • Export · Schedule · Submit to Whop · Publish via Ayrshare                │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Timeline must stay visible:** Engine must clearly show clip grid, preview/edit suite, right rail, real timeline, playhead, split, add b-roll, caption track, reaction track, and b-roll track.

---

## 7. Overlay / drawer / modal strategy

| User action | Surface type | Why |
|-------------|--------------|-----|
| Click Generate card | **inline expand** | URL input and generate buttons appear inside the card without leaving Home. |
| Click Import card | **drawer** | File list / drop zone slides up from bottom or in from right. |
| Click Thumbnail card | **drawer / placeholder overlay** | No sidecar yet; show placeholder UI. |
| Click Script card | **drawer** | Script editor / hook generator placeholder. |
| Click Browse rewards (hero CTA) | **overlay drawer** | Opens `BrowseRewardsPanel` as a user-triggered overlay, not a globally mounted panel. |
| Click Edit clip | **overlay** | `EngineEditorOverlay` opens full-stage over the grid. |
| Click Connect accounts | **modal** | Small platform-picker modal. |
| Click Whop rewards CTA | **overlay browser** or **external browser** | Prefer overlay for in-app flow; route commerce URLs to system browser per App Store rule. |
| Click Ayrshare publish | **modal** | Channel picker + schedule options. |

---

## 8. Browser panel strategy

**Rule:** bring back the browser, but not as an always-on global panel.

| Aspect | Decision |
|--------|----------|
| Trigger | User-initiated only — from Home reward hero “Browse open campaigns”, Earn section, or Community section. |
| Mount | Overlay / drawer inside the current section, not a persistent right-side panel on every screen. |
| Chrome | React chrome bar (`BrowseRewardsPanel.tsx`) owns back/forward/reload/URL/quick links. |
| Webview | Rust `browse.rs` creates a 560 px webview mounted under the chrome bar when the overlay is open. |
| Commerce filter | Block `/checkout`, `/pay`, `/billing`, `/upgrade`, `/subscribe`, `/purchase`, `/cart` and route those to the system browser. |
| CSP | `media-src https:` required for campaign mp4 banners. |
| Do not port | The v0.7.78 behavior of globally mounting the panel via `AppShell` padding-right should **not** be copied. |

---

## 9. Feature ownership table

### 9.1 Shell / chrome

| Feature | Source reference | Final desktop-2 location | Displayed on | Interaction type | Simulator state needed | Real integration later | Do not port notes |
|---------|------------------|--------------------------|--------------|------------------|------------------------|------------------------|-------------------|
| Side nav rail | `lc2_simulator/index.html` + v0.7.78 | `src/shell/SideNav.tsx` | All sections | route | `activeId` from `useHashRoute` | Persist collapsed state; badge counts from backend | Do not collapse to icon-only until animations are preserved |
| Top bar | `lc2_simulator/index.html` | `src/shell/TopBar.tsx` | All sections | chrome | Section title, watermark | Live status chips, auth state | — |
| Avatar orbit | `lc2_simulator/index.html` + v0.7.78 | `src/shell/AvatarOrbit.tsx` | All sections | overlay opener | Fake account | Clerk session + tier + crown | — |
| Notification bell | `lc2_simulator/index.html` + v0.7.78 | `src/shell/NotificationBell.tsx` | All sections | overlay / sheet | Fake unread count | Real notification feed | — |
| Achievement toast | `lc2_simulator/index.html` | `src/overlays/AchievementToast.tsx` | Home (triggerable) | toast | `show` boolean | Real achievement events | Keep optional trigger in Home for demo |
| Aurora background | `lc2_simulator/index.html` | `src/shell/AppShell.tsx` | All sections | atmosphere | Active route | None | — |
| Signal line | `lc2_simulator/index.html` | `src/overlays/SignalLine.tsx` | All sections | chrome | Fake tickers | Real system status | — |
| Hash router | `src/shell/routes.ts` | `src/shell/routes.ts` | All sections | route | `window.location.hash` | Deep-link bridge `liquidclips://open?section=…` | Do not add React Router; hash router is intentional |

### 9.2 Home

| Feature | Source reference | Final desktop-2 location | Displayed on | Interaction type | Simulator state needed | Real integration later | Do not port notes |
|---------|------------------|--------------------------|--------------|------------------|------------------------|------------------------|-------------------|
| Home header + “What do you want to make?” | `liquid-clips-demo/index.html` (Studio Home) + `lc2_simulator/index.html` | `src/sections/home/HomeSection.tsx` | Home | static | `fakeAccount`, `fakeChannels`, `fakeCampaigns` | Live account / channels / campaigns | — |
| Generate / Create Clips card | `liquid-clips-demo/index.html` + current `HomeSection` | `src/sections/home/HomeSection.tsx` + new `GenerateCard` | Home | inline expand | `url` state, `navigateTo(SECTION_CREATE)`, `navigateTo(SECTION_EDITOR)` | URL ingestion, sidecar pipeline | Keep 48 px icon, fuchsia glow, corner brackets |
| Import card | `liquid-clips-demo/index.html` + `WorkstationRoom.tsx` | `src/sections/home/HomeSection.tsx` + `ImportDrawer` | Home | drawer | `navigateTo(SECTION_CREATE)`, drag-hover state | OS file picker, `importReadyClips` | Import drawer not modal |
| Thumbnails card | `liquid-clips-demo/index.html` + current `HomeSection` | `src/sections/home/HomeSection.tsx` + `ThumbnailDrawer` | Home | drawer / placeholder | `lane` state | Sidecar thumbnail pack generator | Mark `SOON`; no real provider call |
| Script card | `liquid-clips-demo/index.html` + current `HomeSection` | `src/sections/home/HomeSection.tsx` + `ScriptDrawer` | Home | drawer | `lane` state | `lift_transcript` pipeline | Mark `SOON`; no real provider call |
| Home task card hover / scale | `liquid-clips-demo/index.html` | `src/index.css` / card component | Home | inline | CSS only | — | Keep 1.04 scale + fuchsia border + glow |
| Sponsored reward hero card | `HOME_SCREEN_SCOPE.md` §6.2 | `src/sections/home/SponsoredBannerCarousel.tsx` | Home | inline / overlay opener | `fakeCampaigns` or sample JSON | `backend.campaignsList()` | Render hero always first |
| Branded banner carousel + LazyVideo mp4 | `HOME_SCREEN_SCOPE.md` §6.2 | `src/sections/home/SponsoredBannerCarousel.tsx` | Home | carousel | Sample campaigns JSON | `GET /campaigns` + `campaign.banner_url` | No local mp4 file to copy |
| Campaign / watermark / reward setup strip | current `HomeSection` + `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` | `src/sections/home/HomeSection.tsx` | Home | inline | `fakeCampaigns`, `fakeMissions` | Live campaign + entitlement | Show “locked” honestly |
| Connect + publish strip | current `HomeSection` | `src/sections/home/HomeSection.tsx` | Home | inline | `fakeChannels` | Real Ayrshare / Whop state | CTAs route to sections |
| Recent clips strip | current `HomeSection` + `liquid-clips-demo` | `src/sections/home/HomeSection.tsx` | Home | inline / route | `fakeClips` | Library query | — |
| Recent projects strip | current `HomeSection` | `src/sections/home/HomeSection.tsx` | Home | inline / route | `fakeProjects` | Projects query | — |
| Persona selector (clipper / agency) | current `HomeSection` + `lc2_simulator` | `src/sections/home/HomeSection.tsx`, `src/state/mode.ts` | Home | inline | `useModeStore` | Entitlement + user type | Mode strip is primary control; persona cards remain compact below fold |
| Drop video affordance | `WorkstationRoom.tsx` (HOME_SCREEN_SCOPE.md §6.1) | `src/sections/home/HomeSection.tsx` | Home | overlay | `dragHoverActive`, `dropError` | Tauri drag events | Cyan dashed border + Invader sprite |

### 9.3 Engine / Studio

| Feature | Source reference | Final desktop-2 location | Displayed on | Interaction type | Simulator state needed | Real integration later | Do not port notes |
|---------|------------------|--------------------------|--------------|------------------|------------------------|------------------------|-------------------|
| Engine source chip | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EditorSection.tsx` | Editor | static | Fake source title/duration | Ingest result metadata | — |
| Campaign stamp chip | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EditorSection.tsx` | Editor | static | `fakeCampaigns` / `campaignId` param | Live campaign + watermark lock | Always show locked state |
| Quota / exports bar | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EditorSection.tsx` | Editor | static | Fake quota (87/100) | `/usage/probe` or Whop entitlement | No fake paid upgrade numbers |
| Source / import / generate strip | `liquid-clips-engine-desktop2.html` + current `EditorSection` | `src/sections/editor/EditorSection.tsx` | Editor | inline | `sourceUrl`, `generating`, `sourceText` | Sidecar ingest + generate | — |
| Script / transcript toggle | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EditorSection.tsx` | Editor | inline | `activeSourceTab`, `sourceText` | Lifted transcript | — |
| Clip results grid | `liquid-clips-engine-desktop2.html` + `EngineClipGrid` | `src/sections/editor/EngineClipGrid.tsx` | Editor | inline | `fakeClips`, filter/sort/query | Pipeline results | Preserve keyboard shortcuts (`E`, space, Cmd-A) |
| Clip card actions (edit / regen / connect) | `liquid-clips-engine-desktop2.html` + `EngineClipGrid` | `src/sections/editor/EngineClipGrid.tsx` | Editor | inline + modal | `selectedIds`, `connectClip` | Real clip mutations | — |
| Connect accounts modal | `liquid-clips-engine-desktop2.html` + `EngineClipGrid` | `src/sections/editor/EngineClipGrid.tsx` | Editor | modal | `connectClip`, platform set | Ayrshare channel connections | — |
| Engine editor overlay | `liquid-clips-engine-desktop2.html` + current `EngineEditorOverlay` | `src/sections/editor/EngineEditorOverlay.tsx` | Editor | overlay | `overlayClip`, `edit` state | Real editor state | Must remain mounted/rendered |
| Editor right rail tabs | `liquid-clips-engine-desktop2.html` + `EngineRightRail` | `src/sections/editor/EngineRightRail.tsx` | Editor (overlay) | inline | `activeRailTab`, `edit` | Real edit controls | Keep 7 tabs |
| Caption style picker | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EngineRightRail.tsx` | Editor (overlay) | inline | `edit.style` | ASS / libass preview | — |
| Reframe / reactions / layout / audio / thumb / post | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EngineRightRail.tsx` | Editor (overlay) | inline | `edit` sub-state | Sidecar operations | — |
| Engine timeline | `liquid-clips-engine-desktop2.html` + current `EngineTimeline` | `src/sections/editor/EngineTimeline.tsx` | Editor | inline | `overlayClip` duration | Real playback / segments | Must remain mounted/rendered |
| Export / Schedule / Submit to Whop / Publish via Ayrshare CTAs | `liquid-clips-engine-desktop2.html` | `src/sections/editor/EditorSection.tsx` + overlay | Editor | inline + overlay | `handoff` state | Real publish / schedule / submit flows | Whop submits via link-out |

### 9.4 Browser / rewards

| Feature | Source reference | Final desktop-2 location | Displayed on | Interaction type | Simulator state needed | Real integration later | Do not port notes |
|---------|------------------|--------------------------|--------------|------------------|------------------------|------------------------|-------------------|
| Browse rewards overlay trigger | `HOME_SCREEN_SCOPE.md` + `SponsoredBannerCarousel.tsx` | `src/sections/home/HomeSection.tsx`, `src/sections/earn/EarnSection.tsx`, `src/sections/community/CommunitySection.tsx` | Home / Earn / Community | overlay opener | `browseOpen` boolean | User preference | Do not auto-open |
| Browser chrome bar | `HOME_SCREEN_SCOPE.md` §6.3 (`BrowseRewardsPanel.tsx`) | `src/components/BrowseRewardsPanel.tsx` or `src/overlays/BrowseRewardsOverlay.tsx` | Overlay | overlay | `currentUrl`, `loading`, `error` | Rust browse commands | Port verbatim except global mount |
| Native webview panel | `HOME_SCREEN_SCOPE.md` §6 (`browse.rs`) | `src-tauri/src/browse.rs` | Overlay | overlay | Webview window state | Tauri `add_child` | Only create when overlay open |
| Tauri browse commands | `HOME_SCREEN_SCOPE.md` §5 | `src-tauri/src/lib.rs` invoke handler | Backend | command | — | Rust webview APIs | Add `mod browse` + commands |
| Browser bridge (TS) | `HOME_SCREEN_SCOPE.md` (`lib/browse.ts`) | `src/lib/browse.ts` | Frontend | store | `open`, `currentUrl`, `loading` | Event bridge | Use singleton store |
| Campaign sample data | `sample-campaigns.json` | `src/fixtures/fakeCampaigns.ts` (reuse) or new `src/fixtures/sampleCampaigns.ts` | Home / Earn | fixture | Static JSON | `backend.campaignsList()` | Offline only |

### 9.5 Campaigns / Clipper / Earn (shell only)

| Feature | Source reference | Final desktop-2 location | Displayed on | Interaction type | Simulator state needed | Real integration later | Do not port notes |
|---------|------------------|--------------------------|--------------|------------------|------------------------|------------------------|-------------------|
| Campaigns section shell | `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Campaigns | `src/sections/campaigns/CampaignsSection.tsx` | Campaigns | route | `fakeCampaigns`, mode store | Whop campaign creation | Watermark stamp UI only |
| Clipper section shell | `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` §Clipper | `src/sections/clipper/ClipperSection.tsx` | Clipper | route | `fakeMissions` | Whop missions list | Link out to Whop |
| Earn section shell | `LIQUID_CLIPS_0_7_78_UI_UX_STATE.md` + `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` | `src/sections/earn/EarnSection.tsx` | Earn | route | `fakeEarn`, `fakeMissions` | Whop Content Rewards | No native payout numbers |

---

## 10. Current nav (keep as-is)

Keep the existing side nav order unless Daniel approves consolidation:

```text
Home
Create
Studio (Editor)
Library
Schedule
Community
Earn
Campaigns
Clipper
Channels
Account
Settings
Diagnostics
HQ Bridge
```

### Future preferred nav (document only, do not implement)

```text
Home
Studio
Library
Schedule
Community
Earn
Campaigns
Settings
```

**Reason:** The future nav merges `Create` into `Studio`, drops separate `Clipper`/`Channels`/`Account`/`Diagnostics` as top-level items, and keeps `Campaigns` as a top-level lane. Consolidation is deferred until Daniel signs off.

---

## 11. Guard requirements to add later

These become acceptance checks before claiming parity:

### Home guard checks
- [ ] Home has 4 big cards.
- [ ] Home mode strip visible: “I am clipping for a campaign” / “I am creating a campaign”.
- [ ] Home mode strip visible: Clipper Mode / Agency Mode.
- [ ] Generate card has Paste URL.
- [ ] Generate card has Generate clips.
- [ ] Generate card has Generate 30 clips.
- [ ] Generate card has Generate 100 clips.
- [ ] Generate card has Open Engine.
- [ ] Clipper-mode Generate card has Join campaign.
- [ ] Clipper-mode Generate card has Submit to Whop.
- [ ] Agency-mode Generate card has Create campaign.
- [ ] Agency-mode Generate card has Set campaign watermark.
- [ ] Agency-mode Generate card has Invite clippers.
- [ ] Import card has Drop video file.
- [ ] Import card has Import video.
- [ ] Thumbnail card has Generate thumbnails.
- [ ] Thumbnail card has Generate 30 thumbnails.
- [ ] Script card has Write script.
- [ ] Script card has Generate hooks.
- [ ] Social sharing path visible: Connect channels.
- [ ] Social sharing path visible: Publish via Ayrshare.
- [ ] Social sharing path visible: Schedule posts.
- [ ] Social sharing path visible: Submit to Whop rewards.
- [ ] Open Engine path visible.
- [ ] Clipper mode badge present.
- [ ] Agency mode badge present.
- [ ] Campaign Owner label present.

### Engine guard checks
- [ ] `EngineTimeline` is imported and rendered.
- [ ] Engine timeline shows playhead.
- [ ] Engine timeline shows Split control.
- [ ] Engine timeline shows Add b-roll control.
- [ ] Engine timeline shows caption track.
- [ ] Engine timeline shows reaction track.
- [ ] Engine timeline shows b-roll track.
- [ ] `EngineEditorOverlay` is imported and rendered.
- [ ] Right edit rail visible.
- [ ] Export CTA visible.
- [ ] Schedule CTA visible.
- [ ] Submit to Whop CTA visible.
- [ ] Publish via Ayrshare CTA visible.
- [ ] Engine timeline visible without scrolling/hunting.
- [ ] Engine whitespace reduced (dense workstation feel).

### System guard checks
- [ ] Reward banner carousel exists.
- [ ] Browser panel is overlay/drawer only.
- [ ] No fake native payout numbers.
- [ ] No real Whop API calls.
- [ ] No real Ayrshare API calls.
- [ ] No real backend calls in simulator placeholders.
- [ ] Clipper cannot create campaign.
- [ ] Clipper cannot remove campaign watermark.
- [ ] Campaign watermark locked visible on Clipper-facing surfaces.
- [ ] Agency can set/preview watermark in simulator state only.
- [ ] Agency billing is Whop Checkout placeholder only.
- [ ] Clipper rewards are Whop Content Rewards link-out only.
- [ ] Submit to Whop visible.
- [ ] Whop Checkout link-out visible.
- [ ] Whop Content Rewards link-out visible.
- [ ] No native payout tracking in v1.
- [ ] No native view tracking in v1.

---

## 12. Features still missing from desktop-2

After mapping all references, the following gaps remain:

1. **Reward banner carousel on Home** — `SponsoredBannerCarousel` + `LazyVideo` not yet present.
2. **Campaign sample data wired to banners** — sample JSON exists but is not used by Home.
3. **Browse rewards overlay** — browser chrome + webview not yet ported; global panel pattern must be rejected.
4. **Rust browse module** — `src-tauri/src/browse.rs` does not exist in desktop-2.
5. **Tauri browse permissions** — capabilities + `invoke_handler!` entries missing.
6. **Home card inline expansion** — current Home cards route immediately, they do not expand.
7. **Import drawer + drop affordance** — drag-hover overlay and file drop not wired.
8. **Thumbnail and Script drawers** — currently placeholders that set a lane string.
9. **Engine source chip + campaign stamp + quota bar** — not fully styled to match engine demo.
10. **Engine keyboard shortcuts** — `E`, space, Cmd-A not implemented.
11. **Engine publish/schedule/Whop/Ayrshare handoff UI** — CTAs exist but flows are stubbed.
12. **Campaigns / Clipper / Earn section shells** — exist as files but mostly empty.
13. **Avatar panel / notification sheet** — not implemented.
14. **Real backend integration** — everything is fake fixtures.

---

## 13. Recommended implementation batches

All batches use simulator state only. No real integrations.

### Batch 0 — Extend guard (do first)

Add guard checks for the expanded Home, Engine, and mode requirements before coding.

### Batch 1 — Senior UI foundation

- Install minimal Radix primitives: Dialog, Sheet, Drawer, Tabs, Accordion, DropdownMenu, Tooltip, Popover, Select, Switch, Slider.
- Wrap each in Liquid Clips skin (`src/components/ui/*`).
- Refactor existing hand-rolled modals/drawers/toasts to use wrappers.

### Batch 1.5 — Mode system: Clipper vs Agency simulator state

- Create `src/state/mode.ts` Zustand store with `UserMode = "clipper" | "agency"`, default `clipper`, optional `localStorage` persistence key `lc:user-mode:v1`.
- Create `ModeStrip.tsx`, `ModeBadge.tsx`, `CapabilityLock.tsx`.
- No auth. No real tier check. No billing check. Simulator state only.

### Batch 2 — Home 4 big task cards + mode-aware inline/drawer interactions

**Goal:** A 17-year-old can open the app and immediately understand how to make clips and which mode they are in.

- Add prominent mode strip above task cards: “I am clipping for a campaign” / “I am creating a campaign”.
- Refactor `HomeSection.tsx` so each card has a big icon + expandable action area + fast action pills.
- Generate card — all modes: Paste URL, Generate clips, Generate 30 clips, Generate 100 clips, Open Engine.
- Generate card — Clipper mode adds: Join campaign, Submit to Whop.
- Generate card — Agency mode adds: Create campaign, Set campaign watermark, Invite clippers.
- Import card: Drop video file, Import video, Select source, Send to Engine.
- Thumbnails card: Generate thumbnails, Generate 30 thumbnails, Use current source, Open thumbnail placeholder.
- Script card: Write script, Generate hooks, Turn script into clips, Open script placeholder.
- Add visible social sharing strip: Connect channels, Publish via Ayrshare, Schedule posts, Submit to Whop rewards.
- Add drop affordance to Home (cyan dashed overlay + Invader sprite).
- Update Campaigns/Clipper/Earn sections to be mode-aware.

### Batch 3 — Sponsored reward banner carousel

- Port `SponsoredBannerCarousel.tsx` from `HOME_SCREEN_SCOPE.md`.
- Add `LazyVideo` component for `campaign.banner_url` mp4 banners.
- Align `fakeCampaigns.ts` with `sample-campaigns.json` schema.
- Render carousel under Home cards.

### Batch 4 — Engine density / whitespace tightening

- Reduce empty vertical gaps and oversized headers.
- Bring clip grid and timeline higher.
- Keep timeline visible without scrolling/hunting.
- Make right rail compact.
- Keep source chip / campaign stamp / quota strip compact.
- Ensure playhead, Split, Add b-roll, caption track, reaction track, b-roll track are visible.

### Batch 5 — Browser overlay (chrome only, no Rust)

- Create `BrowseRewardsOverlay.tsx` with React chrome bar.
- Trigger from Home reward hero, Earn, Community.
- Use `window.open` fallback; defer Rust `browse.rs`.

### Batch 6 — Connect/publish/share modals

- Build Connect accounts modal.
- Build Publish via Ayrshare + Schedule modals.
- Wire Submit to Whop modal with link-out.

### Batch 7 — Campaigns/Clipper/Earn polish + avatar/notification panels

- Fill Campaigns/Clipper/Earn with final content.
- Add Avatar panel and notification sheet.
- Polish remaining placeholder sections.

---

## 14. Open questions for Daniel

1. **Speed standard approved?** — Is the 60-second / 100-clip target the north star for Batch 2?
2. Should the four Home cards expand inline (accordion), open a centered modal/drawer, or use the blended model (big icon + expandable action area + fast action pills underneath)?
3. Should the browser overlay slide from the right (like v0.7.78) or appear as a centered large drawer?
4. Do we keep the persona selector on Home, or move it to onboarding / settings?
5. Should `Create` section be merged into `Studio` now, or kept separate?
6. Is the future preferred nav (Home / Studio / Library / Schedule / Community / Earn / Campaigns / Settings) approved for implementation?
7. Should Batch 4 (Engine whitespace tightening) happen before or after Batch 3 (reward banners)?

---

## 15. Source-of-truth files to update after implementation

- `docs/lc2/LC2_HOME_STUDIO_MERGE_SPEC.md` (this file) — mark sections complete.
- `LIQUID_CLIPS_2.0_FEATURES_AND_DOORS.md` — update doors matrix if nav changes.
- `HOME_SCREEN_SCOPE.md` — note any LC2 divergences actually taken.
- `src/shell/sectionIds.ts` / `sectionRegistry.ts` — if nav consolidated.
