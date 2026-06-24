# Whop OAuth Scope Audit · pre-6N-E

Read-only audit. No build. Confirms what Whop auth surfaces already exist across legacy desktop, new desktop-2 shell, and the backend, what scopes those surfaces hold, and whether the existing path can support agency-owned reward creation.

---

## Headline

**Whop OAuth IS already wired — in two separate places, for two non-bounty-create purposes.** Neither holds the `bounty:create` scope. Reusing the existing path for agency reward creation is **not safe today** because the OAuth scope was never requested and the token is either discarded after `/me` (backend) or scoped read-only against `publicBounties` (legacy desktop).

The good news: **the OAuth infrastructure is solid and battle-tested**. Loopback PKCE listener works, the redirect-URI allowlist is configured on Whop's side, the keychain bridge is in place. Adding a separate Whop OAuth flow for **agency mode** with `bounty:create` scope is a config + scope-string change, not a from-scratch build.

---

## Old vs new shell state

| State | Legacy desktop (`/Users/dipdip/code/jnr/desktop/`) | New shell (`/Users/dipdip/code/jnr/desktop-2/`) |
| --- | --- | --- |
| Whop OAuth client code | ✓ in `python-sidecar/whop_client.py` (623 LOC, full PKCE flow) | ✗ no client of its own |
| Whop login-as-desktop-activation flow | ✓ relies on backend `/auth/whop/start` + `/auth/whop/callback` | ✗ not yet wired |
| `bus.emit("browse:open", { mirror: "whop" })` | n/a (legacy uses native Tauri webview) | ✓ shipped in 6L-B; default subscriber tries `openSmart` → `window.open` → toast |
| Whop chat handoff | ✓ in-app webview (`BrowseRewardsPanel.tsx`) | ⚠ falls back to system browser via `browse:open` |
| Whop bounty browsing | ✓ via `whop_client.list_bounties()` → backend `/whop/bounties` proxy | ✓ not yet rendered but the backend proxy is reachable through the existing real-RPC → HTTP → mock pattern |

The new shell **does not have its own Whop OAuth client yet**. Browse:open routes the user to Whop in their default browser; no token returns to Liquid Clips. So for the new desktop-2 shell, any "agency creates reward in-app" path needs to either reuse the legacy sidecar's PKCE flow (if it gets ported into desktop-2) or build a fresh OAuth handshake.

---

## Existing files found

| File | Purpose | Auth direction |
| --- | --- | --- |
| `junior-backend/app/routes/auth_whop.py` (180 LOC) | "Continue with Whop" sign-in flow for desktop activation. Maps a Whop user → local user → license JWT. | User OAuth code → access_token (server-side exchange · client_secret held by backend) |
| `desktop/python-sidecar/whop_client.py` (623 LOC) | Per-user Whop OAuth via loopback PKCE listener on port 8765. Stores token in keychain (`JUNIOR_WHOP_TOKEN`). Reserved for future user-specific actions. | User OAuth code → access_token (PKCE, no client_secret) |
| `junior-backend/app/routes/whop.py` (470 LOC) | Server-side App API Key proxy for `publicBounty` GraphQL reads. | App API Key (Whop's `whop_api_key` env var · NOT user OAuth) |
| `junior-backend/app/routes/webhooks_whop.py` (743 LOC) | HMAC-verified webhooks for `membership_went_valid` / `membership_went_invalid` / `payment_succeeded` etc. | Webhook secret (incoming · not outbound auth) |
| `junior-backend/app/config.py` | Holds `whop_api_key` · `whop_app_id` · `whop_oauth_client_id` · `whop_oauth_client_secret` · `whop_oauth_redirect_uri` | Config only |
| `desktop/src/lib/sidecar.ts:1038-1047` | Tauri RPC bridge exposing `whop_oauth_start` / `whop_oauth_status` / `whop_oauth_cancel` / `whop_set_session_token` to the legacy desktop UI | Bridge only |

---

## Auth flow summary

### Flow A · "Continue with Whop" desktop activation (`junior-backend/app/routes/auth_whop.py`)

```
Desktop opens account.jnremployee.com/connect-desktop?challenge=<x>
  ↓
User clicks "Continue with Whop"
  ↓
GET https://api.liquidclips.app/auth/whop/start?challenge=<x>
  ↓ 302
https://api.whop.com/oauth/authorize?
  client_id=<settings.whop_oauth_client_id || settings.whop_app_id>
  redirect_uri=<settings.whop_oauth_redirect_uri>
  response_type=code
  scope=read_user                ← MINIMUM identification scope ONLY
  state=<challenge>
  ↓ user authorizes
GET https://api.liquidclips.app/auth/whop/callback?code=<c>&state=<challenge>
  ↓
POST https://api.whop.com/oauth/token
  grant_type=authorization_code
  client_id=<…>
  client_secret=<settings.whop_oauth_client_secret>   ← backend holds it
  code=<c>
  redirect_uri=<…>
  ↓ access_token in response
GET https://api.whop.com/api/v5/me  with  Authorization: Bearer <access_token>
  ↓ { id, email, ... }
[backend uses { id, email } to look up Liquid Clips User]
[access_token is DISCARDED · NEVER stored in DB]
  ↓
[backend mints local license JWT]
  ↓ 302
liquidclips://activate?token=<jwt>&challenge=<challenge>
```

**Scope used:** `read_user` only (per `auth_whop.py:74` · "Minimum scope to identify the user. Membership lookup happens server-to-server via the App API Key, not the user token.").

**Token lifetime:** ephemeral · discarded after the `/me` lookup. No backend column stores the Whop access_token.

### Flow B · Per-user PKCE OAuth in the legacy desktop (`whop_client.py:276-538`)

```
desktop UI → sidecar.whopOAuthStart()  (RPC)
  ↓
sidecar generates PKCE verifier + state
  ↓
sidecar binds loopback HTTP listener at http://localhost:8765/auth/whop/callback
  ↓ returns authorize_url
desktop UI opens authorize_url in default browser via Tauri shell plugin
  ↓
https://api.whop.com/oauth/authorize?
  response_type=code
  client_id=<WHOP_APP_ID_DEFAULT || env override>
  redirect_uri=http://localhost:8765/auth/whop/callback
  scope=openid profile email      ← OPENID + IDENTITY scopes ONLY
  state=<random>
  nonce=<random>
  code_challenge=<sha256(verifier)>
  code_challenge_method=S256
  ↓ user authorizes
http://localhost:8765/auth/whop/callback?code=<c>&state=<state>
  ↓ loopback listener receives
POST https://api.whop.com/oauth/token
  grant_type=authorization_code
  client_id=<app_id>
  redirect_uri=<…>
  code=<c>
  code_verifier=<verifier>           ← PKCE proves same client
  ↓ access_token in response
sidecar stashes token:
  - in-memory `_SESSION_TOKEN`
  - keychain entry `JUNIOR_WHOP_TOKEN`
  ↓
desktop UI continues with bounty browsing
```

**Scope used:** `openid profile email` (per `whop_client.py:528`). Standard OIDC identity scopes. Reserved for "future user-specific actions" (per the docstring · `whop_client.py:13-16`).

**Token lifetime:** persisted in keychain.

**Currently used for:** **nothing in production.** The docstring explicitly notes: *"If you find yourself adding a Whop-token gate before calling list_bounties / get_bounty / get_submission again, stop: that's wrong, the backend proxy already authenticates with the license JWT."* So the flow exists but is dormant.

### Flow C · App API Key (server-side)

```
Backend reads settings.whop_api_key (Railway env var)
  ↓
POST https://api.whop.com/public-graphql
  Authorization: Bearer <whop_api_key>
  query: publicBounties / publicBounty(id:) / publicBountySubmission(id:)
```

**Scope:** whatever the Whop App API Key carries — confirmed in `whop_client.py:7-11` to cover the `publicBounty*` GraphQL surface only. **Cannot read private discussion-post markdown. Cannot create bounties.**

---

## Scopes available across all three flows

| Surface | Token type | Scope | Source-of-truth file |
| --- | --- | --- | --- |
| Flow A (login) | User OAuth access_token (discarded) | `read_user` | `auth_whop.py:74` |
| Flow B (PKCE in legacy desktop) | User OAuth access_token (keychain) | `openid profile email` | `whop_client.py:528` |
| Flow C (server-side App API Key) | App API Key | Whatever Whop's App API Key grants · empirically: `publicBounty*` read · not user-OAuth scopes | `whop.py:87-117` · comment at `whop.py:121-131` |

**No flow today requests `bounty:create`, `bounty:read`, or any scope beyond identity.** All three were designed pre-Workforce-Bounty-REST-API and never updated.

---

## Bounty API capability table

| Whop endpoint | Required scope | Flow A reuse? | Flow B reuse? | Flow C reuse? |
| --- | --- | --- | --- | --- |
| `GET /whop/bounties` (legacy `publicBounty` GraphQL list) | App API Key | n/a · token discarded | ✗ wrong scope · would 401 | ✓ already in production |
| `GET /whop/bounties/{id}` (legacy GraphQL detail) | App API Key | n/a | ✗ | ✓ in production |
| `GET /api/v1/bounties/{id}` (new REST · "authenticated user") | `bounty:create` or higher | ✗ wrong scope | ✗ wrong scope | ✗ App API Key lacks user scope |
| `POST /api/v1/bounties` (new REST · create) | `bounty:create` | ✗ wrong scope · token discarded anyway | ✗ wrong scope | ✗ App API Key cannot front-pay a bounty pool on the agency's behalf · per Whop spec the requester must be the funding user/company owner |

**Bottom line · none of the three existing flows can call `POST /api/v1/bounties` today.** The infrastructure exists; only the scope was never asked for.

---

## Does existing community handoff prove OAuth?

**No.** It proves **URL opening**, not OAuth.

- New shell (`desktop-2`): `bus.emit("browse:open", { mirror: "whop", url })` → default subscriber opens the URL in the user's default browser via Tauri shell plugin (or `window.open` in dev preview) and emits a toast. **No token returns.** No OAuth handshake. The user reads/writes inside Whop's own session in the browser; Liquid Clips never sees their token.
- Legacy shell (`desktop`): same browse-overlay behaviour; the iframe + `whop_set_session_token` RPC at `whop_client.py:60-65` was designed for the case where Liquid Clips runs INSIDE a Whop community iframe (production embed) — the parent Whop window forwards a session token down via postMessage. That's an iframe-postMessage capture, not OAuth. And it's noted in the docstring as "the production auth path for clippers using Junior inside Whop's community iframe" — so it works specifically when Liquid Clips is mounted in a Whop iframe, not when Liquid Clips opens Whop in a browser tab.

---

## Can agency-owned reward creation safely reuse the existing Whop auth path?

**No · for two reasons:**

1. **Scope.** No existing flow holds `bounty:create`. The OAuth authorize URL would have to be rebuilt with `scope=bounty:create` (plus likely `openid profile` for identity bookkeeping). Whop's developer console also has to approve the scope on the app's allowlist before the token endpoint will return it.

2. **Token persistence.** Flow A discards the user access_token after `/me`. Flow B persists it in the keychain but with the wrong scope (`openid profile email`). To call `POST /api/v1/bounties` later, Liquid Clips needs to **store a bounty-scoped user OAuth token per agency user** so the backend can call Whop on the agency's behalf at campaign-create time. That means a new column on the User table (or a new sibling table — recommend the latter for audit + multi-account-per-user · same shape as the v2 dormant `ExternalCredential` model we already added in 6N-D-1 with the v2 marker).

The good news is that the **mechanics already exist**:
- The PKCE listener at port 8765 (legacy) works
- The redirect URI allowlist on Whop is configured
- The OAuth endpoints are constants in the codebase
- The Whop app id + secret are env-var driven

Adding a third flow ("Continue with Whop · agency mode · `bounty:create`") is **incremental**, not a rebuild.

---

## What scope is missing?

| Scope | Used for | Currently held? |
| --- | --- | --- |
| `read_user` | identifying user | ✓ Flow A |
| `openid profile email` | identifying user | ✓ Flow B |
| `bounty:create` | `POST /api/v1/bounties` + `GET /api/v1/bounties/{id}` for workforce bounties | **✗ MISSING** |

The Whop REST docs you pasted specify `bountyAuth: bearerAuth: ['bounty:create']` for both `POST /api/v1/bounties` and `GET /api/v1/bounties/{id}`. So `bounty:create` is the **single missing scope** for the in-app agency reward creation path (Sub-option B.2 from the prior pre-6N-E review).

What you do **not** need:
- A new Whop app registration (the existing app id `app_hLphExdFzjEQsM` can declare additional scopes in Whop's developer console)
- A new redirect-URI allowlist entry (the existing `https://api.liquidclips.app/auth/whop/callback` works for the server-side flow)
- A new client_id/client_secret pair (the existing env vars carry over)
- A new auth library (PKCE works for the desktop-loopback flow; server-side code-grant works for the backend flow · both are in production)

---

## Recommendation for 6N-E

**Stay with the v1 deeplink path (Sub-option B.1) for the first ship.** Defer in-app bounty creation (Sub-option B.2) to a small follow-up step that does the scope-add work in isolation — that gives us a clean validation cycle for the Whop dashboard scope-approval step independent of the campaign-creation flow.

### v1 (now)

Inside the agency creation flow's "Connect Whop reward" step:

- **Option A** — agency pastes URL/ID → backend `POST /agency/whop/validate-reward` → existing `publicBounty` GraphQL via App API Key (Flow C) returns a normalized snapshot. **Works today.** No new scope, no new auth.
- **Option B.1** — agency clicks "Create reward in Whop" → `bus.emit("browse:open", { url: WHOP_CREATE_REWARD_URL, mirror: "whop" })` opens `whop.com/dashboard/.../create-bounty` in the user's browser. Agency completes funding in their own Whop session. Returns to Liquid Clips. Pastes the URL/ID. Flow falls into Option A.
- **Option B.2** — **skip in v1.** Mark in the agency creation flow's "Create reward in Whop" step as "Coming soon: we'll create it for you when you connect your Whop account."

This matches the brief's stated Option A and Option B, doesn't ship a half-built scope flow, and has zero new auth code on the critical path.

### v1.5 (next step after 6N-E ships)

A small phase whose only goal is closing the scope gap:

1. **Whop developer console** — add `bounty:create` to the existing app's allowed scopes. Approval flow on Whop's side.
2. **Backend route** — `GET /auth/whop/agency-start` and `GET /auth/whop/agency-callback`. Sibling to the existing `/auth/whop/start` + `/auth/whop/callback`, but requesting `scope=bounty:create openid profile`. Tokens are stored in a new `WhopAgencyCredential` table (same shape as the v2-dormant `ExternalCredential` row, but for Whop instead of Drive/Dropbox).
3. **Backend route** — `POST /agency/whop/create-reward`. Backend calls `POST https://api.whop.com/api/v1/bounties` with the stored agency token. Returns the newly-minted `bnty_*` id straight into the agency creation flow.
4. **Frontend** — replace the "Coming soon" stub in the agency creation flow's "Create reward in Whop" step with a real "Connect Whop · create here" CTA that fires the new auth flow.

Estimated size: ~1 day of work end-to-end. **Not required for 6N-E v1.** Recommend tracking as a follow-up after the brief-link + validate-reward + campaign-page-shell rendering all settle in production.

---

## Risks called out

- **Token storage.** When Sub-option B.2 lands, Whop user-OAuth tokens become a new sensitive material class on the backend. The v2-dormant `ExternalCredential` + `credentials_crypto.py` Fernet wrapper we already shipped in 6N-D-1 is the right tool. **Do not store Whop tokens in plaintext.**
- **Scope drift.** Whop may rename `bounty:create` between the time we ask for it on Whop's developer console and the time we ship. The agency-start endpoint should read the scope string from `settings.whop_agency_oauth_scope` so a rename is one env-var update.
- **Agency identity vs clipper identity.** Today every user is a clipper. Adding agency-mode OAuth implies a User row can be both a clipper and an agency. The existing `is_admin_email` gate currently doubles as the agency gate. Real `agency_members` table lands when we genuinely have non-admin agencies onboarding — but the OAuth flow doesn't block on it.
- **PKCE vs server-side code grant.** Flow A is server-side (backend holds client_secret). Flow B is PKCE (desktop · no client_secret). The new agency flow should be **server-side** because the backend needs the token to call Whop later on the agency's behalf. Don't accidentally use PKCE here — PKCE returns the token to the desktop client which then has to ship it back to the backend.

---

## Files referenced (paste-back URLs)

| File | LOC | Section |
| --- | --- | --- |
| `junior-backend/app/routes/auth_whop.py` | 180 | full file |
| `junior-backend/app/routes/whop.py` | 470 | esp. `121-131` (App API Key limits) |
| `junior-backend/app/routes/webhooks_whop.py` | 743 | event taxonomy |
| `junior-backend/app/config.py` | n/a | env-var declarations · lines 30, 32, 50-55 |
| `desktop/python-sidecar/whop_client.py` | 623 | esp. `276-538` (PKCE flow) |
| `desktop/src/lib/sidecar.ts` | n/a | lines 1038-1047 (Tauri RPC bridge) |

---

## Headline answer to "is OAuth wired"

**Yes — twice — but for the wrong scopes.** Reusing the existing path "as is" for agency reward creation is not safe. Adding `bounty:create` is incremental on top of solid existing infra. Recommend shipping 6N-E v1 on the deeplink path, then closing the scope gap in v1.5.

No code until this is approved.
