# Affiliate Starter Pass Ledger — Implementation Scope (DO NOT BUILD YET)

Last updated: 2026-05-24

## Status

**SCOPE ONLY.** Do not write code for this until BOTH are true:
1. Railway/backend production env is stable (Postgres, not local SQLite).
2. Daniel explicitly approves the build.

This is Phase 3 of `CLAUDE_MASTER_GROWTH_FLYWHEEL_IMPLEMENTATION.md` and the
backend half of `CLAUDE_AFFILIATE_STARTER_PASS_COPY_SCOPE.md`. Phase 1 (event
names + copy) is already shipped; the events `starter_pass_started` and
`starter_pass_exhausted` are reserved names in `app/analytics.py` waiting for
this ledger to emit them.

## Why it waits

- Credits are money-adjacent. A bug double-grants or fails to expire = real cost
  or a broken promise to affiliates. We don't run that on local SQLite.
- `requires_card` depends on a live Stripe customer at signup — not wired until
  prod billing is stable.
- `device_install_id` needs a stable desktop install identifier (see Open
  Questions) that doesn't exist yet.

## Data Models

Follow existing `app/models.py` conventions: `Mapped[...]` columns, `String`
uuid4().hex PKs, `utcnow` defaults, sync SQLAlchemy 2.x, FKs to `users.id`.

### `affiliate_offer`
The offer template an approved affiliate can hand out. One per affiliate per
offer_type for v1.

| column | type | notes |
|---|---|---|
| id | str PK | uuid4().hex |
| affiliate_id | str, indexed | Whop affiliate record id (NOT a username) |
| offer_type | str | const `"bounty_clip_starter"` for v1 |
| clip_credit_limit | int | default from `AFFILIATE_STARTER_CLIP_CREDITS=100` |
| expires_days | int | default from `AFFILIATE_STARTER_DAYS=30` |
| requires_card | bool | default True |
| new_users_only | bool | default True |
| status | str, indexed | `pending` \| `approved` \| `paused` |
| created_at | datetime | utcnow |

Rule: a grant can only be created against an `approved` offer.

### `user_credit_grant`
One redeemed pass for one user. The burn ledger.

| column | type | notes |
|---|---|---|
| id | str PK | uuid4().hex |
| user_id | str FK→users.id, indexed | |
| affiliate_id | str, indexed | copied from offer at redeem (first-touch lock) |
| offer_id | str FK→affiliate_offer.id | |
| grant_type | str | const `"affiliate_bounty_clip_starter"` |
| credits_total | int | snapshot of offer.clip_credit_limit at redeem |
| credits_used | int | default 0 |
| expires_at | datetime | redeem time + offer.expires_days |
| stripe_customer_id | str \| null | for one-pass-per-customer enforcement |
| clerk_user_id | str | denormalized for funnel joins |
| device_install_id | str \| null | for one-pass-per-device enforcement |
| status | str, indexed | `active` \| `exhausted` \| `expired` |
| created_at | datetime | utcnow |

Uniqueness (enforce in code + DB where practical):
- one `active` grant per `user_id`
- one `active` grant per `stripe_customer_id`
- one `active` grant per `device_install_id` (best-effort)

Keep this table SEPARATE from affiliate commission payouts and from PostHog —
do not blend credits, commissions, and analytics in one table (master doc rule).

## API Endpoints

### `POST /affiliate-offers/redeem`
Auth: `current_user` (license JWT). Body: `{ offer_id | affiliate_id, device_install_id? }`.
Flow:
1. Resolve offer; 404 if not `approved`.
2. Guard `new_users_only` (user created within window / no prior paid invoice).
3. Guard `requires_card` (Stripe customer + payment method present).
4. Guard one-active-grant per user / customer / device.
5. Create `user_credit_grant`, snapshot credits/expiry.
6. Emit PostHog `starter_pass_started` { affiliate_id, offer_id, grant_id,
   credits_total, expires_days, card_on_file, byok_required }.
Returns the grant summary.

### `POST /usage/clip-exported`
Auth: `current_user`. Body: `{ project_slug, whop_bounty_id, export_count }`.
This is the burn hook, called by the desktop when a bounty clip export succeeds.
Rules (master doc):
- Burn exactly one credit **per successful bounty clip export**.
- Only burn for projects with a `whop_bounty_id` (skip non-bounty clips).
- If no credits remain → do NOT block; continue under the user's paid tier.
- If no paid tier/card → return an upgrade/checkout signal.
- Trial credits must NOT unlock hosted Growth features (transcribe/LLM stay
  gated by real tier, never by a starter grant).
- When credits hit 0 OR `expires_at` passes → set grant `exhausted`/`expired`
  and emit `starter_pass_exhausted` { ..., credits_used, days_since_start,
  reason }.
Pairs with the desktop's existing `bounty_clip_exported` event (Phase 1) — that
event currently no-ops to a sink; in Phase 3 it also POSTs here.

### `GET /me` (extend, don't replace)
Add credit fields to the existing `MeResponse` (app/routes/me.py):
`starter_credits_total`, `starter_credits_used`, `starter_credits_remaining`,
`starter_expires_at`, `starter_status`. Null when the user has no active grant.
The desktop renders "N bounty clips left" from these.

## Integration points (where this touches existing code)

- `app/models.py` — add the two tables.
- `app/routes/` — new `affiliate_offers.py` + extend `usage.py` (already has
  `/usage/video-started`) + extend `me.py`.
- `app/features.py` — credits are orthogonal to tier; do NOT add credits to the
  tier matrix. A grant never flips `byo_openai_key_required` or hosted flags.
- `app/analytics.py` — emit `starter_pass_started` / `starter_pass_exhausted`
  (names already reserved).
- Desktop `src/lib/analytics.ts` + `App.tsx` — `bounty_clip_exported` gains a
  real sink: POST `/usage/clip-exported`; `/me` credit fields drive a
  "credits remaining" pill. `first_bounty_workspace_created` may also POST.
- Marketing/account copy — already shipped (Phase 1); flip "approved invite
  links can unlock" → live offer language once this is real.

## Anti-abuse (from copy scope doc)
Card required before credits activate · new users only · one active grant per
user / Stripe customer / device · record affiliate_id at signup (never mutable) ·
delay affiliate commission until first paid invoice · rate-limit redeem per
affiliate · admin can pause an affiliate's offer · flag affiliates whose
redeemers never activate/export.

## Open Questions (resolve before building)
1. **device_install_id**: the desktop has no stable install id today. Add one
   (e.g. a random uuid persisted to the OS keychain on first run) — small
   desktop change, needed for per-device enforcement.
2. **Stripe customer at redeem**: does redeem happen pre- or post-checkout?
   `requires_card` implies a Stripe customer must exist first — confirm the
   account-app flow creates it before redeem.
3. **new_users_only window**: define precisely (account age? no prior paid
   invoice? both?).
4. **Offer admin surface**: how does an affiliate's offer get `approved` —
   manual admin toggle, or auto on partner approval?
5. **Credit vs quota interaction**: Free tier already has a 3-video/mo quota
   (`/usage/video-started`). Confirm starter credits are a separate counter and
   don't double-count against the Free quota.

## Acceptance (when eventually built)
- A confirmed affiliate can generate/view a tracked starter link.
- A new user redeems exactly one starter pass.
- `/me` returns remaining credits.
- Exporting a bounty clip decrements one credit; non-bounty clips don't.
- Exhausted/expired users fall back to Solo cleanly (not blocked).
- Affiliate commission only starts after the referred user's first paid invoice.
- starter_pass_started / starter_pass_exhausted appear in PostHog with IDs only.
