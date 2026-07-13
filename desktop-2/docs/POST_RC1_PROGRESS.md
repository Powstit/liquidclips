# Post-RC1 Progress · Liquid Clips

**Base**: tag `rc1-dev-handover-2.2.36` · GitHub SHA `e1794812`
**Working branch**: `codex/post-rc1-launch`
**Living document** — updated on every completion by Codex.

For each completed task: commit · PR · evidence · tests · risks · remaining work · human-review requirement.

---

## Cadence

| Column | Meaning |
|--------|---------|
| Commit | short SHA on `codex/post-rc1-launch` |
| PR | link once opened |
| Evidence | file paths of proof (screenshots, logs, traces) |
| Tests | new spec paths + green run tail |
| Risks | rollback trigger + reversibility |
| Remaining | follow-ups |
| Review needed | `yes` for money/pricing/auth/shell touches, `no` otherwise |

---

## In flight

_(none — L5 foundation shipped; TopHud + WalletDetail copy wire-up is queued as a smaller follow-up commit)_

## Recently completed

### 2026-07-13 · Crew flow Path A · gate contract unit-tested

| Column | Value |
|--------|-------|
| Commit | `4b4746ee` (`feat(crew): extract gate + Path A unit-test proof`) |
| PR | pending open |
| Evidence | 7 unit tests over every branch of `shouldShowCrewOnboarding` (fresh + 3 marker states + all-set + null + precedence) |
| Tests | `desktop-2/src/design-os/routes/crewGate.test.ts` · 7/7 pass · vitest 590/591 pass · +7 vs prior |
| Risks | Refactor split gate out of `WelcomeRoute.tsx`; consumer signature unchanged |
| Remaining | Full welcome-flow integration proof needs OTP harness; scoped separately in `tests/native-walk-prep/` |
| Review needed | no (mechanical extraction + test) |

### 2026-07-13 · Dropbox+emoji ingest customer-blocker · P0 ticket filed

| Column | Value |
|--------|-------|
| Commit | `c5d19b9c` (`docs(post-rc1): file Dropbox+emoji ingest bug as P0 ticket`) |
| PR | pending open |
| Evidence | `desktop-2/docs/POST_RC1_BUG_DROPBOX_EMOJI_INGEST.md` (fix scope + verification + rollback) |
| Tests | pending — spec lands with the sidecar guard PR |
| Risks | Nigerian dev team may need to pair with Codex on the Python-sidecar side |
| Remaining | Actual sidecar path guard + friendly UI toast |
| Review needed | no (ticket scoping only) |

### L5 · Agency six-state cancellation sweep · foundation

**Commits**:
- `00c181b5` · types + adapter + copy + unit tests
- `9025815b` · harness seeders + Playwright spec (6/6 green isolated in 22.9s)

**Evidence**: `docs/ui-master/evidence/l5-six-states/*.png` (six per-state screenshots).

**Follow-up commit queued**: wire `copyForState` into `TopHud` pill + `WalletDetail` state-specific copy so the spec can extend with per-state pill / CTA / toast copy assertions. Small change, single PR, single reviewer pass.

## Prior completed

### L5 · Agency six-state cancellation sweep

**Progress**:
- Plan · `desktop-2/docs/POST_RC1_L5_SIX_STATE_SWEEP_PLAN.md` (`c042c799`)
- **Types + adapter + copy** landed at `00c181b5`:
  - `BillingState` extended with `"trial"` + `"expired"` (additive, safe fall-through for old consumers).
  - `BillingSnapshot` gains `trialEndsAt` + `periodEnd` (ISO-8601).
  - `mapSubscriptionStatus` is now time-aware (`canceled` splits into `cancelled` vs `expired` on periodEnd).
  - New `src/lib/billing/copy.ts` — one canonical `{pillLabel, ctaLabel, ctaToast, heading, body}` per state, exhaustive switch, honours the $99.99/mo Agency price lock (2026-07-06).
  - New `copy.test.ts` — 5 tests, all pass, +5 vs 578 baseline (now 583 total vitest).
  - Gates at `00c181b5`: `tsc -b` GATE_EXIT=0 · vitest 583/584 pass · no regressions.

**Next commit in L5 series**:
- Six harness seeders in `tests/e2e/_auth-harness.ts` (non-admin persona per state).
- `tests/e2e/cancellation-six-states.spec.ts` Playwright spec that walks each state and asserts pill copy + CTA + toast + entitlement outcome.

**Review needed at PR merge**: money-surface copy review pass by Daniel — one file diff (`src/lib/billing/copy.ts`) covers everything visible to the user.

---

## Completed

### 2026-07-13 · P4 · Ship-ready regression report

| Column | Value |
|--------|-------|
| Commit | pending (this edit) |
| PR | none — read-only report |
| Evidence | `desktop-2/docs/POST_RC1_P4_SHIP_READY_REPORT.md` · covers 14 customer journeys, buckets each into foundation-green / launch-ready / mocked / roadmap / blocker |
| Tests | none |
| Risks | none |
| Remaining | (a) Agency six-state sweep is highest-priority next work item; (b) Dropbox+emoji ingest is the one true blocker; (c) Sponsored Reward owning-org signup remains roadmap |
| Review needed | no (report only) |

### 2026-07-13 · P3 · Live installed-app journey (evidence report)

| Column | Value |
|--------|-------|
| Commit | pending (this edit) |
| PR | none — read-only evidence report |
| Evidence | `desktop-2/docs/POST_RC1_P3_LIVE_APP_JOURNEY.md` · 170 projects · 724 clips · ffprobe playback proof · sidecar codesign valid |
| Tests | none (evidence-only report) |
| Risks | none (read-only) |
| Remaining | (a) add `liquidclips://ingest?path=…` deep-link so future P3 can drive fully autonomously; (b) fix Dropbox smart-sync + emoji filename ingest failure (surfaced in `project.json` of `jae5-x-walkz-stream-guest-stream-1`); (c) add clip-lifecycle events (`clip.run`, `export.done`) to `diagnosticLogger` so future evidence is queryable |
| Review needed | no (report only) |

---

## Deferred / escalated

_(none)_
