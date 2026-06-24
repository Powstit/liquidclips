# P1-2B Addendum · Game / Bug / FX Asset Audit
### Audit-only · NO CODE · NO ASSETS GENERATED

*Date · 2026-06-19 · Author · Claude*

The purpose: verify whether the generated game-style assets (bugs · enemies · invaders · FX lighting · FX particles · loaders · nav badges · atmospheres · clip-fx) are TRULY unused polish or accidentally hidden / clipped / unwired.

The previous P1-2B-a audit classified these as "parking-lot polish." This addendum re-tests that assumption against `grep`-verified usage.

---

## 0 · Headline

The "parking-lot polish" framing of P1-2B-a was **too optimistic**. Approximately **~50 generated assets are shipped in `public/brand/` but invisible to the active design-OS user**. Highest-leverage gaps:

- **8 bug / enemy WebPs** · zero references anywhere
- **6 fx/lighting SVGs** · zero references (the "1 hit" for aurora / spotlight / vignette are copy-word matches, not asset loads)
- **10 fx/particles Lottie JSONs** · zero references (the "1 hit" for hologram is a copy word)
- **8 loader assets** (4 Lottie + 4 SVG) · zero references · this is the worst gap because beta users wait at handshake points and currently see CSS spinners
- **9 nav-badges** · wired to legacy shell only · which the design-OS occludes via `body[data-design-os="active"]`
- **5 atmosphere PNGs** · same legacy-shell-only wiring · invisible today

NONE of these is broken by CSS / z-index / clipping. They are simply **not referenced in source.** Daniel's question is answered: they're not hidden, they're un-wired.

Per Daniel's instructions: **no wiring inside P1-2B.** This audit only re-classifies them from "parking-lot" to "required visual identity work" for a follow-up polish phase.

---

## 1 · Family-by-family inventory

### 1.1 · Invaders (mini-game sprites) · ✅ WIRED

| File | Status |
|---|---|
| `boss.png · bullet-invader.png · bullet-player.png · drone.png · elite.png · grunt.png · invader-wasp.png · mothership.png · player-ship.png · player_ship.png · splash-bg.png` | Consumed by `InvadersOverlay`, `InvadersCanvas`, `InvadersTrigger`, `SplashGame`, `IntroSplash`, `DropZone`, `App.tsx` |

**No work needed.** Mid-pipeline mini-game is wired.

### 1.2 · Enemies / Bugs · ❌ ZERO REFERENCES

| File | Status |
|---|---|
| `bug-glitch.webp · bug-grunt.webp · bug-mothbug.webp · bug-rulebreak.webp · bug-shatter-fragments.png · bug-spider.webp · laser-beam.svg · repair-drone.webp` | **NONE** referenced anywhere in `src/` |

**8 generated bug assets · unused.** These are the "bugs" Daniel remembered. They were created as game-world adversaries but never wired into:
- An error state surface
- StopPages (which is currently the SimPage placeholder)
- The Engine's stuck-state recovery
- A "this campaign has issues" affordance

### 1.3 · Nav badges · ⚠️ WIRED-TO-DEAD-LEGACY

| File | Status |
|---|---|
| `community.png · earn.png · learn.png · library.png · payouts.png · schedule.png · settings.png · upload.png · workspace.png` | Referenced ONLY via `brand/brandAssets.ts` `NAV_BADGE_MAP` |

The registry's consumers are `shell/SideNav.tsx · shell/TopBar.tsx · shell/AppShell.tsx` — the **legacy shell** which is occluded by `body[data-design-os="active"] .lc-sidenav { visibility: hidden !important }` (see `design-os/components/AppShell.css:24-37`).

The active design-OS `ConsoleNav.tsx` uses its OWN static `ITEMS` array pointing at `/brand/icons/nav/*.svg`, not the nav-badge PNGs.

**9 nav-badges · effectively dead in the active surface.** They render only when the legacy shell is shown — which is never, in design-OS mode.

### 1.4 · Atmospheres · ⚠️ WIRED-TO-DEAD-LEGACY

| File | Status |
|---|---|
| `atmosphere-earn.png · atmosphere-library.png · atmosphere-schedule.png · atmosphere-settings.png · atmosphere-workspace.png` | Referenced ONLY via `brand/brandAssets.ts` `ATMOSPHERE_MAP` |

Same fate as nav badges. Consumed by the legacy shell only.

The design-OS replaces atmospheric depth with the 8 world WebPs in `WorldLayer.tsx` · these 5 atmosphere PNGs are redundant with the world layer and don't currently render.

### 1.5 · FX lighting · ❌ ZERO REFERENCES

| File | Status |
|---|---|
| `aurora.svg` | "1 hit" in `AppShell.tsx` + `DesignOSBoundary.tsx` · both are CSS class-name matches (`.lc-aurora`), NOT `<img src>` loads |
| `beam-cyan.svg · beam-fuchsia.svg` | NONE |
| `rim-streak.svg` | NONE (the world layer's `.lc-world-rim` is a CSS gradient, not this SVG) |
| `spotlight.svg` | "1 hit" in `campaigns/types.ts` + `sidecar-stub.ts` · matches the literal string `"category_spotlight"`, NOT the SVG |
| `vignette.svg` | "1 hit" in `WorldLayer.tsx` · matches the CSS class `.lc-world-vignette`, NOT the SVG |

**6 lighting SVGs · unused.** Every grep hit is a coincidental word match · NO `<img src>` or `background-image` references the SVGs themselves. The world layer paints atmosphere with CSS gradients (`WorldLayer.css`); these dedicated SVGs would add finer cinematic detail (rim-streak, fuchsia/cyan beams across the world) but are not wired.

### 1.6 · FX particles (Lottie animations) · ❌ ZERO REFERENCES

| File | Status |
|---|---|
| `bug-shatter.json · coin-orbit.json · confetti.json · dust.json · hologram.json · laser-trail.json · publish-streak.json · smoke-trail.json · sparks.json · viral-spark.json` | All NONE (the "1 hit" for hologram is a copy-word in `copyMap.ts`, not a Lottie load) |

**10 Lottie particle animations · unused.** No Lottie player is mounted anywhere. The natural lighting-up moments today are silent:

- Achievement unlock toasts have no confetti
- First-publish has no `publish-streak`
- Viral milestone has no `viral-spark`
- Earn page has no `coin-orbit` headline particle
- World backgrounds have no `dust` ambient
- Engine bake transitions have no `sparks` / `laser-trail` / `smoke-trail`
- StopPages / error states have no `bug-shatter`
- LoginOnboarding's "Activating…" has no `hologram` premium feel

### 1.7 · Loading assets · ❌ ZERO REFERENCES · **highest-leverage gap**

| File | Status | Intended moment |
|---|---|---|
| `kade-eye-loader.json` (Lottie) | NONE | Kade-voiced loading state (LoginOnboarding "Activating…" / Settings refresh) |
| `loader-ayrshare-handoff.json` (Lottie) | NONE | Schedule / Channels Ayrshare connect handshake |
| `loader-whop-handoff.json` (Lottie) | NONE | Whop reward validation (P1-1D) / Whop community open |
| `loader-campaign-sync.json` (Lottie) | NONE | Campaign discovery + agency-creation publish |
| `ring-clip-process.svg` | NONE | Clip pipeline progress |
| `ring-export.svg` | NONE | Export route progress |
| `bar-fuchsia.svg · rail-segmented.svg` | NONE | Generic progress chrome |

**8 loader assets · unused.** Beta users currently see plain CSS spinners or "Loading…" text at exactly the integration moments these were generated for. This is the single biggest "world-feel" gap in the app today · every Whop / Ayrshare / Campaign handshake is silent.

### 1.8 · Leaderboard · ✅ WIRED

| File | Status |
|---|---|
| `badge-crown.svg · badge-shield.svg · badge-trophy.svg · rank-1-gold/-2-silver/-3-bronze.svg · rank-numeric.svg · tier-climber/-growth/-pro/-rookie/-solo.webp` | Consumed by `ConsoleNav.tsx`, `LeaderboardSection.tsx`, `useCommunity.ts`, `achievements.ts`, `RewardClipDrawer.tsx`, `sidecar-stub.ts` |

**No work needed.**

### 1.9 · Achievement badges · ✅ WIRED

| File | Status |
|---|---|
| `first-clip.png · first-payout.png · first-publish.png · first-referral.png · hundred-clips.png · hundred-dollars.png · top-100-leaderboard.png · viral-clip.png` | Consumed by `AchievementToast.tsx`, `ClipperSection.tsx`, `brandAssets.ts`, `motion/presets.ts` |

**No work needed at file level.** Note · the AchievementToast fires but has no confetti Lottie alongside (see §1.6).

### 1.10 · Clip-fx · ⚠️ PARTIALLY USED

| File | Wired? | Where |
|---|---|---|
| `card-stack.svg` | ✅ | ConsoleNav (Library nav icon) |
| `laser-cut-line.svg` | ✅ | ConsoleNav (Engine nav icon) |
| `rocket-export.webp` | ✅ | ConsoleNav (Export nav icon) + CommandRoom Studio Engine card |
| `timeline-block.svg` | ✅ | ConsoleNav (Studio nav icon) |
| `trail-publish.svg` | ✅ | ConsoleNav (Channels nav icon) |
| `beam-upload.svg` | ❌ | NONE · candidate for CreateClips drop-zone fx |
| `caption-bubble.svg` | ❌ | NONE · candidate for caption editor in Studio |
| `fragment-shards.png` | ❌ | NONE · candidate for clip-pipeline-error state |
| `marker-hook.svg` | ❌ | NONE · candidate for TimelineStudio hook marker |
| `marker-viral.svg` | ❌ | NONE · candidate for top-clip marker on Earn |

**5 of 10 clip-fx variants unused.**

---

## 2 · Answers to the seven directive questions

### Q1 · Which generated game/bug/FX assets exist?

~120 brand assets across `invaders / enemies / nav-badges / atmospheres / fx-lighting / fx-particles / leaderboard / achievement-badges / loading / clip-fx`. Inventory above.

### Q2 · Where are they currently used?

Wired families: `invaders ✅`, `leaderboard ✅`, `achievement-badges ✅`, `clip-fx` partial. See §1.1, §1.8, §1.9, §1.10.

Unwired families · everything else (bugs · fx lighting · fx particles · loaders · nav-badges in design-OS · atmospheres in design-OS · 5 clip-fx variants).

### Q3 · Which should be used where?

| Asset family | Natural surface | Rationale |
|---|---|---|
| **Loaders · `kade-eye-loader.json`** | LoginOnboarding "Activating…" state · Settings "Refresh account status" | Replace generic CSS spinner with Kade-voiced loader · highest visibility |
| **Loaders · `loader-whop-handoff.json`** | Step 1 reward validation (agency creation) · WhopRewardCard refresh | Currently silent · Whop is the single most-watched handshake in beta |
| **Loaders · `loader-ayrshare-handoff.json`** | Channels connect · Schedule publish | Same logic for Ayrshare |
| **Loaders · `loader-campaign-sync.json`** | Campaigns discovery load · agency publish | Closes the campaign list loading gap |
| **Loaders · `ring-clip-process.svg`** | Engine clip pipeline progress | Replace CSS spinner |
| **Loaders · `ring-export.svg`** | Export queue progress | Replace CSS spinner |
| **Particles · `confetti.json`** | AchievementToast unlock | The toast fires silent today · this adds the celebration moment |
| **Particles · `viral-spark.json`** | Earn route on top-clip milestone or first viral row | Light-up moment |
| **Particles · `coin-orbit.json`** | Earn route headline · payout success | Brand-recognizable money cue |
| **Particles · `publish-streak.json`** | Schedule "rocket fired" success · Channels first connect | Reinforces the success state |
| **Particles · `dust.json`** | Ambient world layer (low-opacity overlay) | Adds cinematic depth |
| **Particles · `sparks / laser-trail / smoke-trail.json`** | Engine bake transitions (cut/reframe stages) | Engine currently feels static during processing |
| **Particles · `bug-shatter.json`** | StopPages · Engine error state | Pairs with the bug WebPs |
| **Particles · `hologram.json`** | LoginOnboarding card · Settings premium tier badge | Premium-feel addition |
| **Bugs · `bug-glitch · bug-grunt · bug-mothbug · bug-rulebreak · bug-spider`** | StopPages (when finally wired beyond SimPage) · Engine error vignettes · InvadersOverlay additional sprites | World-world story: bugs threaten the workflow, Kade defeats them |
| **Bugs · `repair-drone.webp`** | Engine "recovering from error" state · positive counterpart to the bugs | Brand-recognizable rescue cue |
| **Bugs · `laser-beam.svg`** | Engine transitions · clip-pipeline progress | Subtle motion accent |
| **FX lighting · `aurora.svg`** | World layer overlay on cockpit-home + studio-deck | Atmospheric ceiling |
| **FX lighting · `beam-cyan.svg · beam-fuchsia.svg`** | World layer accent strokes · CommandRoom hero | Brand-color punctuation |
| **FX lighting · `rim-streak.svg`** | World layer (currently a CSS gradient) | Higher-fidelity rim than the gradient |
| **FX lighting · `spotlight.svg`** | Featured-campaign banner background · MissionPedestal hero | Story-tells the spotlight |
| **FX lighting · `vignette.svg`** | World layer (currently a CSS radial-gradient) | Higher-fidelity vignette |
| **Clip-fx · `beam-upload.svg`** | CreateClips drop-zone success animation | Drop feedback |
| **Clip-fx · `caption-bubble.svg`** | Studio caption editor selected-style indicator | Replaces text-only state |
| **Clip-fx · `fragment-shards.png`** | Clip-pipeline error backdrop | Pairs with bug visuals |
| **Clip-fx · `marker-hook.svg`** | TimelineStudio hook marker · Studio brief callout | Story marker |
| **Clip-fx · `marker-viral.svg`** | Earn route top-clip row · CampaignCard hot-banner | Achievement marker |
| **Nav badges** | (deprecate · duplicative with `/brand/icons/nav/*.svg` set already in ConsoleNav) | OR · replace SVG set with nav-badges PNGs for premium-feel rail · pick one and orphan the other |
| **Atmospheres** | (deprecate · duplicative with the 8 world WebPs · the world layer IS the atmosphere) | The PNGs were for the legacy shell that the design-OS replaces |

### Q4 · Are any bugs / enemies hidden, clipped, behind frames?

**NO.** They are not rendered at ALL. Zero `<img src>` or `background-image` references. Not a CSS bug — an unwired asset. The previous P1-2B-b nav-hover patch (`position: fixed` on `.lc-nav-tip`) does NOT affect these.

### Q5 · Any assets present but visually broken (z-index, opacity, positioning, wrong path)?

**NO broken paths.** Every hardcoded `/brand/...` URL in the source tree maps to a file on disk (confirmed by P1-2B-a). No `<img>` returns a 404. The "broken" issue is exclusively un-wired-ness — files exist but no code references them.

The few grep-hit names (aurora, spotlight, vignette, hologram) match copy strings or CSS class names, not asset loads. These are noise, not actual usage.

### Q6 · Routes using generic placeholders where a generated game asset should be?

| Route / surface | Today | Should be |
|---|---|---|
| LoginOnboarding "Activating…" | CSS `<div className="lc-login-spinner">` | `kade-eye-loader.json` Lottie |
| Settings "Refresh account status…" | text-only button label flip | `kade-eye-loader.json` mini variant |
| Step 1 reward validation | text + `validating…` flag | `loader-whop-handoff.json` |
| WhopRewardCard refresh | `↻` spinning glyph | `loader-whop-handoff.json` |
| Channels "Syncing…" | text only | `loader-ayrshare-handoff.json` |
| Schedule "Syncing the lanes" | text only | `loader-ayrshare-handoff.json` |
| Campaigns discovery loading | text "Loading…" | `loader-campaign-sync.json` |
| ClippingEngine progress | text + CSS spinner | `ring-clip-process.svg` + `loader-campaign-sync` |
| Export queue progress | text + CSS spinner | `ring-export.svg` |
| AchievementToast unlock | toast + badge png | + `confetti.json` overlay |
| Earn first-viral / hot row | text only | + `viral-spark.json` + `marker-viral.svg` |
| Earn headline | DSEG7 number only | + `coin-orbit.json` ambient |
| Engine error vignettes | generic error UI | + bug WebPs + `bug-shatter.json` + `fragment-shards.png` |
| StopPages (SimPage placeholder · not in P1 scope) | SimPage chrome | + bug visuals · world-story consistency |

### Q7 · Should any be promoted from "parking-lot polish" to required visual identity?

**YES · 4 categories ·**

1. **Loaders** (4 Lotties + 4 SVGs) · **PROMOTE TO REQUIRED.** These are the integration-handshake moments. Beta users today see "Loading…" plain text in 8 distinct spots where these branded loaders were generated. The cost (8 wirings) is low; the perceived-quality lift is significant.

2. **Confetti / viral-spark / coin-orbit Lotties** · **PROMOTE TO RECOMMENDED.** Closes the celebration loop on the 3 highest-emotion moments (achievement unlock, viral milestone, payout). Cost is low (3 Lottie mounts wrapped in `<LottiePlayer />` or equivalent).

3. **Bug / repair-drone WebPs + bug-shatter Lottie** · **PROMOTE TO RECOMMENDED for Engine error states + StopPages when it gets built.** Bug-as-villain is a brand-coherent error vocabulary. Currently every error surface uses generic UI.

4. **FX lighting (aurora, beams, rim-streak, spotlight)** · **KEEP AS POLISH** until WorldLayer is touched. They'd enhance the existing atmosphere but don't unlock new states.

**KEEP UNUSED ·**

- Nav badges (duplicative with the existing nav-icon SVG set in design-OS · pick one and deprecate the other in a small explicit phase)
- Atmospheres (duplicative with the world WebPs · the design-OS replaced atmosphere PNGs with full-bleed world backdrops)

---

## 3 · Recommended P1-2B closing posture

Per Daniel's directive: **NO wiring inside P1-2B.** This audit re-classifies the asset families; it does NOT change the patch surface.

P1-2B as currently scoped:
- ✅ P1-2B-a · audit complete
- ✅ P1-2B-b · nav-hover Tier A fix shipped
- ⏸ P1-2B-c-i · LoginOnboarding world wrap · awaiting authorization
- ⏸ P1-2B-d · placeholder honesty sweep · no work identified

**One LIGHT optional addition flagged for P1-2B-c-i:** if Daniel wants, the LoginOnboarding world wrap can additionally swap the CSS `.lc-login-spinner` for a `kade-eye-loader.json` Lottie during the `"activating"` state. That's a 1-component, 1-asset wiring · same patch turn · zero scope creep. Skip if Daniel prefers strict P1-2B-c-i = world wrap only.

**Recommended follow-up phase ·** "P2-1 · World-feel completion pass" or similar. Scoped to:
- 8 loader wirings (highest leverage)
- 3 Lottie celebrations (confetti / viral-spark / coin-orbit)
- Bug + repair-drone vocabulary for error states
- Optional FX lighting overlays in WorldLayer

Effort estimate: ~2 days end-to-end. Significant perceived-quality lift.

---

## 4 · Honest gaps

- The `LottieRefactor / @lottiefiles/react-lottie-player` (or similar) package is **not currently a dep** in `desktop-2/package.json`. Wiring Lotties means adding a player dep · small, but worth flagging before P2-1 starts.
- The Engine-state coverage assumes pipelines emit progress events the loaders can react to. Need verification on the sidecar contract before P2-1 lands.
- World-layer FX overlays (aurora, beams) would change the visual identity of every route · should be reviewed against the missing `phase4a-proof.html` standard once Daniel surfaces it.
- StopPages wiring of bugs/repair-drone needs StopPages to leave SimPage scope (a Phase 2 item per `beta-readiness-audit-2026-06-19.md`).
- The legacy shell's nav-badges + atmospheres consumers are technically still loading these files (when the design-OS isn't active). Verified: they ARE in `brandAssets.ts` and consumed by `shell/SideNav.tsx` + `shell/TopBar.tsx`. The legacy shell is occluded by CSS but the assets are still in the bundle · NO change recommended in P1-2B.

---

## 5 · TL;DR

- 8 bug WebPs + 6 fx-lighting SVGs + 10 fx-particle Lotties + 8 loader assets + 9 nav-badges + 5 atmospheres = **~50 generated assets are shipped but invisible** in the active design-OS surface.
- NONE of them is broken by CSS / z-index / clipping · they are simply **un-wired in source**.
- Highest-leverage gap: **8 loaders** that replace plain "Loading…" text at every Whop / Ayrshare / campaign / clip handshake.
- Next: **3 celebration Lotties** (confetti / viral-spark / coin-orbit) on achievement / viral / payout moments.
- Then: **bugs + repair-drone** vocabulary for error states (paired with `bug-shatter` Lottie).
- P1-2B should NOT wire any of these · they belong to a follow-up "P2-1 · World-feel completion pass."
- One small optional inclusion in P1-2B-c-i if Daniel wants it · swap LoginOnboarding's CSS spinner for `kade-eye-loader.json` during `"activating"`. Zero-scope-creep addition; skip if not authorized.

---

*Audit complete · no code · no assets generated · awaiting Daniel direction on P1-2B-c-i scope and on whether to plan P2-1 follow-up.*
