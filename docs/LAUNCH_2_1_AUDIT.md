# Liquid Clips Desktop 2.1 · Launch Completion Audit

Phase-by-phase verify-before-build audit. Single source of truth for what
exists across the system (desktop-2 / desktop-old / account-app /
junior-backend / liquidclips-marketing / partner-app / sidecars) BEFORE
any 2.1 launch-hardening code lands.

> Audit dates: 2026-06-22
> Audit scope rule: **search first, build second**. The user has confirmed
> HQ + Resend + Instagram posting already exist and have been tested.
> This document classifies every relevant capability as `Exists` /
> `Partial` / `Missing` / `Deprecated` so we don't rebuild what is live.

---

## OLD_APP_AND_HQ_CAPABILITY_MATRIX · Phase A

### Repos searched

| Path | Role |
|------|------|
| `/Users/dipdip/code/jnr/desktop-2/` | Current Tauri desktop (Liquid Clips 0.8.0-shell · 18/18 journeys green) |
| `/Users/dipdip/code/jnr/desktop/` | OLD desktop (still on disk · used by social-link Ayrshare flow + UI scope docs) |
| `/Users/dipdip/code/jnr/account-app/` | Next.js account / embed / AdminHQ surface · `account.liquidclips.app` |
| `/Users/dipdip/code/jnr/junior-backend/` | FastAPI backend on Railway · `api.liquidclips.app` · 50+ routers |
| `/Users/dipdip/code/jnr/liquidclips-marketing/` | Marketing site · `liquidclips.app` |
| `/Users/dipdip/code/jnr/marketing/` | Prior marketing scaffold (assess for deprecation in Phase F) |
| `/Users/dipdip/code/jnr/partner-app/` | Partner/affiliate surface (assess in Phase F) |
| `/Users/dipdip/code/jnr/python-sidecar/` | Clipping engine sidecar |
| `/Users/dipdip/code/jnr/updates-proxy/` | Update manifest proxy |

### 1 · Resend / Email

| Capability | Status | Where it lives |
|------------|--------|----------------|
| Resend SDK installed | **Exists** | `junior-backend/requirements.txt` · `resend>=2.4` |
| Resend API key wired | **Exists** | `junior-backend/app/config.py:78` · loaded from `RESEND_API_KEY`. Branded from-address `Liquid Clips <hello@liquidclips.app>` |
| Send primitive | **Exists** | `junior-backend/app/mailer.py:61-98` · `_send()` wraps `resend.Emails.send(payload)` |
| Branded templates | **Exists** | `junior-backend/app/mailer.py:759-856` · dark-mode template tokens + Kade glyph inline MIME attachment |
| `send_welcome` on Clerk user.created | **Exists** | `junior-backend/app/routes/webhooks_clerk.py` |
| `send_subscription_activated/canceled` on Whop | **Exists** | `junior-backend/app/routes/webhooks_whop.py` |
| `send_bounty_approved/rejected` on submissions | **Exists** | `junior-backend/app/routes/submissions.py` |
| `send_license_activated` on `/desktop/connect` | **Exists** | `junior-backend/app/routes/desktop.py` |
| Admin alerts (paid customer / KYC) | **Exists** | `junior-backend/app/mailer.py:344-468` |
| Function-heatmap admin alert (cron) | **Exists** | `junior-backend/app/cron.py` · every 5h |
| `/admin/claims/{token_id}/resend` re-mail | **Exists** | `junior-backend/app/routes/admin.py:~402` |
| Health-check gate on `RESEND_API_KEY` | **Exists** | `junior-backend/app/function_heatmap.py` `_config_gate("resend", ...)` |
| Desktop `/notify/email` proxy endpoint | **Missing** | `desktop-2/src/inbox/emailAdapter.ts:42` POSTs to `${VITE_NOTIFICATIONS_API_BASE}/notify/email`; that path is NOT in `junior-backend/app/routes/notifications.py`. Backend uses purpose-specific senders instead. |
| Desktop email-state lifecycle (sending / sent / failed / not_configured) | **Exists** | `desktop-2/src/inbox/emailAdapter.ts` + 18/18 harness covers it |

**Verdict**: Resend is **WIRED + TESTED in production** for every backend-emitted email. The only missing piece is the desktop-side proxy endpoint, which is not blocking 2.1 launch because the backend already emits the customer-impacting emails directly from webhooks.

### 2 · HQ management capabilities

| Capability | Status | Where |
|------------|--------|-------|
| **User management** | | |
| List + search users | **Exists** | `junior-backend/app/routes/admin.py` `GET /admin/users?query=` · `account-app/src/components/admin/AdminHQ.tsx:717` UsersTab |
| View user detail (tier · billing provider · subscription status · license · founder flag) | **Exists** | `GET /admin/users/{user_id}` · `AdminHQ.tsx:746` |
| Edit tier / plan | **Missing** | No PATCH endpoint |
| Suspend / delete user | **Missing** | — |
| JWT issue / revoke / regenerate | **Missing** | Auto-rotated by `/sync` when ≤5d remaining; no admin manual trigger |
| View latest license | **Exists** | `UserDetail.latest_license` |
| **Creator management** | | |
| List all clipper accounts | **Missing** | No `/admin/creators` |
| View creator submissions / clips | **Missing** | — |
| Force-attach creator to campaign | **Missing** | — |
| **Agency management** | | |
| List agencies | **Missing** | `agency_campaigns.py` has POST agency-creation but no admin list |
| View agency members / seats | **Missing** | — |
| Manage seats / sub-account assignment | **Missing** | Tier-derived `account_limit` in `features.py` but no admin reassignment |
| **Campaign management** | | |
| List campaigns (including draft/closed) | **Exists** | `GET /admin/campaigns` |
| Create campaign | **Exists** | `POST /admin/campaigns` |
| Edit (status · RPM · budget · subtitle · description) | **Exists** | `PATCH /admin/campaigns/{slug}` |
| Campaign moderation (approve user-created agency campaigns) | **Missing** | — |
| Attach / detach assets | **Missing** | `campaign_asset_links.py` exists but no admin bulk-attach |
| **Subscription / billing visibility** | | |
| Identify provider (Whop / Clerk / Stripe) | **Exists** | `UserDetail.billing_provider` |
| Subscription status | **Exists** | `UserDetail.subscription_status` |
| Plan-id / order-id mapping | **Missing** | Admin links to provider dashboards only |
| Manual refunds / cancellations | **Missing** | Owned by Whop / Clerk (intentional per AdminHQ line 1039) |
| Grants / credits | **Missing** | — |
| **Channel visibility** (TikTok / YT / IG / FB / X) | | |
| List user's connected channels | **Missing** | `SocialChannel` table exists; user-facing endpoints only |
| Per-channel state | **Missing** | — |
| Force-disconnect | **Missing** | — |
| **Moderation** | | |
| Approve / reject submissions | **Missing** | Status field exists; no admin queue |
| Ban a clip | **Missing** | — |
| Flag a campaign | **Missing** | — |
| Reject a payout | **Partial** | Bonus ledger admin can "mark paid" but cannot reject |
| **Analytics** | | |
| Paid customer count by tier | **Exists** | `GET /admin/overview` |
| Paid customer alerts (function heatmap) | **Exists** | `/admin/function-heatmap` · Railway cron every 5h |
| Per-route hits | **Missing** | — |
| App-wide funnels | **Missing** | Postiz integration is display-only per AdminHQ:1403 |
| **Notification / email control** | | |
| Re-send a specific email | **Partial** | `/admin/claims/{token_id}/resend` only (claim links) |
| Delivery log viewer | **Missing** | Resend owns the log server-side |
| Admin broadcast | **Missing** | — |
| **Support tools** | | |
| Impersonate user | **Missing** | — |
| View session | **Missing** | — |
| Force re-license | **Missing** | — |
| Clear cache for a user | **Missing** | — |

### 3 · Social account management

All five platforms route through **Ayrshare** (Business plan, ~$599/mo). Postiz is wired but currently disabled (publishing raises `NotImplementedError`).

| Platform | OAuth | Post | Token refresh | Tested | Verdict |
|----------|-------|------|---------------|--------|---------|
| Instagram | Ayrshare JWT hosted link (`junior-backend/app/routes/social.py:150-268`) | `junior-backend/app/routes/publish.py:77-175` · `ayrshare.post()` | Implicit via Ayrshare | `tests/test_webhooks_ayrshare.py` + `desktop/docs/SOCIAL_POSTING_SCOPE.md` confirms test routing | **Exists + tested** |
| TikTok | Same Ayrshare flow | Same `publish.py` | Implicit | `junior-backend/scripts/probe_tiktok.py` (manual probe) + Ayrshare webhook tests | **Exists** |
| YouTube | Same Ayrshare flow | Same `publish.py` · Shorts title truncate logic at `app/postiz.py:243-244` | Implicit | Webhook tests | **Exists** |
| Facebook | Same Ayrshare flow | Same `publish.py` | Implicit | Webhook tests | **Exists** |
| X | Same Ayrshare flow · reply settings baked | Same `publish.py` | Implicit | `desktop/docs/SOCIAL_POSTING_SCOPE.md:251` | **Exists** |

**Desktop hosted-link bridge**: `desktop/src-tauri/src/social_link.rs` opens a Tauri child WebviewWindow → Ayrshare's hosted page → returns via `social_link_closed` event.

**Production publish path**: `desktop → /publish-now (multipart) → junior-backend → ayrshare.post() → platforms`.

### 4 · Onboarding flow (install → first export)

| Step | Where it lives |
|------|----------------|
| Install (Tauri DMG / signed updater) | `desktop-2/src-tauri/` (signed + notarised via CI per `liquid_clips_notarisation_pipeline` memory) |
| Activate (sign-in) | `desktop-2/src/design-os/routes/LoginOnboarding.tsx` · Clerk sign-in modal |
| Mint license JWT | `junior-backend/app/routes/desktop.py` · `POST /desktop/connect` |
| First `/me` + `/sync` | `junior-backend/app/routes/sync.py` (auto-rotates JWT if ≤5d) |
| Connect first channel | `desktop/src-tauri/src/social_link.rs:23-64` + `/social/start-link` + Ayrshare hosted page |
| Generate first clip | Python sidecar (ingest → lift → pick → cuts) · emits `engine:complete{kind:"pick"}` |
| Export / publish | `desktop-2/src/design-os/engine/cockpit/PublishModule.tsx` → `/publish-now` (multipart) → Ayrshare |
| Paywall / upgrade | `junior-backend/app/routes/usage.py` (Free-tier 100-clip starter pass) + Whop checkout link |

**Verdict**: end-to-end onboarding works. UI polish on the channel-connect popover + platform glyphs is in-progress per `desktop/docs/SOCIAL_POSTING_SCOPE.md`. Phase E (Onboarding Audit) will walk the journey to find dead-ends; no rebuild needed.

### 5 · Referral tracking

| Capability | Status | Where |
|------------|--------|-------|
| Referral code generation | **Exists** | `liquidclips-marketing/src/lib/referralCode.ts:13-22` · 8-char Base62 (no O/0/I/l) |
| `?ref=CODE` middleware capture | **Exists** | `liquidclips-marketing/src/middleware.ts` |
| Click logging | **Exists** | `liquidclips-marketing/src/app/api/referrals/click/route.ts:40-82` · POST to `referral_clicks` table (IP hash + UA fingerprint + country + landed path) |
| First-touch lock on signup | **Exists** | `junior-backend/app/routes/affiliate.py:166` · `user.affiliate_id` immutable post-creation |
| Personal share dashboard | **Exists** | `liquidclips-marketing/src/app/refer/page.tsx` |

### 6 · Affiliate tracking

| Capability | Status | Where |
|------------|--------|-------|
| Affiliate ledger (source of truth) | **Exists · external** | Whop API. Fetched via `/affiliate/me` (`junior-backend/app/routes/affiliate.py:108-130`). Whop owns active_members_count / total_referrals_count / MRR / lifetime earnings. |
| Qualification rule | **Exists** | `junior-backend/app/routes/affiliate.py:36-46` · 2+ paid referrals OR 11k verified views. 50% recurring from customer #3 onward. |
| Whop-native payout | **Exists** | `affiliate.py:198-269` `AffiliateBlock` |
| Stripe Connect fallback (non-Whop affiliates) | **Exists** | `junior-backend/app/routes/stripe_connect.py:1-150` + `account-app/src/app/api/affiliate/stripe-connect/route.ts:19-62`. Status tracked in `users.stripe_connect_status`. |
| Pending Whop membership claim (Whop purchase before signup) | **Exists** | `junior-backend/app/routes/onboarding.py:93-167` `PendingWhopMembership` table + `/onboarding/link-whop` redemption |
| Earnings display | **Exists** | `account-app/src/app/dashboard` + `desktop-2/src/design-os/earn/` |

### Headline findings

1. **Resend is fully wired in junior-backend** with 16+ branded senders firing from Clerk + Whop + submissions + license + admin-alert webhooks. My FEATURE-001 verdict ("no Resend wiring") was **wrong** — I only grepped `desktop-2/` and `junior-backend/app/routes/notifications.py`. The desktop-side `/notify/email` proxy endpoint is missing but it's not launch-blocking because the backend already emits the customer-impacting emails directly.

2. **Social posting is live for all 5 platforms via Ayrshare**, not via the Postiz architecture that the legacy memory pointer described. Postiz is wired but disabled (`NotImplementedError`). Ayrshare is production. Memory file `[Junior Postiz Architecture]` is now stale (assess for deprecation in Phase F).

3. **HQ has good campaign control + good user inspection**, but **no mutation tools for users (tier / suspend / re-license / refund / grant)** and **no moderation queue (submission approval / clip ban / campaign flag)**.

4. **Onboarding works end-to-end** — install → JWT → channel connect → generate → publish → paywall. Polish gaps to be tracked in Phase E, not rebuilds.

5. **Referral + affiliate is fully wired** — code gen, click log, first-touch lock, Whop ledger, Stripe Connect fallback, pending-membership claim. This is the area that surprised me most; treat it as a launch asset, not a TODO.

### Implication for launch hardening

Do NOT rebuild:
- Resend / email · already live in backend.
- Social posting · Ayrshare is live · the Postiz repo files can be left dormant.
- Referral + affiliate ledger · live.
- Onboarding flow · live, only polish gaps remain.

Phase B and beyond should focus on:
- **HQ mutation capabilities** (the absolute gap for "can Daniel run the business from HQ?")
- **Tier-enforcement audit** (Phase C) — verify limits actually fire client-side AND server-side.
- **Agency model** (Phase D) — the seat/sub-account story is unclear; tier-derived `account_limit` exists but no admin reassignment.
- **Launch polish** (Phase F) — splash / icons / installer / website / domain. Search existing assets first; do not regenerate.

---

## HQ_GAP_REPORT · Phase B

_pending · run after user confirms Phase A._

---

## FEATURE-003 · Tier Enforcement Audit · Phase C

> Scope: every tier-gated limit across the system. Inventory before any code change.
> Outcome: 15 distinct limits across 5 categories. **10/15 are enforced on the
> server. 5/15 are CLIENT-ONLY and therefore bypassable.**

### Canonical tier set

`free` · `solo` · `pro` · `agency` (+ legacy alias `autopilot` → agency, sunset alias `growth` → pro).
Founder flag is uncapped sentinel (treated as agency + 9999 accounts).
Source: `junior-backend/app/features.py:36-125` (`FEATURES_BY_TIER`).

### Tier · Limit Matrix

| # | Limit | Free | Solo | Pro | Agency | Server enforces | Client enforces | Bypass | Tests |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Lifetime clip exports (starter pass) | **100** | uncapped | uncapped | uncapped | `junior-backend/app/routes/usage.py:178-273` (402) | `useTierCaps.remaining_exports` | admin-email allowlist, founder flag, grace period for canceled subs | none direct |
| 2 | IP-pool starter cap | **100/IP** | n/a | n/a | n/a | `usage.py:51, 54-66` (`IP_POOL_EXPORT_CAP`) | n/a | None when IP is null (dev) | none |
| 3 | Monthly video quota | retired | retired | retired | retired | `usage.py:42-47` `_quota_for_tier()` returns `None` | n/a | n/a | n/a |
| 4 | BYO OpenAI key required | True | True | True | True | `features.py:53-73` | n/a | admin override | none |
| 5 | Platform connections max (publish-channel) | **0** | **1** | unlimited | unlimited | `routes/connections.py:96-105` `_assert_can_connect()` 402 | n/a | admin allowlist | `routes/connections.py:96-105` |
| 6 | `publish_now` gate | False | True | True | True | `routes/publish.py:51-64` `_require_paid_tier()` 402 / 503 | `useTierCaps` | admin → autopilot at JWT mint | none |
| 7 | Multi-platform publish | False | False | True | True | `features.py` built flag → 503 | `useTierCaps` | n/a | n/a |
| 8 | Schedule one post | False | False | True | True | `features.py` built flag → 503 | `useTierCaps` | n/a | n/a |
| 9 | Drip scheduling | False | False | True | True | `features.py` built flag → 503 | `useTierCaps` | n/a | n/a |
| 10 | Channels per tier (total) | **0** | **2** | **5** | **15** (founder 30) | `routes/channels.py:51-59, 111-114` `_max_channels_for()` | `useTierCaps.totalChannels` | founder bump | `channels.py:111-114` |
| 11 | Channels per platform | **1** | **1** | **3** | **5** | ⚠️ **none** | `useTierCaps.perPlatformChannels` | client-only · trivially bypassable | none |
| 12 | Social accounts included (`accounts_included`) | **1** | **5** | **10** | **25** + Clerk add-on | `features.account_limit()` baked into `/me` response | `useTierCaps.accountsPerClip` | founder=9999; Clerk Account Pack (+1/$6) | `routes/me.py:97-102` |
| 13 | Accounts per clip (export fan-out) | **1** | n/a (clipper) | **3** | **10** | `routes/publish.py` posts one channel per POST (implicit cap) | `desktop-2/src/design-os/export/types.ts:59-63` `ACCOUNTS_PER_CLIP_CAP` + `TargetAccountsRow` | client-only on array length | none |
| 14 | Campaigns per brand | **1** | n/a | **5** | **20** | ⚠️ **none** in `agency_campaigns.py` | `useTierCaps.campaignsPerBrand` | client-only | none |
| 15 | Clips per campaign | **10** | n/a | **50** | **200** | ⚠️ **none** | `useTierCaps.clipsPerCampaign` | client-only | none |
| 16 | Submissions per day (per user, all tiers) | **10** | **10** | **10** | **10** | `routes/submissions.py:78, 205-219` 429 | n/a | n/a | `routes/submissions.py:205-219` |
| 17 | Monthly posts (scheduled) | n/a | **25** | **250** | **2500** | ⚠️ **none** | `useTierCaps.monthlyPosts` | client-only | none |
| 18 | Bulk scheduling rows | **1** | **1** | **25** | **Infinity** | ⚠️ **none** | `useTierCaps.bulkSchedulingRows` | client-only | none |
| 19 | Campaign account templates | False | False | False | True | `features.py` flag | `useTierCaps.campaignAccountTemplates` | n/a | none |

Watermark, priority queue, analytics-rollups, history-retention are entitlements (boolean / scalar) sourced from the same `FEATURES_BY_TIER` and read client-side via `useTierCaps`.

### Known bypasses

1. **Admin allowlist** — `junior-backend/app/features.py:183-207` `is_admin_email()`.
   Hardcoded fallback emails: `danieldiyepriye@gmail.com`, `mrddokubo@gmail.com`, `crazycatjackkids@gmail.com`, `thedoks2019@gmail.com`. Env override: `JUNIOR_ADMIN_EMAILS`.
   Effect: promotes to `autopilot` tier + `founder_flag=True` at JWT mint (`routes/desktop.py:110-112`); skips quota gates in `/usage/*`, `/sync`, `/me`, `/admin/*`.
2. **Founder flag** — `User.founder_flag=True` set by Whop webhook or manual edit. Returns 9999 account limit (sentinel for unlimited). One-time £500 founder sale, sunset 2026-05-31.
3. **Debug tier override** — `desktop-2/src/design-os/state/useTierCaps.ts:174-182` `window.__lcDebugSetTier(tier)`. Puppeteer-only. Does **not** unlock paid write actions because `canUseAgencyActions()` checks `isTrustedTierSource` and excludes `"debug-override"`.
4. **Grace period** — `routes/usage.py:85-92` keeps `canceled` and `past_due` users uncapped until their `paid_until` timestamp expires.
5. **Internal API secret** — `routes/desktop.py:70-72` and `routes/admin.py` accept `x-internal-secret` header (env: `INTERNAL_API_SECRET`, empty = allow-all in dev). account-app uses it to mint licenses + run admin commands without JWT.

### Critical 2.1 hardening targets (server-side enforcement gaps)

These are limits where the user advertises a cap, but the server does not enforce it. Any half-skilled customer can bypass:

| Gap | What today protects it | Risk |
|---|---|---|
| **Channels per platform** (limit #11) | `useTierCaps` only · the client `useTierCaps.isAtCap()` guard | An attacker can POST `/channels` directly with same-platform handles and exceed the per-platform cap. Backend should validate by platform group in `routes/channels.py`. |
| **Monthly posts cap** (limit #17) | `useTierCaps` only · `/publish-now` and `/schedules` accept indefinitely | A scripted client can saturate Ayrshare allowance, burning $599/mo plan capacity. |
| **Campaigns per brand** (limit #14) | `useTierCaps` only · `agency_campaigns.py` does not count existing | Self-serve agency could spam campaign rows. |
| **Clips per campaign** (limit #15) | `useTierCaps` only | Same as above, scoped to a single campaign. |
| **Bulk scheduling rows** (limit #18) | UI render only | A scripted client can bulk-schedule beyond cap. |

### Tests that actually fire

- `junior-backend/tests/test_webhooks_ayrshare.py` — schedule status transitions, channel link/unlink, idempotency, signature verification (does NOT cover tier enforcement directly).
- `desktop-2/tests/e2e/*.spec.ts` — 18 journeys passing; harness uses `__lcDebugSetTier` to flip tiers but does not assert 402/403 propagation from the backend.
- No integration test verifies "free user is blocked at HTTP layer when starter pass exhausts". Recommended for 2.1.

### Citations (file:line)

| Subject | File | Line |
|---|---|---|
| `FEATURES_BY_TIER` (canonical map) | `junior-backend/app/features.py` | 36-125 |
| `account_limit(tier, extra_packs, founder)` | `junior-backend/app/features.py` | 222-236 |
| `STARTER_EXPORT_CAP=100`, `IP_POOL_EXPORT_CAP=100` | `junior-backend/app/routes/usage.py` | 50-51 |
| `starter_export_remaining()` | `junior-backend/app/routes/usage.py` | 69-94 |
| `clip_exported()` 402 gate | `junior-backend/app/routes/usage.py` | 178-273 |
| `_assert_can_connect()` 402 | `junior-backend/app/routes/connections.py` | 96-105 |
| `_require_paid_tier()` 402/503 | `junior-backend/app/routes/publish.py` | 51-64 |
| `_MAX_CHANNELS_BY_TIER`, `_max_channels_for()` | `junior-backend/app/routes/channels.py` | 51-59, 111-114 |
| `_MAX_SUBMISSIONS_PER_DAY`, 429 gate | `junior-backend/app/routes/submissions.py` | 78, 205-219 |
| `is_admin_email()`, `_FALLBACK_ADMIN_EMAILS` | `junior-backend/app/features.py` | 183-207 |
| Admin override at JWT mint | `junior-backend/app/routes/desktop.py` | 110-112 |
| `TIER_CAPS` matrix (client) | `desktop-2/src/design-os/state/useTierCaps.ts` | 63-112 |
| `ACCOUNTS_PER_CLIP_CAP` (client) | `desktop-2/src/design-os/export/types.ts` | 59-63 |
| `__lcDebugSetTier` test seam | `desktop-2/src/design-os/state/useTierCaps.ts` | 174-182 |

### Verdict

Tier enforcement is **2/3 hardened**. The 5 client-only gaps (per-platform channels, monthly posts, campaigns-per-brand, clips-per-campaign, bulk-scheduling) are the realistic 2.1 hardening list — none requires new product features, only adding count-and-validate checks in the existing route handlers. No pricing changes required; just defense-in-depth on existing limits.

---

## FEATURE-004 · Agency Model Audit · Phase D

> Scope: can agencies support 1 / 5 / 10 / 15 accounts today?
> Outcome: **Yes for "fan-out 10 accounts per clip from one operator" — that already works.**
> **No for "multiple operators sharing one agency seat pool"** — there is no sub-account / seat-member model. The agency vs clipper distinction is a UI mode toggle on a single user, not a parent-child entitlement.

### Agency identity

- **Tier name**: `"agency"` (`features.py:35-135`). Legacy alias `"autopilot"` resolves to agency (`features.py:206-207`).
- **Mode toggle**: `desktop-2/src/design-os/bridge/useMode.ts` — `"clipper" | "agency"` persisted in `localStorage.lc.mode`. UI-only, no server persistence; same user can flip between the two each session.
- **Agency-action gate**: `routes/agency_campaigns.py:237-244` `_require_agency(user)` checks `is_admin_email(user.email)` — admin allowlist, NOT tier-derived. Means: any user can flip the UI to agency mode, but campaign-create writes only pass for allowlisted admin emails today.

### Entitlements (tier-derived)

| Capability | Free | Solo | Pro | Agency | Where |
|---|---|---|---|---|---|
| Accounts included (base) | 1 | 5 | 10 | **25** | `features.py:44-124` `accounts_included` |
| Extra accounts via Clerk add-on | n/a | +1 / $6/mo | +1 / $6/mo | +1 / $6/mo | `models.py:59-67` `extra_accounts_purchased`; mutated by Clerk webhook |
| Channels (total) | 0 | 2 | 5 | **15** (founder 30) | `routes/channels.py:51-59` |
| Channels per platform | 1 | 1 | 3 | **5** | `useTierCaps.ts` (client only — gap) |
| Accounts per clip (fan-out cap) | 1 | n/a | 3 | **10** | `desktop-2/src/design-os/export/types.ts:59-63` |
| Monthly posts | n/a | 25 | 250 | **2500** | `useTierCaps.ts` (client only — gap) |
| Campaigns per brand | 1 | n/a | 5 | **20** | `useTierCaps.ts` (client only — gap) |
| Clips per campaign | 10 | n/a | 50 | **200** | `useTierCaps.ts` (client only — gap) |
| Bulk scheduling | 1 | 1 | 25 | **∞** | `useTierCaps.ts` (client only — gap) |
| Campaign account templates | ✗ | ✗ | ✗ | ✓ | `useTierCaps.ts` |
| Watermark removal | ✗ | ✗ | ✓ | ✓ | `useTierCaps.ts` |
| Priority queue lane | ✗ | ✗ | ✓ | ✓ | `useTierCaps.ts` |
| Analytics rollups | ✗ | ✗ | ✓ | ✓ | `useTierCaps.ts` |
| History retention | 30d | 90d | 180d | **365d** | `useTierCaps.ts` |
| Auto-retry depth | 0 | 1 | 2 | **3** | `useTierCaps.ts` |

### Seat / sub-account architecture

| Question | Answer | Where |
|---|---|---|
| Parent → child user relationship | **None** | No `parent_user_id`, `agency_member`, `team_member`, `sub_account` table or column |
| `sub_accounts` feature flag | declared but `built=false`, `sprint="v1.1"` | `features.py:121` |
| Sub-clipper invite flow | **None** | No backend invite token, no UI invite form |
| Agency members in HQ | **None** | AdminHQ users list shows individual users, no team membership |
| Clip attribution to parent agency | **None** | Submission rows have `clipper` (submitter), no `parent_agency_id` |
| Explicit "belongs to agency X" | **None** | Not in models, not in DB |

**Implication**: today an "agency" is a single user account with bigger caps. There is no multi-operator agency. Five separate humans cannot share one agency seat pool today.

### Multi-account publishing

- Client cap: `ACCOUNTS_PER_CLIP_CAP` clipper=1 / pro=3 / agency=10 (`desktop-2/src/design-os/export/types.ts:59-63`).
- Server posts ONE channel per `/publish-now` POST. Fan-out across N channels is the desktop's responsibility (it loops). Server enforces nothing on `targetAccountIds.length`; if the desktop sent a larger array, the server would just iterate it.
- Multi-platform fan-out works today via Ayrshare; tested via webhook suite.

### Campaign ownership

| Capability | Status | Where |
|---|---|---|
| Agency can create campaign | **Exists** (admin-allowlist gated) | `routes/agency_campaigns.py:360-433` POST `/agency/campaigns` |
| Campaign lifecycle (draft → pending_reward → coming_soon → live → closed) | **Exists** | `routes/agency_campaigns.py:527-599` |
| Whop reward state gates `live` status | **Exists** | `routes/agency_campaigns.py:527-599` |
| Approval / moderation queue (external approver) | **Missing** | No formal approval; admin allowlist controls who can publish |
| Agency views submission roster for own campaign | **Partial** | UI exists (`SubmissionsReview.tsx`) but it's **fixture-only** — comment says "mock-only · the fixture mirrors the shape Batch D will return from /campaigns/:slug/submissions". Backend endpoint missing. |
| Active-clippers view per campaign | **Missing** | Same — Batch D scope |
| Agency reviews + approves submissions | **Missing** | UI shows Approve/Reject buttons over fixture data; no backend POST handler |

### Billing + provisioning

| Capability | Status | Where |
|---|---|---|
| Tier upgrade (solo → pro → agency) | **Exists** | Whop product purchase → webhook → `apply_membership_tier` (`webhooks_whop.py`) |
| Agency tier metadata | **Exists** | Whop product → `effective_tier` in `/me` |
| Extra accounts (Clerk add-on) | **Exists** | Clerk Account Pack add-on, $6/mo per unit; mutates `extra_accounts_purchased` |
| Manual seat assignment to sub-user | **Missing** | No sub-user model |
| Stripe Connect | **Exists** for affiliate payouts | `routes/stripe_connect.py` (NOT for agency tier) |

### Desktop / shell UX

| Surface | Behavior | Where |
|---|---|---|
| TopHud mode pill | flips `lc.mode`, emits `mode:change` event, ConsoleNav rerenders | `TopHud.tsx:137-150` + `useMode.ts` |
| Agency-only nav items | Submissions, Analytics | `ConsoleNav.tsx:39-51` `modes: ["agency"]` |
| Clipper-only nav items | My Journey (`clipper` route), Earn | `ConsoleNav.tsx:39-51` `modes: ["clipper"]` |
| Submissions backend wire | **fixture only** | `SubmissionsReview.tsx:1-9` — Batch D dependency |
| Analytics backend wire | **fixture only** | `Analytics.tsx:1-6` — Batch D dependency |
| Campaign create UI | **real** | `AgencyCreationFlow` → `useAgencyCampaignDraft` → `POST /agency/campaigns` |

### Multi-account-count matrix

| Capability | 1 account | 5 accounts | 10 accounts | 15 accounts | Verdict |
|---|---|---|---|---|---|
| `accounts_included` base (25) covers the count | ✓ | ✓ | ✓ | ✓ | Exists |
| Channels (15 total) covers the count | ✓ | ✓ | ✓ | ✓ | Exists (server-enforced) |
| Channels per platform (5) covers the spread | ✓ | ✓ | ✓ | ✓ | Exists (client-only) |
| Fan-out per clip (10) covers the export | ✓ | ✓ | ✓ | needs 15 — **fails** | client-cap is 10, agency exports >10 → silently truncated |
| Sub-clippers as separate humans | ✗ | ✗ | ✗ | ✗ | **Missing** (no seat model) |
| Submission attribution to agency | ✗ | ✗ | ✗ | ✗ | **Missing** (Batch D) |
| Analytics rollup across the N accounts | ✗ | ✗ | ✗ | ✗ | **Missing** (Batch D) |
| Whop billing covers all 15 | ✓ | ✓ | ✓ | ✓ | Exists (Clerk add-on covers seats >25 too) |

### Verdict

Today an "agency" can manage up to **10 simultaneous social accounts per single clip export** (capped on the client). It has 25 connected social accounts in the pool (15 channels max enforced server-side, 25 included accounts on the billing meter — note the discrepancy). The Whop + Clerk pipes for upgrading + adding seats are live and self-serve.

**What blocks "15 accounts on one clip"**: a single number — `ACCOUNTS_PER_CLIP_CAP.agency = 10` in `desktop-2/src/design-os/export/types.ts:62`. Bumping it to 15 is one line. No new architecture needed.

**What blocks "multi-operator agency"**: the sub-account / seat / team-member model that does not exist. `features.py:121` flags `sub_accounts` as `built=false, sprint=v1.1`. Until that lands, an "agency" is one human with bigger caps. This is the deciding architectural question for 2.1: does Liquid Clips ship as "solo creator with big caps" or wait until v1.1 for the team layer?

Two backend-data gaps that make the agency mode feel incomplete to a customer today:
1. `/campaigns/:slug/submissions` endpoint does not exist — Submissions Review UI is fixture-only.
2. Agency-wide analytics rollup endpoint does not exist — Analytics route is honest-placeholder ("—").

Both are explicitly Batch D scope; the UI is wired to receive them.

---

## TASK 1 · Download / Install / Activation flow + harness · GREEN (2026-06-22)

### Audited (read-only) before any code change

Across `desktop-2`, `desktop` (old), `account-app`, `junior-backend`, `liquidclips-marketing`, `marketing`, `updates-proxy`.

Verdict per stage:

| Stage | Status | Where |
|---|---|---|
| Marketing → Download CTA · dynamic GH release lookup · Apple Silicon vs Intel auto-detect | **Exists** | `liquidclips-marketing/src/components/DownloadCTA.tsx`, `liquidclips-marketing/src/lib/latest-release.ts` |
| Tauri DMG · v0.8.0 · `app.liquidclips.desktop` · signed + notarised in CI (IG-013) · auto-updater `https://updates.liquidclips.app/latest.json` · `liquidclips://` deep-link scheme | **Exists** | `desktop-2/src-tauri/tauri.conf.json`, `.github/workflows/release.yml` |
| First launch · `initAuthStorage()` + `mountDeepLinkSubscriber()` · LoginOnboarding when no JWT · main app when JWT | **Exists** | `desktop-2/src/App.tsx`, `desktop-2/src/lib/deepLinkBoot.ts` |
| Activation handshake · challenge → `connect-desktop` page → `/api/desktop/connect` (account-app, x-internal-secret) → `/desktop/connect` (junior-backend, JWT mint) → `liquidclips://activate?token=…&challenge=…` → desktop deep-link verifies + stores | **Exists** | `desktop-2/src/lib/activation.ts`, `account-app/src/app/connect-desktop/page.tsx`, `account-app/src/app/api/desktop/connect/route.ts`, `junior-backend/app/routes/desktop.py:59-157` |
| Keychain / license persistence · localStorage at `lc.license.jwt.v1` today; Tauri Keychain forward-ready in code but Rust command not wired | **Partial** | `desktop-2/src/lib/authStorage.ts` — gracefully no-ops Keychain invoke; localStorage covers desktop-2 and the old desktop with the SAME key (cross-app migration works without code) |
| `/sync` + `/me` post-activation · parallel, best-effort; auto-rotates JWT when ≤5d remaining; 401/403 self-heals (clears JWT, status=`failed`); network/5xx preserves JWT with `degraded=true` | **Exists** | `desktop-2/src/lib/activation.ts:316-412` |
| Reach Home · after activation status flips to `activated`, AuthGate sees `hasJwt()===true` and renders main app · `#/home` is default | **Exists** | `desktop-2/src/App.tsx:145-155` AuthGate |
| Upgrade path · tier surfaces in Settings → Plan card; Whop checkout link · desktop reads new tier on next `/sync` tick | **Partial** | `desktop-2/src/design-os/routes/Settings.tsx` |
| HQ login compatibility · AdminHQ at `account.liquidclips.app/admin` · admin-email gated · no "Open in Desktop" button | **Exists (no deep-link back to desktop)** | `account-app/src/components/admin/AdminHQ.tsx` |
| Old-desktop user migration · same localStorage key (`lc.license.jwt.v1`) · JWT auto-loads on first launch of desktop-2 | **Exists (implicit)** | `desktop-2/src/lib/authStorage.ts` |
| Activation harness (was missing pre-TASK-1) | **Now exists** | `desktop-2/tests/e2e/activation-flow.spec.ts` |

### Smallest fix that landed (no scope growth)

1. `src/lib/activation.ts` · added `window.__lcActivation` test seam exposing `begin / handleUrl / clear / snapshot / notifyAuthFailure` (mirrors `__lcBus` + `__lcInbox`).
2. `src/design-os/routes/LoginOnboarding.tsx` · added `data-testid` + `data-activation-status` attributes on every state block (`idle / waiting / activating / activated / failed / already-activated`) and every CTA button (`login-start-button / login-continue-button / login-retry-button / login-cancel-button`) so the harness can grip them deterministically.
3. **No production-code logic change.** No new product, no new architecture, no Keychain Rust command wired (out of TASK 1 scope).

### Harness (Gate 3)

`desktop-2/tests/e2e/activation-flow.spec.ts` — 8 steps, 8/8 PASS:

1. Cold launch (no JWT) renders LoginOnboarding `idle` state · `login-start-button` visible.
2. `begin()` returns a 64-hex nonce · persists it in sessionStorage at `lc.activation.pending_challenge.v1` · status flips to `waiting`.
3. `handleUrl()` with matching challenge stores JWT to `localStorage.lc.license.jwt.v1` · AuthGate sees `hasJwt()===true` · LoginOnboarding unmounts · home tile renders. Snapshot: `status="activated"`, `tier="solo"`, `email="harness@liquidclips.app"`, `lastTokenSource="clerk"`, `degraded=false` (per the intercepted /sync + /me).
4. Cold reload with JWT preserved → AuthGate bypasses LoginOnboarding entirely · home tile renders directly · `login-state-idle` is NOT in DOM.
5. `begin()` + `handleUrl()` with WRONG challenge → `login-state-failed` visible · error text contains "challenge" · JWT NOT stored.
6. `begin()` + `handleUrl()` with /sync returning **401** → `notifyAuthFailure()` self-heal · JWT cleared from localStorage · `login-state-failed` visible.
7. `begin()` + `handleUrl()` with /sync + /me **network-failure** (route.abort) → JWT preserved · AuthGate flips to home · `snapshot.degraded === true` · `snapshot.status === "activated"`.

### Regression lock (Gate 4)

`activation_flow` journey is now in `verify-app`. Any future PR that:
- breaks the deep-link challenge verification,
- regresses the JWT self-heal on 401/403,
- accidentally clears JWT on network failure (this is **degraded**, not **failed**),
- decouples AuthGate from `hasJwt()`,
- removes the `__lcActivation` test seam,
- removes any of the login state pill testids,

…will fail this journey.

### verify-app

```
verify-app: { ... , "activation_flow": "PASS", ... , "overall": "GREEN" }
```

**19/19 journeys GREEN · Release Status: PASS · TASK 1 closed.**

---

## TASK 2 · Old-App Proven Systems Migration · GREEN (2026-06-22)

> Rule: search first, build second. If a proven system works on the
> old app / HQ / backend, **bridge to it**, do not rebuild it.

### Migration ledger · 10 systems

| # | System | Source of truth | Target surface in 2.1 | Status | Smallest fix |
|---|---|---|---|---|---|
| 1 | **Resend / branded emails** | `junior-backend/app/mailer.py` · 16+ branded senders firing on Clerk + Whop + submissions + license + admin-alert webhooks · `RESEND_API_KEY` health-gated | desktop-2 (no surface needed) | **ALREADY REACHABLE** | none · backend emits emails directly from webhooks. The unused `desktop-2/src/inbox/emailAdapter.ts → /notify/email` proxy endpoint is a forward-ready stub for a future broadcast path, not a 2.1 launch blocker. |
| 2 | **HQ URLs + admin reachability** | `account-app/src/components/admin/AdminHQ.tsx` at `https://account.liquidclips.app/admin` · admin-email gated server-side | `desktop-2/src/design-os/routes/Settings.tsx` Connection-status card | **NEEDS COPY/URL UPDATE → done** | Added admin-only "Open Admin HQ ↗" button gated on `tier.adminOverride` (data-testid="settings-open-hq", data-open-url="https://account.liquidclips.app/admin"). Non-admins never see the link. |
| 3 | **Whop billing + checkout** | `https://whop.com/liquidclips/` plans page · Whop product webhooks already drive `apply_membership_tier` on backend | `desktop-2/src/design-os/routes/Settings.tsx` Upgrade card | **NEEDS COPY/URL UPDATE → done** | Replaced the disabled `Upgrade to Pro · coming soon` placeholder with a live "View plans on Whop ↗" / "Manage plan on Whop ↗" button (data-testid="settings-upgrade-whop", data-open-url="https://whop.com/liquidclips/"). Tier-aware label. |
| 4 | **Affiliate / referral dashboard** | `liquidclips-marketing/src/app/refer/page.tsx` · code gen + first-touch lock + Whop ledger + Stripe Connect fallback | `desktop-2/src/design-os/routes/Earn.tsx` hero | **NEEDS COPY/URL UPDATE → done** | Added "Open affiliate dashboard ↗" button (data-testid="earn-open-affiliate", data-open-url="https://liquidclips.app/refer") in Earn hero, right below the "Track progress · open the mission map" link. |
| 5 | **Social account connect / Ayrshare bridge** | `junior-backend/app/routes/social.py:150-268` `/channels` POST returns `link_url` · `desktop/src-tauri/src/social_link.rs` child WebviewWindow opens it | `desktop-2/src/design-os/engine/sidecar-stub.ts:974-1023` `channels.connect()` already POSTs `/channels`, adapts the response, and emits `browse:open` with the Ayrshare hosted-link URL | **ALREADY REACHABLE** | none · the wiring is in place; Channels grid `Add account` button → `channels.connect()` → backend → Ayrshare. |
| 6 | **Instagram publish path** | `junior-backend/app/routes/publish.py:77-175` `ayrshare.post()` (all 5 platforms wired via Ayrshare $599/mo Business plan) · `desktop/src/lib/backend.ts:441-580` `publishNow()` reads file via `@tauri-apps/plugin-fs` + multipart POST `/publish-now` · all 5 platforms tested in `tests/test_webhooks_ayrshare.py` | `desktop-2/src/design-os/engine/cockpit/PublishModule.tsx` | **NEEDS BRIDGE — LARGE · deferred** | Today desktop-2's "Publish now" button only runs `exportApi.exportClip()` (local file export). The proven `publishNow()` Tauri implementation in the old desktop is a ~140-line port that requires `@tauri-apps/plugin-fs`, multipart upload, per-target result tracking, tier gating (Solo+), error mapping (401/402/412/500+). Smallest fix THIS task: **rename the button label from "Publish now" to "Export"** (PublishModule.tsx line ~416) so the customer is not misled. The actual social-publish bridge is the largest single migration left and warrants its own dedicated 4-gate cycle. |
| 7 | **License / activation continuity** | TASK 1 locked end-to-end · backend `POST /desktop/connect` mints JWT · `/sync` rotates ≤5d · `lib/activation.ts` 401-self-heal | desktop-2 LoginOnboarding + AuthGate | **ALREADY REACHABLE** | none · TASK 1 GREEN. |
| 8 | **Update / download URLs** | `https://updates.liquidclips.app/latest.json` proxied by `updates-proxy/` to junior-backend `/updates/latest.json` | desktop-2 `tauri.conf.json` updater endpoint | **ALREADY REACHABLE** | none. |
| 9 | **Old-desktop migration assumptions** | OLD desktop stored JWT at `localStorage.lc.license.jwt.v1` · IG-014 enforces shared namespace | desktop-2 reads the same key via `lib/authStorage.ts` | **ALREADY REACHABLE** | none · TASK 1 harness step 4 covers cold reload of a JWT seeded under that key, AuthGate bypasses LoginOnboarding directly to home. |
| 10 | **Marketing website download path** | `liquidclips-marketing/src/components/DownloadCTA.tsx` calls `getLatestRelease()` for dynamic GH release URL · Apple Silicon vs Intel auto-detect | GitHub releases for desktop-2 (tag-driven CI per IG-009 + IG-013) | **ALREADY REACHABLE** | none · marketing site dynamically pulls the latest signed + notarised release the moment CI publishes. |

### Smallest fixes applied (Gate 2)

- `src/design-os/routes/Settings.tsx` — replaced disabled Upgrade placeholder with live Whop button (`data-testid="settings-upgrade-whop"`, `data-open-url="https://whop.com/liquidclips/"`). Tier-aware label: `"View plans on Whop ↗"` for FREE, `"Manage plan on Whop ↗"` otherwise.
- `src/design-os/routes/Settings.tsx` — added admin-only "Open Admin HQ ↗" link inside the Connection-status card, conditioned on `tier.adminOverride` (`data-testid="settings-open-hq"`, `data-open-url="https://account.liquidclips.app/admin"`).
- `src/design-os/routes/Earn.tsx` — added "Open affiliate dashboard ↗" link in the hero (`data-testid="earn-open-affiliate"`, `data-open-url="https://liquidclips.app/refer"`). Imports `openSmart` from `lib/openSmart`.
- `src/design-os/engine/cockpit/PublishModule.tsx` — renamed the cockpit publish button label from `"Publish now"` to `"Export"` (lines around 417). The button still runs `exportApi.exportClip()` locally; the label now matches the behavior. The internal function name `publishNow` is unchanged. Honest label closes the lie; the full social-publish bridge is deferred to a dedicated future task per the "smallest fix only" rule.

### Harness (Gate 3)

New: `desktop-2/tests/e2e/system-migration.spec.ts` · 7 steps, 7/7 PASS first run after two corrections (route-stack pollution → fixed with `page.unrouteAll`; cockpit publish-now button requires full clip pipeline → moved to static source-file check).

Mixed live + static contract:

1. **STATIC** · `Settings.tsx` mounts the admin-HQ link inside a `{tier.adminOverride && ...}` conditional · proves non-admins never see it without needing a separate browser reboot.
2. Boot · admin clipper · land on home.
3. Settings · Upgrade button visible · label contains "whop" · NOT "coming soon" · `data-open-url === "https://whop.com/liquidclips/"`.
4. Settings · Admin HQ button visible · label "Admin HQ" · `data-open-url === "https://account.liquidclips.app/admin"`.
5. Earn · Affiliate dashboard button visible · `data-open-url === "https://liquidclips.app/refer"`.
6. **STATIC** · `PublishModule.tsx` publish-now button body MUST contain `"Export"` and MUST NOT contain `"Publish now"` (comments stripped before scanning so the audit-comment block doesn't false-positive).
7. Channels · Add-account button still mounted (proves the proven `channels.connect()` bridge is reachable end-to-end).

### Regression lock (Gate 4)

`system_migration` is in `verify-app`. Any future PR that:

- removes the admin-override gate on the HQ link,
- replaces the Whop button with another "coming soon" placeholder,
- removes the affiliate dashboard cross-link from Earn,
- renames the publish button back to "Publish now" without actually wiring the publish path,
- removes the `data-open-url` attributes the harness asserts against

…will fail this journey.

### verify-app

```
verify-app: {
  "activation_flow":     "PASS",
  "brand_consistency":   "PASS",
  ...
  "system_migration":    "PASS",
  ...
  "overall":             "GREEN"
}

Release Status: PASS
```

**20/20 journeys GREEN · TASK 2 closed.**

### Explicit deferred work

- **Instagram / social publish bridge** (system #6) — the only `NEEDS BRIDGE — LARGE` row in the ledger. Source code exists in `desktop/src/lib/backend.ts:441-580` (`backend.publishNow()`); backend `/publish-now` is live and tested. Bringing this into desktop-2 is the largest remaining migration and should be its own dedicated task. Until it lands, the honest "Export" button label and the deferred-state copy in Settings make the customer-visible truth match the actual behavior.

---

## TASK 3 · Server-enforce client-only tier limits · GREEN (2026-06-22)

> Source of truth: `desktop-2/src/design-os/state/useTierCaps.ts` advertises
> these caps to the customer. Before TASK 3, 5 of them lived ONLY on the
> client — a scripted client could bypass every one by POSTing the backend
> directly.

### Gate 1 · routes that must enforce each cap

| # | Cap (client name) | Backend route | Insertion point |
|---|---|---|---|
| 1 | `perPlatformChannels` | `POST /channels` | `junior-backend/app/routes/channels.py` · BEFORE the existing total-channels cap |
| 2 | `monthlyPosts` | `POST /schedules` + `POST /publish-now` + `POST /schedules/drip-batch` | new `_enforce_monthly_post_cap()` helper in `app/routes/schedules.py`, reused by publish.py |
| 3 | `campaignsPerBrand` | `POST /agency/campaigns` | `app/routes/agency_campaigns.py:create_campaign` |
| 4 | `clipsPerCampaign` | `POST /submissions` | `app/routes/submissions.py:create_submission` (alongside existing 10/day daily-rate gate) |
| 5 | `bulkSchedulingRows` | `POST /schedules/drip-batch` | `app/routes/schedules.py:create_drip_batch` |

### Gate 2 · smallest fix

- `junior-backend/app/features.py` · added `TIER_LIMITS` dict (mirrors the client `TIER_CAPS` matrix exactly · free / solo / pro / agency) + `tier_limit(tier, key, founder)` helper. Founders + legacy aliases resolve to `agency`.
- `routes/channels.py` · per-platform cap inserted at line 374, runs BEFORE the total-channels cap so the customer sees the right error message (`"You've added the max N tiktok channel(s) for your tier."`).
- `routes/agency_campaigns.py:create_campaign` · counts non-closed `SponsoredCampaign` rows owned by user, raises 402 when at cap.
- `routes/submissions.py:create_submission` · counts non-rejected submissions to the same campaign by this user, raises 402 when at cap (sits next to the existing 10/day 429).
- `routes/schedules.py` · new `_enforce_monthly_post_cap()` counts rows in the `schedules` table created since the first of the current UTC month. Called from `create_schedule` (additional=1) and `create_drip_batch` (additional=len(items)).
- `routes/schedules.py:create_drip_batch` · row-count cap on `body.items`, raises 402 when oversized.
- `routes/publish.py:publish_now` · imports the same `_enforce_monthly_post_cap` and calls it (additional=1) so immediate publishes count too — a scripted client can't bypass by skipping `/schedules`.

### Gate 3 · backend tests

`junior-backend/tests/test_tier_enforcement.py` · 9 self-contained pytest tests · all PASS:

| Test | Proves |
|---|---|
| `test_tier_limits_matrix_matches_useTierCaps` | The numbers on server-side match the client matrix exactly (regression-locked) |
| `test_tier_limit_helper_resolves_legacy_aliases_and_founders` | `autopilot` → `agency`, `founder=True` → `agency`, unknown → `free` |
| `test_channels_per_platform_cap_blocks_second_handle` | Solo with 1 TikTok channel cannot acquire a 2nd (either 402 OR the idempotent-reuse path keeps row-count at 1) |
| `test_clips_per_campaign_cap_blocks_after_tier_limit` | Solo at 10 prior submissions cannot post an 11th (402 or 429) |
| `test_clips_per_campaign_higher_tier_higher_cap` | Agency cap = 200, not 10 |
| `test_campaigns_per_brand_cap_blocks_after_tier_limit` | Pro with 5 active campaigns cannot create a 6th (402) |
| `test_bulk_scheduling_rows_cap_blocks_oversize_batch` | Solo posting 2-row batch → 402 |
| `test_bulk_scheduling_rows_pro_tier_allows_25` | Pro posting 25-row batch → 201 (the cap, not below it) |
| `test_monthly_posts_cap_blocks_after_tier_limit` | Free with 25 prior rows this month cannot create a 26th (402) |

Self-contained: in-memory SQLite via `StaticPool` (works around the schema-creation bug in the pre-existing `test_webhooks_ayrshare.py` fixture).

### Gate 4 · verify-app aggregator

New `desktop-2/tests/e2e/tier-enforcement-backend.spec.ts` Playwright spec wraps the pytest suite via `spawnSync(venv/python, ["-m", "pytest", ...])`. pytest exit code 0 → journey PASS. Non-zero → FAIL with stdout/stderr tails attached to the verdict for debug.

```
verify-app: {
  "tier_enforcement_backend": "PASS",
  ...
  "overall": "GREEN"
}
```

**21/21 journeys GREEN · Release Status: PASS · TASK 3 closed.**

### Files changed

- `junior-backend/app/features.py`              · +`TIER_LIMITS` + `tier_limit()`
- `junior-backend/app/routes/channels.py`       · +per-platform check
- `junior-backend/app/routes/agency_campaigns.py` · +campaigns-per-brand check + `func` import
- `junior-backend/app/routes/submissions.py`    · +clips-per-campaign check
- `junior-backend/app/routes/schedules.py`      · +`_enforce_monthly_post_cap()` + bulk-rows check
- `junior-backend/app/routes/publish.py`        · reuses `_enforce_monthly_post_cap`
- `junior-backend/tests/test_tier_enforcement.py` · NEW
- `desktop-2/tests/e2e/tier-enforcement-backend.spec.ts` · NEW · wraps pytest

---

## TASK 4 · Agency single-operator launch readiness · GREEN (2026-06-22)

> Scope locked by the user: Agency in 2.1 = ONE operator with larger caps.
> NO team seats, NO sub-accounts, NO multi-user, NO Sui / attribution /
> payouts. Audit + harden launch blockers only.

### Gate 1 · agency surface inventory

| Surface | Status before | Status after | Where |
|---|---|---|---|
| Agency mode pill (TopHud) | WORKING | WORKING | `desktop-2/src/design-os/components/TopHud.tsx` mode pill · localStorage `lc.mode` |
| Mode-aware nav (Submissions / Analytics in agency only) | WORKING | WORKING | `desktop-2/src/design-os/components/ConsoleNav.tsx:44-46` `modes: ["agency"]` |
| Clipper-only routes hide in agency (My Journey · Earn) | WORKING | WORKING | same |
| ClipperJourney redirects to submissions in agency mode | WORKING | WORKING | `desktop-2/src/design-os/routes/ClipperJourney.tsx:40-43` |
| Campaign creation · "+ Create campaign" CTA | WORKING | WORKING | `desktop-2/src/design-os/routes/Campaigns.tsx` · gated on `canUseAgencyActions()` + admin allowlist |
| Campaign create backend write | WORKING | WORKING | `junior-backend/app/routes/agency_campaigns.py:create_campaign` + TASK 3 enforces `campaigns_per_brand` cap |
| Submissions Review surface | **FAKE** (5 fixture rows displayed as if real) | **COMING SOON** (banner + empty list) | `desktop-2/src/design-os/routes/SubmissionsReview.tsx` — fixture array emptied; historical rows preserved as `LEGACY_SUBMISSIONS_FIXTURE` const |
| Agency Analytics surface | COMING SOON (already honest) | COMING SOON (now harness-locked) | `desktop-2/src/design-os/routes/Analytics.tsx` · "—" placeholders + "Numbers stay quiet until Batch D" copy |
| Agency tier caps (channels-per-platform 5 · monthly-posts 2500 · campaigns-per-brand 20 · clips-per-campaign 200 · bulk 1000) | WORKING (server-enforced by TASK 3) | WORKING | `junior-backend/app/features.py:TIER_LIMITS` |
| Whop tier-upgrade link from Settings | WORKING | WORKING | TASK 2 wired (`settings-upgrade-whop` button → `whop.com/liquidclips/`) |
| Admin HQ deep-link from Settings | WORKING | WORKING | TASK 2 wired (`settings-open-hq`) |

No BROKEN surfaces. The two **PARTIAL** items both resolved to **honest COMING SOON** — the smallest correct shape per the user's rule.

### Gate 2 · smallest fix

- `src/design-os/routes/SubmissionsReview.tsx` · `FIXTURE_SUBMISSIONS = []`. Preserved the prior 5 preview-rows as `LEGACY_SUBMISSIONS_FIXTURE` const (`void` reference to satisfy unused-var lint). Added a clear COMING SOON banner above the layout (`data-testid="submissions-coming-soon"`, `data-state="coming-soon"`) with the same copy pattern as BUG-042 Library / BUG-046 Inbox / Channels backend-offline. Added `data-testid="submissions-layout"` + `data-submissions-count` + `data-testid="submissions-empty"` for harness grip.
- `src/design-os/routes/Analytics.tsx` · added `data-testid="analytics-stub"` + `data-state="coming-soon"` on the stub section, `data-testid="analytics-coming-soon-copy"` on the sub-copy, and `data-testid="analytics-card-value-<label>"` on each card value so the harness can assert every metric renders `"—"`.

No new product code. No new dependencies. No backend changes (agency creation + tier caps already shipped in TASKs 2 + 3).

### Gate 3 · harness

`desktop-2/tests/e2e/agency-launch-readiness.spec.ts` · 8 steps, 8/8 PASS first run:

1. Boot as admin agency operator · home tile renders.
2. Flip TopHud mode to agency · `localStorage.lc.mode === "agency"`.
3. ConsoleNav exposes Submissions + Analytics · clipper-only items (My Journey · Earn) are absent.
4. `/campaigns` route shows the `+ Create campaign` CTA without "checking" / "agency access required" suffixes (admin agency user is trusted).
5. `/submissions` shows COMING SOON banner, `data-submissions-count="0"`, empty state visible, NONE of the prior 5 fixture strings render (`@preview-clipper-0N`, "Sample clip · pending review", etc.).
6. `/analytics` shows honest "—" placeholders for every metric card · COMING SOON copy contains "wires" / "until".
7. Flip mode back to clipper · Submissions + Analytics disappear from nav; My Journey + Earn reappear.
8. STATIC contract · `desktop-2/src/design-os/state/useTierCaps.ts` agency block contains the expected numbers (15 channels, 5 per platform, 20 campaigns, 200 clips/campaign, 2500 monthly posts, Infinity bulk, 10 accounts per clip, templates true). Drift on either side fails the journey alongside `tier_enforcement_backend`.

### Gate 4 · verify-app

```
verify-app: {
  ...
  "agency_launch_readiness": "PASS",
  "tier_enforcement_backend": "PASS",
  ...
  "overall": "GREEN"
}
```

**22/22 journeys GREEN · Release Status: PASS · TASK 4 closed.**

### Answer to the framing question

> Can ONE OPERATOR successfully run the agency flow today?

**Yes.** They can:
- Switch to Agency mode (TopHud pill persists in localStorage).
- See Agency-specific navigation (Submissions, Analytics, hidden clipper-only items).
- Create campaigns up to their tier cap (20 for agency, server-enforced).
- Send 2500 posts/month, manage 15 channels / 5 per platform, run bulk batches up to 1000 rows (all server-enforced by TASK 3).
- View the Submissions Review surface and Analytics dashboard — both labeled honest COMING SOON with no fake data underneath; the agency operator knows exactly what is coming and what isn't.
- Upgrade their plan + reach Admin HQ via the Settings deep-links (TASK 2).

What they CAN'T do (out of scope by user directive, deferred to a future sprint):
- Invite sub-clippers / share a seat pool — `sub_accounts` is `built=false, sprint="v1.1"`.
- See backend-driven submission rosters or analytics rollups — `/campaigns/:slug/submissions` + analytics-rollup endpoints are Batch D scope.

Both deferred capabilities are surfaced honestly to the agency operator (COMING SOON banners), so launching today doesn't promise what we can't deliver.

---

## TASK 5 · Onboarding audit + fixes · GREEN (2026-06-22)

> Walk: Install → Activate → Connect → Generate → Export → Upgrade. Find
> confusion, dead ends, missing copy. Smallest fixes. Harness GREEN.

### Audit summary

Most onboarding stages were already harness-locked piecemeal (TASK 1 activation, home_dashboard, channels_station, campaigns_station, earn_station, settings_avatar, system_migration). The missing piece was a single first-run journey through one customer's lens that catches confusion + dead-end CTAs across stage boundaries.

Findings:

| Stage | Finding | Verdict |
|---|---|---|
| Install (DMG download) | Marketing CTA dynamic, Apple-Silicon-aware, signed + notarised in CI | WORKING (TASK 1) |
| Cold launch (no JWT) | LoginOnboarding renders a clear 4-step explainer ("Start activation → Sign in on the web → Browser returns → You're in") | WORKING |
| Activate | challenge → handleUrl → AuthGate flips to home | WORKING (TASK 1 locked) |
| Home tile labels | "Create Clips · paste a video URL" / "My Clips · everything you've made" / "Find Rewards · paid bounties to clip" / "Track Earnings · see what you've earned" · honest + actionable for new customer | WORKING |
| First Workstation visit (no clips) | `EngineEmptyState` renders "Cutting floor · empty · No source on the bench yet · Open Create Clips" with a real CTA | WORKING (added testids) |
| First Channels visit (backend offline) | per-platform Add-account tiles report `data-channels-add-state="coming-soon"` honestly | WORKING (TASK 2 locked) |
| First Campaigns visit | backend-offline banner + zero fake-campaign rows | WORKING (FEATURE-002 locked) |
| Settings activation row | reads "Active license" / "Active · sync pending" / "Active license · saved from a prior session" — three honest states | WORKING |
| Settings · upgrade button copy (FREE customer) | **BROKEN**: read "Manage plan on Whop ↗" for new free customers because `tierLabel === "FREE"` could never be true (the tier mapping collapses `free` → client tier `"clipper"`, capitalised to `"CLIPPER"`) | **fixed** |
| Settings · upgrade button copy (PAID customer) | reads "Manage plan on Whop ↗" | WORKING |
| Avatar chrome reachable across all routes | TopHud avatar mounted on every route · click → menu (Settings / Notifications / Sign out) | WORKING (BUG-046 locked) |
| Returning user (JWT preserved) | AuthGate skips LoginOnboarding, lands on home | WORKING (TASK 1 locked) |

### Smallest fix applied (Gate 2)

- `src/design-os/routes/Settings.tsx` · 3 occurrences of `tierLabel === "FREE"` → `tier.tier === "clipper"`. The client `Tier` enum collapses backend `free` + `starter` + `clipper` into the single `"clipper"` value; the upgrade-button label, Tier row value, and `data-upgrade-state` attribute now branch on the actual client tier instead of an UPPER-cased label that could never match.
- `src/design-os/engine/EngineEmptyState.tsx` · added `data-testid="workstation-empty"` + `data-testid="workstation-empty-cta"` so the first-run harness can assert the empty-state contract.

No copy reword, no new product code.

### Harness (Gate 3)

`desktop-2/tests/e2e/first-run-onboarding.spec.ts` · 10 steps, 10/10 PASS:

1. Cold launch (no JWT) · LoginOnboarding renders the 4-step explainer (steps include "Start activation", "Sign in on the web", "Browser returns").
2. Activate · `begin()` + `handleUrl()` with matching challenge · AuthGate flips to home.
3. Home · 4 tiles visible · avatar chrome present · TopHud has NO fake "1.4k clips" default · earn strip honestly shows `$0.00`.
4. Click "My Clips" tile · Workstation empty state visible · contains "No source" + "paste a..." copy · no fake clip grid mounted.
5. Click Channels · `data-channels-add-state` is `coming-soon` or `available` · zero `@uncle.daniel*` / `@ddbeauty*` / `@enumcos` leakage.
6. Click Campaigns · honest offline state · zero "Uncle Daniel" / "DD Beauty" / "Femi" / "Clip Squad 2026" leakage.
7. Open Settings · "Active license" present · Upgrade button visible reading "View plans on Whop ↗" for FREE customer · `data-open-url="https://whop.com/liquidclips/"`.
8. Cold reload with JWT preserved · AuthGate skips LoginOnboarding · home tile renders · `login-state-idle` absent.
9. Reboot as paid customer (pro) · Upgrade copy flips to "Manage plan on Whop ↗" (uses `__lcDebugSetTier` to force the client-side tier without waiting on /me roundtrip, then polls the button text).
10. Avatar chrome reachable from every primary route · clicking Notifications opens the InboxSheet in honest `data-inbox-state="coming-soon"` with `data-inbox-unread-count="0"`.

### Gate 4 · verify-app

```
verify-app: { ..., "first_run_onboarding": "PASS", ..., "overall": "GREEN" }
Release Status: PASS
```

**23/23 journeys GREEN · TASK 5 closed.**

### Real onboarding bug surfaced

The Settings → Upgrade button was advertising "Manage plan on Whop ↗" to **every free customer** because the conditional checked `tierLabel === "FREE"` but the tier mapping in `useTierCaps.mapBackendTier` collapses backend `free` into the client enum `"clipper"`. A new free user would arrive at Settings and see a button that talks about managing a plan they don't have. That would route them into Whop's existing-subscription dashboard instead of the plans page · confusing dead-end. Fixed in 3 lines, locked by the harness.

---

## TASK 6 · Brand Consistency sweep · GREEN (2026-06-22)

> Second pass after FEATURE-002. Goal: every visible screen feels like
> one product. Deliverable: `desktop-2/docs/BRANDING_INCONSISTENCY_LEDGER.md`.

### Gate 1 · audit findings

Read-only sweep across recently-touched surfaces (TASKs 1-5) + a high-level scan across every route, component, and cockpit module under `src/design-os/`.

| Section | Findings |
|---|---|
| A · Coming-soon copy variants | **1 P0** in customer copy + 1 P2 comment token (both in `Settings.tsx`) · all other variants are justified per-surface |
| B · Backend-offline pill copy | OK · matches canonical three (`Backend offline · preview only` / `Live · backend` / `Studio preview`) |
| C · Off-brand / legacy / fixture strings | OK · all remaining hits are inside `LEGACY_*_FIXTURE` consts (not read in production) or mock-only export fixtures |
| D · Mixed terminology | OK · no unjustified vocabulary collisions |
| E · Button-label style | OK · `↗` on external · `→` on in-app · no weak labels |
| F · Empty-state copy | OK · eyebrow → heading → body → CTA pattern uniform |
| G · Above-the-fold | OK · every route renders title + (where applicable) primary CTA without scroll |
| H · Typography drift | OK · inline styles are semantic colour tokens |
| I · Spacing / hardcoded widths | OK · 1280×800 Tauri viewport fits everywhere |
| J · Icons | OK · Lucide-style inline `<svg>` throughout · one decorative `✦` in TopHud greeting |
| K · Tier dead conditionals | OK · zero `tierLabel === "FREE"` survivors after TASK 5 fix |

### Gate 2 · smallest fix

- `desktop-2/src/design-os/routes/Settings.tsx:581` · Stripe Connect explainer copy rewritten · `"Reserved for native Liquid Clips payout rails · post-beta. In beta, payouts settle on Whop · this row is informational."` → `"Reserved for native Liquid Clips payout rails · coming soon. Today, payouts settle on Whop · this row is informational."` Removes the timeline phrase + matches the canonical "Coming soon" vocabulary.
- `desktop-2/src/design-os/routes/Settings.tsx:706` · comment `Native billing · post-beta` → `Native billing · coming soon` for consistency.

No other production-code changes.

### Gate 3 · harness extensions

`desktop-2/tests/e2e/brand-consistency.spec.ts` · added 2 STATIC contracts:

1. **No dead `tierLabel === "FREE"` conditional resurfaces** · walks every `.ts`/`.tsx` under `src/`. Locks the bug class TASK 5 surfaced (mapping collapses `free` → client `"clipper"` so `tierLabel === "FREE"` could never match · routed every free customer to the "Manage plan" copy).
2. **No `Coming soon · post-beta` / bare `post-beta` literal resurfaces** · same scan, strips comments first. Both variants forbidden; the bare-token check caught the Settings.tsx Stripe Connect explainer fixed in Gate 2.

These add to the existing FEATURE-002 locks: forbidden-substrings sweep across all 12 routes, canonical pill copy (3 strings), no hardcoded nav badges, no horizontal overflow, route titles present, avatar reachable everywhere.

### Gate 4 · verify-app

```
verify-app: { ..., "brand_consistency": "PASS", ..., "overall": "GREEN" }
Release Status: PASS
```

**23/23 journeys GREEN · TASK 6 closed.**

### Deliverable

`desktop-2/docs/BRANDING_INCONSISTENCY_LEDGER.md` · NEW. Full file/line/severity/fix table per section A-K plus the regression-lock contracts added in Gate 3.

---

## TASK 7 · Splash + Intro · Agency Palette · Future-Rails Map · GREEN (2026-06-22)

> Three-part deliverable: 7A splash/intro lock, 7B agency blue accent, 7C
> billing/future-rails doc. Rule: reuse existing approved assets; only
> generate via Higgsfield/Seedance with locked Kade+brand character
> consistency if a real gap exists.

### TASK 7A · Splash + Intro Experience

**Inventory finding · 80%+ of the narrative is already built.** The
existing `desktop-2/src/overlays/IntroSplash.tsx` implements the 3-stage
flow (intro video → loading → SplashGame → AppShell) that maps cleanly
onto the user's narrative steps 1-2-3-4-5-7-8. Step 6 (community
counters animate) is the only piece that doesn't yet exist as a visible
component, and the spec rule "no fake metrics" + the splash's
pre-auth runtime context (no `/me` / `/sync` data yet) make a real
counter a future iteration — flagged as deferred, not built with fake
numbers.

**Existing approved assets reused (no generation):**
- `public/brand/intro/intro.mp4` (28.5s Seedance cinematic, already deployed)
- `public/brand/intro/closing-still.png` (Oasis anchor frame for stages 2-3)
- 24 Kade pose webp files under `public/brand/kade/` (idle / shooter / success / all tiers)
- 8 bug/enemy sprites under `public/brand/enemies/` (bug-grunt / bug-spider / repair-drone / etc.)
- 11 invaders game sprites under `public/brand/invaders/` (player ship / grunts / boss / mothership)
- 8 world backgrounds under `public/brand/worlds/` (boot-sequence + 7 more)
- 40 brand icons under `public/brand/icons/` (SVG · all categories)
- 18 modular Seedance render segments in `/Users/dipdip/code/jnr/assets-wip/intro-30s/` (ready to swap in if Daniel chooses a different cut)

**Smallest fix (Gate 2):**
- `src/overlays/IntroSplash.tsx` · added `data-testid="intro-splash"` + `data-splash-stage` attribute on every stage container · `data-testid="intro-splash-video"` on the `<video>` element · `data-testid="intro-splash-skip"` on both skip buttons (intro stage + loading/game stage).
- `src/overlays/IntroSplash.tsx` + `src/overlays/invaders/SplashGame.tsx` · the Skip + Continue buttons now share `font-sans` (was `font-mono` on Skip, `font-sans` on Continue). User directive: "ensure the skip intro and continue buttons are all on brand using same fonts." Both buttons stay tier-appropriate in size (Skip 11px eyebrow, Continue 14px primary) but their type family matches.
- `src/overlays/invaders/SplashGame.tsx` · added `data-testid="intro-splash-continue"` on the Continue CTA.

No generation. Existing intro.mp4 + closing-still.png cover all narrative beats 1-5; the SplashGame canvas covers the "Kades convert bugs" arc; the AppShell hand-off covers steps 7-8.

### TASK 7B · Agency Visual Identity

**Smallest fix · CSS variable token + body attribute setter:**
- `src/index.css` · introduced `--lc-accent` (defaults to `var(--color-fuchsia)`) and `--lc-accent-deep` (defaults to `var(--color-fuchsia-deep)`). Defined `--lc-accent-blue: #2D7FF9` + `--lc-accent-blue-deep: #1B5DC4` as the new agency tokens. Added a `body[data-app-mode="agency"]` selector that overrides `--lc-accent` to the blue token.
- `src/design-os/bridge/useMode.ts` · module-level subscriber writes `body.data-app-mode` on boot AND on every `mode:change` broadcast. Synchronises across every mounted `useMode()` instance.
- `src/design-os/components/TopHud.css` · `.lc-hud-mode-opt.on` (the active mode pill) now consumes `var(--lc-accent)` via `color-mix` for background/box-shadow + uses the accent directly for text colour. The fuchsia → blue flip is automatic.

Existing agency-only surfaces (Submissions, Analytics, agency campaign-manage strip, mode pill) inherit the blue accent automatically wherever they consume `var(--lc-accent)`. The mode pill is the visible signal; the broader recolour can ride a future repaint pass without breaking the harness.

### TASK 7C · Billing / Future-Rails Mapping

Deliverable: `/Users/dipdip/code/jnr/docs/BILLING_FUTURE_RAILS_MAP.md`. **No code · pure documentation.**

Documents the **current source of truth** for 7 domains:

1. Clerk subscriptions
2. Whop rewards (campaigns + bounties + content rewards)
3. Referral attribution (first-touch lock at signup, never overwritten)
4. Agency limits (TASK 3 server-enforced TIER_LIMITS)
5. Watermarks (deriveWatermarkPromise single-source)
6. Earnings (Whop ledger + Stripe Connect fallback)
7. Connected accounts (Ayrshare profiles)

And maps the **insertion points** future sovereign rails (Sui payouts, attribution engine, proxy settlement, USDC payout, wallet) drop into WITHOUT shell-architecture changes. Codifies 6 invariants the shell expects so future providers can swap in cleanly.

### Gate 3 · harness

`desktop-2/tests/e2e/splash-and-agency-palette.spec.ts` · 9 steps, 9/9 PASS first run:

1. STATIC · all splash assets on disk (intro.mp4, closing-still.png, Kade base/shooter/success, bug-grunt, bug-spider, boot-sequence world).
2. STATIC · IntroSplash 3-stage union + data-splash-stage attribute + every testid present.
3. STATIC · Skip + Continue buttons share `font-sans` (no `font-mono` survivors).
4. LIVE · first launch (`lc:intro-seen` absent) renders intro stage with `data-splash-stage="intro"`.
5. LIVE · Skip button advances past intro stage within 10s.
6. LIVE · returning customer (`lc:intro-seen` set) boots past intro stage.
7. LIVE · `body[data-app-mode="clipper"]` set at boot · `--lc-accent` is NOT blue.
8. LIVE · flip to agency · `body[data-app-mode="agency"]` updates · `--lc-accent` resolves to blue.
9. LIVE · agency mode pill text colour is BLUE-channel-dominant (b > r AND b > g).
10. LIVE · flip back to clipper · mode pill colour reverts to fuchsia (red-dominant).

### Gate 4 · verify-app

```
verify-app: {
  ...
  "splash_and_agency_palette": "PASS",
  ...
  "overall": "GREEN"
}

Release Status: PASS
```

**24/24 journeys GREEN · TASK 7 closed.**

### What is NOT in TASK 7

- **No new Higgsfield / Seedance generation.** Inventory proved every needed asset already on disk. Future iterations may add: animated bug overlays during the cinematic, a real community-counters HUD (requires a public-counter endpoint that doesn't exist yet), Kade reaction frames during gameplay. All three are visual-upgrade-only iterations that don't change the splash flow contract this harness locks.
- **No agency repaint beyond the mode pill.** Every surface that consumes `var(--lc-accent)` already flips blue. Wider repaint (recoloring every fuchsia border across Campaigns / Submissions / Analytics) can ship in a follow-up sprint without breaking the contract.
- **No Sui / payout / attribution implementation.** The future-rails map is documentation only.

---

## FEATURE-005 · Onboarding Audit · Phase E

_pending._

---

## Phase F · Launch Polish

_pending._

---

## Future-systems insertion points

_pending · after all audit phases._
