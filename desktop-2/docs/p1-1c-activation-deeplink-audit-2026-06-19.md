# P1-1C · Activation + Deep-Link Entry Audit
### Pre-build investigation · NO CODE CHANGES

*Date · 2026-06-19 · Author · Claude · Audit-only deliverable*

The purpose: trace every step of the legacy desktop activation flow, the backend + account-app web bridge, and what desktop-2 has wired today. Produce the gap table and the smallest viable path for P1-1D to fill.

No code. No refactors. No Rust. No Tauri commands. No OAuth scope work. No Clerk migration. No implementation.

---

## 0 · TL;DR

- **Backend + account-app activation pipeline is fully wired end-to-end.** Both doors (Clerk via `/connect-desktop` + Whop OAuth via `/auth/whop/start`) mint a license JWT and emit the same deep-link verb · `liquidclips://activate?token=…&challenge=…`. Whop OAuth uses `scope=read_user` only (lock honored).
- **Legacy desktop has the complete client-side pattern.** `activation.ts` (348 LOC) owns nonce generation + deep-link parser + challenge verification + Keychain write + state-machine emission; `FirstRun.tsx` (132 LOC) owns the sign-in UI; `auth_panel.rs` owns the optional in-app webview path. Boot orchestration lives in `App.tsx`.
- **desktop-2 has the deep-link plugin registered but NO handler.** `src-tauri/src/lib.rs:8` calls `tauri_plugin_deep_link::init()` and stops. No `onOpenUrl` listener. No `activation.ts`. No `FirstRun.tsx`. No `useActivation()` hook. The Bearer-header bridge (authStorage from P1-1B) is the only auth primitive present.
- **`liquidclips://activate` verb does not collide.** desktop-2 already documents 15 `liquidclips://open?section=…` verbs in `HQBridgeSection.tsx` for marketing-site → app deep-linking, but none uses the `activate` hostname or the `token=…&challenge=…` query shape. P1-1D adds the new verb cleanly.
- **No new env vars needed.** All required vars (`INTERNAL_API_SECRET`, `WHOP_OAUTH_*`, `JWT_*`, `JUNIOR_ADMIN_EMAILS`) are already live on Railway + Vercel.
- **Recommended P1-1D scope ·** thin Tauri 2 deep-link listener + `lib/activation.ts` port (no Rust webview, no Clerk SDK, no UI yet · P1-1E owns UI). Single file under `src/lib/` plus a 5-LOC boot effect in App.tsx.

---

## 1 · Current-state flow map · step-by-step trace

The complete legacy path from "user clicks sign-in" to "home screen with JWT in Keychain." This is the **proven shipping flow** that desktop-2 ports.

### 1.1 · Pre-activation gating (legacy)

| Step | File:Lines | Effect |
|---|---|---|
| Cold boot | `desktop/src/App.tsx:957-1070` | `resumeSessionFromKeychainIfPresent()` runs if `secrets_presence.json` mirror says JWT exists |
| JWT cache check | `desktop/src/lib/authStorage.ts` | `getCachedLicenseJwt()` is **sync, cache-only** (IG-014 — no Keychain reads at boot) |
| State flip | `App.tsx:164` | `signedIn` state: `null` (unknown) → `false` (no JWT) → `true` (JWT primed) |
| UI gate | `App.tsx:1965-1973` | If `signedIn === false` → render `<FirstRun />` over the cockpit |
| Sign-in UI | `desktop/src/components/FirstRun.tsx:19-132` | Two CTAs: "Continue with browser" + "Sign in via the app" |

### 1.2 · Two sign-in entry points

**Email/Clerk path (primary)** ·

```
FirstRun.tsx:61
  onClick → activate({ via: "browser" | "panel" })
    ↓
activation.ts:232-273  startActivation()
  • randomChallenge() → 48-byte hex (lines 76-80)
  • emit { kind: "opening" }
  • via="panel":
      invoke("open_auth_panel", { url: "https://liquidclips.app/connect-desktop?challenge=<nonce>" })
        → src-tauri/src/auth_panel.rs spawns native WKWebView (shared cookie partition with account-app)
  • via="browser":
      openExternal(url)  → system browser
  • emit { kind: "waiting" }
  • 5-minute timeout (line 262)
```

**Whop path (secondary)** · only when account-app has `WHOP_SIGNIN_ENABLED=true` ·

```
account-app/src/app/connect-desktop/page.tsx:146-177
  "Continue with Whop" link → BACKEND_URL/auth/whop/start?challenge=<nonce>
    ↓
junior-backend/app/routes/auth_whop.py:53-77   POST /auth/whop/start
  302 → https://api.whop.com/oauth/authorize?
          client_id=…
          redirect_uri=…/auth/whop/callback
          state=<challenge>
          scope=read_user                  ← LOCK · NO bounty:create
          response_type=code
    ↓
[user authorizes on Whop]
    ↓
junior-backend/app/routes/auth_whop.py:80-180   GET /auth/whop/callback
  exchange code → access token
  fetch Whop /me → whop_user_id + email
  lookup LC User by whop_user_id (email fallback)
  • no LC account: 302 → /connect-desktop?whop_nomembership=1
  • LC account found: mint license JWT + 302 → liquidclips://activate?token=<jwt>&challenge=<state>
```

### 1.3 · External-page step (account-app `/connect-desktop`)

```
account-app/src/app/connect-desktop/page.tsx:68-145
  • Query: challenge (required), whop_nomembership?, whop_cancelled?,
    whop_disabled?, whop_error?
  • Unsigned-in: render embedded <SignIn /> (Clerk hash routing,
    forceRedirectUrl = back to /connect-desktop?challenge=<nonce>)
  • Signed-in: POST /api/desktop/connect { challenge }
        ↓
    account-app/src/app/api/desktop/connect/route.ts:17-67
      • Extracts Clerk userId + verified email + firstName from session
        (server-side · cannot be spoofed)
      • POST junior-backend /desktop/connect
        Headers: x-internal-secret = $INTERNAL_API_SECRET
        Body:    { clerk_user_id, challenge, email?, first_name? }
        ↓
      junior-backend/app/routes/desktop.py:59-157
        • Verify x-internal-secret matches
        • Lookup or upsert User (self-heals Clerk webhook race)
        • Apply admin override (is_admin_email → tier=autopilot + founder)
        • Mint license JWT (Ed25519, 30d TTL)
        • Store License row in DB
        • First-license-only: send "activated on new machine" email +
          PostHog desktop_activated event
        • Response: { license_jwt, expires_at, tier, founder, challenge }
        ↓
  • Page constructs:
      liquidclips://activate?token=<jwt>&challenge=<nonce>
  • window.location.href = deepLink (OS prompts "Open Liquid Clips?")
  • Fallback button renders same link for manual click
```

### 1.4 · Deep-link return

```
Operating system fires liquidclips://activate?token=…&challenge=…
    ↓
desktop/src-tauri/src/lib.rs:164
  tauri_plugin_deep_link::init() · plugin handles OS-level event
    ↓
desktop/src/lib/activation.ts:82-208   handleDeepLink()
  • Parse URL
  • Accept liquidclips:// AND legacy junior:// (line 94)
  • Validate hostname === "activate" (line 161)
  • CHALLENGE VERIFICATION (line 166):
        if (challenge !== pendingChallenge) {
          emit({ kind: "error", message: "That activation didn't match this app" })
          return
        }
  • Keychain write (line 174):
        await sidecar.secretSet("LICENSE_JWT", token)
        // → Python sidecar → keyring → OS Keychain
        // Service namespace: app.liquidclips.auth.v1 (IG-014)
  • In-memory cache prime (line 180):
        primeLicenseJwtCache(token)
        // → dispatch CustomEvent "lc:desktop-auth-ready"
  • emit { kind: "done" }
  • onActivated?.()
```

### 1.5 · Post-activation refresh

```
desktop/src/App.tsx:1133-1171   onActivated callback
  • Promise.all([
      syncStatus(),         // GET /sync → tier, admin_override, remaining_exports
                            //   + auto-rotates new_license_jwt if ≤5d remaining
      meStatusLegacy()      // GET /me → email, affiliate_id, billing_provider
    ])
  • nextTier = isAdmin ? "agency" : normalizeTier(s?.tier)
  • setUserTier(nextTier)
  • dispatch "lc:tier-refresh"
        ↓
  All tier-gated surfaces re-render (AvatarPanel · Projects · Settings)
  User sees: FirstRun vanishes → cockpit/home with avatar + tier pill
```

### 1.6 · JWT validity check

**NO local verification.** Desktop treats the JWT as opaque. First trust point is the next authed call:

```
backend.ts:113-133   handleUnauthorized()
  • Triggered by any 401 response
  • Delete JWT from Keychain
  • Dispatch onUnauthorized() → flips signedIn = false → re-show FirstRun
  • One-shot dampener: max one auth-storm clear per session (prevents loops)
```

### 1.7 · Failure paths

| Failure | Trigger | UI | Recovery |
|---|---|---|---|
| Challenge mismatch | `liquidclips://activate?…&challenge=wrong` (stale tab, tampering) | activation.ts:166 emits error · `FirstRun` shows "didn't match this app" + retry | "Sign in again" → fresh nonce + new activation |
| Keychain write fails | `sidecar.secretSet` throws (Keychain locked · `keyring` missing) | activation.ts:172-200 emits error with real reason · `FailedLoginRescue` panel (`FirstRun.tsx:136-222`) | Retry · "Reset login session" · "Copy diagnostics" |
| `/sync` returns 401 immediately | Backend rejects fresh JWT | `handleUnauthorized` clears JWT · `signedIn=false` · banner | Re-sign-in |
| User closes auth panel | No deep-link arrives | 5-min timeout (activation.ts:263-272) emits timeout error | "Sign in again" |
| Tauri deep-link not registered | OS doesn't fire the scheme | Activation silently never lands · user stuck on "waiting…" | (legacy bug-class · mitigation: plugin init at boot) |

### 1.8 · Invite / onboarding links

**No invite or ref-link patterns in the desktop activation code.** Account-app supports:
- `/sign-up?ref=<affiliate_id>` (or `?a=…` · cookie fallback `jnr_ref`) · captured in Clerk unsafeMetadata · webhook `user.created` locks `affiliate_id` on backend
- `/connect-desktop?whop_nomembership=1` / `?whop_cancelled=1` / `?whop_disabled=1` / `?whop_error=…` · inline banners for OAuth failure paths

`?invite=`, `?ref=`, `?affiliate=` are NEVER seen in desktop deep-link handlers. Affiliate attribution happens on the web side before activation.

---

## 2 · desktop-2 current state

### 2.1 · What's wired

| Component | File:Lines | Status |
|---|---|---|
| Tauri deep-link plugin | `desktop-2/src-tauri/src/lib.rs:8` | ✓ Registered (`tauri_plugin_deep_link::init()`) |
| Scheme declaration | `desktop-2/src-tauri/tauri.conf.json` plugins block | ✓ `"schemes": ["liquidclips"]` |
| License JWT bearer header | `desktop-2/src/design-os/engine/sidecar-stub.ts:765` | ✓ Reads through `authStorage.getJwt()` (P1-1B) |
| Auth storage primitive | `desktop-2/src/lib/authStorage.ts` | ✓ P1-1B shipped |
| HQ bridge verb documentation | `desktop-2/src/sections/hq/HQBridgeSection.tsx:5-18` | ✓ 15 `liquidclips://open?section=…` verbs documented (not implemented) |
| In-app route helpers | `desktop-2/src/shell/routes.ts:48 getCurrentParams` | ✓ Reads `URLSearchParams` for in-app navigation |

### 2.2 · What's NOT wired

| Component | Equivalent in legacy | desktop-2 state |
|---|---|---|
| Deep-link `onOpenUrl` listener | `desktop/src-tauri/src/lib.rs` (plugin handles events) | ❌ Plugin initialized but no React-side subscriber |
| `activation.ts` | `desktop/src/lib/activation.ts` (348 LOC) | ❌ Does not exist |
| `useActivation()` hook | `desktop/src/lib/activation.ts:useActivation` | ❌ Does not exist |
| `FirstRun.tsx` sign-in surface | `desktop/src/components/FirstRun.tsx` (132 LOC) | ❌ `LoginOnboarding.tsx` is a SimPage placeholder |
| Pre-activation gate at boot | `desktop/src/App.tsx:957-1070` | ❌ App boots straight into shell, no JWT gate |
| Sync orchestrator | `desktop/src/App.tsx:1133-1171` onActivated | ❌ Does not exist |
| 401 self-heal | `desktop/src/lib/backend.ts:113-133` | ❌ Does not exist |
| Tauri `open_auth_panel` command | `desktop/src-tauri/src/auth_panel.rs` (219 LOC) | ❌ Not ported · system browser is enough for v1 |
| Keychain RPC (Tauri side) | `desktop/python-sidecar/secrets_store.py` | ❌ No Rust command · no `keyring` crate (per P1-1B) |

### 2.3 · Conflicts to mind

- **`liquidclips://activate` is a NEW verb.** Existing 15 `liquidclips://open?section=…` verbs use the `open` hostname. No collision · just an additional hostname routing in P1-1D.
- **The HQ bridge verbs are documented but NOT IMPLEMENTED in desktop-2 either.** P1-1D's listener can be designed to handle the activation verb only · the bridge verbs land in a separate phase if Daniel wants them.
- **No Tauri Rust command needs to exist for the deep-link to work.** `tauri-plugin-deep-link` exposes the URL to React via its JS API · no `#[tauri::command]` required.

---

## 3 · Gap table

Rolling up the above into a single classification per surface.

| # | Surface | Status | Owner |
|---|---|---|---|
| G1 | Backend `/desktop/connect` (Clerk path) | ✅ Working | shipped |
| G2 | Backend `/auth/whop/start` + `/callback` (Whop path) | ✅ Working | shipped |
| G3 | Backend `/sync` + `/me` + JWT rotation | ✅ Working | shipped |
| G4 | Backend `/webhooks/clerk` user.created flow | ✅ Working | shipped |
| G5 | Backend `/webhooks/whop` membership flow | ✅ Working | shipped |
| G6 | Backend `/onboarding/link-whop` pending claim | ✅ Working | shipped |
| G7 | Account-app `/connect-desktop` page (Clerk embed + Whop button) | ✅ Working | shipped |
| G8 | Account-app `/api/desktop/connect` internal bridge | ✅ Working | shipped |
| G9 | Account-app `/sign-up?ref=` affiliate capture | ✅ Working | shipped |
| G10 | desktop-2 `liquidclips://` scheme registration | ✅ Working | P1-0 baseline |
| G11 | desktop-2 `lc.license.jwt.v1` bearer-header bridge | ✅ Working | P1-1B |
| G12 | desktop-2 deep-link `onOpenUrl` JS listener | ❌ NOT WIRED | **P1-1D** |
| G13 | desktop-2 challenge nonce generation + storage | ❌ NOT WIRED | **P1-1D** |
| G14 | desktop-2 deep-link parser + challenge verify | ❌ NOT WIRED | **P1-1D** |
| G15 | desktop-2 `useActivation()` state machine | ❌ NOT WIRED | **P1-1D** |
| G16 | desktop-2 sign-in entry UI (browser-only path) | ❌ NOT WIRED | **P1-1E** |
| G17 | desktop-2 pre-activation gating at boot | ❌ NOT WIRED | **P1-1D** (boot effect) |
| G18 | desktop-2 post-activation `/sync` + `/me` orchestrator | ❌ NOT WIRED | **P1-1D** (final step of state machine) |
| G19 | desktop-2 `useTierCaps()` reads real tier | ⚠️ Partial · fixture today | **P1-1G** |
| G20 | desktop-2 in-app webview sign-in (auth_panel) | ❌ NOT WIRED · DEFERRED | post-Phase-1 polish (system browser is enough) |
| G21 | desktop-2 native Keychain (Tauri secret command) | ❌ NOT WIRED · DEFERRED | P1-1F |
| G22 | desktop-2 401 self-heal | ❌ NOT WIRED · DEFERRED | P1-1F |

**Critical for beta:** G12, G13, G14, G15, G17, G18. Everything else is either shipped or deferred.

---

## 4 · Route inventory

### 4.1 · Deep-link verbs the desktop must handle

| Verb shape | Source | Purpose | Implemented in desktop-2? |
|---|---|---|---|
| `liquidclips://activate?token=<jwt>&challenge=<nonce>` | Account-app + backend Whop callback | Activation entry · the ONLY beta-critical verb | ❌ NO |
| `liquidclips://open?section=<id>&…` (15 variants) | Marketing site / Whop deep-links | In-app navigation (HQ bridge) | ❌ Documented, not wired (out of scope for P1-1D) |
| `liquidclips://rewards/return?campaign=<id>&clip=<id>` | Whop submission flow | Confirms Whop submission · returns to Earn/Engine | ❌ Documented, not wired (out of scope for P1-1D) |

**P1-1D's listener handles `liquidclips://activate` only.** The bridge verbs can route through a sibling handler in a separate phase if/when Daniel asks.

### 4.2 · Web callback routes the user hits

| Route | File | Purpose | Auth |
|---|---|---|---|
| `https://account.jnremployee.com/connect-desktop?challenge=…` | `account-app/src/app/connect-desktop/page.tsx:68-145` | Activation bridge · embeds Clerk SignIn OR fires the deep-link directly | Clerk hash routing |
| `https://account.jnremployee.com/api/desktop/connect` | `account-app/src/app/api/desktop/connect/route.ts:17-67` | Server-to-server bridge to backend's `/desktop/connect` | Clerk session |
| `https://api.liquidclips.app/auth/whop/start?challenge=…` | `junior-backend/app/routes/auth_whop.py:53-77` | Whop OAuth start · 302 to Whop | None (state=challenge) |
| `https://api.liquidclips.app/auth/whop/callback` | `junior-backend/app/routes/auth_whop.py:80-180` | Whop OAuth callback · mints JWT · 302 to `liquidclips://activate?…` | None (state validated) |
| `https://account.jnremployee.com/sign-up?ref=…` | `account-app/src/app/sign-up/[[…sign-up]]/page.tsx` | Clerk hosted sign-up · captures affiliate | Clerk |
| `https://api.liquidclips.app/webhooks/clerk` | backend | User.created · backstop | svix |
| `https://api.liquidclips.app/webhooks/whop` | backend | Membership events · backstop | HMAC |
| `https://api.liquidclips.app/desktop/connect` | backend | Mint JWT (server-to-server only) | `x-internal-secret` |
| `https://api.liquidclips.app/sync` | backend | Tier refresh + JWT rotation | Bearer |
| `https://api.liquidclips.app/me` | backend | User state | Bearer |
| `https://api.liquidclips.app/onboarding/link-whop` | backend | Claim pending Whop membership | None (Clerk-id in body) |

### 4.3 · Onboarding entry points (web side)

| Entry | Effect |
|---|---|
| `/sign-up?ref=<affiliate_id>` | Sign-up with affiliate · webhook → User row · affiliate_id locked |
| `/sign-up` (bare) | Sign-up · webhook → User row · affiliate_id null |
| `/connect-desktop?challenge=<nonce>` | Activation bridge · the only desktop-facing entry |
| `/connect-desktop?whop_nomembership=1` | Whop sign-in returned no LC account · prompt to sign up |
| `/connect-desktop?whop_disabled=1` | Whop OAuth env vars missing on Railway · fallback message |
| `/connect-desktop?whop_error=<reason>` | Whop OAuth failed mid-flow · banner with reason |

### 4.4 · Onboarding routes within desktop-2

**Currently NONE.** `ClipperJourney.tsx` is a SimPage placeholder. `LoginOnboarding.tsx` is a SimPage placeholder. There's no "welcome tour" surface today. Beta-clipper onboarding is a separate Phase 2 item, not P1-1.

---

## 5 · Recommended minimal beta path

The smallest sequence that gets agency #1 from "no JWT" → "logged in, creating a campaign":

```
┌──────────────────────────────────────────────────────────────────┐
│ STEP 0 · App boot                                                │
│   App-root effect calls initAuthStorage() (P1-1B)                │
│   If JWT present → render shell                                  │
│   If JWT absent → render LoginOnboarding placeholder (SimPage    │
│                   today · real UI lands in P1-1E)                │
├──────────────────────────────────────────────────────────────────┤
│ STEP 1 · User clicks "Sign in" CTA                               │
│   (lives on LoginOnboarding · stubbed today)                     │
│   ↓                                                              │
│   useActivation().start("browser")                               │
│      ↓                                                           │
│   • randomChallenge() → 48-byte hex                              │
│   • persist nonce in module-level state                          │
│   • emit "opening"                                               │
│   • openSmart("https://account.jnremployee.com/                  │
│              connect-desktop?challenge=<nonce>")                 │
│      → system browser opens                                      │
│   • emit "waiting"                                               │
│   • start 5-minute timeout                                       │
├──────────────────────────────────────────────────────────────────┤
│ STEP 2 · User signs in on account-app (or signs up)              │
│   account-app handles Clerk · server-side mints JWT via backend  │
│   account-app constructs liquidclips://activate?token=…&         │
│                                            challenge=<nonce>     │
│   account-app sets window.location.href = deepLink               │
│   OS prompts "Open Liquid Clips?" · user accepts                 │
├──────────────────────────────────────────────────────────────────┤
│ STEP 3 · Deep-link fires inside desktop-2                        │
│   tauri-plugin-deep-link emits OpenUrl event                     │
│   React subscriber routes the URL to activation.handleDeepLink   │
│      ↓                                                           │
│   • parse URL · hostname === "activate"                          │
│   • challenge match? · NO → emit error · UI shows "didn't match" │
│   • challenge match? · YES → setJwt(token) (authStorage P1-1B)   │
│   • emit "done"                                                  │
├──────────────────────────────────────────────────────────────────┤
│ STEP 4 · Post-activation refresh                                 │
│   • GET /sync → tier · effective_tier · maybe new_license_jwt   │
│   • GET /me  → email · admin_override · billing_provider        │
│   • cache tier into useTierCaps() (P1-1G fills this in)         │
│   • emit "signed-in"                                             │
├──────────────────────────────────────────────────────────────────┤
│ STEP 5 · LoginOnboarding unmounts                                │
│   App shell renders normally with avatar + tier pill             │
│   Agency clicks "Create campaign" → 6N-E flow                    │
└──────────────────────────────────────────────────────────────────┘
```

The Whop path (alternative to step 2) replaces only the URL in step 1 with `https://api.liquidclips.app/auth/whop/start?challenge=<nonce>`. Step 3 onwards is identical.

---

## 6 · Recommended P1-1D build order

P1-1D's job: wire the deep-link plumbing AND the activation state machine. **NO sign-in UI** · that's P1-1E.

### Sub-units within P1-1D · ordered by dependency

**P1-1D-a · `src/lib/activation.ts`** (~150 LOC)
- `randomChallenge()` · 48-byte hex via `crypto.getRandomValues()`
- Module-level `pendingChallenge: string | null` state
- `startActivation({ via: "clerk" | "whop" })` · generates nonce, stores it, opens external URL via `openSmart` (lib/openSmart.ts already exists), emits state
- `handleDeepLink(url: string)` · parses URL, validates hostname + challenge, calls `setJwt(token)` (authStorage P1-1B), emits state
- `useActivation()` React hook · subscribes to module state
- State machine: `"idle" → "opening" → "waiting" → "done"` (success) OR `"…" → "error"` (failure)

**P1-1D-b · Tauri deep-link subscriber** (~30 LOC in a new file like `src/lib/deepLinkBoot.ts`)
- Import `@tauri-apps/plugin-deep-link` · use `onOpenUrl` callback
- On every URL: pass to `handleDeepLink()` from P1-1D-a
- Subscribed once at App-root (idempotent)
- Browser-preview safe: the import is dynamic + guarded by `isTauriRuntime()` check (same idiom as authStorage)

**P1-1D-c · Post-activation orchestrator** (~50 LOC, can co-locate in activation.ts)
- After `handleDeepLink` succeeds with `setJwt(token)`:
  - GET `/sync` · captures tier + new_license_jwt if rotated
  - GET `/me`   · captures email + effective_tier
  - Caches results in a new `useAuth()` Zustand or React store (or extends authStorage as needed · scope discipline says no new hook unless tightly coupled)
  - Emits `"signed-in"` state with payload

**P1-1D-d · App-root boot effect** (~10 LOC patch to `src/main.tsx` or App.tsx)
- `useEffect(() => { void initAuthStorage(); mountDeepLinkSubscriber(); }, [])`
- Idempotent · safe to call on every boot

### Out of P1-1D scope (defers to later phases)

- ❌ Sign-in UI buttons · P1-1E
- ❌ "Sign in with Whop" wiring · P1-1E (just adds a second CTA; orchestrator already supports both URLs)
- ❌ 401 self-heal · P1-1F
- ❌ Token rotation handling in `/sync` response (`new_license_jwt`) · can land in P1-1D-c if trivial (it's a 5-LOC `setJwt(new_license_jwt)` if present) OR defer to P1-1F
- ❌ Native Keychain · P1-1F (authStorage already has the forward-ready hook)
- ❌ In-app webview · post-Phase-1 polish
- ❌ Tier UI gating · P1-1G

### Verification plan (for the build phase · not now)

- `npx tsc --noEmit` clean
- Manually paste a JWT into localStorage → reload → assert `getJwt()` returns it, `/sync` succeeds
- Manually fire `liquidclips://activate?token=<real-jwt>&challenge=<nonce>` while `pendingChallenge === <nonce>` → assert JWT lands in storage and "signed-in" state emits
- Challenge-mismatch path: `liquidclips://activate?token=…&challenge=wrong` → assert "error" state emits, JWT NOT written
- No-JWT boot: clear localStorage, reload → assert state is `"idle"` (placeholder LoginOnboarding still renders until P1-1E)
- 5-min timeout path: start activation, wait 6 minutes → assert "error" state with timeout message

---

## 7 · Open questions for the build phase (NOT blocking the audit)

- Should `useActivation()` live in `src/lib/activation.ts` or `src/design-os/state/useAuth.ts`? · Recommend `state/useAuth.ts` for consistency with other hooks
- Should post-activation `/sync` + `/me` be parallelized (`Promise.all`) like legacy or sequenced for cleaner errors? · Recommend `Promise.all` (matches legacy pattern · faster boot)
- Should the desktop-2 build accept BOTH `liquidclips://` AND legacy `junior://` schemes? · Recommend `liquidclips://` only · drop the legacy alias (clean break per memory `liquid_clips_rebrand`)
- Should the activation timeout be 5 minutes (legacy) or shorter for desktop-2? · Recommend 5 minutes · matches user expectation
- What happens if `/sync` post-activation returns 401 (e.g. JWT was tampered)? · Recommend immediately call `clearJwt()` + emit `"error"` · prevents storing a bad JWT

---

## 8 · Risks called out by the trace

| Risk | Severity | Mitigation |
|---|---|---|
| Deep-link doesn't fire because plugin init runs but `onOpenUrl` subscriber attaches late | Med | Subscribe SYNCHRONOUSLY at app root before any async work · use a small queue if events arrive before the React tree mounts |
| User opens the desktop from a deep-link (cold start with URL) vs a hot deep-link · two-code-path risk | Med | Tauri's deep-link plugin exposes `getCurrent()` to read the launch URL on cold start · call both paths through the same `handleDeepLink` |
| Whop OAuth path returns the same `liquidclips://activate` verb but `?whop_nomembership=1` lives on the web side · desktop must not panic when the deep-link doesn't fire (because the user saw a web banner instead) | Low | The 5-min timeout covers it · UI surfaces "didn't receive activation" with retry |
| New `liquidclips://activate` verb collides with future `liquidclips://open?section=…` bridge if the bridge handler isn't routed properly | Low | Hostname is the discriminator (`activate` vs `open`) · clean split |
| User clicks "Sign in" twice quickly · two pending challenges | Med | `pendingChallenge` is last-write-wins · the most recent nonce is the only one accepted · OK · legacy parity |
| User's system browser doesn't honor the deep-link scheme (e.g. Firefox prompt suppressed) | Low | account-app's `/connect-desktop` page renders a manual "Open Liquid Clips" button as fallback · already shipped |
| Cold launch via `liquidclips://activate` before authStorage is initialized | Med | P1-1D-d ensures `initAuthStorage()` runs before mountDeepLinkSubscriber subscribes · order is significant |

---

## 9 · Confirmed pre-build dependencies

All four P1-1A confirmations remain required before P1-1D ships. None block the audit:

1. `INTERNAL_API_SECRET` matches across Vercel (account-app) + Railway (junior-backend) · per Explore #2 inventory, this is the guard on `/api/desktop/connect` → `/desktop/connect` chain · MUST be confirmed correct
2. `WHOP_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` set on Railway · confirmed used by `auth_whop.py` · MUST be confirmed correct
3. `JUNIOR_ADMIN_EMAILS` env var on Railway includes Daniel's emails + any beta agencies · `is_admin_email` is the only path to `tier="autopilot"` in v1
4. Account-app `/connect-desktop` route is reachable from prod · spot-check `curl -I https://account.jnremployee.com/connect-desktop?challenge=test`

No NEW env vars introduced by P1-1D. No new schema. No new backend endpoint.

---

## 10 · TL;DR for the build queue

- **Audit complete.** Backend + account-app are fully wired. Legacy desktop has the proven pattern. desktop-2 has the bridge primitive (P1-1B) but no listener + no state machine.
- **P1-1D ships 4 sub-units · ~1 day total:**
  - **P1-1D-a** `src/lib/activation.ts` (state machine · nonce · deep-link parser) · ~150 LOC
  - **P1-1D-b** Tauri deep-link subscriber in `src/lib/deepLinkBoot.ts` · ~30 LOC
  - **P1-1D-c** Post-activation `/sync` + `/me` orchestrator (co-located in activation.ts) · ~50 LOC
  - **P1-1D-d** App-root boot effect (5-10 LOC patch)
- **No sign-in UI** in P1-1D · UI is P1-1E
- **No native Keychain · no 401 self-heal · no in-app webview** in P1-1D · those are P1-1F + post-Phase-1
- **Whop path requires nothing new in P1-1D** · the orchestrator accepts BOTH URLs via the same `startActivation()` because the deep-link return shape is identical
- **First Daniel action after P1-1D ships:** paste a JWT into localStorage, fire `liquidclips://activate?token=<paste>&challenge=<test>` via `open liquidclips://...` in terminal · verify the state machine flips and `/sync` succeeds. End-to-end smoke without UI.

---

*Audit complete · no code · no env changes · no Rust · no Tauri commands · awaiting Daniel approval to start P1-1D-a.*
