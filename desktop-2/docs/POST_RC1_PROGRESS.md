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

### 2026-07-14 · BLOCK 5 follow-ups · both cleared

| Column | Value |
|--------|-------|
| Commits | `2770b1e9` (a11y sidebar aria-label) · `16c8d374` (harness catch-all + audit filter correction) |
| PR | rolled up into #9 |
| Evidence | 17/17 regression (BLOCK 5 + L5) green in 1.1 min |
| Tests | isolated Playwright combined sweep · tsc 0 · vitest 613/614 · no change |
| Risks | none — landmark naming + test hygiene only |
| Remaining | none from BLOCK 5 queue |
| Review needed | no |

### BLOCK 5 · Visual customer-path audit · shipped

| Column | Value |
|--------|-------|
| Commit | `d0a9c3d7` (`test(block5): 11-surface visual customer-path audit · 11/11 green`) |
| PR | pending open |
| Evidence | `desktop-2/docs/POST_RC1_BLOCK5_AUDIT.md` · `desktop-2/tests/e2e/block5-visual-audit.spec.ts` · 11 screenshots in `docs/ui-master/evidence/block5-audit/` |
| Tests | 11/11 pass isolated in 48.0s |
| Risks | none (audit-only, no customer surface change) |
| Remaining | 2 non-blocking follow-ups: harness 503 mocks (P3) + Design-OS sidebar aria-label (P2) |
| Review needed | no (audit report + evidence only) |

### HQ integration foundation · 9 of 10 event categories live

**Additional commits since last progress checkpoint**:
- `55f8b723` · category **processing.failed** live · ingest (drop) + transcribe (URL)
- `423401b3` · category **support.request** live · Support-nav click
- `5bfd0284` · category **payment.mismatch** live · billing status drift catch
- `70a54e1b` · category **diagnostic.bundle** generator + unit tests (`diagnosticBundle.ts` · +4 tests)
- `8e54cf1d` · Settings > Support > "Copy diagnostics" appends the redacted bundle JSON to the customer paste

**Deferred**:
- `feature.request` category — needs a new user-facing surface (feature-request button/form) which is a product-intent decision. Escalate to Daniel before UI drafting.

**Full cadence**: 9/10 HQ categories flowing with real code paths + a user-reachable trigger. Nigerian dev team can now pair on the backend `/lcos/events/ingest` schema versioning to complete the round-trip.

### Original progress

**Progress**:
- `1bbe5cb4` · canonical event schema (`hqEvents.ts`) + 10 unit tests
- `38cd1bca` · `install_id` bootstrap (`installId.ts`) + 4 unit tests
- `690408de` · `emitHqEvent` bridge (`hqEmit.ts`) + 5 unit tests
- `d570111d` · category **app.health** live · `app.boot` on every launch
- `f69aa51a` · category **app.crash** live · every `EngineErrorBoundary` catch
- `33f73b34` · category **auth.failed** live · every `authedFetch` 401
- `33765a0b` · category **update.health** live · `update.staged` + `update.failed`
- `d0321ed7` · category **action.failed** live · every `useAuditableAction` throw (covers all `_CRITICAL_JOURNEYS`)

**HQ event categories flowing** (5 of 10 planned):
- app.health ✓ | app.crash ✓ | action.failed ✓ | auth.failed ✓ | update.health ✓
- processing.failed · support.request · feature.request · payment.mismatch · diagnostic.bundle (pending)

**Every envelope carries**: `install_id` + `session_id` + `correlation_id` + `runtime_version` + `app_version` + `app_arch` + `schema_version=1` + sanitized data. **NEVER** raw email · JWT · captions · video · file bytes.

**Golden rule preserved**: HQ is fire-and-forget in every call-site. A hqEmit failure never impedes the underlying flow (dynamic-import `.catch()` swallowing).

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
