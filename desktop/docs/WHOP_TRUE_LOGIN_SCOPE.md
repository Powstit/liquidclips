# Whop True Login — Scope

**Date:** 2026-06-08
**Owner:** Daniel
**Status:** Scoped, not started
**Sprint size:** ~half day (4–6 hrs)

## Goal

Add **"Continue with Whop"** as a co-equal door beside **"Continue with Google"** (Clerk) on the in-app sign-in panel that opens during desktop activation. New users get to pick their door from inside the app instead of only the Clerk path.

## Why

Today's flow is asymmetric:

| Door | Entry point | Auth provider | In-app? |
|---|---|---|---|
| Direct (Clerk) | `account.jnremployee.com/connect-desktop` | Clerk → Google OAuth + email | ✅ Tauri auth_panel webview |
| Whop (affiliate) | A clipper's TikTok/IG bio link → `whop.com/.../liquid-clips` | Whop hosted checkout | ❌ Web-only, never enters app |

A user who already has a Whop membership but lost activation (re-install, new Mac, expired JWT) has **no native re-activation path** — the in-app panel only knows Clerk. They have to dig out their original affiliate link or contact support. This scope closes that gap.

## What it does NOT solve

Whop OAuth authenticates a Whop user; it does **not** sell them a membership. New users without a paid Whop membership still go through Whop hosted checkout. "Continue with Whop" is **sign-in only**.

**Net effect**: returning Whop members re-activate seamlessly. Net-new Whop traffic still flows through affiliate links + Whop checkout.

## Current state (verified 2026-06-08)

- `desktop/src/lib/activation.ts:197` — in-app panel opens `https://account.jnremployee.com/connect-desktop?challenge=<nonce>`
- `account.jnremployee.com/connect-desktop` — Clerk-only sign-in (Google OAuth + email/password)
- `junior-backend/` — no Whop OAuth endpoints exist (grep verified — no matches for `WHOP_OAUTH` / `whop.*authorize`)
- Existing `/whop/*` proxy in junior-backend uses App API Key for server-to-server bounty calls, **not** user OAuth
- Activation handshake: challenge → mint JWT → deep-link `liquidclips://activate?token=…&challenge=…` is already in place per Activation Bridge (v0.4.21+)

## Target state

- In-app auth_panel shows two equal buttons: **Continue with Google** | **Continue with Whop**
- Whop button kicks off Whop OAuth, returns with code → backend exchanges for Whop user → backend looks up Whop membership for that user → mints JWT on the existing challenge → deep-link fires → desktop activates
- Identical JWT shape and tier resolution to the Clerk path — `effective_tier` derived from Whop membership instead of Stripe subscription
- Failure paths handled inline (see Edge cases)

## Implementation steps

### 1. Whop OAuth app registration (15 min)
- Whop dashboard → Developer → Create OAuth app
- Redirect URI: `https://api.jnremployee.com/auth/whop/callback`
- Scopes: `read_user`, `read_memberships`
- Capture `client_id` + `client_secret`
- Store in Railway: `WHOP_OAUTH_CLIENT_ID`, `WHOP_OAUTH_CLIENT_SECRET`

### 2. junior-backend OAuth endpoints (1.5 hrs)
New file: `junior-backend/app/routers/auth_whop.py`

- `GET /auth/whop/start?challenge=<nonce>` → builds Whop consent URL with `state=<challenge>`, 302 redirects
- `GET /auth/whop/callback?code=<x>&state=<challenge>` →
  1. Exchange `code` for access token at Whop OAuth endpoint
  2. Fetch Whop user via `GET /api/v5/me` with token
  3. Fetch Whop memberships for that user; identify active Liquid Clips membership; resolve plan_id → `effective_tier`
  4. Mint JWT bound to `challenge`
  5. 302 redirect to `liquidclips://activate?token=<jwt>&challenge=<challenge>`
- If no active Liquid Clips membership found: redirect to `account.jnremployee.com/connect-desktop?whop_nomembership=1` so the page can show "You don't have a Liquid Clips membership yet — [get one]" with the affiliate link

### 3. account-app sign-in page UI (1 hr)
File: `account-app/app/connect-desktop/page.tsx` (Next.js)

- Add a second primary button **"Continue with Whop"** below the existing Clerk buttons
- Button href: `https://api.jnremployee.com/auth/whop/start?challenge=<challenge from URL>`
- Wrap behind feature flag `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED` (env var, no rebuild needed to toggle)
- Render the `whop_nomembership=1` empty state with a CTA link to the Whop product page

### 4. End-to-end test (45 min)
Manual checklist on staging:
- [ ] Existing Whop user (real membership) clicks "Continue with Whop" → activates to correct tier
- [ ] Whop user with NO Liquid Clips membership → sees nomembership empty state with affiliate CTA
- [ ] Existing Clerk path still works (regression check)
- [ ] Wrong challenge / expired challenge → rejected with clean error
- [ ] Feature flag off → Whop button hidden, no regression

### 5. Ship to prod (15 min)
- Railway env vars set on production
- account-app deploy via Vercel
- Flip `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true`

## Edge cases

| Scenario | Handling |
|---|---|
| Whop user, no LC membership | Redirect back with `?whop_nomembership=1`, show "Get a membership" CTA with affiliate link |
| Whop OAuth declined / cancelled | Redirect back with `?whop_cancelled=1`, return user to door picker |
| Whop API down at callback time | Backend returns 503 to the OAuth redirect; page shows "Whop temporarily unavailable, try Google instead" |
| User already activated with Clerk, signs in with Whop on second device | JWT minted fresh, no conflict — challenge is one-shot |
| Whop user on a different email than Clerk on same machine | Both JWTs valid; whichever activated last wins (existing behaviour) |
| Whop membership cancelled mid-session | Existing `meStatus()` polling catches `effective_tier="free"` and shows the standard re-activate banner from `AvatarPanel.tsx` (v0.7.8) |

## Env vars to add

**junior-backend (Railway):**
```
WHOP_OAUTH_CLIENT_ID=...
WHOP_OAUTH_CLIENT_SECRET=...
WHOP_OAUTH_REDIRECT_URI=https://api.jnremployee.com/auth/whop/callback
```

**account-app (Vercel):**
```
NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true
NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL=https://whop.com/.../liquid-clips?ref=<owner_affiliate_id>
```

## Acceptance criteria

1. A Whop-only user with an active Liquid Clips membership can open the desktop app, click **Continue with Whop** in the in-app panel, complete Whop OAuth in the same webview, and have the desktop activate to the correct `effective_tier` — without ever touching their card.
2. Existing Clerk flow remains unchanged (regression check on direct-door + Stripe checkout passes).
3. Feature toggleable via single env var flip without redeploy of any other surface.
4. `meStatus()` reflects `provider: "whop"` for users who activated via this path (for analytics; existing field).

## Risks

- **Regression on `/connect-desktop` page** — the activation bridge memory flags this URL as previously "broken /sign-in flow." Mitigate with feature flag and staging test before flip.
- **Whop OAuth rate-limits** — verify limits during staging test; cache user→membership lookup for short TTL if needed.
- **Affiliate attribution** — Whop OAuth at sign-in does NOT carry affiliate `ref` parameters. The "Get a membership" CTA must include the configured affiliate URL so net-new Whop traffic still credits the right partner.

## Files touched (preview)

| File | Action |
|---|---|
| `junior-backend/app/routers/auth_whop.py` | NEW |
| `junior-backend/app/main.py` | Mount `auth_whop_router` |
| `junior-backend/app/config.py` | Add `WHOP_OAUTH_*` settings |
| `account-app/app/connect-desktop/page.tsx` | Add "Continue with Whop" button + feature flag |
| `account-app/.env.production` | Add `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED` + affiliate URL |
| `desktop/src/lib/activation.ts` | **NO CHANGE** — existing challenge/JWT plumbing handles it |

## Out of scope (defer)

- Net-new buyer flow via in-app Whop signup — still goes via affiliate link to Whop checkout
- Whop avatar/profile sync into the in-app Avatar panel (separate sprint)
- Migrating existing Clerk users to Whop or vice versa (no business reason today)
