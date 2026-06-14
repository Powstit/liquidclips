# Liquid Clips Desktop — UI Upgrade Master Scope

**Date:** 2026-06-14
**Author:** Claude (UI/UX design director, scope only — does not build)
**Builders:** Kimi agents per lane assignment below
**Working version:** v0.7.76 installed (Sprint 4 + sibling-session Earn + Reaction Kimi-in-progress)
**Status:** SCOPE — no code change, no commit, no push, no tag, no release, no latest.json

> **The principle:** *Can a cold customer land on any page and know exactly what to do next?*
> If a surface fails that test, this scope flags it. If a surface passes it, this scope leaves it alone.

---

## 0. Read first (in order)

1. `~/Downloads/LIQUID_CLIPS_SHIP_STANDARD_IRON_GATES.md` — ship-standard SECTION D (UI polish) sets the gate.
2. `desktop/docs/IRON_GATES.md` — 14 active iron gates; **IG-005, IG-006, IG-007, IG-008, IG-011, IG-012, IG-014** are load-bearing for this scope.
3. `docs/CUSTOMER_JOURNEY_UI_DEAD_END_AUDIT.md` (2026-06-13, audited v0.7.66) — surface-by-surface audit + 17 P0/P1 dead-end items.
4. `docs/UI_POLISH_AND_LINK_FIX_PLAN.md` (2026-06-13) — P1/P2 polish plan derived from the audit.
5. `docs/UI_PRESERVATION_INVENTORY.md` (2026-06-13, v0.7.70) — must-preserve list from the sibling session's Earn+auth work.
6. `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` — 5 deck atmospheres + 4 state plates + 2 interaction plates + 1 badge (CSS hooks documented).
7. `desktop/docs/LIQUID_CLIPS_2027_DESIGN.md` — north-star vision (NOT the immediate target; reference only).
8. `~/.claude/skills/liquid-clips-brand-kit/SKILL.md` — canonical brand kit memory.
9. **THIS DOC** — lane assignments + collision matrix + rules.
10. The five sub-docs in `desktop/docs/ui-upgrade/`:
    - `UI_LANE_1_SHELL_ONBOARDING.md`
    - `UI_LANE_2_CLIP_CARDS_EDITOR.md` (blocked until Kimi Reaction confirms done)
    - `UI_LANE_3_PROJECTS.md`
    - `UI_LANE_4_EARN.md`
    - `UI_LANE_5_SETTINGS_PAYWALL_STATES.md`

---

## 1. Demo UI + brand kit + customer journey docs — what exists

### 1.1 IG-012 demo HTML files (CONTRACT — pixel/brand-token strict)

| File | Path | Purpose |
|---|---|---|
| Workspace + cockpit canonical demo | `desktop/docs/demo.html` (1076 lines) | Workstation Room + Cockpit deck — token contract |
| 9-surface deck demo | `desktop/docs/demo-pages.html` (1128 lines) | All 9 main surfaces (Workspace / Library / Projects / Earn / Schedule / Settings / Community / Learn / paywall) — token contract |
| Thumbnail Studio demo | `desktop/docs/demo-thumbnail.html` (368 lines) | Cover Pack / Brand / Identity wizard — token contract |

IG-012 enforces brand-token parity between these and `src/index.css` via `scripts/brand-kit-drift-check.sh` (pre-commit). Any drift from the 8 tracked hexes (`fuchsia`, `fuchsia-bright`, `fuchsia-deep`, `paper`, `paper-warm`, `paper-elev`, `ink`, `ink-soft`) is refused.

### 1.2 Reference demo HTML files (REFERENCE — design intent)

| File | Path | Purpose |
|---|---|---|
| Cockpit handoff states | `desktop/docs/cockpit-handoffs-demo.html` | 5 cockpit handoff visual states — reference for IG-006 contract |
| Workbench / clips canonical reference | `desktop/docs/clip-dashboard-demo.html` | ClipCard structure (IG-007 sealed gate) |
| Cockpit v2 history | `desktop/docs/cockpit-v2-demo.html` | Pre-v0.7.29 cockpit shape |
| Made-with-Liquid-Clips brand | `desktop/docs/made-with-liquid-clips-demo.html` | Brand-mark + watermark treatment |
| Thumbnails reference | `desktop/docs/thumbnails-demo.html` | Cover pack iteration history |

### 1.3 Brand kit + visual system

| Source | What it gives us |
|---|---|
| `~/.claude/skills/liquid-clips-brand-kit/SKILL.md` | Type tokens, surface ladder, motion vocabulary, HUD bracket components, iconography, voice rules, per-deck mood tints |
| `desktop/docs/BRAND_ATMOSPHERE_QUEUE.md` | 12 brand atmosphere plates (5 decks + 4 states + 2 interactions + 1 badge) with explicit CSS-hook drop points |
| `desktop/src/index.css` | Canonical token block (`@theme`), `.library-card` + `.library-card-corner-*` HUD pattern |

### 1.4 Customer journey docs

| File | What it covers | Status |
|---|---|---|
| `docs/CUSTOMER_JOURNEY_UI_DEAD_END_AUDIT.md` | 35-section pass/fail + button/link matrix + dead-end list + auth/keychain risk + URL list | audit baseline; **many P0s already fixed in v0.7.70+** |
| `docs/UI_POLISH_AND_LINK_FIX_PLAN.md` | P1/P2 polish derived from audit | reference plan |
| `docs/UI_PRESERVATION_INVENTORY.md` | must-preserve UI changes already shipped through v0.7.70 | preservation baseline |
| `docs/AUTH_STATE_CUSTOMER_JOURNEY_AUDIT.md` | auth + reactivation journey | partial; Earn auth already fixed |
| `docs/UPGRADE_SELF_ONBOARDING_CUSTOMER_JOURNEY.md` | onboarding/upgrade journey | reference |
| `docs/customer-journey.md` | canonical journey doc | reference |
| `docs/CLAUDE_WORKSPACE_ONBOARDING_HANDOFF_2026-06-04.md` | workspace onboarding handoff | reference |
| `docs/FLAWLESS_CUSTOMER_JOURNEY_SCOPE.md` | scope doc | reference |
| `docs/CLAUDE_CUSTOMER_JOURNEY_REPORT_2026-06-01.md` | prior journey report | reference |

### 1.5 Sibling-session in-flight scope docs (Projects)

| File | Status |
|---|---|
| `docs/PROJECTS_MANAGER_SCOPE.md` | shipped (v0.7.73) |
| `docs/PROJECTS_MANAGER_GAPS_AND_FIXES.md` | shipped (v0.7.76 Sprints F1–F5) |
| `docs/PROJECTS_DRAG_DROP_ADD_FROM_LIBRARY_FINAL_UX.md` | shipped (Sprints 1–4) |
| `docs/EARN_*` family | shipped through v0.7.70 |
| `docs/CLAUDE_REACTION_LIBRARY_HANDOFF_2026-06-04.md` | Kimi Reaction owns |
| `docs/CLAUDE_REACTION_SUITE_LAUNCH_BLOCKER_SPEC_2026-06-04.md` | Kimi Reaction owns |

---

## 2. App-wide UI problems

### 2.1 What works (preserve, do not redo)

These are already at brand-quality from prior work — lanes must **not** rewrite them:

- Earn surface — `EarnTab.tsx` v0.7.70 universal layout shell, `EarnLayout.tsx` 3-column spine, `EarnTickerStrip.tsx`, `EarnHowItWorks.tsx`, `EarnSidebar.tsx`, `PayoutsView.tsx`, `BountyCard.tsx`, `AffiliateHero.tsx` — sibling session shipped these.
- Projects manager — `ProjectsTab.tsx`, `ProjectDetail.tsx`, `ProjectCard.tsx`, `NewProjectModal.tsx`, `AddFromLibraryModal.tsx`, `MoveToProjectModal.tsx`, `ProjectsLockedScreen.tsx` — Sprints 1–4 shipped.
- Auth — activate({ via: "browser" }) flow, AvatarPanel re-activation, Settings re-activate, AuthPanel mode pruning. **DO NOT reintroduce `openAuthPanel("sign-in")` anywhere.**
- Schedule → Loadout copy migration is canonical. Anywhere "Settings → Connections" still appears is a P1 copy bug; do **not** revert.
- Crash overlay mounted, BottomCockpit dropdown wired, OpenAI-key route fixed.

### 2.2 What's underbaked (this scope's mandate)

| # | Problem | Severity | Lane |
|---|---|---|---|
| A | Sidebar / global shell visually generic — no deck-atmosphere plates, badges static, no breadcrumb / context strip, no Cmd+K | P1 | **Lane 1** |
| B | First-launch / onboarding intro splash mounts but lacks a self-onboard hint trail | P1 | **Lane 1** |
| C | Empty states across Library / Projects / Schedule / Community / Earn-Personal are flat dashed boxes — no atmosphere plate, copy still references missing tabs | P1 | **Lane 5** (cross-cutting) |
| D | Loading skeletons inconsistent — some surfaces use `animate-pulse` rectangles, others spinners, others blank space | P2 | **Lane 5** |
| E | Error states inconsistent — some red banners, some inline text, some toast-only | P2 | **Lane 5** |
| F | Upgrade/paywall surfaces — UpgradeLockCard is 59 lines and feels like a placeholder against the rest of the brand | P1 | **Lane 5** |
| G | Settings tab (1923 lines) — dense, header hierarchy unclear, API-keys + Channels + Account + Billing all compete for attention | P1 | **Lane 5** |
| H | PublishModal — disabled-reason tooltips landed (v0.7.70) but the visual chrome still reads "developer modal" not "publish deck" | P2 | **Lane 5** |
| I | Notification system — `NotificationBell` wrapped in `{false && ...}`, AvatarOrbit hardcodes `notificationCount={0}` — both stay until Lane 1 mounts or removes them | P1 | **Lane 1** |
| J | Clip cards (Library + Project + workbench + results) — workbench polish is gated on Kimi Reaction; non-editor cards (Library/Project) can polish in their own lanes | P1 (split) | **Lane 2** (workbench) + Lane 3 (Project cards) |
| K | Reaction Studio / Assets / OverlaySourcePicker — full visual + functional pass owned by Kimi Reaction | P0 | **Lane 2 (WAIT)** |
| L | Free / Paid / Admin state clarity — tier pills, locked-tile copy, upgrade CTA placement inconsistent across surfaces | P1 | **Lane 5** + cross-cutting |
| M | Platform / social icons inconsistent — `PlatformIcon` vs `PlatformGlyph` vs lucide-react `Instagram` / `Youtube` mix across surfaces | P2 | **Lane 5** (unification pass) |
| N | Buttons inconsistent — primary/secondary/locked/destructive/disabled/loading/success states have no shared component spec | P1 | **Lane 1** (define) + cross-cutting (apply) |
| O | Tables / lists — Schedule queue, channel list, submission list, payout list, leaderboard all use different row chrome | P2 | **Lane 5** + Lane 4 (Earn tables) |

---

## 3. Customer journey problems

Cold customer = first-time user landing on **any** surface (cold boot, deep-link, post-Whop-purchase, share-link, etc.).

### 3.1 Where the journey breaks today

| Entry point | Cold-customer confusion | Lane |
|---|---|---|
| Cold boot → Workstation | 4 tiles + greeting, no "start here" arrow. New user doesn't know what gets them to a clip. | Lane 1 |
| Cold boot signed-out → FirstRun | OK path; but post-sign-in, lands back on Workspace with no "next step" guidance | Lane 1 |
| Direct nav to Projects (signed-out / free) | Locked screen renders; clear CTAs (Upgrade / Browse Earn / Open Library) — passable | Lane 3 (light polish) |
| Direct nav to Projects (paid, empty) | Sprint 2 V2 "Three ways to fill it" tiles shipped — passable | Lane 3 (light polish) |
| Direct nav to Library | Library wall renders + filter chips; empty state OK but "what should I do?" unclear if nothing's been imported | Lane 5 (empty state pass) |
| Direct nav to Earn (signed-out) | Public bounties + sponsored carousel + "Unlock to start" inline gating shipped v0.7.70 — passable | Lane 4 (light polish) |
| Direct nav to Earn (signed-in, no clips) | "Open" tab works; "Doing" tab needs clearer empty state | Lane 4 |
| Direct nav to Schedule | Loadout works; "no channels" empty state has CTA — passable | Lane 5 (light polish) |
| Direct nav to Community | Community hub opens; per-room flow OK; **no overall empty hero when zero rooms** | Lane 5 |
| Direct nav to Settings | 1923 lines of dense UI; user lands on first tab, doesn't know what each tab does | Lane 5 |
| Mid-flow: clip ready to publish | PublishModal disabled-reason tooltips shipped; but path from "clip ready" → "click Publish" not obviously signposted on the card | Lane 2 (WAIT) |
| Mid-flow: bake fails | BakeFailedStrip renders inline; user has retry but reason not always clear | Lane 2 (WAIT) |
| Post-checkout return | `lc:checkout-complete` listener still missing in desktop (UI_POLISH P1) | Lane 5 |

### 3.2 What every page must answer

Every surface must give the cold customer a clear answer to all five questions:

1. **Where am I?** — visible page title + breadcrumb in context strip.
2. **What can I do here?** — primary CTA visible above the fold; secondary CTAs grouped.
3. **What should I click next?** — empty / fresh state has one obvious CTA, not three competing ones.
4. **What is locked and why?** — locked tiles say "Pro unlocks this — see plans" or "Sign in to unlock", never just dim.
5. **How do I finish the job?** — every surface tied to a completion path (export → publish → schedule → earn).

This is the **per-surface acceptance test** every lane must pass.

---

## 4. Recommended design system direction

**The direction is "Liquid Clips brand kit applied consistently."** It is **not** a new style. It is the existing visual system finally extended to surfaces that still look like dev UI.

### 4.1 Core tokens (from IG-012, do not change)

| Token | Hex | Role |
|---|---|---|
| `fuchsia` | `#FF1A8C` | Primary accent — CTAs, focus rings, brand glow |
| `fuchsia-bright` | (per index.css) | Hover state for primary |
| `fuchsia-deep` | (per index.css) | Pressed / active text-on-light |
| `paper` | `#0b0b10` | App background |
| `paper-warm` | (per index.css) | Card / panel surfaces (warmer than paper) |
| `paper-elev` | (per index.css) | Elevated surfaces (drawer, modal body) |
| `ink` | (per index.css) | Primary text |
| `ink-soft` | (per index.css) | Secondary text |

Per-deck mood tints (cyan-cool for Workspace, warm amber for Earn pending, etc.) evolve **independently** per surface — not gated.

### 4.2 Surface ladder

| Layer | Background | Border | Use |
|---|---|---|---|
| App background | `bg-paper` | none | RoomShell root |
| Card | `bg-paper-warm` or `bg-paper-elev/40` | `border-line` (or `border-line/60`) | LibraryCard, ProjectCard, ClipCard, BountyCard |
| Drawer / modal | `bg-paper-warm` | `border-line` | NewProjectModal, MoveToProjectModal, PublishModal |
| Pill / chip | `bg-paper-elev/80` (neutral) or `bg-fuchsia-soft/40` (Earn) | varies | Type pills, status chips |

### 4.3 Typography rhythm

| Role | Class | Weight | Size |
|---|---|---|---|
| Eyebrow (mono, uppercase, tracked) | `font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia` | normal | 10px |
| Display H1 | `font-display text-[28-30px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink` | semibold | 28-30px |
| Display H2 | `font-display text-[20-22px] font-semibold tracking-[-0.02em] text-ink` | semibold | 20-22px |
| Body | `font-sans text-[13px] leading-relaxed text-text-secondary` | normal | 13px |
| Meta / mono | `font-mono text-[10-11px] uppercase tracking-[0.14em] text-text-tertiary` | normal | 10-11px |

### 4.4 Button taxonomy (Lane 1 defines, all lanes apply)

| Role | Shape | Background | Hover | Disabled | Loading |
|---|---|---|---|---|---|
| Primary CTA | `rounded-full px-4 py-2` | `bg-fuchsia text-white` | `hover:bg-fuchsia-bright` + `hover:shadow-[var(--glow-md)]` | `opacity-50 cursor-not-allowed` + `title=<reason>` | "Working…" + spinner |
| Secondary CTA | `rounded-full px-4 py-2` | `border border-line bg-paper text-ink` | `hover:border-fuchsia hover:text-fuchsia-deep` | `opacity-50` + `title=<reason>` | text-only label |
| Ghost | `rounded-full px-4 py-2` | transparent | `hover:border-fuchsia hover:text-ink` | `opacity-50` | text-only |
| Destructive | `rounded-full px-3 py-1.5 border` | transparent | `hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]` | `opacity-50` | "Working…" |
| Locked / Pro | `rounded-full px-4 py-2 border-fuchsia/50` | `bg-fuchsia-soft/30 text-fuchsia-deep` | `hover:bg-fuchsia-soft/50` | n/a (always locked) | n/a |
| Success (transient) | same as primary; 1.2s flash green border, then revert | — | — | — | — |

Every disabled button MUST have a `title={disabledReason}` (PublishModal pattern, shipped v0.7.70).

### 4.5 Card taxonomy

| Card | Pattern |
|---|---|
| Workbench grid card (IG-007) | `.library-card` outer + 4 HUD bracket corners; aspect-9:16 thumb; below-thumb meta only |
| Library card | Same `.library-card` base; clip-style |
| Project card (Lane 3 shipped) | `.library-card` base + type pill + RPM chip (Earn) + status badge + drop target |
| Bounty card (Lane 4 shipped) | distinct earn-deck chrome + RPM + spots-remaining + Start/Resume |
| Reaction tile (Lane 2 — WAIT) | Kimi Reaction owns |
| File card (Project Files grid, Sprint 2 shipped) | aspect-16:10 thumb + title + path + source + Reveal/Move/Remove |

### 4.6 Atmosphere plates (from `BRAND_ATMOSPHERE_QUEUE.md`)

| Plate file (in `desktop/docs/demo-assets/`) | CSS hook | Opacity |
|---|---|---|
| `atmosphere-workspace.png` | `.deck-workspace::before` | 0.18 |
| `atmosphere-library.png` | `.deck-clips::before` | 0.14 |
| `atmosphere-earn.png` | `.deck-earn::before` | 0.20 |
| `atmosphere-schedule.png` | `.deck-schedule::before` | 0.16 |
| `atmosphere-settings.png` | `.deck-settings::before` | 0.10 |
| `state-empty-hero.png` | `<EmptyState>` background plate | per state |
| `state-bake-failed.png` | `<BakeFailedStrip>` background | per state |
| `state-offline.png` | `<OfflineOverlay>` background | per state |
| `state-cmd-k.png` | `<CommandPalette>` backdrop | per state |
| `interaction-drop-target.png` | full-screen `<DropOverlay>` | on drag |
| `interaction-celebration-burst.png` | full-screen `<CelebrationOverlay>` | on first publish |
| `badge-hot-streak.png` | replaces "HOT" text pill on ClipCard | n/a |

**Lane 1 owns the atmosphere CSS hooks + plate drop-ins.** Plates may not exist yet on disk — if missing, Lane 1 mounts the CSS but ships without the image until the asset queue runs.

### 4.7 Icons (no new pixel art; reuse what's there)

- Platform brand glyphs: `desktop/src/components/PlatformIcon.tsx` (mono SVG) — canonical.
- Action icons: `lucide-react` (already used everywhere).
- HUD corners: `library-card-corner-*` CSS (canonical).
- Pixel-art badges in `SideNav` (existing) — preserve.
- No new lucide imports beyond what's already present per `UI_POLISH_AND_LINK_FIX_PLAN` §1.2 (TikTok glyph unification is the only platform-icon change in scope).

---

## 5. Copy rules (apply across all lanes)

### 5.1 Voice

- Talk to the user, never to the developer.
- Active voice. Short sentences. No emoji in UI text.
- "Your clip is ready to export." NOT "Render complete."
- "Add this reaction to your clip." NOT "Apply overlay."
- "Connect your account to unlock payouts." NOT "Auth required."
- "Add your API key in Settings or use Upload." NOT "Provider unavailable."

### 5.2 Five-question test (per surface)

Every page header + empty state must let a cold customer answer:

1. Where am I? → eyebrow + H1
2. What can I do here? → primary CTA + 1-sentence sub
3. What should I click next? → exactly one primary CTA above the fold
4. What is locked and why? → locked surfaces name the tier ("Pro unlocks this — see plans")
5. How do I finish the job? → next-step pointer ("Then schedule it in Schedule → Loadout")

### 5.3 Forbidden copy patterns

- "Sign-in" / "Sign in" as a button label without context (which sign-in flow?). Use "Sign in to Liquid Clips" or "Refresh session."
- "Continue session" (deprecated — use "Refresh session", per UI_POLISH §6 P2).
- "Activate Liquid Clips" (forbidden in AffiliateHero per audit P2).
- "Settings → Connections" (deprecated — use "Schedule → Loadout" or "Schedule → Channels").
- "Reactivate" (forbidden per IG-014 + Sprint 2 V5 confirmed).
- Raw error codes: "RPC failed", "401", "errSecItemNotFound" — wrap in `humanError(e)` and substitute customer-facing language.

---

## 6. Lane assignments

**Five lanes total.** Numbered 1–5. Each lane is a single Kimi build agent's scope.

| Lane | Title | Status | Owner |
|---|---|---|---|
| 1 | SHELL + ONBOARDING | **START NOW** — visual-only, no editor collision | Kimi A |
| 2 | CLIP CARDS + EDITOR | **WAIT FOR KIMI REACTION** — touches editor surfaces | Kimi B (after Reaction done) |
| 3 | PROJECTS | **START NOW** — visual polish on Sprints 1–4 baseline | Kimi C |
| 4 | EARN | **START NOW** — visual polish on v0.7.70 baseline + UI_POLISH P1/P2 items | Kimi D |
| 5 | SETTINGS + PAYWALL + STATES | **START NOW** — Settings, UpgradeLockCard, FirstRun, paywall, empty/loading/error states, social-icon unification, Schedule polish, Community empty | Kimi E |

### 6.1 What "START NOW" means

A lane can start build work immediately when:
- It does not touch any file in the **editor-blocked list** (§7).
- It does not touch any other lane's owned files without coordination (§8).
- It validates against IG-005/006/007/008/011/012/014 per the sub-doc's iron-gate review.
- It runs the three validation gates (`npx tsc -b`, `npm run test:invariant`, `bash scripts/assert-no-passive-keychain.sh`) at every commit boundary.

### 6.2 What "WAIT FOR KIMI REACTION" means

Lane 2 is **blocked** until Daniel confirms Kimi Reaction's editor-wiring fix has shipped. Until then:
- Lane 2's sub-doc may be written and reviewed, but no Lane 2 code touches the blocked files.
- If Lane 5 needs to touch a globally-shared button or empty-state pattern that ClipCard depends on, Lane 5 spec the change WITHOUT modifying ClipCard — Lane 2 inherits the rule when unblocked.

---

## 7. Editor-blocked files (Kimi Reaction's territory)

**No other lane may modify these until Daniel confirms editor wiring is done:**

| File | Why locked |
|---|---|
| `desktop/src/components/clips-feed/ClipCard.tsx` | IG-007 workbench grid card + Kimi editor pass |
| `desktop/src/components/clips-feed/ReactionControls.tsx` | IG-005 + IG-006 single-writer for `clip.overlay` + Kimi editor pass |
| `desktop/src/components/ClipPreview.tsx` | IG-005 keyboard-Enter editor + Kimi pass |
| `desktop/src/components/OverlaySourcePicker.tsx` | Kimi reaction provider wiring |
| `desktop/src/components/clips-feed/ClipsBulkToolbar.tsx` | bake/overlay bulk path |
| `desktop/src/components/clips-feed/InlineScheduler.tsx` | overlay-write path |
| `desktop/src/components/clips-feed/masterClipActions.ts` | bake/reaction action layer |
| `desktop/src/lib/useGlobalBakeEvents.ts` | IG-010 listener |
| `desktop/src/components/cockpit/BottomCockpit.tsx` | IG-005 + IG-006 cockpit (editor-adjacent) |

Lane 1 may touch the **structural shell** that BottomCockpit mounts inside (RoomShell, Cockpit wrapper), but not BottomCockpit itself.

---

## 8. Collision matrix

| File | Lane 1 (Shell) | Lane 2 (Editor) | Lane 3 (Projects) | Lane 4 (Earn) | Lane 5 (Settings/Paywall/States) |
|---|---|---|---|---|---|
| `desktop/src/App.tsx` | **owns** shell + nav routing + atmosphere CSS classes | reads only | reads only | reads only | proposes Settings-tab-open-event listener (Lane 1 lands it) |
| `desktop/src/index.css` | **owns** atmosphere CSS hooks + button taxonomy | — | — | — | proposes empty/loading/error state classes (Lane 1 lands them) |
| `desktop/src/components/nav/SideNav.tsx` + `SideNavItem.tsx` | **owns** | — | — | — | — |
| `desktop/src/components/cockpit/RoomShell.tsx` | **owns** (atmosphere wrapper) | — | — | — | — |
| `desktop/src/components/cockpit/WorkstationRoom.tsx` | **owns** | — | — | — | — |
| `desktop/src/components/Splash.tsx` | **owns** | — | — | — | — |
| `desktop/src/components/FirstRun.tsx` | **owns** intro shell | — | — | — | proposes API-key tab focus (Lane 1 lands it) |
| `desktop/src/components/cockpit/AvatarPanel.tsx` + `AvatarOrbit.tsx` | **owns** notification badge wiring | — | — | — | — |
| `desktop/src/components/Cockpit.tsx` | **owns** (room shell wrapper) | — | — | — | — |
| Project files (`components/projects/*`) | — | — | **owns** | — | — |
| Earn files (`components/earn/*`) | — | — | — | **owns** | — |
| `desktop/src/components/Settings.tsx` | — | — | — | — | **owns** |
| `desktop/src/components/UpgradeLockCard.tsx` | — | — | — | — | **owns** |
| `desktop/src/components/PublishModal.tsx` | — | reads only (editor-adjacent but PublishModal is not locked) | — | — | **owns** visual polish |
| `desktop/src/components/ResultsGrid.tsx` | — | **owns** (when Lane 2 unblocks) | — | — | — |
| `desktop/src/components/FailureCard.tsx` | — | — | — | — | **owns** |
| `desktop/src/components/SidecarCrashOverlay.tsx` | mounted by Lane 1; visual chrome owned by Lane 5 | — | — | — | **owns** visual chrome |
| `desktop/src/components/PlatformIcon.tsx` | — | — | — | — | **owns** (TikTok glyph unify) |
| `desktop/src/components/upload/ClipReadyCard.tsx` | — | — | — | — | **owns** (PlatformGlyph TikTok fallback) |
| `desktop/src/components/CommunityTab.tsx` | — | — | — | — | **owns** (empty hero) |
| `desktop/src/components/schedule/*` | — | — | — | — | **owns** (loadout polish) |
| `desktop/src/components/NotificationBell.tsx` | **owns** mount decision | — | — | — | — |
| `desktop/src/components/auth/AuthPanel.tsx` | locked — sibling-session v0.7.70 work preserved; no lane modifies | — | — | — | — |
| `desktop/src/lib/activation.ts` | locked — IG-004 + sibling session work | — | — | — | — |
| `desktop/src/lib/authStorage.ts` | locked — IG-014 | — | — | — | — |
| `desktop/python-sidecar/*` | **no lane modifies** — IG-002 contract | — | — | — | — |

### 8.1 Shared-file ownership rule

When two lanes both want to change one file:

1. The **OWNER** column in the matrix wins.
2. The non-owning lane proposes the change in its sub-doc under a "Cross-lane request" section.
3. The owning lane reviews the request, lands the change, and notifies the requesting lane.
4. No lane edits another lane's owned file directly.

### 8.2 Cross-cutting CSS contract

`src/index.css` is owned by **Lane 1**. All other lanes use existing classes only; if a new class is needed, Lane 1 lands it. This keeps IG-012 brand-token drift impossible.

---

## 9. Files at collision risk (the watchlist)

These files are touched by more than one lane's proposed work. Each has an explicit owner above; cross-lane proposals go through the owner.

| File | Owner | Reason it's at risk |
|---|---|---|
| `desktop/src/App.tsx` | Lane 1 | Lane 5 needs Settings tab-open + checkout-complete listener; Lane 4 may need Earn route helper |
| `desktop/src/index.css` | Lane 1 | every lane reads tokens; only Lane 1 writes |
| `desktop/src/components/FirstRun.tsx` | Lane 1 | Lane 5 needs API-keys focus on missing-OpenAI-key route |
| `desktop/src/components/SidecarCrashOverlay.tsx` | mount = Lane 1; visual chrome = Lane 5 | dual ownership; Lane 5 lands chrome diff via Lane 1 PR if structural |
| `desktop/src/components/PublishModal.tsx` | Lane 5 visual polish; Lane 2 reads when unblocked | both lanes need to coordinate Publish Deck redesign |
| `desktop/src/components/cockpit/AvatarPanel.tsx`, `AvatarOrbit.tsx` | Lane 1 | Lane 5 may want to change badge copy; route through Lane 1 |

---

## 10. Lane sequencing

### 10.1 Can run in parallel (no shared-file collision today)

- **Lane 1** (Shell + Onboarding) — atmosphere CSS, SideNav badges, Splash polish, FirstRun shell
- **Lane 3** (Projects) — light polish on Sprints 1–4 baseline
- **Lane 4** (Earn) — visual polish on v0.7.70 baseline + UI_POLISH §6 P2 items
- **Lane 5** (Settings + Paywall + States) — Settings reflow, UpgradeLockCard, empty/loading/error states, social-icon unification, Schedule polish, Community empty

These four can run **simultaneously** with the owners-of-owners rule.

### 10.2 Must wait

- **Lane 2** (Clip Cards + Editor) waits for Kimi Reaction's done-signal from Daniel.

### 10.3 Shared-file lane (lane that owns the most shared infrastructure)

**Lane 1** owns:
- `App.tsx` (the navigation root)
- `src/index.css` (all token + atmosphere CSS)
- `RoomShell.tsx`, `Cockpit.tsx`, `WorkstationRoom.tsx` (shell components)
- `SideNav.tsx`, `SideNavItem.tsx` (left rail)
- `Splash.tsx`, `FirstRun.tsx` (cold-launch flow)
- `AvatarPanel.tsx`, `AvatarOrbit.tsx` (top-right HUD)

Lane 1 should ship **first** (or at least the shell + atmosphere CSS first), because the other lanes depend on the button taxonomy, atmosphere CSS, and shared classes Lane 1 introduces.

### 10.4 Recommended order if Daniel wants sequential safety

1. Lane 1 (shell + CSS contracts)
2. Lane 5 (Settings + paywall + states + social-icon unification)
3. Lane 3 (Projects polish)
4. Lane 4 (Earn polish)
5. Lane 2 (Editor — after Kimi Reaction done)

If Daniel wants parallelism: Lanes 1 + 3 + 4 + 5 in parallel, Lane 2 after Kimi.

---

## 11. Validation commands (every lane runs these at every checkpoint)

```bash
cd /Users/dipdip/code/jnr/desktop
npx tsc -b
npm run test:invariant
bash scripts/assert-no-passive-keychain.sh
```

Plus the IG-012 brand-token drift check on any commit that touches `src/index.css` or `docs/demo*.html`:

```bash
bash scripts/brand-kit-drift-check.sh
```

No lane builds Tauri or installs without Daniel's explicit per-batch approval (per memory `[[feedback_build_gate]]`).

---

## 12. Final Daniel hand-walk checklist (master)

Reference for the final integration walk after all 5 lanes ship. Per-lane hand-walks live in the sub-docs.

### 12.1 Cold-customer walk

- [ ] **Cold boot signed-out** → Splash → FirstRun. Activate via browser. Workspace mounts. Atmosphere plate visible behind Workstation tiles (or graceful absence if asset queue not run yet).
- [ ] **Click each sidebar item** in turn. Each surface answers the 5-question test §5.2.
- [ ] **Workspace tile click** → URL paste OR file drop OR drag overlay. New project enters pipeline.
- [ ] **Library** → empty state shows clear next action; populated state shows clip cards with consistent button taxonomy.
- [ ] **Projects** → create blank → Open Workspace → capture → return → auto-attach (Sprint 4 preserved).
- [ ] **Earn** → public bounties load (or "Couldn't load … Retry"); sign in via browser; Earn flips to ready.
- [ ] **Schedule** → Loadout → channel list with consistent row chrome.
- [ ] **Community** → hub opens; per-room flow; **empty hero present if no rooms**.
- [ ] **Settings** → top-level tab list reads as outline; each tab finishes its job in ≤ 2 actions.
- [ ] **Upgrade flow** → click any locked surface's Upgrade CTA → signed-out users go through activate() first, signed-in users open Whop checkout; on return, `lc:checkout-complete` fires and tier refreshes.

### 12.2 Brand consistency walk

- [ ] Every primary CTA is fuchsia pill with consistent hover + glow.
- [ ] Every disabled button has a tooltip explaining why.
- [ ] Every card uses `.library-card` HUD bracket pattern or the project/bounty-card variant.
- [ ] Every empty state has a primary CTA and one helper line.
- [ ] Every loading state uses `animate-pulse` skeleton tiles, not bare spinners (except SidecarCrashOverlay).
- [ ] Every error state uses the same danger banner + Retry pattern.
- [ ] No "Settings → Connections" copy anywhere reachable.
- [ ] No "Reactivate" copy anywhere reachable.
- [ ] No `openAuthPanel("sign-in")` callsite.
- [ ] No `/sign-in?redirect_url=/dashboard` in bundled JS.
- [ ] No raw error strings (`RPC failed`, `errSecItemNotFound`, etc.) shown to the user.

### 12.3 Iron-gate compliance walk

- [ ] IG-005 — ReactionControls is the only writer of `clip.overlay`. Cockpit handoff contract intact.
- [ ] IG-006 — Cockpit handoff four-bucket model preserved.
- [ ] IG-007 — ClipCard outer `<article>` uses only `library-card relative`. No `p-4 gap-3 rounded-2xl flex flex-col` added.
- [ ] IG-008 — RoomShell `overflow-y-auto` + `items-[safe_center]` + per-room `pb-48` clearance intact.
- [ ] IG-011 — `align="stretch"` on Earn RoomShell preserved.
- [ ] IG-012 — `brand-kit-drift-check.sh` passes; all 8 tracked hexes synced.
- [ ] IG-014 — `assert-no-passive-keychain.sh` clean; `test:invariant` 10/10.

---

## 13. What this scope does NOT do

- It does NOT propose 2027-vision features (command palette, AI matching, sync play, time machine). Those are north-star, not the immediate UI upgrade.
- It does NOT redesign Reaction Studio / Assets — Kimi Reaction owns that lane.
- It does NOT redesign Earn product model — sibling session shipped public-bounty architecture at v0.7.70; Lane 4 only polishes on top.
- It does NOT touch sidecar / Python / backend / auth-storage — IG-002 + IG-014 untouched.
- It does NOT create a new design system — uses what's there.
- It does NOT commit, push, tag, release, or update `latest.json`. All build + install gates wait for explicit Daniel approval per memory `[[feedback_build_gate]]`.

---

## 14. Stop condition

Sub-docs deliver implementation contracts for the 5 lanes. Kimi agents build per sub-doc. Daniel hand-walks. This master doc is the integration index; sub-docs are the per-lane spec.

**End of master scope.** Sub-docs follow in `desktop/docs/ui-upgrade/UI_LANE_*.md`.
