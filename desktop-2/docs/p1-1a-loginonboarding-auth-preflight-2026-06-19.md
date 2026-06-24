# P1-1A · LoginOnboarding Auth Preflight
### Pre-build audit · NO CODE CHANGES

*Date · 2026-06-19 · Author · Claude · Audit-only deliverable per Phase 1 protocol*

The purpose: before replacing the `LoginOnboarding.tsx` SimPage placeholder, inventory every auth surface across desktop-2, legacy desktop, and the FastAPI backend; produce a one-at-a-time build plan; surface every risk.

No code changes were made. No assets, no schema, no env work. Findings only.

---

## 0 · TL;DR

- **Backend is ready.** `/desktop/connect` (Clerk path) + `/auth/whop/start → callback` (Whop path) + `/sync` + `/me` are all live in `junior-backend/`. Admin allowlist runs through `JUNIOR_ADMIN_EMAILS` env var with Daniel's 4 fallback emails baked in.
- **Legacy desktop has the full pattern shipped.** Activation deep-link + Keychain storage + auth panel + 401 self-heal all exist at `desktop/src/lib/activation.ts` + `desktop/src/lib/authStorage.ts` + `desktop/src-tauri/src/auth_panel.rs` + `desktop/python-sidecar/secrets_store.py`. The Tauri 2 webview API has shifted between legacy and `desktop-2/0.8.0-shell`, so the auth-panel Rust file needs a Tauri 2 syntax pass — but the activation handshake and authStorage modules are copy-portable.
- **desktop-2 has the bridge stubs, not the flow.** `engine/sidecar-stub.ts` already reads a license JWT from `localStorage.lc.license.jwt.v1` and adds it to auth headers for HTTP calls. There's no Clerk SDK, no Whop OAuth handler, no deep-link plugin wired, no auth UI · only the JWT-bearing helper.
- **Recommended sequence:** P1-1B (Auth storage + JWT bridge) → P1-1C (Activation deep-link handler) → P1-1D (LoginOnboarding UI · signed-in state first) → P1-1E (LoginOnboarding UI · signed-out + sign-in CTAs) → P1-1F (Error/expired/rotation paths) → P1-1G (Admin/agency detection + route gating). Each is shippable on its own.
- **Hard locks honored throughout:** no new Whop bounty:create OAuth · no provider secrets in the desktop binary · no full billing system · no native reward engine. The Whop login path that ships in P1-1 is `scope=read_user` only · already in production.

---

## 1 · Current desktop-2 auth state

### 1.1 · `LoginOnboarding.tsx` · the placeholder

`desktop-2/src/design-os/routes/LoginOnboarding.tsx` (27 LOC). SimPage simulator. Renders three decorative chips (`Email · Google · Apple`) + three micro-interaction labels. Zero auth logic.

```tsx
export function LoginOnboardingRoute() {
  return (
    <SimPage
      route="home"
      world="cockpit-home"
      defaultKade="idle"
      keyPanel={{
        eyebrow: "Boot sequence",
        headline: "Sign in to the Clip Console",
        sub: "Activate your console in about sixty seconds.",
        chips: ["Email", "Google", "Apple"],
      }}
      microInteractions={[
        { label: "Sign in to start",   kade: "idle" },
        { label: "Activate",           kade: "success" },
        { label: "Sign-in failed",     kade: "error" }
      ]}
    />
  );
}
```

### 1.2 · License JWT helper · already shipped

`desktop-2/src/design-os/engine/sidecar-stub.ts:759-773` ·

```ts
const LC_JWT_KEY = "lc.license.jwt.v1";

function getLicenseJwt(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LC_JWT_KEY);
}

function authHeaders(): Record<string, string> {
  const jwt = getLicenseJwt();
  return jwt ? { authorization: `Bearer ${jwt}` } : {};
}
```

Used by every `shouldTryHttpBackend()` fetch in the sidecar (channels, schedule, social, campaigns, agency_campaigns, …). **The bearer-token plumbing is already in place.** P1-1 just needs to populate the localStorage key (or replace the storage adapter with Keychain when running in Tauri).

### 1.3 · Tauri config + deep-link plugin

`desktop-2/src-tauri/tauri.conf.json` declares the `liquidclips` deep-link scheme:

```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["liquidclips"]
    }
  }
}
```

So the activation deep-link arm of P1-1 is one plugin away from working · no new schema, no new bundle config.

### 1.4 · Documented `liquidclips://` verb table

`desktop-2/src/sections/hq/HQBridgeSection.tsx` already documents 15 deep-link verbs for marketing-site → app section routing. None of them is `liquidclips://activate?token=…&challenge=…`, which is the activation verb legacy uses. Adding it for P1-1 doesn't conflict.

### 1.5 · Settings + Account placeholder copy

`desktop-2/src/sections/settings/SettingsSection.tsx:153-155` lists `Clerk · Whop · Stripe` as "integration toggles will wire here" — pure placeholder copy. P1-1 doesn't touch this (P1-2 owns Settings).

### 1.6 · `useTier` / `useTierCaps` already exists

`desktop-2/src/design-os/state/useTierCaps.ts` is referenced from `Campaigns.tsx` (the agency-tier-gated Create CTA). It uses tier defaults from local fixtures today; P1-1 hooks it up to `/sync` data.

### 1.7 · What desktop-2 does NOT have

- No `@clerk/*` SDK imports
- No `whop-iframe` or `whop-oauth` helpers
- No `activation.ts` deep-link verifier
- No `authStorage.ts` Keychain bridge
- No Tauri Rust `auth_panel.rs` for webview-based sign-in
- No `useAuth()` / `useSession()` hook
- No 401 self-heal handler
- No sign-out flow

---

## 2 · Legacy desktop auth state (`desktop/`)

### 2.1 · Activation pattern · `lib/activation.ts` (348 LOC)

The canonical handshake. One-time challenge-nonce flow:

1. Desktop generates 24-byte nonce.
2. Desktop opens `https://liquidclips.app/connect-desktop?challenge=<nonce>` (account-app hosted).
3. Account-app handles Clerk sign-in server-side.
4. Backend mints license JWT via `POST /desktop/connect` (server-to-server, `x-internal-secret` header).
5. Account-app deep-links `liquidclips://activate?token=<jwt>&challenge=<nonce>` back to the desktop.
6. Desktop's deep-link handler verifies challenge matches, writes JWT to Keychain.
7. `/sync` refresh.

**PORTABLE to desktop-2** · copy with Tauri 2 deep-link API translation.

### 2.2 · License JWT storage · `lib/authStorage.ts` (235 LOC) + `python-sidecar/secrets_store.py` (224 LOC)

Iron Gate IG-014. macOS Keychain under `app.liquidclips.auth.v1` service namespace. In-memory session cache. Presence-file mirror (`secrets_presence.json`) to avoid Keychain ACL prompts at boot — reads existence only, never values.

Whitelisted secrets the sidecar will store: `LICENSE_JWT`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `JUNIOR_WHOP_TOKEN`, plus onboard/image-search keys. No other secrets accepted.

**PORTABLE to desktop-2** · keychain pattern + presence-file optimization transfer 1:1.

### 2.3 · Auth panel · `src-tauri/src/auth_panel.rs` (219 LOC) + `src/components/auth/AuthPanel.tsx` (155 LOC) + `useAuthPanel.ts` (41 LOC)

Native Tauri child webview hosts the actual Clerk sign-in page · React owns only the chrome strip (title + close button). Three modes: `"upgrade" · "dashboard" · "payouts"`. Esc-to-close + native `auth-panel-closed` event listener.

**PARTIAL PORT** · React component is framework-agnostic and ports clean. Rust file needs Tauri 2 webview API translation (Tauri 1 → 2 changed `WebviewBuilder` + `on_navigation` shapes).

### 2.4 · Whop iframe scaffold · `lib/whop-iframe.ts` (354 LOC)

Postmessage-based auth bridge for future web-preview builds where Whop frames Liquid Clips. Tauri is never framed by Whop, so this file is a no-op stub in production.

**DO NOT PORT.** Desktop-2 is Tauri-only · the iframe path adds zero value and confuses the surface.

### 2.5 · `/sync` + `/me` consumers · `lib/backend.ts` + `lib/useTier.ts`

`authedFetch()` wrapper handles Bearer header + 401 self-heal (sign-out + open auth panel). `useTier` hook drives tier-based UI gates everywhere. Both ship clean.

**PORTABLE to desktop-2** · same API contract, same caching model. Already half-implemented via `authHeaders()` in `sidecar-stub.ts`.

### 2.6 · What legacy has that we DON'T port

- **`@clerk/*` SDK** · never imported (legacy uses hosted Clerk in webview · no SDK in client). Same for desktop-2.
- **`whop-iframe.ts`** · Tauri-only · skip.
- **Bounty:create OAuth flow** · explicitly locked OFF per `feedback_no_goldfish_memory` + ROADMAP_LOCK Phase 6P framing.

---

## 3 · Backend auth state (`junior-backend/`)

### 3.1 · License JWT verification · `app/deps.py` + `app/jwt_signer.py`

- Ed25519 keypair. Local: auto-generated to `.junior-keys/`. Production: `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM` env vars.
- `verify_license_jwt()` decodes with EdDSA, validates `iss == settings.jwt_issuer` ("junior-backend" default), checks expiry via PyJWT.
- No audience check · validates `sub` (user_id) exists in DB instead.
- 30-day TTL default · auto-rotated by `/sync` when ≤5 days remain.
- 401 on missing bearer / expired / invalid.

### 3.2 · `current_user` dependency · `app/deps.py:28-48`

```python
def current_user(
    claims: Annotated[dict, Depends(license_claims)],
    db: Annotated[Session, Depends(get_db)],
) -> User
```

- Extracts `claims["sub"]` (user_id), looks up `User` in DB.
- 401 "license user not found" if missing.
- **Admin override:** if `is_admin_email(user.email)` → mutates `user.tier="autopilot"` + `user.founder_flag=True` **in-memory** (no DB commit; detaches with `db.expunge()`).
- Returns the User; downstream code reads elevated tier transparently.

### 3.3 · `/me` · `app/routes/me.py` · `GET` · auth required

Returns the full user record. Critical fields for LoginOnboarding:

```
backend_user_id, clerk_id, email, whop_user_id, affiliate_id,
raw_tier, raw_founder, effective_tier, effective_founder, admin_override,
subscription_status, billing_provider ('whop' | 'clerk'),
remaining_exports, account_limit, extra_accounts_purchased, clips_created,
whop_backend_key_configured
```

Note: returns BOTH raw and effective tier. desktop-2 UI should display `effective_tier`.

### 3.4 · `/desktop/connect` · `app/routes/desktop.py:59-157` · `POST` · server-to-server

Request:
```
{
  clerk_user_id: str,        # verified by account-app server-side
  challenge: str,            # echoed back so desktop can verify
  email?: str,               # self-heal if Clerk webhook delayed
  first_name?: str
}
```

Response:
```
{
  license_jwt: str,
  expires_at: datetime,
  tier: str,
  founder: bool,
  challenge: str            # echo
}
```

Guard: `x-internal-secret` header (matches `INTERNAL_API_SECRET` env var). Empty in dev = allow. **Only account-app holds this secret.** Desktop never calls `/desktop/connect` directly.

Side effects: creates User if missing (webhook-delay self-heal); applies admin override before issuing JWT; emits "activated on new machine" email on first license; posts `desktop_activated` to PostHog.

### 3.5 · `/sync` · `app/routes/sync.py` · `GET` · auth required

Returns:
```
{
  tier, founder, subscription_status, paid_until,
  billing_provider, features: {flat dict},
  new_license_jwt?: str,     # rotated when ≤5d remaining
  remaining_exports, admin_override: bool
}
```

Auto-rotate rule: if latest License `expires_at <= now + 5 days`, mint a new JWT, store License row, return as `new_license_jwt`. Desktop swaps its in-keychain token transparently.

### 3.6 · Admin allowlist · `app/features.py:183-207`

```python
_FALLBACK_ADMIN_EMAILS = (
    "danieldiyepriye@gmail.com",
    "mrddokubo@gmail.com",
    "crazycatjackkids@gmail.com",
    "thedoks2019@gmail.com",
)
ADMIN_EMAILS = _load_admin_emails()  # JUNIOR_ADMIN_EMAILS env var or fallback
```

`is_admin_email(email)` → bool · case-insensitive · whitespace-trimmed.

**Agency-vs-clipper distinction in v1:** purely via `user.tier`. There's no separate "agency" allowlist. `is_admin_email` returns True → tier becomes `"autopilot"` (which is the v2 "Agency" alias) → all agency surfaces unlock.

This is why P1-7 (Agency tier provisioning · 0.5d) is essentially "add the new agency email to `JUNIOR_ADMIN_EMAILS` env var on Railway · redeploy."

### 3.7 · Whop OAuth · `app/routes/auth_whop.py`

Sign-in-with-Whop flow (NOT bounty:create):

1. Desktop → `GET /auth/whop/start?challenge=<x>`
2. Backend 302s to `https://api.whop.com/oauth/authorize` · `client_id` · `redirect_uri` · **`scope=read_user`** · `state=challenge`
3. User authorizes on Whop.
4. Whop 302s to `GET /auth/whop/callback?code=<c>&state=<x>`
5. Backend exchanges code for access token, fetches `/api/v5/me`, looks up User by `whop_user_id` (email fallback).
6. If no LC account: 302 → `connect-desktop?whop_nomembership=1`.
7. Else: mint license JWT, store License row, deep-link `liquidclips://activate?token=<jwt>&challenge=<x>`.

**`scope=read_user` is the only scope requested.** No `bounty:create` is wired. The lock is honored.

Env vars: `WHOP_OAUTH_CLIENT_ID`, `WHOP_OAUTH_CLIENT_SECRET`, `WHOP_OAUTH_REDIRECT_URI` (default `https://api.liquidclips.app/auth/whop/callback`).

### 3.8 · Webhooks (background, not part of LoginOnboarding flow)

- Clerk webhook (`/webhooks/clerk`) handles `user.created`, `user.updated`, `subscription.*` — idempotent via `WebhookEvent.external_id`.
- Whop webhook (`/webhooks/whop`) handles `membership_went_valid`, `membership_canceled`, `payment_*` — idempotent.

These run server-side independent of the desktop's auth state. **LoginOnboarding doesn't need to know about them.**

### 3.9 · Required env vars (auth-relevant only)

| Var | Purpose | Already set on prod? |
|---|---|---|
| `JWT_PRIVATE_PEM` / `JWT_PUBLIC_PEM` | Ed25519 signing keys | ✓ |
| `JWT_ISSUER` | Issuer claim | ✓ (default OK) |
| `JWT_TTL_DAYS` | License TTL | ✓ (30 default OK) |
| `CLERK_SECRET_KEY` | Clerk Backend API (metadata sync) | ✓ |
| `CLERK_WEBHOOK_SECRET` | svix sig verification | ✓ |
| `WHOP_OAUTH_CLIENT_ID` | Whop OAuth app | ✓ |
| `WHOP_OAUTH_CLIENT_SECRET` | Whop OAuth app | ✓ |
| `WHOP_OAUTH_REDIRECT_URI` | Callback URL | ✓ |
| `WHOP_API_KEY` | App API key (App API surface) | ✓ |
| `JUNIOR_ADMIN_EMAILS` | Admin/agency allowlist | ✓ |
| `INTERNAL_API_SECRET` | Account-app → backend shared secret | ✓ |
| `RESEND_API_KEY` / `RESEND_FROM` | Activation email | ✓ |

**No new env vars required for P1-1.**

---

## 4 · Required beta LoginOnboarding UX

### 4.1 · Minimum beta flow (locked scope)

```
┌─────────────────────────────────────────────────────────────────┐
│  App boot                                                       │
│   │                                                             │
│   └─► authStorage.read() → JWT?                                 │
│         │                                                       │
│         ├─► YES · token present and not expired                │
│         │     │                                                 │
│         │     └─► GET /sync (Bearer JWT)                        │
│         │         │                                             │
│         │         ├─► 200 → cache effective_tier · enter app  │
│         │         │         (route post-sign-in landing)        │
│         │         │                                             │
│         │         ├─► 200 + new_license_jwt → write Keychain  │
│         │         │         → cache → enter app                 │
│         │         │                                             │
│         │         └─► 401 → clear JWT · show signed-out state │
│         │                                                       │
│         └─► NO · no token                                       │
│               │                                                 │
│               └─► show signed-out state                         │
│                                                                 │
│  Signed-out state (LoginOnboarding)                            │
│   │                                                             │
│   ├─► CTA: "Sign in with email"                                │
│   │     │                                                       │
│   │     └─► generate challenge nonce                            │
│   │         open auth_panel webview at:                         │
│   │         https://liquidclips.app/connect-desktop?challenge=… │
│   │         wait for liquidclips://activate?token=…&challenge= │
│   │         verify challenge match · write Keychain · refresh  │
│   │                                                             │
│   ├─► CTA: "Sign in with Whop"                                 │
│   │     │                                                       │
│   │     └─► generate challenge nonce                            │
│   │         open auth_panel webview at:                         │
│   │         https://api.liquidclips.app/auth/whop/start?       │
│   │           challenge=…                                       │
│   │         wait for same liquidclips://activate verb           │
│   │                                                             │
│   └─► Loading / error / "no membership" states inline           │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 · Signed-in state surface (compact, lands in CommandRoom header)

- Avatar / initials chip
- Effective tier label · "FREE" / "SOLO" / "PRO" / "AGENCY" / "ADMIN" (admin-override visible)
- "Sign out" affordance (Settings · P1-2 owns the full panel)

### 4.3 · Hard rules honored

- ✓ No `bounty:create` OAuth
- ✓ No new Whop reward permissions
- ✓ No provider secrets in the desktop binary (`scope=read_user` Whop OAuth uses backend-held secrets only)
- ✓ No full billing system (Settings P1-2 owns "manage subscription" CTA · routes externally)
- ✓ No native reward engine
- ✓ Whop sign-in path uses the existing `read_user` scope only

### 4.4 · Optional polish (deferred to P1-1G or later)

- Apple sign-in (Clerk supports it; gated by enabling the provider in Clerk dashboard)
- Google sign-in (same)
- Magic-link email-only flow (Clerk hosts this — no desktop change needed)
- Account-switching (multi-tenant on one machine) — post-beta

---

## 5 · Risk list

### 5.1 · Where auth could break beta

| Risk | Severity | Mitigation |
|---|---|---|
| Tauri 2 deep-link plugin syntax differs from Tauri 1 in legacy | Med | Port `activation.ts` first as P1-1C · verify the `onOpenUrl` handler fires before wiring UI |
| Account-app's `/connect-desktop` page is unreachable in dev (no Vercel preview deploy) | Med | Use the **Whop OAuth path** in dev (it returns to backend, not account-app) |
| `INTERNAL_API_SECRET` mismatch between account-app + backend | Hi | Check both Vercel + Railway env vars match BEFORE P1-1C ships · easy 5-min check |
| Keychain ACL prompts fire at boot (not at sign-in) | Med | Port the presence-file optimization · ship in P1-1B |
| 401 self-heal creates infinite sign-in loop if `/sync` fails for non-auth reasons | Hi | Honor legacy's "auth-storm dampener" rule: one 401-clear per app session max |
| `liquidclips://activate` verb collides with HQ bridge verbs | Low | HQ bridge uses `?section=…` · activation uses `?token=…&challenge=…` · namespaces don't overlap |
| Admin-override mutates `user.tier` in memory but `/sync` returns the ORIGINAL DB tier in `raw_tier` | Low | UI reads `effective_tier` only · already correct in design |
| Clerk session cookie from a different desktop install leaks into the auth_panel webview | Med | Use a fresh Tauri 2 webview per session · clear cookies between sign-in attempts |
| Desktop ships before Whop OAuth env vars are confirmed on Railway | Hi | P1-1A · §3.9 checklist must pass before P1-1B starts |

### 5.2 · What must stay mocked at v1

- **`/proxy/llm`** · scaffolded only · gated behind hosted compute (sprint #14b · post-beta)
- **`/leaderboard/earnings`** · scaffold exists · returns mocks until cache columns ship
- **Sub-accounts + white-label** · feature flags exist but UI not gated (post-beta)
- **Hosted transcription** · gated on `MODAL_TRANSCRIBE_URL` / `REPLICATE_API_TOKEN` env vars (not set)

None of these blocks LoginOnboarding. They live in tier-feature-flag flows downstream.

### 5.3 · What requires Daniel / admin setup

- Confirm `INTERNAL_API_SECRET` matches across Vercel (account-app) + Railway (junior-backend)
- Confirm `WHOP_OAUTH_REDIRECT_URI` env var is set on Railway and matches Whop developer dashboard
- Confirm new beta-agency emails are added to `JUNIOR_ADMIN_EMAILS` env var (this IS P1-7)
- Confirm desktop-2 bundle's `tauri.conf.json` has `liquidclips` scheme registered in the prod build (it does · §1.3)
- One Clerk sanity check: production Clerk instance is live + the `/connect-desktop` route on account-app is deployed

---

## 6 · Recommended P1-1 build plan (one-at-a-time)

Each sub-phase is independently shippable + verifiable in isolation. Stop-and-report between each, per Phase 1 protocol.

### **P1-1B · Auth storage + JWT bridge** (1d)

**Goal:** the Bearer header path becomes Keychain-backed in Tauri + localStorage-backed in browser preview. Boot loads JWT, primes the auth headers, ready for `/sync`.

**Files to add (~250 LOC total):**
- `desktop-2/src/lib/authStorage.ts` · port from legacy · adapter pattern: localStorage in browser preview, Keychain via sidecar RPC when in Tauri
- `desktop-2/src/lib/backend.ts` · thin `authedFetch()` wrapper + 401 self-heal stub (just a callback hook · actual sign-out wire happens in P1-1D)
- `desktop-2/src/design-os/state/useAuth.ts` · `{ jwt, userId, status: "unknown" | "signed-out" | "signed-in" }` Zustand or React store · reads from authStorage at boot

**Files to extend:**
- `desktop-2/src/design-os/engine/sidecar-stub.ts` · swap `getLicenseJwt()` to call `authStorage.read()` instead of direct localStorage · keep contract the same so all existing call sites work

**No backend, no UI changes.**

**Verification:**
- `npx tsc --noEmit`
- Paste a real JWT into `localStorage.lc.license.jwt.v1`, reload, confirm `/sync` returns 200 in the network tab
- Confirm `authStorage.read()` returns the same JWT
- Boot the app · `useAuth().status` flips from `"unknown"` → `"signed-in"` within ~200ms

### **P1-1C · Activation deep-link handler** (1d)

**Goal:** wire the `liquidclips://activate?token=…&challenge=…` verb. Desktop receives it, verifies challenge, writes JWT to storage, fires the `useAuth` state transition.

**Files to add (~200 LOC):**
- `desktop-2/src/lib/activation.ts` · port from legacy · generate challenge nonce, persist while open, verify on deep-link, write JWT, clear nonce
- `desktop-2/src/lib/deeplink.ts` · register Tauri 2 `onOpenUrl` listener (or use `@tauri-apps/plugin-deep-link`'s React hook) · dispatch to activation handler when verb matches `liquidclips://activate`

**Files to extend:**
- `desktop-2/src-tauri/Cargo.toml` · already has `tauri-plugin-deep-link` per tauri.conf.json plugin block · no change

**No backend, no UI changes.**

**Verification:**
- `npx tsc --noEmit`
- Manually fire `liquidclips://activate?token=<a real prod JWT>&challenge=<the in-memory nonce>` · confirm JWT lands in storage
- Challenge mismatch path · `liquidclips://activate?token=…&challenge=wrong` · UI does nothing · log "activation: challenge mismatch"

### **P1-1D · LoginOnboarding UI · signed-in state first** (0.5d)

**Goal:** replace SimPage. Render the signed-in state when `useAuth().status === "signed-in"` · show effective tier + sign-out CTA. Signed-out state stays a placeholder ("Sign-in flow lands in P1-1E").

**Files to add (~150 LOC):**
- Rewrite `desktop-2/src/design-os/routes/LoginOnboarding.tsx` · drop SimPage import · render signed-in surface using `useAuth()` + `/me` data
- Tiny CSS in `LoginOnboarding.css`

**No backend, no deep-link work.**

**Verification:**
- `npx tsc --noEmit`
- With JWT pasted: route renders "Signed in as `<email>` · Tier: `<effective_tier>`" + "Sign out" button
- Without JWT: renders "Sign in flow lands in P1-1E" placeholder card
- Sign-out button: clears `authStorage` + flips `useAuth().status` to `"signed-out"`

### **P1-1E · LoginOnboarding UI · signed-out + sign-in CTAs** (1.5d)

**Goal:** wire the two co-equal sign-in CTAs (Email/Clerk + Whop). Each generates a challenge, opens the auth flow (system browser in browser preview; in-app webview when desktop-2 has the panel · which is later).

**Files to add (~300 LOC):**
- `desktop-2/src/design-os/auth/SignInPanel.tsx` (or co-located in LoginOnboarding.tsx) · two-button layout · honest copy
- Browser opens via `openSmart()` from `lib/openSmart.ts` (already exists) · no new auth_panel webview yet

**Verification:**
- `npx tsc --noEmit`
- Email CTA → opens `https://liquidclips.app/connect-desktop?challenge=<nonce>` in system browser
- Whop CTA → opens `https://api.liquidclips.app/auth/whop/start?challenge=<nonce>` in system browser
- On return via deep-link · activation handler from P1-1C lands JWT · route flips to signed-in state

### **P1-1F · Error / expired / rotation paths** (0.5d)

**Goal:** every loading + failure state has an honest copy. 401 from `/sync` shows "Session expired · sign in again." Rotation transparently swaps the JWT without bounce.

**Files to extend:**
- `desktop-2/src/lib/backend.ts` · `authedFetch` 401 handler clears storage + flips `useAuth().status` to `"signed-out"` (one-time per session per the dampener rule)
- `desktop-2/src/design-os/state/useAuth.ts` · handle `new_license_jwt` from `/sync` · swap silently
- `LoginOnboarding.tsx` · add error / loading copy

**Verification:**
- `npx tsc --noEmit`
- Manually expire JWT via small `JWT_TTL_DAYS` override in dev · `/sync` returns 401 · UI flips to signed-out
- Within-5-day rotation: paste a JWT that's 28 days old · `/sync` returns 200 + `new_license_jwt` · authStorage rewrites · no flicker

### **P1-1G · Admin / agency detection + route gating** (0.5d)

**Goal:** `useAuth().effectiveTier === "agency"` (or admin-override) unlocks the Campaigns route's floating "Create campaign" CTA + Settings → Admin sub-tab. `useTierCaps()` already exists · this just wires data into it.

**Files to extend:**
- `desktop-2/src/design-os/state/useTierCaps.ts` · read from `useAuth()` instead of fixture
- No new route gates · existing `tier.tier === "agency"` checks in `Campaigns.tsx` keep working

**Verification:**
- `npx tsc --noEmit`
- With one of Daniel's emails: `effective_tier === "autopilot"` → `useTierCaps().tier === "agency"` → "Create campaign" CTA visible
- With a non-admin email: `effective_tier === "free"` → CTA hidden

### **P1-1 total · ~4–5 days end-to-end**

The legacy auth-panel native webview (P1-1H · ~1d) is **post-Phase-1** unless beta agencies need the in-app sign-in feel. System-browser sign-in is functional for v1 beta · the in-app panel is polish.

---

## 7 · Phase 1 dependency map (post-P1-1A)

```
P1-1A   audit (THIS DOC)
  │
  ▼
P1-1B   authStorage + JWT bridge          (1d)
  │
  ▼
P1-1C   activation deep-link handler      (1d)
  │
  ▼
P1-1D   signed-in UI                       (0.5d)
  │
  ▼
P1-1E   signed-out UI + sign-in CTAs       (1.5d)
  │
  ▼
P1-1F   error / expired / rotation         (0.5d)
  │
  ▼
P1-1G   admin / agency detection           (0.5d)
  ────────────────────────────────────────
P1-1    Total                              ~5d

P1-1 unblocks → P1-2 Settings (account info reads useAuth)
P1-1 unblocks → P1-7 Agency tier provisioning (env-var only)
```

**P1-1B + P1-1C have NO Phase 1 dependencies upstream.** They can start as soon as Daniel approves.

---

## 8 · Blockers + open questions

### 8.1 · Confirmed blockers (must resolve before P1-1B starts)

| Blocker | Status | Owner |
|---|---|---|
| `INTERNAL_API_SECRET` matches across Vercel + Railway | Unknown · must verify | Daniel (one-line `vercel env ls` + `railway variables`) |
| `WHOP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` set on Railway | Probably yes (legacy uses) · must confirm | Daniel |
| `JUNIOR_ADMIN_EMAILS` includes desktop-2 beta agencies | Currently 4 emails in fallback | Daniel (Railway env var update) |
| Account-app's `/connect-desktop` route is reachable from prod | Yes (legacy uses) · spot-check | Daniel |

### 8.2 · Open questions for the build phase (NOT blocking the audit)

- Does desktop-2's `0.8.0-shell` Tauri config include `tauri-plugin-deep-link` in `Cargo.toml`? (probably yes per `tauri.conf.json`, but verify in P1-1C)
- Should sign-in CTAs default to Email/Clerk or Whop? Recommend Email first (more familiar to beta agencies)
- Should the signed-in CommandRoom header show the avatar or just the email? Recommend email + tier pill in v1 · avatar in P1-2 Settings polish
- Should "Sign out" warn before clearing? Recommend a confirm toast (1 sec dismissable) · prevents accidental session loss
- When the Whop OAuth path returns `?whop_nomembership=1`, what does the desktop show? Recommend "We couldn't find a Whop membership for this account · try Email sign-in or join via [link]"

### 8.3 · Out of scope (DO NOT include in P1-1)

- ❌ Bounty:create OAuth (Phase 6N-F or later · locked deferred)
- ❌ Sub-account UI (post-beta)
- ❌ Multi-tenant on one machine (post-beta)
- ❌ Native Apple / Google sign-in via @clerk/* SDK (Clerk hosted page covers it)
- ❌ Full billing management (P1-2 Settings owns "Manage subscription" external link)
- ❌ Auth panel native webview (post-Phase-1 polish · system browser is functional)

---

## 9 · Verification plan (for the build phase · not now)

When P1-1B through P1-1G ship, each phase verifies via:

- `npx tsc --noEmit` clean
- Manual happy path matching the §6 description
- Manual signed-out path (no JWT)
- Manual expired-token path (manually expire JWT in dev)
- Manual rotation path (paste a 28-day-old JWT · verify `new_license_jwt` swap)
- Manual admin / agency path (sign in with one of Daniel's emails · verify tier upgrade)
- Manual clipper path (sign in with a non-admin email · verify default `free` tier)

`__lcRunLeakTest()` and Apple-notarised installer checks are post-P1-1G concerns.

---

## 10 · TL;DR for the build queue

- **Audit complete.** Backend is ready (no env vars to add). Legacy desktop pattern ports 70% directly · 30% needs Tauri 2 syntax pass.
- **6 sub-phases · ~5 days · stop-and-report between each.**
- **No new OAuth, no new bounty scope, no new secrets in client, no billing build, no native reward engine.** Hard rules honored.
- **Recommended start: P1-1B (authStorage + JWT bridge · 1d).** No upstream Phase 1 dependencies. Smallest unit · validates the bridge before we wire the deep-link.
- **One Daniel-action before P1-1B starts:** confirm `INTERNAL_API_SECRET` + Whop OAuth env vars + admin allowlist are correct on Railway.

---

*Audit complete · no code · no env changes · awaiting Daniel approval to start P1-1B.*
