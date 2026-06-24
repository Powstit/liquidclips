# Liquid Clips old shell magic manifest

Forensic audit of `/Users/dipdip/code/jnr/desktop` (v0.7.78). Tells Kimi
exactly which visual / motion primitives to carry into `desktop-2` so the
new shell feels like Liquid Clips — same cockpit energy, same loading
theatre, same icon vocabulary, same fuchsia heartbeat — but on the clean
12-section / 22-flow architecture (no global panels, no 22-state View
union, no passive auth).

Read-only inspection. **`/desktop` is NOT modified by this work.**

- Audit basis: `desktop` v0.7.78 (`package.json`, `tauri.conf.json`).
- Components audited: 35.
- Old CSS file: `desktop/src/index.css` (1,509 lines · 19 keyframes · 41 CSS vars · 33 lc-* class families).
- Old assets surveyed: 11 directories.
- Iron gates honoured: IG-003 (intro), IG-005 (workspace UI), IG-006 (cockpit handoff), IG-008 (room scrollability), IG-011 (webview cascade), IG-012 (brand kit).

---

## 1. Executive summary — what makes the old app feel magical

Six ingredients combine to give v0.7.78 its character. Skip any one and
the new shell will read as "generic dark dashboard":

1. **Cinematic three-stage boot.** 28.5 s Seedance intro video → 5 s brand-only loading hold → playable splash mini-game ("Press SPACE to play"). No instant-mount blank screen; the boot itself is a moment.
2. **Cockpit perspective + cursor parallax.** Every "studio" page lives inside `cockpit-root` (perspective: 1200 px; origin 50% 35%) with a lerped pointermove driver writing `--cockpit-px` / `--cockpit-py` ∈ [-1, 1]. Cards tilt subtly with the cursor.
3. **HUD corner brackets, never solid borders.** Tiles, chips, library cards all use dashed-fuchsia bracket corners with `drop-shadow(0 0 8px rgba(255,26,140,.55))`. No round buttons with solid borders inside the cockpit.
4. **Living rail.** Side nav is a 112 px "inventory" column with 56 × 56 PNG badges that idle-bob (3 s), pulse on active (2.8 s), and glow on hover (80 × 80 halo). Brand glyph at the top breathes (3.2 s).
5. **Liquid Invader loader.** The pixel-invader silhouette is used as a CSS mask for a 1.8 s fuchsia-fill loader. Brand-signature "we heard you" moment, not a generic spinner.
6. **Achievement + signal theatre.** Top-right avatar orbit doubles as a sidecar health indicator (fuchsia/amber/red ring) and shows lifetime earnings. Bottom-edge `SignalLine` ticker rotates 3 signals every 5 s (rank · next post · today's leader). Achievement toasts slide in from the right corner with the actual badge sprite.

Carry all six and `desktop-2` reads as Liquid Clips immediately.

---

## 2. Exact shell dimensions

Sourced from `desktop/src/index.css` + component code. **Carry these
verbatim** — they're the ones that survived the v0.6.0 → v0.7.78 motion
audit.

### Side nav rail

| Token                                  | Value                                            |
| -------------------------------------- | ------------------------------------------------ |
| `.lc-sidenav` default width            | **112 px**                                       |
| `.lc-sidenav[data-collapsed="true"]`   | **64 px**                                        |
| Collapse transition                    | `width 240 ms cubic-bezier(.34, 1.56, .64, 1)`   |
| Badge image default                    | **56 × 56 px**                                   |
| Badge image collapsed                  | **36 × 36 px**                                   |
| Halo (`.lc-sidenav-halo`) default      | **80 × 80 px** (radial-gradient, `rgba(255,26,140,.32)`) |
| Halo collapsed                         | **56 × 56 px**                                   |
| Item `.lc-sidenav-item` min-height     | **80 px** default · **56 px** collapsed         |
| Item padding                           | **12 px 4 px** default · **8 px 4 px** collapsed |
| Active label `.lc-sidenav-label`       | font-mono **11 px** · max-width 96 px            |
| Brand glyph `.lc-sidenav-brand-glyph`  | **52 × 52 px** default · 32 × 32 collapsed       |
| Indicator bar `.lc-sidenav-bar`        | left edge, width **3 px**, radius `0 2px 2px 0`  |
| Hover tooltip pill                     | offset `+8 px` right, mono 10 px tracking 0.12em |
| Status dot `.lc-sidenav-dot`           | **6 × 6 px**, position `bottom 14 right 18`      |
| Progress ring `.lc-sidenav-progress`   | **64 × 64 px** (44 collapsed), 2 px fuchsia border |

### Top HUD chrome (Avatar Orbit)

| Token                          | Value                                            |
| ------------------------------ | ------------------------------------------------ |
| `.avatar-orbit-face`           | **48 × 48 px**, radius 50%, 2 px paper border    |
| `.avatar-orbit-ring`           | 1.5 px solid fuchsia + drop-shadow 8 px / .5 alpha |
| `.avatar-orbit-crown`          | **18 × 18 px**, top -4 px right -4 px            |
| `.avatar-orbit-initials`       | font-display 16 px / weight 700                  |
| `.avatar-orbit-chip`           | bottom -4 px, padding 2 × 6, border 1 px fuchsia |
| `.avatar-orbit-chip-dot`       | **4 × 4 px**                                     |
| `.avatar-orbit-badge`          | min 16 × 16 px (notification count), 1.5 px paper border, fuchsia bg |

### Cockpit

| Token                          | Value                                            |
| ------------------------------ | ------------------------------------------------ |
| `.cockpit-root` perspective    | **1200 px**, origin **50% 35%**                  |
| Cursor parallax range          | `--cockpit-px`, `--cockpit-py` ∈ [-1, 1]         |
| Parallax lerp factor           | **0.08** (currentX += (target - current) * 0.08) |
| `.cockpit-tile` perspective    | **900 px**                                       |
| Tile rotateX                   | `calc(var(--cockpit-py) * -6deg)`                |
| Tile rotateY                   | `calc(var(--cockpit-px) * 8deg)`                 |
| `cockpit-tile-glyph` translateZ| **40 px** rest · **60 px** hover                 |
| Tile breathe                   | **5 s** ease-in-out infinite, scale 1 → 1.015    |
| `.cockpit-tile-halo`           | 70% diameter, radius 50%, blur **22 px**         |
| `.cockpit-tile-corner`         | **28 × 28 px** rest · **36 × 36 px** hover, 2 px dashed fuchsia |
| WorkstationRoom container      | padding `pt-12 pb-48` (192 px BottomCockpit clearance per IG-008) |

### Cards / pills / radii (from `@theme`)

| Token              | Value      |
| ------------------ | ---------- |
| `--radius-chip`    | 8 px       |
| `--radius-control` | 12 px      |
| `--radius-card`    | 16 px      |
| `--radius-card-lg` | 24 px      |
| `--radius-pill`    | 9999 px    |
| HudChip corner     | 10 × 10 px rest · 14 × 14 hover, 1.5 px dashed |
| Library card corner| 18 × 18 rest · 24 × 24 hover, 1.5 px dashed    |
| Library card hover | `drop-shadow(0 18px 50px rgba(255,26,140,.4))` |

### Typography sizes (canonical)

| Use                       | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| Display H1 (FirstRun hero)| **36 px** / line 1.05 / tracking -0.025em / weight 600       |
| Eyebrow (mono)            | **10 px** / uppercase / tracking **0.12em** (or 0.16em / 0.22em / 0.32em depending on context) |
| Section title             | **18 px** / weight 600 / tracking -0.01em                    |
| Body                      | 13 – 15 px / line 1.55 / `text-wrap: pretty`                 |
| Mono label                | 10–11 px / `--font-mono` Geist Mono / SF Mono fallback       |
| `text-wrap`               | `balance` on h1-h3, `pretty` on p (free perf, native CSS)   |

### Atmosphere opacity per deck (IG-012 partner)

From `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md`:

| Deck      | `.deck-atmosphere-*::before` opacity |
| --------- | ------------------------------------ |
| workspace | **0.18**                             |
| clips     | 0.14                                 |
| earn      | **0.20**                             |
| schedule  | 0.16                                 |
| settings  | 0.10                                 |
| community | 0.12                                 |
| learn     | 0.12                                 |

### Animation durations

| Where                                     | Duration                                        |
| ----------------------------------------- | ----------------------------------------------- |
| `lc-aurora-pulse`                         | **14 s** ease-in-out alternate                   |
| `lc-brand-breathe`                        | 3.2 s                                            |
| `lc-badge-float`                          | **3 s** (idle bob on rail badges)                |
| `lc-badge-active`                         | **2.8 s** (active rail badge pulse)              |
| `lc-bar-pulse`                            | 1.8 s (active rail indicator bar)                |
| `lc-sidenav-bar-pulse`                    | 220 ms one-shot (click feedback)                 |
| `lc-sidenav-spin`                         | 1.2 s linear infinite (progress ring)            |
| `cockpit-tile-breathe`                    | 5 s ease-in-out                                  |
| `lc-deck-cover-pan`                       | **26 s** ease-in-out                             |
| `lc-deck-cover-hud-flicker`               | 4 s ease-in-out                                  |
| `lc-live-dot`                             | 1.6 s ease-in-out                                |
| `lc-cta-pulse`                            | 2.4 s ease-in-out                                |
| `lc-avatar-glow`                          | 3 s ease-in-out                                  |
| `lc-rank-avatar`                          | 3.4 s ease-in-out                                |
| `lc-liquid-rise` (LiquidInvaderLoader)    | **1.8 s** ease-in-out infinite                   |
| Splash intro                              | **28.5 s** total (video onEnded fires sooner)    |
| Splash loading hold                       | **5 s** minimum brand-mark moment                |
| Achievement toast slide-in                | **280 ms** ease-out · auto-dismiss **5 s**       |
| RoomShell enter                           | spring stiffness 260 / damping 28 · scale 0.96 + blur 8 → 1 + 0 |
| RoomShell exit                            | spring · scale 0.98 + blur 6                     |
| RoomShell reduced-motion                  | opacity fade 140 ms                              |
| `pulse-dot`                               | 2 s                                              |
| `blink`                                   | 1 s steps(1)                                     |
| `working-shimmer`                         | 1.6 s ease-in-out                                |
| `marquee` (thumbnail studio)              | linear continuous (concatenated factory roll)    |

### Top-bar / status strip dimensions

From the cockpit-v7 demos (`desktop/docs/cockpit-v7-panel.html`):

| Element             | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| Status strip pad    | 12 × 22 px                                              |
| `clip-now` label    | mono 10 px / tracking 0.16em / fuchsia                  |
| Schedule pill       | 5 × 11 px pad / radius 4 / 1 px fuchsia 0.32 alpha     |
| Kebab tap target    | 14 px font / 0 × 4 padding                              |
| Body grid           | 1fr / 234 px (right rail), gap 0                        |
| Tile grid           | 8-col / gap 7 px                                        |
| Tile pad            | 8 × 5 × 7 px                                            |
| Tile label          | mono 9 px / tracking 0.06em                             |

---

## 3. Components that must be carried over

For each: file path, role, assets, classes, "port directly?" and how to adapt.

### 3.1 `Logo.tsx` + `MadeWithLiquidClips.tsx`
- Path: `desktop/src/components/Logo.tsx`, `desktop/src/components/brand/MadeWithLiquidClips.tsx`
- Role: Renders the `glyph.png` + `wordmark.png` + animated watermark SVG.
- Assets: `assets/brand/glyph.png` (184 KB), `assets/brand/wordmark.png` (1 MB), `assets/made-with-liquid-clips.svg`.
- CSS: drop-shadow `rgba(255,26,140,.55)` glow.
- Port? **Yes — already in `desktop-2/src/brand/`.** Daniel + Kimi have these mirrored.

### 3.2 `Splash.tsx` — 3-stage cinematic boot
- Path: `desktop/src/components/Splash.tsx` (413 lines, IG-003).
- Role: Intro video → brand-only loading hold → SplashGame paused with continue gate.
- Assets:
  - `assets/intro/intro.mp4` (9.2 MB) — 28.5 s Seedance cinematic
  - `assets/intro/intro-splash.mp4` (3 MB)
  - `assets/intro/closing-still.png` (12.7 MB) — final beat frame, used as static splash backdrop
  - `assets/intro/oasis-anchor.png` (12.8 MB)
- Library deps: `lib/intro.ts` (`hasSeenIntro`/`markIntroSeen` — localStorage one-shot), `lib/openSmart.ts` (external opener).
- Key constants: `INTRO_DURATION_MS = 28_500`, `LOADING_MIN_HOLD_MS = 5_000`.
- WebKit fallback: detect `<video>.play()` rejection → render "Tap to play" overlay (E8 fix). Don't drop this.
- Port? **Adapt** to `desktop-2/src/overlays/Splash.tsx`. Mount once at App root. Reuse assets verbatim (copy `intro/*` into `desktop-2/public/brand/intro/`).

### 3.3 `FirstRun.tsx`
- Path: `desktop/src/components/FirstRun.tsx` (222 lines).
- Role: Single-screen first-launch sign-in card.
- Dimensions: 680 px max-width container, `mt-16` between brand and headline, 36 px display headline.
- Port? **Adapt** to `desktop-2/src/overlays/FirstRun.tsx`. Drop the lucide pulse dot for `.lc-motion-status-pill-dot` from the new brand-kit.

### 3.4 `JuniorLoader.tsx`
- Path: `desktop/src/components/JuniorLoader.tsx` (164 lines).
- Role: Typing brand-voice loader for the gap between URL paste and pipeline start.
- Behaviour: 28 ms-per-char typing + 60 s stall detection.
- Wraps: `LiquidInvaderLoader` for the visual core.
- Port? **Yes — verbatim**. Rename to `desktop-2/src/overlays/EngineLoader.tsx` (since "Junior" is the legacy codename).

### 3.5 `LiquidInvaderLoader.tsx`  ★ BRAND SIGNATURE
- Path: `desktop/src/components/LiquidInvaderLoader.tsx` (109 lines).
- Role: Pixel-Invader silhouette as CSS mask + 1.8 s fuchsia liquid fill loop. **The most identifiable loading state in the product.**
- Asset: `assets/icons/connections/library-bug.png` (used as `WebkitMaskImage` / `maskImage`).
- Keyframe: `@keyframes lc-liquid-rise` — translateY 100% → -12% with wobble points at 15%, 50%, 85%.
- Fill gradient: `linear-gradient(180deg, #ff66b8 0%, #ff1a8c 60%, #c70066 100%)` + meniscus highlight.
- Port? **Yes — verbatim**. Drop into `desktop-2/src/brand-kit/LiquidInvaderLoader.tsx`. Already pure CSS / mask, no dep change required.

### 3.6 `Cockpit.tsx` + `RoomShell.tsx`
- Path: `desktop/src/components/cockpit/Cockpit.tsx` (116 lines) + `RoomShell.tsx` (95 lines, IG-008/011).
- Role: Cockpit gives perspective root + cursor parallax. RoomShell provides per-route motion enter/exit (spring scale + blur).
- Asset deps: none — pure CSS/JS.
- Reduced-motion: BOTH components feature-detect prefers-reduced-motion; the parallax `pointermove` listener is skipped entirely when reduced-motion is on or `active=false`.
- Port? **Adapt** to `desktop-2/src/shell/Cockpit.tsx` + `RoomShell.tsx`. Keep IG-008 (two-layer block-scroller + min-h-full) and IG-011 (`align="stretch"`) contracts verbatim.

### 3.7 `WorkstationRoom.tsx` (and `StudioHome`)
- Path: `desktop/src/components/cockpit/WorkstationRoom.tsx` (174 lines).
- Role: The empty-view surface. Hosts `StudioHome` (LC 9.6 hero + 4 tiles) + `SponsoredBannerCarousel` + drop-error toast + drag-hover full-room overlay.
- Padding contract: `pt-12 pb-48` (IG-008 — 192 px BottomCockpit clearance).
- Port? **Replace** — this surface's role is split in `desktop-2` between CREATE (URL/file submit) and CAMPAIGNS (sponsored). Carry only the StudioHome tile layout pattern + the cursor-parallax tilt; do not port the SponsoredBannerCarousel global mount.

### 3.8 `UploadPortal.tsx`
- Path: `desktop/src/components/cockpit/UploadPortal.tsx` (399 lines).
- Role: Compact URL/file portal opened from the Create tile.
- Key constants: `SUPPORTED_URL_HOSTS` regex list (youtube.com, youtu.be, tiktok.com, vm.tiktok.com, vt.tiktok.com, instagram.com, instagr.am, ig.me, twitter.com, x.com, facebook.com, fb.watch, vimeo.com, player.vimeo.com, reddit.com).
- Intent prop: `"clips" | "script"` — script disables file pick, switches label to "transcript mode".
- Port? **Adapt** to `desktop-2/src/sections/create/CreatePortal.tsx`. Carry the host allowlist verbatim (`desktop/src/lib/sourceHosts.ts` is the canonical list).

### 3.9 `AvatarOrbit.tsx` ★ SIGNATURE TOP-CHROME
- Path: `desktop/src/components/cockpit/AvatarOrbit.tsx` (224 lines).
- Role: Top-right chrome — circle + orbital ring + ambient lifetime-earnings chip + sidecar health indicator.
- Ring tint: fuchsia (ready) · amber (starting) · red (failed) — single source of truth for sidecar health.
- Click summons `AvatarPanel`.
- CSS: `.avatar-orbit-*` classes (face, ring, crown, chip, badge, initials).
- Reduced-motion: `.avatar-orbit-ring { animation: none }`.
- Port? **Adapt** to `desktop-2/src/shell/AvatarOrbit.tsx`. Wire `sidecarStatus` to the kit's `healthCheck` skeleton (lib/healthCheck.ts). Bring the 48 px / 18 px / 16 px dimension stack verbatim.

### 3.10 `AvatarPanel.tsx`
- Path: `desktop/src/components/cockpit/AvatarPanel.tsx` (699 lines).
- Role: HUD slide-down summoned by AvatarOrbit. Settings · Account · Dashboard · Sign-out.
- Port? **Partial.** In 2.0, identity lives in `SECTION_SETTINGS` (Account sub-tab). The panel becomes a thinner "open settings · sign out · upgrade" popover, not the dashboard host.

### 3.11 `BottomCockpit.tsx`
- Path: `desktop/src/components/cockpit/BottomCockpit.tsx` (1,420 lines).
- Role: Fixed bottom strip — pipeline progress bar / SignalLine / quota chip / capture pill.
- Port? **No — too coupled to v0.7.78 state machine.** Carry the visual idea (bottom strip with brand chrome) but reimplement in `desktop-2/src/shell/BottomBar.tsx` using kit primitives. Keep the 192 px viewport clearance contract.

### 3.12 `SignalLine.tsx` ★ AMBIENT SIGNAL
- Path: `desktop/src/components/cockpit/SignalLine.tsx` (139 lines).
- Role: 24 px bottom-edge ticker — 3 cockpit signals rotate every 5 s. Refresh every 60 s.
- Constants: `REFRESH_MS = 60_000`, `ROTATE_MS = 5_000`.
- Signals: rank · next post · today's leader.
- Port? **Yes — verbatim shape**, swap data sources to the 2.0 selectors (read-only ACCOUNT.rank, SCHEDULE.next, EARN.leader).

### 3.13 `HudChip.tsx` ★ BRACKET LANGUAGE
- Path: `desktop/src/components/cockpit/HudChip.tsx` (55 lines).
- Role: Transparent fill + dashed-fuchsia corner brackets + dashed hover underline. Used by Library filters.
- Motion: `whileHover: y -1` (spring 420/24) · `whileTap: scale 0.96`.
- CSS: 4 spans `.hud-chip-corner-{tl,tr,bl,br}` (10 × 10 rest, 14 × 14 active, 1.5 px dashed).
- Port? **Yes — verbatim** into `desktop-2/src/brand-kit/HudChip.tsx`. The new brand-kit already has the bracket vocabulary in `HudCard.tsx` — this is the chip-scale cousin.

### 3.14 `ActivityOrbit.tsx` + `ActivityOrbitParticles.tsx`
- Path: `desktop/src/components/cockpit/ActivityOrbit.tsx` (42) + `ActivityOrbitParticles.tsx` (64).
- Role: Ambient motion ring around the avatar — particles orbit when something is happening.
- Port? **Yes** as `desktop-2/src/brand-kit/ActivityOrbit.tsx`. Optional layer over AvatarOrbit.

### 3.15 `LibraryWall.tsx` + `LibraryCard.tsx` + `LibraryQuickPreview.tsx`
- Path: `desktop/src/components/cockpit/Library*.tsx`.
- Role: Library grid wall + 9:16 cards with HUD bracket corners + hover quick-preview popover.
- Dimensions: card `aspect-[9/16]`, `contain-intrinsic-size: auto 480px`, corners 18 × 18 rest / 24 × 24 hover.
- "Hot" state: `data-hot="true"` brightens brackets to 22 × 22 + 0.95 glow.
- Port? **Adapt** as the SECTION_PROJECTS card system. Carry the bracket-only-no-fill rule.

### 3.16 `NotificationBell.tsx` + `NotificationSheet.tsx`
- Path: `desktop/src/components/Notification*.tsx`.
- Role: Bell in top-right chrome → opens `NotificationSheet` (279 lines).
- Categories: `system_update`, `post_published`, `post_failed`, `drip_summary`, `quota_warning`, `billing`, `affiliate`, `founder`, `junior_message`, `pipeline_event`, `paywall`.
- Port? **Adapt** to `desktop-2/src/shell/NotificationBell.tsx` + `desktop-2/src/overlays/NotificationSheet.tsx`. Rename `junior_message` → `liquid_message`.

### 3.17 `AchievementToast.tsx` ★ DOPAMINE MOMENT
- Path: `desktop/src/components/AchievementToast.tsx` (71 lines).
- Role: Top-right slide-in card on achievement unlock. 300 px wide. 5 s auto-dismiss. Queue on stack.
- Animation: `toast-slide-in` 280 ms ease-out, opacity 0 + translateX 40 → opacity 1 + translateX 0.
- Asset: per-achievement PNG in `assets/badges/` (8 art files: first-clip, first-publish, first-payout, first-referral, hundred-clips, hundred-dollars, top-100-leaderboard, viral-clip).
- Port? **Yes — verbatim**. Mount at App root in `desktop-2`.

### 3.18 `GlobalToastHost.tsx`
- Path: `desktop/src/components/GlobalToastHost.tsx` (193 lines).
- Role: Listens on the `lc:toast` window CustomEvent bus + renders. Mount once at App root (was orphan code per v0.7.47 ship-lens review).
- Port? **Yes — verbatim**. Same wiring rules.

### 3.19 `SidecarCrashOverlay.tsx`
- Path: `desktop/src/components/SidecarCrashOverlay.tsx` (279 lines).
- Role: Full-screen fixed `inset-0 z-[300]` overlay when the Python sidecar dies. "We lost connection to the engine" + Retry / Restart / Email support.
- Recovery: listens for `subscribeSidecarDied({ recovered: true })` → auto-dismisses.
- Port? **Adapt** to `desktop-2/src/overlays/EngineCrashOverlay.tsx`. Rebrand "Python sidecar" → "engine" in the copy (already done in old).

### 3.20 `Splash` → `SplashGame` → `InvadersCanvas`
- Path: `desktop/src/components/invaders/*` (827 lines total: SplashGame 209, InvadersCanvas 373, InvadersOverlay 216, InvadersTrigger 29).
- Role: Hidden mini-game. Splash hosts the paused state; InvadersOverlay launches mid-pipeline as a "wait happily" surface.
- Asset folder: `assets/invaders/` (player_ship, drone, grunt, elite, boss, mothership, bullets, splash-bg, invader-wasp) — ~40 MB of game sprites.
- Port? **Yes — verbatim** as `desktop-2/src/overlays/invaders/`. Pure visual theatre; no business logic to clean.

---

## 4. Loading / splash / game magic

End-to-end loading sequence Kimi must recreate verbatim:

### Cold boot (first launch ever)

```
0.0 s     window opens; #root paints
0.0 s     <Splash stage="intro"> mounts
0.0 s     <video src="intro.mp4" autoPlay> starts
≈28.5 s   onEnded OR INTRO_DURATION_MS timeout → stage="loading"
≈28.5 s   localStorage flag persisted (markIntroSeen)
+5.0 s    LOADING_MIN_HOLD_MS minimum brand-only window
+5.0 s    stage="game" → SplashGame paused
          ("Press SPACE to play")
user      clicks Continue → onContinue() unmounts Splash
```

### Warm boot (every subsequent launch)

```
0.0 s     window opens
0.0 s     <Splash stage="loading"> mounts (hasSeenIntro → skip intro)
+5.0 s    stage="game"
user      Continue → unmount
```

### WebKit autoplay fallback (Splash IG-003)

If `videoRef.current.play()` returns a rejected promise (Safari WebKit
autoplay block), Splash flips `autoplayBlocked=true` and renders a
centered "Tap to play" overlay. Click resumes play() inside the user
gesture context. **Do not drop this fallback.**

### LiquidInvaderLoader callsites (where the brand loader appears)

- Upload portal open (between paste and pipeline start)
- Sidecar startup probe
- Settings reveal (keychain prompt round-trip)
- Payout fetch
- Achievement art preload

### Invaders mid-pipeline

When a long pipeline beat would otherwise leave the user staring at a
progress bar, `InvadersOverlay` mounts a playable mini-game with the
brand sprites. Player ship vs. invader fleet. Dismiss returns to current
view; the pipeline continues underneath.

### Assets to copy into `desktop-2/public/brand/`

```
intro/intro.mp4                        (9.2 MB)
intro/intro-splash.mp4                 (3.0 MB)
intro/closing-still.png                (12.7 MB)  ★ static splash bookend
intro/oasis-anchor.png                 (12.8 MB)  ★ secondary splash art
invaders/player_ship.png               (5.5 MB)
invaders/drone.png                     (5.4 MB)
invaders/grunt.png                     (5.0 MB)
invaders/elite.png                     (5.6 MB)
invaders/boss.png                      (5.7 MB)
invaders/mothership.png                (5.6 MB)
invaders/bullet-player.png             (1.4 MB)
invaders/bullet-invader.png            (956 KB)
invaders/invader-wasp.png              (1.6 MB)
invaders/splash-bg.png                 (2.3 MB)
icons/connections/library-bug.png      (the Invader silhouette used by LiquidInvaderLoader CSS mask)
```

Total: **~60 MB** of cinematic + game assets. Big, but they are the
brand. Compress only at v1.0 ship gate; do not optimise now.

---

## 5. Cockpit magic

### Mount tree
```
<Cockpit active={isWorkstationOrResults}>
  <RoomShell roomKey={route} align="center" atmosphere="workspace">
    <WorkstationRoom> | <ResultsGrid> | <ProjectDetail> | …
  </RoomShell>
</Cockpit>
```

### What to rebuild in `desktop-2`

1. `desktop-2/src/shell/Cockpit.tsx` — perspective root + pointermove → CSS vars driver (port lines 47-109 of `desktop/src/components/cockpit/Cockpit.tsx`).
2. `desktop-2/src/shell/RoomShell.tsx` — `motion.div` with spring scale + blur transition + atmosphere prop. Keep IG-008/IG-011 contracts.
3. `desktop-2/src/brand-kit/HudChip.tsx` — bracket-corner chip.
4. `desktop-2/src/brand-kit/ActivityOrbit.tsx` — ambient particles.
5. `desktop-2/src/shell/AvatarOrbit.tsx` — top-right chrome with sidecar health ring.
6. `desktop-2/src/shell/SignalLine.tsx` — bottom ticker.
7. `desktop-2/src/shell/BottomBar.tsx` — fixed bottom chrome (not the 1,420-line v0.7.78 monster; a thin reimplementation).

### What to reject

- The `WorkspaceCockpit` 22-state View union — already excluded by guard.
- `AvatarPanel` 699-line dashboard host — split into Settings sub-tabs.
- `BottomCockpit` v0.7.78 1,420-line file — reimplement, do not port.
- The "Studio Home four-tile router" — `desktop-2` uses section routes, not workspace-state tiles.

---

## 6. Side nav magic

### Structure (port verbatim into `desktop-2/src/shell/SideNav.tsx`)

```
<aside class="lc-sidenav" data-collapsed={…}>
  <div class="lc-sidenav-logo">
    <img class="lc-sidenav-brand-glyph" src="/brand/glyph.png" />
  </div>
  <button class="lc-sidenav-collapse">…</button>
  <nav class="lc-sidenav-list">
    <SideNavItem … />
    …
  </nav>
  <div class="lc-sidenav-divider" />
  <div class="lc-sidenav-bottom">
    <SideNavItem key="settings" />
  </div>
</aside>
```

### Badge animation cycle (per `SideNavItem`)

| State        | Animation                                                 |
| ------------ | --------------------------------------------------------- |
| Idle         | `lc-badge-float` 3 s ease-in-out infinite                  |
| Active       | `lc-badge-active` 2.8 s ease-in-out infinite              |
| Hover        | `animation-play-state: paused` + lift `translateY(-4px) scale(1.15)` + brighter glow |
| Indicator bar (active) | `lc-bar-pulse` 1.8 s ease-in-out infinite       |
| Click feedback | `lc-sidenav-bar-pulse` 220 ms one-shot via `data-pulsing` |
| Halo (hover) | radial fuchsia, opacity 0 → 1 in 200 ms                    |
| Halo (active) | opacity 0.7, transform scale(1)                            |

Stagger badge animations with `animation-delay`:
```css
.lc-sidenav-list .lc-sidenav-item:nth-child(2) .lc-sidenav-item-icon-img { animation-delay: -0.3s; }
.lc-sidenav-list .lc-sidenav-item:nth-child(3) … delay -0.6s … nth-child(7) delay -2.2s
```
**Do not lockstep**. The asynchronous bob is what makes the rail feel alive.

### Footer chip (user identity)

Above Settings, render `.lc-nav-user` chip: 32 × 32 avatar with crown overlay (tier emblem), name + tier text. The crown overlay is a `<img src={tier(currentTier)}>` sized 14 px at top-right of the avatar.

### Collapsed state

```
data-collapsed="true" →
  width 64 px, badges 36 × 36, halo 56 × 56, item min-h 56 px, padding 8 × 4,
  label display none, brand glyph 32 × 32, tooltip pills still appear on hover
```

Persist via `localStorage["lc:sidenav:collapsed"] = "0"|"1"`.

### Assets (copy verbatim into `desktop-2/public/brand/nav-badges/`)

9 PNGs: workspace.png · upload.png · library.png · earn.png · schedule.png · payouts.png · community.png · learn.png · settings.png. (~1.4 MB each — they're hi-res Riot-rank-card style emblems generated via gpt-image-1.)

---

## 7. Workbench / ResultsGrid magic

Contract source: `desktop/docs/UI_MAP_workbench.md` (ship-lens locked).
Already mapped in detail in `~/Desktop/Liquid_Clips_2_Starter_Kit/00_DEV_HANDOFF_DOCS/LIQUID_CLIPS_0_7_78_UI_UX_STATE.md §2.4`. Carry verbatim:

### Tile (clip card) behaviour

| Behaviour                                | Spec                                            |
| ---------------------------------------- | ----------------------------------------------- |
| Default poster                           | static thumbnail (no autoplay video)            |
| Singleton play                           | `useState<WindowId \| null>` in WindowManager — at most ONE `<video>` mounts |
| Click tile → play once                   | one click                                       |
| `E` / double-click                       | open Edit drawer (canvas-scale modal)           |
| `Space`                                  | play focused tile                               |
| `Cmd-A`                                  | select all                                      |
| `Cmd-Backspace`                          | remove selection (two-step confirm)             |
| Right-click menu                         | Open Edit · Reveal in Finder · Save copy · Play · Remove |
| `+ window` tile                          | renders at next free 2 × 2 slot                  |
| Tile select state                        | fuchsia border + box-shadow `0 0 0 1px fuchsia, 0 14px 34px -20px rgba(255,45,149,.6)` |
| Hover overlay                            | LC score + "why" reveal                          |
| Chrome avatar stack                      | empty = fuchsia dot · bound = avatars            |
| Title                                    | truncated, one line                              |
| Captions cache-bust                      | `?cb=${captions_updated_at}` on `<video>` src    |
| Ratio variant                            | `windowState.ratio` selects `square_path` / `portrait_path` / `vertical_path` fallback |
| Per-tile bottom row                      | **removed** (was 72 buttons across 12 tiles)    |
| Per-tile Close X                         | **removed** (moved to Cmd-Backspace + right-click) |
| `MasterToolbar Play-all / Pause-all`     | **removed v0.7.8 W1** (singleton playingId made it a no-op) |
| Grid view + ViewModeToggle               | **removed v0.7.8 W4** (single-mode since v0.7.5) |

### Engine timeline (already preserved in `desktop-2`)

| Element class              | Role                              |
| -------------------------- | --------------------------------- |
| `lc2-engine-split-mark`    | Split point on timeline           |
| `lc2-engine-playhead`      | Current playback position         |
| `lc2-engine-tl-wave`       | Waveform render                   |
| `lc2-engine-capblock`      | Caption block                     |
| `lc2-engine-reactblock`    | Reaction overlay block            |
| `lc2-engine-broll-block`   | B-roll insert                     |

Engine timeline must remain untouched (guard already enforces this).

### Edit drawer

Canvas-scale modal (NOT a slide-over — v0.7.5 amendment). E / double-click opens; Esc closes; focused-window store retains the binding so Esc cascades back to the tile.

Components inside Edit drawer:
- CaptionPicker (preset + custom)
- `react-colorful` colour picker
- `libass-wasm` ASS preview
- OverlaySourcePicker (reaction)
- OverlayTemplateGallery
- Trim handles on timeline
- "For your post" preset assignment

---

## 8. Brand atmosphere

### Fuchsia ladder (`@theme` block — IG-012)
```
--color-fuchsia:        #ff1a8c
--color-fuchsia-bright: #ff3da5
--color-fuchsia-deep:   #ff66b8
--color-fuchsia-soft:   rgba(255, 26, 140, 0.16)
--color-fuchsia-glow:   #ff8fcb
```
Already in `desktop-2/src/brand/brandTheme.css` and `desktop-2/src/index.css` and `desktop-2/src/brand-kit/liquidMotion.css`.

### Aurora background (port to `desktop-2`)

```css
.lc-aurora {
  position: fixed; inset: 0; pointer-events: none;
  z-index: -10; overflow: hidden;
  background: var(--color-paper);
}
.lc-aurora-blobs {
  position: absolute; inset: -20%;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%,  rgba(255, 26, 140, 0.28), transparent 60%),
    radial-gradient(ellipse 70% 45% at 20% 110%, rgba(140, 40, 255, 0.22), transparent 60%),
    radial-gradient(ellipse 70% 45% at 90% 90%,  rgba(255, 90, 80,  0.18), transparent 60%);
}
@media (prefers-reduced-motion: no-preference) {
  .lc-aurora-blobs { animation: lc-aurora-pulse 14s ease-in-out infinite alternate; }
}
```

### Deck atmosphere plates

Per-deck PNG placed behind chrome at the IG-012 opacity values (§2). CSS hook pattern:

```css
.deck-atmosphere {
  position: absolute; inset: 0; pointer-events: none;
  z-index: 0; overflow: hidden;
}
.deck-atmosphere::before {
  content: ""; position: absolute; inset: 0;
  background-size: cover; background-position: center;
  opacity: 0; transition: opacity 600ms ease;
}
.deck-atmosphere[data-ready="true"]::before { opacity: 1; }
.deck-atmosphere-workspace::before { background-image: url("/brand/atmospheres/atmosphere-workspace.png"); opacity: 0.18; }
.deck-atmosphere-clips::before     { background-image: url("/brand/atmospheres/atmosphere-library.png");   opacity: 0.14; }
.deck-atmosphere-earn::before      { background-image: url("/brand/atmospheres/atmosphere-earn.png");      opacity: 0.20; }
.deck-atmosphere-schedule::before  { background-image: url("/brand/atmospheres/atmosphere-schedule.png");  opacity: 0.16; }
.deck-atmosphere-settings::before  { background-image: url("/brand/atmospheres/atmosphere-settings.png");  opacity: 0.10; }
```

### Deck top-edge band (already in `desktop-2/src/brand-kit/liquidMotion.css`)

1-px hairline + 48 px gradient tail per deck. Earn gets a special amber-tipped tail (already in old; carry forward).

### Animation budget controls (carry forward)

`.lc-anim-paused`, `[data-content-visibility="hidden"]`, `[data-route-inactive="true"]` — all set `animation-play-state: paused !important`. Defensive scaffolding from v0.7.48 smoothness diagnostic. **Port verbatim** to `desktop-2/src/index.css` so the new shell inherits the perf budget.

### Token cross-reference

Same 41 CSS vars + 19 keyframes already mirrored in `desktop-2/src/brand/brandTheme.css` (IG-012 partner). Confirm with `bash desktop/scripts/brand-kit-drift-check.sh` before any release.

---

## 9. Hidden UX details (often missed)

These small things are most of what makes v0.7.78 feel alive. None of them are obvious from reading code; all of them are surfaced in the comment blocks of the components above.

1. **Stagger** badge idle bobs by `-0.3 s · -0.6 s · -1.0 s · -1.4 s · -1.8 s · -2.2 s` so the rail never ticks in lockstep.
2. **Crown on side-nav avatar.** The user's tier emblem overlays the bottom-right of their avatar (14 × 14 px). Renders the tier without consuming a row.
3. **Live-dot eyebrow.** Wherever an eyebrow has a `lc-live-dot`, the dot pulses fuchsia (1.6 s) — used for "live / streaming / active" affordances.
4. **CTA pulse.** Direct-descendant `<button>` / `<a>` inside `.lc-deck-cover-cta-wrap` pulse softly (`lc-cta-pulse` 2.4 s). No `.lc-cta` class — the consumer doesn't have to remember it.
5. **Library card bug.** When a project has no thumbnail, `.library-card-bug` renders the pixel-invader silhouette as fuchsia drop-shadow + idle bob (3.2 s).
6. **Hot card.** `data-hot="true"` on a `.library-card` brightens its brackets to 22 × 22 + 0.95 glow even at rest. Used for bounty scores ≥ 78.
7. **Status pill amber tone.** Side-nav `.lc-sidenav-dot[data-tone="amber"]` for "needs attention" (missing API key, channel error) instead of red — keeps the brand single-fuchsia rule honest.
8. **Tooltip suppress on active.** Active side-nav items hide their hover tooltip pill — user already knows which surface they're on, no point repeating it on mouseover.
9. **Mobile breakpoint.** `@media (max-width: 800px)` collapses tooltip pills (icons-only rail) but keeps the active label visible. Carry for narrow-window respect.
10. **WebKit autoplay tap-to-play.** Splash detects `<video>.play()` rejection and renders a centred overlay so the user has a clear gesture path. Without this, the splash sits at frame zero in Safari WebKit-style autoplay-blocked windows.
11. **`text-wrap: balance` on h1-h3** and `pretty` on `<p>`. Native CSS, free perf. Already in the old; carry into `desktop-2/src/index.css`.
12. **`will-change: transform, opacity, filter`** on `.cockpit-room-wrap` (IG-008 partner). Seeds GPU compositing for the dolly transitions.
13. **Reduced-motion is reactive**, not check-once-at-mount. The Cockpit component listens for `prefers-reduced-motion` MediaQueryList `change` events so an OS-level toggle mid-session is honoured.
14. **Passive listener** on pointermove so nested scrollable surfaces inside RoomShell aren't blocked.
15. **Compact USD formatter.** `fmtUsd` drops cents above $100 so the SignalLine stays short.
16. **Stall detection.** JuniorLoader tracks `downloadedBytes` over a rolling 60 s window. When flat for 60 s, surfaces a Retry pill alongside the typing label.
17. **Atomic-wipe sign-out.** Sign-out clears keychain → invalidates JWT → returns to Splash. Daniel called this out as v0.7.7 fix S1.
18. **Achievement queue stacks**, doesn't overwrite. `+N` badge on the corner shows how many are waiting.
19. **Notification category copy** uses lower-case tense ("update", "post", "drip", "quota", "billing", "affiliate", "founder", "liquid clips", "pipeline", "upgrade"). Brand voice — terse and lower-case.
20. **Tier emblem image rendering.** All tier PNGs use `imageRendering: "pixelated"` + `drop-shadow(0 0 8-10px rgba(255,26,140,.45-.55))`. Pixel-art on purpose.

---

## 10. Bugs / anti-patterns to reject

Do **not** carry these into `desktop-2`. The new architecture already eliminates each.

1. `3,455-line App.tsx` with 22-state `View` union acting as router.
2. `Workspace-as-router model` — side-nav clicks rewriting `view.kind`; no URL state.
3. `BrowseRewardsPanel` mounted globally — anti-pattern explicitly killed in 2.0 plan.
4. Persistent global right-side panel — anti-pattern, already in `assert-shell-contracts.sh`.
5. `jnremployee` URLs — replaced by `liquidclips.app` everywhere; legacy aliases live but new code uses canonical.
6. Old `auth/licence bug` (`v0.7.7 fix S7`) where expired JWT surfaced as "no affiliate data". Wire the new ACCOUNT selector to distinguish UnauthorizedError from EmptyData.
7. **Passive keychain reads on mount** — IG-014 invariant. Already enforced by `desktop-2` guard.
8. Earn surfacing `$N` native payout numbers in v1 — Daniel's v1 reality is "Whop handles rewards." Already enforced by `assert-shell-contracts.sh §Earn`.
9. Cross-section state coupling — already enforced (`cross-section sibling imports` check).
10. `Math.random` calls that aren't seeded — desktop sometimes hit `Math.random is impure` warnings in dev. Skip if porting any random selector.
11. `displayName`, `isCold`, `onProjects`, `projectsCount` props on WorkstationRoom — back-compat dead weight. Drop on port.
12. `MasterToolbar Play-all / Pause-all` button — silently a no-op (singleton player). Removed v0.7.8 W1. Don't reintroduce.
13. `Grid view + ViewModeToggle + tier-default branching` — single-mode workbench since v0.7.5. Don't restore.
14. `ActiveVideoPool + MAX_ACTIVE_VIDEOS + promoteToPool` — 100 lines of code for a 1-element pool. Replaced by simple `useState<WindowId|null>`. Don't restore.
15. `RemixState.active_path` branch in `clipVideoPath` — permanently unreachable (no sidecar method writes RemixState). Don't restore.
16. `clip.remix` as a render priority — same reason.
17. Long-running `pointermove` listener on views that don't read `--cockpit-px/py` — passing `active=false` to Cockpit on Library / Earn / Settings / Schedule / Learn drops the per-frame style recalc.

---

## 11. Kimi implementation checklist (numbered, in order)

Each item is a single-PR-sized increment. Run guard + build + manual after each.

1. **Copy 60 MB of cinematic + game assets** into `desktop-2/public/brand/intro/` and `desktop-2/public/brand/invaders/` (paths in §4). Add `liquid-bug.png` mask to `desktop-2/public/brand/icons/connections/`.
2. **Port `LiquidInvaderLoader.tsx`** verbatim into `desktop-2/src/brand-kit/LiquidInvaderLoader.tsx`. Add to `index.ts` barrel.
3. **Port `JuniorLoader.tsx`** as `desktop-2/src/overlays/EngineLoader.tsx` (with 28 ms typing + 60 s stall detection).
4. **Build `desktop-2/src/overlays/Splash.tsx`** following the 3-stage flow (intro → loading hold → SplashGame paused). Use the WebKit autoplay fallback (E8). Persist `localStorage["lc:intro:seen"]`.
5. **Port the invaders game** into `desktop-2/src/overlays/invaders/{SplashGame,InvadersCanvas,InvadersOverlay,InvadersTrigger}.tsx`. Mount InvadersOverlay mid-pipeline as a "wait happily" hook.
6. **Build `desktop-2/src/shell/Cockpit.tsx`** with the perspective root + lerped pointermove driver. Accept `active` prop; skip listener when reduced-motion or inactive.
7. **Build `desktop-2/src/shell/RoomShell.tsx`** with the spring scale + blur transition. Honour IG-008 + IG-011 contracts.
8. **Wrap every section** in `<Cockpit active={…}><RoomShell roomKey={SECTION_ID} atmosphere={…}>…</RoomShell></Cockpit>` (replacing the current `lc2-section-skin` div-stack).
9. **Build `desktop-2/src/shell/AvatarOrbit.tsx`** with the 48 / 18 / 16 px dimension stack. Wire ring tint to a sidecar-health selector (use `lib/healthCheck.ts` from the brand-kit).
10. **Port `desktop-2/src/shell/AvatarPanel.tsx`** as a thin popover (Settings link + Sign out + Upgrade). Do not port the 699-line dashboard host.
11. **Port `desktop-2/src/brand-kit/HudChip.tsx`** with the 4 bracket-corner spans + spring hover/tap.
12. **Port `desktop-2/src/brand-kit/ActivityOrbit.tsx`** for the ambient particle layer over AvatarOrbit.
13. **Build `desktop-2/src/shell/SignalLine.tsx`** with the 5 s rotate / 60 s refresh ticker. Wire to ACCOUNT.rank + SCHEDULE.next + EARN.leader selectors.
14. **Build `desktop-2/src/shell/BottomBar.tsx`** — thin reimplementation. Do not port BottomCockpit's 1,420 lines.
15. **Port `desktop-2/src/shell/NotificationBell.tsx` + overlays/NotificationSheet.tsx**. Rename `junior_message` category to `liquid_message`.
16. **Port `desktop-2/src/overlays/AchievementToast.tsx`** with `toast-slide-in` 280 ms keyframe + 5 s auto-dismiss + queue stacking.
17. **Port `desktop-2/src/overlays/GlobalToastHost.tsx`** wired to `lc:toast` CustomEvent bus. Mount at App root.
18. **Port `desktop-2/src/overlays/EngineCrashOverlay.tsx`** (was `SidecarCrashOverlay.tsx`) with retry / restart / email-support actions. Listen for `subscribeSidecarDied({ recovered: true })`.
19. **Build `desktop-2/src/overlays/FirstRun.tsx`** with 680 px container, 36 px headline, single sign-in CTA.
20. **Replace the inline `<img>` badges in `desktop-2/src/shell/SideNav.tsx`** with `<SideNavItem>` matching v0.7.78's animation contract (already partially done via `MotionNavBadge` in the brand-kit). Add the stagger delays + active pulse + halo + indicator bar.
21. **Apply `.lc-aurora` + `.lc-aurora-blobs`** fixed full-bleed behind the entire app. Behind `z-index: -10`.
22. **Wire `.deck-atmosphere-*`** classes per section using the IG-012 opacity values (§2). Use existing PNGs in `desktop-2/public/brand/atmospheres/`.
23. **Port `.lc-anim-paused` + `[data-content-visibility="hidden"]` + `[data-route-inactive="true"]`** animation budget controls into `desktop-2/src/index.css`.
24. **Stagger nav badge idle bobs** by `-0.3 s` increments (already documented in §6).
25. **Confirm reduced-motion is reactive**: every keyframe wrapped in `@media (prefers-reduced-motion: no-preference)`, every `Cockpit` mount listens to the MediaQueryList `change` event.
26. **Update the guard** (`scripts/assert-shell-contracts.sh`) to check for the new overlays — Splash exists, FirstRun exists, GlobalToastHost mounted at App root, SidecarCrash overlay present, AchievementToast present. Forbid `import …/desktop/components/cockpit/BottomCockpit` and similar 1,420-line drop-ins.
27. **Run brand-kit-drift-check.sh equivalent** on `desktop-2`. The 41 CSS vars + 19 keyframes must match the IG-012 single source of truth.
28. **Smoke-test** the cold-boot path: kill `Liquid Clips.app`, relaunch, confirm cinematic intro → 5 s loading → SplashGame → Continue. Then warm-boot path (no intro).
29. **Snapshot-proof** each surface after the cockpit + atmosphere wraps land. Use `~/.claude/skills/snapshot-proof-lens/`.
30. **Lock IG-LC2-001** (shell tab rail), IG-LC2-002 (fixture loader), IG-LC2-005 (workspace UI) on `desktop-2` once Daniel signs off.

---

## 12. Suggested `desktop-2` file targets

| Old file                                                      | New `desktop-2/` target                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `src/components/Splash.tsx`                                   | `src/overlays/Splash.tsx`                                     |
| `src/components/FirstRun.tsx`                                 | `src/overlays/FirstRun.tsx`                                   |
| `src/components/JuniorLoader.tsx`                             | `src/overlays/EngineLoader.tsx`                               |
| `src/components/LiquidInvaderLoader.tsx`                      | `src/brand-kit/LiquidInvaderLoader.tsx`                       |
| `src/components/AchievementToast.tsx`                         | `src/overlays/AchievementToast.tsx`                           |
| `src/components/GlobalToastHost.tsx`                          | `src/overlays/GlobalToastHost.tsx`                            |
| `src/components/SidecarCrashOverlay.tsx`                      | `src/overlays/EngineCrashOverlay.tsx`                         |
| `src/components/NotificationBell.tsx`                         | `src/shell/NotificationBell.tsx`                              |
| `src/components/NotificationSheet.tsx`                        | `src/overlays/NotificationSheet.tsx`                          |
| `src/components/cockpit/Cockpit.tsx`                          | `src/shell/Cockpit.tsx`                                       |
| `src/components/cockpit/RoomShell.tsx`                        | `src/shell/RoomShell.tsx`                                     |
| `src/components/cockpit/AvatarOrbit.tsx`                      | `src/shell/AvatarOrbit.tsx`                                   |
| `src/components/cockpit/AvatarPanel.tsx`                      | `src/shell/AvatarPanel.tsx` (thin popover, NOT 699 lines)     |
| `src/components/cockpit/SignalLine.tsx`                       | `src/shell/SignalLine.tsx`                                    |
| `src/components/cockpit/BottomCockpit.tsx`                    | `src/shell/BottomBar.tsx` (reimplementation, not port)        |
| `src/components/cockpit/HudChip.tsx`                          | `src/brand-kit/HudChip.tsx`                                   |
| `src/components/cockpit/ActivityOrbit.tsx`                    | `src/brand-kit/ActivityOrbit.tsx`                             |
| `src/components/cockpit/LibraryWall.tsx`/`LibraryCard.tsx`    | `src/sections/projects/ProjectsWall.tsx` / `ProjectCard.tsx`  |
| `src/components/cockpit/WorkstationRoom.tsx`                  | `src/sections/create/CreateRoom.tsx` (StudioHome split off)   |
| `src/components/cockpit/UploadPortal.tsx`                     | `src/sections/create/CreatePortal.tsx`                        |
| `src/components/nav/SideNav.tsx`                              | `src/shell/SideNav.tsx` (already present — augment with stagger + halo + indicator bar) |
| `src/components/nav/SideNavItem.tsx`                          | `src/shell/SideNavItem.tsx`                                   |
| `src/components/invaders/*`                                   | `src/overlays/invaders/*`                                     |
| `src/components/ResultsGrid.tsx`                              | `src/sections/editor/ResultsGrid.tsx` (engine already preserved) |
| `src/components/ClipPreview.tsx`                              | `src/sections/editor/ClipPreview.tsx`                         |
| `src/components/Settings.tsx`                                 | `src/sections/settings/SettingsSection.tsx` (already split)   |
| `src/assets/intro/*`                                          | `desktop-2/public/brand/intro/*`                              |
| `src/assets/invaders/*`                                       | `desktop-2/public/brand/invaders/*`                           |
| `src/assets/icons/connections/library-bug.png`                | `desktop-2/public/brand/icons/connections/library-bug.png`    |
| `src/index.css §aurora`                                       | `desktop-2/src/brand-kit/liquidMotion.css §aurora` (already there — confirm parity) |
| `src/index.css §sidenav`                                      | `desktop-2/src/index.css §sidenav` (port verbatim incl. stagger + halo + indicator) |
| `src/index.css §cockpit-tile`                                 | `desktop-2/src/brand-kit/liquidMotion.css §cockpit-tile`      |
| `src/index.css §library-card / .hud-chip`                     | `desktop-2/src/brand-kit/liquidMotion.css §brackets`          |
| `src/index.css §lc-anim-paused`                               | `desktop-2/src/index.css §animation-budget`                   |
| `desktop/docs/IRON_GATES.md`                                  | `desktop-2/docs/IRON_GATES_LC2.md` (already partially mirrored) |
| `desktop/docs/UI_MAP_workbench.md`                            | `desktop-2/docs/UI_MAP_workbench.md` (port verbatim — workbench contract is workbench contract) |
| `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md`                      | `desktop-2/docs/BRAND_ATMOSPHERE_QUEUE.md`                    |

---

## Provenance + integrity

- Audit date: 2026-06-16.
- Audit basis: `desktop` v0.7.78 — `package.json` line 4, `tauri.conf.json` line 4.
- Components audited (35): Splash, FirstRun, JuniorLoader, LiquidInvaderLoader, AchievementToast, GlobalToastHost, NotificationBell, NotificationSheet, SidecarCrashOverlay, Settings, Logo, MadeWithLiquidClips, Cockpit, RoomShell, WorkstationRoom, UploadPortal, AvatarOrbit, AvatarPanel, BottomCockpit, SignalLine, HudChip, ActivityOrbit, ActivityOrbitParticles, LibraryWall, LibraryCard, LibraryQuickPreview, SideNav, SideNavItem, ResultsGrid, ClipPreview, InvadersCanvas, InvadersOverlay, InvadersTrigger, SplashGame, GlobalToastHost.
- Docs cross-referenced: UI_MAP_workbench.md, UI_MAP_embed_surfaces.md, BRAND_ATMOSPHERE_QUEUE.md, IRON_GATES.md, cockpit-v7-panel.html.
- CSS file: 1,509 lines · 19 keyframes · 41 vars · 33 lc-* class families.
- `/desktop` modified by this audit? **NO.** Read-only inspection.
- `git status desktop/` after audit: unchanged from before.
