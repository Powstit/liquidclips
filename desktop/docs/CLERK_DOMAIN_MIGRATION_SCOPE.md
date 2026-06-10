# Clerk Primary Domain Migration — Scope

**Date scoped:** 2026-06-10
**Owner:** Daniel decides, Claude executes within rails
**Status:** Path B (satellite-only) chosen + in progress 2026-06-10. Path A (full cutover) kept here for reference.

---

## ✅ RECOMMENDED PATH: B — Satellite-only (chosen 2026-06-10)

**Time:** 5 min in Clerk dashboard + 5 min smoke test
**Risk:** Zero (no downtime, no session invalidation, no rebuild, no code change)
**Why:** `account-app/src/app/layout.tsx:30-44` is already wired for dual-domain mode. The host header detects which domain serves the request; `account.liquidclips.app` automatically becomes the satellite, sign-in routes to primary, session syncs back. Nothing else has to move.

### Execute

1. **dashboard.clerk.com** → Liquid/clips production instance → **Configure → Domains → Satellites tab** → **Add satellite domain** → enter `account.liquidclips.app`.
2. Clerk verifies the CNAME (`clerk.account.liquidclips.app` already resolves ✅) + provisions TLS cert (~5 min).
3. **Smoke test in incognito:**
   ```
   https://account.liquidclips.app/connect-desktop?challenge=satellitesmoke12345
   ```
   - Clerk widget loads in satellite mode (no SSL error)
   - Click sign-in → bounces to `account.jnremployee.com/sign-in` (the primary) for auth
   - After sign-in → bounces back to `account.liquidclips.app` with session synced via `__clerk_synced`
   - Desktop activation deep-link `liquidclips://activate?…` fires
4. **Done.** Both domains live in parallel. Drop the old one whenever — no rush.

### Verification commands

```bash
# Clerk TLS on new satellite
curl -sI https://clerk.account.liquidclips.app/npm/@clerk/clerk-js@6/dist/clerk.browser.js | head -1
# Must return: HTTP/2 307 (currently: ERR_SSL_VERSION_OR_CIPHER_MISMATCH — confirms cert not yet provisioned)
```

### What's NOT needed in Path B

- ❌ No env var rotation (same `pk_live_…` / `sk_live_…` work for both domains)
- ❌ No code changes (dual-domain wiring already shipped — see `layout.tsx:30-44` + `middleware.ts:3-8`)
- ❌ No Vercel redeploy (`account.liquidclips.app` alias already present)
- ❌ No desktop client rebuild (still uses `account.jnremployee.com` per `activation.ts:25` — works fine)
- ❌ No existing sessions invalidated
- ❌ No Danger Zone change

### When Path A becomes relevant (later, optional)

Months from now — when 100% of traffic naturally lives on `account.liquidclips.app` because the desktop ships a new `CONNECT_URL` — then the Danger Zone "Change primary domain" can happen with negligible downtime impact (zero active users on the old domain to disrupt).

---

## Path A (deferred) — Full primary-domain cutover

The rest of this doc preserves the original full-cutover scope for the day Path A becomes necessary.

---

## Goal

Move Clerk's primary domain from `account.jnremployee.com` → `account.liquidclips.app` so the in-app activation panel + sign-up + dashboard all live on the new brand. This is the "Danger zone" change in Clerk dashboard that Clerk warns will cause downtime.

## Why now

- Brand drift: every other surface (resend, public site, Whop OAuth redirect, Apple bundle ID) is already on `liquidclips.app`. Only Clerk + a handful of hardcoded fallbacks still reference `jnremployee.com`.
- Re-activation cost goes up the longer we wait: every new user on the wrong domain compounds the migration risk.

## Current state — verified 2026-06-10

| Surface | State | Action needed |
|---|---|---|
| Clerk primary domain | `account.jnremployee.com` | **change in dashboard (danger zone)** |
| Clerk satellite | account.liquidclips.app already aliased on Vercel | re-verify post-change |
| DNS `clerk.account.liquidclips.app` CNAME | ✅ already resolves to `frontend-api.clerk.services.` | nothing — ready |
| DNS `clerk.account.jnremployee.com` CNAME | ✅ resolves (current production) | drop AFTER cutover verified |
| Vercel account-app aliases | both `account.jnremployee.com` + `account.liquidclips.app` ✅ | nothing |
| `account-app/src/app/layout.tsx:30,32` | hardcoded `PRIMARY_HOST/URL = "account.jnremployee.com"` | **flip to liquidclips.app** |
| `account-app/src/app/checkout/page.tsx:97` | fallback URL `https://account.jnremployee.com` | flip |
| `account-app/src/app/dashboard/page.tsx` × 5 lines | hardcoded `account.jnremployee.com/dashboard…` paths | flip |
| `desktop/src/lib/activation.ts:25` | `CONNECT_URL = "https://account.jnremployee.com/connect-desktop"` | flip + bump desktop version |
| account-app middleware comment | already documents the dual-domain plan | update copy |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (Vercel + Railway) | `pk_live_…` for jnremployee instance | **rotate** to new domain's key |
| `CLERK_SECRET_KEY` (Vercel + Railway) | `sk_live_QH3nuETT8…` for jnremployee instance | **rotate** to new key (if Clerk regenerates) |
| `CLERK_WEBHOOK_SECRET` (Railway) | `whsec_2X/…` | usually stable; verify in Clerk dashboard post-change |
| Clerk webhook endpoint URL | currently points at jnremployee URL | update in Clerk dashboard |
| Sentry, Resend, Whop, public site | already on liquidclips.app | nothing |

## Out of scope (parallel migrations, NOT part of this sprint)

- `api.jnremployee.com` → `api.liquidclips.app` (backend custom domain) — separate Railway TLS + DNS task
- `partner.jnremployee.com` (Whop affiliate dashboard) — owned by Whop
- Anything related to email deliverability (Proton MX is independent of Clerk)
- Source-tree rename `junior-desktop` → `liquid-desktop` (the source name is incidental; bundle ID + brand are already migrated)

## Pre-cutover prep (do BEFORE touching Clerk dashboard)

1. **Pre-bake the code changes locally — committed but NOT deployed:**
   - `account-app/src/app/layout.tsx` — flip `PRIMARY_HOST` + `PRIMARY_URL` to `account.liquidclips.app`
   - `account-app/src/app/checkout/page.tsx:97` — fallback flip
   - `account-app/src/app/dashboard/page.tsx` — 5 hardcoded URLs flip
   - `desktop/src/lib/activation.ts:25` — `CONNECT_URL` flip + bump desktop patch version
   - Sweep comments touching the old domain (low priority, cosmetic)
2. **Snapshot current Clerk env vars** — record current `pk_live_…` and `sk_live_…` to `~/.claude-credentials/clerk.env` (in case Clerk regenerates and we need to rollback to the old instance).
3. **Pick a low-traffic window** for the cutover (users sign in via Whop deep-link, so traffic is creator-burst-driven — a quiet hour is fine).
4. **Comms decision** — do active users need a heads-up that they may be signed out? Daniel decides; default = silent, since the user base is small enough that re-sign-in is a low-friction recovery.

## Cutover sequence

Execute top-to-bottom. Each step's exit-criteria gates the next.

### Step 1 — Clerk dashboard: change primary domain
- dashboard.clerk.com → liquidclips instance → **Domains → Danger Zone → Change domain**
- Enter `account.liquidclips.app`
- Clerk auto-verifies DNS (already in place) + provisions TLS cert
- **Exit:** Clerk shows green for `account.liquidclips.app`. TLS cert active. `curl -sI https://clerk.account.liquidclips.app/v1/clients/_health` returns 200.

### Step 2 — Capture rotated keys
- Clerk dashboard → API keys
- Copy new `pk_live_…` (publishable) + `sk_live_…` (secret)
- Save to `~/.claude-credentials/clerk.env` with comment "post-2026-06-10 migration"

### Step 3 — Update Clerk webhook URL
- Clerk dashboard → Webhooks → existing endpoint
- Change URL `https://account.jnremployee.com/api/webhooks/clerk` → `https://account.liquidclips.app/api/webhooks/clerk`
- Note: `CLERK_WEBHOOK_SECRET` typically stays the same; verify in Webhooks settings. If rotated, update Railway env in step 5.

### Step 4 — Update Vercel env vars on account-app
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → new pk_live (type: plain, not encrypted, not sensitive — Next.js needs build-time inline)
- `CLERK_SECRET_KEY` → new sk_live (type: sensitive or encrypted, OK)
- All three targets: production + preview + development

### Step 5 — Update Railway env vars on junior-backend
- `CLERK_SECRET_KEY` → new sk_live
- `CLERK_WEBHOOK_SECRET` → only if Clerk rotated it (usually not)

### Step 6 — Push the pre-baked code commits
- Push the local commits from Pre-cutover prep step 1
- Vercel auto-deploys account-app from main
- Railway auto-deploys junior-backend from main
- **Exit:** both deploys go green within 5 min

### Step 7 — Smoke test (browser, incognito)
- `https://account.liquidclips.app/connect-desktop?challenge=cutoversmoke12345`
- Expect: Clerk widget loads, sign-in panel renders with "Continue with Google" + "Continue with Whop"
- Sign in with Google → fresh Clerk session on the new domain → desktop activation deep-link fires → app activates
- Webhook side test: trigger a fresh sign-up via Clerk → confirm `WebhookEvent` row appears in junior-backend (`POST /webhooks/clerk` 200) and the User row gets upserted

### Step 8 — Desktop client cutover (bumps a public version)
- Code change already in step 1 prep
- Build + sign + install locally to verify activation UX
- If clean → tag the version (whichever patch version the change lands in) and push

### Step 9 — Decommission the old domain (post-stability)
- After 7 days of stable operation on new domain:
  - Drop the `account.jnremployee.com` Vercel alias
  - Remove the `clerk.account.jnremployee.com` CNAME
  - Update remaining comments / docs / `_backups/*` files
- Hold off on canceling the `jnremployee.com` domain registration entirely (separate concern; brand assets, partner links, affiliate URLs may still reference it).

## Verification commands

```bash
# 1. Clerk TLS on new domain
curl -sI https://clerk.account.liquidclips.app/npm/@clerk/clerk-js@6/dist/clerk.browser.js | head -1
# Must return: HTTP/2 307 (not ERR_SSL_VERSION_OR_CIPHER_MISMATCH)

# 2. Vercel env shows new pk_live on production
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/Library/Application Support/com.vercel.cli/auth.json'))['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects/prj_eIPnzibZFvuw6I9T4AHJAoA3GJRZ/env?decrypt=true&teamId=team_3lDWj6sdPuELe9YfI0HmztSK" \
  | python3 -c "import json,sys; [print(e['key'],'=',e['value'][:20]+'...') for e in json.load(sys.stdin)['envs'] if 'CLERK' in e['key']]"

# 3. Railway has new sk_live
cd ~/Desktop/jnr/junior-backend && railway variables | grep CLERK_SECRET_KEY

# 4. End-to-end: incognito → /connect-desktop on new domain → sign in → desktop activates
# (manual)
```

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing user sessions invalidated | High (expected) | Daniel notifies users OR accepts silent re-sign-in (user base is small) |
| New publishable key not inlined in build (sensitive type issue from B3-T2 redux) | Medium | Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as `plain` type explicitly |
| Webhook URL change loses in-flight sign-up events | Low | Short window; replay via Svix dashboard if needed |
| Clerk dashboard "Change domain" downtime longer than expected | Low | Have rollback ready (step 9 of rollback) |
| Old desktop installs (v0.7.44 and earlier) keep hitting `account.jnremployee.com` | Medium | Keep that Vercel alias live for ≥30 days; old client still works because account-app responds on both hosts. The Clerk JS will fail on the old domain post-cutover, but only for users opening the activation panel on a stale build — they'll need to update the app. |
| Whop OAuth redirect URI references the old domain | Low | Whop dashboard already has both `partner.jnremployee.com` AND `api.liquidclips.app` registered (verified). The activation flow uses `api.liquidclips.app/auth/whop/callback` — unaffected. |

## Rollback plan

If smoke test (step 7) fails:

1. Clerk dashboard → Domains → revert to `account.jnremployee.com` (Clerk supports this; second downtime window required)
2. Restore old Vercel env vars from `~/.claude-credentials/clerk.env` backup
3. Restore old Railway env vars
4. Revert the pre-baked code commits via `git revert`
5. Vercel + Railway auto-redeploy
6. Smoke-test the old domain still works → users back to baseline

Estimated rollback time: ~20 min if executed cleanly.

## Acceptance criteria

1. `https://account.liquidclips.app/connect-desktop?challenge=…` loads Clerk widget cleanly (no ERR_SSL_VERSION_OR_CIPHER_MISMATCH).
2. Sign-in flow works end-to-end — Clerk widget → Google OAuth → desktop activation deep-link → license JWT in keychain.
3. New sign-up triggers Clerk webhook → junior-backend logs `POST /webhooks/clerk 200` → User row upserted.
4. Desktop activation panel opens the new domain (verified by reading `activation.ts:25`).
5. Old domain `account.jnremployee.com/connect-desktop` returns a redirect (or 410) to the new domain, OR keeps working as a satellite (Daniel's call — satellite mode preserves backwards-compat for older desktop installs).

## What this scope does NOT include

- Tearing down the `jnremployee.com` apex domain
- Migrating any branded URLs in marketing collateral (affiliate creators, Discord, Whop product page)
- Backend API custom domain migration (`api.jnremployee.com` → `api.liquidclips.app`) — separate sprint
- Database column renames (`junior_*` table prefixes etc.) — not user-visible
- Internal source-tree rename `junior-desktop` → `liquid-desktop` — purely cosmetic, defer

---

**Daniel's call before execution:**
- Pick the cutover window
- Decide on user comms (silent vs heads-up email)
- Decide on satellite-mode vs full-cutover (satellite keeps old domain working as a fallback for old desktop installs; full-cutover drops it but cleaner)
- Confirm OK to push the pre-baked code commits to remote (per `feedback_no_push_until_confirmed`)
