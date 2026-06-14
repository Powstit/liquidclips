# Bug Reminder Registry

This file tracks high-risk customer-journey bugs that have been fixed, with enough context to catch regressions during future refactors.

## P0 Auth / Account / Dead-End Fixes — 2026-06-13

### 1. Wrong re-activation flow in Settings, AvatarPanel, AvatarOrbit

**Risk:** Desktop recovery CTAs opened `/sign-in?redirect_url=/dashboard`, which marketing ignores. Users landed on `/connect-desktop` with no challenge and saw *“Missing activation code.”* The desktop never received a license JWT.

**Files changed:**
- `desktop/src/components/Settings.tsx`
- `desktop/src/components/cockpit/AvatarPanel.tsx`
- `desktop/src/components/cockpit/AvatarOrbit.tsx`

**Fix:** Replaced `openAuthPanel("sign-in")` with `activate()` from `useActivation()`, which generates a fresh challenge and flows through `liquidclips://activate`.

**Regression watch:** Any future "re-activate" or "sign in again" CTA must use `activate()` / `activate({ via: "browser" })`, not `openAuthPanel("sign-in")`.

---

### 2. Activation browser fallback pointed at wrong host

**Risk:** If the system browser could not be opened, the fallback copy told users to visit `account.liquidclips.app/connect-desktop`, which is the deprecated satellite domain.

**File changed:** `desktop/src/lib/activation.ts`

**Fix:** Updated fallback message to `https://liquidclips.app/connect-desktop`.

**Regression watch:** `CONNECT_URL` and all user-facing activation copy must stay on `liquidclips.app`.

---

### 3. Account-app dashboard dead links

**Risk:**
- *Sign out* linked to `/sign-out`, which does not exist → 404.
- *Connect Whop* and *Open Earn in desktop* linked to `/download`, which is the generic marketing download page. The copy promised a specific action that the link did not perform.

**Files changed:**
- `account-app/src/app/dashboard/page.tsx`
- `account-app/src/components/SignOutButton.tsx` (new)

**Fix:**
- Replaced `/sign-out` with a Clerk `<SignOutButton>` client component.
- Changed *Connect Whop* / *Open Earn in desktop* copy to *Download desktop app →* so the destination matches the promise.
- Updated the partner dashboard fallback from `partner.jnremployee.com` to `partner.liquidclips.app`.

**Regression watch:** Any dashboard card that claims to "open desktop" or "connect Whop" must either use a real deep-link/desktop activation flow or use honest download copy.

---

### 4. Account-app sign-in/sign-up dropped `redirect_url`

**Risk:** `/get?claim=…`, `/upgrade`, and `/connect-desktop?challenge=…` passed `redirect_url` to `/sign-in` and `/sign-up`, but those pages only used `fallbackRedirectUrl="/dashboard"`. After auth, users lost their original path (purchase claim, upgrade checkout, or desktop activation challenge).

**Files changed:**
- `account-app/src/app/sign-in/[[...sign-in]]/page.tsx`
- `account-app/src/app/sign-up/[[...sign-up]]/page.tsx`
- `account-app/src/app/connect-desktop/page.tsx`

**Fix:**
- `/sign-in` now reads `redirect_url`/`redirect` from `searchParams` and passes it to `<SignIn fallbackRedirectUrl={...}>` and `signUpUrl`.
- `/sign-up` now reads `redirect_url`/`redirect` via `useSearchParams` and passes it to `<SignUp fallbackRedirectUrl={...}>` and `signInUrl`.
- `/connect-desktop` now passes the challenge-preserving `back` URL in `signUpUrl`.

**Regression watch:** Any future auth page must honor `redirect_url` / `redirect` and preserve it on the sign-in ↔ sign-up switch.

---

### 5. SidecarCrashOverlay was built but unmounted

**Risk:** If the Python sidecar died mid-session, the user had no actionable full-screen recovery UI.

**Files changed:**
- `desktop/src/App.tsx`
- `desktop/src/components/SidecarCrashOverlay.tsx`

**Fix:** Imported and mounted `<SidecarCrashOverlay />` once at the App root. The overlay already subscribes to `sidecar:died` and provides Restart / Try to continue actions.

**Regression watch:** Do not remove the mount. If the overlay is ever redesigned, keep the listener contract with `subscribeSidecarDied`.

---

### 6. BottomCockpit dead clicks

**Risk:** The ⋮ menu items *Brief*, *Add more clips*, and *Earn* dispatched `lc:open-brief`, `lc:go-home`, and `lc:go-earn`, but no listeners existed anywhere in `desktop/src`. The clicks did nothing.

**Files changed:**
- `desktop/src/components/cockpit/BottomCockpit.tsx`
- `desktop/src/App.tsx`

**Fix:**
- Added App-level listeners for all three events.
- `lc:go-home` → navigates to the empty/home view.
- `lc:go-earn` → navigates to the Earn tab.
- `lc:open-brief` → opens the project's Whop bounty URL in the browse panel if `project.whop_bounty_url` exists; otherwise shows an info toast.

**Regression watch:** Any future menu item that dispatches a custom event must have a matching listener that performs a real action. Do not ship dead event dispatches.

---

## P1 Pre-Build Patch — 2026-06-13

### 1. Missing OpenAI key routed to FirstRun

**Risk:** When `guardQuota()` detected no OpenAI key, it sent the user to the FirstRun sign-in splash. The real problem was an API key, not auth, so the flow was confusing and blocked legitimate activated users.

**File changed:** `desktop/src/App.tsx`

**Fix:** If `sidecar.openaiKeyStatus()` reports no resolvable key, open Settings and dispatch `lc:settings-open-tab` with `tab: "keys"`. Settings already listens for that event and switches to the API-keys pane.

**Regression watch:** Any future API-key gate must route to Settings → API keys, never to FirstRun or sign-in.

---

### 2. Broken external URLs

**Risk:** Several runtime fallbacks still pointed at deprecated or 404 URLs:
- `account.liquidclips.app/earn` (404 — no such route)
- `account.liquidclips.app/billing` (404 — no such route)
- `partner.jnremployee.com` (deprecated, redirects to marketing)
- `whop.com/jnremployee` (deprecated Whop slug)
- `account.jnremployee.com` fallbacks in partner-app and backend config

**Files changed:**
- `desktop/src/components/earn/AffiliateHero.tsx`
- `desktop/src/components/earn/EarnPanelMount.tsx`
- `desktop/src/components/earn/EarnErrorBoundary.tsx`
- `desktop/src/components/earn/PayoutsView.tsx`
- `junior-backend/app/config.py`
- `partner-app/src/app/page.tsx`
- `partner-app/src/lib/brand.ts`

**Fix:**
- Retired `/earn` fallback → `account.liquidclips.app/embed/earn` (live fallback).
- Retired `/billing` link → `account.liquidclips.app/dashboard` or `#payouts`.
- `partner.jnremployee.com` → `partner.liquidclips.app` (or env-driven override).
- `whop.com/jnremployee` → `whop.com/liquidclips`.
- Partner-app marketing + checkout fallbacks now default to `liquidclips.app` / `account.liquidclips.app`.

**Regression watch:** New URL constants must be checked against live routes. Prefer env-driven overrides for any domain that may change again.

---

### 3. Publish/Schedule disabled reason

**Risk:** The inline Schedule submit button disabled itself when no channel/platform was selected, but gave no tooltip or inline reason, so users thought the button was broken.

**File changed:** `desktop/src/components/clips-feed/InlineScheduler.tsx`

**Fix:** Added a `title` prop to the submit button that explains *why* it is disabled (busy / no channel selected / no platform selected).

**Regression watch:** Any disabled primary CTA in publish/schedule flows must surface a title, tooltip, or inline reason.

---

### 4. Community chat URL format

**Risk:** Frontend and backend both used `whop.com/c/<id>`, but the code/comment could be read as using the room's internal UUID instead of the Whop `chat_feed_id` stored in `whop_channel_id`.

**File changed:** `desktop/src/components/CommunityTab.tsx`

**Fix:** Clarified the helper comment and parameter name so it is obvious the URL is built from `CommunityChannel.whop_channel_id`, not `CommunityChannel.id`.

**Regression watch:** If Whop ever changes chat URL shape, update both the backend seed/model comments and `whopChatUrl()` together.
