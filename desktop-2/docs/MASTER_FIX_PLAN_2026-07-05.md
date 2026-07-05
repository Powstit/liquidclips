# Master Fix Plan · Liquid Clips launch-ready sprint

**Date:** 2026-07-05
**Verdict basis:** `docs/MASTER_AUDIT_2026-07-05.md` (6-lens audit) + this session's ship-lens iterations.
**Bar for "done":** every user journey walkable with real data · no fixture-in-prod · no silent mocks · no dead toasts.

Two parallel execution lanes. Claude 1 runs 5 agents on one lane. Claude Me (this instance) runs 5 agents on the other. Zero file collision by design.

**Ship gate for the whole sprint:** `bash desktop-2/scripts/audit-gate.sh` returns exit 0 + all 5 critical journeys report `success_rate >= 0.85` in `/audit/state`.

---

## Sequencing

| Phase | What lands |
|---|---|
| **Phase A · Data wires (parallel)** | Wallet real · Editor real · Export real · Earn real · Publish → RewardClip mint |
| **Phase B · Paywall + gates (parallel)** | Watermark removal trigger · Cancel subscription real · Founder seat copy · Wallet double-count reconciliation · auth_whop.py mint parity |
| **Phase C · Wave 2 · Shared-rail codemod (parallel)** | `bridgeToBackend` helper + swap 20+ silently-mocked TS sidecar wrappers to existing backend HTTP routes. Un-mocks Agency campaigns · Channels · Scheduling · Submissions · Announcements simultaneously. 1 helper + 1 codemod pass = 25 features go live. |
| **Phase D · Systemic codemods (parallel)** | `<SafeImg>` / `<SafeVideo>` primitives · `humanError()` sweep · `useAbortableAsync` hook · Cron structured-error logger · Dead-component sweep |
| **Phase E · Deploy + walk** | `railway up` · `npm run tauri build` · install · Cohort 0 walk with audit endpoint live |

Phases A → E are strict. Within a phase, tasks run parallel.

**Wave 2 rationale:** the rpc-contract-lens flagged 32 TS wrappers calling non-existent Python handlers, silently falling back to mock. On investigation, the corresponding BACKEND HTTP routes already exist for 20+ of them. Not features to build · wrappers to redirect. One shared helper + codemod closes the whole class.

---

## Claude 1 · 5 tasks · file ownership: `sections/` + `design-os/engine/` + Python sidecar + `webhooks_whop.py`

### C1-T1 · Wallet real data pipeline (P0)

**Owner:** Claude 1
**Scope:**
- `desktop-2/src/routes/wallet-detail/WalletDetail.tsx:67-198` — DELETE hardcoded `CLIPPERS` and `DROPS` constants
- Create `desktop-2/src/lib/wallet.ts` with `useWalletLedger()` hook that fetches `GET /me/wallet/ledger` (backend endpoint already exists at `junior-backend/app/routes/me_wallet.py`)
- Enumerate real render states: `loading` · `empty` (new user) · `populated` (has rows) · `error` · `expired-affiliate-agreement`
- Each state rendered explicitly — no silent empty render
- Wire `AccountSection.tsx` to pass real data through

**Acceptance:**
- Fresh install shows empty state ("No clips yet · your first payout lands here")
- User with real ledger rows sees their actual data
- Backend 401 shows "Sign in to see your wallet" with sign-in CTA
- ship-lens Phase 2 STATE inventory in `docs/UI_MAP_wallet.md` covers all 5 states

**Est:** 4-6 hours

---

### C1-T2 · Editor real clips (P0)

**Owner:** Claude 1
**Scope:**
- `desktop-2/src/sections/editor/EditorSection.tsx:47-50` — DELETE `generateClips(6, 0)` + `fakeEditor.preview` imports at line 17-23
- Wire to `useEngineSession().project.clips` (same source as Workstation.tsx)
- `EditorSection.tsx:16-18` (my earlier stub) — DELETE the `getCampaignById` stub; use real campaign store (or empty state)
- Publish/Whop modals at lines 502, 511 fire against real clip IDs (session.project.clips[].slug)

**Acceptance:**
- User bakes 6 real clips in Workstation → opens Editor → sees THEIR clips (not the demo 6)
- Publish button fires against real slugs
- Empty state ("Bake clips in the Workstation first") when no session

**Est:** 3-4 hours

---

### C1-T3 · Export flow real (P0)

**Owner:** Claude 1
**Scope:** Decide + implement ONE of two paths:

**Path A · Python handler** (proper fix, aligned with existing sidecar pattern):
- Add `export_clip`, `cancel_export`, `save_copy_as`, `reveal_in_finder`, `list_export_history` handlers to `desktop/python-sidecar/sidecar.py METHODS` map
- Each writes a real file (FFmpeg-based encode of the clip at the requested format)
- Emit `sidecar:export_progress` + `sidecar:export_complete` events

**Path B · Direct backend HTTP** (faster · relies on backend to own the export queue):
- Switch `sidecar-stub.ts:957` TS wrapper from `tryInvoke("sidecar_call", …)` to `fetch("/exports", …)`
- Needs backend `/exports/*` routes (create in `junior-backend/app/routes/exports.py`)

**Recommendation:** Path A for launch (leverages existing sidecar infra · no new backend surface).

**Acceptance:**
- User clicks Export → real MP4 written to `~/Movies/LiquidClips/<slug>/<idx>.mp4`
- History list shows real files
- "Reveal in Finder" opens the correct path

**Est:** 6-8 hours

---

### C1-T4 · Publish → RewardClip mint (P0)

**Owner:** Claude 1
**Scope:**
- `desktop-2/src/design-os/engine/cockpit/PublishModule.tsx:206-263 publishNow` — currently ONLY calls `exportApi.exportClip`. Add:
  - Call `POST /publish-now` (backend at `publish.py` — already exists) with the clip metadata + selected platforms
  - Call `POST /me/reward-clips` (backend at `reward_clips.py:38 RewardClipCreate` — already exists) to create the RewardClip row
- Wire the two POSTs to the existing `signInAction`-style hook (`useAuditableAction("publish.multi-platform", …)`)
- Success = both posts return 2xx + toast "Published to N platforms · earning tracked in Earn tab"

**Acceptance:**
- Click Publish → clip goes to selected platforms via Ayrshare
- RewardClip row appears in backend for that user
- Earn tab shows the new pending reward

**Est:** 4-5 hours

---

### C1-T6 · `bridgeToBackend` helper + agency-side wrapper swap (Wave 2 · P0)

**Owner:** Claude 1
**Runs AFTER C1-T5**

**Scope:**
- Create `desktop-2/src/lib/bridgeToBackend.ts` (~40 LOC) with a typed helper:
  ```ts
  export async function bridgeToBackend<TResp>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    args?: unknown,
  ): Promise<TResp>
  ```
  · reads `backendUrl()` from existing config · attaches `authHeaders()` · JSON body serialisation · throws typed errors on non-2xx.
- Codemod-swap the AGENCY-SIDE mocked TS wrappers in `desktop-2/src/design-os/engine/sidecar-stub.ts` to use `bridgeToBackend`:
  - `agency_create_campaign` → `POST /agency/campaigns`
  - `agency_publish_campaign` → `POST /agency/campaigns/{id}/publish`
  - `agency_patch_campaign` → `PATCH /agency/campaigns/{id}`
  - `agency_connect_reward` → `POST /agency/campaigns/{id}/reward`
  - `agency_refresh_reward` → `POST /agency/campaigns/{id}/reward/refresh`
  - `list_channels` → `GET /social/connections`
  - `connect_channel` → `POST /social/connect`
  - `disconnect_channel` → `POST /social/disconnect`
  - `social_connections` → `GET /social/connections`
  - `refresh_channel` → `POST /social/{id}/refresh`
  - `validate_whop_reward` → `POST /whop/rewards/validate`

**Acceptance:**
- Agency user creates a campaign → row appears in `campaigns` DB table
- Agency user connects a channel → row appears in `social_connections` DB table
- No `tryInvoke("sidecar_call", ...)` remaining for the above method names (grep-verify)
- ship-lens JOURNEY audit for Agency-owner flow shows no strand

**Est:** 4-5 hours

---

### C1-T5 · Watermark removal paywall trigger (P0 · monetisation)

**Owner:** Claude 1
**Scope:**
- `desktop-2/src/design-os/studio/OverlayTemplateGallery.tsx:157-164` — currently fires dead toast. Wire toggle click to:
  - If `tier.tier === "clipper"` (Free) → `bus.emit("auth:open-panel", {})` (opens Whop checkout for Founder Access)
  - If tier is trial-active → POST `/me/trial/end` (Whop `end_free_trial` API — already wired in `trial_convert.py`) with confirmation modal ("Charge my card $99.99 now to remove the watermark?")
- `desktop-2/src/design-os/studio/ExportPanel.tsx:180-183` — add "Upgrade to remove" click affordance

**Acceptance:**
- Free user clicks watermark toggle → Whop checkout opens
- Trial user clicks watermark toggle → confirmation modal → card charge → tier flips → watermark drops
- audit tick `watermark.remove` fires success on flow completion

**Est:** 4-5 hours

---

## Claude Me (this instance) · 5 tasks · file ownership: `me_wallet.py` + `webhooks_whop.py` + `AccountSection.tsx` + `auth_whop.py` + codemods

### CM-T1 · Earn tab real data (P0)

**Scope:**
- Sidecar OR backend handlers for `list_reward_clips` + `earn_summary` (dual with C1-T3 export flow decision)
- `Earn.tsx:211` — remove hardcoded `referralCount={0}`
- Split `viewCount` from `totalClicks` (currently conflated) — wire real referral count via `GET /me/affiliate/referrals?count=true`
- Backend affiliate revenue rollup: `me_wallet.py:309` currently hardcodes `affiliate_revenue_usd_cents=0` · sum `WalletLedger` rows where `source='whop_affiliate'`

**Est:** 4-5 hours

---

### CM-T2 · Cancel subscription real (P0)

**Scope:**
- `AccountSection.tsx:71-79 handleQuietCancel` — currently toast-only. Wire to POST `/me/subscription/cancel` (new backend endpoint)
- Backend: create `junior-backend/app/routes/me_subscription.py` with `POST /cancel` that hits Whop `DELETE /api/v2/memberships/{id}` (or `POST end_free_trial` if trialing)
- Add confirmation modal ("Cancel your Founder Access? You'll lose access at end of billing cycle · [Keep] [Cancel]")
- Success toast reflects real state ("Cancelled · access until 2026-08-05")

**Est:** 3-4 hours

---

### CM-T3 · Founder seat copy + auth_whop.py mint parity (P0)

**Scope:**
- `webhooks_whop.py:767` — replace `"You're seat #{seat_count} of 2,000"` with `"of 12,000"` (matches `founder.py:50 MAX_FOUNDER_SEATS = 12_000`)
- `webhooks_whop.py:842-844 _seat_count` — reconcile with `founder_seats_used` in `founder.py:60` so both counters read the same source of truth (drop `_seat_count` · use the FounderSeat table read only)
- `auth_whop.py:411` — replace inline `issue_license_jwt` + `License` insert with `apply_membership_tier(db, user, tier=..., founder=..., whop_user_id=...)` (same fix I applied to `whop_checkout_success.py`)

**Est:** 2-3 hours

---

### CM-T4 · Wallet double-count reconciliation (P0)

**Scope:**
- `me_wallet.py:279` folds `user.carrot_total_paid_usd_cents` · `me_wallet.py:422` also reads `WalletLedger.compute_balance` · same Whop payout can appear twice
- Pick ONE source of truth (recommend `WalletLedger` — append-only, most flexible)
- Deprecate `carrot_total_paid_usd_cents` OR subtract-reconcile explicitly with a comment reference
- Add test in `junior-backend/tests/test_wallet_ledger.py` that seeds a Whop payout event and asserts wallet shows the amount ONCE

**Est:** 2-3 hours

---

### CM-T6 · Discovery-side wrapper swap using `bridgeToBackend` (Wave 2 · P0)

**Owner:** Claude Me
**Runs AFTER CM-T5 · depends on Claude 1's `bridgeToBackend` helper landing first**

**Scope:**
- Import the `bridgeToBackend` helper Claude 1 created at `desktop-2/src/lib/bridgeToBackend.ts`
- Codemod-swap the DISCOVERY-SIDE mocked TS wrappers in `desktop-2/src/design-os/engine/sidecar-stub.ts`:
  - `list_campaigns` → `GET /campaigns`
  - `get_campaign` → `GET /campaigns/{id}`
  - `list_reward_clips` → `GET /me/reward-clips`
  - `earn_summary` → `GET /me/wallet/summary`
  - `leaderboard_preview` → `GET /leaderboard/earnings` (if exists) OR remove wrapper
  - `list_banners` → `GET /admin/banners` (public read subset)
  - `list_announcements` → `GET /announcements`
  - `list_scheduled_clips` → `GET /schedules`
  - `retry_scheduled_job` → `POST /schedules/{id}/retry`
  - `cancel_scheduled_job` → `POST /schedules/{id}/cancel`
  - `reschedule_job` → `POST /schedules/{id}/reschedule`
  - `list_campaign_asset_links` → `GET /campaigns/{id}/asset-links`

**Non-collision:** BOTH lanes touch `sidecar-stub.ts` in this wave. Coordinate via method-name ownership: Claude 1 owns `agency_*` / `list_channels` / `*_channel` / `social_connections` / `validate_whop_reward`. I own `list_campaigns` / `get_campaign` / `list_reward_clips` / `earn_summary` / `leaderboard_preview` / `list_banners` / `list_announcements` / `*_scheduled_*` / `list_campaign_asset_links`. Any grep-collision requires a coordination log entry.

**Acceptance:**
- Campaigns tab shows real backend data (empty list for new users, populated for those with campaigns)
- Earn tab shows real reward-clip rows
- Schedule tab shows real scheduled clips
- No `tryInvoke("sidecar_call", ...)` remaining for the above method names

**Est:** 4-5 hours

---

### CM-T5 · Systemic codemods (P0 patterns)

**Scope:** 3 pattern fixes in one branch:

1. **`<SafeImg>` + `<SafeVideo>` primitives** at `desktop-2/src/components/safe/`. Codemod pass over 19 video sites + 24 img sites (top offenders in `MASTER_AUDIT_2026-07-05.md`) to swap raw `<img>`/`<video>` for the new primitive. Silent 404s become visible fallbacks.

2. **`humanError()` sweep** across 116 FE catches + 56 BE catches. Grep pattern: `catch\s*\(\s*[eE]r*\s*\)\s*{\s*[^}]*(String\(e\)|e\.message|err\.message)` · route through the existing `humanError` helper (already exists per bug-hunt-lens F1 memory).

3. **Delete 9 dead components** with zero importers: `Dialog.tsx` · `Collapsible.tsx` · `ActionPill.tsx` · `ThumbnailDrawer.tsx` · `ImportDrawer.tsx` · `SponsoredBannerCarousel.tsx` · `ScriptDrawer.tsx` · `DropZone.tsx` · `ScheduleQueue.tsx`. Grep-confirm zero importers before each delete.

**Est:** 4-6 hours

---

## Non-collision rules

Both lanes edit disjoint file sets. If a bug in a file NOT on your list surfaces during your task:
- Log it in `docs/MASTER_FIX_PLAN_2026-07-05.md` under **Cross-lane findings** below (append-only)
- Do NOT edit outside your lane
- The other lane picks it up in their next sprint

---

## Cross-lane findings (append-only log)

- **2026-07-05 · C1 lane · App.test.tsx pre-existing failure.** During C1-T1 verification, `npx vitest run src/App.test.tsx` fails at line 41: `expect(APP_SRC).not.toMatch(/LoginActivation/)`. The current `desktop-2/src/App.tsx` (claude-2 lane · dirty in tree) still references `LoginActivation` in the header comment at lines 36–37 and in a docstring at line 276. Not caused by C1-T1 (WalletDetail work). CM lane fix: strip the `LoginActivation` / `LoginOnboarding` / `useAuthPanelBridge` symbol references from the App.tsx comments (or update App.test.tsx to allow the docstring mention). No code-path change needed.

---

## Ship criteria

Sprint is DONE when:

- [ ] All 10 P0s marked complete with lens verdict PASS on their specific files
- [ ] `bash desktop-2/scripts/audit-gate.sh` returns exit 0
- [ ] Backend `railway up --service junior-backend` succeeded · `/audit/state` returns 200
- [ ] 5 critical journeys (`auth.sign-in` · `wallet.claim` · `publish.multi-platform` · `campaign.create` · `watermark.remove`) all show `success_rate >= 0.85` in `/audit/state`
- [ ] Desktop 2.2.24 (or 2.2.25) built + installed + a real cold-email-simulated buyer walks sign-in → gallery → export → publish → earn without stranding

---

## Estimated total effort

- Claude 1 lane: ~22-28 hours of engineering
- Claude Me lane: ~15-21 hours of engineering
- Parallel wall-clock: **~3-4 days** at aggressive pace

Cohort 0 realistic launch date: **2026-07-09 or 2026-07-10** (~4-5 days from today).

---

## Where the audit findings live for reference

- `docs/MASTER_AUDIT_2026-07-05.md` — the 6-lens sweep raw findings
- `docs/ship-lens-review.json` — every ship-lens-reviewer verdict this session (BLOCK · BLOCK · PASS_PENDING_RAILWAY_DEPLOY)
- Prior lens agent transcripts saved by conversation runtime — reference for the 35 P0 punch list
