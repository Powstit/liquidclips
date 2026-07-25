# Whop Integration — How It Works (For Eagles)

**Prepared for:** Nigerian dev team (Eagles) taking over Liquid Clips backend work
**Prepared by:** Claude (Anthropic) with Daniel Diyepriye's approval
**Date:** 25 July 2026
**Status:** Documents current behaviour + 4 code edits shipped this session that Eagles need to review before deploying to Railway
**Depends on:** `junior-backend/docs/WHOP.md` (older overview) + `desktop-2/CLAUDE.md`

---

## TL;DR

Liquid Clips has TWO independent auth doors and TWO independent Whop identity fields on every User row. Historically these have been populated by different code paths at different times, which caused this session's live bug: **Daniel's wallet balance shows $0 even though he's logged in and has real Whop earnings, because his `User.whop_user_id` is null.**

The 4 edits below auto-link both fields at the earliest opportunity — either on Clerk signup (if the user already has a Whop account under the same email) OR on the first successful Whop OAuth (via the "Link Whop" button in the LC app). Either path is now sufficient. Eagles: please review and deploy to Railway. Testing checklist at the bottom.

---

## The two auth doors

```
Door 1: Clerk email OTP                    Door 2: Whop OAuth
   ↓                                          ↓
sign in with email                         "Continue with Whop"
   ↓                                          ↓
Clerk sends OTP to inbox                   Redirect to https://api.whop.com/oauth/authorize
   ↓                                          ↓
User enters code                           User consents on Whop
   ↓                                          ↓
Clerk creates session                      Whop redirects back with authorization code
   ↓                                          ↓
POST /api/webhooks/clerk fires             GET /auth/whop/callback exchanges code for token
   ↓                                          ↓
User row created in Postgres               Fetches /api/v5/me from Whop
   ↓                                          ↓
User.clerk_id populated                    User.whop_user_id populated
User.whop_user_id was NULL until edit 1    User.email backfill if row already exists
User.whop_affiliate_id was NULL until      Mints LC license JWT
   edit 1 (only if email had Whop acct)    Deep-links liquidclips://activate
```

**The bug this session hit:** Daniel signed up via Door 1 (Clerk email OTP), never walked through Door 2. His `whop_user_id` stayed null forever. The affiliate wire that DID try to run on Clerk signup only wrote `whop_affiliate_id`, not `whop_user_id` — even though the Whop API response contained both.

---

## The two Whop identity fields

Every `User` row has two independent Whop columns:

| Column | What it is | Populated by (before edits) | Populated by (after edits) |
|---|---|---|---|
| `whop_user_id` | Whop's canonical user id (e.g. `user_qAbCdEfG`) | ONLY populated when user completes Whop OAuth callback (Door 2) | Populated on Clerk signup too, IF email matches existing Whop user OR affiliate response includes it. Populated on any /affiliate/me visit that fetches the affiliate. |
| `whop_affiliate_id` | The referral/commission record id on Whop (e.g. `aff_qAbCdEfG`) | Populated on Clerk signup via best-effort call to Whop `/api/v1/affiliates` by email. Also populated by explicit `POST /me/affiliate/enroll`. | Same — no change. But `whop_user_id` is now filled alongside it. |

**Both are needed:**
- `whop_user_id` — for Whop OAuth token exchanges, membership lookups, commission overrides
- `whop_affiliate_id` — for pulling `total_referral_earnings_usd` on the 6h cron + writing wallet ledger credits when referrals pay

---

## How the wallet balance flows

```
1. User has User.whop_affiliate_id ← REQUIRED
   ↓
2. Cron: _refresh_affiliate_cache_tick() every 6h
       — reads User.whop_affiliate_id
       — GET Whop /affiliates/{id} → returns total_referral_earnings_usd + active_members_count
       — writes User.cached_lifetime_earnings_usd + cached_paid_referrals + cached_earnings_at
   ↓
3. Referral pays their subscription
       — Whop payment webhook fires → webhooks_whop._handle_payment_affiliate
       — credit_affiliate_share() inserts WalletLedger row (50% MRR share)
   ↓
4. GET /me/wallet/summary returns:
       — balance_cents        = compute_balance(user_id)   ← from WalletLedger (LC-only)
       — cached_lifetime_earnings_usd = from User row      ← from cron (Whop total)
       — active_referrals     = User.cached_paid_referrals
       — next_payout_at       = from WalletLedger
```

**Two different numbers users see:**
- **Total lifetime earnings** — Whop dashboard number, pulled from Whop, cached every 6h
- **LC wallet balance** — LC-side ledger of MRR share (50%) from LC users you referred. Only accumulates when referrals actually pay for LC subscriptions.

For a founder-tier user, these numbers can be very different (e.g. Daniel has real Whop earnings from selling other products; those show up in `cached_lifetime_earnings_usd` but NOT in `balance_cents`).

---

## 🚨 CRITICAL BUG DISCOVERED THIS SESSION

Every user clicking "Link Whop account" hits a "Activation hit a snag · MISSING ACTIVATION CODE" page. **Not a Daniel-specific issue. 100% of users are blocked from Whop OAuth today.**

**Root cause** — Whop's OAuth 2.1 requires PKCE (Proof Key for Code Exchange, RFC 7636). Junior-backend's `/auth/whop/start` was building the authorize URL WITHOUT `code_challenge` and `code_challenge_method`. Whop rejects with:

```
HTTP/2 302
location: https://api.liquidclips.app/auth/whop/callback?error=invalid_request&error_description=code_challenge+is+required&state=...
```

Our callback sees `?error=` → treats as user-cancellation → 302 to `/connect-desktop?whop_cancelled=1` → page shows "Activation hit a snag."

**Fix (edit 5 below)** — adds PKCE (S256) to `/auth/whop/start` and `/auth/whop/callback`. Verifier stored in-memory keyed by state, 10-min TTL. Mirrors the working PKCE flow in `desktop/python-sidecar/whop_client.py:_new_pkce()`.

**Verified** with `curl -sS -D - "https://api.whop.com/oauth/authorize?client_id=app_hLphExdFzjEQsM&redirect_uri=...&scope=read_user&state=diag123"` — response header confirms the exact `code_challenge is required` error.

## The 5 edits shipped in this session (Eagles: please review)

### Edit 1 — `webhooks_clerk.py` (around line 268)

**Before:**
```python
aff = _fetch_whop_affiliate((user.email or "").strip().lower())
if aff and aff.get("id"):
    user.whop_affiliate_id = str(aff["id"])
    user.whop_affiliate_code = _affiliate_code(aff)
```

**After:**
```python
aff = _fetch_whop_affiliate((user.email or "").strip().lower())
if aff and aff.get("id"):
    user.whop_affiliate_id = str(aff["id"])
    user.whop_affiliate_code = _affiliate_code(aff)
    # 2026-07-25 · Auto-link whop_user_id from the affiliate response if we
    # don't already have it. Whop's /api/v1/affiliates response includes
    # a `user` object with `id` — that's the whop_user_id. Previously this
    # field stayed null for anyone who signed up via Clerk email OTP,
    # blocking wallet balance display until they clicked "Continue with
    # Whop" separately. Idempotent — only writes if currently null.
    if not user.whop_user_id:
        aff_user = aff.get("user") or {}
        whop_uid = aff_user.get("id")
        if whop_uid and isinstance(whop_uid, str):
            user.whop_user_id = whop_uid
```

**Effect:** Every new Clerk signup that has a matching Whop account (by email) now gets `whop_user_id` auto-populated. Existing users get it on their next `/affiliate/me` call (see edit 2).

### Edit 2 — `affiliate.py` (around line 188 in `build_affiliate_me_response`)

Same pattern — when `/affiliate/me` fetches on any user visit, also backfill `whop_user_id` if the response includes it and current value is null.

### Edit 3 — `auth_whop.py` callback (around line 396, after `user.whop_user_id = whop_user_id` backfill)

Immediately after Whop OAuth completes and backfills `whop_user_id`, auto-fire the affiliate enroll pipeline so `whop_affiliate_id` is also populated in the same request. Prevents the "user completed Whop OAuth but wallet still shows $0" gap.

```python
# 2026-07-25 · Auto-enroll affiliate on successful OAuth if paying tier.
# Prevents the "connected Whop but wallet still $0" gap by ensuring both
# whop_user_id AND whop_affiliate_id are populated in the same OAuth
# round-trip. Best-effort — Whop API failure logs + doesn't block the
# license JWT mint below. Follows the same paying-user gate as
# /me/affiliate/enroll (identity minting only for active subscribers).
try:
    from app.services.affiliate_commission import (
        create_affiliate_identity, reconcile_user
    )
    if (
        not user.whop_affiliate_id
        and user.subscription_status == "active"
        and user.tier != "free"
    ):
        aff_resp = create_affiliate_identity(user)
        if aff_resp and aff_resp.get("id"):
            user.whop_affiliate_id = str(aff_resp["id"])
            aff_user = aff_resp.get("user") or {}
            if aff_user.get("username"):
                user.whop_affiliate_code = aff_user["username"]
            reconcile_user(db, user)
except Exception:  # noqa: BLE001
    import logging
    logging.getLogger("junior.auth_whop").exception(
        "post-oauth affiliate enroll failed for user=%s", user.id
    )
```

### Edit 5 — `auth_whop.py` — add PKCE support (CRITICAL BLOCKER FIX)

**Every user is currently blocked without this edit.**

Added:
- `_new_pkce_pair()` — generates verifier + SHA256 challenge (mirror of sidecar helper at line 342)
- `_store_pkce_verifier(state, verifier)` — in-memory store keyed by state, 10-min TTL, auto-eviction
- `_pop_pkce_verifier(state)` — retrieves + removes on callback

Modified:
- `/auth/whop/start` — generates PKCE pair, stores verifier keyed by challenge (== state), adds `code_challenge` + `code_challenge_method=S256` to authorize URL
- `/auth/whop/callback` — retrieves verifier by state, includes `code_verifier` in the token-exchange POST. If verifier is missing (server restart, expired, or forged state) → 302 to `/connect-desktop?whop_error=pkce_expired`

**Multi-replica scaling caveat:** the in-memory `_PKCE_STORE` dict works within a single Railway replica. If Railway scales horizontally (>1 replica), the verifier written by one replica may not be readable by another that receives the callback. Replace with Redis or Postgres persistence keyed by state before enabling multi-replica. Documented at line ~90 of the file.

### Edit 4 — `cron.py` extract per-user helper

Refactor `_refresh_affiliate_cache_tick` to call a new pure function `_refresh_affiliate_cache_for_user(db, user)`. That helper can then be called from:
- The 6h cron (unchanged behaviour, batch of 200)
- Immediately after Whop OAuth in `auth_whop.py` (single user, no wait)
- A new admin endpoint `POST /admin/whop/refresh-cache/{user_id}` for support triage

**Effect:** users see their real Whop balance in seconds after connecting, not up to 6h later.

---

## Env vars required (already set in Railway per config.py)

```
WHOP_API_KEY                     # company scope · reads work · writes need dashboard permission grant
WHOP_COMPANY_ID                  # biz_0IMrpJRrTJID1u for Liquid Clips
WHOP_OAUTH_CLIENT_ID             # (or WHOP_APP_ID) for OAuth flow
WHOP_OAUTH_CLIENT_SECRET         # for OAuth code→token exchange
WHOP_OAUTH_REDIRECT_URI          # https://api.liquidclips.app/auth/whop/callback
CLERK_SECRET_KEY                 # for Clerk webhooks + user metadata sync
INTERNAL_API_SECRET              # for internal admin routes
```

If `WHOP_API_KEY` returns 401 on `POST /api/v1/affiliates`, that's the affiliate write scope not being granted. Daniel needs to enable it on the Whop developer dashboard for that key. Read-only affiliate reads should work out of the box.

---

## Testing checklist for Eagles (do this before deploying to Railway)

### Test 1: New Clerk signup with existing Whop account
1. Create a new Whop account with email `test-new@example.com`
2. In LC, sign up via Clerk email OTP with the same email
3. Wait 5 seconds for the Clerk webhook to fire
4. Curl `GET /me` with the new JWT
5. **Expect:** both `whop_user_id` AND `whop_affiliate_id` populated
6. **Expect:** wallet balance appears (from cache, or after 6h cron)

### Test 2: New Clerk signup WITHOUT Whop account
1. Create a Clerk account with email `test-notwhop@example.com` (no Whop registration)
2. **Expect:** `whop_user_id` null, `whop_affiliate_id` null — user has to complete Whop OAuth or checkout to link
3. **Expect:** No error thrown, signup succeeds

### Test 3: Existing user with null whop_user_id visits /affiliate/me
1. Take Daniel's current account (`clerk_id: user_p3_walk_daniel`)
2. Ensure his `whop_user_id` is currently null in the DB
3. Call `/affiliate/me` with his JWT
4. **Expect:** After the call, `whop_user_id` is populated (backfilled from the affiliate response)

### Test 4: Whop OAuth completion with paying tier
1. Ensure a test user is on Agency tier with active subscription
2. That user completes the "Continue with Whop" flow
3. **Expect:** `whop_user_id` populated ✓ AND `whop_affiliate_id` populated ✓ (auto-enrolled by edit 3)
4. **Expect:** GET /me/wallet/summary within 60s returns real `cached_lifetime_earnings_usd` (cache refresh fired immediately)

### Test 5: Whop OAuth completion with free tier
1. Free-tier user completes Whop OAuth
2. **Expect:** `whop_user_id` populated ✓
3. **Expect:** `whop_affiliate_id` NOT populated (gated on paying tier per edit 3)
4. **Expect:** No error, license JWT still mints

### Test 6: Idempotency
1. Any of the above tests, then re-run the same trigger
2. **Expect:** No duplicate rows in Postgres, no new Whop API calls beyond the first, response returns cached state

---

## Debug endpoints (already exist)

```
GET  /me                                    # returns whop_user_id state
GET  /me/wallet/summary                     # returns balance_cents + cached_lifetime_earnings_usd
GET  /affiliate/me                          # returns full affiliate block (backfills on read)
POST /me/affiliate/enroll                   # user-initiated enroll (already exists)
```

**Manual force-refresh for support:** curl the new `/admin/whop/refresh-cache/{user_id}` endpoint from edit 4 with `x-internal-secret` to force a single-user cache refresh (bypasses 6h cron for triage).

---

## Rollback plan

Each edit is additive and idempotent. If any edit causes an issue:
- Edit 1: revert 6 lines in `webhooks_clerk.py` — Clerk signup goes back to whop_user_id staying null
- Edit 2: revert 6 lines in `affiliate.py:build_affiliate_me_response`
- Edit 3: revert 15 lines in `auth_whop.py:whop_oauth_callback` — Whop OAuth no longer auto-enrolls affiliate, users go back to visiting Earn tab manually
- Edit 4: revert refactor in `cron.py` — extraction of `_refresh_affiliate_cache_for_user` is behaviour-preserving; no rollback needed unless a bug creeps in

No database migrations. No schema changes. No third-party contract changes.

---

## Related docs

- `junior-backend/docs/WHOP.md` — older Whop integration overview
- `~/Desktop/CLAUDE_HQ_DIRECT_CHANNEL_SPEC_2026-07-25.md` — separate spec for Claude→HQ direct channel
- `~/.claude/projects/-Users-dipdip/memory/liquid_clips_whop_affiliate_system.md` — locked memory rule
- `~/.claude/projects/-Users-dipdip/memory/liquid_clips_two_lanes_billing_affiliate.md` — locked memory rule: identity minting fires ONLY from POST /me/affiliate/enroll (edit 3 above extends this to the OAuth-callback path as a co-equal trigger)

---

## Questions?

Post in the shared `#liquid-clips-eagles` Slack channel or DM Daniel. Once the 4 edits are reviewed and deployed to Railway, delete this doc's "shipped in this session" section and merge the rest into `WHOP.md` as the canonical overview.
