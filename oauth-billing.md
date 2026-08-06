# Junior — OAuth, Billing & Affiliate Attribution

**Status:** living reference, verified against actual code 2026-08-04.
**Owns:** how a user becomes a user, how their tier is decided, how affiliates get credit, how the desktop app authenticates to the backend.
**Cross-cuts:** `account-app/`, `liquidclips-marketing/`, `desktop-2/`, `junior-backend/` (Railway), Whop, Clerk.

> **History note:** this doc originally described the Sprint-4 design *before* any of it was built (Clerk-first identity, a 3-video/month free tier, no time-limited trial, tier names Solo/Channel/Autopilot). The system that actually shipped diverged from that plan in several ways as pricing and auth iterated. This revision replaces the aspirational content with what the code actually does today, verified line-by-line against `junior-backend/app/routes/webhooks_whop.py`, `desktop_auth.py`, `sync.py`, `trial_convert.py`, and `features.py`. Section numbers are preserved so existing `§N` code comments still point at the right place. For an exhaustive webhook-by-webhook trace (every handler, every side effect), see `08_receipts/whop-logic-flow-audit-2026-08-04.md` — this doc stays at the architectural level.

---

## 1 · Goals (the bar)

1. A visitor can sign up and use the app **without paying yet** (free tier, gated by a 100-clip lifetime export cap, not a monthly count and not a time limit).
2. An affiliate who refers a user gets credit **on the eventual upgrade**, weeks or months later — attribution survives device switches, reinstalls, browser quits.
3. Free-tier usage is enforced by the backend (`/usage/clip-exported`), not just client-side.
4. Upgrading is one Whop checkout. The user never sees the word "license key" unless something broke.
5. The desktop app reflects a tier change within one `/sync` poll (on launch + every 60s while running).
6. Reinstalls on the same or a new machine resume the same tier via sign-in — no support ticket.
7. Founder seats (one-time, seat-capped) are honoured forever, including across reinstalls.

---

## 2 · Roles — who owns what

```
┌─────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│  IDENTITY            │    │    WHOP              │    │  JUNIOR BACKEND      │
│  (desktop OTP        │    │    (billing)         │    │  (reconciliation)    │
│   or Clerk on web)   │    │                      │    │                      │
│                      │    │  - checkout pages    │    │  - users table       │
│  - desktop: email    │    │  - subscriptions     │    │  - tier resolution   │
│    OTP, no SDK       │    │  - affiliate program │    │  - license JWT       │
│    (desktop_auth.py) │    │  - webhooks on       │    │    issuance          │
│  - web: Clerk        │    │    purchase /        │    │  - usage quotas      │
│    (email/Google,    │    │    refund / cancel   │    │    (100-clip cap)    │
│    account-app)      │    │                      │    │  - desktop /sync     │
└─────────────────────┘    └──────────────────────┘    └──────────────────────┘
        ↑                            ↑                            ↑
        │                            │                            │
        └────────── user ────────────┴───────── desktop ──────────┘
```

**Identity** (desktop OTP or Clerk) proves *who someone is*. **Whop** is the source of truth for *billing state*. **Junior Backend** is the reconciler — joins identity to Whop subscriptions, resolves tier, signs license JWTs, enforces quotas.

The desktop app talks only to Junior Backend. It never calls Clerk or Whop APIs directly — checkout and Whop OAuth both hand off to the OS browser.

---

## 3 · The flows

### 3.1 First-time visitor → free tier user

```
1. Desktop: user enters email → POST /desktop/auth/start → 6-digit code emailed
   (desktop_auth.py — no Clerk dependency, no client SDK).
   Web: user signs in via Clerk on account-app (email or Google).
2. On success, backend creates/finds a users row:
     users(clerk_id, email, tier='free', subscription_status='trial',
           trial_started_at=now())
3. Backend signs an Ed25519 license JWT (30-day expiry) scoped to the free tier.
4. Desktop stores it via authStorage.setJwt + OS keychain mirror.
```

`subscription_status='trial'` at this point means "organic signup, no card, no real deadline" — **not** a ticking clock. See §7's note on trial semantics; this is the exact distinction the 2026-08-04 billing fix restored after it had drifted.

### 3.2 Affiliate-attributed signup

```
1. Referral link carries an affiliate id (?a=... or a jnr_ref cookie on
   the marketing site).
2. At signup, the affiliate id is written to users.affiliate_id — LOCKED.
3. After that, no flow can change users.affiliate_id (see §6).
4. Free-tier user is created as in 3.1. No money has moved yet.
```

### 3.3 Upgrade free → paid (Agency)

```
1. User clicks an upgrade CTA — either "Upgrade to Agency on Whop" in
   Settings (desktop) or /upgrade on account-app.
2. This opens account.liquidclips.app/upgrade in the app's in-app
   browser overlay (2026-08-05 product decision — checkout stays inside
   the app for every user, matching the "Connect Whop" identity-link
   flow below; see `desktop-2/src-tauri/src/browse.rs`'s
   `BLOCKED_PATH_FRAGMENTS`, intentionally emptied).
3. account-app embeds Whop's hosted checkout (WhopCheckoutEmbed).
4. User completes checkout. Whop charges the card (or starts a trial
   with a card on file), creates/updates a Whop membership.
5. Whop fires `membership.went_valid` → POST /webhooks/whop:
     - Looks up the user (by email/whop identity).
     - apply_membership_tier() sets tier, subscription_status='trialing'
       (or 'active' if founder / already paid), whop_user_id.
     - Mints an LC-ID + sends a welcome email.
6. If a card charge actually clears, `payment.succeeded` fires next and
   PROMOTES subscription_status to 'active' — this is the real
   trial→paid conversion, and the moment the 100-clip cap lifts.
7. Backend issues a new license JWT; desktop picks it up on its next
   /sync poll (launch + every 60s).
```

**Two separate Whop touchpoints, easy to conflate:** the "Connect Whop" pill (top bar, `WhopStatusChip.tsx`) only *links identity* (`/auth/whop/start` OAuth, sets `whop_user_id`) — no money moves. The "Upgrade to Agency" CTA above is the actual purchase. A user can link Whop identity without ever paying, and can pay without having explicitly "connected" first (the webhook sets `whop_user_id` itself).

### 3.4 Desktop activation on a new machine

```
1. User installs the app, opens it, signs in (3.1's OTP flow, or the
   Whop/Clerk deep-link handoff — liquidclips://activate?token=...).
2. Backend mints a fresh license JWT for the user's current tier.
3. Desktop verifies the JWT locally against the bundled Ed25519 public
   key — no network call required for an offline tier check.
```

### 3.5 Refund / chargeback / churn

```
1. Whop fires `membership.went_invalid` → subscription_status='expired'.
2. `membership.canceled` sets subscription_status='canceled' but does
   NOT immediately revoke access — the user keeps their tier until
   paid_until (the end of the period they already paid for).
3. `payment.failed` sets 'past_due' — tier is retained while Whop
   retries the charge; only a later `went_invalid` actually downgrades.
4. Desktop /sync reflects whichever state is current on its next poll.
```

### 3.6 Founder (one-time, seat-capped)

```
1. Same checkout flow as 3.3, but the plan id matches FOUNDER_PLAN_IDS.
2. try_grant_founder_seat() enforces the seat cap — refuses the grant
   (and does not apply the tier) once the cap is hit, independent of
   whatever cap Whop-side metadata claims.
3. On a successful grant: founder_flag=true, subscription_status='active'
   always, paid_until=null (no expiry, no renewal logic).
4. License JWT carries founder: true.
```

---

## 4 · Data model (current — see `junior-backend/app/models.py` for the full row)

```sql
users (
  id                    text primary key,
  clerk_id              text unique not null,
  email                 text not null,
  whop_user_id          text unique,              -- null until Whop-linked
  whop_authorized_at    timestamptz,               -- $1 pre-auth stamp, NOT a tier grant
  tier                  text not null default 'free',  -- free|solo|pro|agency_solo|agency|agency_whitelabel
  founder_flag          bool not null default false,
  affiliate_id          text,                      -- locked at signup, never overwritten (§6)
  subscription_status   text not null default 'trial',
    -- trial | trialing | active | past_due | canceled | expired | refunded
  trial_started_at      timestamptz not null default now(),
  trial_convert_approved_at timestamptz,            -- one-click early-convert click marker
  paid_until             timestamptz,
  starter_exports_used   integer not null default 0,   -- the real free-tier gate (100 lifetime)
  clips_created           integer not null default 0,
  ip_address              text,                        -- for the IP-pooled free-export ceiling
  extra_accounts_purchased integer not null default 0,
  created_at / updated_at timestamptz
  -- + affiliate, agency, chat, onboarding, thumbnail-batch, and identity-ladder
  --   columns added since — see models.py for the authoritative current list.
);

licenses (
  id, user_id, jwt, tier_at_issue, issued_at, expires_at, revoked
);

usage (
  user_id, period_start, videos_processed
  -- legacy monthly counter, retired 2026-05-25; kept for analytics only,
  -- never blocks. The real free-tier gate is users.starter_exports_used.
);
```

### Whop (billing — read-only from our side)

We do NOT mirror Whop's full subscription record. Whop is the source of truth via webhooks; we cache only `whop_user_id`, `paid_until`, `subscription_status`.

---

## 5 · Endpoints, webhooks, events

### Clerk → Backend webhooks

| Event | Action |
|---|---|
| `user.created` | Insert into `users`. Lock `affiliate_id` from metadata. `tier='free'`, `subscription_status='trial'`. |
| `user.updated` | Sync email if changed. **Never overwrite `affiliate_id`.** |
| `user.deleted` | Mark `subscription_status='canceled'`, revoke licenses. |

### Whop → Backend webhooks (`webhooks_whop.py`, HMAC-verified via Standard Webhooks / svix, idempotent on `WebhookEvent.external_id`)

| Event | Handler | Action |
|---|---|---|
| `membership.went_valid` | `_handle_membership_valid` | Grants tier via `apply_membership_tier` → `trialing` (or `active` if founder/already-paid). Mints LC-ID + welcome email. Parks the entitlement (`PendingWhopMembership`) if no matching user exists yet. |
| `payment.succeeded` | `_handle_payment_succeeded` | **The real trial→paid promotion** — sets `active`, bumps `paid_until`. Also handles Boost Pack top-ups and the $1 pre-auth plan as separate short-circuits before touching tier. |
| `membership.canceled` | `_handle_membership_canceled` | `canceled`. Access continues until `paid_until` — no immediate revoke. |
| `membership.cancel_setting_changed` | `_handle_membership_cancel_setting_changed` | Applies Whop's toggle-based cancel event in either direction. |
| `payment.failed` | `_handle_payment_failed` | `past_due`. Tier retained during Whop's retry window. |
| `membership.went_invalid` | `_handle_membership_invalid` | The real downgrade — `expired`. |
| `payment.refunded` | `_handle_payment_refunded` | Refund handling + affiliate commission set-off. |

Dead-letter table (`WebhookDeadLetter`) records handler failures for replay; a reconciliation cron (`reconcile_whop_memberships`) compares drift against Whop's own state.

### Backend HTTP endpoints (selected)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/webhooks/clerk` | svix signature | Clerk events |
| `POST` | `/webhooks/whop` | Whop HMAC | Whop events |
| `POST` | `/desktop/auth/start`, `/desktop/auth/verify` | none / rate-limited | Email-OTP sign-in, no Clerk dependency |
| `POST` | `/desktop/connect` | Clerk session | Exchange Clerk session for license JWT |
| `GET` | `/sync` | License JWT | Current tier, features, trial state, announcements |
| `POST` | `/usage/clip-exported` | License JWT | The real free-tier gate — 402 past 100 lifetime exports |
| `POST` | `/me/trial/approve` | License JWT | One-click early-convert (real `trialing` users only) |
| `POST` | `/me/trial/cancel` | License JWT | Real cancel, calls Whop `end_membership` |
| `GET` | `/auth/whop/start` | challenge | Whop identity-link OAuth start (§3.3's "Connect Whop") |

### License JWT claims (Ed25519, 30-day expiry, auto-rotated by `/sync` inside 5 days of expiry)

```json
{
  "sub": "<user.id>",
  "tier": "agency",
  "founder": false,
  "features": { "...": "flat feature-flag dict from features.py" },
  "iat": 1737462000,
  "exp": 1740054000,
  "iss": "junior-backend",
  "platform_role": "none",
  "capability_schema_version": 1
}
```

The desktop verifies the signature locally on every launch using the bundled public key — no network call required for an offline tier check.

---

## 6 · The affiliate attribution rule (the one that's easy to get wrong)

**Affiliate ID is captured at signup and frozen forever.** This is non-negotiable and unchanged from the original design.

- The referral id is written to `users.affiliate_id` once, at signup.
- After that, **no flow can change `users.affiliate_id`** — grep `webhooks_clerk.py` for the exact comment: *"NEVER touch user.affiliate_id — first-touch locked."*
- Every future upgrade, renewal, and tier change that user makes credits the same affiliate. First-touch, not last-touch.

Edge case: user signs up without affiliate, later clicks an affiliate link — `affiliate_id` stays null forever, no credit. Edge case: user signs up via affiliate A, later sees affiliate B — A still owns the account.

---

## 7 · Decisions — current state (updated 2026-08-04, supersedes the original Sprint-4 list)

- **Trial has two distinct meanings — do not conflate them.** `subscription_status='trial'` (organic signup, no card, gated only by the 100-export cap, never time-limited) vs `subscription_status='trialing'` (a real Whop membership with a card on file and a genuine 7-day countdown to first charge). Treating them the same was a real, shipped bug — see the 2026-08-04 fix and `08_receipts/trial-status-misclassification-2026-08-04/`.
- **Identity is not Clerk-only.** Desktop sign-in is a homegrown email-OTP flow (`desktop_auth.py`) specifically because Clerk's origin/publishable-key config had too many failure modes for a packaged native app. Clerk remains the identity provider for the web dashboard (account-app).
- **Pricing is a single paid plan, not a ladder.** As of the 2026-07-06 pivot, Agency ($99.99/mo) is the one customer-facing paid plan; legacy Solo/Pro/Growth tier names persist in the backend matrix for backward compatibility with existing rows and are not offered to new customers.
- **Founder is one-time, locks a tier forever.** No subscription, no renewal logic, `paid_until=null` + `founder_flag=true`.
- **Whop affiliates is the affiliate engine.** No homegrown payout system — `users.affiliate_id` mirrors Whop's, payouts run through Whop's infrastructure.
- **Affiliate attribution is first-touch locked, not last-touch** (§6).
- **Commerce URLs now stay in the app's in-app browser overlay** (flipped 2026-08-05 — see §3.3). The Rust-side filter that used to force checkout/Whop URLs to the system browser (for Mac App Store guideline 3.1.1) is intentionally emptied, not deleted, since this app ships via direct download + notarization today, not the App Store — re-populate it before any future App Store submission. Google-consent URLs are a separate, unaffected mechanism.

---

## 8 · Implementation order (historical — Sprint 4 + 4.5, completed)

Retained for history; all nine steps shipped. See git history / `lcos/` reports for the actual build sequence, which diverged from this plan in scope and ordering as pricing iterated multiple times after initial launch.

---

## 9 · Out of scope for this doc (defer)

- Team accounts / shared workspaces.
- Self-serve refunds (Whop handles via support).
- 2FA on desktop-OTP accounts (Clerk has it for the web dashboard; not applicable to the OTP path).
- Whop checkout customisation beyond the affiliate param — Whop's hosted page is the interface.
- Anti-fraud rules on affiliate self-referrals — Whop's own affiliate system handles this.

---

**Sign-off:** this revision reflects the code as of 2026-08-04. If a flow described here stops matching reality, fix this doc in the same change that changes the behaviour — the original drift (this doc describing a design that was never built as specified) is very likely what let the trial/trialing bug ship unnoticed.
