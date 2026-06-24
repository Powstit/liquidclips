# Kade Asset Inventory + Cinematic Scope Map

> Exhaustive file inventory across `/Users/dipdip/code/jnr/` + per-scene scope of which assets the new splash cinematic uses, plus the SplashGame's invaders-style fight inventory.
>
> Inventory date: 2026-06-22
> NO generation runs from this map until Daniel signs off scope.

---

## Section 0 · Critical brand finding

There are currently **TWO competing protagonists** in the product:

1. **Kade-the-robot** — small white-paneled cute robot with fuchsia-glow eyes, fuchsia jet-flame at the feet, cyan antenna ball-top. Used on every Settings, HQ, Workstation, Inbox, Mode-pill, and Tier-badge surface. 24+ poses. **This is the canonical character.**

2. **Oasis-boy** — a photoreal teenage human (red-brown hair, hoodie) standing in a synthwave-lit space with floating glass screens + pink token glows. Used ONLY in the currently-deployed `intro.mp4` + `closing-still.png` + `kade-oasis-16x9-startframe.png`. Junior-era protagonist. **Appears NOWHERE else in the product.**

> The new cinematic MUST retire Oasis-boy entirely. The protagonist throughout every scene must be Kade-the-robot, matching every other surface the user touches.

Why this matters: today the customer watches a 28.5s cinematic featuring a teenage boy. The cinematic ends. The next thing they see is the Invaders game (no teenage boy). They then open the app and see Kade-the-robot on every screen. Three different characters in three minutes. The brand fractures at the moment of first impression.

---

## Section 1 · Complete Kade asset inventory (every file across every repo)

### 1.1 desktop-2 (active build)

| Path | Use today |
|---|---|
| `desktop-2/public/brand/kade/kade-base.png` | Canonical Kade · **CHARACTER BIBLE** · use as Higgsfield/Seedance reference for every Kade shot |
| `desktop-2/public/brand/kade/kade-idle.webp` | Idle pose · floating posture with jet-flame |
| `desktop-2/public/brand/kade/kade-hover.webp` | Hover/active pose |
| `desktop-2/public/brand/kade/kade-shooter.webp` | Action stance · fist clenched · pointing finger · jet-flame at feet (cyan antenna · the locked colour for "active") |
| `desktop-2/public/brand/kade/kade-create-clips.webp` | Create-mode posture |
| `desktop-2/public/brand/kade/kade-cutting-clips.webp` | Cutting/editing pose |
| `desktop-2/public/brand/kade/kade-import-footage.webp` | Import / drag-drop pose |
| `desktop-2/public/brand/kade/kade-reading-brief.webp` | Reading / looking-up pose · matches Scene 4 "Kade discovers" intent |
| `desktop-2/public/brand/kade/kade-campaign-mode.webp` | Campaign-mode pose |
| `desktop-2/public/brand/kade/kade-community-mode.webp` | Community-mode pose |
| `desktop-2/public/brand/kade/kade-earn-mode.webp` | Earn-mode pose |
| `desktop-2/public/brand/kade/kade-settings-mode.webp` | Settings-mode pose |
| `desktop-2/public/brand/kade/kade-generating-captions.webp` | Processing state |
| `desktop-2/public/brand/kade/kade-exporting.webp` | Exporting state |
| `desktop-2/public/brand/kade/kade-publishing.webp` | Publishing state |
| `desktop-2/public/brand/kade/kade-success.webp` | Success / completion · jubilant pose |
| `desktop-2/public/brand/kade/kade-celebration.webp` | Celebration / victory |
| `desktop-2/public/brand/kade/kade-error.webp` | Error state |
| `desktop-2/public/brand/kade/kade-warning.webp` | Warning state |
| `desktop-2/public/brand/kade/kade-tier-rookie.webp` | Tier badge: Rookie |
| `desktop-2/public/brand/kade/kade-tier-solo.webp` | Tier badge: Solo |
| `desktop-2/public/brand/kade/kade-tier-climber.webp` | Tier badge: Climber |
| `desktop-2/public/brand/kade/kade-tier-growth.webp` | Tier badge: Growth |
| `desktop-2/public/brand/kade/kade-tier-pro.webp` | Tier badge: Pro |
| `desktop-2/public/brand/loading/kade-eye-loader.json` | Lottie animation: Kade's fuchsia eyes pulsing during load state |
| `desktop-2/dist/brand/kade/*` | Build-output copies (auto-mirrored from public/) |

### 1.2 desktop-2 source code · Kade-named components

| Path | Purpose |
|---|---|
| `desktop-2/src/design-os/components/KadeController.tsx` | React component that drives Kade's state (idle/active/etc.) across the app |
| `desktop-2/src/design-os/components/KadeController.css` | KadeController styles |
| `desktop-2/src/design-os/components/KadeIgnition.tsx` | First-mount ignition animation |
| `desktop-2/src/design-os/components/KadeIgnition.css` | KadeIgnition styles |
| `desktop-2/src/design-os/components/StickyKade.tsx` | Sticky Kade mascot that follows the user across routes |
| `desktop-2/src/design-os/components/StickyKade.css` | StickyKade styles |
| `desktop-2/src/design-os/state/useKadeFromSession.ts` | Hook that picks the right Kade pose from session state |

### 1.3 liquidclips-marketing (active marketing site)

| Path | Use |
|---|---|
| `liquidclips-marketing/public/brand/kade/kade-base.png` | Marketing copy of canonical Kade |
| `liquidclips-marketing/public/brand/kade/kade-idle.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/kade-campaign-mode.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/kade-cutting-clips.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/kade-reading-brief.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/kade-shooter.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/kade-success.webp` | Marketing copy |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-1.{png,webp}` | **NEW** firing sequence · idle pose · NOT yet in desktop-2 |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-2.{png,webp}` | **NEW** · charge pose |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-3.{png,webp}` | **NEW** · fire-start pose (close-up Kade head with cyan-rimmed visor + pink eyes) |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-4.{png,webp}` | **NEW** · fire-peak pose |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-5.{png,webp}` | **NEW** · recoil pose |
| `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-6.{png,webp}` | **NEW** · cool-down pose |
| `liquidclips-marketing/public/brand/kade/up-sequence/_unused/kade-up-{1-6}-{label}.png` | Labelled variants of the same 6 frames (idle/charge/fire-start/fire-peak/recoil/cool) |
| `liquidclips-marketing/scripts/gen-kade-up-sequence.mjs` | Script that generated the up-sequence |
| `liquidclips-marketing/scripts/gen-kade-sprite-sheet.mjs` | Spritesheet generator |
| `liquidclips-marketing/scripts/crop-kade-sprite-sheet.mjs` | Crop helper |
| `liquidclips-marketing/scripts/strip-bg-kade-sheet.mjs` | Background-removal helper |
| `liquidclips-marketing/scripts/compress-kade-frames.mjs` | Compression |
| `liquidclips-marketing/scripts/compress-kade-sheet.mjs` | Spritesheet compression |
| `liquidclips-marketing/src/components/funnel/KadeScansWindow.tsx` | Marketing funnel · Kade-scans window |
| `liquidclips-marketing/src/components/funnel/panels/KadeHead.tsx` | Marketing funnel · Kade head component |
| `liquidclips-marketing/_public-orphans-archive/kade-command-centre.png` | Archived hero (NOT in active build) |
| `liquidclips-marketing/_public-orphans-archive/kade-oasis-hero.png` | Archived Oasis-era hero (NOT in active build) |
| `liquidclips-marketing/docs/audit-screenshots/03-kade-scans.png` | Audit screenshot · for reference only |
| `liquidclips-marketing/docs/funnel-screenshots/lock-1-console-idle-kade.png` | Funnel screenshot · reference |
| `liquidclips-marketing/docs/funnel-screenshots/page-3-kade-scans.png` | Funnel screenshot · reference |

**Critical new finding · Kade up-sequence (6 frames + labelled variants + spritesheets) exists in marketing but is NOT YET PORTED TO desktop-2.** This is the firing animation sequence the splash game could use to animate Kade visually shooting bugs in the cockpit. Action item: port these 6 frames into `desktop-2/public/brand/kade/up-sequence/` before they're needed in the cinematic or game.

### 1.4 assets-wip workshop

| Path | Use |
|---|---|
| `assets-wip/character/hero-character-v1.png` | Early Kade hero exploration (v1) · use as reference |
| `assets-wip/character/hero-character-LOCKED.png` | **LOCKED** Kade hero · canonical full-body bible (use alongside `kade-base.png` for Higgsfield character lock) |
| `assets-wip/intro-30s/kade-oasis-16x9-startframe.png` | **OASIS-BOY** · the teenage human · DEPRECATE |
| `assets-wip/intro-30s/closing-still.png` | **OASIS-BOY** with floating fuchsia tokens · DEPRECATE for cinematic, keep for loading-stage backdrop until new cinematic exists |
| `assets-wip/intro-30s/intro-master.mp4` | OLD 30s cinematic (Oasis-boy) · reference only · do not ship |
| `assets-wip/intro-30s/intro-15s-landing.mp4` | Short variant · reference only |
| `assets-wip/intro-30s/intro-8s-splash.mp4` | 8s variant · reference only |
| `assets-wip/intro-30s/intro-master-silent.mp4` | Silent master · reference only |
| `assets-wip/intro-30s/seg1-4.mp4` + `seg{1,2,3,4}-end.png` + `seg{1-2}-{transition}.mp4` | Modular segments of the OLD Oasis cinematic · reference for cut-language only |
| `assets-wip/banners/whop-liquid-clips/kade-01-04*.png` (8 files) | Whop campaign banners featuring Kade · NOT for cinematic, reference for "Kade in commercial frame" |
| `assets-wip/splash-v2/scene-1-anchor.png` | First (incorrect) gen attempt · KEEP as audit trail, do not ship |

### 1.5 desktop (old · v0.4.x · reference only)

| Path | Use |
|---|---|
| `desktop/docs/demo-assets/kade-oasis-hero.png` | Old-desktop Oasis-era hero · reference only |

### 1.6 junior-backend

| Path | Use |
|---|---|
| `junior-backend/app/assets/kade-glyph-64.png` | 64×64 Kade glyph · used in Resend email templates (MIME-inlined) |

### 1.7 marketing (legacy)

| Path | Use |
|---|---|
| `marketing/img/kade-oasis-hero.png` | Old marketing Oasis hero · reference only |

### 1.8 scripts

| Path | Use |
|---|---|
| `scripts/gen-whop-banners-kade.py` | Python script that generated the Whop Kade banners |

---

## Section 2 · Antagonist asset inventory · the bugs

Two distinct visual registers exist for the antagonists. The cinematic uses one; the game uses the other; the hand-off is the transition between them.

### 2.1 Cinematic-register bugs · 3D illustrated brand-kit (desktop-2/public/brand/enemies/)

| Asset | Visual | Symbolic role in cinematic |
|---|---|---|
| `bug-grunt.webp` | Cyan-eye humanoid drone | **Wasted time** (the basic universal tax) |
| `bug-spider.webp` | Black spider with cyan-glow markings + lightning streaks | **Manual editing** (the spider trapping creators in webs) |
| `bug-glitch.webp` | Black ant with cyan eyes + electric streaks + smoke-dissolve tail | **Complexity / friction** (the glitch that wastes attention) |
| `bug-rulebreak.webp` | Red-tinted enemy · breaks the rules | **Endless subscriptions** (the rule-breaker who taxes everything) |
| `bug-mothbug.webp` | Flapping moth-shaped pest | **Chasing algorithms** (always chasing the light) |
| `repair-drone.webp` | The misfit ally · friendly automation that fails creators today | **Failed automation** (it tried to help, it didn't) |
| `bug-shatter-fragments.png` | Shatter VFX particles | Death VFX when a bug is defeated (gameplay overlay) |
| `laser-beam.svg` | Laser-beam FX | Player attack VFX |

**Visual language**: 3D-rendered toy/figurine style. CYAN glowing eyes/markings (the antagonist colour). Matte black bodies. Same illustration register as Kade himself · just different palette signal.

### 2.2 Gameplay-register sprites · 8-bit pixel arcade (desktop-2/public/brand/invaders/)

| Asset | Size | Purpose |
|---|---|---|
| `player-ship.png` | 1.3 MB · pixel-art | Player ship (current) |
| `player_ship.png` | 5.5 MB · pixel-art | Player ship (legacy oversized · candidate for cleanup) |
| `bullet-player.png` | 1.4 MB | Player bullets |
| `invader-wasp.png` | 1.6 MB | Small invader sprite |
| `bullet-invader.png` | 956 KB | Enemy bullets |
| `grunt.png` | 4.9 MB · pixel-art purple/black with fuchsia outline | Grunt enemy (Space Invaders aesthetic) |
| `elite.png` | 5.6 MB · pixel-art | Elite enemy |
| `drone.png` | 5.3 MB · pixel-art | Drone enemy |
| `mothership.png` | 5.6 MB · pixel-art | Mothership / boss |
| `boss.png` | 5.7 MB · pixel-art | Large boss sprite |
| `splash-bg.png` | 2.3 MB | Splash screen background (synthwave) |

**Visual language**: 8-bit pixel-art. Fuchsia outlines on purple/black bodies. Classic Space Invaders aesthetic.

**Current state**: sprite preload is DISABLED in `InvadersCanvas.tsx` (v0.6.0 found opaque-background PNGs). Game falls through to a procedural geometric-shape renderer (fuchsia diamonds/ovals on the synthwave backdrop). The pixel-art sprites are on disk but not rendering today. TASK 7-Tier-1 harness locks this disabled-on-purpose state.

---

## Section 3 · Per-scene asset scope · the new cinematic

> Six shots · ~24-28s total · every shot uses Kade-the-robot as protagonist + the 3D-illustrated bugs as antagonists · zero use of Oasis-boy.

### Scene 1 · The broken creator economy (4s)
- **Protagonist**: Kade · hunched · sitting at small dark desk · same character as `kade-idle.webp` but with shoulders dropped, fuchsia eyes dim, jet-flame off (sitting · not floating).
- **Antagonist**: subscription-tax cards (white/cyan SaaS-card style · NOT bugs yet · the tax is invisible-systemic in Scene 1, embodied-creature in Scene 5).
- **Environment**: stylised dark cockpit register matching `desktop-2/public/brand/worlds/boot-sequence.webp` · NOT photoreal room.
- **REUSE**: `kade-base.png` + `kade-idle.webp` as character bible · `boot-sequence.webp` as environment reference.
- **NEW** (1 still): Kade-hunched-at-desk-with-subscription-cards-overhead · Higgsfield · character locked to bible.

### Scene 2 · Creators trapped (4s)
- **Protagonists**: MANY Kades · a grid of identical Kade-bots in identical isolated cubicles · each hunched, each with their own translucent long-form video panel floating above showing trapped golden moments inside.
- **Antagonist**: the cubicle grid itself · isolation as system.
- **Environment**: aerial pull-back over the grid · same dark cockpit register.
- **REUSE**: same Kade bible × multiplied (Seedance can clone the character across the grid).
- **NEW** (1 still): aerial-pull-back-Kade-grid · Higgsfield/Seedance · cinematic camera move.

### Scene 3 · Hidden opportunities (4s)
- **Protagonists**: same Kade grid from Scene 2 · still trapped below.
- **Antagonist**: invisible · the campaign briefs floating ABOVE the grid that none of the Kade-bots below can see.
- **Environment**: 180° camera sweep · briefs labeled in stark monospace type with stylised reward labels ("$2,500 · CLIP THIS" · "$11K · BRAND SPONSOR" — these are CATEGORY labels not real metrics).
- **REUSE**: Kade grid from Scene 2 · `desktop-2/public/brand/icons/action/campaign/reward.svg` for visual reference of the brief-icon language.
- **NEW** (1 still): floating-briefs-over-grid · Seedance · camera-sweep.

### Scene 4 · Kade discovers Liquid Clips (5s)
- **Protagonist**: ONE Kade · separated from the grid · the user's avatar.
- **Pose continuity**: matches `kade-reading-brief.webp` (head turned, looking up at something on glass) BUT with eyes brightening from dim to full fuchsia glow over the 5 seconds.
- **Environment**: black room with glass screen at chest height · the prior Scene 3 view reflected on the glass.
- **REUSE**: `kade-reading-brief.webp` as pose bible · `kade-base.png` as character bible.
- **NEW** (1 still): Kade-touches-glass-briefs-swarm-to-hand · Higgsfield · close-up character moment · this is THE protagonist-establishing shot.

### Scene 5 · System activation (5s)
- **Protagonist**: same Kade from Scene 4 · stepping forward as the glass dissolves.
- **Antagonists materialise**: the SIX bug-creatures from `desktop-2/public/brand/enemies/` pop into existence around Kade in the cockpit world. Each bug arrives with a subtle CYAN flash (matching their cyan-eye signature).
- **Environment**: transitions from boot-sequence (Scene 4) into `cockpit-home.webp` aesthetic. This is where Kade enters the Liquid Clips system.
- **REUSE**:
  - Kade: `kade-cutting-clips.webp` (the active stance) → transition into `kade-shooter.webp` posture by end of scene.
  - Bugs: `bug-grunt.webp` + `bug-spider.webp` + `bug-glitch.webp` + `bug-rulebreak.webp` + `bug-mothbug.webp` + `repair-drone.webp` (all six brand-kit enemies composited in).
  - Environment: `cockpit-home.webp` as backdrop reference.
- **NEW** (1 still): Kade-walking-among-materialising-bugs · Seedance composite · this is the highest-skill shot because it integrates 7 existing brand assets into one composition.

### Scene 6 · Enter the game (4-6s)
- **Protagonist**: Kade walks to cockpit centre · adopts the `kade-shooter.webp` shooter stance behind a faint outline of the gameplay `player-ship.png` silhouette.
- **Antagonists**: the six 3D-illustrated bugs from Scene 5 arrange into the Invaders formation. In the FINAL 1 second, they morph from 3D-illustrated → 8-bit pixel-art (the gameplay `grunt.png` / `elite.png` / `drone.png` / `mothership.png` sprites). This is the visual handoff: real-world bug becomes arcade-game bug · the system has reduced the antagonists from "threat" to "game challenge."
- **REUSE**:
  - Kade: `kade-shooter.webp` as final-frame pose.
  - 3D bugs (start): same 6 from Scene 5.
  - Pixel bugs (end): `grunt.png` + `elite.png` + `drone.png` + `mothership.png` from `public/brand/invaders/`.
  - Player ship: `player-ship.png` silhouette underlay.
  - Background: `splash-bg.png` as the locked final frame.
- **NEW** (1 still + 1 motion sequence): hand-off frame · Seedance · this is the MOST technical shot because the final frame must pixel-align to `splash-bg.png` for the cinematic→game cut.

### NEW shots summary
| Scene | NEW asset | Engine | Reuses (bible/reference) | Why new |
|---|---|---|---|---|
| 1 | Kade-hunched-at-desk-with-subscription-cards | Higgsfield | `kade-base.png`, `kade-idle.webp`, `boot-sequence.webp` | No existing pose with seated-defeated-cards-overhead composition |
| 2 | Aerial-pull-back over Kade grid | Higgsfield / Seedance | `kade-base.png` (cloned) | No existing multi-Kade aerial asset |
| 3 | Floating campaign briefs over Kade grid · 180° sweep | Seedance | Scene 2 frame · campaign icons from brand kit | No existing brief-overlay asset · sweep is a NEW camera move |
| 4 | Kade-touches-glass-briefs-swarm | Higgsfield | `kade-reading-brief.webp`, `kade-base.png` | No existing animated discovery shot |
| 5 | Kade-walks-among-bugs (composite) | Seedance | `kade-cutting-clips.webp` + 6 bug sprites + `cockpit-home.webp` | No existing combined character + 6-enemy composite |
| 6 | Hand-off frame (3D bugs morph to pixel sprites) | Seedance | `kade-shooter.webp` + 6 bug sprites + 4 pixel sprites + `splash-bg.png` | No existing morph-transition asset · this is the CRITICAL hand-off |

**Total NEW shots: 6.** All character-consistent via `kade-base.png` + `hero-character-LOCKED.png` as the locked bible.

---

## Section 4 · SplashGame · the Space-Invaders-style fight

> The arcade gameplay sits between the cinematic and the AppShell. Specific assets it uses today + the scope for visual upgrade once the cinematic ships.

### 4.1 Current gameplay state (locked by TASK 7 Tier 1)
- **Renderer**: `desktop-2/src/overlays/invaders/InvadersCanvas.tsx` · geometric-shape procedural renderer (fuchsia diamonds/ovals on synthwave backdrop).
- **Sprite preload**: **DISABLED** since v0.6.0 (Higgsfield-generated PNGs had opaque backgrounds · falls through to geometric fallback).
- **Engine**: `desktop-2/src/lib/invaders/{engine,highScore,store}.ts` · classic Space Invaders mechanics (rows of enemies marching down, player ship at bottom, bullets up/down, score, hi-score).
- **Mounted globally**: `<InvadersOverlay />` in `App.tsx:94` so the game is always accessible after splash.
- **Control inputs**: SPACE to start · Arrow/WASD to move · SPACE to shoot · Enter to continue once minHold expires.
- **Test seam**: `data-testid="splash-game-canvas"` + `data-renderer="geometric"` on the canvas element (TASK 7 harness lock).

### 4.2 Assets available for gameplay use (currently disabled)

#### Pixel-art arcade sprites (intended path · disabled)
- `desktop-2/public/brand/invaders/player-ship.png` — Player ship
- `desktop-2/public/brand/invaders/bullet-player.png` — Player bullets
- `desktop-2/public/brand/invaders/bullet-invader.png` — Enemy bullets
- `desktop-2/public/brand/invaders/grunt.png` — Grunt enemy (row 1)
- `desktop-2/public/brand/invaders/elite.png` — Elite enemy (row 2)
- `desktop-2/public/brand/invaders/drone.png` — Drone enemy (rows 3-4)
- `desktop-2/public/brand/invaders/mothership.png` — Mothership (top row + boss)
- `desktop-2/public/brand/invaders/boss.png` — Big-boss sprite
- `desktop-2/public/brand/invaders/invader-wasp.png` — Small invader variant
- `desktop-2/public/brand/invaders/splash-bg.png` — Background (synthwave)

#### 3D-illustrated brand-kit antagonists (cinematic register · NOT currently used in gameplay)
- `desktop-2/public/brand/enemies/bug-grunt.webp`
- `desktop-2/public/brand/enemies/bug-spider.webp`
- `desktop-2/public/brand/enemies/bug-glitch.webp`
- `desktop-2/public/brand/enemies/bug-rulebreak.webp`
- `desktop-2/public/brand/enemies/bug-mothbug.webp`
- `desktop-2/public/brand/enemies/repair-drone.webp`
- `desktop-2/public/brand/enemies/bug-shatter-fragments.png` (death VFX)
- `desktop-2/public/brand/enemies/laser-beam.svg` (attack VFX)

#### Kade firing sequence (in marketing · NOT YET PORTED to desktop-2)
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-1.webp` — idle
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-2.webp` — charge
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-3.webp` — fire-start
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-4.webp` — fire-peak
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-5.webp` — recoil
- `liquidclips-marketing/public/brand/kade/up-sequence/kade-up-6.webp` — cool-down

**Action item · port these 6 frames to `desktop-2/public/brand/kade/up-sequence/`** so the SplashGame can show Kade as the ship-pilot doing the actual firing instead of a faceless silhouette. This single change makes the game feel like Kade-the-protagonist continues playing, not a generic arcade.

### 4.3 Gameplay scope for v2.1 launch (locked recommendation)

**Tier 1 · Ship-safe today (zero risk · CURRENTLY LIVE):**
- Keep `InvadersCanvas` geometric renderer active.
- Game plays clean, no missing-asset risk, no sprite-quality surprises.
- TASK 7 harness locks the state.

**Tier 2 · v2.1.1 sprite-quality polish (scheduled):**
- Run alpha-channel audit on the 10 pixel-art invaders sprites + the 6 cinematic-bug sprites.
- Resize the 5MB pixel-art PNGs to compressed 256×256 webp.
- Port the 6 Kade up-sequence frames from marketing into desktop-2.
- Re-enable sprite preload with strict alpha gate + automatic fallback to geometric on any sprite failure.

**Tier 3 · v2.1.2 brand-kit unification (optional · powerful):**
- Replace the 8-bit pixel-art invaders with the 3D-illustrated brand-kit bugs (one register across cinematic + game).
- Use Kade firing sequence (up-1 through up-6) as the ship operator visible in the cockpit.
- This makes the game visually identical to the cinematic's final frame · zero perceptible cut.

Tier 3 is the visual ideal but requires bug-sprite cleanup (alpha channels + sizing) AND a small engine change to render webp animated sprites instead of static PNGs. Not blocking for 2.1 launch.

---

## Section 5 · Generation plan (no spend until sign-off)

For each of the 6 NEW shots in Section 3, the corrected prompt skeleton:

### Universal character lock (applied to EVERY shot featuring Kade)
> Character bible references (attach to every generation call):
> - `desktop-2/public/brand/kade/kade-base.png` · canonical front-on still
> - `assets-wip/character/hero-character-LOCKED.png` · full-body reference
>
> Locked attributes: small humanoid robot · white-paneled body with black joint accents · matte rounded helmet with cyan-rimmed dark-glass visor · two fuchsia (`#FF1A8C`) glowing eye lights inside the visor · small antenna with cyan ball on top · fuchsia jet-flame at the feet when floating · friendly cute-mascot proportions (head ~28% body height) · 3D-rendered illustrated CGI style (like a polished animated film character).
>
> Forbidden: ANY photoreal human · dark silhouette only · documentary photography style · alternative eye colours · Wall-E / Eve / Baymax resemblance · humanoid proportions · multi-piece costume · the Oasis-boy teen.

### Scene 1 prompt skeleton (corrected · supersedes the spec)
> Cinematic 16:9 still in 3D-rendered illustrated brand style matching `kade-base.png`. Kade-the-robot (white-paneled cute robot, fuchsia-glow eyes, cyan-rimmed visor, jet-flame off · he is sitting not floating) sits hunched at a small dark desk in a stylised digital cockpit room matching the `boot-sequence.webp` environment. Above his head, eight translucent floating subscription-tax cards stack in receding isometric arrangement, each labeled in stark monospace type: "EDITING $39/MO", "SCHEDULER $89/MO", "ANALYTICS $49/MO", "CAPTIONS $19/MO", "THUMBNAILS $29/MO", "AI ASSIST $99/MO", "STOCK FOOTAGE $59/MO", "ANALYTICS+ $89/MO". Kade's shoulders are dropped. His fuchsia eyes are dim (low brightness · 30% of normal glow). The frame palette is fuchsia (`#FF1A8C`) plus ink (`#0B0B10`) plus warm paper · NO photoreal blue. The lighting is the same dark-cockpit register as the rest of the product. Cinematic depth-of-field, Kade in sharp focus, subscription cards slightly softer above. NO humans. NO photoreal photography. NO Oasis-boy.

### Scenes 2-6 prompt skeletons
Spec these once Scene 1 is validated. Same character lock. Same palette discipline. Same illustration register. Full prompts written into the next revision of `NEW_SPLASH_CINEMATIC_SPEC.md` after Scene 1 confirmation.

---

## Section 6 · Sign-off checklist

Before any next gpt-image-1 / Higgsfield / Seedance call runs, confirm:

- [ ] You agree Oasis-boy is retired from the cinematic.
- [ ] You agree the cinematic protagonist is Kade-the-robot exclusively, using `kade-base.png` + `hero-character-LOCKED.png` as the character bible.
- [ ] You agree the antagonists in the cinematic are the existing `desktop-2/public/brand/enemies/` 3D-illustrated bugs (cyan-eye palette).
- [ ] You agree the cinematic→game hand-off is a 3D-to-pixel-art morph in Scene 6's final second (3D bugs become pixel-art invaders).
- [ ] You agree the SplashGame stays on the geometric renderer for v2.1 launch (no sprite re-enable in this release).
- [ ] You authorise Scene 1 regeneration with the corrected Kade-the-robot prompt (~$0.06 · gpt-image-1).

Once these six boxes are checked, I run Scene 1 with the corrected prompt and open it. If you accept it, the other 5 scenes follow the same pattern at ~$0.06 each (~$0.36 total for the storyboard). Higgsfield motion still lives with you for the web-UI step.

---

## TL;DR

- 71 Kade-named files exist across 6 repos. 24 are the canonical 3D-illustrated brand bible. 6 are a NEW firing sequence in marketing not yet ported to desktop-2. 14 are Whop-banner derivatives. 6 are screenshots/audit references. The rest are source-code components.
- The `kade-base.png` + `hero-character-LOCKED.png` pair is the **character bible** for every cinematic shot.
- The CURRENTLY-DEPLOYED cinematic features Oasis-boy · a teenage human who appears nowhere else in the product. He must be retired.
- The cinematic uses Kade as protagonist + the 6 3D-illustrated brand-kit bugs as antagonists + 8 specific Kade poses across 6 scenes.
- The SplashGame keeps its geometric renderer for v2.1 launch (Tier 1 safe). Tier 2 sprite polish + Tier 3 brand-kit unification land in v2.1.1+.
- 6 NEW shots needed for the cinematic, each with a Kade character lock. Scene 1 retry first, validate, then proceed with 2-6. Higgsfield motion + final stitching is the user's job.
- Spend if all 6 storyboard stills are approved: ~$0.36 total via gpt-image-1.
