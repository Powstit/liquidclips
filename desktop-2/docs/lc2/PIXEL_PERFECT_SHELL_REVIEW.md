# Pixel-Perfect Shell Review — LC2 desktop-2

**Reviewer:** `pixel-perfect-product-lens` (installed `~/.claude/skills/pixel-perfect-product-lens/SKILL.md`)
**Date:** 2026-06-17
**Subject tree:** `/Users/dipdip/code/jnr/desktop-2`
**References:** `/Users/dipdip/code/jnr/desktop` · `/Users/dipdip/Desktop/liquid-clips-demo/index.html` · `/Users/dipdip/Desktop/liquid-clips-engine-desktop2.html` · `/Users/dipdip/Desktop/Liquid_Clips_2_Starter_Kit`
**Reviewed screenshots:**
- `screenshots/home-clipper.png` ✅
- `screenshots/home-agency.png` ✅
- `screenshots/generate-expanded-clipper.png` ✅
- `screenshots/generate-expanded-agency.png` ✅
- `screenshots/audit-splash-logo.png` ✅
- `screenshots/batch3-home-clipper-free.png` ✅ (added this turn)
- `screenshots/batch3-home-agency-paid.png` ✅
- `screenshots/batch3-home-agency-fullpage.png` ✅
**Missing screenshots:** none (all referenced screenshots exist).

---

## 0. Headline

The shell is on the right side of the line — it's clearly Liquid Clips, not generic SaaS. But there are **eight loud AI-slop tells** that betray "agent-built" over "designer-built": the mode toggle is a text pair instead of the reference gem-pill, the splash logo is undersized, the agency banner area uses third-party CDN visuals, eyebrow labels appear twice on the same strip, persona cards at the footer duplicate the mode strip at the top, card alignment mixes centred icons with left-aligned text, action pills are a flat row instead of a grouped intent block, and side-nav icons read as Lucide defaults rather than a custom HUD set.

The bones are right. The signal-to-noise needs one polish pass before Batch 3 ships to Daniel.

---

## 1. Visual DNA transfer map

For each surface — what old-app DNA to copy now, defer, never copy, or already good.

| Surface | Copy now | Defer | Do not copy | Already good |
|---------|----------|-------|-------------|--------------|
| **Home — overall** | spacing rhythm from `liquid-clips-demo/index.html` (long vertical breaths between strips, tighter inside each strip) | full Whop edge tab — Batch 5 | global mounted browser; old `WorkstationRoom.tsx` IG-008 pb-48 cockpit-clearance hack | black/pink shell, 4-card grid concept, mode-aware extras |
| **Mode switch** | the reference gem-pill path (your Image #6) — circular gem nodes with pink halos, connecting rail, icon inset | per-step deep-link routing | the old "I am a clipper / I am a campaign owner" copy literally; replace with active-node visual | the canonical pair Clipper / Agency |
| **Generate / Create expanded panel** | old demo's "Paste a YouTube URL" inline panel framing (mono eyebrow, large input row, primary CTA pair right) | URL-paste smart-router | old `CreatePortal` modal pop pattern (we want inline, not modal) | inline-expand decision and the four required pills (Generate / 30 / 100 / Open Engine) |
| **Import work-window** | old Workstation drop affordance (cyan dashed border + Invader sprite as drop landmark) — visual only | Tauri drag-enter wiring (Batch 6) | old global drop listener; old OS-picker modal sequence | bottom-Sheet drawer pattern, "Send to Engine" handoff |
| **Thumbnail work-window** | old demo's "card stack" preview thumbnails — three angled rectangles as the icon, not a single image-icon | Sidecar generator wiring | old `ThumbnailStudio` modal stack | "SOON" badge honesty, drawer pattern |
| **Script work-window** | old demo's transcript-as-strip (vertical mono lines), not a flat textarea | `lift_transcript` real pipeline | old Script editor's auto-save that wrote half-states | "SOON" badge honesty, drawer pattern |
| **Reward banner area** | old `SponsoredBannerCarousel` visual rhythm: hero card always first, 4:1 slides, mono brand eyebrow, pink rounded CTA | LazyVideo intersection-observer behaviour | external CDN mp4 / unsplash banners — **swap to custom-generated visuals per `bespoke-craft` rule** before any shipping push | hero copy "Turn clips into paid campaigns", structural carousel |
| **Engine / workstation** | old engine demo's tight density: header strip → source/import strip → grid → preview → timeline anchored to bottom edge | full structural restructure (Batch 4) | the v0.7.x quota-bar hardcode bug | EngineTimeline + EngineEditorOverlay mounted, source chip + campaign stamp present |
| **Side nav** | old demo's HUD-style nav glyphs (chunky pixel-arcade strokes) over Lucide defaults | collapse-to-icon mode | old badge count source from backend | rail position, fuchsia active bar, halo motion |
| **Splash / game UI** | the old splash logo SIZE — it's at least 1.6× the current — and the Invader sprite as the loading character | full intro cinematic (locked IG-003) | the legacy auto-skip-on-click during the first 5 s | SCORE/BEST HUD, Press Start to play, Continue → button |
| **Affiliate / Partner strip** | old demo's "available on" tier-chip row with gold accents | real affiliate URL minting | the v0.7.x "earn $X this month" fake number | "Agency Partner Program" eyebrow, 50% MRR copy, Whop ownership note |
| **Campaign / watermark strip** | old engine demo's compact 4-chip strip (mode · watermark · missions · engine status) | real watermark composer | the old watermark removal toggle | locked watermark badge, current-mode chip |

---

## 2. Per-surface deep review (skill output format)

### 2.1 Home — overall

1. **Surface reviewed:** `src/sections/home/HomeSection.tsx` rendered in Clipper + Agency + free + paid modes.
2. **Product intent:** Launcher. "What do you want to make?" — must answer in 2 seconds.
3. **What works:** 4 big cards are obviously launchable. Mode skin strip and per-mode partner strip differentiate cleanly. Carousel mounts under the cards in the right place.
4. **What looks AI/sloppy:**
   - Eyebrow `CLIPPER MODE` immediately above the path label `JOIN` / `CLIP` / `POST` / `SUBMIT` reads twice — the path already names the mode.
   - Mode toggle ("I am clipping for a campaign / I am creating a campaign") is text-flat — should be the gem-pill path (Image #6 reference).
   - Persona cards at the footer duplicate the mode strip at top. One has to go.
   - "Engine ready · sidecar · simulator mode" reads like dev-log debug, not user copy.
5. **What blocks usability:** Nothing critical. CTAs reachable, path obvious.
6. **Old-app DNA to copy:** demo's vertical rhythm between strips; demo's mono uppercase eyebrows above every region.
7. **Old-app behaviour not to copy:** the IG-008 BottomCockpit pb-48 clearance hack; the always-on browser panel.
8. **Patch recommendation:** Replace text mode toggle with gem-pill node path. Remove persona-card duplicate at footer. Rewrite "sidecar · simulator mode" chip copy.
9. **Risk level:** Low (CSS + small JSX).
10. **Verdict:** **APPROVE WITH MINOR POLISH**

### 2.2 Mode switch

1. **Surface:** `ModeStrip.tsx` + `lc-home-mode-skin` strip.
2. **Intent:** Tell the user in 2 seconds whether the page is showing them Clipper or Agency capabilities.
3. **Works:** Mode-skin strip with colour shift + headline + mini path is the strongest single visual differentiator on the screen.
4. **AI/sloppy:** Text toggle above the path is redundant with the mode-skin headline. Looks like two competing controls for the same state.
5. **Blocks usability:** Mode toggle visually flat — users may not realise it's interactive.
6. **DNA to copy:** the reference gem-pill (Image #6) — 5 circular nodes, pink halo on active, thin connecting rail. This becomes the toggle AND the path. One control, not two.
7. **DNA not to copy:** old demo's text pair literally.
8. **Patch:** Convert `ModeStrip` to the gem-pill design. Clicking a node sets the mode. Active node has the bright halo. Inactive nodes are dim with thin ring. This single change removes the duplicate eyebrow problem and matches Daniel's reference exactly.
9. **Risk:** Low (component swap, CSS-heavy).
10. **Verdict:** **PATCH BEFORE NEXT BATCH** — biggest single uplift available.

### 2.3 Generate / Create expanded panel

1. **Surface:** Generate launcher card in expanded state.
2. **Intent:** Paste a URL → start a generate job → end in Engine.
3. **Works:** URL input is the first thing inside the panel. Four primary pills are honest about scale (clips · 30 · 100 · Open Engine).
4. **AI/sloppy:** Mode extras row visually equal to primary pills — they should sit lower with a divider or smaller weight, so "Generate clips" stays the loudest action.
5. **Blocks usability:** Nothing critical.
6. **DNA to copy:** old demo's `lc-cta-row` rhythm — primary pill larger, mode extras under a thin rule.
7. **DNA not to copy:** old CreatePortal modal pop pattern (we already chose inline-expand, keep it).
8. **Patch:** Add a thin `.lc-row-divider` between primary action grid and mode extras. Demote mode extras to `data-size="sm"` so the primary pills win the scan.
9. **Risk:** Very low.
10. **Verdict:** **APPROVE WITH MINOR POLISH**

### 2.4 Import / Thumbnail / Script work-windows

1. **Surface:** `ImportDrawer.tsx`, `ThumbnailDrawer.tsx`, `ScriptDrawer.tsx`.
2. **Intent:** Open a focused work surface without leaving Home context.
3. **Works:** Bottom-sheet pattern with primary + Engine handoff is the right shape.
4. **AI/sloppy:** No visible "work-window" chrome. Drawers feel like modals. No close-X visible in some.
5. **Blocks usability:** Inconsistent: each drawer has a different title weight, different button count, no shared handoff button position.
6. **DNA to copy:** old workstation's "chrome-bar" feel — title row · breadcrumb-back · close-X · body · primary CTA in fixed position. Same pattern across all three drawers.
7. **DNA not to copy:** old global drop listener pattern.
8. **Patch:** Audit all three drawers; one shared `<WorkWindowChrome>` wrapper component; title at top-left, close-X top-right, primary CTA pinned bottom-right, Engine handoff bottom-left.
9. **Risk:** Low — single new wrapper component, no behaviour change.
10. **Verdict:** **PATCH BEFORE NEXT BATCH**

### 2.5 Reward banner area (Batch 3 — just shipped)

1. **Surface:** `SponsoredBannerCarousel.tsx`.
2. **Intent:** Show that reward campaigns exist and route to them.
3. **Works:** Hero card renders instantly, carousel below, mp4/image/locked branches all live.
4. **AI/sloppy:** Banner images come from external CDN (`cdn.coverr.co`, `images.unsplash.com`). Violates `bespoke-craft` — Daniel's "if you don't generate everything, you give me AI slop" rule. This is acceptable for sample data integrity but must be swapped for custom-generated visuals before any shipping push.
5. **Blocks usability:** Slide content is barely legible because the gradient overlay is weaker than the slide images. Status pill `LIVE · 6 DAYS LEFT` competes with brand name for attention.
6. **DNA to copy:** old `SponsoredBannerCarousel.tsx` pixel-for-pixel (already done, mostly).
7. **DNA not to copy:** old `backend.campaignsList()` live call.
8. **Patch:** (a) Stronger left-side gradient on slides so text reads cleanly over any banner. (b) Replace external CDN banner URLs with locally-generated custom visuals (or leave as sample-only and document in `bespoke-craft` note).
9. **Risk:** Low for gradient; medium for asset swap (asset generation needed).
10. **Verdict:** **APPROVE WITH MINOR POLISH** — landed but needs the gradient bump.

### 2.6 Engine / workstation

1. **Surface:** `EditorSection.tsx`, `EngineTimeline.tsx`, `EngineEditorOverlay.tsx`.
2. **Intent:** Edit a clip end-to-end: preview · split · b-roll · captions · publish.
3. **Works:** EngineTimeline + EngineEditorOverlay mount cleanly. Source chip + campaign stamp present. All four export/schedule/submit/publish CTAs present.
4. **AI/sloppy:** Dead vertical black space above the timeline. Right rail at 280px competes with the preview for width. Source chip uses a blank placeholder thumb that reads as "TODO sprite missing."
5. **Blocks usability:** Timeline may need scroll on smaller viewports.
6. **DNA to copy:** old engine demo's compact header + bottom-anchored timeline.
7. **DNA not to copy:** v0.7.x hardcoded quota bar.
8. **Patch:** Defer to Batch 4 per Daniel's rule — only CSS-only quick wins allowed now. Two are: (a) replace blank source-chip thumb with a coloured Invader sprite, (b) reduce empty top-spacer by `--space-2`.
9. **Risk:** Low for the two CSS tweaks; the rest waits.
10. **Verdict:** **APPROVE WITH MINOR POLISH** for now; Batch 4 owns the cockpit restructure.

### 2.7 Side nav

1. **Surface:** `SideNav.tsx`.
2. **Intent:** Switch sections.
3. **Works:** Vertical rail, fuchsia active bar, badge floats, halo motion. Reads as Liquid Clips.
4. **AI/sloppy:** Icons are off-the-shelf Lucide. They render as the same weight as everywhere else on the web. They are the most "AI-generated UI" tell on the screen — every dashboard built by an LLM uses Lucide.
5. **Blocks usability:** Nothing critical.
6. **DNA to copy:** the old app's HUD-style chunky pixel-arcade glyphs (in `desktop/src/components/cockpit/...`).
7. **DNA not to copy:** old badge count fetcher.
8. **Patch:** Defer — icon set replacement is its own work and falls under `bespoke-craft`. Document in punch list.
9. **Risk:** Medium (custom icon production).
10. **Verdict:** **APPROVE WITH MINOR POLISH** for shell sign-off; track custom icons separately.

### 2.8 Splash / game UI

1. **Surface:** `IntroSplash.tsx`, `SplashGame.tsx`.
2. **Intent:** Brand reveal + invader micro-game while the app warms up.
3. **Works:** SCORE/BEST mono HUD, "Press space to play," Continue → CTA. Honest progressive enhancement.
4. **AI/sloppy:** Logo is too small. Daniel called this out: "logo is too small." It currently sits at h-16 w-16 (64×64) inside a centered flex column. The brand mark deserves at least h-28 w-28, possibly h-32 with the wordmark grown to match.
5. **Blocks usability:** Skip button visible top-right, good. But there's no escape if a user wants to play out the game.
6. **DNA to copy:** v0.7.x splash mark size.
7. **DNA not to copy:** legacy auto-skip-on-first-click during the first 5 s.
8. **Patch:** CSS-only scale-up of logo. Iron Gate IG-003 protects timing — verify constants unchanged before edit.
9. **Risk:** Very low (CSS), but iron-gate-lens MUST fire first.
10. **Verdict:** **PATCH BEFORE NEXT BATCH** — Daniel-flagged.

### 2.9 Affiliate / Partner strip (Batch 2 — just shipped)

1. **Surface:** `lc-home-partner-strip` in `HomeSection.tsx`.
2. **Intent:** Tell the agency user what they can earn by sharing their link.
3. **Works:** Gold-accent strip, "Agency Partner Program" eyebrow, three tier chips, honest Whop framing.
4. **AI/sloppy:** Three CTAs in a row (`Share your affiliate link` + `Payouts handled by Whop` + italic note) look like three buttons. Only the first is a button — second + third are informational. Visual weight conflicts with meaning.
5. **Blocks usability:** User might click "Payouts handled by Whop" expecting an action.
6. **DNA to copy:** old demo's "available on" tier-chip row pattern.
7. **DNA not to copy:** the old "earn $X this month" fake number that this strip carefully avoids — keep avoiding.
8. **Patch:** Make "Payouts handled by Whop" a non-button text chip with lock icon, not styled like a button. Keep "Share your affiliate link" as the only button.
9. **Risk:** Very low.
10. **Verdict:** **APPROVE WITH MINOR POLISH**

### 2.10 Campaign / watermark strip

1. **Surface:** `lc-home-campaign-strip` in `HomeSection.tsx`.
2. **Intent:** At-a-glance status of mode · watermark · missions · engine.
3. **Works:** Four chips, compact, locked-watermark badge visible per honesty rule.
4. **AI/sloppy:** Engine-status chip says "sidecar · simulator mode" — that's dev jargon visible to users. Should say "Simulator · No real backend" or similar honest user-language.
5. **Blocks usability:** Nothing.
6. **DNA to copy:** old engine demo's 4-chip compact strip rhythm.
7. **DNA not to copy:** none — this is the simulator-honesty model.
8. **Patch:** Rewrite the engine-status chip copy.
9. **Risk:** Trivial.
10. **Verdict:** **APPROVE WITH MINOR POLISH**

---

## 3. Top 10 AI-slop risks found (ranked by visual cost)

1. **Mode toggle is text + text** — the reference gem-pill (Image #6) is the single biggest uplift available. Text pair reads "agent built a tab control."
2. **Splash logo undersized** — Daniel-flagged. Reads as default-sized rather than designed.
3. **Persona cards at footer duplicate the mode strip at top** — two controls for the same state on the same page is an AI tell.
4. **Mode eyebrow + mini-path label show the mode name twice** ("AGENCY MODE" + "AGENCY" or `Agency Mode` heading + path label).
5. **Side nav uses default Lucide icons** — the single most-common "AI built this UI" tell across the web.
6. **External CDN visuals in the reward carousel** — `cdn.coverr.co` + `images.unsplash.com` violate `bespoke-craft`.
7. **Drawer chrome inconsistent** — Import/Thumbnail/Script each have a different layout. AI-built drawers feel "one-off."
8. **"sidecar · simulator mode" leaks dev jargon to user-facing copy.**
9. **Action pills in Generate expanded all weighted equally** — no primary-pill emphasis.
10. **Source chip in Engine has a blank thumb placeholder** — reads as a missing asset.

---

## 4. Top 10 old-app DNA items to copy

1. **The gem-pill mode path** (Image #6 reference, also implied by old demo's mission-path strip).
2. **Splash logo scale** — v0.7.x rendered the mark substantially larger than the current 64px.
3. **Uppercase Geist Mono eyebrows everywhere** — old demo uses these aggressively (10–11px, letter-spacing 0.10–0.18em) as the dominant HUD voice. desktop-2 has them but inconsistently.
4. **Cyan dashed drop-zone with Invader sprite landmark** for Import drawer (currently a generic dashed rectangle).
5. **Compact 4-chip status strip** for campaign/watermark — old engine demo's exact rhythm.
6. **Bottom-anchored timeline** in Engine — never let the timeline float in dead space.
7. **Hero-card-always-first rule** for the carousel (already followed — good).
8. **`lc-cta-row` primary/secondary pill hierarchy** with thin divider — for Generate expanded panel.
9. **Tier chip row with gold accent** for Agency Partner Program "available on" (already followed — minor cleanup).
10. **Three-rectangle stack icon** for Thumbnail card (old demo's specific icon), instead of generic image-icon.

---

## 5. What is already good (don't touch)

- Mode-skin strip per-mode colour variables — pink+cyan (Clipper), pink+gold (Agency).
- Mini-path mono pills (JOIN/CLIP/POST/SUBMIT and CREATE/INVITE/REVIEW/GROW) — they're correct HUD style, just need to merge with the mode toggle into the gem-pill control.
- 4-card launcher grid sizing and corner brackets.
- Inline-expand for Generate (correctly chosen over drawer).
- Bottom-Sheet drawer choice for Import/Thumbnail/Script.
- Campaign Partner strip in Agency mode only.
- Hero-first carousel structure.
- Capability lock badge ("Campaign watermark locked").
- Build/guard green, 347/0.
- All required honesty guards (no native payout numbers, no real Whop/Ayrshare wiring, no `Partner Program tier` implication, no clippers-remove-watermark phrasing).

---

## 6. What should be patched BEFORE Batch 3 ships

> **Note:** Batch 3 (`SponsoredBannerCarousel + LazyVideo + sampleCampaigns`) is *already shipped this turn*. "Before Batch 3" in your prompt phrasing now reads as "before Batch 3 is reviewed and approved by you." These are the items to land in a single **Batch 2.5 polish patch**:

1. **Splash logo scale-up** — CSS-only, verify IG-003 untouched. Daniel-flagged.
2. **Mode toggle → gem-pill control** — replaces text pair with the Image #6 reference. Single control owns mode AND path. Removes the duplicate-eyebrow problem.
3. **Remove persona card duplicate at footer** — the mode strip at top now does this job.
4. **"sidecar · simulator mode" → user copy** — rewrite to "Simulator · No real backend."
5. **Partner strip: demote `Payouts handled by Whop` from button to lock-chip** — only the affiliate-share is a button.
6. **Generate expanded: thin divider + smaller mode-extras weight** — primary pills stay loudest.
7. **Carousel slide: stronger left-side gradient** for legibility over any banner image.
8. **Drawer chrome wrapper** — one shared `<WorkWindowChrome>` so all three drawers match.
9. **Source chip Invader placeholder** — replace blank thumb with coloured Invader SVG.

Estimated patch surface: 1 component file change, 2 new small components, ~80 lines of CSS, no schema changes, no behavioural change.

---

## 7. What should wait until Batch 4

1. Engine cockpit restructure (right rail width, top spacing collapse, timeline bottom-anchor).
2. Engine empty-state full design pass.
3. Engine keyboard shortcuts (`E`, space, Cmd-A).
4. Side nav custom HUD icons (under `bespoke-craft`, asset production needed).
5. Carousel banner assets — swap external CDN for custom-generated visuals.
6. Thumbnail card three-rectangle stack icon (custom asset).
7. Real drag-drop event wiring (Tauri).
8. Live transcript pipeline for Script.

---

## 8. Build / guard status (current, this turn)

- `npm run build` ✅ — 1680 modules · 334.77 kB JS · 118.78 kB CSS · 14.91s.
- `npm run guard` ✅ — 347 passed, 0 failed.
- Tauri dev not running this turn — vite preview used for screenshots.
- Skill installation: `~/.claude/skills/pixel-perfect-product-lens/SKILL.md` present and showing in the available-skills registry.

---

## 9. Exact next patch recommendation

**Single patch — "Batch 2.5: Pixel-perfect shell polish" — scope-locked to nine items in §6.**

Highest-impact subset (if you only want a 3-item slice): items **2 (gem-pill toggle), 1 (splash logo), 3 (kill persona duplicate)**. Those three alone remove the loudest "AI built this" tells.

No new behaviour. No new external dependencies. No iron-gate sentinel removals. IG-003 verified untouched (intro timing constants 28_500 / 5_000 stay locked). CSS additions only for the gem-pill (new), splash logo (scale tweak), and partner-strip lock-chip (existing token reuse).

Awaiting your approval. Will not patch until you say "go Batch 2.5" or similar.

---

## 10. Hard-no compliance (this review touched nothing)

- ✅ No code changes.
- ✅ No Rust.
- ✅ No real Whop / Ayrshare / backend / FFmpeg / sidecar.
- ✅ No reward-banner work beyond review.
- ✅ No browser overlay.
- ✅ Build/guard not re-run beyond confirming current state.
- ✅ No push.
