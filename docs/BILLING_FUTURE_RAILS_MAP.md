# Billing · Attribution · Payouts · Future-Rails Map

> TASK 7C deliverable. Maps the **current source of truth** for every
> billing / attribution / earnings / limits surface in Liquid Clips
> Desktop 2.1, and documents the **insertion points** future sovereign
> rails (Sui payouts · attribution engine · proxy settlement) can drop
> into WITHOUT changing the shell architecture.
>
> No implementation. No new architecture. No build.
>
> Audit date: 2026-06-22

---

## Section 1 · Current source of truth (by domain)

### 1.1 Whop subscriptions
- **Source of truth**: Whop (external). Clerk remains the identity provider.
- **Backend ingress**: `junior-backend/app/routes/webhooks_whop.py` (Standard Webhooks-verified, idempotent via `WebhookEvent.external_id`).
- **What we cache locally**: `users.tier`, `users.subscription_status`, `users.paid_until`, `users.extra_accounts_purchased` (Account Pack add-ons).
- **JWT mint**: `junior-backend/app/routes/desktop.py:POST /desktop/connect` embeds `tier` + `founder_flag` into the license JWT (Ed25519, 30 days, auto-rotated by `/sync` when ≤ 5 days remaining).
- **Desktop reads**: `desktop-2/src/lib/activation.ts` parses the JWT, `desktop-2/src/design-os/state/useTierCaps.ts:mapBackendTier()` collapses the backend `free` / `solo` / `pro` / `agency` strings into the client enum `clipper` / `pro` / `agency`.
- **Tier UI gate**: TopHud → Settings → upgrade button reads tier-aware copy (`tier.tier === "clipper" ? "View plans" : "Manage plan"`).
- **Insertion point**: any future settlement layer plugs in below the JWT at a billing webhook handler. The shell never needs to know.

### 1.2 Whop rewards (campaigns + bounties + content rewards)
- **Source of truth**: Whop API.
- **Backend ingress**: `junior-backend/app/routes/webhooks_whop.py` (Standard Webhooks-verified). Also the proxy in `junior-backend/app/routes/whop.py` for live queries.
- **What we cache locally**:
  - `users.whop_user_id`, `users.whop_affiliate_id` (NEVER overwritten post-signup).
  - `SponsoredCampaign.whop_reward_id`, `SponsoredCampaign.whop_reward_state`, `SponsoredCampaign.whop_reward_snapshot_status`, `SponsoredCampaign.whop_reward_url`.
  - `RewardClip` rows (per-platform tracking links, accountLabel, clipIdx).
- **What lives only on Whop**: the actual money. `affiliate_members_count`, `total_referrals_count`, `monthly_recurring_revenue_usd`, `total_referral_earnings_usd` are fetched via `/affiliate/me` on demand.
- **Desktop reads**: `desktop-2/src/design-os/state/useRewardClips.ts` (clip-level earn rows), `desktop-2/src/design-os/state/useCampaigns.ts` (campaign discovery), `desktop-2/src/design-os/state/useEarnSummary.ts` (rolled-up totals for the Home strip + Earn route — single source of truth, BUG-040 lock).
- **Insertion point**: future direct payouts (USDC, Sui) become an ALTERNATIVE payout rail. The Whop rewards table stays. A new `Payout` model + a new payout-provider field is the entire shell-side change.

### 1.3 Referral attribution
- **Source of truth**: `users.affiliate_id` + Whop referral graph.
- **First-touch lock**: `junior-backend/app/routes/affiliate.py:166` — `users.affiliate_id` is locked at signup and **NEVER overwritten** (per `oauth-billing.md` §6). Spec-locked in `~/code/jnr/junior-backend/CLAUDE.md`.
- **Click ledger**: `liquidclips-marketing/src/app/api/referrals/click/route.ts` (POST) → `referral_clicks` table (IP hash + UA fingerprint + country + landed path).
- **Code generation**: `liquidclips-marketing/src/lib/referralCode.ts` (8-char Base62, no `0/O/1/l/I`).
- **Middleware capture**: `liquidclips-marketing/src/middleware.ts` intercepts `?ref=CODE`, stores cookie, fires the click-log POST.
- **Qualification rule**: `junior-backend/app/routes/affiliate.py:36-46` — 2 paid referrals OR 11k verified views (Whop-verified). 50% recurring from customer #3 onward.
- **Insertion point**: a future sovereign attribution engine becomes the SOURCE that writes to `users.affiliate_id` at signup. The 50%-recurring + qualification rules are policy that lives in `affiliate.py:_qualify()` — replace one function, the rest of the system is unchanged.

### 1.4 Agency limits (tier-derived ceilings)
- **Source of truth**: `junior-backend/app/features.py:FEATURES_BY_TIER` (canonical) + `junior-backend/app/features.py:TIER_LIMITS` (TASK 3 numeric caps).
- **What's enforced**:
  - Server-side: `channels-per-platform`, `monthly-posts`, `campaigns-per-brand`, `clips-per-campaign`, `bulk-scheduling-rows` (TASK 3 closed these as P0 hardening gaps).
  - Server-side (pre-TASK 3): channels-total (`routes/channels.py:_max_channels_for`), publish-now (`routes/publish.py:_require_paid_tier` → 402), starter-pass exports (`routes/usage.py:STARTER_EXPORT_CAP`, IP-pool gate), submissions-per-day (`routes/submissions.py:_MAX_SUBMISSIONS_PER_DAY` → 429).
- **Client mirror**: `desktop-2/src/design-os/state/useTierCaps.ts:TIER_CAPS` (regression-locked by `tier_enforcement_backend` test to match the server matrix exactly).
- **Bypasses**: admin-email allowlist, `founder_flag`, grace-period for `canceled`/`past_due` subscriptions until `paid_until` expires. All documented in `LAUNCH_2_1_AUDIT.md` TASK 3.
- **Insertion point**: any future limit (e.g. "Sui-staked seat") becomes a new key on the `TIER_LIMITS` dict + a corresponding route guard. Existing limits stay.

### 1.5 Watermarks
- **Source of truth**: `useTierCaps.watermarkLocked` (per-tier · `clipper: true`, `pro / agency: false`) joined with the campaign's `watermark_required` field at publish time.
- **Single derived promise**: `desktop-2/src/design-os/engine/cockpit/watermarkPromise.ts` (`deriveWatermarkPromise` — BUG-036 lock). The cockpit Style module + PublishModule + ScheduleModule all read from this one derivation.
- **Server enforcement**: `routes/publish.py` passes `watermark` flag through to `ayrshare.post()`. The export pipeline (`sidecar.export_clip`) bakes the watermark into the MP4 when the promise says so.
- **Free-tier safety**: when tier is unknown OR free, `watermarkPromise.effective` returns `true` even if the customer disabled the toggle — the exporter cannot ship a clean MP4 the UI never promised (BUG-036 lock).
- **Insertion point**: future "remove watermark" entitlements (e.g. a Sui NFT-gated watermark unlock) plug into the same `deriveWatermarkPromise` function with one new branch. No surface-level changes.

### 1.6 Earnings
- **Source of truth (current)**: Whop affiliate ledger + `RewardClip` rows in `junior-backend`.
- **Cache**: `users.cached_lifetime_earnings_usd`, `users.cached_paid_referrals`, `users.cached_earnings_at`. Refreshed by the `/affiliate/me` proxy (server-to-server) + the `RewardClip` cron.
- **Desktop read**: `useEarnSummary` (Home strip + Earn route, BUG-040 single-source lock). Source pill: `live · backend` when Whop reachable, `Backend offline · preview only` otherwise.
- **Stripe Connect fallback**: non-Whop affiliates onboard via `junior-backend/app/routes/stripe_connect.py` → status tracked in `users.stripe_connect_status`.
- **Insertion point**: a future Sui USDC payout rail is a NEW provider next to Whop + Stripe Connect. Update `useEarnSummary` to read from a unified `/me/earnings` endpoint that aggregates across providers; the UI never changes.

### 1.7 Connected accounts
- **Source of truth**: Ayrshare profiles (one per platform handle).
- **Backend table**: `social_channels` (`junior-backend/app/models.py:SocialChannel`).
- **Provisioning**: `junior-backend/app/routes/channels.py:POST /channels` calls `ayrshare.create_profile()`, returns `link_url` (Ayrshare hosted OAuth). The desktop opens a Tauri child WebviewWindow to walk the user through the platform OAuth.
- **State**: per-channel `status: "pending_link" | "active" | "expired" | "deleted"`. Updated by webhook events from Ayrshare.
- **Limits**: tier-derived `accounts_included` (Free 1 · Solo 5 · Pro 10 · Agency 25) + Clerk Account Pack add-on (+1 per $6/mo).
- **Insertion point**: future native OAuth (bypassing Ayrshare) becomes an ALTERNATIVE provider on the same `social_channels` table. Add a `provider: "ayrshare" | "native" | "sui-attested"` discriminator + new route handlers. Existing channel-count caps stay.

---

## Section 2 · Replacement map · how Sui rails plug into the existing shell

> No code is written for this. This section documents WHERE the
> sovereign attribution + payout engine drops in so the desktop shell
> never has to know it changed providers.

### 2.1 Attribution engine
| Surface today | Provider | Replacement |
|---|---|---|
| `users.affiliate_id` first-touch lock | Whop affiliate cookie + marketing middleware | Sovereign attribution writes the same `affiliate_id` column. Shell unchanged. |
| Click ledger | `referral_clicks` table on marketing Postgres | Sui-anchored attestations write to the same row, with an extra `chain_id` + `tx_hash` column. Backwards-compatible. |
| Qualification (2 paid · 11k verified views) | `junior-backend/app/routes/affiliate.py:_qualify()` | Replace one function. Existing 50%-recurring + threshold logic stays. |
| Earnings display | Whop API roll-up via `useEarnSummary` | Add `/me/earnings/unified` that joins Whop + Sui ledger; shell reads the same shape. |

### 2.2 Payout engine
| Surface today | Provider | Replacement |
|---|---|---|
| Affiliate payout | Whop-native or Stripe Connect (per `users.stripe_connect_status`) | Add `users.sui_payout_address` + a `provider: "whop" \| "stripe" \| "sui"` field on a new `Payout` row. The earn page UI is provider-agnostic. |
| Tier purchase | Whop product → `apply_membership_tier` webhook | Add a Sui-purchase webhook that also writes to `users.tier` + `users.paid_until`. JWT mint and `/sync` rotation don't change. |
| Account Pack add-ons (+1 account per $6/mo) | Clerk webhook bumps `users.extra_accounts_purchased` | Sui-token-gated seats bump the same column. Cap derivation (`features.account_limit()`) is unchanged. |

### 2.3 Proxy settlement network
| Surface today | Provider | Replacement |
|---|---|---|
| Per-platform posting (publish) | Ayrshare proxy via `junior-backend/app/routes/publish.py` → `ayrshare.post()` | Sui-attested publish via a new proxy endpoint. `social_channels.provider` discriminator lets both providers coexist. |
| Per-platform OAuth | Ayrshare hosted link (`/channels` → `link_url`) | Direct sovereign OAuth → same `social_channels.id` row with a different `ayrshare_profile_key` value (or new `sui_attestation_key`). Channel-count caps unchanged. |
| Engagement / view rollup | Per-platform APIs through Ayrshare | Sovereign sidecar reads the same APIs + writes the same `RewardClip` row. Source-of-truth migration is invisible to the desktop. |

### 2.4 Architectural invariants the shell relies on

These are the contracts the desktop expects. As long as future providers honour them, **no shell change is required**:

1. **JWT shape**: Ed25519, embeds `tier` + `founder_flag`, 30-day expiry, auto-rotated by `/sync` when ≤ 5 days remaining.
2. **`/sync` response**: must include `tier`, `subscription_status`, `billing_provider`, `caps` dict, `remaining_exports`.
3. **`/me` response**: must include `email`, `effective_tier`, `raw_tier`, `admin_override`, `billing_provider`, `subscription_status`, `paid_until`.
4. **Whop affiliate row** (`/affiliate/me`): must include `active_members_count`, `total_referrals_count`, `monthly_recurring_revenue_usd`, `total_referral_earnings_usd`.
5. **Tier cap matrix** (`features.TIER_LIMITS`): the 5 numeric caps stay in this dict. New keys add; existing keys never disappear.
6. **Watermark promise**: `deriveWatermarkPromise()` is the single source of truth. New "remove watermark" entitlements add a branch; the function signature stays.

---

## Section 3 · What is explicitly OUT of scope for Desktop 2.1

Restated for the launch reviewer:

- Sui payouts, zkLogin, attribution engine, proxy settlement, USDC payout rails, wallet support — **future release**.
- Team-member architecture, agency seat system, sub-account model — **deferred to v1.1** (already flagged as `built=false, sprint="v1.1"` in `features.py`).
- Domain cutover from current production domains — **TASK 8 (prepare only · do not execute)**.

This document maps the doors; the next sprint walks through them.

---

## Section 4 · Citations (file:line)

| Subject | File | Line(s) |
|---|---|---|
| Tier matrix (server) | `junior-backend/app/features.py` | `FEATURES_BY_TIER` 36-125 · `TIER_LIMITS` 209-255 |
| Tier matrix (client) | `desktop-2/src/design-os/state/useTierCaps.ts` | `TIER_CAPS` 63-112 |
| Starter pass + IP-pool | `junior-backend/app/routes/usage.py` | 50-51 (caps), 69-94 (helper), 178-273 (gate) |
| Channels-per-platform cap | `junior-backend/app/routes/channels.py` | 374-394 (TASK 3 added) |
| Monthly-posts cap | `junior-backend/app/routes/schedules.py` | `_enforce_monthly_post_cap` 41-58 (TASK 3 added) |
| Affiliate first-touch lock | `junior-backend/app/routes/affiliate.py` | 166 |
| Whop affiliate fetch | `junior-backend/app/routes/affiliate.py` | 108-130 |
| Watermark promise | `desktop-2/src/design-os/engine/cockpit/watermarkPromise.ts` | `deriveWatermarkPromise` (BUG-036 lock) |
| Earn summary single-source | `desktop-2/src/design-os/state/useEarnSummary.ts` | BUG-040 lock |
| JWT mint | `junior-backend/app/routes/desktop.py` | 59-157 |
| `/sync` rotation | `junior-backend/app/routes/sync.py` | 49-100+ |
| Activation handshake | `desktop-2/src/lib/activation.ts` | full file (TASK 1 lock) |
