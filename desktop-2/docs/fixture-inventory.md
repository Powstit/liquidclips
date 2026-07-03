# Fixture Inventory — Step 3 Batch 3A

**Read-only classifier. No runtime changes in this batch.**

Master doc reference: `SELF_ONBOARDING_RELEASE_MASTER.md` §Step 3 — a
new or empty account must render honest `loading | real | empty |
unavailable | error` states. This inventory names every place a
fixture / mock / sample / simulator value can currently reach a
production render path, and classifies each so subsequent batches
(3B–3F) can remove or gate them without guessing.

## Classifier

- **`P` — PRODUCTION FIXTURE** · reaches the shipping shell, invents
  user activity that isn't real. Must be removed or replaced with a
  real fetch + empty/unavailable/error state before Step 3 receipt.
- **`D` — DESIGN-PREVIEW-ONLY** · imported exclusively from orphaned
  `sections/**` (the pre-design-OS surface which the shipping shell
  does NOT mount). Safe to leave in place; will be gated behind a
  compile-time boundary in Batch 3C so it can never accidentally
  reach production if a future refactor re-imports.
- **`T` — TEST-ONLY** · only referenced from `*.test.ts`, `.qa.ts`,
  `tests/**`. Allowed indefinitely per master doc regression boundary.
- **`S` — REQUIRED SYSTEM CATALOGUE** · defines constants that ARE
  the product (platform enum labels, format helpers). Not a fixture in
  the invents-activity sense — kept as-is.

## Reach analysis

Confirmed orphaned (zero import from `src/App.tsx`, `src/shell/`,
`src/design-os/`, `src/main.tsx`, `src/overlays/`):

```
src/sections/**       (all files)
```

Every fixture consumer inside `sections/` is therefore automatically
class **D** because it cannot reach a production render. Batch 3C will
either delete the tree, move it to `_legacy/`, or add a compile-time
boundary via file naming (`.preview.ts`).

## Fixture modules (`src/fixtures/`)

| Module | Class | Production consumers | Notes |
|---|---|---|---|
| `fakeAccount.ts` | **D** | `sections/account/AccountSection.tsx`, `sections/editor/EngineClipGrid.tsx` — both orphaned | Keep; boundary in 3C |
| `fakeBrowse.ts` | **D** | orphaned only | Keep; boundary in 3C |
| `fakeCampaigns.ts` | **P** | `state/browseOverlay.ts`, `components/publish/PublishModal.tsx`, `components/publish/SubmitToWhopModal.tsx`, `components/editor/CampaignContextStrip.tsx` (via type import) — production consumers reach these via App.tsx browser overlay, publish flow | REPLACE in 3F — route through real `SponsoredCampaign` backend rows |
| `fakeChannelHandles.ts` | **P** | `components/publish/PublishModal.tsx` | REPLACE in 3F — read from real `social_channels` rows |
| `fakeChannels.ts` | **P** | `state/publishStore.ts` | REPLACE in 3F — real channels list |
| `fakeClips.ts` | **D** | orphaned | Keep; boundary in 3C |
| `fakeCommunity.ts` | **D** | orphaned | Keep; boundary in 3C |
| `fakeDiagnostics.ts` | **D** | orphaned only | Keep; boundary in 3C |
| `fakeEarn.ts` | **P** | `state/publishStore.ts` (`fakeSubmissions`) | REPLACE in 3F — real submissions from backend `SubmissionsReview` |
| `fakeEditor.tsx` | **S** | Provides `PLATFORMS`, `PLATFORM_KEYS`, `formatTime`, `posterGradient` — platform enum + format helpers, not user-activity | Keep; rename to `platformCatalogue.ts` in 3C to remove the "fake" prefix which is misleading |
| `fakeInbox.ts` | **D** | orphaned only | Keep; boundary in 3C |
| `fakeProjects.ts` | **D** | orphaned only | Keep; boundary in 3C |
| `fakeSchedule.ts` | **P** | `state/publishStore.ts` (`fakeSchedule`) | REPLACE in 3F — read from real `schedules` rows |
| `sampleCampaigns.ts` | **P** | `state/browseOverlay.ts` | REPLACE in 3F — kill external CDN URLs (violates brand-asset rule) |

## Non-fixtures-dir production issues

| File:line | Class | Issue | Fix in |
|---|---|---|---|
| `design-os/state/useTierCaps.ts:220` | **P** | `SIMULATOR_DEFAULT_TIER: Tier = "pro"` fallback silently grants Pro caps when `/me` hasn't returned — a fresh install + backend outage would unlock Pro features | Batch 3D — convert to `unavailable` state; gates read `source === "unavailable"` and close |
| `design-os/state/useTierCaps.ts:211` | **P** | `DEFAULT_USAGE` fabricates `connectedChannels: 4, scheduledThisMonth: 42` for a brand-new account | Batch 3D — read from `/me` real values; empty state renders zeros |
| `overlays/invaders/SplashLeaderboard.tsx:15` | **P** | `import { MOCK_AGENCIES, MOCK_CLIPPERS } from "./mockLeaderboard"` — arcade leaderboard renders fake winners on first launch | Batch 3E — add backend `GET /leaderboard/arcade` route → top-N by `arcade_high_score` DESC (index already exists at `main.py:542`); swap import to live fetch + skeleton + honest empty state ("First to 1000 wins Founder tier") |
| `overlays/invaders/SplashHud.tsx:10` | **P** | `import { MOCK_COUNTERS from "./mockLeaderboard"` — HUD stats invented | Batch 3E — extend `/leaderboard/arcade` response with real counter aggregates |
| `overlays/invaders/mockLeaderboard.ts` | **P** | Fixture data file itself | Batch 3E — gate behind `import.meta.env.DEV && !VITE_LC_QA` OR rename to `mockLeaderboard.preview.ts` so scanner catches production imports |

## Not touched by Step 3

- `state/browseOverlay.ts` also imports `sampleCampaigns` (`fakeCampaigns` too). Batch 3F handles both together.
- `components/paywall/PaywallGate.tsx`, `AgencyPreviewBanner.tsx` — the prior grep flagged them for the string "sample" but on read they don't import any fixtures. Confirmed clean.
- `lib/wallet.ts`, `lib/announcements.ts`, `lib/healthCheck.ts`, `lib/qa.ts`, `lib/carrot.ts` — string "fake" appears only in comments or qa-only paths. Clean.

## Batch 3B — production scanner

Following the master doc's "add a scanner that fails when prohibited
fixture imports reach a production entry point," Batch 3B ships:

```
scripts/production-fixture-scan.sh
```

Walks the reachable graph from `src/main.tsx` → `src/App.tsx` → every
component imported transitively. Any import of a `.preview.ts`, a file
containing `MOCK_*`, or an unrenamed fixture module fails the scan
with a non-zero exit + the offending file:line. Wired into
`npm run guard` in a follow-up so CI catches drift before merge.

## Required assertions coverage (from master doc)

| Assertion | Landed by |
|---|---|
| `production_fixture_scan_zero` | Batch 3B (scanner) + Batches 3D/3E/3F (removals) |
| `simulator_is_test_only` | Batch 3D (SIMULATOR_DEFAULT_TIER moves behind QA hatch) |
| `unknown_state_fail_closed` | Batch 3D (`useTierCaps` returns `unavailable` when `/me` missing; gates close) |
| `zero_dummy_rows` | Batch 3E (arcade) + 3F (campaigns / channels / schedule) — verified by a fresh SQLite session under playwright with no seeded rows |

## Regression boundary (from master doc)

- Tests may still install fixtures explicitly — file boundary + naming
  enforce this at import time, tests get an explicit escape hatch.
- Empty-state routes mount without crashes — verified in 3D-3F by
  removing fixture return paths and adding empty renders.
- Paid/Agency writes cannot unlock from missing/degraded `/me` —
  verified in 3D by replacing `SIMULATOR_DEFAULT_TIER` with
  `unavailable`, which closes every gate.

## No runtime changes in this batch

This document is the batch 3A artifact. Zero code moved. Zero tests
touched. Every removal / rename / new endpoint is scoped to a later
batch with its own commit + rollback boundary.

Next: batch 3B ships the scanner so all subsequent batches can prove
they didn't regress; batches 3D → 3E → 3F remove the production
fixtures in order of blast radius (tier default first because it's
the widest reach).
