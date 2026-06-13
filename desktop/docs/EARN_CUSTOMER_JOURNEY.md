# Earn — Customer Journey Map

> **Status:** canonical product spec for the Earn surface.
> **Owner:** Daniel.
> **Last revised:** 2026-06-13.
> **Pairs with:** `docs/auth-keychain-invariant.md` (IG-014), `docs/IRON_GATES.md`.

Earn must feel like a native desktop command centre. The customer never reads about JWTs, Clerk, cookies, keychains, presence files, webviews, or session handshakes. Implementation details belong in code, never on the user's screen.

This document defines the user-visible behaviour of Earn for every realistic state. Any future code change to Earn must read this doc first and match it. If the doc is wrong, update the doc and get sign-off **before** touching code.

---

## Product principle

Liquid Clips is one desktop app. Earn is one of its rooms.

* Earn opens **immediately** when the user clicks the tab. Nothing about Earn waits on a browser, a webview, or a cookie handshake.
* Every state has a **visible** UI. Earn never goes dark. Earn never goes blank. Earn never depends on something the user can't see.
* Errors are **local and recoverable**: a failing section can fail without taking the rest of the page down.
* Copy uses **user-facing English**, never engineering jargon.

If a change to Earn breaks any one of these, it is not ready to ship.

---

## The 7 customer states

### 1. Fresh install / first launch

**User reality:** they downloaded the app, they opened it. They do not yet have a Liquid Clips account, no JWT, no Whop connection.

**Expected UI:**
* Earn tab opens immediately. No black screen.
* No embedded `account.liquidclips.app` page.
* Header explains what Earn is.
* Primary card: *"Sign in to Liquid Clips to unlock Earn."*
  * Secondary line: *"After signing in, connect Whop to view bounty campaigns."*
  * CTA: *"Sign in to Liquid Clips →"*
* Sponsored campaigns section: **still visible**. Public API may return data; render the carousel if it does, otherwise render the section's loading/empty state.
* Bounty section: visible, locked state. Copy: *"Sign in to view your Whop bounties."*

**Expected behaviour:**
* Clicking the primary CTA opens the in-app auth panel (`openAuthPanel("sign-in")`) or kicks off the approved browser flow.
* If the flow needs Chrome once, the in-app copy says so plainly: *"Finish sign-in in your browser, then come back here."* The desktop window stays visible behind that copy.
* On deep-link return, the activation handler primes the JWT cache and Earn refreshes automatically. No manual reload.

---

### 2. Signed in to Liquid Clips, Whop not connected

**User reality:** they've completed Liquid Clips sign-in. The JWT is in cache (or recoverable from the same-session keychain). Whop is not connected.

**Expected UI:**
* No *"Sign in"* card.
* No *"Refresh session"* banner.
* **Affiliate Hero** renders its real dashboard state (signed-in customer, possibly trial / past-due / pre-payouts — whatever the backend says).
* Sponsored campaigns load.
* Bounty section: native card with *"Connect Whop to view live bounties."*
  * CTA: *"Connect Whop →"*

**Expected behaviour:**
* Clicking *"Connect Whop"* routes the user to Settings → Connections (or whatever the canonical Whop OAuth surface is). No external browser unless absolutely required, and only with clear inline copy.
* On Whop OAuth return, the bounty section refreshes automatically.

---

### 3. Signed in + Whop connected

**User reality:** both JWT and Whop session are alive. This is the steady state for paying clippers.

**Expected UI:**
* Earn opens instantly.
* Affiliate dashboard visible (live earnings, link status, payout rail).
* Sponsored campaigns carousel visible.
* Whop bounty list visible.
* No reconnect card. No activation card. No browser redirect. No `account.liquidclips.app` webview.

**Expected behaviour:**
* Clicking a bounty starts the clip journey (import / source → clip → export → submit). Earn is the command centre, not a page that bounces to elsewhere.
* Per-card errors are inline and local. The page never goes blank because one bounty failed to fetch.

---

### 4. Returning user, app restarted, presence true but in-memory JWT cache empty

**User reality:** they signed in before, presence file says `LICENSE_JWT: true`, but the desktop process restarted and the in-memory cache is empty. The auth-keychain invariant (IG-014) forbids auto-reading keychain on boot or mount, so the cache stays empty until an explicit auth action.

**Expected UI:**
* No *"Activate Liquid Clips"* card. The user already activated. Saying activate is confusing.
* No *"Reconnect account"* phrasing — it sounds like reconnecting to a third-party service.
* Soft banner at the top of Earn:
  * Title: *"Refresh your session to load earnings."*
  * Body: *"This confirms your account for this app session — takes a second."*
  * CTA: *"Refresh session →"*
* Sponsored campaigns remain visible underneath (public API).
* Bounty section: visible, locked state. Copy: *"Refresh your session to see live bounties."* — same single action unlocks both.

**Expected behaviour:**
* *"Refresh session"* is an explicit auth action and IS permitted to read the keychain (it's the "Reconnect account" verb from IG-014's allowed list).
* On success, prime the cache and refresh Earn automatically. AffiliateHero mounts, BountyList mounts, banner disappears.
* On failure (keychain rejects, or the stored JWT is invalid), surface a *"Sign in again"* card with the specific reason. Do not silently loop.
* If the user clicks Refresh and the cache is STILL empty afterwards (the keychain read returned null), promote the surface to State 5 with copy that names the reason — never put the user in a Retry → still broken loop.

---

### 5. Signed-in user, JWT expired or invalid

**User reality:** the JWT existed but the backend rejected it (401). The 401 self-heal in `backend.ts:handleUnauthorized` already deleted the keychain item AND fired `onUnauthorized`. So by the time the user sees Earn, presence is false and cache is null.

**Expected UI:**
* Banner: *"Your session expired."*
* CTA: *"Sign in again →"*
* No blank page. No silent failure.
* Sponsored campaigns: still visible.

**Expected behaviour:**
* The CTA opens the in-app auth panel.
* This state collapses into State 1 behavior once the user starts the sign-in flow.

---

### 6. API failure

**User reality:** something on api.liquidclips.app or the Whop sidecar route failed.

**Expected UI:**
* The Earn shell stays visible — header, banner state (if any), section frames.
* **AffiliateHero** shows its local error card with Retry.
* **Sponsored campaigns** shows Retry / *"Open in browser"* fallback.
* **Bounty list** shows Retry / Connect Whop / Empty / Error depending on the failure mode.
* Never hide the entire page because one section's API call failed.

**Expected behaviour:**
* Per-section Retry buttons re-fetch only that section.
* "Open in browser" is a SECONDARY fallback — never the primary path. It links to the marketing or account page, not to `/embed/earn`.

---

### 7. Embedded browser / sidebar inside the desktop app

This question must be answered in this doc so no future agent depends on something they shouldn't.

**What is the embedded browser on the side of the app?**
It is a native Tauri child webview registered at `src-tauri/src/browse.rs` (`PANEL_LABEL = "browse_panel"`). It opens to the right of the workbench when the user navigates into a sponsored campaign / bounty card that points at a third-party URL (typically Whop). It's pinned to a window-coordinate rectangle the React side measures.

**Is it the same webview/session as the (now-retired) Earn embed?**
No. The Earn surface is now 100% native React (v0.7.60). The browse panel is a separate Tauri child webview with its own `PANEL_LABEL`.

**Does it share cookies with the desktop's auth panel?**
No. Each Tauri child webview has its own cookie partition. `browse_panel`, `auth_panel`, and the (retired) `earn_panel` are isolated cookie jars by default.

**Does it share cookies with the user's external Chrome?**
No. Tauri child webviews are WKWebView instances inside the Liquid Clips process — they do not see Chrome's cookie store, and Chrome does not see theirs.

**Does it share cookies with `account.liquidclips.app`?**
Only if the same webview happened to have visited `account.liquidclips.app` and the user signed in there in that webview. The browse panel typically visits Whop URLs, not account-app URLs. **Earn cannot rely on this.**

**Decision:** Earn must never depend on cookie state inside the browse panel. The browse panel is a viewing surface for third-party content; it is NOT an auth or data surface for Earn. If Earn needs auth, Earn uses the desktop JWT cache + the sidecar — never a cookie hop through `browse_panel`.

---

## Hard rule — desktop auth path

**Earn must never send users to `https://liquidclips.app/sign-in?redirect_url=/dashboard`.**

That URL signs the user into the marketing-edge web dashboard via Clerk and deposits the session cookie inside the auth_panel webview's isolated cookie partition. It does **not** mint a `LICENSE_JWT`. It does **not** prime the desktop's in-memory JWT cache. The user lands on `account.liquidclips.app/dashboard` and Earn stays signed-out forever.

Earn desktop auth MUST use the desktop activation / deep-link flow:

* `useActivation()` → `activate({ via: "browser" })` (from `src/lib/activation.ts`).
* That opens `liquidclips.app/connect-desktop?challenge=<nonce>` in the system browser.
* Clerk sign-in completes → `/api/desktop/connect` mints `LICENSE_JWT`.
* The browser triggers `liquidclips://activate?token=…&challenge=…`.
* `handleDeepLink` (`activation.ts`) writes `LICENSE_JWT` under `app.liquidclips.auth.v1` AND calls `primeLicenseJwtCache(token)`.
* Earn's `focus` / `lc:tier-refresh` listeners re-probe and the surface flips to `ready`.

`openAuthPanel("sign-in")` is **explicitly forbidden** from Earn. The four Earn CTAs that need a sign-in (`SignInBanner`, `RefreshSessionBanner`, `ExpiredBanner`, `BountySection` locked card) all wire to `activate({ via: "browser" })`. If a future Earn-adjacent CTA needs a sign-in flow, it routes through `useActivation()` too — never through `AuthPanel`.

## Required code behaviour (the contract)

`EarnTab` must obey all of these:

* MUST NOT mount `EarnPanelMount`.
* MUST NOT open `account.liquidclips.app/embed/earn`.
* MUST NOT depend on Clerk browser cookies.
* MUST NOT require a webview session handshake.
* MAY use:
  * `getCachedLicenseJwt()` — synchronous in-memory cache accessor (safe, no keychain).
  * `sidecar.licenseJwtPresence()` — presence-file mirror (safe, no keychain).
  * Explicit auth actions (`openAuthPanel("sign-in")`, `activate({ via: "browser" })`, the 5 actions enumerated in `docs/auth-keychain-invariant.md`).
  * Backend API calls via the desktop `authedFetch` layer (sends Bearer JWT from cache).
  * Whop sidecar / API calls (`sidecar.whopListBounties`, etc.).

`EarnTab` state-to-copy mapping is non-negotiable:

| Auth probe result | Banner shown | Banner CTA |
|---|---|---|
| `getCachedLicenseJwt()` returns a string | (none) | (none — render AffiliateHero + bounties) |
| Cache null AND presence false | *"Sign in to Liquid Clips to unlock Earn."* | *"Sign in to Liquid Clips →"* |
| Cache null AND presence true | *"Refresh your session to load earnings."* | *"Refresh session →"* |
| JWT was just rejected by backend (401) | *"Your session expired."* | *"Sign in again →"* |

| Bounty state (independent of auth banner) | Bounty UI |
|---|---|
| Cache null (any reason) | Locked card: *"Sign in to view your Whop bounties"* or *"Refresh your session to see live bounties"* matching the top banner. |
| Cache present + Whop authenticated false | Locked card: *"Connect Whop to view live bounties."* CTA: *"Connect Whop →"* |
| Cache present + Whop ok + 0 bounties | Empty card: *"No open Whop bounties right now."* Refresh CTA. |
| Cache present + Whop ok + N bounties | Card grid. |
| Cache present + sidecar error | Error card + Retry. |

---

## Screen copy rules

**Use these words on user-facing surfaces:**
Sign in · Refresh session · Connect Whop · Load campaigns · Retry · Open in browser · Your session expired · Finish sign-in.

**Never show these words on user-facing surfaces:**
JWT · Clerk · Keychain · cache · presence file · webview · handshake · satellite cookie · activate (when the user is already inside the app).

**"Activate Liquid Clips" is for first-install copy only.**
Once the user has activated once (presence file says LICENSE_JWT=true), the verb is *"Sign in"* or *"Refresh session"* — never *"Activate"*.

---

## The screenshot fix (immediate)

The version of Earn that prompted this doc showed:

> Reconnect account
> Activate Liquid Clips to see your earnings.

That is wrong for the user. They're already inside Liquid Clips. They don't need to "activate" anything.

**Replace with this logic:**

```
if (cache present)               → no banner, AffiliateHero + bounties render
else if (presence true)          → "Refresh your session to load earnings."   CTA "Refresh session →"
else                             → "Sign in to Liquid Clips to unlock Earn."   CTA "Sign in to Liquid Clips →"

if (Whop not connected)          → bounty section: "Connect Whop to view live bounties."
```

The word "Activate" never appears in Earn after the user's first sign-in.
The word "Reconnect" never appears — it is always either "Refresh session" or "Sign in again" depending on state.

---

## Acceptance hand-walks

The Earn surface is accepted when ALL of these pass on the running desktop app:

### A — Fresh signed-out user
1. Boot the desktop with no LICENSE_JWT on this machine.
2. Click Earn.
3. Native Earn shell renders immediately. No blank, no webview, no redirect.
4. Banner: *"Sign in to Liquid Clips to unlock Earn."*
5. Sponsored campaigns: visible if backend has data, otherwise visible loading/empty.
6. Bounty section: locked card, sensible copy.

### B — Signed-in Liquid Clips user, Whop missing
1. Sign in via the browser path until the desktop receives the deep-link.
2. Click Earn.
3. No *"Activate Liquid Clips"* card. No *"Refresh session"* banner.
4. AffiliateHero shows the real customer state.
5. Sponsored carousel renders.
6. Bounty section: *"Connect Whop to view live bounties."* CTA opens the Whop link flow.

### C — Signed-in + Whop connected
1. Complete the Whop OAuth from B's CTA.
2. Reopen Earn.
3. Affiliate dashboard live. Sponsored carousel live. Bounty list live.
4. Click a bounty → clip journey starts.

### D — Restarted app with presence true and cache empty
1. From state C, quit the desktop app fully.
2. Re-launch.
3. Click Earn.
4. Soft banner: *"Refresh your session to load earnings."* CTA *"Refresh session →"*
5. Click *"Refresh session"*.
6. Banner disappears, AffiliateHero re-mounts with live data, bounties load.
7. No *"Activate Liquid Clips"* copy at any point.

### E — API failure
1. Pull network or stub `api.liquidclips.app` to return 500.
2. Click Earn.
3. Earn shell remains visible. Each section shows its own error/retry UI. Other sections continue rendering whatever they can.

---

## When this doc should be updated

* **Before** any code change that adds a new Earn state.
* **Before** copy changes on the auth banner or any Earn CTA.
* **After** a customer reports an Earn flow as confusing — update the matching state's copy here, then update the code.
* **Never** silently — every change to this doc gets a commit. The doc is the spec.

Pre-existing iron gates that intersect with Earn:
* `IG-011` — RoomShell `align="stretch"` for webview-pinned rooms. Earn no longer pins a webview, so the stretch is now just a layout convenience. Don't change the App.tsx line.
* `IG-014` — auth-keychain invariant. Earn's auth probe MUST go through `getCachedLicenseJwt()` + `sidecar.licenseJwtPresence()` only. The "Refresh session" CTA is allowed to call into the auth panel which IS one of the 5 explicit auth actions.
