# SPRINT FINAL · Liquid Clips public launch · 2026-07-07

**Owner:** Daniel
**Coordinator:** claude-app
**Implementer:** Max
**Locked:** 2026-07-07 — **NO DEVIATION.** If something is missing, add to this doc first, then execute.
**Ship gate:** every item green + `bash scripts/audit-gate.sh` returns OK + Playwright suite passes + k6 clean + watchdog armed.
**Scale target:** 1,000,000 concurrent cold-traffic users.

---

## 0 · What already exists (do NOT rebuild)

| Surface | File | Status |
|---|---|---|
| Playwright suite scaffold | `desktop-2/playwright.config.ts` + `tests/e2e/*.spec.ts` × 30+ | Installed, wired, `pnpm test:user-lens` runs |
| Audit-state endpoint | `junior-backend/app/routes/audit.py` (`/audit/state` + `/audit/tick`) | Live |
| Audit-gate pre-ship script | `scripts/audit-gate.sh` | Live |
| Whop payout wire | `junior-backend/app/whop_payments.py` | Live |
| Frontend audit hook | `desktop-2/src/lib/useAuditableAction.ts` | Live |
| VideoToolbox reframe | `python-sidecar/stages.py:309-357` + `captions.py:815` | Shipped 2026-07-06 |
| `method_export_clip` | `python-sidecar/sidecar.py:3920-4103` | Shipped 2026-07-06 |
| Drag-drop consumer | `desktop-2/src/lib/globalDropConsumer.tsx` | Shipped 2026-07-06 |
| Thumbnail identity stash | `desktop-2/src-tauri/src/identity_stash.rs` | Shipped 2026-07-06 |
| Sidecar spawn unblocked | `desktop-2/src-tauri/src/lib.rs:454-575` | Shipped 2026-07-06 |
| Intro ceiling trimmed | `desktop-2/src/overlays/IntroSplash.tsx:60` | Shipped 2026-07-06 |
| Ransom paywall trigger #1 | `AssetRansomPaywall.tsx` + `PublishModule.tsx` | Shipped 2026-07-06 (fixed post-lens) |
| Whop $1 authorization plan | `plan_SMaXhQLXpSOaH` (Whop side, LIVE) + `whopCheckout.ts:81` | Shipped 2026-07-06 |
| Whop authorization backend semantic | `webhooks_whop.py:WHOP_AUTHORIZATION_PLAN_IDS` + `User.whop_authorized_at` | Shipped 2026-07-06 |
| LoginScreen production port | `WelcomeRoute.tsx` (v4) | Shipped 2026-07-06 |
| HQ tabs · Carousel + Cold Leads | `account-app/src/components/admin/*` | Shipped 2026-07-06 |
| Backend `/audit/state` includes system health | `audit.py:13` | Live |

## 1 · What must be built (gap list · in dependency order)

### 1A · Ransom paywall triggers #2 → #6 (blocks E2E scripts 3, 4, 6, 8, 9)
Max clones the fixed trigger #1 pattern to:
- **#2 Thumbnail Studio download** → `ThumbnailStudio.tsx` or `ThumbnailVariantGallery.tsx`
- **#3 Custom-caption export** → `CaptionDrawer.tsx` on non-default caption style
- **#4 Watermark removal** → replace existing `useWatermarkRemovalPaywall.ts` (must delete first · collision · see 1B)
- **#5 Schedule confirm** → `Schedule.tsx` or `PublishModal.tsx` cadence !== "now"
- **#6 Earn campaign publish** → `CampaignPageShell.tsx` on `handlePublishReward`

### 1B · Watermark paywall collision cleanup (blocks 1A · #4)
Delete `desktop-2/src/lib/useWatermarkRemovalPaywall.ts` + `WatermarkTrialConfirmModal.tsx` + test. Update `ExportPanel.tsx:31` + `OverlayTemplateGallery.tsx:27` imports. Trigger `<AssetRansomPaywall>` instead. Ship-gate the delete before #4 clone.

### 1C · Whop bounty syndication (agency posts campaign → appears in Whop marketplace)
**API probe result 2026-07-07:** Whop's bounty / content-rewards endpoints return `401` (not 404) with our current API key — endpoints exist, we need elevated access.

**Track 1 (ships now · uses `openWhopAction` from §1D):** Agency clicks "Post to Whop marketplace" from within our branded Campaigns page → `openWhopAction("https://whop.com/dashboard/company/biz_XXX/bounties/new?prefill_title=X&prefill_prize=Y")`. Persistent-cookie session means they're already logged in as their agency's Whop company. They fill in details, submit. We listen to the `campaign_created` / `bounty_created` webhook, mirror the entry to our `sponsored_campaigns` table with a Whop link + prize amount + expiration. Branded because they never leave our app.

**Track 2 (parallel · not blocking):** Email `dev@whop.com` requesting bounty-partner API access. Include use case: "Liquid Clips agency-tier customers programmatically post clipping campaigns to Whop marketplace. Attribution to Liquid Clips (whop_affiliate_code per agency)." When granted, we swap Track 1 for a native API call. Zero user-facing change.

### 1D-CREW · Crew Match + gap-based referral loop (LOCKED 2026-07-07 per HQ reply)

Ships in `desktop-2/src/design-os/earn/CrewMatchTool.tsx` + `ReferralPipelineTile.tsx` + `junior-backend/app/routes/crew.py` + Resend template + tracking redirect + Clerk/Whop attribution hooks.

**Contract (per REPLY_HQ_CREW_MATCH_2026-07-07.md):**
- Pitch = the GAP (missing money on absent platforms), NOT vanity earnings. Loss aversion beats vanity.
- `cold_leads` gains 9 new columns: `niche`, `audience_size`, `estimated_monthly_earnings_cents`, `estimated_opportunity_cents` (THE gap), `earnings_low_cents`, `earnings_high_cents`, `absent_platforms`, `handle_youtube`, `handle_tiktok`, `handle_twitter`, `earnings_verified_by_owner`.
- `POST /cold-leads/prep` extended to accept all fields (COALESCE-safe · workers stream partial fills).
- `POST /me/crew/match` returns gap + range + absent platforms + verified-by-owner flag.
- `POST /me/crew/invites/send` fires Resend with a branded email that leads with the gap when computed.
- `GET /i/{invite_id}` tracking redirect logs click, redirects to `liquidclips.app/?i=<id>&ref=<code>`.
- Clerk `user.created` hook activates invite when recipient signs up.
- Whop `payment.succeeded` hook credits 50% to referrer's total_earned_cents.
- `POST /cold-leads/owner-verify` write-back for HQ when a claimed creator confirms real earnings.
- Match-notify hook fires to `HQ_MATCH_NOTIFY_URL` env so HQ pauses cold-email for that lead for 14 days.

**Frontend copy pattern (HQ-locked):**
Row shows: **`Leaving $Y/mo on TikTok + Reels`** (big pink · the pitch) · then smaller gray "Makes $X-$Z/mo now · your 50% = $W/mo". Aggregate tile: "Total money they're leaving on the table · $TOTAL/mo".

### 1D · Whop Wallet · beautiful branded dashboard + auto-route to in-app browser
**Locked 2026-07-07.** Whop handles ALL payouts (USD, USDT, USDC via their own multi-PSP rail). Sui/Shinami retired — was old Gemini spec.

**Architectural correction (Daniel 2026-07-07):** We do NOT attempt iframes for Whop-side action pages. We route ANY Whop action into our existing persistent-cookie in-app browser (`browse.rs`) automatically. This IS the branded experience because the browser is inside our app shell + our chrome + our toolbar. User's Whop session persists across visits so every action is one-click.

**The Whop-action auto-route pattern (universal · reused across §1C + §1D + §1I + any future Whop-side surface):**

New helper: `desktop-2/src/lib/openWhopAction.ts`
```typescript
export function openWhopAction(url: WhopActionUrl, opts?: { title?: string }): void {
  // Any URL matching whop.com/dashboard/*, whop.com/@me/*, whop.com/checkout/*,
  // or any known Whop-owned action surface → route into browse.rs webview tab
  // with persistent-cookie session. Fires ingress telemetry so we can trace
  // conversion + reconciliation lands correctly on webhook return.
  bus.emit("browse:open-tab", { url, title: opts?.title ?? "Whop", session: "whop" });
}
```

`browse.rs` already handles persistent cookies for the `session: "whop"` bucket per memory `liquidclips_publish_walkaround.md`. Same session that Gate 1 authorization landed the user in.

**API probe result 2026-07-07:**
- `v2/payments` → 200 (full history: amount, currency, card, status, dates, crypto_tx_hash, wallet_address)
- `v2/memberships` → 200 (wallet_address, manage_url, renewal dates)
- `v2/wallet`, `v2/balance`, `v2/withdrawals` → 401 (elevated access only · request in parallel · not blocking)
- No `WhopWalletEmbed` React component exists — irrelevant, we don't need one

**Architecture (ships with current API access):**

Our beautiful branded Wallet page in `desktop-2/src/sections/wallet/` displays:
- Total earned this month (from our `RewardClip` table via `/me/wallet/ledger`)
- Pending payout (our table)
- Paid-out history (fetched from `v2/payments` via backend proxy)
- Connected wallet address (from `memberships.wallet_address` via backend proxy)
- Currency preference

**Every user action button uses `openWhopAction()`:**
- "Withdraw" → `https://whop.com/@me/wallet` (in in-app browser · one-click · session live)
- "Add crypto wallet" → `https://whop.com/@me/wallet/addresses`
- "Change currency" → `https://whop.com/@me/settings/payout`
- "Manage payment methods" → `https://whop.com/@me/settings/billing`
- "Tax documents" → `https://whop.com/@me/settings/tax`

Whop handles fraud, KYC, gas, caps, tax compliance, PCI liability. We display + reconcile.

Whop webhook (`payment.succeeded` / `payout.completed`) updates our ledger.

New files:
- `desktop-2/src/lib/openWhopAction.ts` — the auto-route helper (universal)
- `desktop-2/src/sections/wallet/WalletDashboard.tsx` — branded Wallet UI (grid of tiles + history table + all CTAs use openWhopAction)
- `desktop-2/src/sections/wallet/useWhopPayments.ts` — hook fetching backend proxy
- `junior-backend/app/routes/whop_payments_proxy.py` — proxy `/me/whop/payments` + `/me/whop/wallet` (server-side API key call, filtered to authenticated user's own records via `user_id` scope)

### 1E · Ledger reconciler (Whop-native · not Sui)
Since Whop IS the payout authority AND already runs fraud/cap/KYC checks on their side, we don't halt anything from our side. But we DO reconcile our internal ledger against Whop's records to catch:
- RewardClip mints in our DB with no matching Whop payment → underpayment (we owe the clipper)
- Whop payments with no matching RewardClip → overpayment (fraud or bug)

New: `junior-backend/app/routes/ledger_reconciler.py` running via existing `app/cron.py`:
- Every 15 min: fetch last 24hrs of `v2/payments` from Whop
- Match each against `RewardClip` rows
- Log any mismatch to `system_flags.reconciler_last_run_at` + `system_flags.reconciler_drift_count`
- If drift_count > 10, email Daniel via Resend (informational · Whop already handled the money, this is just for our ledger integrity)
- No auto-halt (Whop handles that on their side)

### 1F · k6 load test suite (1M user scale proof)
New: `junior-backend/tests/k6/` directory. One script per critical endpoint:
- `k6-audit-state.js` — hammer `/audit/state` at 1M req/min
- `k6-whop-webhook.js` — simulate 100K webhook events over 5 min
- `k6-desktop-connect.js` — 500K first-launch activations
- `k6-carousel-clips.js` — public endpoint from LoginScreen
- `k6-cold-leads-prep.js` — HQ bulk upload
Each returns pass/fail: p95 latency < 500ms, zero 500 errors, error rate < 0.1%.
Runs in CI via `grafana/setup-k6-action`.

### 1G · Canary rollout mechanism
Feature flag pattern:
- `junior-backend/app/features.py` gains `canary_percent` per feature
- `POST /admin/canary/{feature}` sets percent (0-100)
- Desktop `useFeature("ransom_paywall")` hashes `user.id % 100 < canary_percent`
- HQ Admin tab: dial in real-time
- Emergency killswitch: set to 0 mid-rollout

### 1H · Playwright E2E scripts (Daniel's core ask · replaces manual walkthrough)
Extends existing `tests/e2e/*.spec.ts` folder. Adds 12 new scripts:

| # | Script | File | Assertion |
|---|---|---|---|
| P1 | LoginScreen · $1 Whop authorization | `login-whop-authorization.spec.ts` | Card entered → `whop_authorized_at` set → app shell mounts |
| P2 | Emailing crew · LC-ID Resend | `login-lc-id-email.spec.ts` | Checkout success → Resend called → LC-ID paste unlocks |
| P3 | Payment · Ransom Gate 2 flip | `ransom-paywall-flow.spec.ts` | Free user hits export → paywall → confirm → tier=agency → unlock |
| P4 | URL clip → MP4 exported | `url-clip-export.spec.ts` | Paste YouTube URL → clips render → export → MP4 on disk |
| P5 | File drop → MP4 exported | `file-drop-export.spec.ts` | Drop MP4 → clips render → export → MP4 on disk |
| P6 | Thumbnail Studio · identity → generate | `thumbnail-identity.spec.ts` | Upload photo → identity saved to disk → thumbnails generate |
| P7 | Publish → RewardClip mint | `publish-reward-mint.spec.ts` | Publish → `/me/reward-clips` shows new row |
| P8 | Watermark removal paywall | `watermark-paywall.spec.ts` | Free user toggles off → paywall fires → confirm → clean export |
| P9 | Schedule confirm | `schedule-paywall.spec.ts` | Free user schedules → paywall → confirm → OS notification |
| P10 | Earn · agency posts campaign → Whop mirror | `agency-campaign-syndicate.spec.ts` | Agency creates campaign → Whop webview opens → mirror row in `sponsored_campaigns` |
| P11 | Cold start · fresh install → LoginScreen | `cold-start-fresh.spec.ts` | No JWT → LoginScreen mounts within 3s |
| P12 | Cold start · returning user | `cold-start-returning.spec.ts` | JWT present → skip LoginScreen → app shell within 2s |

All scripts:
- Use existing `desktop-2/tests/e2e/` harness + fixtures
- Follow the `test:user-lens` command pattern
- Green in CI = Journey proven

### 1I · Beta cohort recruitment tooling
New HQ Admin tab `BetaCohortTab.tsx`:
- List invited early partners (5-10)
- Track feedback via new `POST /beta/feedback` endpoint
- Higher-revenue-split flag on their user record
- Payout multiplier applied in `whop_payments.py`

### 1J · Task cleanup (stale)
Reconcile task list against real state. Verify tasks #34, #35, #36, #38 (Affiliate Agreement + Founder plan · code done, deploy status). If already live, mark completed. If not, sequence in deploy phase.

---

## 2 · Task split · who does what

### claude-app (me · repo root · orchestration)
- 1B (watermark paywall delete PR · required before Max clones #4)
- 1C track 2 (email Whop for bounty API access + elevated wallet API access)
- 1D (Whop wallet dashboard + `whop_payments_proxy.py`)
- 1E (ledger reconciler cron · no auto-halt)
- 1G (canary rollout mechanism)
- 1I (beta cohort tab)
- 1J (task list cleanup)
- Integration branch owner (`feat/sprint-final-2026-07-07`)
- Every Max branch merges through me after ship-lens

### Max (isolated branch `feat/e2e-and-ransom` · one delivery)
- 1A (ransom paywall triggers #2 → #6 · uses fixed trigger #1 pattern)
- 1C track 1 (Whop bounty webview handoff · agency campaign syndicate)
- 1F (k6 load test suite · 5 scripts)
- 1H (12 Playwright E2E scripts)
- All ship-lens per feedback_lens_hard_gate.md before reporting done

### Daniel (physical / decision-only)
- ~~Provide Sui wallet address~~ **RETIRED 2026-07-07** — Whop handles payouts, no Sui needed
- ~~Sign off on payout caps~~ **RETIRED 2026-07-07** — Whop enforces caps on their side
- Recruit 5-10 beta partners (offer higher revenue split)
- Final ship greenlight
- Whop dashboard: confirm `plan_SMaXhQLXpSOaH` is visibility=hidden (it is) — no action needed
- Nothing else

---

## 3 · Dependency graph · ordering

```
[Now]   1B (watermark delete)  ──┬─→ 1A (ransom triggers #2-#6)
                                 │
        1C-T2 (email Whop)  ─────┤   [Max branch]
                                 │
        1J (task cleanup)   ─────┘
                                     ├─→ 1H (E2E scripts)
[Parallel]  1D (Sui rail)            │
            1E (watchdog)            │
            1G (canary)              ├─→ 1F (k6 tests)
            1I (beta cohort)         │
                                     │
[Sequential] ← wait Daniel Sui creds │
                                     │
[Integration]  claude-app merges Max branch after ship-lens
                                     │
[Ship gate]  audit-gate.sh + full E2E + k6 all green
                                     │
[Beta]  1I cohort walks + reports (parallel with canary)
                                     │
[Canary]  1G · 5% → 25% → 100% over 3 days
                                     │
[Public]  1M user cold traffic open
```

---

## 4 · Ship gate checklist (public launch = all green)

| Gate | Pass criteria | Owner |
|---|---|---|
| `pnpm tsc --noEmit` (desktop-2 + account-app) | 0 errors | Max |
| `python3 -m py_compile` (junior-backend + python-sidecar) | 0 errors | Max |
| `pnpm test` (vitest 149+) | All green | Max |
| `pnpm test:user-lens` (Playwright · 42 spec total: 30 existing + 12 new) | All green | Max |
| `bash scripts/audit-gate.sh` | OK + no P0 | claude-app |
| k6 · 1M req/min on `/audit/state` | zero 500s · p95 < 500ms | Max |
| k6 · 100K webhook simulation | zero 500s · zero dropped | Max |
| Wallet dashboard fetches Whop payments proxy | Shows real user history from `v2/payments` | claude-app |
| Ledger reconciler cron running | Runs every 15 min · `system_flags.reconciler_last_run_at` fresh | claude-app |
| Withdraw handoff opens Whop in-app browser | Session survives · one-click withdraw works | claude-app |
| Ship-lens on ALL Max branches | SHIP verdict on each | Max (self-dispatched per lens rule) |
| Canary infrastructure live | `POST /admin/canary/ransom_paywall` accepts 0-100 | claude-app |
| Beta cohort recruited (5-10) | Real users with contracts | Daniel |
| Whop payout live-fire on beta cohort | 5+ real payouts complete | claude-app + Daniel |
| Manual Sui balance vs `sui explorer` sanity | Match to the cent | Daniel |

---

## 5 · No-deviation clauses

1. **No new features not on this doc.** If discovered, add to §1 first.
2. **No side-quests during Max's build.** He owns his branch until he reports done.
3. **No "quick fix in main" during sprint.** Everything through `feat/sprint-final-2026-07-07`.
4. **Ship-lens is non-negotiable.** Per memory `feedback_lens_hard_gate.md`.
5. **No public launch until every §4 gate is green.** Canary + beta cohort first.
6. **Reversible everything.** Canary killswitch, feature flags — all wired before launch.
7. **No iframe attempts on Whop-owned surfaces.** Locked pattern: any Whop-side action page (wallet, bounty create, tax, payout settings, KYC) uses `openWhopAction()` which auto-routes into `browse.rs` persistent-cookie webview. Session survives. Branded because it's inside our shell. This applies EVERYWHERE — not just wallet.
8. **Every payout tracked with Whop idempotency key.** Prevent double-attribution per memory `feedback_no_goldfish_memory.md`.
9. **Beta cohort payouts run first.** Real dollars. Real people. Real proof before 1M open.
10. **Whop is the source of truth for money.** Our ledger reconciles TO Whop, never the other way. If they disagree, Whop wins.

---

## 6 · Definitions of Done (per lane)

**Ransom triggers #2-#6:** Each site wrapped in `<AssetRansomPaywall>` · gate condition validated · onUnlocked bypasses gate · tsc clean · Playwright script passing.

**Whop bounty syndicate:** Agency creates campaign in UI → webview to Whop opens → mirror row in `sponsored_campaigns` on webhook · Playwright P10 green.

**Sui payout:** Testnet dry-run succeeds · watchdog auto-halts on forced drift · caps enforced · Playwright + k6 both green.

**E2E scripts (all 12):** Each runs in CI · reproducible · headless-capable · failure produces trace.zip.

**k6 load tests:** 1M req/min sustained for 5 min · p95 < 500ms · zero 500s · error rate < 0.1%.

**Canary:** `POST /admin/canary/{feature}` sets percent · desktop reads it · killswitch works within 30s of the API call.

**Ship gate:** `bash scripts/audit-gate.sh` returns OK + full Playwright suite green + full k6 suite green + watchdog armed + beta cohort completed 5+ real payouts.

---

## 7 · Handoff format

### Max (single handoff at `MAX_HANDOFF_SPRINT_FINAL_2026-07-07.md`)
- Full context of §1A + §1C-T1 + §1F + §1H (his lanes)
- Reference this SPRINT_FINAL doc
- Instruction: "isolated branch `feat/e2e-and-ransom`, no push, no deploy, no main merge, ship-lens per finding, report at `MAX_REPORT_SPRINT_FINAL_2026-07-07.md`"

### claude-app (self-directed)
Executes §1B → §1D → §1E → §1G → §1I → §1J in sequence. Waits for Daniel's Sui creds before 1D.

### Daniel (light touch)
- Provide Sui creds (§2)
- Sign off on caps
- Recruit beta cohort
- Final ship greenlight

---

## 8 · Rollback plan

If ANY gate fails after canary opens:
1. `POST /admin/canary/{failing_feature}` → 0 within 60 seconds
2. Watchdog auto-halts payouts if drift detected
3. `git revert` the offending sprint commit, force-cache-bust the desktop app via existing update system
4. Debrief in HQ_APP_STATUS memo before re-open

---

**Locked. No deviation. Execute in order. — claude-app 2026-07-07**
