# Whop Integration — Map of What's Wired

If you're touching anything Whop-related (webhooks, affiliates, bounties, plans, Partner Engine), read this first. Spec for the Partner Engine ladder lives at `Uncle Daniel team folder/LiquidClips/LIQUIDCLIPS-PARTNER-ENGINE.md` (Dropbox).

---

## 1. The funnel in one paragraph

A visitor clicks `api.jnremployee.com/r/{tracking_id}` (an affiliate tracking link). The redirect handler plants `jnr_ref` + `jnr_tracking_link` cookies (first-touch, never overwritten) and 302s them to the destination. They sign up via Clerk; the account-app passes `unsafe_metadata.affiliate_id` from the cookie. Clerk's `user.created` webhook lands at `/webhooks/clerk`, which locks `users.affiliate_id` (= the referrer who sent them) — never overwritten thereafter. Separately, when the user opens their own affiliate dashboard, `/affiliate/me` (or `/me/affiliate` from the desktop) calls Whop's `POST /api/v1/affiliates` with `user_identifier=<email>` (idempotent get-or-create), caches the returned `id` on `users.whop_affiliate_id`, and returns a referral URL of the form `<account_site>/checkout?a=<aff_id>`. When a buyer lands on that URL and pays, Whop fires `membership_went_valid` → `payment_succeeded` to `/webhooks/whop`; the handler maps `data.plan.id` to a tier, mints a license JWT, and on the first paid transition fires affiliate-lifecycle emails to the referrer. Content Rewards bounties are surfaced through a server-side App API Key proxy at `/whop/bounties` (license-JWT-gated so a leaked desktop key only sees what the App key can already see).

---

## 2. File map — every Whop touchpoint

### Backend (`junior-backend/app/`)
| File | Purpose |
|---|---|
| `routes/webhooks_whop.py` | HMAC-verified webhook entry. Handles membership valid/invalid + payment succeeded/refunded. Idempotent via `WebhookEvent.external_id`. Fires affiliate lifecycle emails. |
| `routes/affiliate.py` | `/affiliate/me` (server-to-server, internal-secret-gated) + the `build_affiliate_me_response` shared builder also used by `/me/affiliate`. Idempotent Whop affiliate get-or-create. Caches `whop_affiliate_id`. |
| `routes/whop.py` | Bounty proxy. Server-side App API Key calls `publicBounties` GraphQL. In-process cache (60s list / 120s detail / 30s submission). |
| `routes/webhooks_clerk.py` | Locks `users.affiliate_id` from Clerk metadata at signup. **Never** overwrites it. |
| `routes/redirect.py` | `/r/{tracking_id}` tracking-link resolver. Plants first-touch cookies. |
| `routes/onboarding.py` | `/onboarding/link-whop` claims a `PendingWhopMembership` row if a buyer paid before signing up. |
| `cron.py` | `_refresh_affiliate_cache_tick` — every 6h, refreshes per-user `cached_lifetime_earnings_usd`, `cached_paid_referrals`, `cached_display_handle` so the leaderboard reads from local rows, not Whop. |
| `mailer.py` | `send_first_paid_referral`, `send_affiliate_qualified`, `send_subscription_activated`, `send_subscription_canceled`, `send_founder_welcome`, `send_admin_affiliate_milestone`, `send_admin_paid_customer_alert`. |
| `models.py` | `User` table (Whop columns below). `PendingWhopMembership` parks entitlements for unknown-buyer-paid-first cases. `WebhookEvent` for idempotency. |
| `main.py` | Lifespan ALTER block — idempotent migrations targeting Postgres in prod. SQLite locally rebuilds from `create_all` (so dropping `junior-backend.db` is the local reset). |

### Desktop (`desktop/`)
| File | Purpose |
|---|---|
| `python-sidecar/whop_client.py` | PKCE OAuth (port 8765 loopback), token storage in keychain. GraphQL queries route through the backend proxy via `_backend_get()`, not direct. |

### Account / Partner apps
| File | Purpose |
|---|---|
| `partner-app/lib/whop.ts` | Whop SDK client, OAuth helpers. |
| `account-app/` | The Clerk-authed customer dashboard that calls `/affiliate/me`. |

---

## 3. The two ID columns people get wrong

The single biggest footgun in this codebase:

```
User.affiliate_id            ← INBOUND. The referrer who sent THIS user.
                               Locked at signup from Clerk metadata.
                               NEVER overwritten. (oauth-billing.md §6.)

User.whop_affiliate_id       ← OUTBOUND. THIS user's own Whop affiliate
                               record id. Cached lazily on first
                               /affiliate/me read. Used for reverse-lookup
                               on paid-conversion webhooks (buyer's
                               affiliate_id → referrer User row).
```

If a paid-conversion webhook fires and the referrer hasn't viewed their dashboard yet, `whop_affiliate_id` will be `NULL` for them and `_fire_affiliate_lifecycle_emails` silently skips. Email lands on the next conversion after they engage. By design — see comment in `webhooks_whop.py::_fire_affiliate_lifecycle_emails`.

---

## 4. Env vars

| Var | Where used | Notes |
|---|---|---|
| `WHOP_API_KEY` | `routes/whop.py`, `routes/affiliate.py`, `cron.py` | **Company API key** (acts as the LiquidClips company). Server-side only. Never expose. |
| `WHOP_WEBHOOK_SECRET` | `routes/webhooks_whop.py` | HMAC-SHA256 secret. If unset (dev), signature check is skipped. |
| `WHOP_COMPANY_ID` | `routes/affiliate.py` | `biz_0IMrpJRrTJID1u`. |
| `WHOP_APP_ID` | (reserved) | `app_hLphExdFzjEQsM`. |
| `WHOP_PARTNER_DASHBOARD_URL` | `routes/affiliate.py` | Where users go to manage their affiliate. |
| `WHOP_MANAGE_URL`, `WHOP_PAYOUTS_URL` | `routes/affiliate.py` | Subscription + payouts deep links surfaced in the dashboard. |
| `INTERNAL_API_SECRET` | `routes/affiliate.py::_require_internal` | Shared secret for the account-app → backend call. |
| `PARTNER_UNLOCK_LIVE` *(planned)* | `services/partner_unlock.py` *(not built yet)* | Feature-flag for the 50% commission-override POST. Stays `false` until the exact Whop endpoint is confirmed. |
| `WHOP_CAMPAIGN_A_ID`, `WHOP_CAMPAIGN_B_ID` *(planned)* | `routes/whop.py` *(not built yet)* | Content Rewards experience IDs for the open-clip ($5) vs dedicated-channel ($10) campaigns. |

---

## 5. Whop plan IDs (live)

Public-facing tier names on liquidclips.app are **Free / Solo / Pro / Agency**.
Internally we still store the legacy values `solo / growth / autopilot`; the
alias map in `app/features.py::_LEGACY_TIER_ALIASES` translates `growth → pro`
and `autopilot → agency` for display. Renaming the stored values is a
schema-and-data migration, not done here.

In `routes/webhooks_whop.py:PLAN_TIER_BY_ID`:

| Plan ID | Public name | Whop label | Stored tier | Price |
|---|---|---|---|---|
| `plan_qe8AFXj9J3SWi` | Liquid Clips Solo | jnr Solo | `solo` | $29.99/mo |
| `plan_dhssNse4FfPlI` | Liquid Clips Pro | jnr Pro | `growth` *(→ pro)* | $99.99/mo |
| `plan_BvDBrtybhbxNg` | Liquid Clips Agency | jnr Agency | `autopilot` *(→ agency)* | $199.99/mo |
| `plan_OieNCPrvkw9U4` | Liquid Clips Founder Lifetime | Founder Lifetime | `autopilot` + `founder_flag` | $500 one-time |

Title-fallback (`PLAN_TIER_BY_TITLE`) handles three brand vocabularies in
parallel: **liquid clips X** (public/site), **jnr X** (current Whop dashboard
label), and **junior X** (legacy, kept for back-compat). Whop returns
`title=null` on the v2 API for most plans, so **match by plan_id first**.

When new plan IDs are minted under the Liquid Clips brand, add them to
`PLAN_TIER_BY_ID` — do NOT remove the legacy IDs above, existing memberships
still resolve through them.

---

## 6. The webhook event matrix

`/webhooks/whop` accepts these event types (synonyms grouped):

| Group | Event names accepted | Handler |
|---|---|---|
| Membership valid | `membership_went_valid`, `membership.went_valid`, `membership_activated`, `membership.activated` | `_handle_membership_valid` |
| Membership invalid | `membership_went_invalid`, `membership.went_invalid`, `membership_canceled`, `membership.canceled`, `membership_deactivated`, `membership.deactivated` | `_handle_membership_invalid` |
| Payment | `payment_succeeded`, `payment.succeeded` | `_handle_payment_succeeded` |
| Refund / dispute | `payment_refunded`, `payment.refunded`, `refund_created`, `refund.created`, `dispute_created`, `dispute.created` | `_handle_payment_refunded` |

Unrecognized events return 200 (Whop won't retry) but are logged as `status=ignored`.

**Idempotency:** every accepted event records a row in `webhook_events` keyed on `external_id`. A duplicate delivery returns `{status: duplicate}` without reprocessing. Body is NOT stored — only `body_hash` (sanitized log policy).

**Affiliate side-effects fire ONLY on the first trial→paid transition**, never renewals. Detection: capture `was_paid_before = user.subscription_status == "active"` BEFORE mutating, then guard the email branch with `not was_paid_before`.

---

## 7. Affiliate qualification — TODAY vs. Partner Engine spec

**Today** (in `routes/affiliate.py`):
- `QUALIFY_PAID_REFERRALS = 2` — at 2 paid referrals, the user sees the "50% unlocked" email and surface state.
- Commission rate is whatever Whop's **global** affiliate rate is. There is NO per-affiliate override POSTed by us.
- Paid-referral count is read **live** from Whop's `active_members_count` each request — there's no local counter.

**Partner Engine spec** (LIQUIDCLIPS-PARTNER-ENGINE.md):
- Threshold: 10 paid referrals **AND** verified dedicated TikTok account.
- Below threshold: company keeps 100% (Whop global rate stays low/off).
- At threshold: backend POSTs a per-affiliate **commission override** (`commission_value=50`, `applies_to_payments=all_payments`) so referrals from now on pay 50% recurring. First 10 stay at 100% automatically — they were paid before the override existed.
- Local transactional counter on `users.referred_paid_subs` (Whop's live count is unsafe to gate state changes on).

**See:** `LIQUIDCLIPS-PARTNER-ENGINE.md` §6 (state machine) + this repo's commit history.

---

## 8. Partner Engine — current build state

Steps map 1:1 to the spec's build checklist.

| # | Step | State |
|---|---|---|
| 1 | Verify attribution payload (does webhook include referring affiliate?) | **BLOCKED** — needs a `?a=` test checkout. Critical: blocks the whole gate logic. |
| 2 | Schema additions (`referred_paid_subs`, `tiktok_handle`, `tiktok_verification_code`, `tiktok_verified_at`, `partner_unlocked_at`, `whop_commission_override_id`) | **DONE** — `routes/webhooks_clerk.py` unchanged, see `main.py` lifespan + `models.py User`. Migration applies on next Railway deploy. |
| 3 | Eager affiliate creation at signup (`_handle_user_created` → `_fetch_whop_affiliate`) | not started |
| 4 | Increment `referred_paid_subs` on first paid transition; decrement on invalid/refund | not started |
| 5 | TikTok verification endpoints (`POST /me/tiktok/start`, `POST /me/tiktok/confirm`) | not started |
| 6 | Unlock service (`app/services/partner_unlock.py`) — flag-gated by `PARTNER_UNLOCK_LIVE` | not started |
| 7 | Campaign B gating in `/whop/bounties` (filter by `WHOP_CAMPAIGN_B_ID` if `partner_unlocked_at IS NULL`) | not started |
| 8 | Whop dashboard config — 4 new Plans + 2 Content Rewards campaigns + global rate low/off | not started (Daniel) |
| 9 | Flip `QUALIFY_PAID_REFERRALS` 2 → 10 (DO LAST) | not started |

---

## 9. The four open questions (spec §13)

These need answering before parts of the build can ship:

1. **Does `membership_went_valid` / `payment_succeeded` expose the referring affiliate in the payload?** If not, attribution flows through `users.affiliate_id` (the locked first-touch column), which is already populated by signup. Verify by running one test checkout with `?a=` and reading the raw webhook from the next Railway deploy logs.
2. **What is the exact Whop API endpoint for per-affiliate commission overrides?** Spec describes the body (`commission_type=percentage`, `commission_value=50`, `applies_to_payments=all_payments`) but not the path. Check `https://dev.whop.com/api-reference/affiliates`. Until confirmed, Step 6 ships gated behind `PARTNER_UNLOCK_LIVE=false`.
3. **Can Content Rewards restrict a campaign to whitelisted creators**, or is gating purely Requirement + manual submission rejection? Affects whether Step 7 can filter in the proxy or must rely on rejecting Campaign B submissions from unverified users.
4. **Does an override apply retroactively to a referrer's already-active subs**, or only to new payments after creation? Determines whether the "first 10 stay at 100%" guarantee holds at unlock instant or needs grandfathering logic.

---

## 10. Local dev gotchas

- **SQLite locally, Postgres in prod.** The `ALTER TABLE ... IF NOT EXISTS` block in `main.py` lifespan is **Postgres-only syntax**. Local SQLite errors silently on each ALTER and ignores them — `create_all` from `Base.metadata` handles new tables/columns on a fresh DB. If you add columns on an existing local DB, delete `junior-backend.db` to reset.
- **`WHOP_WEBHOOK_SECRET` unset = dev mode.** Signature check is skipped. Test webhooks with `curl -X POST http://localhost:8000/webhooks/whop -H "content-type: application/json" -d @sample.json`.
- **Affiliate emails dedupe via Notification rows.** `external_dedup_key=f"first-paid-referral-{referrer.id}"` etc. To re-test a notification + email, delete the dedup row from `notifications` first.
- **Bounty proxy ignores user OAuth.** Whop's `publicBounties` GraphQL rejects user OAuth tokens. Only the App API Key (`WHOP_API_KEY`) works — that's why the proxy exists. The desktop's `whop_client.py` routes through the backend, not direct to Whop.

---

## 11. Where to put new Whop code

| If you're adding... | Put it in... |
|---|---|
| A new webhook event handler | `routes/webhooks_whop.py` (extend the event-name tuples + add a `_handle_*` function) |
| A new affiliate-stats field on the dashboard | `routes/affiliate.py::build_affiliate_me_response` (extend `AffiliateBlock`) |
| A new bounty GraphQL field | `routes/whop.py::_LIST_BOUNTIES` / `_BOUNTY_DETAIL` + `_normalize_bounty` |
| Partner Engine unlock logic | `app/services/partner_unlock.py` (TBD — not yet created) |
| TikTok verification | `app/routes/tiktok_verify.py` (TBD — not yet created) |
| A new admin alert email | `mailer.py::send_admin_*` |

---

*Source spec: `LIQUIDCLIPS-PARTNER-ENGINE.md`. Last updated: 2026-06-08.*
