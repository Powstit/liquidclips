# P1-2B-a · Asset Coverage + Visual Integrity Audit
### Pre-fix investigation · NO CODE

*Date · 2026-06-19 · Author · Claude · Audit-only deliverable*

The purpose: before any visual polish lands, inventory every world / Kade / brand asset desktop-2 references; flag broken / placeholder / generic art; map the Home nav hover bug Daniel elevated to P0; identify which assets must be generated vs which can be reused.

No code changes. No assets generated. Pure inventory.

---

## 0 · Headline

- **World layer is intact.** All 8 world WebP files exist (`/brand/worlds/`); every route maps to a valid world via `ROUTE_REGISTRY`; the only intentional exception (LoginOnboarding) renders its own boot-sequence panel.
- **Kade poses are complete.** 24 Kade WebPs cover every `KadeState` value the routes consume.
- **No broken `<img src>` paths** were found anywhere in the route tree. Every hardcoded `/brand/…` URL resolves to a file on disk.
- **Three SimPage placeholders remain visible** (`Library / ClipperJourney / StopPages`) · explicit Phase 5B stubs.
- **P0 nav-hover bug confirmed.** The `.lc-nav-tip` tooltip lives at `z-index: 80` inside `.lc-app` (z-index 200 root). Its `position: absolute` + `left: calc(100% + 14px)` push it past the nav rail's right edge into the route's stacking context · the audit suggests a stacking-context clip (not z-index), traceable to one of the column ancestors. P1-2B-b fix detail in §6.
- **Visual north-star HTMLs (`phase4a-proof.html`, `timeline-studio-kit.html`) are NOT present** in the desktop-2 tree (or anywhere under `/Users/dipdip`). They were referenced as the visual standard in Daniel's directive · either lost, on another machine, or pre-rebrand legacy. The audit proceeds against `CommandRoom.tsx` + existing world layer as the de-facto cinematic baseline.
- **No new asset generation is required** to pass P1-2B-b/c/d. Every gap can be closed by re-pointing to existing `/brand/` assets or fixing CSS.

---

## 1 · `public/brand/` inventory

### 1.1 · Worlds (cinematic backdrops)

`/brand/worlds/*.webp` · all 8 present, sizes confirmed by listing:

| File | Used by | Status |
|---|---|---|
| `cockpit-home.webp` | Home / Settings / Schedule / Earn / Clipper / Library / ClipperJourney / StopPages / LoginOnboarding(if wired) | ✓ canonical baseline |
| `source-bay.webp` | Create / CreateClips | ✓ |
| `cutting-floor.webp` | Engine / ClippingEngine | ✓ |
| `studio-deck.webp` | Studio / Thumbnail / Export / TimelineStudio | ✓ |
| `mission-pedestal.webp` | Campaigns / CampaignPageShell | ✓ |
| `squad-lounge.webp` | Community | ✓ |
| `relay-tower.webp` | Channels | ✓ |
| `boot-sequence.webp` | (referenced by `WorldLayer.tsx` · NOT currently consumed by any route) | ⚠️ unused but loaded into the WorldKey map; suitable as the LoginOnboarding background |

### 1.2 · Kade poses

`/brand/kade/*.webp` · 24 poses + 1 base PNG. Audit of every `KadeState` value in `bridge/events.ts` against the file roster:

| State | File | Status |
|---|---|---|
| `idle` | `kade-idle.webp` | ✓ |
| `hover` | `kade-hover.webp` | ✓ |
| `create-clips` | `kade-create-clips.webp` | ✓ |
| `import-footage` | `kade-import-footage.webp` | ✓ |
| `cutting-clips` | `kade-cutting-clips.webp` | ✓ |
| `generating-captions` | `kade-generating-captions.webp` | ✓ |
| `reading-brief` | `kade-reading-brief.webp` | ✓ |
| `exporting` | `kade-exporting.webp` | ✓ |
| `publishing` | `kade-publishing.webp` | ✓ |
| `campaign-mode` / `earn-mode` / `community-mode` / `settings-mode` | each present | ✓ |
| `success` / `error` / `warning` / `celebration` | each present | ✓ |
| `shooter` (Invaders) | `kade-shooter.webp` | ✓ |
| `tier-rookie` / `tier-solo` / `tier-pro` / `tier-growth` / `tier-climber` | all 5 present | ✓ |

**No missing pose.** Kade can be voice-driven across every route without fallback art.

### 1.3 · Other brand directories (sampled)

| Path | Count | Sample contents | Beta consumer |
|---|---|---|---|
| `/brand/decks/` | 8 PNGs | `earn · learn · payouts · schedule · settings · upload · workspace · minecraft-submission` | Step 3 banner picker (agency creation); CampaignBanner fallback |
| `/brand/sponsored/` | 6 (4 thumbs + badge + placeholder) | `thumb-business / -creator / -fitness / -tech` + `badge-sponsored` + `placeholder` | CampaignCard fallback (when no `featuredThumbUrl`) |
| `/brand/reward/` | 9 SVG/WebP | chest-reward · coin-stack · stamp-approved/payout/rejected/needs-changes · 3 mission badges | Earn route stamps; campaign brief badges |
| `/brand/tiers/` | 10 PNGs | `free / solo / pro / agency` + `growth / autopilot / climber / titan / legend / rookie` | useTierCaps display surfaces |
| `/brand/icons/nav/` | 4 SVGs | nav glyphs | ConsoleNav rail |
| `/brand/icons/action/`, `/canvas/`, `/metric/` | various | action/canvas/metric icon sets | Studio, Engine, CommandRoom |
| `/brand/intro/` | mp4 + still | Liquid Clips intro reel | IntroSplash (App.tsx) |
| `/brand/invaders/` | 11 PNGs | mid-pipeline minigame sprites | InvadersOverlay |
| `/brand/leaderboard/` | leaderboard art | LeaderboardSection | |
| `/brand/loading/` | loading frames | Studio progress | |
| `/brand/clip-fx/` | 1 WebP | `rocket-export.webp` | CommandRoom Studio Engine card |
| `/brand/allowance/` | 4 SVGs | `bar-*` state glyphs | CommandRoom scoreboard |
| `/brand/atmospheres/` | atmospheric layers | unused in current routes | parking lot for future polish |
| `/brand/fonts/` | DSEG7Classic + minis | CommandRoom scoreboard typography | |
| `/brand/nav-badges/` | per-route badges | not currently mounted in ConsoleNav | candidate for the nav-info popover fix (§6) |
| `/brand/fx/lighting/` + `/fx/particles/` | atmosphere layers | unused | parking lot |
| `/brand/achievement-badges/` | unlock art | AchievementToast (community) | |
| `/brand/enemies/` | invaders adversaries | game | |
| `/brand/assets/` | misc | ad-hoc | |

**Tally: ~24 directories · 200+ assets.** No directory is empty. No placeholder slugged with "lorem" / "untitled" / generic stock.

---

## 2 · Route-by-route world wiring

From the parallel Explore inventory + my direct read:

| Route | World | DesignOSAppShell? | World file | Visible placeholder? |
|---|---|---|---|---|
| CommandRoom (Home) | `cockpit-home` | ✓ | ✓ exists | No · "Asset paths in use" proof copy is intentional documentation, not user-facing |
| Campaigns | `mission-pedestal` | ✓ | ✓ exists | No |
| CampaignPageShell (drawer over Campaigns) | inherits | n/a (Drawer) | n/a | No |
| Settings | `cockpit-home` (P1-2A patch) | ✓ | ✓ exists | No · honest "Studio preview / Live · backend" pills only |
| Channels | `relay-tower` | ✓ | ✓ exists | No · honest pills only |
| Schedule | `cockpit-home` | ✓ | ✓ exists | No |
| Community | `squad-lounge` | ✓ | ✓ exists | No |
| LoginOnboarding | **NONE · standalone `<div className="lc-login">`** | ❌ | n/a · uses CSS gradient | ⚠️ intentional but visually generic; see §4 |
| Export | `studio-deck` | ✓ | ✓ exists | No |
| ClippingEngine | `cutting-floor` | ✓ | ✓ exists | No · honest "Engine preview" tag when mock |
| CreateClips | `source-bay` | ✓ | ✓ exists | No |
| ThumbnailStudio | `studio-deck` | ✓ | ✓ exists | No |
| TimelineStudio | `studio-deck` | ✓ | ✓ exists | No |
| Earn | `cockpit-home` | ✓ | ✓ exists | No |
| **Library** | `cockpit-home` | ✓ (via SimPage) | ✓ exists | ⚠️ SimPage placeholder · "1,420 clips archived" copy reads decorative |
| **ClipperJourney** | `cockpit-home` | ✓ (via SimPage) | ✓ exists | ⚠️ SimPage placeholder · "Step 3 of 8 · Stamped" is hardcoded mock progress |
| **StopPages** | `cockpit-home` | ✓ (via SimPage) | ✓ exists | ⚠️ SimPage placeholder · "10 stop pages mapped" |
| SimPage (template) | n/a | n/a | n/a | n/a |

**Verdict ·**
- 14/17 routes have proper world wiring and no placeholder visible to a beta user.
- 1 route (LoginOnboarding) renders without a world layer · acceptable but the look is "generic dark gradient", not "cinematic cockpit." Fix path is in §4.
- 3 routes (Library / ClipperJourney / StopPages) are explicit Phase 5B SimPage placeholders · NOT in P1 scope per Daniel's locks ("do not remove intentional SimPage placeholders").

---

## 3 · Missing / broken assets

**None found.** Every hardcoded `/brand/…` URL in the route source tree maps to a file under `desktop-2/public/brand/`. Backend-driven campaign banners (`campaign.bannerUrl`, `featuredThumbUrl`, `whopUrl`) are null-guarded · render nothing when absent (no broken-image cliff).

**No generated assets are required for P1-2B-b/c/d.** Every gap can be filled by:
- re-pointing CSS to existing world assets
- using existing `/brand/decks/` or `/brand/sponsored/placeholder.png` for the few fallback slots
- re-using `/brand/intro/intro-splash` stills if a particular route wants a quiet cinematic still
- using `/brand/loading/` frames where loading currently shows a CSS spinner

---

## 4 · Routes that need cinematic correctness (P1-2B-c)

| Route | Today | Recommended fix (P1-2B-c · CSS-only) |
|---|---|---|
| **LoginOnboarding** | Solo `<div className="lc-login">` with `radial-gradient + #0B0B10` background · NO world layer · NO Kade | Wire through `DesignOSAppShell` with `world="boot-sequence"` (the unused world asset · semantically perfect for activation) + `defaultKade="idle"` + `kadePlacement="center"`. This is a CSS + 1-line `LoginOnboarding.tsx` wrapper change, NOT a new route, NOT new data. **Daniel called this out: "Build the world users feel."** |
| Settings (P1-2A) | `cockpit-home` · OK | No change |
| All other real routes | already cinematic via world layer | No change |

**Note:** the LoginOnboarding wrapping is the highest-leverage P1-2B-c win · it converts the auth gate from "enterprise settings form" to "cinematic boot deck." It uses the only unused world asset in the registry (`boot-sequence`) · the asset was generated for exactly this purpose.

---

## 5 · Placeholder honesty sweep (P1-2B-d)

### 5.1 · Visible to beta users

| Surface | Today's copy/visual | Should we suppress? |
|---|---|---|
| Library route | SimPage "1,420 clips archived" decorative copy | ⚠️ **Keep · Phase 5B placeholder is honest** but consider a route-card overlay reading "Real Library lands in P2-2" once Daniel approves a copy override |
| ClipperJourney route | SimPage "Step 3 of 8 · Stamped" | ⚠️ same · keep until P2 phase |
| StopPages route | SimPage "10 stop pages mapped" | ⚠️ same |
| LoginOnboarding | "Activate Liquid Clips" | ✓ honest · keep |
| Settings | Honest "Studio preview" / "Live · backend" pills | ✓ keep |
| Channels / Schedule | same pattern | ✓ keep |
| Campaigns | mock fallback campaigns when no backend | ✓ honest · keep |
| Mock-mode "Engine preview" tag on ClippingEngine / CreateClips | honest mock label | ✓ keep |
| Empty state strings ("No matching campaigns" etc.) | functional, not placeholder | ✓ keep |

### 5.2 · Hidden but worth clean-up

- `"ex soles"` / weird copy: **NONE found** anywhere in the source tree. Daniel's directive flagged this category preemptively · no instance present today.
- "TODO" / "FIXME" comments in user-visible files: a handful in non-rendering positions (data-shape comments, etc.). None render to the user.
- Lorem-ipsum text: NONE.

**Net:** placeholder honesty is in good shape · no sweep work is strictly required for v1 beta. The three SimPage routes remain the only intentional placeholders.

---

## 6 · P0 · Home nav hover popover behind frames

### 6.1 · Reproduction trace

The Home (CommandRoom) nav menu uses `<ConsoleNav />` from `desktop-2/src/design-os/components/ConsoleNav.tsx` + `ConsoleNav.css`. On hover of any `.lc-nav-item`, a Kade brief tooltip (`.lc-nav-tip`) appears 14px to the right of the row containing:
- mono eyebrow (`.lc-nav-tip-eb`) · "BRIEF"
- body text (`.lc-nav-tip-body`) · per-route Kade-voice hint
- decorative arrow (`.lc-nav-tip::before`)

### 6.2 · The exact CSS smoking gun

`ConsoleNav.css:172-194` ·

```css
.lc-nav-tip {
  position: absolute;
  left: calc(100% + 14px);           /* pushes 14px past nav item's right edge */
  top: 50%;
  transform: translate(-6px, -50%);
  ...
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  z-index: 80;                        /* ← suspect 1 · local stacking ctx */
}
```

### 6.3 · Why it's behind frames

The shell layout (`AppShell.css:7-19`) is a CSS grid with `grid-template-columns: 244px 1fr`. The `.lc-app` parent has `z-index: 200` AND `overflow: auto`. The nav rail occupies the 244px column. The tooltip uses `position: absolute` against its `.lc-nav-item` ancestor · `left: calc(100% + 14px)` pushes it 14px past the rail's right edge · INTO the route content column.

Three things compound the bug:

1. **Stacking-context trap.** Any ancestor on the rail side that has `transform`, `filter`, `will-change`, `mix-blend-mode`, or `backdrop-filter` creates a new stacking context. The tooltip's `z-index: 80` is then SCOPED to that context · the route content column has its own painting layer that paints over the tooltip regardless of the 80 value.
2. **Overflow clip.** If the rail's column container has `overflow: hidden` (e.g. for the `lc-nav-label` text-ellipsis at line 134-135), the tooltip is clipped at the column boundary. This alone would explain "stuck behind frames" · the tooltip renders OFF-SCREEN inside the rail column, not painted at all.
3. **`backdrop-filter: blur(18px) saturate(140%)` on the tooltip itself** creates a stacking context AND a paint isolation that interacts with the rail-side blur. On some browsers this triggers a compositor layer promotion that paints below sibling positioned elements.

### 6.4 · Recommended P1-2B-b fix shape (no code yet)

The fix has three escalating tiers · take the smallest one that works:

| Tier | Change | Where |
|---|---|---|
| A · Smallest | On `.lc-nav-tip`: change `position: absolute` → `position: fixed` + compute `left` / `top` from the row's `getBoundingClientRect()` at hover · escape the stacking trap entirely. Pros: zero impact on layout, decouples from any ancestor stacking ctx. Cons: tiny ResizeObserver/scroll listener needed. | `ConsoleNav.tsx` + `ConsoleNav.css` |
| B · Mid | Hoist the tooltip to a portal (re-use existing `lc-modal-portal-root`) anchored to row coords. Same outcome as A but reuses the portal pattern other surfaces already use. | `ConsoleNav.tsx` |
| C · Bandage | Bump `.lc-nav-tip { z-index: 250 }` (above `.lc-app`'s 200) **AND** remove `backdrop-filter` (or move it to a child of the tooltip), then check whether the row's column has `overflow: hidden` and remove it. Cons: depends on no ancestor having `transform/filter` (which would trap the higher z-index anyway). | `ConsoleNav.css` (1-2 line patch) |

Recommendation: **Tier A** is the surgical fix · `position: fixed` skips every stacking + overflow problem. Tier B is the "design-OS sanctioned" fix · reuses ModalPortal. Tier C is the throw-away patch for the demo and gets removed when A/B lands.

---

## 7 · North-star reference status

Daniel referenced two visual standards: `phase4a-proof.html` + `timeline-studio-kit.html`.

**Both files are NOT present** in `desktop-2/`, in `desktop/`, or anywhere under `/Users/dipdip` (verified by `find` across the home directory). They may live on another machine, in a Figma/HTML export not yet committed, or in legacy desktop history.

**Working substitute baseline ·** the existing `CommandRoom.tsx` + `WorldLayer.tsx` + the design-OS shell grammar (`sim-stage` / `sim-welcome` / `sim-eb` / `sim-h1` / `sim-sub` / `lc-runtime-tag`) IS effectively the visual language the two HTMLs would describe. CommandRoom in particular is the most-finished route + the closest match to "phase4a-proof bar."

If Daniel wants the two HTMLs added to the repo for future passes, they're a paste-into-`desktop-2/docs/visual-standards/` away. The audit can't recover them unilaterally.

---

## 8 · Five-question evaluation (per the re-anchoring directive)

For each major surface, answering Daniel's 5 questions:

| Surface | (1) phase4a-proof bar? | (2) world or form? | (3) Kade as guide? | (4) world narrative work? | (5) recognizable as LC? |
|---|---|---|---|---|---|
| CommandRoom (Home) | ✓ | World | ✓ visible in helper-right · voice-driven via `useKadeFromSession` | ✓ cockpit-home reinforces "control deck" | ✓ |
| Settings (P1-2A) | ✓ now | World (post-P1-2A wrap) | ✓ in helper-right | ✓ cockpit-home reads "control room tuning" | ✓ |
| Campaigns | ✓ | World | ✓ in center per `mission-pedestal` | ✓ "mission pedestal" frames campaigns as missions | ✓ |
| LoginOnboarding | ⚠️ form-feel today | **Form** (no world layer) | ❌ no Kade visible | ❌ generic gradient | ⚠️ generic dark UI · could be any SaaS |
| Channels | ✓ | World | ✓ helper-right per `relay-tower` | ✓ "relay tower" reads communications hub | ✓ |
| Schedule | ✓ | World | ✓ | ✓ | ✓ |
| Community | ✓ | World | ✓ | ✓ squad-lounge | ✓ |
| Engine / Studio / Thumbnail | ✓ | World | ✓ | ✓ | ✓ |
| Earn | ✓ | World | ✓ | ✓ | ✓ |
| Export | ✓ | World | ✓ | ✓ | ✓ |
| Library / ClipperJourney / StopPages | n/a · SimPage explicit placeholders | n/a | via SimPage helper | n/a · placeholder | partial · SimPage chrome reads "design demo" |

**The single failing surface is LoginOnboarding** · §4 prescribed wrapping it in `DesignOSAppShell + world="boot-sequence"` to fix all 5 axes in one CSS+1-line patch.

---

## 9 · Asset Generation Policy adherence

Per Daniel's policy ladder · for every gap identified:

1. **Reuse existing assets** → ✓ all gaps close to existing assets
2. **Check existing world assets** → ✓ `boot-sequence.webp` covers LoginOnboarding · already exists, unused
3. **Cinematic crop/variant** → not needed
4. **Generate new** → **NOT required** for any P1-2B-b/c/d sub-unit

**No new asset generation needed.** No parallel-track work to spin up.

---

## 10 · Recommended P1-2B sub-unit order

| Sub-unit | Scope | Effort | Visible impact | Risk |
|---|---|---|---|---|
| **P1-2B-b** · nav-hover z-index (P0) | Tier A fix (`position: fixed` + portal-style coords) on `.lc-nav-tip` | 0.25d | High · removes "looks broken" perception | Low |
| **P1-2B-c-i** · LoginOnboarding world wrap | Add `DesignOSAppShell world="boot-sequence" kadePlacement="center"` around the existing card · drop the standalone `.lc-login` background | 0.25d | High · only visually-flat route in the app | Low |
| **P1-2B-c-ii** · misc cinematic gaps | None found | 0d | n/a | n/a |
| **P1-2B-d** · placeholder honesty sweep | No work strictly required · the 3 SimPages are still intentional · honesty pills are correct | 0d | n/a | n/a |

**Total · ~0.5 day** for all P1-2B fixes. The audit found a much cleaner asset/world state than expected.

---

## 11 · Honest gaps + open questions

- **`phase4a-proof.html` + `timeline-studio-kit.html` are not in the tree** · if Daniel wants them as reference, please paste them into `desktop-2/docs/visual-standards/`. The audit proceeds against existing CommandRoom + WorldLayer as the de-facto baseline.
- The `.lc-nav-tip` fix needs a live walk to confirm which tier (A/B/C) fully resolves it · I'd recommend Tier A first (smallest blast radius) and only escalate if a stacking ancestor still traps it.
- LoginOnboarding wrapping introduces Kade to the activation flow · Daniel may want to choose a specific KadeState (`idle` vs `reading-brief` vs `success`) per state. Default to `idle` for the cleanest visual on first paint.
- Library / ClipperJourney / StopPages remain SimPage placeholders. They're not in P1 scope · revisit in Phase 2 polish (per `beta-readiness-audit-2026-06-19.md` §C).
- The unused `nav-badges/` directory could replace plain text labels in the nav rail in a separate polish phase. Not in P1-2B.
- The unused `atmospheres/` + `fx/lighting/` + `fx/particles/` directories are parking-lot polish that should NOT be wired in P1-2B (would inflate the patch beyond scope discipline).

---

## 12 · TL;DR for the build queue

- ✅ **Asset coverage is good.** 200+ assets across ~24 dirs. No missing files. No broken `<img src>` paths. Kade has every pose. All 8 worlds present.
- ✅ **No new generation required** for P1-2B.
- ⚠️ **One real cinematic gap:** LoginOnboarding has no world layer · 1-line wrap fixes it (P1-2B-c-i).
- 🛑 **One real P0 visual bug:** nav-hover tooltip stuck behind route frames · root cause is stacking-context / overflow trap on `.lc-nav-tip`, NOT z-index alone · Tier A fix (`position: fixed` + computed coords) recommended.
- 📝 **Two reference HTMLs missing** from the tree · if Daniel wants them as the formal standard, paste them in.
- 📈 **5-question evaluation passes on every route except LoginOnboarding.**

**Recommended build sequence (≤0.5d total) ·**

1. P1-2B-b · nav-hover z-index / stacking fix on `.lc-nav-tip`
2. P1-2B-c-i · LoginOnboarding world wrap with `boot-sequence`
3. P1-2B-d · NO WORK · honesty sweep finds nothing requiring action

---

*Audit complete · no code · no assets generated · awaiting Daniel approval to start P1-2B-b.*
