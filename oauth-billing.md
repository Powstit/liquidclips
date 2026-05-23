# Junior — OAuth, Billing & Affiliate Attribution

**Status:** scope doc, not implementation. Locks the design before we touch Clerk / Railway code.
**Owns:** how a user becomes a user, how their tier is decided, how affiliates get credit, how the desktop app authenticates to the backend.
**Cross-cuts:** `partner-app/`, `jnremployee.com` marketing site, desktop app, Junior Backend (Railway), Whop, Clerk.

---

## 1 · Goals (the bar)

If any of these are missing on launch day, the moat / unit economics break:

1. A visitor from a Greg-style affiliate link can sign up, download the desktop app, run a clip — **without paying yet** (Free tier).
2. The affiliate gets credit **on the eventual upgrade** weeks/months later, not just at signup. Attribution survives device switches, browser quits, app re-installs.
3. Users on Free tier are limited to 3 videos/month — enforced by the backend, not just client-side.
4. Upgrading to Solo / Channel / Autopilot is one Whop checkout. The user never sees the word "license key" unless they want to.
5. The desktop app activates against the right tier within 60 seconds of paying, **without the user copy-pasting a JWT.**
6. Re-installs on the same machine or a new machine resume the same tier — no support ticket.
7. Founder seats (£500 one-time, 2,000 cap) are honoured forever, including across re-installs.

---

## 2 · Roles — who owns what

```
┌─────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│    CLERK            │    │    WHOP              │    │  JUNIOR BACKEND      │
│    (web identity)   │    │    (billing)         │    │  (reconciliation)    │
│                     │    │                      │    │                      │
│  - email / Google   │    │  - checkout pages    │    │  - users table       │
│    sign-in          │    │  - subscriptions     │    │  - tier resolution   │
│  - user metadata    │    │  - affiliate program │    │  - license JWT       │
│    (affiliate_id,   │    │  - webhooks on       │    │    issuance          │
│     whop_id,        │    │    purchase /        │    │  - usage quotas      │
│     trial_started)  │    │    refund / cancel   │    │    (3 vids / mo)     │
│  - session JWTs     │    │                      │    │  - desktop /sync     │
│    for the web app  │    │                      │    │    endpoint          │
└─────────────────────┘    └──────────────────────┘    └──────────────────────┘
        ↑                            ↑                            ↑
        │                            │                            │
        └────────── user ────────────┴───────── desktop ──────────┘
```

**Clerk** is the source of truth for *web identity* (email, name, photo, OAuth tokens to Google).
**Whop** is the source of truth for *billing state* (which plan, paid until when, refunds).
**Junior Backend** is the *reconciler* — joins Clerk users to Whop subscriptions, resolves tier, signs license JWTs, enforces quotas.

The desktop app talks only to Junior Backend. It never calls Clerk or Whop directly.

---

## 3 · The flows

### 3.1 First-time visitor → Free tier user

```
1. Visitor lands on jnremployee.com (no affiliate ref).
2. Clicks "Download Junior".
3. CTA goes to /signup, a Clerk-hosted page (Google sign-in or email magic link).
4. On successful sign-in, Clerk fires the `user.created` webhook to Junior Backend.
5. Junior Backend creates a row:
     users(clerk_id, email, tier='free', trial_started_at=now(), affiliate_id=null)
6. Backend signs a 30-day license JWT scoped to Free tier and stores it
   against the user.
7. Frontend redirects to /thank-you with two CTAs:
     a) Download Junior (Mac / Windows)
     b) Magic-link sign-in inside the app (deep link to junior://activate?token=...)
8. User downloads the binary, opens it. The deep link auto-activates with
   the user's license JWT. No copy-paste.
```

Result: a Free-tier user exists in Clerk + Backend; the desktop binary is activated.

### 3.2 Affiliate-attributed signup

```
1. Greg posts referral link: jnremployee.com/?a=aff_LsYMO2SsMbIHTc
2. Visitor lands. /api/ref-capture (already on the marketing site —
   ~/Desktop/jnr/partner-app/page.tsx line 22-27 references this) sets:
     Cookie: jnr_ref=aff_LsYMO2SsMbIHTc  (90-day TTL, SameSite=Lax)
3. Visitor browses. Cookie persists.
4. Visitor signs up via Clerk on /signup.
5. The /signup page reads the cookie client-side and passes
   `unsafeMetadata: { affiliate_id: 'aff_LsYMO2SsMbIHTc' }` to Clerk on sign-up.
6. Clerk's user.created webhook fires to Junior Backend with that metadata.
7. Backend writes users.affiliate_id = aff_LsYMO2SsMbIHTc — LOCKED.
   This is the attribution. It survives forever for this user, even if
   the cookie expires or the user clears their browser.
8. Free-tier user is created as in 3.1. No money has moved yet.
```

When this user eventually upgrades, see 3.3 — the affiliate gets credit because the Whop checkout includes the same `?a=` param.

### 3.3 Upgrade Free → paid (Solo / Channel / Autopilot)

```
1. Inside the desktop app (or on account.jnremployee.com) the user clicks
   "Upgrade to Channel".
2. Desktop opens a browser to:
     https://whop.com/jnremployee/<plan_route>?a=<affiliate_id>
   where <affiliate_id> is pulled from the user's record on the backend
   (NOT from the cookie — the cookie may be gone by now).
   Result: the Whop checkout is pre-loaded with the affiliate attribution
   that was locked at signup.
3. User completes Whop checkout. Whop charges card, creates a Whop user
   keyed by their email.
4. Whop fires `membership_went_valid` webhook → Junior Backend:
     POST /webhooks/whop
     { user: { email }, plan: { tier: 'channel' }, affiliate: { id: 'aff_…' } }
5. Backend looks up the Clerk user by email, updates:
     users.tier = 'channel'
     users.whop_user_id = whop_user_xxx
     users.subscription_status = 'active'
     users.paid_until = now() + 30d  (driven by Whop's renewal events)
6. Backend issues a NEW license JWT (channel tier, 30-day expiry,
   refreshable while active) and stores it.
7. Backend pushes the new JWT to the desktop app via the /sync endpoint
   (next time the desktop polls, which is at app launch + every 60s
   while running).
8. Desktop sees the tier change; the Free-tier quota lifts; the user can
   process unlimited videos and connect platforms.
```

The 60-second SLA in goal #5 holds because step 7 is poll-based — at worst the user clicks "Refresh" inside the app to force-sync.

### 3.4 Desktop activation on a brand-new machine

```
1. User installs Junior on a new Mac.
2. First-run screen: "Sign in to Junior" → opens browser →
   account.jnremployee.com/connect-desktop?challenge=<random>
3. User is already signed into Clerk in this browser. The /connect-desktop
   page POSTs to Junior Backend:
     POST /desktop/connect
     { clerk_session, challenge }
4. Backend mints a fresh license JWT for this user's current tier and
   returns it.
5. Browser deep-links back: junior://activate?token=<jwt>&challenge=<...>
6. Desktop verifies the challenge matches what it sent, stores the JWT
   in the OS keychain.
```

The `challenge` prevents a malicious page from injecting a JWT for an unrelated account.

### 3.5 Refund / chargeback / churn

```
1. Whop fires `membership_went_invalid` webhook → Backend.
2. Backend sets users.subscription_status = 'expired' (or 'refunded').
3. Backend issues a fresh JWT scoped to Free tier (3-vid/mo cap returns).
4. Desktop /sync picks it up, soft-downgrades on next launch / next poll.
5. Per spec §2.4 point 4: after 37 days offline without sync, the desktop
   auto-soft-downgrades to Free regardless — to handle the case where the
   user's payment lapsed while they were offline.
```

### 3.6 Founder Lifetime (£500 one-time, 2,000 seats)

```
1. Same checkout flow as 3.3, plan_route = /founder.
2. Whop webhook fires with founder plan.
3. Backend sets:
     users.tier = 'channel'        (Channel tier locked forever)
     users.founder_flag = true
     users.paid_until = null       (no expiry)
4. License JWT issued with `founder: true` claim and a 365-day expiry
   that auto-renews via /sync as long as users.founder_flag is true.
5. Refund window for Founder: 30 days (per /refunds page).
   After 30 days, founder_flag is irrevocable except for fraud.
```

---

## 4 · Data model

### Clerk (web identity)

User record fields we use:
- `id` (Clerk user ID, e.g. `user_2…`)
- `primary_email_address`
- `image_url`
- `unsafe_metadata.affiliate_id` — set at signup from the cookie, **never overwritten**
- `unsafe_metadata.first_landing_page` — for analytics
- `public_metadata.tier` — mirrored from Backend after each Whop event for client-side UI gating only (Backend is still source of truth)

### Junior Backend Postgres (Railway)

```sql
users (
  id            uuid primary key default gen_random_uuid(),
  clerk_id      text unique not null,
  email         text not null,
  whop_user_id  text unique,
  tier          text not null default 'free',   -- free | solo | channel | autopilot
  founder_flag  bool not null default false,
  affiliate_id  text,                            -- locked from Clerk metadata at first webhook
  subscription_status text not null default 'trial',  -- trial | active | expired | refunded | canceled
  trial_started_at    timestamptz not null default now(),
  paid_until          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

licenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) on delete cascade,
  jwt           text not null,           -- full signed token
  tier_at_issue text not null,
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked       bool not null default false
);

usage (
  user_id       uuid references users(id) on delete cascade,
  period_start  date not null,           -- monthly bucket (first of month)
  videos_processed int not null default 0,
  primary key (user_id, period_start)
);

-- existing tables: schedules, affiliates_mirror, memory — see spec §1.7
```

### Whop (billing — read-only from our side)

We do NOT mirror Whop's full subscription record. We treat Whop as the source of truth via webhooks; we cache only what we need (`whop_user_id`, `paid_until`, `subscription_status`).

---

## 5 · Endpoints, webhooks, events

### Clerk → Backend webhooks

| Event | Action |
|---|---|
| `user.created` | Insert into `users`. Lock `affiliate_id` from `unsafe_metadata`. Set tier='free', trial_started_at=now(). |
| `user.updated` | Sync email if changed. **Never overwrite affiliate_id.** |
| `user.deleted` | Mark `subscription_status='canceled'`, revoke all licenses. |

### Whop → Backend webhooks (HMAC-SHA256 verified, idempotency key stored)

| Event | Action |
|---|---|
| `membership_went_valid` | Look up user by email. Set tier, whop_user_id, paid_until, subscription_status='active'. Issue new license JWT. |
| `membership_went_invalid` | Set subscription_status='expired'. Issue Free-tier JWT. |
| `membership_canceled` | Same as `_invalid` for now (Whop sends both on cancel-at-period-end). |
| `payment_succeeded` | Update paid_until to renewal date. Re-sign JWT if expiring soon. |
| `payment_failed` | No state change yet (Whop retries). On final failure Whop fires `_invalid`. |
| `affiliate_payout_created` | (Sprint 7) Update affiliate dashboard cache. |
| `dispute_opened` | Flag user for support. Don't auto-revoke. |

### Backend HTTP endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/webhooks/clerk` | Clerk svix signature | Clerk events |
| `POST` | `/webhooks/whop` | Whop HMAC | Whop events |
| `POST` | `/desktop/connect` | Clerk session token | Exchange Clerk session for license JWT (flow 3.4) |
| `POST` | `/desktop/heartbeat` | License JWT | Bump last-seen; rotate JWT if near expiry |
| `GET` | `/sync` | License JWT | Returns current tier, paid_until, schedule status, recent published posts |
| `POST` | `/usage/video-started` | License JWT | Increment usage; refuse if quota exceeded |
| `POST` | `/proxy/llm` | License JWT (Pro/Autopilot only) | Forward to Anthropic with embedded key |
| `GET` | `/affiliate/dashboard` | Whop OAuth | Existing partner-app endpoint — unchanged |

### License JWT claims (Ed25519, 30-day expiry)

```json
{
  "sub": "<user.id>",
  "tier": "channel",
  "founder": false,
  "quota_videos_per_month": null,   // null = unlimited; 3 for free
  "iat": 1737462000,
  "exp": 1740054000,
  "iss": "junior-backend"
}
```

The desktop verifies the signature locally on every launch using the bundled public key. No network call required for offline tier-check.

---

## 6 · The affiliate attribution rule (the one that's easy to get wrong)

**Affiliate ID is captured at signup and frozen forever.** This is non-negotiable.

- Cookie sets `jnr_ref=<id>` on landing → 90-day TTL.
- At signup, the cookie's `<id>` is written to Clerk user metadata.
- Clerk webhook copies it to `users.affiliate_id` once.
- After that, **no flow can change `users.affiliate_id`**.
- When the user upgrades, the Whop checkout URL gets `?a=<users.affiliate_id>` server-side — even if the user's cookie is long gone.

This means: an affiliate who refers a user gets credit on every future upgrade, renewal, and tier change that user makes. Forever. That's the moat for the affiliate program — competitors run last-touch, we run first-touch-locked.

Edge case: user signs up without affiliate, later clicks an affiliate link. Their `affiliate_id` stays NULL forever. The affiliate doesn't get credit. This is the right behaviour — the user wasn't *brought in* by the affiliate.

Edge case: user signs up via affiliate A, then sees affiliate B later. A still owns the account. B doesn't get credit.

---

## 7 · Decisions explicitly made here (so we don't re-debate)

- **Clerk is in.** Reversal of earlier "skip Clerk" call — Free-tier users need a web identity before they pay, and that's what Clerk's free tier is built for.
- **No homegrown auth.** We don't roll our own sign-in pages.
- **One Postgres DB.** Clerk + Whop are external; the only DB we own is Junior Backend's. Users table joins them via `clerk_id` (PK) and `whop_user_id` (FK after upgrade).
- **License JWTs are not pasted by users.** The deep-link `junior://activate?token=...` activation in flows 3.1 and 3.4 covers normal cases. Manual paste exists as a fallback (Settings → "Paste license") but the spec voice is: users don't see the word "license key" unless something broke.
- **Whop affiliates is the affiliate engine.** We don't build our own. The `users.affiliate_id` we hold is just a mirror of Whop's affiliate ID, so payouts run through Whop's existing 50% lifetime infrastructure.
- **Affiliate attribution is first-touch locked, not last-touch.** Section 6.
- **Trial = Free tier, not time-limited.** Free is "3 videos/month forever, BYO keys." There's no 14-day trial that expires. Users churn from "tried it, didn't upgrade" → still have an account, still capped at 3/month, can come back any time.
- **Founder is one-time, locks Channel tier forever.** No subscription. No renewal logic. `paid_until = null` + `founder_flag = true`.

---

## 8 · Implementation order (Sprint 4 + 4.5)

When code time arrives, build in this sequence — each step is independently testable:

1. **Backend skeleton on Railway** — FastAPI, Postgres, env vars, healthcheck. No auth yet.
2. **Clerk app + Clerk webhook handler** — `user.created` → row in users. Verify signed with svix. Test with a real signup on a staging Clerk env.
3. **License JWT signer** — Ed25519 keypair generation, JWT creation, public-key export to desktop bundle. Backend issues JWTs on user.created.
4. **Desktop activation deep link** — `junior://activate?token=...` handler in Tauri. Stores JWT in keychain.
5. **`/sync` endpoint** — returns tier from JWT. Desktop polls on launch + every 60s.
6. **Whop webhook handler** — `membership_went_valid` updates tier. Idempotency. HMAC verification.
7. **Affiliate ID propagation** — cookie → signup → metadata → user row → outbound Whop checkout URL builder.
8. **Quota enforcement** — `/usage/video-started` increments + refuses on Free over 3/month.
9. **Free-tier UX in desktop** — when /usage refuses, show "Upgrade to Channel for unlimited" with a button that opens the Whop URL with the user's locked affiliate ID baked in.

Steps 1-5 land Sprint 4. Steps 6-9 land Sprint 4.5 (basically Sprint 4 went 7 days instead of 7 in the spec — accept the overrun).

---

## 9 · Out of scope for this doc (defer)

- Team accounts (Sprint 12+, "shared workspace" Junior tier feature).
- Refund self-serve (Sprint 11 — Whop handles via support for v1.0).
- 2FA on Junior accounts (Clerk has it; not enabled in v1.0).
- SSO with Google Workspace / Apple ID at scale (Clerk handles both; we just enable in Clerk dashboard).
- Whop checkout customisation beyond `?a=<affiliate_id>` — Whop's hosted page is fine.
- Anti-fraud rules on affiliate self-referrals — Whop's affiliate system blocks self-pay; we don't add a layer.

---

**Sign-off:** Daniel reviews this. If any flow is wrong or any "decision explicitly made" needs flipping, edit here first before writing code. Otherwise this is what the Sprint 4 backend builds against.
