# Complete Clipper App Gap Map

**Status:** map only — no code changes. Three lanes proposed at the bottom; none started.
**Date:** 2026-06-17
**Working root:** `/Users/dipdip/code/jnr/desktop-2`
**Reference root (read-only):** `/Users/dipdip/code/jnr/desktop` (v0.7.78)
**Scope:** what a *complete* clipper experience looks like, what LC2 has, what it's missing, what to build next.

---

## 1. Current LC2 summary

- React + Tauri + Vite shell. 1681 modules build clean (~336 kB JS / 126 kB CSS gzip 94/20).
- Guard: 371 passed, 0 failed.
- 15 sections registered: Home, Create, Browse, Engine, Projects, Schedule, Channels, Community, Earn, Campaigns, Settings + hidden Clipper / Account / Diagnostics / HQ-Bridge.
- Shipped batches: 0–3 + 2.5. Mode system, gem-pill toggle, Generate-card inline expand, Import/Thumbnail/Script drawers, Agency Partner Program strip, sponsored reward banner carousel + LazyVideo, Engine compact header + sticky right rail + selected-clip preview chip on the timeline, EngineEditorOverlay portal fix.
- Iron gates honoured: IG-003 intro timing constants locked, IG-005 workspace UI structure preserved.
- Brand asset rule active: sample campaigns now point at `/brand/intro/intro-splash.mp4` + `/brand/sponsored/thumb-creator.png` instead of CDN.

---

## 2. Old app features worth preserving (visual + interaction DNA)

| Feature | Old-app component | Why it's worth porting |
|---------|-------------------|------------------------|
| Reward submission capture | `earn/BountySubmissionCapture.tsx` | The honest "paste posted link → submit to Whop" loop |
| Bounty list + detail + swipe | `earn/BountyCard.tsx`, `BountyDetail.tsx`, `BountySwipe.tsx` | Browse open campaigns + open one + commit |
| Brief form | `earn/BriefForm.tsx` | Save-from-browser → campaign |
| Campaign context strip in editor | `earn/CampaignContextStrip.tsx` | Always shows which campaign + watermark + rules apply to the clip you're editing |
| Affiliate hero | `earn/AffiliateHero.tsx` | Agency Partner referral surface (we have a strip; old had a fuller hero) |
| Earn ticker strip | `earn/EarnTickerStrip.tsx` | Live status ticker, HUD vibe |
| Publish modal | `PublishModal.tsx` | Channel picker + scheduling + watermark confirmation |
| Schedule queue | `ScheduleQueue.tsx` + `schedule/` | Drip / queue UI for staggered posts |
| Drop zone | `DropZone.tsx` | Cyan dashed full-room overlay with Invader sprite |
| Overlay source picker | `OverlaySourcePicker.tsx`, `OverlayTemplateGallery.tsx` | Reaction-cam / b-roll picker — pairs with our existing rail |
| Caption granular controls | `captions/` | Word-level highlight + per-style preview |
| Library wall | `library/` | Recent clips wall (we render 3; old app shows the whole wall) |
| First-run | `FirstRun.tsx` | First-time clipper onboarding (Join → Clip → Post → Submit walkthrough) |
| Browser chrome | `BrowseRewardsPanel.tsx` | Chrome bar React controls (back/forward/reload/url/save/close) |
| Browser TS bridge | `lib/browse.ts` | Loading state + error event bus + 10s timeout fallback |

---

## 3. Old app features NOT to copy

| Old behaviour | Why we reject |
|---------------|---------------|
| Global mount of `BrowseRewardsPanel` in `App.tsx` | New rule: user-triggered only |
| `paddingRight: 566` on the shell when browser open | We want overlay-on-top + app-dimmed, not side-panel push |
| Static `currentUrl` on every mount | Fresh-open each time |
| `BriefForm` → real backend save | v1: link out only |
| `EarnTickerStrip` real ticker payload | We render fake/sim status; honest no-numbers rule |
| Old `App.tsx` wholesale | Iron-gate forbidden |
| Old payout numbers in Earn | No native payout numbers ever in v1 |
| Old view counters | No native view tracking ever in v1 |
| Old global `dragHoverActive` listener at App root | Per-drawer / per-surface only |
| Old `IG-008` BottomCockpit `pb-48` hack | We don't have BottomCockpit; don't reintroduce |

---

## 4. Complete clipper journey (end-to-end target)

The journey a clipper performs in v1. Numbered = first-class, lettered = sub-step.

1. **Open app** → splash (28.5 s intro + 5 s loading game) → Home.
2. **Pick mode**: gem-pill toggle → Clipper.
3. **Discover a campaign to clip for**
   a. Home reward banner carousel hero → click "Browse open campaigns".
   b. Browser overlay opens on top of app, app dims behind.
   c. Clipper sees Whop Content Rewards page (or any URL) inside the overlay.
   d. Clipper picks a campaign, the overlay offers "Use this campaign in Engine".
   e. Overlay closes; campaign is now the *active campaign* in the simulator state.
4. **Get source video**
   a. Path A: paste YouTube URL in Generate card → Generate 30 / 100 clips.
   b. Path B: Import card → drag-drop or pick file (simulator only in v1).
   c. Path C: Browser overlay → save a creator's clip as the source (deferred).
5. **Wait for generation** — fake delay, returns clips into the grid.
6. **Open Engine** → see clip grid, source chip, campaign chip + locked watermark, exports-left quota.
7. **Pick a clip** → selected clip preview chip + timeline render together.
8. **Edit the clip** — either inline rail (Captions / Reframe / Reactions / Layout / Audio / Thumbnail / Post to) or full-stage overlay.
9. **Lock watermark check** — clipper sees `Campaign watermark locked` everywhere; cannot remove it.
10. **Connect channels** (per clip) → connect modal → toggle TikTok / Shorts / Reels / X / Facebook (simulator).
11. **Publish** — `Publish via Ayrshare` button opens a Publish modal (channel picker + when-to-post).
12. **Schedule** — `Schedule` button routes to a Schedule queue (drip / one-off).
13. **Submit to Whop rewards** — opens Whop submission link-out, NOT a native form.
14. **Track on Whop** — explicit "track on Whop" link, NEVER a native view counter.
15. **(Loop)** — return to Home / Browser overlay to find the next campaign.

**Today's reality:** steps 1, 2, 6, 7, 8, 9 work; step 3 is partial (no overlay); 4a/4b work in simulator; 5 works; 10 has a connect modal stub; 11–14 are link-out stubs without real modals.

---

## 5. Current LC2 feature inventory

### Shipped + working
- AppShell with side nav (11 visible items), topbar, signal line, achievement toast trigger.
- Hash router (`src/shell/routes.ts`) + section registry.
- Intro splash (28.5 s + 5 s) + Invaders mini-game in loading stage.
- Home: gem-pill mode toggle, mode skin strip (Clipper/Agency mini paths), 4 launcher cards (Generate / Import / Thumbnails / Script), inline Generate expand, Import/Thumbnail/Script drawers via shared `WorkWindowChrome`, Agency Partner Program strip (Agency-only with affiliate link + 50% MRR + Whop honesty chips), connect/publish strip, campaign+watermark strip, recents.
- Sponsored reward banner carousel: hero always first, branded slides (mp4 / image / locked), brand-asset mp4 + thumb, snap/auto-advance/dots.
- Editor section: compact header, source chipbar with Invader sprite, source/script strip (Script/Transcript tab + textarea), clip grid (4–12 clips with score / hook / moment / platforms / select / regenerate / connect / edit), selected-preview chip on the timeline-wrap, EngineTimeline (waveform + caption blocks + reaction track + b-roll track + playhead + split + add-broll), sticky right rail with 7 tabs (Captions/Reframe/Reactions/Layout/Audio/Thumbnail/Post to) and 4 handoff CTAs (Submit to Whop / Publish via Ayrshare / Schedule / Export).
- Engine editor overlay: portal-mounted full-stage editor (ed-top toolbar with back/title/score/regen/ratio/Export + body canvas + rail + bottom timeline).
- Campaigns / Clipper / Earn sections: shell present, mode-aware partial.
- Browse section: separate route (not an overlay).
- Settings: 7 tabs, no passive keychain reads.
- Plan store (`free/trial/agency`), Mode store (`clipper/agency`).
- Brand kit assets present and discoverable.

### Working but thin
- Connect-accounts modal: 5 platforms, simulator only.
- Whop / Ayrshare handoff modals: open external URLs via `openSmart` / `window.open`.
- Project / Schedule / Channels / Community sections: shells with placeholder content.

---

## 6. Missing feature inventory

Sorted by user-journey impact, high → low.

### High — blocks the clipper loop
1. **Browser overlay-on-top** with app dimming. Today: `BrowseSection` is a route, not an overlay; no dim layer; no in-overlay context handoff.
2. **Browser → editor handoff** ("Use this campaign in Engine" → sets `activeCampaignId` in mode store + routes to Engine).
3. **Bounty / campaign detail UI** inside the carousel slide (no detail view exists; click currently link-outs).
4. **Publish modal** with channel picker + when-to-post (today: scrim with a single "Open Ayrshare" button).
5. **Schedule modal / queue** (today: Schedule routes to an empty section).
6. **Reward submission capture** (Whop submit modal with the posted-link input + confirmation copy; today: link-out only).
7. **Split-screen / vertical editor layout polish** (canvas is centred but doesn't show a true split layout when `layout = split` — split track is wired but visually thin).

### Medium — affects clarity
8. **Campaign context strip inside Editor** (always-visible "you are editing for {campaign}" chip with watermark stamp + rules link).
9. **Drop zone overlay** (cyan dashed full-room affordance, Invader sprite, MIME label).
10. **First-run / Clipper onboarding walkthrough** (Join → Clip → Post → Submit guided tour).
11. **Library wall** (Recent clips today is a 3-item strip; should be a full wall with filter).
12. **Earn ticker / status strip** (HUD-flavoured top status; absent today).
13. **Overlay source picker** for reactions / b-roll (today: empty placeholder in rail).
14. **Per-platform handle display** on connect modal (today: platform name only, no @handle).

### Low — polish
15. **On-brand side-nav icons** using `/brand/nav-badges/*.png` instead of Lucide.
16. **Engine quota bar with real probe** (hard-coded 87/100 today).
17. **Achievement system** beyond the single triggerable toast.
18. **Avatar panel** (header avatar opens a sheet).
19. **Notification sheet** (bell currently has a fake `3`).
20. **Settings → mode + plan tier display** (currently no surfacing of current sim state).

---

## 7. Browser overlay + handoff spec

### Trigger surfaces
- Home reward-banner hero CTA ("Browse open campaigns").
- Reward banner slide click (when no in-overlay detail exists, opens overlay to that campaign's URL).
- Earn section "Browse rewards" button.
- Community section "Browse Whop community" button.
- Campaigns section "Open campaign on Whop" button.

### Visual behaviour
- Overlay slides up from the bottom (matches editor overlay motion).
- Main app *dims* behind the overlay — `rgba(0,0,0,0.55)` + `backdrop-filter: blur(6px)` on a scrim layer behind the overlay chrome.
- Overlay is centered, takes ~90vw × ~88vh on desktop, with rounded corners + fuchsia top edge tying to brand.
- Overlay can be dismissed via Esc, X close button, or click outside the chrome (on the dim layer).
- Overlay stays scoped to the app — it does NOT push side-nav content (no `paddingRight: 566` from old app).
- Overlay has a `z-index` above everything except `Dialog` modals.

### Overlay chrome
- Top bar (matches old `BrowseRewardsPanel.tsx` controls): back · forward · reload · URL bar · `Use in Engine ↗` (new!) · `Save as campaign` (deferred) · close X.
- Quick-link chips below the URL bar: Whop Rewards / Clipping.net / Klipy / Opus.
- Below chrome: webview area (v1: React iframe fallback; v2: Rust webview).
- Footer status: loading dot · timeout message + Reload affordance · `Esc to close` hint.

### Webview implementation choice
- **v1 (this build):** plain `<iframe src={currentUrl}>` inside the overlay body, with `sandbox="allow-scripts allow-same-origin"` and CSP allowlist. No Rust.
- **v2 (deferred):** swap iframe for a native Tauri child webview via `browse.rs`, with commerce-URL filter (`/checkout|/pay|/billing|/upgrade|/subscribe|/purchase|/cart` routes to system browser per App Store rule 3.1.1).

### Handoff behaviour
- `Use in Engine ↗` button reads the overlay's current URL + any saved bounty metadata, calls `setActiveCampaignId(...)` on the mode store, closes the overlay, navigates to `SECTION_EDITOR`.
- The Engine then shows the new active campaign in the campaign chip / source chip.
- `Save as campaign` (deferred to v2) opens a `BriefForm`-equivalent modal pre-filled with the current URL + page title.

### Forbidden in this lane
- No global mount.
- No always-on overlay.
- No real Whop API.
- No Rust browse.rs (v2).
- No commerce URL routing (v2).
- No browser save-as-campaign backend write (v2).

---

## 8. Split-screen / vertical editor spec

### Today vs target

| Aspect | Today | Target |
|--------|-------|--------|
| Inline section preview | Selected-clip chip (text + score badge) | Same chip + small canvas thumbnail (~64×112, 9:16) right next to the chip |
| Full-stage canvas (overlay) | Canvas height-driven, fills body row | Canvas height-driven + 4 ratio variants visibly switch + REACTION corner active in `layout=reaction` + true split-stack in `layout=split` |
| Vertical clip cards | Render in grid, click→edit, no strong selected state outside the clip card border | Selected state propagates to selected-preview chip + timeline + right rail in sync (already partial; can sharpen) |
| Right rail | 7 tabs sticky, full controls, handoffs at bottom | Same; add a "Campaign context" mini-strip at the top of the rail showing the locked watermark + rules link |
| Timeline | Pinned at body bottom, anchored fuchsia top edge | Same; add a `Reaction cam imported from Browser` block when the browser handoff includes a reaction source |
| Publish / Schedule / Submit-to-Whop / Export | 4 buttons stacked in rail handoffs | Keep stacked; Publish opens new Publish modal (Lane 3) |
| Campaign watermark locked | `<CapabilityLock label="Campaign watermark locked" />` in rail + chip + home | Keep; visible on EVERY clipper-facing surface |
| Browser handoff into editor | None | New: incoming reaction source / campaign / source-URL appears as a chip beneath source-chipbar |

### "Vertical" specifically
- Clip cards are 9:16 vertical posters (already correct).
- Selected clip's preview chip should mirror the same 9:16 thumb (today shows 64×40 horizontal score badge — should be 64×112 vertical with the score over a poster gradient like clip cards).
- Engine editor overlay canvas at `ratio = 9` is the vertical full canvas (already correct after the overlay fix).
- The selected-state should make the active clip card glow brighter than peers (today: pink border ON sel; could be brighter + pulse).

### Split-stack
- `EngineEditorOverlay.canvas.split` already styles a split layout. Visually it's barely distinguishable from single. Make the top half show the main subject, bottom half show a cyan-tinted "second clip" block with `imported from browser` chip if applicable.

---

## 9. Required icons / controls

Icons we need NOT to invent. Inventory of what already exists vs what's missing.

| Surface | Need | Have? |
|---------|------|-------|
| Side nav | community, earn, learn, library, payouts, schedule, settings, upload, workspace | ✅ `/brand/nav-badges/*.png` (currently Lucide; swap-pending) |
| Tier emblems | free, solo, rookie, climber, growth, pro, autopilot, titan, legend | ✅ `/brand/tiers/*.png` |
| Sponsored slide imagery | creator, fitness, tech, business + placeholder + sponsored badge | ✅ `/brand/sponsored/*.png` |
| Section deck plates | earn, learn, payouts, schedule, settings, upload, workspace, minecraft-submission | ✅ `/brand/decks/*.png` |
| Section atmospheres | earn, library, schedule, settings, workspace | ✅ `/brand/atmospheres/*.png` |
| Invader sprites | grunt, elite, boss, drone, mothership, wasp, player-ship, bullet-player, bullet-invader, splash-bg | ✅ `/brand/invaders/*.png` |
| Brand mark | glyph + wordmark + splash | ✅ `/brand/assets/*` |
| Watermark stamp | made-with-liquid-clips.svg | ✅ |
| Platform icons (TikTok, Shorts, Reels, X, Facebook, YouTube, LinkedIn, Instagram) | Need brand-kit assets | ❌ — currently Lucide / inline SVG |
| Browser chrome icons (back, forward, reload, save, X) | Acceptable as Lucide for v1 | OK with Lucide (utility chrome) |
| Editor rail icons (captions, reframe, reactions, layout, audio, thumb, post-to) | Currently Lucide | OK with Lucide unless brand kit has equivalents |
| Mode toggle icons (Scissors / Briefcase on gem-pill) | Currently Lucide; brand kit has no equivalent | OK with Lucide |

**Net:** the side-nav swap is the single biggest visible "AI tell" left. Everything else has acceptable brand-kit coverage or is utility-chrome where Lucide is OK.

---

## 10. Three-lane build plan

Each lane is sized for **one Claude session** of focused work. Lanes are sequential — Lane 1 first, Lane 2 second, Lane 3 third. NOT to start in parallel because they share files (Editor / HomeSection / mode store).

---

## 11. Lane 1 — Browser overlay + app dimming

**Purpose:** the clipper can open a focused browser overlay on top of the app, browse rewards/campaigns, hand context back into the Engine.

**Files likely touched (estimate)**
- `src/components/browser/BrowseOverlay.tsx` *(new)* — chrome bar + iframe body + footer.
- `src/components/browser/BrowserScrim.tsx` *(new)* — dim layer behind overlay.
- `src/state/browseOverlay.ts` *(new)* — zustand store `{open, currentUrl, history, push, back, forward, reload, openWith, close}`.
- `src/sections/home/HomeSection.tsx` *(touch)* — wire the `Browse open campaigns` and slide-click handlers to `openWith(url)`.
- `src/sections/earn/EarnSection.tsx` *(touch)* — wire its "Browse rewards" button.
- `src/sections/community/CommunitySection.tsx` *(touch)* — same.
- `src/sections/campaigns/CampaignsSection.tsx` *(touch)* — "Open on Whop" → `openWith` (instead of `window.open`) for Agency view.
- `src/sections/editor/EditorSection.tsx` *(touch)* — read `useBrowseOverlay()` to display the "imported from browser" chip when handoff happened.
- `src/index.css` *(touch)* — `.lc-browse-overlay`, `.lc-browse-scrim`, animations.
- `scripts/assert-shell-contracts.sh` *(touch)* — add positive checks: `BrowseOverlay` mounted, scrim present, "Use in Engine" copy, "Esc to close" copy. Negative: no `openBrowsePanel`, no `paddingRight: 566`, no global mount.

**Files forbidden**
- `src-tauri/src/browse.rs` (Rust v2 deferred).
- `src-tauri/src/lib.rs` (no new invoke handler).
- `src-tauri/capabilities/default.json` (no new permissions).
- Anything in `src/sections/editor/Engine*.tsx` internals (EngineTimeline / EngineEditorOverlay / EngineRightRail / EngineClipGrid bodies).
- IG-protected files (intro, watermark composer).
- The old `desktop/src/lib/browse.ts` file (don't import — port the *idea* only).

**User journey enabled**
- 3a → 3e from §4 (browse + pick + handoff).
- Reward-banner hero CTA now actually opens a browser overlay instead of `window.open`-ing.

**What can break**
- The mode store could get inconsistent `activeCampaignId` if handoff fires while the Editor is mid-edit. Mitigate: `openWith` accepts an `intent` enum (`use-in-engine` / `save-as-campaign` / `read-only`), and only `use-in-engine` writes to the mode store on close.
- Iframe CSP blocks some campaign hosts. Mitigate: fallback to `openSmart` (system browser) with a "Open in system browser ↗" button inside the overlay footer for hosts that block embedding.
- Scrim/z-index collision with the Editor overlay. Mitigate: BrowserOverlay z-index = 75, Editor overlay z-index = 80 — Editor wins. Add a guard so opening Browser while Editor is open closes Editor first or queues the handoff.

**Acceptance checklist**
- [ ] Click "Browse open campaigns" on Home → overlay slides up from bottom in <300 ms.
- [ ] App content visibly dims (alpha + blur).
- [ ] Esc / X / scrim-click closes the overlay.
- [ ] Overlay chrome shows: back / forward / reload / URL / Use in Engine / close.
- [ ] Quick-link chips work (Whop Rewards / Clipping.net / Klipy / Opus).
- [ ] `Use in Engine ↗` sets `activeCampaignId`, closes overlay, navigates to `SECTION_EDITOR`.
- [ ] Editor shows an "imported from browser" chip below the source chipbar pointing at the campaign.
- [ ] Side-nav still functional (no `paddingRight: 566`).
- [ ] Guard new positive checks all green.
- [ ] Guard forbidden symbols all absent (`openBrowsePanel`, `close_browse_panel`, etc — already enforced).

**Validation commands**
```
cd /Users/dipdip/code/jnr/desktop-2
npm run build
npm run guard
npm run tauri dev   # exercise: open Home → Browse open campaigns → Use in Engine
```

---

## 12. Lane 2 — Editor split-screen / vertical cockpit

**Purpose:** sharpen the Engine to a true vertical clipping cockpit — selected-clip preview gets a thumb, split layout visually splits, campaign context strip lives in the rail, drop zone returns.

**Files likely touched (estimate)**
- `src/sections/editor/EditorSection.tsx` *(touch)* — selected-preview chip now renders a 9:16 thumb beside the title; campaign context strip added to top of right rail.
- `src/sections/editor/EngineEditorOverlay.tsx` *(touch)* — `canvas.split` visual treatment: cyan-tinted bottom half + "imported from browser" or "second clip" chip.
- `src/index.css` *(touch)* — `.lc2-engine-selected-thumb` becomes 9:16 with subject blur, `.lc2-engine-canvas.split` gets stronger visual divide.
- `src/components/cockpit/DropZone.tsx` *(new)* — full-room cyan dashed overlay with Invader sprite + MIME label.
- `src/sections/home/HomeSection.tsx` *(touch)* — DropZone mounted at section root with `dragHoverActive` state local to Home (not global).
- `src/sections/editor/EngineRightRail.tsx` *(touch — minimal)* — add a `<CampaignContextStrip>` slot at the rail top.
- `src/components/editor/CampaignContextStrip.tsx` *(new)* — eyebrow + campaign name + stamp + locked + rules link, no `BountyDetail` heavy import.

**Files forbidden**
- `src/sections/editor/EngineTimeline.tsx` internals (visual on the wrap only, not the timeline JSX).
- `EngineClipGrid.tsx` internals (clip card layout stays).
- Old `desktop/src/components/cockpit/*` files (use as visual reference, do not import).
- Anything in `src-tauri`.

**User journey enabled**
- 6 → 9 from §4 (the entire edit phase becomes cockpit-grade).
- Drag-drop to Home shows a clear target (no real file pickup yet).
- Selected clip is unmistakable on every surface.

**What can break**
- DropZone overlay z-index collisions with the gem-pill toggle or carousel hover. Mitigate: `pointer-events: none` + z-index 30 (below modals).
- Campaign context strip in rail might steal sticky-rail scroll budget. Mitigate: strip is `position: sticky; top: 0` *inside* the rail.
- Split-canvas visual could break the existing reaction-corner positioning. Mitigate: only restyle, don't reposition `.lc2-engine-reaction-*`.

**Acceptance checklist**
- [ ] Selected-clip preview chip now shows a 9:16 thumb with the score badge overlaid.
- [ ] Switching ratio to `1` / `4:5` / `16:9` in the overlay cleanly resizes the canvas without layout jump.
- [ ] `layout = split` produces a visually split frame (top subject / bottom cyan placeholder).
- [ ] Drag a file over Home: cyan dashed overlay + Invader sprite + "Drop a video to start" text.
- [ ] Drop is non-functional (no real file pickup) but the affordance dismisses on `dragleave`.
- [ ] Campaign context strip visible at top of right rail in Editor, hidden in overlay (since overlay has its own top bar).
- [ ] All existing handoffs still visible (Submit to Whop, Publish, Schedule, Export).
- [ ] Build + guard green; no new orphaned imports.

**Validation commands**
```
cd /Users/dipdip/code/jnr/desktop-2
npm run build
npm run guard
npm run tauri dev   # exercise: open Engine → click clip → see thumb chip; click Edit → switch ratios; drag a file over Home
```

---

## 13. Lane 3 — Complete clipper journey / publish-submit flow

**Purpose:** finish the publish / schedule / submit-to-Whop modals + Earn submission capture so the loop is end-to-end usable (simulator).

**Files likely touched (estimate)**
- `src/components/publish/PublishModal.tsx` *(new)* — channel picker (TikTok/Shorts/Reels/X/Facebook/YouTube/LinkedIn/Instagram) + when-to-post (Now / Add to drip / Schedule date) + caption preview + watermark confirmation chip. No real Ayrshare call.
- `src/components/publish/ScheduleQueue.tsx` *(new)* — list of fake scheduled posts with status (Pending / Posted / Failed) + drip cadence picker. No real backend.
- `src/components/whop/WhopSubmitModal.tsx` *(new)* — input for the posted-link URL + "Submit to Whop" CTA that opens Whop submission URL + honest "no native tracking" copy.
- `src/sections/editor/EditorSection.tsx` *(touch)* — replace inline handoff scrim with the three new modals.
- `src/sections/schedule/ScheduleSection.tsx` *(touch — fill out)* — mount `ScheduleQueue` + provide list of fake scheduled posts.
- `src/sections/earn/EarnSection.tsx` *(touch — fill out)* — mount `WhopSubmitModal` trigger + honest submission tracker (link-out chips).
- `src/fixtures/fakeSchedule.ts` *(new)* — sample scheduled posts (no payout / view numbers).
- `scripts/assert-shell-contracts.sh` *(touch)* — positive: PublishModal mounted, WhopSubmitModal mounted, ScheduleQueue mounted, "Post now" / "Add to drip" copy. Negative: no view-count number, no $ payout number, no native API.

**Files forbidden**
- Anything calling real Whop, Ayrshare, junior-backend, or Stripe.
- Anything writing to disk / OS file picker.
- `src-tauri/*`.
- `EngineTimeline` / `EngineEditorOverlay` internals.

**User journey enabled**
- 10 → 14 from §4 (the post-edit phase becomes a real flow instead of link-outs).

**What can break**
- Loading state on a fake "Schedule post" could leak if the user closes the modal mid-action. Mitigate: optimistic state with rollback on close.
- Honesty rule violations if any view count / $ figure slips in. Mitigate: guard explicitly fails on `views` / `$` numeric fixtures.

**Acceptance checklist**
- [ ] Click `Publish via Ayrshare →` from Editor → PublishModal opens with channel picker.
- [ ] Toggle channels visibly, preview caption, watermark-locked chip visible.
- [ ] Click "Post now" → spinner → simulator success toast → modal closes.
- [ ] Click `Schedule →` from Editor or top nav → ScheduleSection renders queue with fake posts.
- [ ] Click `Submit to Whop rewards →` → WhopSubmitModal opens with posted-link input + honest "no native tracking" copy + "Open Whop" CTA that link-outs.
- [ ] No native payout numbers anywhere.
- [ ] No real provider call.
- [ ] Guard green; new acceptance phrases present; forbidden patterns absent.

**Validation commands**
```
cd /Users/dipdip/code/jnr/desktop-2
npm run build
npm run guard
npm run tauri dev   # exercise: open Editor → Publish → channel pick → Post now; Schedule → queue; Submit to Whop → modal
```

---

## 14. Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| iframe CSP blocks Whop / Clipping.net inside browser overlay | High for Lane 1 | Detect `frame-ancestors` error via `onError` → show "Open in system browser ↗" fallback footer button. |
| Browser overlay + Editor overlay z-index collision | Medium | Editor overlay 80, Browser overlay 75; opening Browser while Editor is open closes Editor first OR queues the handoff. |
| Persistent `activeCampaignId` from Browser handoff confuses repeat visits | Medium | `setActiveCampaignId(null)` on overlay open; only set on `Use in Engine`. Honest UI: "Active campaign: X (set from browser at 2:14 PM)". |
| DropZone overlay swallows clicks on Home | Medium for Lane 2 | `pointer-events: none` on the dashed overlay; only the inner Invader chip catches drop events. |
| Per-platform handles in PublishModal are fake (`@alex.edits`) — could be mistaken for real | Low for Lane 3 | Tag every fixture handle with `(sim)` suffix until real Ayrshare connect. |
| Honesty guard regression — a number slips into Earn / Publish | Low for Lane 3 | Existing guard catches `Earn — no fake native reward numbers`; extend to Publish and Whop submit copy. |
| Iron Gate IG-005 (workspace UI) violated by Lane 2 | Low | Lane 2 is CSS + new wrapper components; no EngineTimeline / EngineEditorOverlay JSX changes. Iron-gate-lens before edits. |

---

## 15. Guardrails

These remain locked across all three lanes:

- No copying `desktop/src/App.tsx`.
- No real Whop / Ayrshare / FFmpeg / sidecar / backend wiring.
- No native payout tracking.
- No native view tracking.
- No `BrowsePanel` / `BrowserEdgeTab` / `openBrowsePanel` / global panel names.
- No new perspective / transform on `.lc-page` (would break the overlay portal pattern).
- No nav collapse.
- No route-ID changes.
- No intro timing constant changes (`INTRO_DURATION_MS = 28_500`, `LOADING_MIN_HOLD_MS = 5_000` — IG-003).
- No removal of `Campaign watermark locked` from any clipper-facing surface.
- No bypass of `bespoke-craft` rule: every visual that has a `/brand/*` equivalent must use it.
- No "AI yellow" / external CDN stock visuals in any fixture or component.
- Build + guard must remain green at the end of every lane.
- No push to remote until Daniel explicitly approves the bundled batch.

---

## 16. Recommended next patch order

**Lane 1 first.** Reasoning:
1. The clipper journey starts at *discovery* — without the browser overlay, steps 3a–3e of the journey are stubbed and there is no honest path to "find a campaign and start clipping."
2. Lane 1 unlocks the handoff that Lane 2 (campaign context strip) and Lane 3 (Publish/Submit modals receiving an `activeCampaignId`) both consume. Building Lane 2 or Lane 3 first would force re-touching them after Lane 1 lands.
3. Lane 1 is the **smallest** of the three (3 new components + scrim + store + ~6 touch points), so it lands faster and de-risks the handoff contract early.
4. Lane 1 has the highest visible-quality lift: app dimming + chrome overlay is the most "designed" moment in the app outside the splash.

**Then Lane 2** (split-screen / vertical cockpit). It consumes the handoff from Lane 1 to show "imported from browser" context, and sharpens the visible cockpit that Daniel keeps flagging.

**Then Lane 3** (publish + schedule + submit-to-Whop modals). Closes the post-edit half of the loop.

Estimated effort per lane: Lane 1 ≈ 280 lines + CSS, Lane 2 ≈ 220 lines + CSS, Lane 3 ≈ 380 lines + fixtures + CSS.

---

## Open questions for Daniel before Lane 1 starts

1. **Browser overlay size** — 90vw × 88vh (cinematic), 80vw × 84vh (focused), or full-bleed minus side-nav?
2. **Browser overlay dim** — pure black at 55% + 6 px blur, or fuchsia-tinted dim?
3. **`Use in Engine ↗` button** — show in chrome top bar always, or only when overlay current URL matches a known reward-platform pattern (whop.com, clipping.net, klipy.com, opus.pro)?
4. **Browser handoff identity** — does "Use in Engine" set the *campaign* (which fixture campaign?) or just the *active source URL* for the Engine's paste-URL flow?
5. **Quick-link chips** — keep old set (Whop / Clipping.net / Klipy / Opus) or trim to only Whop in v1?
6. **iframe CSP fallback** — if a host blocks embedding, do we silently link out, or show the "Open in system browser ↗" button explicitly?
7. **Esc to close priority** — Esc should close Browser overlay first, then Editor overlay, then Dialog modals — confirm priority chain?
