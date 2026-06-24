# Phase 6N-E v1 · Truth Report

Agency Campaign Creation foundation · safe deeplink/connect path · Whop as source of truth.

---

## 1 · File-change list

**Backend new:**
- `junior-backend/app/routes/agency_campaigns.py` — 6 endpoints (validate-reward · create · patch · connect-reward · publish · refresh-reward) + reward-state derivation helper

**Backend modified:**
- `app/models.py` · `SponsoredCampaign` model — 11 new columns + 1 new index group
- `app/main.py` — 12 idempotent `ALTER TABLE` statements in lifespan + 4 new indexes + 2 backfill UPDATEs + router mount + import

**Frontend new:**
- `src/design-os/state/useWhopReward.ts` — debounced validate hook
- `src/design-os/state/useAgencyCampaignDraft.ts` — 8-step draft state container
- `src/design-os/agency-creation/WhopRewardCard.tsx` + `.css` — reusable read-only card with clipboard copy
- `src/design-os/agency-creation/steps.tsx` + `.css` — all 8 step components co-located
- `src/design-os/agency-creation/AgencyCreationFlow.tsx` + `.css` — Drawer orchestrator
- `src/design-os/agency-creation/index.ts` — barrel
- `docs/phase-6n-e-truth.md` — this report

**Frontend modified:**
- `src/design-os/engine/sidecar-stub.ts` — `agencyWhop.validateReward` + `agencyCampaigns.{create,patch,connectReward,publish,refreshReward}` with real-RPC → HTTP → mock fallback
- `src/design-os/routes/Campaigns.tsx` — admin-only `<AgencyCreationFlow>` mount + floating "Create campaign" CTA (agency tier only)
- `src/design-os/routes/Campaigns.css` — `.lc-campaigns-create-cta`

**No new OAuth, no new auth primitives, no token storage, no Whop scope changes.** Per locked direction.

---

## 2 · Backend schema/API summary

### Schema (additive · 11 new columns on `sponsored_campaigns`)

| Column | Type | Purpose |
| --- | --- | --- |
| `whop_reward_id` | varchar · indexed | Carries `b_*` (legacy GraphQL) or `bnty_*` (new REST) ids · backfilled from `whop_campaign_id` |
| `whop_reward_url` | varchar | Canonical Whop page URL · backfilled from `whop_campaign_url` |
| `whop_reward_snapshot` | jsonb | Cached normalized response from `_normalize_bounty` |
| `whop_reward_snapshot_business_goal` | varchar · indexed | Whop's `businessGoalType` enum · maps to `campaign_type` |
| `whop_reward_snapshot_bounty_type` | varchar | `classic / user_funded / workforce` |
| `whop_reward_synced_at` | timestamptz · indexed | Last successful sync · drives stale calc + cron pickup |
| `whop_reward_last_error` | text | Human-readable last validate failure |
| `whop_reward_state` | varchar · indexed | Cached state enum (10 values · see §5) |
| `campaign_type` | varchar · indexed · default `'clip'` | Discriminator from 6N-A · default keeps legacy rows valid |
| `created_by` | FK users.id · SET NULL | Agency identity |
| `description` | text · default `''` | Long-form body · was missing |

### API (6 new endpoints · all gated by `is_admin_email` for v1)

| Method | URL | Purpose |
| --- | --- | --- |
| `POST` | `/agency/whop/validate-reward` | Regex extracts id from URL or bare id · returns normalized snapshot + reward-state · no fake "connected" |
| `POST` | `/agency/campaigns` | Creates a `draft` Campaign · optional `whop_reward_id` auto-validates and transitions to `pending_reward` |
| `PATCH` | `/agency/campaigns/{slug}` | Edits any field · 409 if status is `live` |
| `POST` | `/agency/campaigns/{slug}/connect-reward` | Bind/swap reward · re-validates |
| `POST` | `/agency/campaigns/{slug}/publish` | 3-gate check (reward bound + validate passes + required fields set) · 422 with field-level errors on failure |
| `POST` | `/agency/campaigns/{slug}/refresh-reward` | Force-sync · ignores cache |

All endpoints reuse the existing `/whop/bounties/{id}` proxy infrastructure (cache · IP rate limit · Partner gate · `_normalize_bounty`). No new Whop client code.

### Backend imports clean

```
.venv/bin/python -c "from app.main import app; print('OK')"  → OK
.venv/bin/python -c "from app import models; cols = ...; print('all 6N-E columns present:', ...)"  → YES
```

All 6 new endpoints mounted on the FastAPI app (verified by `app.routes` introspection).

---

## 3 · Agency creation flow summary

8-step Drawer-mounted flow (`<AgencyCreationFlow>` · 640px right-side · portal-to-body). Step nav at top shows progress · footer has Back / Save+exit / Next. Save+exit at any step persists the partial draft as `status="draft"`.

| Step | Component | What lands on the row |
| --- | --- | --- |
| 1 | `<StepConnectReward>` | `whop_reward_id` + snapshot (real or mock fallback) |
| 2 | `<StepTitleDescription>` | `title`, `description`, `campaign_type` (defaults pulled from snapshot · agency override) |
| 3 | `<StepBannerThumb>` | `banner_url` from existing `/brand/decks/*` + `/brand/sponsored/thumb-*.png` library · zero generation |
| 4 | `<StepBriefLinks>` | Reuses 6N-D v1 CRUD · shows existing links · inline-add UI is the only deferred polish (flagged in §8) |
| 5 | `<StepDiscussion>` | `business_unit` derived from selected community channel · picker reuses `useCommunity().channels` |
| 6 | `<StepTargeting>` | `visibility_tiers` + `requiredTier` · Whop-allowed platforms surfaced as **read-only** (per the source-of-truth split) |
| 7 | `<StepFeatured>` | Optional · `mission_lane` only · featured-billing wire-up flagged for later |
| 8 | `<StepReviewPublish>` | `<WhopRewardCard>` snapshot + review grid + Publish button · backend re-validates and applies the 3-gate check |

**Step 1 framing (locked correction).** Both options are co-equal first-class choices · neither marked as fallback or coming-soon:

- **Option A · Connect existing Whop reward** — text input with **CLIPBOARD PASTE button** + "Validate reward" CTA
- **Option B · Create reward in Whop** — "Open Whop ↗" CTA fires `bus.emit("browse:open", { mirror: "whop" })` to `whop.com/dashboard/links/checkout` · agency funds in Whop · returns to LC · pastes the URL into Option A

Both paths converge on a validated reward id. v1.5 (in-app create via OAuth-scoped REST) is tracked in §9 · not surfaced in the UI as missing.

---

## 4 · Whop reward validation truth

### What's real (production-truth)

- **Reward lookup** — `POST /agency/whop/validate-reward` calls the existing `/whop/bounties/{id}` proxy. App API Key surface. Cache hits + rate-limited + Partner-gated as before.
- **Id extraction** — regex matches both `b_*` (legacy GraphQL) and `bnty_*` (new REST) shapes. Backend tries `publicBounty(id:)` first; REST `bnty_*` ids will land as `not_visible` until v1.5's OAuth path ships. Honest copy in the UI.
- **Snapshot** — full `_normalize_bounty` output preserved as JSON · `businessGoalType` → `campaign_type` mapping derived in `snapshotToCampaignType()` helper.
- **State derivation** — `_derive_reward_state()` (backend) + `mockDeriveState()` (frontend mock fallback) share identical logic. No drift.

### What's mock (browser preview only)

- When no JWT and no Tauri runtime present, the sidecar falls to a hard-coded snapshot ("Mock reward · preview only") so the flow demonstrates end-to-end. **Source field marked as such.** In a packaged Tauri install the real path fires.

### Honesty gates surfaced in UI

- `unreachable` · "Whop is temporarily unreachable. Refreshes automatically when the connection returns."
- `not_visible` · "We can't see this reward right now. Check sharing settings on Whop, or this may be a new REST-API reward that requires the Whop OAuth path (lands in Phase 6N-F)."
- `pending_reward` · amber pill on the card · "Awaiting Whop reward"

No fake "connected" mask. No silent fallback to a green state.

---

## 5 · Campaign status / reward-state truth

### Campaign creation states (LC-owned · 4 values)

```
draft → pending_reward → live → closed
                  ↑
                  └── unreachable / not_visible loops back here
```

| Status | Meaning |
| --- | --- |
| `draft` | Created without a reward · agency-only · not discoverable |
| `pending_reward` | Reward bound but snapshot unreachable or fields incomplete · agency-only |
| `live` | Publish succeeded · all 3 gates passed · public |
| `closed` | Reward closed or capacity reached · terminal · public · greyed |

Plus the prior 6N-A enum values (`coming_soon`, `partially_funded`, `funded`) which the publish endpoint maps to from the reward-state.

### Reward states (Whop-derived · 10 values · cached on the row)

| Reward state | Signal |
| --- | --- |
| `unlinked` | No `whop_reward_id` on the row |
| `pending_reward` | Bound but validate failed |
| `connected` | Validate returned 200 · snapshot stored · Whop status pending |
| `live` | `status === "published"` AND `spotsRemaining > 0` AND `totalPaid < budgetAmount` |
| `funded` | `totalPaid < budgetAmount` AND status live |
| `partially_funded` | `acceptedSubmissionsCount > 0 AND < acceptedSubmissionsLimit` |
| `capacity_reached` | `spotsRemaining === 0` |
| `closed` | Whop status `archived` |
| `unreachable` | 5xx or network error |
| `not_visible` | 404 from Whop or Partner-gate trip |
| `stale` | Cache > 24h without refresh (currently flagged in UI · cron lands later) |

Both axes are explicitly separated. The publish endpoint maps reward state → campaign status (closed/capacity_reached → `closed` · live/funded/partially_funded → `live` · everything else → `coming_soon`).

---

## 6 · Screenshots of all 8 steps

| # | File | Shows |
| --- | --- | --- |
| 1 | `/tmp/lc-phase5b-polish/6n-e-01-step1-reward.png` | Step 1 fresh open · two co-equal options (Option A "Connect existing" with **PASTE** button · Option B "Create reward in Whop") · step-nav at top |
| 2 | `/tmp/lc-phase5b-polish/6n-e-02-step1-validated.png` | Step 1 after validate · `<WhopRewardCard>` shows LIVE · FUNDED state · clipboard COPY button on reward id · 4 stats grid · "Last synced just now · WHOP · source of truth" footer |
| 3 | `/tmp/lc-phase5b-polish/6n-e-03-step2-title.png` | Step 2 · defaults pulled from snapshot · campaign-type chip selector showing CLIP active · Whop suggestion hint |
| 4 | `/tmp/lc-phase5b-polish/6n-e-04-step3-banner.png` | Step 3 · 8 banner presets from `/brand/decks/*` + `/brand/sponsored/*` library · zero asset generation |
| 5 | `/tmp/lc-phase5b-polish/6n-e-05-step4-links.png` | Step 4 · brief links read-only view · reuses 6N-D v1 hook |
| 6 | `/tmp/lc-phase5b-polish/6n-e-06-step5-discussion.png` | Step 5 · discussion-channel picker over `useCommunity().channels` |
| 7 | `/tmp/lc-phase5b-polish/6n-e-07-step6-targeting.png` | Step 6 · Whop-allowed platforms surfaced as READ-ONLY · visibility tiers + required tier are agency-editable |
| 8 | `/tmp/lc-phase5b-polish/6n-e-08-step7-featured.png` | Step 7 · optional mission lane field |
| 9 | `/tmp/lc-phase5b-polish/6n-e-09-step8-review.png` | Step 8 · `<WhopRewardCard>` re-rendered for confirmation · review grid (slug · title · type · status · tiers) · Publish CTA |

---

## 7 · Verification results

| Check | Result |
| --- | --- |
| Backend Python imports | ✓ `from app.main import app` clean |
| Backend model columns | ✓ all 11 new columns present on `SponsoredCampaign` |
| Backend endpoint mounts | ✓ 6/6 endpoints registered (verified via `app.routes` introspection) |
| `npx tsc --noEmit` | ✓ exit 0 |
| 11-route leak sweep | ✓ all clean (`{ substrings: [], selectors: [] }`) |
| 8-step screenshots | ✓ captured · all steps render cleanly · honest reward-state surface |
| No new OAuth code | ✓ confirmed by grep · no new authorize/token-exchange endpoints added |
| No `bounty:create` scope request | ✓ confirmed · validate path reuses App API Key only |
| Campaign cannot launch without reward | ✓ enforced by `publish_campaign` 3-gate check + frontend `canAdvance` on step 1 |
| Whop is source of truth · LC duplicates nothing | ✓ economic fields read from snapshot only · no fork in payment accounting |

---

## 8 · Known gaps

| Gap | Impact | Resolution path |
| --- | --- | --- |
| Brief-link inline add/edit inside Step 4 | Step 4 currently shows links read-only · agencies use the existing CRUD endpoints from 6N-D v1 via direct API for now | Small polish pass · reuses `useCampaignAssetLinks().createLink/patchLink/removeLink` already shipped |
| 6h refresh cron | Snapshot can drift up to manual-refresh interval | Manual refresh button surfaces in `<WhopRewardCard>` everywhere · APScheduler job is small follow-up · plan documented in §10 of the implementation plan |
| `whop_reward_state = "stale"` derivation | Currently only `unlinked / pending_reward / connected / live / funded / partially_funded / capacity_reached / closed / unreachable / not_visible` come from the derivation. `stale` is reserved for the cron · UI ready, backend tag pending the cron |
| CampaignPageShell new reward section | Plan §6 called for a `<WhopRewardCard>` as the page's 2nd section · skipped in v1 because the existing 6N-B mock `Campaign` shape doesn't yet carry the new snapshot fields. Lands when `useCampaigns` reads from `agency_campaigns` rows | Single import + section insert · ~30 LOC |
| `<CampaignCard>` + `<CampaignBanner>` snapshot reads | Same root cause as above · discovery cards still read mocked `payoutRules` · safe because mock fallback path is still honest | Lands with the same useCampaigns refactor |
| Slug collision UX | Backend returns 409 · frontend toasts the error but doesn't auto-suggest a fix | Small polish |
| New REST `bnty_*` ids land as `not_visible` | Honest copy already in place · v1.5 OAuth path fixes |
| Agency role primitive | `is_admin_email` doubles as agency gate · documented · acceptable for v1 |

None of the gaps break the v1 ship.

---

## 9 · Recommended next phase

**Phase 6N-F · v1.5 · Whop agency OAuth + in-app reward creation.**

Per the locked direction · v1.5 is small and self-contained:

1. **Whop developer console** — add `bounty:create` scope to the existing Whop app's allowed scopes.
2. **Backend agency auth flow** — `GET /auth/whop/agency-start` + `/auth/whop/agency-callback`. Server-side code grant (not PKCE) · client_secret held by backend. Stores tokens in the v2-dormant `external_credentials` shape with the existing Fernet wrapper from 6N-D-1.
3. **`POST /agency/whop/create-reward`** — backend calls `POST https://api.whop.com/api/v1/bounties` with the stored agency token · returns the new `bnty_*` id + snapshot.
4. **Step 1 UI tweak** — Option B's CTA gains a parallel "Connect Whop · create here" path that fires the OAuth handshake then the create endpoint. Option B's existing "Open Whop ↗" stays as the no-OAuth path so agencies who haven't connected can still ship.

Estimated v1.5 size: ~1 day end-to-end. **Optional** · v1 stands on its own without it.

After v1.5, **Phase 6N-G** rounds out the user-facing snapshot reads:

1. Wire `useCampaigns` to read agency-created rows (`agency_campaigns` endpoints already exist).
2. Insert `<WhopRewardCard>` as `<CampaignPageShell>` section #2.
3. Swap mocked economic fields on `<CampaignCard>` + `<CampaignBanner>` for snapshot reads with fallback to current mock for unconnected rows.
4. Submission write path · `POST /me/reward-clips` from the campaign page's existing "Submit a clip" CTA · closes the loop.

After 6N-G, the v1 brief-link surface + reward connection + submission flow are end-to-end live.

Stopping after Phase 6N-E v1.
