# MAX · Sprint Final Handoff · 2026-07-07

> **You're Max.** App-side parallel Claude. Same seat as your prior "Claude 1" work.
> Read `~/.claude/projects/-Users-dipdip/memory/agent_roster.md` for context on the naming.

**From:** claude-app
**Priority:** SHIP-CRITICAL · this is the final sprint before Daniel opens public cold-traffic to 1,000,000 users.
**Locked source of truth:** `/Users/dipdip/code/jnr/SPRINT_FINAL_2026-07-07.md` — **DO NOT DEVIATE.** If something is missing, edit that doc first, then execute.

---

## 1 · Your branch (isolated · your playground)

```bash
git checkout main
git pull
git checkout -b feat/e2e-and-ransom
```

**Do NOT push, do NOT merge, do NOT touch main.** claude-app is on main handling parallel lanes. When you finish everything, drop a report at `MAX_REPORT_SPRINT_FINAL_2026-07-07.md` at repo root. claude-app pulls your branch, re-runs every gate, ship-lenses the integration points, then merges.

If you screw up: your branch. Zero blast radius on production. That's the point.

---

## 2 · Your 4 lanes (execute in this order)

### Lane 1 · Ransom paywall triggers #2 → #6 (SPRINT_FINAL §1A)

Clone the fixed trigger #1 pattern (`PublishModule.tsx` · already lens-fixed and merged to main by you 2026-07-06) to 5 more sites. Same `<AssetRansomPaywall>` component. Same `handlePublishClick` gate / `publishNow` execute split. Same `onUnlocked` bypass.

| # | Site | File to edit | Deflect condition |
|---|---|---|---|
| 2 | Thumbnail Studio download | `desktop-2/src/design-os/thumbnail/ThumbnailVariantGallery.tsx` (or the download handler in `ThumbnailStudio.tsx`) | `tier === "clipper" && isGuestQuotaExhausted()` |
| 3 | Custom-caption export | `desktop-2/src/design-os/studio/CaptionDrawer.tsx` — `onPrimary` handler | `tier === "clipper" && caption.style !== "default"` |
| 4 | Watermark removal | (see BLOCKER below) | `tier === "clipper" && watermark_off_requested` |
| 5 | Schedule confirm | `desktop-2/src/sections/schedule/*` or `PublishModal.tsx` when cadence !== "now" | `tier === "clipper" && cadence !== "now"` |
| 6 | Earn campaign publish | `desktop-2/src/design-os/campaigns/CampaignPageShell.tsx` (or wherever `handlePublishReward` lives) | `tier === "clipper" && action === "publish_reward"` |

**BLOCKER on #4:** `desktop-2/src/lib/useWatermarkRemovalPaywall.ts` already exists and routes to Whop. Daniel's directive: TWO paywalls for the same feature = ship regression. claude-app is deleting that file on main BEFORE you clone #4. Wait for the deletion notification before wiring #4. Order: #2, #3, #5, #6 first · then #4 last.

**Copy dictionary (locked · from your prior handoff):**
- #2: "Your thumbnail is ready." · "Download it + generate unlimited thumbs."
- #3: "Your styled captions are ready." · "Ship this look on every clip."
- #4: "Your clean export is ready." · "Lose the corner logo forever."
- #5: "Your post is queued." · "Confirm to lock the time. Cancel anytime."
- #6: "Your paid post is ready to ship." · "Publish + start earning · 50% MRR line stays yours."

Shared feature manifest at the bottom (all 5): `watermark off · unlimited clips · thumbnail studio · custom captions · schedule · earn campaigns`

**Confirm plan pair before you code:** `WHOP_FOUNDER_PLAN_ID` = `plan_NMKvKj8SVVKsY` ($99.99/mo, ransom paywall mount, already correct in your trigger #1). Gate 1 (LoginScreen) uses `WHOP_AUTHORIZATION_PLAN_ID` = `plan_SMaXhQLXpSOaH` ($1 one_time · card required · claude-app already wired in `whopCheckout.ts:81`). Your ransom paywall keeps mounting `WHOP_FOUNDER_PLAN_ID`. Do not change.

---

### Lane 2 · Whop bounty syndication (SPRINT_FINAL §1C)

Locked pattern: `openWhopAction()` helper. claude-app is landing it on main in `desktop-2/src/lib/openWhopAction.ts`. **DO NOT re-create it in your branch — pull it from main after claude-app confirms it's landed.**

Once available, wire it into the Agency Campaigns page:
- Add a "Post to Whop marketplace" button on `CampaignPageShell.tsx` (agency-tier only)
- On click: `openWhopAction("https://whop.com/dashboard/company/${company_id}/bounties/new?prefill_title=${title}&prefill_prize=${prize_cents / 100}&prefill_criteria=${encodeURIComponent(criteria)}", { title: "Post to Whop" })`
- Company ID comes from `useMe().snapshot.whop_company_id` (add the field if not there — check first)
- Listen to `bounty_created` webhook in `junior-backend/app/routes/webhooks_whop.py` — when it arrives with a `metadata.liquid_clips_source_campaign_id` field, mirror to our `sponsored_campaigns` table with the Whop bounty URL

New backend route: `junior-backend/app/routes/whop_bounty_mirror.py`:
- `POST /internal/whop/bounty-mirror` — called by the webhook handler when `bounty_created` fires
- Payload: `{ whop_bounty_id, whop_bounty_url, source_campaign_id, prize_cents, expires_at }`
- Writes to `sponsored_campaigns` table (may need column adds — check + migrate if needed via idempotent `ALTER TABLE users ADD COLUMN IF NOT EXISTS` pattern at `app/main.py:66 _COLUMN_MIGRATIONS`)

---

### Lane 3 · Playwright E2E scripts (SPRINT_FINAL §1H · 12 new specs)

Extends existing `desktop-2/tests/e2e/*.spec.ts` folder. There are already 30+ specs there — read a couple to learn the pattern before writing yours. Use the same `test:user-lens` command.

| # | Script filename | Assertion |
|---|---|---|
| P1 | `tests/e2e/login-whop-authorization.spec.ts` | Card entered → `POST /desktop/connect-from-checkout` webhook simulated → `whop_authorized_at` set → app shell mounts |
| P2 | `tests/e2e/login-lc-id-email.spec.ts` | Checkout success → Resend called (mock the fetch) → LC-ID paste flow unlocks |
| P3 | `tests/e2e/ransom-paywall-flow.spec.ts` | Free user hits export at clip 11 → paywall opens → confirm → `me.reload()` → tier=agency → clip 11 exports |
| P4 | `tests/e2e/url-clip-export.spec.ts` | Paste YouTube URL → mock sidecar `start_ingest_url` + `run_stage` chain → clips render → export → MP4 hardlinked into `exports/` |
| P5 | `tests/e2e/file-drop-export.spec.ts` | Fire `source:drop` bus event with a fixture MP4 path → `GlobalDropConsumer` triggers `sidecar.startRun` → clips render → export → MP4 on disk |
| P6 | `tests/e2e/thumbnail-identity.spec.ts` | Upload photo File → `invoke("stash_upload", ...)` → returns disk path → `saveIdentity` called with that path → thumbnails generate |
| P7 | `tests/e2e/publish-reward-mint.spec.ts` | Publish → `/me/reward-clips` fetched → new row visible |
| P8 | `tests/e2e/watermark-paywall.spec.ts` | Free user toggles watermark off → paywall fires → confirm → `runExportAndMint` with `include_watermark: false` |
| P9 | `tests/e2e/schedule-paywall.spec.ts` | Free user schedules → paywall → confirm → schedule row lands + native notification API called (mock it) |
| P10 | `tests/e2e/agency-campaign-syndicate.spec.ts` | Agency creates campaign → `openWhopAction` fires with correct URL → mock the `bounty_created` webhook → `sponsored_campaigns` row appears |
| P11 | `tests/e2e/cold-start-fresh.spec.ts` | No JWT in localStorage → LoginScreen mounts within 3000ms of app start |
| P12 | `tests/e2e/cold-start-returning.spec.ts` | JWT + `whop_authorized_at` present → skip LoginScreen → app shell mounts within 2000ms |

**Fixtures you'll need:** create `desktop-2/tests/e2e/fixtures/`:
- `sample-30s.mp4` (30-second test video · use any short royalty-free clip)
- `sample-identity.jpg` (test photo for thumbnail identity)

**Mock strategy:** for external services (Whop, Resend, sidecar), stub the network layer at Playwright's route interception level. Don't run a real backend for these tests — they gate on the frontend behavior. Backend contract tests are separate (Lane 4).

**All 12 pass in CI = every journey Daniel cares about is proven. No manual walkthrough ever again.**

---

### Lane 4 · k6 load test suite (SPRINT_FINAL §1F · 5 scripts)

New: `junior-backend/tests/k6/` directory. One file per critical endpoint:

| Script | Endpoint | Load target |
|---|---|---|
| `k6-audit-state.js` | `GET /audit/state` | 1M req/min for 5 min · p95 < 500ms · zero 500s · error rate < 0.1% |
| `k6-whop-webhook.js` | `POST /webhooks/whop` | 100K events over 5 min · zero dropped · idempotency preserved (external_id dedup) |
| `k6-desktop-connect.js` | `POST /desktop/connect` | 500K activations · zero JWT-issuance failures · p95 < 2s |
| `k6-carousel-clips.js` | `GET /hq/carousel/clips` | Public endpoint · 500K req/min · p95 < 300ms |
| `k6-cold-leads-prep.js` | `POST /cold-leads/prep` | HQ bulk upload · 100K rows in 5 min · zero data loss |

Each script:
- Uses `import http from 'k6/http'` + `check()` for pass/fail assertions
- Ramps: 60s ramp-up · 5min sustained · 60s ramp-down
- Fails hard on: any 500-level response · p95 > threshold · error rate > 0.1%
- Runs against `https://junior-backend-production.up.railway.app` (production is where scale is provable) BUT ONLY on Daniel's explicit go — pushing 1M req/min to prod without warning would trip Railway's rate limits. Include a `TARGET_URL` env var so tests can point at local uvicorn during dev.

Wire k6 into CI: add a workflow file at `.github/workflows/k6.yml` using `grafana/setup-k6-action`. Manual dispatch only (not per-commit — too expensive). Reference: `shopware/k6-shopware` on GitHub.

**Payload authenticity:** each k6 script uses realistic bodies (real Whop webhook shapes, real activation payloads). Not synthetic garbage. Copy the fixtures from `desktop-2/tests/e2e/fixtures/` or from `python-sidecar/tests/` where they exist.

---

## 3 · Verification gates (MANDATORY before you report done)

Run ALL of these in your branch before writing `MAX_REPORT_SPRINT_FINAL_2026-07-07.md`:

| Gate | Command | Pass criteria |
|---|---|---|
| tsc desktop-2 | `cd desktop-2 && ./node_modules/.bin/tsc --noEmit` | 0 errors |
| tsc account-app | `cd account-app && npx tsc --noEmit` | 0 errors |
| py_compile sidecar | `python3 -m py_compile python-sidecar/*.py` | OK |
| py_compile backend | `python3 -m py_compile junior-backend/app/routes/*.py junior-backend/app/*.py` | OK |
| pytest backend | `cd junior-backend && .venv/bin/pytest tests/ -q` | All green |
| vitest desktop | `cd desktop-2 && npm run test` | 149+ tests all green |
| playwright | `cd desktop-2 && npm run test:user-lens` | 42+ specs (30 existing + your 12 new) all green |
| **ship-lens on every trigger clone** | dispatch `ship-lens-reviewer` agent per site | SHIP verdict on each. Non-negotiable per `feedback_lens_hard_gate.md` memory. |
| **ship-lens on Playwright suite** | dispatch on the new spec files as a batch | SHIP verdict |
| **ship-lens on k6 suite** | dispatch on the new k6 files | SHIP verdict |
| grep sanity | `grep -rn 'useWatermarkRemovalPaywall' desktop-2/src` | ZERO matches (deleted) |

If ANY gate red: fix it. Do NOT report done until all green.

---

## 4 · Report format (paste into `MAX_REPORT_SPRINT_FINAL_2026-07-07.md`)

```markdown
# MAX · Sprint Final Report · 2026-07-07

**Branch:** feat/e2e-and-ransom
**Commits:** [count]
**Files changed:** [count]

## Lane 1 · Ransom triggers #2-#6

| # | File | Lines | Ship-lens |
|---|---|---|---|
| 2 | ThumbnailStudio.tsx | :X-Y | SHIP |
| 3 | CaptionDrawer.tsx | :X-Y | SHIP |
| 4 | WatermarkToggle | :X-Y | SHIP |
| 5 | Schedule.tsx | :X-Y | SHIP |
| 6 | CampaignPageShell.tsx | :X-Y | SHIP |

## Lane 2 · Whop bounty syndication

- Frontend button: [file:line]
- Backend mirror route: [file:line]
- Webhook handler updates: [file:line]

## Lane 3 · Playwright E2E (12 new specs)

| # | Script | Assertion outcome |
|---|---|---|
| P1 | login-whop-authorization | PASS |
| ... | ... | ... |

## Lane 4 · k6 load tests

| Script | Target | Result |
|---|---|---|
| k6-audit-state | 1M req/min | p95=Xms · 0 errors |
| ... | ... | ... |

## Gates

- tsc desktop-2: 0 errors
- tsc account-app: 0 errors
- py_compile: OK all files
- pytest: X/X green
- vitest: 149/149 green
- playwright: 42/42 green
- ship-lens: SHIP on all findings

## Open questions for Daniel / claude-app

- [any judgment calls or blocked items]

## Nothing pushed · nothing built · nothing deployed.
```

---

## 5 · Rules (hard · non-negotiable)

Per repo memory + past feedback:

- **Ship-lens after every finding.** Not once at the end. Every finding, immediate lens.
- **Ask self first before pinging Daniel or claude-app.** Check credentials at `~/.claude-credentials/`, memory graph, repo grep, and the Sprint Final doc BEFORE surfacing a question. Only escalate physical-device / decision-only blockers.
- **Voice: no "bounty."** Use skill / clip job / paid post. Per memory `feedback_voice_no_bounty_use_skill.md`.
- **No new features.** If you notice something missing, ADD it to `SPRINT_FINAL_2026-07-07.md` in a new §, then execute. Don't silently expand scope.
- **No `/pricing` page.** No tier badges. No middle-tier UI. Per memory `liquid_clips_pricing_pivot_2026-07-06.md`.
- **No Sui.** No Shinami. No crypto wallet building. Whop handles payouts. Per Daniel's 2026-07-07 decision.
- **`openWhopAction()` for ALL Whop-side pages.** Don't attempt iframes. Auto-route into `browse.rs` persistent-cookie webview. Per SPRINT_FINAL §5.7.
- **No push, no deploy, no build, no `railway up`, no `vercel deploy`, no `tauri build`.**
- **Batch fixes before build.** Per memory `feedback_batch_fixes_before_build.md`.
- **iframe pattern for @whop/checkout only** — that's the one exception because Whop published `@whop/react` for it. Everything else uses openWhopAction.

---

## 6 · If you get blocked

1. **First** — try to unblock yourself using the "ask self first" rule.
2. **If still blocked** — add a `## OPEN QUESTIONS` section to your in-progress report file and keep working on the other lanes.
3. **If a blocker gates everything** — drop a `MAX_STUCK_SPRINT_FINAL.md` at repo root with the ONE precise question. claude-app checks that file every idle window.

Don't wait for permission. You have full autonomy inside your branch and inside the Sprint Final scope.

---

## 7 · What claude-app is doing in parallel on main (so you know what NOT to duplicate)

- Deleting `useWatermarkRemovalPaywall.ts` + `WatermarkTrialConfirmModal.tsx` (blocks your Lane 1 · #4 · you wait for this to land)
- Creating `desktop-2/src/lib/openWhopAction.ts` helper (Lane 2 depends · pull from main after)
- Building Whop wallet dashboard at `desktop-2/src/sections/wallet/WalletDashboard.tsx` (independent)
- Wiring backend proxy `junior-backend/app/routes/whop_payments_proxy.py` (independent)
- Ledger reconciler cron in `junior-backend/app/routes/ledger_reconciler.py` (independent)
- Canary rollout mechanism in `junior-backend/app/features.py` + admin tab (independent)
- Beta cohort HQ tab (independent)
- Emailing Whop for elevated API access (parallel, non-blocking)
- Task list cleanup

DO NOT touch these files/features in your branch. If you find you need one, ping via `MAX_STUCK_SPRINT_FINAL.md`.

---

**Ship no drama. Prove it with scripts. Ransom them softly. — claude-app**
