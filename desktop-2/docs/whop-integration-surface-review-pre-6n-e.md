# Whop Integration Surface Review · pre-6N-E

Phase 6N-E gate: before any Agency Campaign Creation code lands, lock the product rule that **Whop is the economic source of truth** for clipping reward campaigns and verify which slices of Whop the backend can actually read today.

Status: read-only review. No code, no schema, no fixture changes.

Verified by reading:
- `junior-backend/app/routes/whop.py` (470 LOC · public + authenticated bounty proxy)
- `junior-backend/app/routes/webhooks_whop.py` (743 LOC · membership webhooks)
- `junior-backend/app/models.py` (FK columns for `whop_*` already in production)
- `junior-backend/app/config.py` (env-var gates)
- `junior-backend/app/routes/reward_clips.py` (how `whop_reward_id` is already consumed)
- `junior-backend/app/cron.py` (existing Whop polling)

---

## Executive answer

**Whop bounty reads are real and live in production today.** The backend already proxies `publicBounty` GraphQL through an App API Key with caching, IP rate limits, and partner gating. Liquid Clips can verify a pasted Whop reward URL/ID and trustfully surface most of the agency-facing fields without any new infrastructure. **Two important limits:** the backend's App API Key cannot see private discussion-post Mux assets, and Whop's webhooks only cover membership/billing events — not reward funding or submission acceptance, which means **the reward-state truth has to be polled, not pushed.**

The recommended 6N-E agency flow:

```
Whop Reward (Whop owns this row)
  ↓ paste URL / ID
Liquid Clips fetches via the existing /whop/bounties/{id} proxy
  ↓ on success
Liquid Clips Campaign row links to whop_reward_id (column already exists)
  ↓
Banner / Brief / Asset Links / Discussion / Leaderboard / Schedule
  (all already shipped or scoped per Phase 6N-A architecture)
```

No new entity needed. The `sponsored_campaigns.whop_campaign_id` + `whop_campaign_url` columns from the legacy Sponsored Campaigns sprint already exist — they need a small rename pass to read as `whop_reward_id` + `whop_reward_url` for the new mental model.

---

## 1 · What reward / bounty / content-reward data can be read today?

**Real, live, cached.** The backend has a working GraphQL proxy at `routes/whop.py` that hits Whop's `publicBounties` + `publicBounty(id:)` + `publicBountySubmission(id:)` queries via the server-side App API Key. No clipper-side OAuth required.

Available fields (confirmed against the running GraphQL query, `whop.py:132-203`):

| Field | What it is | Liquid Clips usage |
| --- | --- | --- |
| `id` | Whop reward id | The FK we store as `whop_reward_id` |
| `title` | Reward title | Campaign title default · agency can override |
| `description` | Reward description body | Campaign description default · markdown-ish |
| `baseUnitAmount` / `rewardPerUnitAmount` / `currency` | Per-view / per-action payout | The economic truth — display as "$X per 1k views" |
| `allowYoutube` · `allowTiktok` · `allowInstagram` · `allowX` | Target platforms allowed by the reward | Drives the Campaign's `target_platforms` column · NOT agency-editable |
| `acceptedSubmissionsLimit` / `acceptedSubmissionsCount` / `spotsRemaining` | Capacity | Drives `capacity_total` / `capacity_used` for clip + submission campaigns |
| `bountyType` | Reward type per Whop's enum | Discriminator hint for our `campaign_type` |
| `status` | Whop's reward lifecycle | Source of truth for active/expired/funded |
| `viewCount` · `totalPaid` · `budgetAmount` | Funding health | Drives "$X paid · $Y remaining" copy |
| `createdAt` · `updatedAt` | Lifecycle timestamps | Cache freshness signals |
| `user { username · name · profilePicture.sourceUrl }` | Reward owner | Brand attribution on the discovery card |
| `experience { id · name · logo.sourceUrl }` | Whop org/community | Maps to `business_unit` / brand badge |
| `attachments[]` | Direct file attachments on the reward | Read-only · paste-equivalent to brief links |
| `discussionPost.muxAssets[]` | Video thumbnails for the reward | **Partial · public Mux URLs work for thumbnails but the full discussion post requires user-OAuth** |

**Not readable from the App API Key (per the comment block at `whop.py:121-131`):**
- `Bounty.discussionPost.markdownContent` (the rich brief body — requires user-OAuth scope Junior doesn't have)
- Private membership-only rewards (only `publicBounty` surface is exposed)
- Other agencies' financial / payout reconciliation data (correctly walled off)

**Backend infrastructure already in place:**
- `_cache_get` / `_cache_put` with TTLs · `_BOUNTY_LIST_TTL` and `_BOUNTY_DETAIL_TTL` keep Whop happy
- IP sliding-window rate limit (`_PUBLIC_RATE_WINDOW_SEC = 60 / max 30 req`) on the public route
- Partner Engine gate — `WHOP_CAMPAIGN_B_ID` filters out the $10 RPM Partner-only campaign from non-Partners (404, not 403, to keep its existence opaque)
- `_normalize_bounty` adapter that flattens nested `user.profilePicture.sourceUrl` → flat `user.image` and derives a real video thumbnail from `discussionPost.muxAssets`
- Existing `RewardClip.whop_reward_id` linkage already in production (we already store + render `whop_reward_id` for every reward clip in the Earn route — see `routes/reward_clips.py:38-90`)

---

## 2 · Can we validate a pasted Whop reward URL/ID?

**Yes.** Two paths, both work today:

### 2.a · ID validation

Whop reward ids match a stable prefix pattern (`b_*` for bounties). The validator fires `GET /whop/bounties/{id}` against the existing proxy:

- 200 + `{ bounty: { ... } }` → valid reward · cache the normalized response for 6N-E preview rendering
- 404 → reward doesn't exist OR is Partner-only and caller is non-Partner (we deliberately can't tell which · honest UX is "we can't see this reward · check sharing on Whop")
- 502 → Whop unreachable · transient · retry

### 2.b · URL validation

Whop reward URLs follow a known pattern: `https://whop.com/<community>/c/<chat_feed>/...` for the community route and `https://whop.com/.../bounties/<id>` for the bounty page. The agency creation flow can regex-extract the trailing `b_*` id from any of these URL shapes:

```python
WHOP_REWARD_ID_RE = re.compile(r"\b(b_[a-zA-Z0-9_-]+)\b")
```

Then fall through to the ID validation path above. **No new endpoint needed** — the existing `GET /whop/bounties/{id}` is the single confirmation surface.

### 2.c · What we cannot validate

- Whether the reward is "fully funded" at runtime — `budgetAmount` is the static cap, `totalPaid` is the running tally; "fully funded" is a derived comparison.
- Whether the agency is allowed to attach this reward — Whop has no API for "verify this user owns this bounty". The MVP trust model is **the agency pastes a reward they control**. Mis-pasting is a UX paper cut, not a financial bug.

---

## 3 · Which reward states can be represented truthfully?

These are the states we can honestly compute from the existing proxy response:

| Reward state | Truthful source | UI surfacing |
| --- | --- | --- |
| **`unlinked`** | No `whop_reward_id` on the Liquid Clips Campaign row yet | "Connect a Whop reward to publish" gate |
| **`live`** | `bounty.status` is Whop's active state · `spotsRemaining > 0` | Green "Live" pill + payout summary from `rewardPerUnitAmount` |
| **`funded`** | `totalPaid < budgetAmount` AND `status` is active | "Fully funded · $X remaining" |
| **`partially_funded`** | Agency manually flagged OR derived from comparing `acceptedSubmissionsCount / acceptedSubmissionsLimit` | Amber pill |
| **`capacity_reached`** | `spotsRemaining === 0` | "All slots claimed · no more submissions" |
| **`closed`** | `bounty.status` is Whop's closed/expired enum | Greyed card · read-only |
| **`unreachable`** | 502 from Whop OR cache miss + Whop down | "Whop temporarily unreachable · last fetch X ago" |
| **`not_visible`** | 404 against the proxy (true 404 or Partner gate) | "We can't see this reward · check sharing settings on Whop" |
| **`stale`** | Cached row older than `_BOUNTY_DETAIL_TTL` AND the cron hasn't refreshed yet | Optional "Refreshing…" pill |

**Cannot represent truthfully** (would need user-OAuth scope or webhooks Whop hasn't shipped):
- Per-submission payout queue state (we get a snapshot via `publicBountySubmission(id:)`, but no event stream)
- Reward owner's full funding history (only the current `totalPaid`)
- Withdrawals · refunds · disputes
- Partner-only campaign details to non-Partners (intentional)

---

## 4 · What campaign states should exist before a reward is connected?

Recommend two pre-reward states on the Campaign row in addition to the existing lifecycle enum:

| Campaign state | Meaning | Visible to whom? |
| --- | --- | --- |
| **`draft`** | Agency created the row but hasn't connected a Whop reward yet · only the agency sees it · NOT discoverable | Agency only |
| **`pending_reward`** | Agency has filled in title / brief / asset links but the Whop reward URL/ID validation is still pending OR the reward is `unreachable` / `not_visible` from our side | Agency only |
| `coming_soon` | (existing) Reward connected · launch date in the future | Public |
| `partially_funded` | (existing) | Public |
| `funded` | (existing) | Public |
| `live` | (existing) Reward `live` AND `spotsRemaining > 0` | Public |
| `closed` | (existing) Reward `closed` OR `spotsRemaining === 0` | Public · greyed |

`draft` + `pending_reward` are the **new states required by 6N-E**. They give the agency room to lay out the Campaign UX (title / banner / brief / asset links / discussion provider) before the Whop reward is connected — which matches Option B in the brief (the agency creates the campaign first, funds the reward second).

When the agency connects a reward, the campaign auto-transitions:
- `draft + reward_live` → `live`
- `draft + reward_closed` → `closed`
- `draft + reward_unreachable` → `pending_reward`

A draft campaign cannot be published. The discovery card / public surface stays hidden until the Whop reward FK fills in AND the reward resolves.

---

## 5 · What should be mocked vs real?

| Surface | v1 truth | Why |
| --- | --- | --- |
| **Whop reward lookup by URL / ID** | **Real** (existing `/whop/bounties/{id}` proxy) | Already in production · zero new infra |
| **Reward economic fields** (`baseUnitAmount`, `rewardPerUnitAmount`, `budgetAmount`, `totalPaid`, `spotsRemaining`, `status`) | **Real** (proxy → Whop) | Whop is the source of truth · we just read |
| **Reward attachments** (`attachments[]`) | **Real, read-only** (proxy → Whop) · paste-equivalent to brief links | The audit's "Whop assets · partial" surface from `routes/whop.py:159` |
| **Reward thumbnail** (`discussionPost.muxAssets`) | **Real** (public Mux thumbnail URLs require no auth) | Already adapted by `_normalize_bounty` |
| **Reward rich description** | **Partial** (`description` text only · no markdown / muxAssets in the body) | App API Key limit · v2 user-OAuth project |
| **Campaign creation / banner / brief** | **Real** (Liquid Clips owns these · brief-link backend just shipped in 6N-D v1) | Liquid Clips is the execution layer |
| **Submission write** | **Real, mock-toast for now** (existing `POST /me/reward-clips` mints the tracking link; the actual Whop submission still requires the clipper to post on the platform + paste the URL) | Per the existing flow in `reward_clips.py:169-` |
| **Submission acceptance** | **Real on the read side · polled, not pushed** | No webhook from Whop for `submission.accepted` yet; existing `cron.py:209-` polls Whop on a schedule for `RewardClip.status` updates |
| **Reward funding webhook** | **Mock for the agency · real for the clipper** | Whop sends `membership.went_valid` for subscription billing but NOT for reward / bounty funding events |
| **Discussion mirror** | **Real** (Whop chat URL · existing `bus.emit("browse:open", { mirror: "whop" })` path) | Already shipped in 6L-B |
| **Reward payout settlement** | **Whop owns this end-to-end** | We never touch the money flow |

The **only fully-mocked piece** is the "create reward in Whop" deeplink target. Whop has a "Create Content Reward" page on the agency's dashboard at a stable URL — Liquid Clips can launch it via `bus.emit("browse:open", { url: WHOP_CREATE_REWARD_URL })` but cannot pre-fill any fields. The clean UX is: agency clicks "Create Reward in Whop" → browser opens Whop's create page → agency fills it out + funds → returns to Liquid Clips → pastes the URL/ID to connect.

---

## 6 · What schema/API changes are required before campaign creation begins?

Smaller than the original 6N-E plan. **No new tables, no new auth primitives.** Just column adds + one rename pass + one new validation endpoint.

### 6.a · Schema changes (Liquid Clips backend)

On the `sponsored_campaigns` table (renamed to `campaigns` per the Phase 6N-A architecture report):

| Column | Status | Action |
| --- | --- | --- |
| `whop_campaign_id` | ✓ exists today | **Rename to `whop_reward_id`** — old name carries the wrong mental model |
| `whop_campaign_url` | ✓ exists today | **Rename to `whop_reward_url`** |
| `whop_reward_snapshot` JSON | ✗ | **Add** · cached normalized response from `_normalize_bounty` so the discovery card renders without a Whop round-trip on every page load |
| `whop_reward_synced_at` timestamp | ✗ | **Add** · drives the "Refreshes every 6h" pill + cron picks rows older than 24h |
| `status` enum | needs extension | **Add `draft` and `pending_reward`** to the existing lifecycle enum |
| `created_by` FK users.id | ✗ | **Add** (already flagged in 6N-A · agency creator) |

All idempotent ALTER TABLE adds, matching the existing pattern at `main.py:63-` (lifespan).

### 6.b · New backend endpoint (one)

```
POST /agency/whop/validate-reward
  body: { input: string }      // either a URL or a bare b_* id
  auth: license JWT + admin    // agency role primitive lands later
  returns: { reward_id, snapshot: <_normalize_bounty>, source: "real|cache|unreachable" }
```

Wraps the existing `/whop/bounties/{id}` proxy with regex extraction and an honest unreachable state. The agency creation flow calls this once when the agency pastes the URL/ID.

### 6.c · Existing endpoints we reuse unchanged

- `GET /whop/bounties/{id}` — proxy already cached, rate-limited
- `GET /campaigns/{slug}/asset-links` — shipped in 6N-D v1
- `POST /agency/campaigns/{slug}/asset-links` (and the rest of the brief-link CRUD) — shipped in 6N-D v1
- `POST /me/reward-clips` — already wired for tracking-link mint + Whop submission binding
- `bus.emit("browse:open", …)` event for both the Whop chat mirror and the "Create Reward in Whop" deeplink

### 6.d · Frontend changes (modest)

| Change | Where | Purpose |
| --- | --- | --- |
| New `useWhopReward(input)` hook | `state/useWhopReward.ts` | Wraps the new validate endpoint · returns `{ status, reward, error }` |
| Campaign creation flow step "Connect Whop reward" | future agency creation flow component | Surfaces two CTAs · "Paste an existing URL/ID" or "Create one on Whop" (`browse:open` deeplink) |
| Campaign discovery card reads `whop_reward_snapshot` | `<CampaignCard>` | No Whop round-trip per render |
| `<CampaignPageShell>` reward section reads snapshot + falls back to "Whop unreachable" honesty | existing shell | Refresh button calls the validate endpoint |

### 6.e · What does NOT need to change

- **No agency-role primitive yet** — `is_admin_email` gate from 6N-D v1 carries forward unchanged. A real `agency_members` table lands when we actually have non-admin agencies onboarding.
- **No new Whop OAuth.** Everything works on the existing App API Key.
- **No new Webhook event handler.** Whop doesn't send the events we'd want anyway — we poll.
- **No new Asset Source / Ingestion infra.** 6N-D v1 brief links cover Whop's `attachments[]` field via paste-link parity.
- **No payment surface.** Whop owns the money flow end-to-end.

---

## Risks and known gaps

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Whop's `publicBounty` doesn't expose the rich discussion-post markdown | The brief body inside Liquid Clips is text-only without rich formatting | The agency can lay out a richer brief inside the Liquid Clips Campaign page (banner · description · brief links) · the Whop reward page handles its own marketing |
| Whop has no API for "verify this user owns this bounty" | Agency could paste someone else's reward · purely a UX bug, not a financial one | Trust the agency in v1 · log paste-vs-owner mismatches when we eventually have user-OAuth |
| Reward state changes (funding, capacity, close) are not pushed | The Liquid Clips snapshot may be stale up to the cron interval | Snapshot a 24h refresh window · "Refresh now" button forces a sync |
| Partner Engine gates aren't visible to agencies pasting Partner-only URLs from non-Partner accounts | Confusing "we can't see this reward" message | Documented in the validate endpoint's response · honest copy |
| Whop's "Create Reward" page may move | Deeplink target needs to be configurable | Store the URL in `whop_api_key`-adjacent config · easy patch |
| `App API Key` is a single shared key | Whop could rate-limit us | Existing IP rate limit + cache already handle this · acceptable for v1 |
| `attachments[]` is "rare in practice" per the existing comment | Agencies who depend on Whop attachments will mostly see empty arrays | 6N-D v1 brief links are the primary path · attachments are a bonus surface |
| Whop's `bountyType` enum may include types we don't map yet | Some rewards may not fit cleanly into `clip / coordination / affiliate / submission` | Default unknown types to `clip` · log for later inspection |

---

## Recommended 6N-E build order (after this review locks)

1. **Schema delta** — column rename pass on `sponsored_campaigns` (`whop_campaign_id → whop_reward_id`, etc.) + add `whop_reward_snapshot` JSON + `whop_reward_synced_at` + new `draft` / `pending_reward` enum values.
2. **Validate endpoint** — `POST /agency/whop/validate-reward`. Reuses the existing `_whop_gql` + `_normalize_bounty` machinery.
3. **`useWhopReward` hook + sidecar shim** — real-RPC → HTTP → mock fallback, same pattern as `useCampaigns` / `useCampaignAssetLinks`.
4. **Campaign creation flow** — 8 steps per the Phase 6N-A architecture, with **Step 1 "Connect Whop reward"** as the gate. Title / brief / banner / asset-links UX comes after the reward connects (or stays in `draft` if the agency wants to lay out the Liquid Clips side first).
5. **Discovery + page integration** — read `whop_reward_snapshot` instead of mocking economic fields.
6. **Refresh path** — manual refresh button + 6h cron · reuses existing TTL infrastructure.

**No 6N-E code until this review is approved.**

---

## Addendum · 2026-06-19 · Whop REST API + new bounty surface

Whop published a REST bounty API (`https://api.whop.com/api/v1/bounties` · OpenAPI spec at the URL Daniel pasted in the chat). This changes two things in the analysis above and reinforces a third.

### Add-1 · Bounty creation is now programmatically possible

Until today, the only way to create a bounty was through Whop's dashboard UI. The new spec exposes:

```
POST /api/v1/bounties             scope: bounty:create
GET  /api/v1/bounties/{id}        scope: bounty:create (auth required)
```

Request shape (required + relevant fields):

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | required |
| `description` | string | required |
| `base_unit_amount` | number | required · per-approved-submission payout |
| `currency` | enum | required · `usd / eur / gbp / …` plus crypto + `whop_usd` |
| `accepted_submissions_limit` | int / null | defaults to 1 · cap for "submission" campaigns |
| `allowed_country_codes` | string[] / null | ISO3166 list · empty = global · maps to Campaign `target_geos` |
| `business_goal_type` | enum / null | `clipping / post_engagement / owned_account_growth / ugc_content / local_activation / other` · **direct mapping to our `campaign_type` discriminator** |
| `experience_id` | string / null | scopes the bounty to a Whop experience (org/community) |
| `origin_account_id` | string / null | `user_*` or `biz_*` whose balance funds the pool · **requester must be that user or owner of that company** |
| `post_markdown_content` | string / null | richer brief body for the anchor forum post |
| `post_title` | string / null | overrides the anchor post title |
| `scheduled_publish_at` | datetime / null | when present, the bounty is created as a hidden draft |
| `scheduled_timezone` | string / null | IANA tz · required when scheduled |
| `scheduled_frequency` | enum / null | `once / hourly / daily / weekly / monthly` |

Response shape: `Bounty` object with `id` (`bnty_*`), `title`, `description`, `status` (`published / archived / scheduled`), `total_available`, `total_paid`, `currency`, `bounty_type` (`classic / user_funded / workforce`), `vote_threshold`, `created_at`, `updated_at`.

**What this changes for 6N-E:** Option B in the brief ("agency creates the reward in Whop, returns, then connects it") can now be augmented with a v2 path · **"Liquid Clips creates the bounty on Whop's REST API directly when the agency grants the scope."** Two practical sub-options:

- **Sub-option B.1 · "Open Whop to create" deeplink** — what the original brief described. Stays the v1 default because it works without any new auth primitive.
- **Sub-option B.2 · "Create on Whop in-app"** — calls `POST /api/v1/bounties` from the backend. **Requires the agency to authorise Liquid Clips with `bounty:create` scope on their Whop account first.** Per the API security note, the requester must be the user funding it (or owner of the company), and the existing junior-backend App API Key does NOT carry `bounty:create` scope — the App API Key is a different auth class than a user OAuth token or company-scoped JWT. So B.2 is **deferred** until we ship a Whop OAuth handshake similar to the one §6 listed for Drive/Dropbox in the v2 asset-source path.

**Recommendation for 6N-E v1:** ship Sub-option B.1 only. Sub-option B.2 lands when the Whop user-OAuth foundation lands (which would also unblock the richer `Bounty.discussionPost.muxAssets` reads flagged earlier).

### Add-2 · ID format expansion · `b_*` AND `bnty_*`

The legacy `publicBounty` GraphQL surface used `b_*` ids. The new REST `Bounty` resources use `bnty_*` ids (the spec example explicitly shows `bnty_xxxxxxxxxxxxx`). The two surfaces overlap on the same underlying object, but the URL extractor pattern in §2.b needs updating:

```python
# Updated regex · covers both legacy and new forms
WHOP_REWARD_ID_RE = re.compile(r"\b((?:b|bnty)_[a-zA-Z0-9_-]+)\b")
```

The validate-reward endpoint (`POST /agency/whop/validate-reward`) accepts both shapes and tries both surfaces in order:

1. If id matches `bnty_*` → try `GET /api/v1/bounties/{id}` first
2. If id matches `b_*` → try the existing `publicBounty(id:)` GraphQL first
3. Fall back to the other surface · either returns a normalized Campaign-ready snapshot

**Important:** the new REST `GET /api/v1/bounties/{id}` requires bearer auth with `bounty:create` scope — workforce bounties are private to the authenticated owner per the doc text "Retrieves a workforce bounty for the **current authenticated user**." So the read path for `bnty_*` ids is **not viable from the App API Key alone**. The legacy `publicBounty` GraphQL surface remains the practical read path until user-OAuth lands.

Concretely for v1: agencies pasting `bnty_*` ids from the new REST API will hit our validate endpoint and get "we can't see this reward · check sharing settings on Whop OR connect your Whop account." That's honest UX, matches the gating the existing `_filter_partner_only` enforces today, and degrades cleanly when user-OAuth lands.

### Add-3 · `business_goal_type` confirms our `campaign_type` taxonomy

The new spec's `business_goal_type` enum aligns well with the Phase 6N-A `campaign_type` discriminator:

| Whop `business_goal_type` | Liquid Clips `campaign_type` | Notes |
| --- | --- | --- |
| `clipping` | `clip` | Direct match — most common case |
| `ugc_content` | `submission` | UGC submissions = our submission campaign |
| `post_engagement` | `coordination` | Engagement pushes = coordination campaign |
| `owned_account_growth` | `affiliate` | Account growth via tracking links = affiliate campaign |
| `local_activation` | `coordination` | Local action coordination |
| `other` | `submission` (default) | Fallback |

The validate-reward endpoint can use this enum to **suggest a default `campaign_type`** when the agency pastes a reward — saving them a step in the creation flow. Agency can override.

### Add-4 · `bounty_type` is a separate orthogonal axis

Whop's `bounty_type` enum (`classic / user_funded / workforce`) is the implementation model of the bounty pool, not the business goal. Drives funding behaviour:

- `classic` — Whop's default bounty model
- `user_funded` — funded by the bounty creator
- `workforce` — what the new REST API creates (per the doc text "Create a new **workforce** bounty")

For 6N-E v1 the type doesn't affect Liquid Clips' campaign rendering — we read `total_available` + `total_paid` and display funding state regardless. Worth capturing in the snapshot for analytics / debugging.

### Add-5 · Still no bounty-state webhooks

The webhooks section of the docs only confirms `payment.succeeded`, `payment.failed`, and `membership.went_valid`. **No `bounty.*` events.** The "poll, not push" finding from §3 holds. Liquid Clips needs the 6h cron sync to keep `whop_reward_snapshot` fresh.

### Add-6 · Add to References

New reference to bookmark for future Whop work:

- `https://docs.whop.com/llms.txt` — documentation index
- `https://app.stainless.com/api/spec/documented/whopsdk/openapi.documented.yml` — full OpenAPI spec
- `https://api.whop.com/api/v1` (prod) · `https://sandbox-api.whop.com/api/v1` (sandbox) — REST API endpoints

### Net change to the 6N-E plan

No code change vs the original recommended 6N-E build order, BUT:

- §6.a · schema delta unchanged · still rename `whop_campaign_id → whop_reward_id`
- §6.b · the validate-reward endpoint regex updates to accept both `b_*` and `bnty_*` and tries both surfaces with honest fallback
- §6.b · validate response includes a `suggested_campaign_type` derived from `business_goal_type` when present
- §6.b · response schema captures `bounty_type` for analytics
- A **new column** on the Campaign row: `whop_reward_snapshot_business_goal` (string, nullable) so analytics can later see how often clippers picked `clipping` vs `ugc_content` campaigns
- **Defer Sub-option B.2** ("create in-app via REST") until Whop user-OAuth lands · honest about why
- Sub-option B.1 (deeplink to Whop's "Create Content Reward" page) remains the v1 default

The headline finding from this addendum: **Whop is moving in the direction we want.** A REST bounty API exists. A clean OAuth handshake to grant `bounty:create` scope to Liquid Clips is on Whop's side now, not Junior's. When it lands, Sub-option B.2 unlocks and the agency creation flow becomes a single in-app pass.

**No 6N-E code until this updated review is approved.**
