# Phase 6N-E · Agency Campaign Creation · Implementation Plan

Plan-only deliverable per the locked direction. **No code until this plan is approved.**

Locked rules carried into 6N-E:

- **Whop is the source of truth** for reward funding, bounty/reward pool, attribution, payout eligibility, approval workflow.
- **Liquid Clips is the execution layer** around the reward — banner, page, brief, asset links, discussion, leaderboard, scheduling, coordination.
- v1 uses the **safe deeplink / connect path**. No new Whop OAuth. No `bounty:create` scope. No in-app reward creation.
- Campaign **cannot launch** until a Whop reward is connected and valid.
- Do not duplicate Whop reward accounting · the Campaign row carries a cached snapshot, never a forked ledger.

In-app Whop reward creation, `bounty:create` scope, and OAuth-stored agency tokens are **deferred to Phase 6N-F (v1.5)**. See the backlog section at the bottom.

---

## 1 · State machine

Two independent axes:

### 1.a · Campaign-creation state (Liquid Clips owns this)

```
draft  ─────────────────┬─→ pending_reward ─────→ live ──────→ closed
                        │                            ↑              │
                        └────────────────────────────┘              │
                                                                    │
                       (auto-derived on reward-state transition)    ↓
                                                              (terminal)
```

| State | Meaning | Discoverable? |
| --- | --- | --- |
| `draft` | Agency created the Campaign shell, no Whop reward connected yet | No · agency-only |
| `pending_reward` | Agency entered all Liquid Clips-side fields (title / banner / brief / links / discussion / targeting) but Whop reward is `unreachable` or `not_visible` | No · agency-only |
| `live` | Whop reward is `connected` AND status maps to a Whop "live" state (`published` / funded / spots remaining) | **Yes** — public |
| `closed` | Whop reward closed OR `acceptedSubmissionsCount === acceptedSubmissionsLimit` | Greyed in discovery · public read-only |

**Publish gate.** A Campaign can only transition from `draft` / `pending_reward` to `live` when all three are true:

1. A `whop_reward_id` is bound to the row
2. The validate-reward endpoint returns `connected` (HTTP 200 with usable snapshot)
3. All required Campaign fields are filled (`title`, `description`, `campaign_type`, `target_platforms` derived from reward, `discussion_provider`, optional `featured_thumb_url`)

The agency clicks "Publish" → backend re-validates → if any gate fails, the Campaign stays in `pending_reward` with a clear error string.

### 1.b · Reward state (derived from Whop · cached on the Campaign row)

```
unlinked ─→ pending_reward ─→ connected ─→ live ─→ closed
                ↑                  │           │
                │                  ↓           ↓
                └─── unreachable   funded     capacity_reached
                       not_visible partially_funded
                       stale
```

| Reward state | Source-of-truth signal | UI behaviour |
| --- | --- | --- |
| `unlinked` | No `whop_reward_id` on the Campaign row | "Connect a Whop reward" CTA |
| `pending_reward` | `whop_reward_id` set but last validate returned an unrecoverable error OR snapshot missing | Amber pill · "Awaiting Whop reward · Retry" |
| `connected` | Last validate returned 200 · snapshot stored · status pending | Cyan pill · "Reward connected · awaiting Whop activation" |
| `live` | Snapshot `status === "published"` AND `spotsRemaining > 0` AND `totalPaid < budgetAmount` | Green pill · payout summary surfaces |
| `funded` | `totalPaid < budgetAmount` AND status "live" | "Fully funded · $X remaining" copy |
| `partially_funded` | `acceptedSubmissionsCount > 0 AND acceptedSubmissionsCount < acceptedSubmissionsLimit` | Amber pill |
| `capacity_reached` | `spotsRemaining === 0` | "All slots claimed · no more submissions" |
| `closed` | Snapshot `status` matches Whop's closed enum (`archived`) OR window expired | Greyed card · read-only |
| `unreachable` | 5xx from Whop OR network error on last fetch | "Whop temporarily unreachable · refreshes every 6h" |
| `not_visible` | 404 from Whop (true 404 OR Partner gate) | "We can't see this reward · check sharing settings on Whop" |
| `stale` | Snapshot `whop_reward_synced_at < now - 24h` | "Refreshing…" pill · manual refresh button visible |

**No fake-connected state.** If validate fails, the reward state is `pending_reward` / `unreachable` / `not_visible`. Never silently "connected".

---

## 2 · Schema delta (`junior-backend/app/models.py`)

All additive · idempotent ALTERs in `app/main.py` lifespan per the existing pattern.

### 2.a · `sponsored_campaigns` (will be renamed to `campaigns` in 6N-G; rename deferred)

| Column | Action | Type | Notes |
| --- | --- | --- | --- |
| `whop_campaign_id` | **rename** → `whop_reward_id` | string · indexed | Carries `b_*` (legacy GraphQL) OR `bnty_*` (new REST) ids |
| `whop_campaign_url` | **rename** → `whop_reward_url` | string · nullable | Stored as the canonical Whop page URL |
| `whop_reward_snapshot` | **add** | JSON · nullable | Cached normalized response from existing `_normalize_bounty` |
| `whop_reward_snapshot_business_goal` | **add** | string · nullable | One of `clipping / post_engagement / owned_account_growth / ugc_content / local_activation / other` |
| `whop_reward_snapshot_bounty_type` | **add** | string · nullable | `classic / user_funded / workforce` · for analytics |
| `whop_reward_synced_at` | **add** | timestamptz · nullable · indexed | Drives stale calculation + cron pickup |
| `whop_reward_last_error` | **add** | text · nullable | Last validate-reward failure reason (human-readable) |
| `whop_reward_state` | **add** | string · indexed | Cached reward-state enum from §1.b · avoids re-deriving every render |
| `campaign_type` | **add** (locked since 6N-A) | string · indexed | `clip / coordination / affiliate / submission` |
| `created_by` | **add** | FK users.id · SET NULL · indexed | Agency identity |
| `status` enum | **extend** | string · indexed | Add `draft` and `pending_reward` to the existing lifecycle enum |
| `description` | **add** | text · default '' | Was missing from the original table |

**No new tables.** Everything fits on the existing Campaign row.

### 2.b · `campaign_asset_links` (already shipped in 6N-D v1)

No changes. The 6N-D v1 brief-link surface carries forward unchanged. Agency creation flow's "Brief links" step reuses the existing CRUD endpoints.

### 2.c · Dormant v2 tables (untouched)

`external_credentials`, `campaign_asset_sources`, `asset_source_ingestion_jobs`, `credentials_crypto.py` stay dormant. 6N-E does **not** touch them.

---

## 3 · API surface

### 3.a · New endpoints

| Method | URL | Auth | Behaviour |
| --- | --- | --- | --- |
| `POST` | `/agency/whop/validate-reward` | License JWT + admin | Body `{ input: string }` (URL or id) · regex-extracts id (matches `b_*` OR `bnty_*`) · calls existing `_whop_gql` + `_normalize_bounty` · returns `{ reward_id, snapshot, business_goal, bounty_type, source: "real|cache|unreachable|not_visible" }` |
| `POST` | `/agency/campaigns` | License JWT + admin | Creates a `draft` Campaign · accepts optional `whop_reward_id` to skip straight to `pending_reward` · returns the new slug |
| `PATCH` | `/agency/campaigns/{slug}` | License JWT + admin | Edits the row · only allowed before `live` |
| `POST` | `/agency/campaigns/{slug}/connect-reward` | License JWT + admin | Body `{ whop_reward_id }` · calls validate · writes snapshot · re-evaluates campaign state |
| `POST` | `/agency/campaigns/{slug}/publish` | License JWT + admin | Re-validates · enforces the 3-gate check (§1.a) · transitions `draft` / `pending_reward` → `live` · 422 with clear field if any gate fails |
| `POST` | `/agency/campaigns/{slug}/refresh-reward` | License JWT + admin | Force-sync · ignores the 6h cache · returns new snapshot |

### 3.b · Existing endpoints reused unchanged

| Endpoint | Source | Why |
| --- | --- | --- |
| `GET /whop/bounties/{id}` | `routes/whop.py` (already in production) | The validate-reward endpoint calls this internally · already cached + rate-limited + Partner-gated |
| `GET /campaigns/{slug}/asset-links` + `POST/PATCH/DELETE/reorder` | shipped in 6N-D v1 | Brief-links step in agency creation reuses the write path |
| `GET /community/channels` | shipped in 6L-A | Discussion provider step picks a Whop chat for the campaign discussion |
| `bus.emit("browse:open", { url, mirror: "whop" })` | shipped in 6L-B | The "Create reward on Whop" deeplink CTA fires this · existing default subscriber opens the user's browser |

### 3.c · Cron sync

A new APScheduler job runs every 6h:

```
For each Campaign WHERE whop_reward_id IS NOT NULL
  AND (whop_reward_synced_at IS NULL OR whop_reward_synced_at < now - 6h)
  AND status != 'closed':
    refresh-reward (internal · no per-IP rate limit)
    on failure: bump whop_reward_last_error, log
    on success: rewrite snapshot, update whop_reward_state
```

This is the existing pattern for `users.cached_lifetime_earnings_usd` (already in `cron.py`). One new function, same APScheduler instance.

---

## 4 · Agency creation flow (8 steps · locked)

The Campaign creation flow lives as a multi-step component inside the existing Campaigns route. **It does not become its own DOS route** — it's a drawer/page mounted on top of the existing discovery surface.

| Step | Title | What lands on the row | Whop dependency |
| --- | --- | --- | --- |
| 1 | **Connect Whop reward** | `whop_reward_id` + initial snapshot · or skip with "Open Whop to create" deeplink | Hard · only step that calls validate-reward |
| 2 | **Title + description** | `title` · `description` · `campaign_type` (default from `business_goal_type` · agency override allowed) | Soft · defaults pulled from snapshot |
| 3 | **Banner + thumb** | `banner_url` · `featured_thumb_url` · agency-uploaded OR reused from brand assets | None |
| 4 | **Brief links** | Calls existing CampaignAssetLink CRUD · 6N-D v1 surface · agency adds Drive / Dropbox / Whop / direct / upload-note rows | None |
| 5 | **Discussion** | `discussion_provider` (`whop` only in v1) + `community_channel_id` (picker from existing `/community/channels`) | None (the Whop chat is already separate from the reward) |
| 6 | **Targeting + visibility** | `target_platforms` (inherited from Whop reward `allowYoutube/Tiktok/Instagram/X`) · `visibility_tiers` · `required_tier` · `tier_rules` JSON | Soft · platforms inherited from snapshot |
| 7 | **Featured/sponsored** *(optional)* | `placement_quality` + `placement_metadata` · stub-billing per 6N-A | None |
| 8 | **Review + Publish** | Calls `POST /agency/campaigns/{slug}/publish` · row transitions to `live` IF the 3-gate check passes | Hard · re-validates the reward |

**Step 1 sub-options** (per the brief):

- **A · Paste an existing reward URL/ID** → calls `POST /agency/whop/validate-reward`
  - On `connected` → Campaign moves to `pending_reward` with snapshot
  - On `unreachable` → Campaign stays `draft`, retry CTA
  - On `not_visible` → Campaign stays `draft`, "check Whop sharing settings" copy
- **B · Open Whop to create** → `bus.emit("browse:open", { url: WHOP_CREATE_REWARD_URL, mirror: "whop" })`
  - User funds + configures reward on Whop in their browser
  - User returns to Liquid Clips
  - Drops into Sub-option A (paste the new URL/ID)
- **C · Coming soon: in-app create** → disabled stub in v1 · tooltip says "Lands in Phase 6N-F · connects your Whop account first"

The agency can **save and exit** at any step. Saving partial state writes the Campaign as `draft`. Returning later resumes from the highest completed step.

---

## 5 · Frontend layer

### 5.a · New hooks

| Hook | File | Surface |
| --- | --- | --- |
| `useWhopReward(input)` | `src/design-os/state/useWhopReward.ts` | `{ status, reward, suggestedCampaignType, suggestedTargetPlatforms, error }` · debounce 400ms on input change · real-RPC → HTTP → mock |
| `useAgencyCampaignDraft(slug \| "new")` | `src/design-os/state/useAgencyCampaignDraft.ts` | The 8-step state container · save / patch / publish / discard · same template as other hooks |

`useAgencyCampaignDraft("new")` returns a blank draft; passing a real slug resumes a saved draft.

### 5.b · New sidecar methods

| Method | RPC name | HTTP endpoint |
| --- | --- | --- |
| `agencyWhop.validateReward({ input })` | `validate_whop_reward` | `POST /agency/whop/validate-reward` |
| `agencyCampaigns.create({ payload })` | `agency_create_campaign` | `POST /agency/campaigns` |
| `agencyCampaigns.patch({ slug, payload })` | `agency_patch_campaign` | `PATCH /agency/campaigns/{slug}` |
| `agencyCampaigns.connectReward({ slug, whopRewardId })` | `agency_connect_reward` | `POST /agency/campaigns/{slug}/connect-reward` |
| `agencyCampaigns.publish({ slug })` | `agency_publish_campaign` | `POST /agency/campaigns/{slug}/publish` |
| `agencyCampaigns.refreshReward({ slug })` | `agency_refresh_reward` | `POST /agency/campaigns/{slug}/refresh-reward` |

All follow the existing real-RPC → HTTP → mock fallback pattern with `shouldTryHttpBackend()` + `authHeaders()`.

### 5.c · New components

| Component | Purpose |
| --- | --- |
| `<AgencyCreationFlow>` | The 8-step container · mounted as a `<Drawer width={640}>` over the Campaigns route |
| `<StepConnectReward>` | Step 1 · paste input + deeplink button + validate-reward call + result preview |
| `<StepTitleDescription>` | Step 2 · auto-fills from snapshot |
| `<StepBannerThumb>` | Step 3 · uses existing `/brand/decks/*` + `/brand/sponsored/*` art |
| `<StepBriefLinks>` | Step 4 · wraps the existing 6N-D v1 hook for write mode |
| `<StepDiscussion>` | Step 5 · picker over `useCommunity().channels` (existing) |
| `<StepTargeting>` | Step 6 · platforms inherited from snapshot, visibility tiers from `useTierCaps` |
| `<StepFeatured>` | Step 7 · optional · stub-billed |
| `<StepReviewPublish>` | Step 8 · publish gate · clear field-level errors on failure |
| `<WhopRewardCard>` | Re-usable read-only card showing reward title / payout / capacity / state · used in step 1 preview AND step 8 review AND `<CampaignPageShell>` reward section |

### 5.d · Existing component changes

| Component | Change |
| --- | --- |
| `<CampaignsRoute>` | Add "Create campaign" CTA top-right (admin-only) · opens `<AgencyCreationFlow>` |
| `<CampaignCard>` | Read reward economic fields from `whop_reward_snapshot` instead of mocked `payoutRules` for connected campaigns · keep mocked path as fallback for `unlinked` / `pending_reward` |
| `<CampaignBanner>` | Same change · same fallback |
| `<CampaignPageShell>` | New top section `<WhopRewardCard>` showing the snapshot · refresh button · "Refreshes 6h" pill (matches existing leaderboard pill style) · honest unreachable state |
| `<RewardClipDrawer>` | (Earn route · already shipped) · "Campaign" line already resolves via `useCampaigns().getById` · no change needed |

---

## 6 · CampaignPageShell change in detail

Current sections:
1. Hero banner
2. About / description
3. Reward (mock)
4. Payout (mock)
5. Timing
6. **Brief links** (6N-D v1 · live)
7. Discussion (live)
8. Leaderboard preview
9. Submission CTA

Updated structure:

1. Hero banner *(unchanged)*
2. **Whop reward card** *(new · reads snapshot · refresh button)*
3. About / description *(unchanged)*
4. Reward *(reads snapshot for `total_available` / `total_paid` / `currency`)*
5. Payout *(reads snapshot for `baseUnitAmount` / `rewardPerUnitAmount` / `acceptedSubmissionsLimit`)*
6. Timing *(unchanged · campaign-side timing only)*
7. Brief links *(unchanged)*
8. Discussion *(unchanged)*
9. Leaderboard preview *(unchanged)*
10. Submission CTA *(unchanged · still a stub toast in v1 · real submission write path lands in a later phase)*

The new `<WhopRewardCard>` shows:
- Reward title (truncated to 60 chars)
- Reward-state pill (one of the 10 states from §1.b)
- `total_paid / total_available · currency` line
- `acceptedSubmissionsCount / acceptedSubmissionsLimit · spotsRemaining` line
- "Last synced X ago · Refresh" footer with manual refresh button

When state is `unreachable` / `not_visible`, the card collapses to a 1-line honesty banner: "We can't see this reward right now. Refreshes automatically every 6h."

---

## 7 · Build sequence (recommended order · 8 sub-phases)

Each sub-phase is shippable on its own and verifiable in isolation.

| # | Sub-phase | Goal | Verification |
| --- | --- | --- | --- |
| 1 | Schema delta | Add the 9 new columns + 2 enum values · idempotent ALTERs | Python import check · `Base.metadata.create_all` runs · existing routes unaffected |
| 2 | `validate-reward` endpoint + refresh cron | Wraps existing `_whop_gql` · regex matches both id shapes · cron processes stale rows | curl against running backend · 2 test reward ids (one valid · one bogus) |
| 3 | `useWhopReward` + sidecar shim | Frontend can validate a pasted URL/ID and render the snapshot | tsc + 11-route leak test · screenshot of validate result |
| 4 | `<WhopRewardCard>` + CampaignPageShell integration | Existing discovery → existing detail surface now reads from snapshot | screenshots: `live` / `pending_reward` / `unreachable` states |
| 5 | `useAgencyCampaignDraft` + sidecar shim + draft endpoints | Backend write path for `draft` Campaigns · save / patch / discard | curl smoke + tsc |
| 6 | `<AgencyCreationFlow>` 8-step component | Read-only at first · agency can step through and save partial draft | tsc + leak test · screenshots of all 8 steps |
| 7 | Publish endpoint + 3-gate check + state transitions | Agency clicks "Publish" · backend re-validates · row transitions to `live` | curl smoke with bad data (each gate fails) · then good data |
| 8 | CampaignCard + CampaignBanner snapshot reads + verification | Discovery card + featured banner show real Whop data when the row has a snapshot | screenshots: discovery grid · featured banner · mock fallback when no snapshot |

**Stop and report after each sub-phase if risk appears.** The schema delta is the most cross-cutting; verify it cleanly before moving on.

---

## 8 · Mock vs real (locked truth matrix)

| Surface | v1 truth | Notes |
| --- | --- | --- |
| Reward lookup by URL/ID | **Real** | Existing `/whop/bounties/{id}` proxy · App API Key |
| Reward economic fields | **Real** | `baseUnitAmount`, `rewardPerUnitAmount`, `budgetAmount`, `totalPaid`, `spotsRemaining`, `status` |
| Reward `business_goal_type` → `campaign_type` mapping | **Real** | New field on the REST response · maps cleanly per Add-3 of the prior review |
| Reward attachments (`attachments[]`) | **Real, read-only** | Same proxy · "rare in practice" per the existing comment · acceptable bonus surface |
| Reward thumbnail (`muxAssets`) | **Real** | Public Mux URLs · already adapted by `_normalize_bounty` |
| Rich markdown body | **Partial** | App API Key limit · v2 user-OAuth project |
| Campaign creation / banner / brief | **Real** | Liquid Clips owns these · brief-link backend just shipped in 6N-D v1 |
| Discussion provider + Whop mirror | **Real** | Shipped 6L-B |
| Submission write | **Stub toast in v1** | Real `POST /me/reward-clips` exists · UI write path lands in a later phase |
| Submission acceptance | **Real on the read side · polled, not pushed** | No Whop webhook for `bounty.*` events · cron sync at 6h |
| Reward funding webhook | **Polled** | Whop doesn't send `bounty.funded` · cron + manual refresh |
| Whop in-app creation | **Stub deeplink in v1** | Deferred to Phase 6N-F (v1.5) |
| Whop OAuth token storage | **None in v1** | Deferred to Phase 6N-F |
| Reward payout settlement | **Whop owns end-to-end** | We never touch the money flow |

---

## 9 · Known gaps + risks

| Gap / risk | Impact | Plan |
| --- | --- | --- |
| Whop has no webhook for `bounty.funded` / `submission.accepted` | Snapshot can drift up to the 6h cron interval | Manual refresh button surfaces in `<WhopRewardCard>` |
| `is_admin_email` gate doubles as the agency role | Non-admin agencies can't create campaigns until the agency-role primitive lands | Documented · acceptable for v1 |
| Whop `publicBounty` doesn't expose rich discussion-post markdown | Brief body inside Liquid Clips is plaintext | Agency can lay out richer brief inside the Campaign page (banner / description / brief links) |
| `bnty_*` ids from the new REST API are not readable from our App API Key | Pasting a brand-new REST-API-created reward yields `not_visible` | Honest copy: "We can't see this reward · the new Whop REST is OAuth-only" · resolves when 6N-F ships |
| Partner Engine gate is invisible to non-Partner agencies | Confusing 404 if they paste a Partner-only id | Documented in the validate endpoint's response · honest copy |
| `App API Key` is a single shared key | Whop could rate-limit us | Existing IP rate limit + 6h cache · acceptable for v1 |
| Currency support is wide (USD + crypto + many fiats) | UI may need to render unusual symbols | `<WhopRewardCard>` reads `currency` from snapshot · uses `Intl.NumberFormat` |
| Stuck `pending_reward` rows could accumulate | DB hygiene · cosmetic | Cron sweep at 7d: rows in `pending_reward` for > 7d move to `draft` with a clear `whop_reward_last_error` |
| Campaign rename mid-creation could orphan brief links | Brief links FK by `campaign_id` not slug · safe | Slug rename is also fine; FK is by `id` |
| `whop_reward_snapshot` JSON could grow unbounded | DB row size · low risk | Capped at top-level fields only · no recursive attachments[] expansion in cache |

---

## 10 · Verification approach

Each sub-phase deliverable verifies in the same lane the prior phases did:

- **Python import check** after schema delta and route adds — `app.main` imports clean.
- **`npx tsc --noEmit`** green after every frontend sub-phase.
- **`window.__lcRunLeakTest()`** clean on all 11 routes (home / create / engine / studio / thumbnail / export / channels / schedule / community / earn / campaigns).
- **Curl smoke** against the backend for the 6 new endpoints:
  - `validate-reward` with valid id → 200 + snapshot
  - `validate-reward` with bogus id → expected 4xx with truthful error code
  - `agency/campaigns` create + patch + connect-reward + publish + refresh-reward round-trip
- **Screenshots** for the agency creation flow: every step at least once · published / pending_reward / unreachable states surfaced.
- **No new audit reports.** Plan + truth from the existing reports is enough.

---

## 11 · v1.5 backlog (Phase 6N-F · explicitly out of 6N-E scope)

| Item | Why deferred |
| --- | --- |
| Add `bounty:create` to Whop app's allowed scopes (developer console) | Whop approval step · separate cycle |
| `GET /auth/whop/agency-start` + `/auth/whop/agency-callback` | Sibling to existing login flow · server-side code grant (not PKCE) |
| `WhopAgencyCredential` table (or reuse dormant `ExternalCredential` shape) | Encrypted-at-rest via existing `credentials_crypto.py` Fernet wrapper |
| `POST /agency/whop/create-reward` | Backend calls `POST https://api.whop.com/api/v1/bounties` on the agency's behalf |
| Replace step-1 sub-option C "Coming soon" stub with real "Connect Whop · create here" CTA | The visible UX delta |
| In-app reward edit / archive | Optional · only after creation works |

Estimated v1.5 size: ~1 day end-to-end. Tracked separately so 6N-E ships without scope creep.

---

## 12 · Files-list preview (for build approval reference)

When sub-phase 1 of build begins:

**Backend (new):**
- `junior-backend/app/routes/agency_campaigns.py` — 6 endpoints
- `junior-backend/app/routes/agency_whop_validate.py` — 1 endpoint (could merge into agency_campaigns; recommend separate for clarity)
- migrations in `app/main.py` lifespan: ~9 ALTER TABLE statements

**Backend (modified):**
- `app/models.py` — add 9 columns + 2 enum values to `SponsoredCampaign`
- `app/main.py` — mount new routers + add lifespan ALTERs + register cron job
- `app/cron.py` — add `refresh_whop_reward_snapshots()` job

**Frontend (new):**
- `src/design-os/state/useWhopReward.ts`
- `src/design-os/state/useAgencyCampaignDraft.ts`
- `src/design-os/agency-creation/AgencyCreationFlow.tsx`
- `src/design-os/agency-creation/steps/{StepConnectReward,StepTitleDescription,StepBannerThumb,StepBriefLinks,StepDiscussion,StepTargeting,StepFeatured,StepReviewPublish}.tsx`
- `src/design-os/agency-creation/WhopRewardCard.tsx`
- `src/design-os/agency-creation/index.ts`
- per-file CSS

**Frontend (modified):**
- `src/design-os/engine/sidecar-stub.ts` — `agencyWhop.*` and `agencyCampaigns.*` blocks
- `src/design-os/routes/Campaigns.tsx` — admin-only "Create campaign" CTA
- `src/design-os/campaigns/CampaignCard.tsx` — snapshot-first economic fields
- `src/design-os/campaigns/CampaignBanner.tsx` — same
- `src/design-os/campaigns/CampaignPageShell.tsx` — new `<WhopRewardCard>` section + reward/payout sections reading snapshot

**Reports (new):**
- `docs/phase-6n-e-truth.md` — what shipped, mock/real matrix, verification results

---

## 13 · Sign-off checklist before code begins

- [ ] Plan approved
- [ ] No new OAuth in 6N-E (confirmed)
- [ ] No `bounty:create` scope (confirmed)
- [ ] No in-app reward creation in 6N-E (confirmed)
- [ ] Whop is source of truth for reward funding (locked)
- [ ] Liquid Clips owns execution layer (locked)
- [ ] Publish gate requires connected + valid reward (locked)
- [ ] Reward state representation matches §1.b (10 states · no fake "connected")
- [ ] Schema delta uses idempotent ALTERs (no destructive migration)
- [ ] v1.5 backlog tracked separately as Phase 6N-F

When approved, sub-phase 1 (schema delta) is the first build action.

**No code until this plan is approved.**
