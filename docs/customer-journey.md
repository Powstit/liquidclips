# Junior (jnremployee) — Customer Journey

Maps the six user states end-to-end, grounded in the actual code. Source files referenced inline; line-level behaviour verified against:

- Backend: `junior-backend/app/models.py`, `features.py`, `mailer.py`, `analytics.py`, `deps.py`
- Routes: `junior-backend/app/routes/{webhooks_clerk,webhooks_whop,onboarding,desktop,me,usage,sync}.py`
- Account app: `account-app/src/app/{dashboard,checkout,get,download,sign-up}/page.tsx`, `src/components/{PricingCards,WhopLinkBoot,PostHogBoot,Track}.tsx`, `src/lib/analytics.ts`
- Partner app: `partner-app/src/app/page.tsx`

## Cross-cutting model facts (apply to every state)

These are the load-bearing invariants every section below depends on.

| Fact | Where | Detail |
|---|---|---|
| Free entitlement = **100 clip exports** (lifetime) | `usage.py` `STARTER_EXPORT_CAP = 100`, `starter_export_remaining()` | Old 3-videos/month cap retired 2026-05-25. `_quota_for_tier()` now returns `None` always; `/usage/video-started` never blocks, only counts. |
| Entitlement is **capped unless** `founder_flag` **OR** (`subscription_status == "active"` **AND** `tier != "free"`) | `usage.py` `starter_export_remaining()` lines 57-59 | A trial buyer (`tier=solo`, `status="trialing"`) is **still capped** — tier alone does not lift the cap. |
| Whop `membership_valid` → `"trialing"`; `payment_succeeded` → `"active"` | `webhooks_whop.py` `apply_membership_tier()` (220-223), `_handle_payment_succeeded()` (379) | Founder is the exception: `apply_membership_tier` sets `"active"` immediately because `founder_flag` is true. |
| Pending Whop memberships stashed by email | `webhooks_whop.py` `_stash_pending_membership()`, model `PendingWhopMembership` | Claimed at first sign-in via `POST /onboarding/link-whop` (called by `/get` page **and** `WhopLinkBoot` on any account page). |
| `affiliate_id` is **first-touch, never overwritten** | `models.py` (34), `webhooks_clerk.py` `_handle_user_updated` (193) | Locked at signup from `jnr_ref` cookie → Clerk `unsafeMetadata.affiliate_id` → `user.created` webhook. |
| Admin-email override | `features.py` `ADMIN_EMAILS`, `deps.py` `current_user()` (43-46), mirrored in `dashboard/page.tsx` (25-33) | Emails in `JUNIOR_ADMIN_EMAILS` (fallback: danieldiyepriye / mrddokubo / crazycatjackkids / thedoks2019 @gmail) get `tier=autopilot`, `founder_flag=True`, `remaining_exports=None`, `subscription_status="admin"` in-memory only. Never committed. |
| Two billing systems | `webhooks_clerk.py` (recurring), `webhooks_whop.py` (trial + one-time) | `billing_provider = "whop" if user.whop_user_id else "clerk"` (`me.py`, `sync.py`). Clerk Billing/Stripe = recurring tiers via direct signup; Whop = affiliate-checkout trials + Founder. |

### Tier vocabulary mismatch (a real risk, noted once)

`models.py` comment and `features.py` use **`growth`** as the third tier. But several places still use the legacy **`channel`** name:
- `webhooks_whop.py` `PLAN_TIER_BY_TITLE` maps `"junior channel" → "growth"` and the **founder notification copy** literally says "bumped you to Channel forever" / "Channel tier locked".
- `usage.py` docstring lists tiers as "solo, channel, autopilot".

`features.py` `FEATURES_BY_TIER` has **no `channel` key** — so if any path ever sets `tier="channel"`, `tier_features()` silently falls back to `free`. No live path does (founder → `autopilot`), but it is a latent footgun.

---

## State 1 — Direct Stripe customer

Signs up on `account.jnremployee.com`, pays via Clerk Billing (Stripe under the hood).

| Dimension | Value |
|---|---|
| Sign in | **Clerk** on account-app (`/sign-up`, `/sign-in`). |
| Pay | **Clerk Billing → Stripe.** `PricingCards.tsx` uses `<CheckoutButton planId={cplan_…} planPeriod="month">`. Plan IDs are production Clerk `cplan_*`. |
| Billing provider | `clerk` (no `whop_user_id` ever set). |

### Backend field transitions

| Event | `tier` | `subscription_status` | `founder_flag` | `whop_user_id` | `affiliate_id` | `starter_exports_used` | `paid_until` |
|---|---|---|---|---|---|---|---|
| `user.created` (`webhooks_clerk.py` 111-178) | `free` | `trial` | `false` | `null` | from `unsafe_metadata` (or null) | `0` | `null` |
| `subscription.active` / `subscriptionItem.updated` (257-299) | from `CLERK_SLUG_TO_TIER` (solo/growth/autopilot) | **`active`** | unchanged | unchanged | unchanged | unchanged | `period_end` if present |
| `subscription.past_due` (325-341) | unchanged | `past_due` | — | — | — | — | — |
| `subscription.canceled` (302-322) | **unchanged** (keeps access via `paid_until`) | `canceled` | — | — | — | — | `period_end` |

Note: there is **no period-end cron** to flip `canceled → expired` — the canceled handler comment admits it is "out of scope today". So a canceled Stripe user keeps their `tier` indefinitely; the only thing changing is `subscription_status`, and `starter_export_remaining` still returns `None` (unlimited) for them because `tier != free` but `status != active`… → **wait**: once canceled, `status` is no longer `"active"`, so the cap logic `(status=="active" AND tier!="free")` becomes false → they get **re-capped to 100 exports** even though copy/`paid_until` says they keep full access. See risks.

### Dashboard cards (`dashboard/page.tsx`)

Tier is read from `user.publicMetadata.tier` (Clerk), **not** the backend. Paid users (`isFree=false`):
- "at a glance": plan = capitalised tier, exports = "Unlimited", referral/direct, member since.
- Card 01 download, Card 02 account, Card 03 connect Whop, Card 04 earn, Card 05 partner (50%), Card 06 your files.
- The "02 Outgrow free" upsell card is **hidden** for paid users.
- Plans section header flips to "Manage subscription"; `PricingCards` shows their plan as "Current plan".

### Emails (`mailer.py`)

| Email | Sender | Trigger |
|---|---|---|
| Welcome ("100 free clip exports") | `send_welcome` | `user.created` (always, even for someone about to pay). |
| "Junior {Tier} is live." | `send_subscription_activated(trial=False)` | **NOT sent for Clerk-billing.** Only the Whop webhook calls this sender. |
| Cancellation | `send_subscription_canceled` | **NOT sent for Clerk cancel.** Only the Whop `_handle_membership_invalid` calls it. |
| License activated | `send_license_activated` | First `/desktop/connect`. |

**Gap:** the Clerk subscription handlers send **no email** on activate / cancel / past_due — they only write in-app `Notification` rows. A direct Stripe customer who upgrades or cancels gets zero transactional email confirming it.

### PostHog events

| Event | Source | Notes |
|---|---|---|
| `signup_started`, `affiliate_ref_captured` | `sign-up` page | client |
| `signup_completed`, `affiliate_attribution_locked` | `webhooks_clerk` `_handle_user_created` | server |
| `checkout_started` | `PricingCards` onClick | client |
| `subscription_activated` (`via:"clerk"`, `billing_provider` derived) | `webhooks_clerk` `_handle_subscription_active` | server |
| `subscription_canceled` (`via:"clerk"`) | `webhooks_clerk` `_handle_subscription_canceled` | server |
| `dashboard_viewed`, `desktop_download_clicked`, `upgrade_viewed` | dashboard | client |
| `desktop_activated` | `/desktop/connect` first license | server, once |

**Missing for this state:** no `checkout_completed` server event from Clerk's side — `checkout_started` fires client-side but there is no paired success event other than the webhook's `subscription_activated`, so client-side checkout-abandonment vs. success can't be measured directly. No `past_due` PostHog event (only an in-app notification).

### Failure / edge cases
- **`subscription.active` arrives before `user.created`** (`_handle_subscription_active` 263-265): silently skipped; reconciles on re-delivery or next `/sync` — but `/sync` does **not** re-pull tier from Clerk, so if the webhook is permanently lost, the user stays `free` forever.
- **Cancel never downgrades tier**, no cron sweeps to `expired` → stale `tier`, but cap re-applies (see above).
- **Admin email** signing up direct → always Autopilot/founder in `current_user`/`/sync`/`/me`, regardless of Clerk metadata.

---

## State 2 — Affiliate Whop-checkout customer

Arrives via affiliate link → `account.jnremployee.com/checkout?a=<affId>` → Whop embedded checkout → `/get` onboarding. This is the **Solo 30-day trial** product (see State 3 for the trial mechanics; this section covers the acquisition path).

| Dimension | Value |
|---|---|
| Sign in | **Clerk** on account-app (created at `/get` via `/sign-up?redirect_url=/get`). |
| Pay | **Whop** embedded checkout (`checkout/page.tsx`, `js.whop.com/static/checkout/loader.js`, `data-whop-checkout-plan-id={SOLO_PLAN_ID=plan_qe8AFXj9J3SWi}`, `data-whop-checkout-affiliate-code={affiliateId}`). |
| Billing provider | `whop` once linked (`whop_user_id` set by `apply_membership_tier`). |

### The path (ordering matters)

1. Partner link → `buildReferralUrl` (`partner-app/page.tsx`) = `account.jnremployee.com/checkout?a=<affiliate.id>`.
2. `/checkout` reads `?a`, sets first-touch `jnr_ref` cookie scoped to `.jnremployee.com`, mounts Whop embed.
3. On complete: `__jnrCheckoutComplete` drives top window to `/get?a=<affId>` (skip-redirect avoids landing inside the iframe / Whop hub).
4. **Whop `membership_went_valid` webhook fires** — usually **before** any Clerk user exists. `_find_user_for_event` finds nothing → `_stash_pending_membership(email, tier=solo, founder=false)`.
5. Buyer signs up/in at `/get` → Clerk `user.created` → backend user created (`tier=free`, `status=trial`, `affiliate_id` from cookie).
6. `/get` page **and** `WhopLinkBoot` POST `/onboarding/link-whop {clerk_user_id, email}`.
7. `link_whop` finds the unconsumed pending row **by lowercased email**, calls `apply_membership_tier(tier=solo, founder=false)`, stamps `consumed_at`.

### Backend field transitions

| Step | `tier` | `subscription_status` | `whop_user_id` | `affiliate_id` | `paid_until` | `starter_exports_used` |
|---|---|---|---|---|---|---|
| Whop webhook, no user yet | — parked in `PendingWhopMembership(email, tier=solo, founder=false, whop_user_id, renewal_period_end)` | | | | | |
| `user.created` | `free` | `trial` | `null` | from cookie | `null` | `0` |
| `/onboarding/link-whop` → `apply_membership_tier` | `solo` | **`trialing`** (not active — non-founder, not already active) | set | unchanged | `renewal_period_end` if present | `0` |
| later `payment_succeeded` (after 30d) | `solo` | **`active`** | set | unchanged | bumped | unchanged |

### Dashboard cards
Tier comes from Clerk `publicMetadata.tier`. **Critical:** the Whop/onboarding path updates the **backend DB**, not Clerk metadata. So unless something separately writes `publicMetadata.tier`, the dashboard still shows **Free** for a linked trial user (exports "100" / "Outgrow free" card visible) even though backend says `solo/trialing`. See risks.

### Emails

| Email | Trigger |
|---|---|
| Welcome | `user.created`. |
| "Your 100 free clip exports are ready." (`send_subscription_activated(trial=True)`) | Whop `_handle_membership_valid` **only if a user already exists at webhook time**. If the user is created later (the common case), the membership is parked and `link_whop` applies it **silently** (`apply_membership_tier` intentionally sends no email) → **no activation email at all** for the typical affiliate buyer. |
| License activated | First `/desktop/connect`. |

### PostHog events

| Event | Source |
|---|---|
| `affiliate_link_clicked` (`surface:account_app`) | `PostHogBoot`, once/session if ref present |
| `checkout_page_viewed`, `checkout_cta_clicked`, `whop_checkout_loaded`, `whop_checkout_completed` (all `billing_provider:whop`) | `checkout` page |
| `get_page_viewed`, `whop_link_started`, `whop_link_succeeded` / `whop_link_failed{reason}` | `get` page |
| `signup_started`, `affiliate_ref_captured`, `signup_completed`, `affiliate_attribution_locked` | sign-up + clerk webhook |
| `whop_membership_valid` (`tier`, `founder`) | Whop webhook — **only when user exists at webhook time** |

**Missing:** `whop_membership_valid` does **not** fire for the parked-then-linked path (the webhook returns early after stashing; `link_whop` emits **no** PostHog event). So the most common affiliate conversion is invisible to PostHog server-side — only the client `whop_checkout_completed` / `whop_link_succeeded` mark it. There is no server event tied to the actual `apply_membership_tier` call from onboarding.

### Failure / edge cases
- **Email mismatch** — buyer pays on Whop with email A, signs up with email B → pending row keyed on A is never matched → `link_whop` returns `linked:false` → `/get` shows "We couldn't match your purchase yet." The `not_linked` panel tells them to use the same email. **No auto-reconciliation.**
- **Whop didn't include buyer email** → `_stash_pending_membership` drops it entirely (only the `WebhookEvent` idempotency row is kept). Entitlement lost; only recoverable manually.
- **Webhook never fires / fires after a long delay** → `link_whop` finds nothing → `not_linked`; buyer must refresh later.
- **`whop_user_id` collision** — column is `unique`. If two Clerk accounts try to claim the same Whop user id, the second `apply_membership_tier` flush violates the unique constraint.

---

## State 3 — Trial / starter user

Whop Solo 30-day trial: `tier=solo` but `subscription_status="trialing"`, capped at 100 clip exports. This is State 2's resting state between link and first payment (or the user who never pays).

| Dimension | Value |
|---|---|
| Sign in | Clerk on account-app. |
| Pay | Whop holds the card; **$0 charged for 30 days**. Whop bills $29.99 after the trial. |
| Billing provider | `whop`. |

### Backend fields
`tier=solo`, `subscription_status="trialing"`, `founder_flag=false`, `whop_user_id` set, `paid_until` = Whop `renewal_period_end`, `starter_exports_used` 0→100.

**Entitlement:** `starter_export_remaining()` returns `100 - used` because `founder_flag=false` AND `(status=="active" AND tier!="free")` is false (status is `trialing`). So a trial user is **capped at 100 exports** despite being `tier=solo`. This is the deliberate design (`usage.py` docstring 50-56): tier alone does not unlock; only a confirmed payment promoting to `active` lifts the cap.

### Export enforcement (`/usage/clip-exported`)
Called by desktop **after a successful export only**. While `remaining > 0`: increments `starter_exports_used`, returns remaining. At export #101 (`remaining <= 0`): **HTTP 402** "You've used your 100 free clips. Continue on Solo ($29.99/mo)…" → desktop shows the continue-on-Solo prompt. `/sync`, `/desktop/heartbeat`, `/me` all surface `remaining_exports` so the desktop can show "82 clips left".

### Dashboard cards
Same Clerk-metadata problem as State 2 — dashboard likely shows **Free** (100 exports) unless `publicMetadata.tier` was written. Functionally not wrong for a trial (still 100-capped) but the plan label is misleading.

### Emails
"Your 100 free clip exports are ready." (`trial=True`) — copy: "$0 today · Solo $29.99/mo after 30 days." Sent **only** if user existed when the Whop webhook fired (rare for affiliate flow → usually no email; see State 2).

### PostHog events
Same as State 2. **Notably missing:** `subscription_still_active_day_30` (reserved in `analytics.py` for a Phase 2 scheduled job — not built), and `starter_pass_exhausted` (reserved Phase 3 — **not emitted** even though `/usage/clip-exported` is the natural home and already detects exhaustion via the 402). So "trial converted vs. trial exhausted vs. trial churned" is **entirely unmeasured server-side.**

### Failure / edge cases
- **Trial never converts** — there is **no cron** to expire a trial or flip `trialing → expired`. If Whop never sends `payment_succeeded` or `membership_went_invalid`, the user sits at `tier=solo`/`trialing`/100-cap indefinitely. They keep whatever exports remain forever; they never auto-upgrade and never get dunning from Junior (Whop handles billing/dunning).
- **`payment_succeeded` lost** → user stays capped at 100 even though they're being billed by Whop. Cap only lifts on the `active` promotion.
- **`membership_went_invalid` after trial cancel** → `tier=free`, `status=expired`, re-licensed at free; gets the cancellation email. Their remaining starter exports reset semantics: now `tier=free`, cap still applies on `100 - used`.

---

## State 4 — Paid Solo / Growth / Autopilot

A confirmed, paying recurring customer. Reaches here either via **Clerk Billing** (State 1 direct) or via **Whop `payment_succeeded`** (State 2 trial that converted).

| Dimension | Value |
|---|---|
| Sign in | Clerk on account-app. |
| Pay | Clerk/Stripe (direct) **or** Whop (converted affiliate trial). |
| Billing provider | `clerk` or `whop` per `whop_user_id`. |

### Backend fields
`tier ∈ {solo, growth, autopilot}`, `subscription_status="active"`, `founder_flag=false`, `paid_until` set, `whop_user_id` set iff Whop-billed.

**Entitlement unlocked:** `starter_export_remaining()` returns `None` (unlimited) because `(status=="active" AND tier!="free")` is true. Feature gates come from `features.py` `FEATURES_BY_TIER[tier]`:
- Solo: 2 platform connections, publish-now single, BYO OpenAI key, unlimited videos.
- Growth: 4 connections, hosted transcribe+LLM, multi-platform publish + schedule, 200/mo soft cap.
- Autopilot: unlimited connections, drip scheduling, 500/mo soft cap.

(Several flags are `built:false` — e.g. priority_support S6, project_memory v1.2 — entitled but not shipped; routes return 503 "Coming Sprint X".)

### Dashboard cards
For Clerk-billed paid users, `publicMetadata.tier` should reflect the paid tier → "Manage subscription", current-plan badge, exports "Unlimited", no upsell card. For Whop-converted paid users the same Clerk-metadata staleness risk applies.

### Emails

| Email | Trigger |
|---|---|
| "Junior {Tier} is live." (`trial=False`) | Whop `_handle_membership_valid` **when user exists and status not trialing** — i.e. fires for a Whop membership that lands as a real plan, not the parked-trial case. |
| (none on Clerk activation) | Clerk path sends **no** "is live" email. |
| Cancellation | Whop `_handle_membership_invalid` only. |

### PostHog events
- Whop-converted: `whop_membership_valid` (if user existed), plus the `payment_succeeded` handler emits **no PostHog event** — so the trial→paid promotion (the single most important conversion) has **no server event**.
- Clerk-paid: `subscription_activated (via:clerk)`.
- `subscription_still_active_day_30` reserved, not built → no retention measurement.

### Failure / edge cases
- **Whop `payment_succeeded` with no `renewal_period_end`** → `paid_until` defaulted to now+30d (`_handle_payment_succeeded` 384-385).
- **Downgrade/upgrade via Clerk** handled by `subscriptionItem.updated` (same handler as `subscription.active`) → re-maps tier by slug.
- **Tier resolution split-brain:** desktop/backend truth (DB via `/sync`,`/me`) can disagree with dashboard truth (Clerk metadata). The desktop is correct; the website dashboard may lag.

---

## State 5 — Founder ($500 one-time on Whop)

| Dimension | Value |
|---|---|
| Sign in | Clerk on account-app. |
| Pay | **Whop** one-time $500 (`whop.com/jnremployee`, also linked from `/download` and dashboard `founderUrl` with `?a=<affId>`). Founder is sold on Whop because Clerk Billing is recurring-only. |
| Billing provider | `whop`. |

### Founder detection (`webhooks_whop.py`)
`_tier_from_event`: a plan whose **title contains "founder"** → returns `("autopilot", True)`. (Note: `PLAN_TIER_BY_ID` only lists Solo/Growth/Autopilot recurring plans, **not** a founder plan id — founder relies entirely on title-matching. If Whop returns `title=null` for the founder plan, founder detection **fails** and they'd be mapped to the `PLAN_TIER_BY_TITLE` default `growth` with `founder=false`. Real risk.)

### Backend fields
`apply_membership_tier(tier=autopilot, founder=True)`:
- `tier=autopilot`, `founder_flag=true`.
- `subscription_status="active"` **immediately** (the `if user.founder_flag: status="active"` branch, 220-221) — founders are never "trialing".
- `paid_until = None` (one-time, line 229-230).
- `whop_user_id` set.

**Entitlement:** unlimited (`founder_flag` alone satisfies `starter_export_remaining → None`). Founder always gets the **Autopilot** feature set via `tier_features(tier, founder=True)` regardless of stored tier.

### Dashboard cards
Founder is **not** a tier in Clerk `publicMetadata.tier`. The dashboard derives `effectiveFounder` from `publicMetadata.founder === true` (or admin). If founder flag was only written to the **backend** (not Clerk metadata), the dashboard won't show founder status — same metadata-staleness gap. The debug panel's "Effective tier" line would still read from Clerk metadata, not `/me`.

### Emails
"Founder Lifetime — you're in." (`send_founder_welcome`) — fires in `_handle_membership_valid` when `user.founder_flag and founder`. **Same parking caveat:** if the buyer pays before signing up (typical), the membership is parked and `apply_membership_tier` runs from `link_whop` **silently** → **no founder welcome email**. The founder also gets two in-app notifications (`founder` + `junior_message` "seat #N of 2,000") — but **only on the webhook path**, not the onboarding-link path.

### PostHog events
`whop_membership_valid (founder:true)` — webhook path only. The parked-then-linked founder gets **no server PostHog event** and **no email** and **no notification**. This is the single weakest VIP transition.

### Failure / edge cases
- **Founder buys before signup** → silent linking, no welcome email, no Slack-invite trigger copy delivered, no notifications.
- **Founder plan title not "founder" / title null** → mis-mapped to growth, `founder_flag` never set, `paid_until` gets set instead of staying null, cap logic could even re-cap them.
- **Refund** (`membership_went_invalid`) → `tier=free`, `status=expired` — but `founder_flag` is **never cleared** (`apply_membership_tier` only ORs it true; invalid handler doesn't touch it). A refunded founder keeps `founder_flag=true` → still unlimited Autopilot entitlement forever. Likely unintended.

---

## State 6 — Affiliate / partner (refers others)

Uses `partner.jnremployee.com` (a **separate** app, Whop-OAuth based). This person earns commission; they are not (necessarily) a Junior customer.

| Dimension | Value |
|---|---|
| Sign in | **Whop OAuth** on partner-app (`/auth/whop/start` → `/auth/whop/callback`, PKCE, session cookie). **Not Clerk.** |
| Pay | N/A — they *receive* payouts via Whop, not pay. Whop handles affiliate payouts. |
| Backend (junior-backend) fields | **None.** The partner app does not touch the junior-backend `users` table. Affiliate identity lives in **Whop** (`ensureAffiliate(session.userId)` → Whop affiliate record). The junior-backend only stores `affiliate_id` on the **referred** customers, never a row for the partner-as-partner. |

### What the partner sees (`partner-app/page.tsx`)
- Referral link → `account.jnremployee.com/checkout?a=<affiliate.id>` (Junior-branded checkout, Whop attributes the sale).
- Stat tiles: active MRR, pending payout (= current MRR), lifetime earned, active members, total referrals, retention — all pulled live from Whop via `ensureAffiliate`.
- Qualification policy: 50% recurring unlocks after **2 referred paid customers OR 11,000 Whop-verified views**; first two paid customers qualify but don't earn; commission requires an **active paid Junior subscription** (Solo+) — pauses if it lapses.
- Affiliate terms PDF (`/Junior-Affiliate-Terms-FAQ.pdf`), build-community + payout-setup links.

### Emails
**None from `mailer.py`.** The mailer has no affiliate/partner sender. The only adjacent email is `send_bounty_approved` (Whop Content Rewards clipper, a different actor). Partner onboarding, qualification, and payout notifications are **entirely Whop's** responsibility.

### PostHog events
`partner_dashboard_viewed` (`affiliate_id`, `has_affiliate`) — partner-app has its **own** `lib/analytics.ts` and `Track` component. The account-app's `affiliate_link_clicked` fires on the **referred visitor's** browser, not the partner's.

### Failure / edge cases
- **OAuth handshake blocked** (third-party cookie blockers: Brave / Safari ITP) → error page with "Try again", no dashboard.
- **`ensureAffiliate` throws** (Whop unreachable) → `failureNote` banner, stat tiles render with zeros, referral link absent.
- **No backend coupling** → if Whop's affiliate record and junior-backend's `affiliate_id` on customers ever diverge (e.g. partner regenerates their affiliate id on Whop), historical attributions on existing customers don't update (first-touch locked) — but the partner's *new* link carries the new id. Attribution is consistent only forward.
- **Commission depends on the partner separately being a paying Junior customer** — that's a State 1-4 dependency the partner app cannot enforce; it's policy text only.

---

## Funnel gaps & risks (weakest transitions)

1. **Clerk-metadata vs. backend split-brain on the dashboard.** The dashboard reads `publicMetadata.tier`, but every paid/trial/founder transition writes the **junior-backend DB** (via Whop webhook / `/onboarding/link-whop`), not Clerk metadata. Nothing in the read code writes `publicMetadata.tier`/`founder`/`whop_user_id`. Result: a linked Whop Solo trial, a converted paid Whop customer, and a Founder can all still show **"Free"** on `account.jnremployee.com/dashboard` while the desktop (which reads `/sync`,`/me`) is correct. This is the single highest-impact gap.

2. **Parked-membership path is silent.** The common affiliate/founder flow (pay on Whop → sign up after) parks the entitlement and applies it via `apply_membership_tier` from `link_whop`, which **deliberately sends no email, no notification, and no PostHog event**. So the typical affiliate buyer gets **no activation email**, and the typical Founder gets **no founder-welcome email and no founder notifications**. The webhook-only senders/notifications only fire for the rarer "user already existed" ordering.

3. **No trial lifecycle instrumentation or expiry.** `subscription_still_active_day_30` and `starter_pass_exhausted` are reserved names but **never emitted**; there is **no cron** to expire trials or sweep canceled subs to `expired`. Trial→paid conversion (`payment_succeeded`) emits **no PostHog event**. The entire trial→paid→churn funnel is effectively unmeasured server-side, and dead trials linger forever.

4. **Cancel keeps tier but re-caps exports, with no email.** Clerk `subscription.canceled` sets `status=canceled` without downgrading `tier` and with no period-end cron. But `starter_export_remaining` keys on `status=="active"`, so the instant a sub is canceled the user is **re-capped to 100 exports** even though copy + `paid_until` promise "full access until period end." Clerk cancel also sends **no transactional email** (only Whop cancel does).

5. **Email-mismatch + founder edge cases lose money/VIPs quietly.** A Whop buyer using a different email than their Junior signup never links (`not_linked`, manual recovery only); a Whop event missing the buyer email is dropped entirely. Founder detection relies on the plan **title containing "founder"** (no plan-id fallback) so a `title=null` founder plan silently maps to `growth`/non-founder; and a refunded founder keeps `founder_flag=true` (never cleared) → unlimited Autopilot forever.

### Minor / latent
- `channel` tier name still lingers in Whop title map + founder copy + usage docstring, but `features.py` has no `channel` key (would fall back to `free`). No live path hits it today.
- Dead PostHog vocabulary: `affiliate_landing_viewed`, `download_page_viewed`, `connection_added` are declared in `account-app/src/lib/analytics.ts` but **never fired**.
- `/sync` never re-pulls tier from Clerk, so a permanently-lost `subscription.active` webhook strands a paid Clerk customer on `free` with no self-healing path.
</content>
</invoke>
