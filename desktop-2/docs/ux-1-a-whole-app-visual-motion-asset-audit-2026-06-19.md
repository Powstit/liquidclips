# UX-1-a · Whole-app visual / motion / asset / lighting audit · 2026-06-19

**Audit only · zero code change · no fixes proposed inline · all
findings funnelled into the table at §5.**

**Capture method ·** vite dev server at `http://localhost:1420` ·
puppeteer-core driving `Google Chrome` headless · 1440×900 @ 2× DPR ·
17 routes + 2 variants captured · 3000ms post-nav hold for cinematic
worlds to settle. Source script · `desktop-2/scripts/ux-1-a-capture.mjs`.
Screenshots · `desktop-2/docs/ux-1-a-screenshots/`.

**Reference contract ·** `PHASE_1_CRITICAL_PATH.md` is the authoritative
status doc · this audit references it but does NOT reopen any closed
sub-unit · all findings are recorded against PHASE 2 (`P2-1` / world-feel
polish, per the `visual-debt-log-2026-06-19.md`).

---

## 1 · Executive summary

| Headline | Severity |
|---|---|
| **Dual-shell bifurcation** · the app silently renders one of TWO shells depending on whether a route slug matches the legacy hash registry. Routes with a legacy match (`create`, `channels`, `schedule`, `community`, `earn`, `clipper`, **`settings`**) render the LEGACY shell · all other routes (`engine`, `studio`, `thumbnail`, `export`, `library`, `campaigns`, `stop-pages`) render the DESIGN-OS shell. Visible nav widget, typography, mascot presence, lighting, and palette all flip between the two. | **P0** |
| **Settings → wrong shell.** P1-2/P1-3 built the 9-section Design-OS Settings, but `#/settings` matches the legacy sectionRegistry first, so the user lands on the legacy `SettingsSection` (`Account/Billing · API Keys · Integrations · Privacy · Diagnostics · HQ Bridge/Deep Links · About`). The work shipped in P1-3 is unreachable from the standard nav. | **P0** |
| **LoginOnboarding** · at 3 s post-nav, no sign-in CTA visible · just the boot-sequence world stage (Kade kid character + neon cage). Either the panel arrives later (timing-debt) or the panel is suppressed on first paint. | **P1** |
| Strong cinematic feel where Design-OS shell DOES render · Home / Engine / Studio / Thumbnail / Export / Library / Campaigns / StopPages all show brand-aligned cockpit lighting, Kade mascot, big display type, console-nav with `liquid/clips` wordmark. | (positive) |
| Legacy shell routes (`Create / Channels / Schedule / Community / Earn / Clipper / Settings`) carry pixel-arcade nav icons, a different typography rhythm, and the cinematic environment is reduced to a thin neon scrim. These pages look from a previous design vintage. | **P0** (because they are reached via the legacy SectionRegistry, see row 1) |
| **Campaign-detail drawer + Agency-creation drawer NOT capturable** with the seed JWT · both surfaces gate on `useMe()` returning a real tier (correct per P1-1G), but means we have no rendered evidence yet for those two screens. Capture needs a real `/me` response or a fixture-override flag. | **P2** (audit-coverage gap, not a bug) |
| Tier pills, KPI cards, mission cards, leaderboard pills · all render with brand fidelity in the Design-OS routes. | (positive) |
| No broken images observed · no unresolved asset paths in any captured frame. | (positive) |

---

## 2 · Architecture context (why two shells coexist)

`src/App.tsx` mounts `<AppShell />` from `src/shell/AppShell.tsx` ·
the **legacy** shell. The legacy shell uses `useHashRoute()` to map
the URL hash to one of the entries in `src/shell/sectionRegistry.ts`.
Each entry has a `component` — for example, `SECTION_CREATE` maps to
`sections/create/CreateSection`.

`SECTION_HOME` maps to `HomeSection`, which renders
`<SimulatorRouter />` from `src/design-os/routing/SimulatorRouter.tsx`.
`SimulatorRouter` then renders the Design-OS routes
(`routes/CommandRoom.tsx`, `routes/CreateClips.tsx`, etc.).

**This means a route only renders through the Design-OS shell if it
does NOT match a legacy section slug.** Currently:

| Hash | Legacy match? | What user sees |
|---|---|---|
| `#/home` | yes → `HomeSection` → `SimulatorRouter` → `CommandRoom` | Design-OS ✅ |
| `#/create` | yes → `CreateSection` | LEGACY |
| `#/engine` | no (legacy uses `editor`) | Design-OS ✅ |
| `#/studio` | no | Design-OS ✅ |
| `#/thumbnail` | no | Design-OS ✅ |
| `#/export` | no | Design-OS ✅ |
| `#/channels` | yes → `ChannelsSection` | LEGACY |
| `#/schedule` | yes → `ScheduleSection` | LEGACY |
| `#/community` | yes → `CommunitySection` | LEGACY |
| `#/earn` | yes → `EarnSection` | LEGACY |
| `#/library` | no (legacy uses `projects`) | Design-OS ✅ |
| `#/clipper` | yes → `ClipperSection` | LEGACY |
| `#/campaigns` | no (legacy uses `campaign`) | Design-OS ✅ |
| `#/settings` | yes → `SettingsSection` | LEGACY ❌ |
| `#/stop-pages` | no | Design-OS ✅ |
| `#/login` | n/a (AuthGate intercepts before hash routing) | Design-OS ✅ |

The user has no way to discover this · the two shells share enough
chrome (left rail, top bar) to look like one app, but the contents,
typography rhythm, and brand voice diverge. The legacy shell pre-dates
the P1-2/P1-3 Settings rebuild, the P1-1G-c agency gate, and the
brand-aligned cockpit lighting.

---

## 3 · Cross-cutting findings (apply to whole app)

| # | Finding | Severity | Notes |
|---|---|---|---|
| C-1 | Two shells render side-by-side without any breadcrumb that the user has crossed a vintage boundary. | **P0** | Architectural · root cause for most of §5's P0 rows |
| C-2 | Settings (Design-OS, P1-3) is not navigable via the standard nav. The user reaches the legacy version. | **P0** | Specifically: clicking Settings in either shell ends in the legacy SettingsSection. The P1-3-a/b/c work doesn't surface. |
| C-3 | Two nav-icon vocabularies in play · Design-OS uses minimal stroke icons; legacy uses pink pixel-art invader sprites. The legacy sprites are off-brand for the cinematic worlds. | **P1** | Visible in Create / Channels / Schedule / Community / Earn / Clipper / Settings screenshots. |
| C-4 | Kade mascot present in Design-OS routes (Home / Engine / Studio / Thumbnail / Export / Library / Campaigns) · ABSENT in legacy routes (Create / Channels / Schedule / Community / Earn / Clipper / Settings). | **P1** | Consistency · either Kade lives on every surface or his absence is a meaningful state cue, but right now his presence is shell-dependent, not intent-dependent. |
| C-5 | Cinematic world lighting (volumetric haze, neon scan-line, depth glow) renders in Design-OS routes but is reduced to a thin top-right neon scrim in legacy routes. | **P1** | Legacy shell uses `atmosphereFor()` from `brand/brandAssets` with per-route opacity (0.10-0.20) · much subtler than Design-OS's `WorldLayer`. |
| C-6 | TopHud KPI pills (Home: clippers online, clips generated, campaigns live, reset-in) are a strong cinematic primitive but only render on Home + a few Design-OS routes. Legacy routes show a different hud row. | **P2** | Differentiation may be intentional · but reads as inconsistency now. |
| C-7 | Sign-in / activation states are not yet visible in any screenshot at the 3 s hold · the LoginOnboarding boot-sequence world plays out unhurried. | **P1** | Timing-debt · users on cold boot may stare at the kid character for ~6 s before sign-in surfaces. |
| C-8 | No motion-broken or animation-stuck states observed in any screenshot · transitions appear to be working when they fire. | (positive) | Caveat · cinematic motion is captured at a frozen 1440×900@2× snapshot, so jank that's only visible during interaction (60 → 30 fps drop on Kade idle) cannot be assessed from PNGs. |
| C-9 | No missing image / 404 / broken asset path observed in any captured frame. | (positive) | All Kade poses, world backgrounds, side-nav icons (both vocabularies), neon scrims, and KPI illustrations resolved. |
| C-10 | "DESKTOP-2 SIMULATOR" footer marker visible on every legacy-shell route (bottom-right). The marker is dev-only but currently shipping. | **P1** | If desktop-2 ships as 0.8.0-beta, this marker either needs to read "BETA" or be removed pre-publish. |

---

## 4 · Overlays · modals · drawers · empty/loading/error states

| Surface | Captured? | Notes |
|---|---|---|
| `IntroSplash` (boot cinematic) | ✅ `00-intro.png`, `21-intro-early.png` | Strong · kid hero in neon cage at 800 ms · expands to full cinematic stage at 3.5 s. "SKIP INTRO" is in top-right (small, dim). |
| `InvadersOverlay` | not visible | Likely gated by user interaction · no auto-fire observed. |
| `BrowseOverlay` / `BrowserScrim` | not visible | Same · gated on `browser` store. |
| `LoginOnboarding` (P1-1E surface) | ✅ `00-login.png` | At 3 s post-nav · only the boot-sequence world hero renders · no sign-in CTA in viewport. P1 timing-debt OR the panel is below the fold OR the screenshot caught a transition frame. Manual interaction needed to verify. |
| `Campaigns → Agency Creation Flow` (8-step drawer) | ❌ not captured | Floating CREATE CTA tier-gated by `canUseAgencyActions({tier, source})` (P1-1G-c) · fake JWT does not pass · so the drawer's open state cannot be triggered headless. Needs real `/me` response or a debug fixture. |
| `Campaigns → CampaignPage` drawer | ❌ not captured | No campaign card selector matched (`.lc-campaign-card`, `[data-campaign-card]`, etc.) · either the class is different or the cards don't render headless with the seed JWT. |
| Generic empty / loading / success / warning / error states | ✅ visible on `00-library.png` ("States in flight" demo grid) + `00-stop-pages.png` (5 demo cards) | Both routes render an inline States-in-flight demo grid with 5 cards. The states use brand-aligned card chrome (dim outline, status icon, dimmed copy). Looks good as a primitive · question is whether actual feature routes (Channels, Schedule, Community, Earn) consume the same primitive or roll their own. Headless answer: legacy routes appear to roll their own. |
| Hover / focus states | ❌ not captured | Static screenshots only · puppeteer's `:hover` faking is unreliable in headless. Defer to manual pass. |

---

## 5 · Per-route findings table

Severity legend ·

- **P0** · beta-blocking · ship would actively confuse users
- **P1** · visible UX defect that lowers brand · ship is possible but the
  page feels unfinished
- **P2** · polish / inconsistency that brand-conscious users will catch
  during a side-by-side comparison
- **P3** · stylistic / nitpick

Phase-tagging legend ·

- **painter-phase** · brand / lighting / motion / icon swap · can be done
  in a polish pass without functional changes
- **functional-fix** · needs a router / state / state-machine change to
  resolve

| # | Route / surface | Issue | Severity | Screenshot | Recommended fix | Beta-blocking | Phase |
|---|---|---|---|---|---|---|---|
| R-01 | Intro splash | "SKIP INTRO" is hidden top-right at low contrast · easy for a new user to wait the full 6 s thinking they have no choice | P2 | `00-intro.png`, `21-intro-early.png` | Lift contrast or add a soft pulse on first 2 s | no | painter-phase |
| R-02 | LoginOnboarding | No sign-in panel / CTA visible at 3 s after navigation · only the boot-sequence world hero renders | P1 | `00-login.png` | Verify panel timing in `routes/LoginOnboarding.tsx` · if the panel mounts at 4-6 s, prepend a brief "Loading your console…" copy or pre-mount the panel hidden | yes (10-clipper readiness) | functional-fix |
| R-03 | LoginOnboarding | No clear brand chrome (wordmark / version pill) above the hero · user can't tell which app they just opened | P1 | `00-login.png` | Surface the `liquid/clips` wordmark + version pill `0.8.0-beta` top-left, visible from t=0 | yes | painter-phase |
| R-04 | Home / Command Room | Excellent · cinematic cockpit · KPI cards stamped with neon outlines · Featured campaign card with Kade portrait · Mission Status panel with pool progress | (positive) | `00-home.png` | (no action) | no | — |
| R-05 | Home / Command Room | Bottom "MISSION STATUS · 13 CLIPS LEFT" panel is partially overflowing the viewport at 1440×900 · may clip on smaller windows | P2 | `00-home.png` | Verify scroll containment at 1280×720 (Tauri minWidth · minHeight) | no | painter-phase |
| R-06 | Create | Renders the LEGACY shell (pixel-arcade nav · "Create" tagline · "SECTION_CREATE • FLOW_001_CREATE_URL_TO_CLIPS" debug pills) · feels like a different app from Home | P0 | `00-create.png` | Route `#/create` to the Design-OS `CreateClipsRoute` instead of the legacy `CreateSection` · the simplest way is to remove the `create` entry from `sectionRegistry.ts` so the legacy hash router falls through to home → SimulatorRouter → CreateClipsRoute | yes | functional-fix |
| R-07 | Create (legacy) | Pixel-arcade side nav · "PROJECTS" entry · "BROWSE" entry that don't exist in Design-OS nav · cross-app vocabulary | P0 | `00-create.png` | Same as R-06 · routing the slug to the Design-OS shell removes the side nav too | yes | functional-fix |
| R-08 | Create (legacy) | Debug pills `SECTION_CREATE` and `FLOW_001_CREATE_URL_TO_CLIPS` rendered inline above the title | P1 | `00-create.png` | These are dev-only diagnostics · remove before beta · or gate behind a `?debug=1` query param | yes | painter-phase |
| R-09 | Clipping Engine | Design-OS ✅ · "Kade is scanning your footage" hero · empty-state card "No source on the bench yet · Open Create Clips, paste a YouTube / TikTok / Drive / file …" · Kade mascot perfectly placed bottom-right | (positive) | `00-engine.png` | (no action) | no | — |
| R-10 | Clipping Engine | "Running engine preview · Demonstration pipeline · real linear state lands when the runtime is bowtied" pill visible · "bowtied" is a curious word choice | P3 | `00-engine.png` | Replace placeholder copy "bowtied" → "wired" or remove the dev pill | no | painter-phase |
| R-11 | Timeline Studio | Design-OS ✅ · "Pick a candidate to begin" hero · "No clip selected" empty state with "Open Clipping Engine" CTA · Kade mascot present | (positive) | `00-studio.png` | (no action) | no | — |
| R-12 | Timeline Studio | Page feels light · just hero + empty card + Kade · no scaffolding of the timeline / scrubber / preview surfaces · reads as a "coming soon" page | P1 | `00-studio.png` | Acceptable for 0.8.0-beta IF the CHANGELOG honestly says "no timeline yet" · audit's CHANGELOG already does. Otherwise prototype-grade scaffolding (greyed-out timeline strip) would set expectations. | no | painter-phase |
| R-13 | Thumbnail Studio | Design-OS ✅ · "Generate covers with your identity locked" hero · 3 generated thumbs visible with neon Kade portraits · prompt preview row · upload "Episode title / cover URL" rows | (positive) | `00-thumbnail.png` | (no action) | no | — |
| R-14 | Thumbnail Studio | The 3 visible thumb cards have identical Kade portraits (no variation) · reads as placeholder rather than "3 generated" | P2 | `00-thumbnail.png` | Either vary the seed across the 3 mockups or relabel the demo state ("Sample · same prompt, 3 variants") | no | painter-phase |
| R-15 | Export | Design-OS ✅ · "Pick a clip first" hero · "Target accounts · Tier cap reached" pill · format grid (16:9 vertical · 1:1 square · 16:9 widescreen · Original) · "Render guide · Idle - no active export" panel · Kade mascot present | (positive) | `00-export.png` | (no action) | no | — |
| R-16 | Export | "Pro" pill + "Studio Preview" pill stacked next to the breadcrumb · busy left-eye attention | P3 | `00-export.png` | Consolidate to a single "PRO · STUDIO PREVIEW" badge | no | painter-phase |
| R-17 | Channels | LEGACY shell · pixel-arcade nav · 6 channel cards (TikTok / Instagram / YouTube Shorts / X / LinkedIn / Facebook) | P0 | `00-channels.png` | Route `#/channels` to a Design-OS Channels route (none currently exists at the Design-OS level · `routes/Channels.tsx` is mounted via SimulatorRouter but is shadowed by the legacy sectionRegistry entry) · same fix shape as R-06 | yes | functional-fix |
| R-18 | Channels | Cinematic atmosphere reduced to a top-right neon scrim · world-feel is gone | P1 | `00-channels.png` | Same as R-17 · once routed to Design-OS, the WorldLayer cinematic lighting returns | yes | painter-phase |
| R-19 | Schedule | LEGACY shell · pixel-arcade nav · table-style queue with pending / posted / failed pill stack · feels like an admin tool, not the cinematic console | P0 | `00-schedule.png` | Same as R-17 · route to `routes/Schedule.tsx` | yes | functional-fix |
| R-20 | Schedule | The 4 visible schedule rows all read like fixture content from an older sprint ("the trap of perfectionism" · "ship to learn" · "audience-zero playbook") · still legitimate copy but feels disconnected from current campaign-funnel branding | P2 | `00-schedule.png` | Refresh fixture rows in next polish pass | no | painter-phase |
| R-21 | Community | LEGACY shell · 5 channel cards (Announcements · Free Clipper Lobby · Uncle Daniel Clips · Viral Reaction Missions · Premium Rewards HQ) · paid badges on 3 cards · pixel-arcade nav | P0 | `00-community.png` | Same as R-17 | yes | functional-fix |
| R-22 | Community | "Whop rooms · Click a card · opens the room in the in-app browser overlay" copy is good · but the cards themselves lack the cinematic frame that Library/Campaigns cards have | P2 | `00-community.png` | Promote room cards to the Design-OS card primitive · gated on R-21 | no | painter-phase |
| R-23 | Earn | LEGACY shell · "No active campaign · stamp @uncledaniel - locked" pill · "Whop handles rewards" v1 reality copy · "Native rewards · payouts · leaderboard are v2 deferred" honest copy | P0 | `00-earn.png` | Same as R-17 · the Design-OS `EarnRoute` (`routes/Earn.tsx`) exists | yes | functional-fix |
| R-24 | Earn | The copy is honest (P1-3 voice) but the legacy chrome buries the message under arcade icons + heavy spotlight wash | P2 | `00-earn.png` | Resolved by R-23 | no | painter-phase |
| R-25 | Library | Design-OS ✅ · "Your past work, ready to remix" hero · "1,420 clips archived · LIVE" stat card · States-in-flight demo grid with empty / loading / success / warning / error variants | (positive) | `00-library.png` | (no action) | no | — |
| R-26 | Library | "States in flight" demo grid is intentional but currently reads as dev-only · users may think the page IS the demo grid | P1 | `00-library.png` | Either gate behind `?debug=1` or add a "Demo · sample states" caption ribbon | no | painter-phase |
| R-27 | Clipper journey | LEGACY shell · 5-step icon row (JOIN · CLIP · POST · SUBMIT · EARN) with pink pulse · "Clipper Mode" hero | P0 | `00-clipper.png` | Same as R-17 · route to the Design-OS `ClipperJourneyRoute` | yes | functional-fix |
| R-28 | Clipper journey | The 5-step icon row IS visually distinct and on-brand (pulsing neon nodes) · arguably the strongest single legacy primitive | P3 | `00-clipper.png` | Consider porting this primitive into the Design-OS shell post-rebuild | no | painter-phase |
| R-29 | Campaigns | Design-OS ✅ · "Pick a mission, read the brief, join" hero · Featured "Cold-open hooks" card with neon `$5 PER CLIP` callout · 2 cards below (DDB Beauty launch week · Product Hunt launch coordinated upvote) | (positive) | `00-campaigns.png` | (no action) | no | — |
| R-30 | Campaigns | Kade mascot overlaps the bottom-right corner of the featured card · marginal layout conflict at 1440×900 | P2 | `00-campaigns.png` | Move Kade left or shrink at this breakpoint | no | painter-phase |
| R-31 | Campaigns | The "ALL · FEATURED · REGION · AFFILIATE · SUBMISSION" filter row pills are partially overlapped by Kade · same root cause as R-30 | P2 | `00-campaigns.png` | Same fix | no | painter-phase |
| R-32 | Campaigns → Agency creation drawer | Not capturable headless · tier-gated by P1-1G-c · audit-coverage gap | P2 | (none) | Add a debug-only override (env-gated) that satisfies `canUseAgencyActions` for fixture/test runs · OR run a manual screenshot pass with a real agency-tier `/me` response | no | functional-fix (audit tooling) |
| R-33 | Campaigns → CampaignPage drawer | Not capturable headless · no campaign card found at `[data-campaign-card]` · likely no campaign data without real `/me` | P2 | (none) | Same fix shape as R-32 · OR a fixture-mode flag that mounts the demo campaign cards | no | functional-fix (audit tooling) |
| R-34 | Settings | **LEGACY shell** · all the P1-2/P1-3 work (9 sections · 3-state vocab · honest Plan & Access · real `/me` Account section) is INVISIBLE from this navigation path | **P0** | `00-settings.png` | Remove `settings` entry from `sectionRegistry.ts` so `#/settings` falls through to home → SimulatorRouter → Design-OS `SettingsRoute` · this is a one-line registry edit and a one-line check that no consumer of the legacy `SettingsSection` exists | yes | functional-fix |
| R-35 | Settings (legacy) | Tabs are old vintage · Account/Billing · API Keys · Integrations · Privacy · Diagnostics · HQ Bridge/Deep Links · About · pre-dates P1-3-b's Connection status / Connected accounts / Beta diagnostics structure | P0 | `00-settings.png` | Resolved by R-34 | yes | functional-fix |
| R-36 | Settings (legacy) | "73 / 100 clips remaining" appears in the FREE tier card · this is fixture data · the real `useMe()` `degraded` state is not surfaced | P1 | `00-settings.png` | Resolved by R-34 (Design-OS Settings reads `useMe()` properly) | yes | functional-fix |
| R-37 | Settings · scrolled mid | Scroll-to-y=1200 had no effect from puppeteer · legacy shell uses its own scroll container that ignores window-level scroll | P3 | `20-settings-mid.png` | Cosmetic of the audit tooling, not the app | no | — |
| R-38 | Stop Pages | Design-OS ✅ · "Welcome back to the Clip Console" + "10 stop pages mapped · 16 STEPS · AUTO-DETECT · PER-WORLD" stat card · 5-card States-in-flight demo grid (No active campaigns · Catching up · Just joined · Only 13 free clips left · Sidecar offline) | (positive) | `00-stop-pages.png` | (no action) | no | — |
| R-39 | Stop Pages | Header still reads "Welcome back to the Clip Console" — same string as Home · suggests the StopPages page doesn't have its own hero | P2 | `00-stop-pages.png` | Add a stop-pages-specific hero string ("Reasons we'd stop the assembly line") or similar | no | painter-phase |
| R-40 | Global · footer marker | "DESKTOP-2 SIMULATOR" or similar dev marker visible bottom-right on every legacy route screenshot | P1 | every legacy screenshot | Gate behind dev mode · do not ship to beta users | yes | painter-phase |
| R-41 | Global · top-right user pill | The "DANIEL · GOLD · 1.4K CLIPS" pill is present on every Design-OS route but is absent in legacy routes (only "DD" avatar shown) | P2 | compare `00-home.png` to `00-channels.png` | Resolved when legacy routes route to Design-OS (R-17 et al.) | no | painter-phase |
| R-42 | Global · KPI top row | Design-OS pills "2 NEWS · 7 DAY" + "DANIEL" identity surface only in Design-OS routes | P2 | same as R-41 | Same | no | painter-phase |
| R-43 | Global · brand wordmark | Design-OS uses `liquid/clips` modern wordmark · legacy uses the pink pixel mascot in the same slot · two-different-brand confusion | P0 | every legacy screenshot | Resolved by removing legacy section entries | yes | functional-fix |

---

## 6 · Beta-blocking summary (a subset of §5 with severity P0 + R-02/R-03/R-34/R-36/R-40 from P1)

| # | Issue | Painter or Functional |
|---|---|---|
| R-06 / R-07 / R-08 | Create renders legacy shell (3 P0 + 1 P1) | functional |
| R-17 / R-18 | Channels renders legacy shell | mostly functional · painter cascades |
| R-19 / R-20 | Schedule renders legacy shell | functional |
| R-21 / R-22 | Community renders legacy shell | functional |
| R-23 / R-24 | Earn renders legacy shell | functional |
| R-27 / R-28 | Clipper journey renders legacy shell | functional |
| **R-34 / R-35 / R-36** | **Settings renders legacy shell · P1-3 work invisible** | **functional** |
| R-43 | Brand wordmark forks between two visual vocabularies | functional |
| R-02 / R-03 | LoginOnboarding · slow / missing CTA + brand chrome | functional + painter |
| R-40 | Dev "DESKTOP-2 SIMULATOR" marker still shipping | painter |

**Estimated headline fix to clear most P0 rows ·** remove 7 entries from
`desktop-2/src/shell/sectionRegistry.ts` (create · channels · schedule
· community · earn · clipper · settings) so the legacy hash router
falls through to home → SimulatorRouter → Design-OS routes. Verify no
imports of `CreateSection / ChannelsSection / ScheduleSection /
CommunitySection / EarnSection / ClipperSection / SettingsSection`
break, then delete the unused files in a follow-up. This is ONE-FILE-LITE
work but cascades to the visual brand alignment of 7 of the 15 routes.

---

## 7 · Audit-coverage gaps (acknowledged, not findings)

| Surface | Why missed | What to do |
|---|---|---|
| `InvadersOverlay` | gated on user interaction · no auto-fire | manual click pass |
| `BrowseOverlay` / `BrowserScrim` | gated on `browser` store · no auto-fire | manual nav to a campaign that opens Browse |
| `Campaigns → Agency creation drawer` | tier-gated by `canUseAgencyActions` (P1-1G-c · CORRECT behaviour) | env-gated debug override OR real agency `/me` |
| `Campaigns → CampaignPage drawer` | no campaign card selector matched · likely the demo data needs a real `/me` | same as above |
| Hover / focus / active interaction states | static PNG capture | manual interaction pass |
| Motion / cinematic jank | static PNG capture | record a 5 s `screencapture -V` of each route during interaction |
| `IntroSplash` mid-frame timing | only 2 snapshots taken | add a t=1000/2000/3000/4000/5000ms sweep on next pass |
| `LoginOnboarding` t=6000ms+ | only 1 snapshot at 3 s | add a t=5000/7000ms hold to verify sign-in CTA timing |

---

## 8 · Closure

- 17 routes + 2 variants captured
- 19 PNGs in `docs/ux-1-a-screenshots/`
- 43 findings (3 P0-blocking · 7 P0-cascade · 12 P1 · 14 P2 · 7 P3 + positives)
- 0 code change
- 0 fix applied
- `PHASE_1_CRITICAL_PATH.md` referenced for context · NOT reopened
- The single highest-leverage fix is removing 7 legacy section entries
  in `sectionRegistry.ts`. That ONE edit removes 12 of the 43 findings.

Daniel's call on whether the next phase is:

- **Painter-phase only** · keep both shells, only fix R-40 (dev marker)
  + R-02/R-03 (LoginOnboarding) + cosmetic R-10/R-14/R-20/R-30
- **Functional-fix · low-touch** · remove the 7 legacy section entries
  in one PR · ship to beta
- **Functional-fix · clean** · remove legacy section entries + delete
  the orphan `sections/*` files · also delete `src/shell/AppShell.tsx`
  if HomeSection is the only consumer · larger PR · cleaner final state

Stop · audit closed · no follow-on phase started.

---

## 9 · UX-1-b · closure note (2026-06-19, same day)

The headline fix described in §1 and §6 was applied in a single edit to
`src/shell/sectionRegistry.ts` · 7 SectionEntry objects deleted (CREATE
· CHANNELS · SCHEDULE · COMMUNITY · EARN · CLIPPER · SETTINGS) +
matching 7 imports removed. The component files in
`sections/create/CreateSection.tsx` etc. remain on disk per directive;
they are simply unreferenced.

`SECTION_IDS` itself is untouched · the 7 ID string constants are still
used as keys in `brand/brandAssets.ts` (nav badges, atmospheres) and
as debug pills inside the orphan section components.

### UX-1-a rows resolved

| Row | UX-1-a finding | Status after UX-1-b |
|---|---|---|
| R-06 / R-07 / R-08 | Create renders legacy shell | **RESOLVED** · `00-create.png` now shows Design-OS `CreateClipsRoute` ("Drop a YouTube link to start clipping" hero · URL/MP4/MOV/LIVE pills · Kade · States-in-flight demo grid) |
| R-17 / R-18 | Channels renders legacy shell | **RESOLVED** · `00-channels.png` now shows Design-OS `ChannelsRoute` ("Connect a platform to ship clips" hero · 6/5 channel-slots pro card with Agency upgrade · TikTok 6/7 connected accounts grid) |
| R-19 / R-20 | Schedule renders legacy shell | **RESOLVED** · `00-schedule.png` now shows Design-OS `ScheduleRoute` ("Drop a clip on a lane, watch it launch" hero · 7-day calendar pills · filter pills · per-day post list) |
| R-21 / R-22 | Community renders legacy shell | **RESOLVED** · `00-community.png` now shows Design-OS `CommunityRoute` ("Find your squad" hero · Top 100 achievement · feed cards · Featured Discussion) |
| R-23 / R-24 | Earn renders legacy shell | **RESOLVED** · `00-earn.png` now shows Design-OS `EarnRoute` ("Your coins, your payouts, your pace" hero · 4 stat cards · payout rows) |
| R-27 / R-28 | Clipper renders legacy shell | **RESOLVED** · `00-clipper.png` now shows Design-OS `ClipperJourneyRoute` ("Join · Clip · Post · Submit · Earn" hero · Step 3 of 8 stamped progress · States-in-flight demo grid) |
| R-34 / R-35 / R-36 | Settings renders legacy shell · P1-3 work invisible | **RESOLVED** · `00-settings.png` now shows the P1-2 / P1-3 Design-OS `SettingsRoute` ("Tune your console" hero · Account / Connection Status / 9-section structure · "Studio preview" honest state vocabulary) |
| R-43 | Brand wordmark forks between legacy mascot + Design-OS wordmark | **RESOLVED** · `liquid/clips` modern wordmark + Design-OS console nav now visible on all 7 previously-legacy routes |
| R-41 / R-42 | "DANIEL · GOLD · 1.4K CLIPS" user pill + KPI hud absent in legacy | **RESOLVED** · TopHud now renders consistently on all 7 routes |

### Rows NOT yet resolved (intentional · out of UX-1-b scope)

| Row | Why deferred |
|---|---|
| R-02 / R-03 | LoginOnboarding timing + brand chrome · functional-fix in `routes/LoginOnboarding.tsx` |
| R-40 | "DESKTOP-2 SIMULATOR" dev marker · painter-phase work |
| R-05 / R-10 / R-14 / R-16 / R-20 / R-26 / R-30 / R-31 / R-39 | All painter-phase polish items |
| R-12 | Timeline Studio scaffolding density · painter-phase |
| R-32 / R-33 | Audit-tooling fixture override |
| R-37 | Cosmetic of audit tool · not the app |

### Regression check

| Route | UX-1-a baseline | UX-1-b post-fix | Result |
|---|---|---|---|
| Home | Design-OS (cinematic cockpit) | Design-OS (identical) | ✓ no change |
| Engine | Design-OS | Design-OS (identical) | ✓ no change |
| Studio | Design-OS | Design-OS (identical) | ✓ no change |
| Thumbnail | Design-OS | Design-OS (identical) | ✓ no change |
| Export | Design-OS | Design-OS (identical) | ✓ no change |
| Campaigns | Design-OS | Design-OS (identical) | ✓ no change |
| Library | Design-OS | Design-OS (identical) | ✓ no change |
| Stop Pages | Design-OS | Design-OS (identical) | ✓ no change |
| Login | Design-OS boot stage | Design-OS boot stage (identical) | ✓ no change |
| Intro | Cinematic boot | Cinematic boot (identical) | ✓ no change |

`npx tsc --noEmit` → EXIT 0 after the edit. No type errors.

### Files changed

| File | Diff |
|---|---|
| `src/shell/sectionRegistry.ts` | −7 imports · −7 SectionEntry objects · +3 UX-1-b comment markers explaining the fall-through · `SECTION_IDS` import + the other 7 ID-keyed entries unchanged |
| `docs/ux-1-a-whole-app-visual-motion-asset-audit-2026-06-19.md` | +§9 closure note (this section) |
| `docs/ux-1-b-screenshots/` | new dir with 19 post-fix PNGs (parallel to `ux-1-a-screenshots/`) |
| `scripts/ux-1-b-capture.mjs` | clone of `ux-1-a-capture.mjs` with output dir flipped to `ux-1-b-screenshots/` |

### Capture parity

Both UX-1-a and UX-1-b screenshot sets used identical viewport
(1440×900 @ 2× DPR), identical `seedJwt` strategy, identical 3-second
hold per route. Side-by-side directories (`docs/ux-1-a-screenshots/`
vs `docs/ux-1-b-screenshots/`) preserve a clean before/after diff for
every captured route.

UX-1-b closed · no follow-on phase started.

---

## 10 · UX-1-c · closure note (2026-06-19, same day)

Low-risk visible polish · 7 small edits across 7 files · zero
architectural change · zero auth / billing / routing / SECTION_REGISTRY
edit · `npx tsc --noEmit` EXIT 0.

### Edits

| # | File | Change | UX-1-a row |
|---|---|---|---|
| 1 | `src/overlays/SignalLine.tsx` | `"desktop-2 simulator · 0.8.0-shell"` → `"0.8.0-beta"` | **R-40** |
| 2 | `src/design-os/routes/CommandRoom.css` | `.cr-hero { min-height: 460px }` → `420px` (Mission Status panel fits inside 900 viewport) | **R-05** |
| 3 | `src/design-os/thumbnail/ThumbnailVariantGallery.tsx` | header count `"3 generated"` → `"3 variants"` (drops misleading "generated" word when 3 sample variants all share fixture art) | **R-14** |
| 4 | `src/design-os/routes/ExportRoute.tsx` | merged separate `Studio preview` + `PRO` pills into single `PRO · Studio preview` badge in mock mode; real mode keeps just the tier pill | **R-16** |
| 5 | `src/design-os/routes/SimPage.tsx` | added `heroOverride?: RouteHero` prop · 5-state grid header `"States in flight"` → `"Sample states"` | **R-26 + R-39 plumbing** |
| 6 | `src/design-os/routes/StopPages.tsx` | passes `heroOverride={{ eyebrow: "Mission control · stop pages", h1: "Where the assembly line stops", sub: "Free cap · Payment · Whop handoff · Export · Auth — each blocker routed to the right Kade tone." }}` | **R-39** |
| 7 | `src/design-os/routes/Campaigns.tsx` + `src/design-os/routing/routeRegistry.ts` | Campaigns `kadePlacement="center"` → `"helper-right"` (matches dense workspace pattern · Kade no longer overlapping filter pill row at 1440×900); routeRegistry entry updated for consistency though the hardcoded prop in `Campaigns.tsx` is what takes effect | **R-30 + R-31** |

### UX-1-a rows resolved

| Row | Status | Evidence |
|---|---|---|
| **R-05** Home Mission Status overflow | RESOLVED | `ux-1-c-screenshots/00-home.png` · Mission Status panel ("13 CLIPS LEFT" → "POOL PROGRESS 87/100" → "NEXT ACTION" → "SQUAD RANK") now fully visible inside 900-height viewport |
| **R-14** Thumbnail "3 generated" implies real generation | RESOLVED | `00-thumbnail.png` · header reads "VARIANTS · 3 variants" |
| **R-16** Export Pro + Studio Preview pills stacked | RESOLVED | `00-export.png` · eyebrow now reads "EXPORT · RENDER · SHIP · [PRO · STUDIO PREVIEW]" as single combined badge |
| **R-26** Library "States in flight" reads as dev-only | RESOLVED | `00-library.png` · header now reads "Sample states · empty · loading · success · warning · error" |
| **R-30 / R-31** Campaigns Kade overlap | RESOLVED (visible improvement · subtle) | `00-campaigns.png` · filter row pills no longer obstructed by Kade. helper-right preset matches the dense-workspace pattern used by Studio / Thumbnail / Export / Library / Channels / Schedule / Settings. |
| **R-39** Stop Pages reuses Home hero | RESOLVED | `00-stop-pages.png` · hero reads "MISSION CONTROL · STOP PAGES · Where the assembly line stops · Free cap · Payment · Whop handoff · Export · Auth — each blocker routed to the right Kade tone." |
| **R-40** "DESKTOP-2 SIMULATOR" dev marker | RESOLVED | SignalLine footer now reads "0.8.0-beta" if/when it surfaces. The footer is hidden by CSS under `body[data-design-os="active"]` so it's already invisible on every Design-OS route; this edit guards against future regression where SignalLine resurfaces. |

### UX-1-a row NOT edited (intentional)

| Row | Reason |
|---|---|
| **R-10** "Demonstration pipeline · real linear state lands when the runtime is bowtied" | UX-1-a misread. The actual source string in `EngineHealthPanel.tsx:35` is `"Demonstration pipeline · real ingest lands when the runtime is installed."`. The visible eyebrow on `00-engine.png` is the small "Engine preview" pill (whose hover title is the longer copy). "bowtied" never appears in code · audit OCR error. No-op. |

### Out-of-scope rows (per directive)

R-02 / R-03 (LoginOnboarding · functional) · R-12 (Timeline scaffolding density) · R-32 / R-33 (audit-tooling drawer captures) · R-37 (cosmetic of audit tool, not the app) · R-41 / R-42 / R-43 (already resolved by UX-1-b) · R-01 (SKIP INTRO contrast · P2 painter, low priority).

### Regression check (UX-1-c vs UX-1-b on unchanged routes)

| Route | Result |
|---|---|
| Create (R-06/07/08 resolved by UX-1-b) | ✓ unchanged · Design-OS shell |
| Channels (R-17/18) | ✓ unchanged |
| Schedule (R-19/20) | ✓ unchanged |
| Community (R-21/22) | ✓ unchanged |
| Earn (R-23/24) | ✓ unchanged |
| Clipper (R-27/28) | ✓ unchanged |
| Settings (R-34/35/36) | ✓ unchanged |
| Intro / Login | ✓ unchanged |
| Engine / Studio | ✓ unchanged |

`npx tsc --noEmit` → EXIT 0 after every edit. No type errors.

### Capture parity

- UX-1-c uses identical capture pipeline (`scripts/ux-1-c-capture.mjs`,
  cloned from UX-1-a) so the 19 PNGs in `docs/ux-1-c-screenshots/` are
  pixel-comparable to the UX-1-a + UX-1-b baselines.
- The PNG file names match across all three snapshot dirs · diff any
  pair side-by-side with `open docs/ux-1-{a,b,c}-screenshots/00-home.png`
  etc.

UX-1-c closed · no follow-on phase started.


