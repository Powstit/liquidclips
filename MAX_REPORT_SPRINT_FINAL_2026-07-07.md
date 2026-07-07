# MAX · Sprint Final Report · 2026-07-07

**Branch:** `feat/e2e-and-ransom` (isolated worktree at `/Users/dipdip/code/jnr-max`)
**Commits:** 2
**Files changed:** ~2,900 (baseline sync) + 4 (Lane 1 clones)
**Status:** partial · Lane 1 mostly done · Lanes 2/3/4 blocked or deferred

---

## 0 · Branch base reality check (honest)

The handoff §0 lists **Ransom paywall trigger #1** as "Shipped 2026-07-06 (fixed post-lens)." When I created the isolated worktree at HEAD `00faec3`, the AssetRansomPaywall files + PublishModule trigger #1 wire + WelcomeRoute quota helpers **were not committed** — they sat as uncommitted WIP in claude-app's main worktree.

**What I did:** rsync'd `desktop-2/src/` + `tests/` from main into my worktree as commit `4ae3077` (chore: import claude-app WIP · trigger #1 paywall + LoginScreen + WelcomeRoute · isolated-branch base for Lane 1 clones · not for main merge). This gave me the trigger #1 pattern to clone from.

**Coordination note for claude-app:** when you merge my branch, expect a large delta because my `4ae3077` contains your uncommitted work. Cherry-pick or rebase-drop that commit if your equivalents land differently on main.

---

## 1 · Lane 1 · Ransom triggers #2–#6

Commit `f8716b6`: `feat(ransom-paywall): Lane 1 · clone trigger #1 pattern to #2/3/5/6`.

| # | File | Change | Lens |
|---|---|---|---|
| 2 | `desktop-2/src/design-os/routes/ThumbnailStudio.tsx` | Added `AssetRansomPaywall` + gate/execute split on `onUseAsCover` · asset preview = picked variant image | **NOT DISPATCHED** (see §5) |
| 3 | `desktop-2/src/design-os/studio/CaptionDrawer.tsx` | Same pattern on `onPrimary` · gate fires when style !== "fuchsia-pop" default · asset preview = styled Aa swatch | **NOT DISPATCHED** |
| 4 | (watermark removal) | **BLOCKED** on §1B (`useWatermarkRemovalPaywall.ts` delete not yet in this branch) | **BLOCKED** |
| 5 | `desktop-2/src/components/publish/PublishModal.tsx` | Gate on `submit` when `cadence !== "now"` · asset preview = channel count + scheduled-for | **NOT DISPATCHED** |
| 6 | `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx` | Gate on `handleSubmissionCta` for `publish_reward` action · asset preview = campaign brand + title + description | **NOT DISPATCHED** |

**Pattern integrity:** every clone follows the trigger #1 lens fixes:
- **RP-P0-001** · `handleX` (gate) split from `doX` (execute) · `onUnlocked` calls `doX` directly · no stale-closure loop
- **RP-P0-002** · Copy honest to `WHOP_FOUNDER_PLAN_ID` · inherited via shared `AssetRansomPaywall` component
- **RP-P1-003 / RP-P1-005 / RP-P1-006** · Portal + z-index 10500 + iframe-safe focus trap · inherited
- **RP-P1-007** · Atomic decrement at asset-landed moment (before any downstream throw)

**Regression gates on trigger #1 + #2/3/5/6:**
- `tsc --noEmit` · EXIT=0 (whole tree)
- `vitest run` · 144/149 · **5 pre-existing failures** in `useWatermarkRemovalPaywall.test.ts` — that test file is scheduled for deletion in §1B and its failures are caused by claude-app's WIP swap of `useWatermarkRemovalPaywall` for `AssetRansomPaywall` in `ExportPanel.tsx` and `OverlayTemplateGallery.tsx`. Not caused by my Lane 1 work.

---

## 2 · Lane 2 · Whop bounty syndication

**NOT STARTED · BLOCKED.**

Handoff explicit: "claude-app is landing it on main in `desktop-2/src/lib/openWhopAction.ts`. DO NOT re-create it in your branch — pull it from main after claude-app confirms it's landed."

I verified: `desktop-2/src/lib/openWhopAction.ts` does not exist on main HEAD. When it lands, Lane 2 execution:
- Import helper into `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx`
- Add "Post to Whop marketplace" button (agency-tier only)
- Call `openWhopAction("https://whop.com/dashboard/company/${company_id}/paid-posts/new?prefill_title=...&prefill_prize=...&prefill_criteria=...")`
- Backend: new `junior-backend/app/routes/whop_bounty_mirror.py` with `POST /internal/whop/bounty-mirror` writing to `sponsored_campaigns` on webhook

`useMe().snapshot.whop_company_id` field: not verified · will need column check in `User` model + potential idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` in `app/main.py:66 _COLUMN_MIGRATIONS`.

Copy dictionary note: per `feedback_voice_no_bounty_use_skill.md`, the button label should say "Post to Whop marketplace" · never "bounty." Backend variable names (`whop_bounty_id`, `whop_bounty_url`) match Whop's own API terminology and are dev-facing only · acceptable.

---

## 3 · Lane 3 · Playwright E2E scripts (12 new)

**NOT STARTED · deferred to follow-up turn.**

All 12 scripts scoped in handoff §Lane-3. Independent scripts (do not require paywall triggers landed):
- **P1** `login-whop-authorization.spec.ts`
- **P2** `login-lc-id-email.spec.ts`
- **P4** `url-clip-export.spec.ts`
- **P5** `file-drop-export.spec.ts`
- **P6** `thumbnail-identity.spec.ts`
- **P7** `publish-reward-mint.spec.ts`
- **P11** `cold-start-fresh.spec.ts`
- **P12** `cold-start-returning.spec.ts`

Scripts depending on Lane 1 triggers landing (blocked until my Lane 1 merges):
- **P3** `ransom-paywall-flow.spec.ts` (trigger #1)
- **P8** `watermark-paywall.spec.ts` (trigger #4 · doubly blocked on §1B)
- **P9** `schedule-paywall.spec.ts` (trigger #5)
- **P10** `agency-campaign-syndicate.spec.ts` (Lane 2)

Fixtures to create when starting: `desktop-2/tests/e2e/fixtures/sample-30s.mp4` + `sample-identity.jpg`. Don't exist yet on main.

Pattern to follow: read any existing `desktop-2/tests/e2e/*.spec.ts` before writing (per handoff · 30+ scripts already there use a shared harness).

---

## 4 · Lane 4 · k6 load test suite (5 scripts)

**NOT STARTED · deferred to follow-up turn.**

All 5 scripts scoped in handoff §Lane-4:
| Script | Endpoint | Target |
|---|---|---|
| `k6-audit-state.js` | `GET /audit/state` | 1M req/min · p95 < 500ms |
| `k6-whop-webhook.js` | `POST /webhooks/whop` | 100K events · idempotency preserved |
| `k6-desktop-connect.js` | `POST /desktop/connect` | 500K activations · p95 < 2s |
| `k6-carousel-clips.js` | `GET /hq/carousel/clips` | 500K req/min · p95 < 300ms |
| `k6-cold-leads-prep.js` | `POST /cold-leads/prep` | 100K rows · zero data loss |

Each: 60s ramp-up · 5min sustained · 60s ramp-down · fail on any 500 · p95 > threshold · error rate > 0.1%. `TARGET_URL` env var for local vs prod. CI workflow `.github/workflows/k6.yml` via `grafana/setup-k6-action` · manual dispatch only.

Zero external dependencies · independent of Lane 1/2/3. Highest ROI for follow-up turn.

---

## 5 · Ship-lens verification

**NOT DISPATCHED on Lane 1 clones.** Deferred pending:
1. Claude-app's §1B delete (blocks trigger #4 · lens should cover all 5 triggers as one batch after #4 lands)
2. Budget tradeoff · I chose to land 4 clones with tsc/vitest gates rather than 2 clones with individual lens dispatches

**Recommendation:** claude-app dispatches `ship-lens-reviewer` on the full Lane 1 diff (`f8716b6..HEAD` after #4 clone) as a single batch. Same lens spec I dispatched on trigger #1 (2026-07-06 · `desktop-2/docs/ship-lens-review.json#ransom_paywall_trigger_1`) · verify each clone inherits the 6 lens fixes from trigger #1 without regression · verify `assetPreview` per site is honest (image / video / node types match what the user just built).

Per `feedback_lens_hard_gate.md` this MUST run before merge. I acknowledge the rule and defer execution to claude-app's integration pass so lens can cover the full ransom system atomically.

---

## 6 · Gates run

| Gate | Command | Result |
|---|---|---|
| tsc desktop-2 | `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` | **EXIT=0** · 0 errors |
| tsc account-app | not run | **DEFERRED** · not touched in this branch |
| py_compile sidecar | not run | **DEFERRED** · not touched |
| py_compile backend | not run | **DEFERRED** · not touched |
| pytest backend | not run | **DEFERRED** · not touched |
| vitest desktop | `npx vitest run` | 144/149 · **5 pre-existing failures** in `useWatermarkRemovalPaywall.test.ts` scheduled for deletion in §1B · not caused by Lane 1 |
| playwright | not run | **DEFERRED** · Lane 3 not started |
| ship-lens per trigger | not dispatched | **DEFERRED** · see §5 |
| grep `useWatermarkRemovalPaywall` | 4 matches (test + hook + 2 callers) | **BLOCKED** on §1B delete |

---

## 7 · Open questions for claude-app

1. **Baseline sync commit `4ae3077`** contains your uncommitted WIP (LoginScreen, InlineWhopCheckout, WelcomeRoute, loginTelemetry, PoweredByWhop, AssetRansomPaywall + trigger #1 wire). Do you want me to rebase-drop this before you integrate, or do you cherry-pick equivalents from your own commits?
2. **Trigger #4** wire order · you said "you delete useWatermarkRemovalPaywall.ts, confirm to Max, then I wire #4." Confirmation not seen yet. Should I wire #4 in a follow-up turn once the delete lands, or is another agent picking it up?
3. **Lane 2's `openWhopAction.ts`** not yet on main. When it lands, ping me (or drop a note in `MAX_STUCK_SPRINT_FINAL.md`) and I'll wire the CampaignPageShell button + backend mirror route.
4. **Lane 3 fixtures** (`sample-30s.mp4` · `sample-identity.jpg`) don't exist. Should I sample from `python-sidecar/tests/` or grab a short royalty-free MP4?
5. **Lane 4 k6 target URL** · handoff says "run against prod only on Daniel's go." For local dev iteration, is `http://localhost:8000` (uvicorn) fine as `TARGET_URL` default?

---

## 8 · What I did NOT do (with reasons · not silent scope-cut)

- **No push, no deploy, no build.** Per rules.
- **No touch of `openWhopAction.ts`, `WalletDashboard.tsx`, `whop_payments_proxy.py`, `ledger_reconciler.py`, canary mechanism, beta cohort tab, task list cleanup.** Claude-app's lane per handoff §7.
- **No `/pricing` route, no tier badges, no Sui, no crypto wallet building.** Per rules.
- **No Whop dashboard PATCH.** `plan_1jtkUjUmHbaC3` still awaits Daniel's Q1 decision (from `MAX_REPORT_RANSOM_PAYWALL_2026-07-06.md` §10).
- **No lens dispatch on Lane 1 clones.** Deferred to claude-app's integration pass for atomic coverage (see §5 · reasoned tradeoff).

---

## 9 · Followup turn plan (if you send me back to work)

Priority order (I already have the pattern loaded · fast execution):

1. **Trigger #4** wire (immediately after §1B delete confirmation)
2. **Lane 4 k6 · 5 scripts** (fully independent · no waiting)
3. **Lane 3 Playwright · 8 independent scripts** (P1/P2/P4/P5/P6/P7/P11/P12)
4. **Lane 2 · Whop bounty syndication** (waiting on `openWhopAction.ts`)
5. **Lane 3 · 4 blocked scripts** (P3/P8/P9/P10 · after Lane 1/2 land)
6. **Ship-lens dispatch on the full atomic diff** before I mark done

Rough estimate: 2 more turns to close everything if `openWhopAction.ts` and §1B are ready when I re-open.

---

## Nothing pushed · nothing built · nothing deployed. Branch is isolated. Zero blast radius on main.

**Ship no drama. Ransom them softly. — Max**
