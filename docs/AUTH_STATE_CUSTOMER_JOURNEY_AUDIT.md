# Global Signed-In / Signed-Out Customer-Journey Audit

**Scope:** desktop app (`desktop/src`) + account-app checkout/connect flows.  
**Version audited:** v0.7.68 working tree (pre-release, uncommitted P0/P1 fixes included).  
**Author:** Kimi agent, 2026-06-13.  
**Status:** REPORT ONLY — no code changes until Daniel approves.

## 1. Product rule that governs this audit

> Public browsing is allowed; money/actions require authentication.

This means anonymous users may browse clips, bounties, and community rooms, but any surface that touches payment, payout, publishing, scheduling, or affiliate earnings must either work because the user is already signed in, or cleanly route the user through sign-in/activation.

## 2. Auth state machine (canonical, 5 states)

The runtime state is split across three layers:

1. **Keychain / OS store** — holds the `LICENSE_JWT` (or not). Written only by explicit activation or sign-out.
2. **In-memory cache** — `_jwtCache` in `desktop/src/lib/authStorage.ts`. Primed by activation; invalidated by sign-out or 401.
3. **Presence mirror** — a file rewritten by `secret_set`/`secret_delete` so `licenseJwtPresence()` can answer "is a JWT stored?" without reading the keychain.

From those primitives we derive five customer-facing states:

| # | State | How detected | Canonical recovery |
|---|-------|--------------|--------------------|
| A | **signed-out** | No `LICENSE_JWT` present; `getCachedLicenseJwt()` returns `null`. | FirstRun → `activate()` → browser/connect-desktop deep-link → keychain write → cache primed → `lc:desktop-auth-ready`. |
| B | **locked-returning-user** | `licenseJwtPresence()` is `true` but `_jwtCache` is empty (e.g. app restarted without re-reading keychain, or cache was cleared). | Any inline action that needs auth calls `activate({ via: "browser" })`, which re-runs the connect-desktop flow and re-primes the cache without necessarily minting a new user. |
| C | **signed-in-ready** | `_jwtCache` is populated and `/sync` / `/me` succeed. | Normal usage. |
| D | **expired-invalid** | `authedFetch` receives 401; backend clears `LICENSE_JWT`; `onUnauthorized` fires. | App.tsx shows the "session ended" banner and routes to FirstRun. |
| E | **checkout-complete-needs-refresh** | User paid via account-app checkout while desktop webview was open (or parent was desktop). | Desktop must receive a signal and call `refreshTier()` + update cached tier. |

### State-transition diagram (text)

```
[A signed-out]
   │ click Sign in
   ▼
[FirstRun] ──activate()──► [browser /connect-desktop?challenge=…]
   ▲                            │
   │                            ▼
   │                    [connect-desktop mints license_jwt]
   │                            │
   │                            ▼
   │                    [liquidclips://activate?token=…]
   │                            │
   └────────────────────────────┘  sidecar writes LICENSE_JWT; primeLicenseJwtCache(); dispatch lc:desktop-auth-ready

[C signed-in-ready] ──401 / sign-out──► [D expired-invalid] ──► [A signed-out]

[B locked-returning-user] ──action needs auth──► activate() ──► [C signed-in-ready]

[E checkout-complete-needs-refresh] ──desktop receives signal──► refreshTier() + sidecar.tierInvalidate() ──► [C signed-in-ready]
```

## 3. Critical bug: paid checkout may not refresh the desktop tier

### What happens

`account-app/src/app/checkout/complete/ClientNotify.tsx` posts this message on success:

```tsx
window.parent.postMessage(
  { type: "lc:checkout-complete", status: "success" },
  "*"
);
```

There is **no listener** anywhere in `desktop/src` for `lc:checkout-complete`.

### Why it matters

- `useTier()` intentionally no longer refreshes on window focus (P0 keychain directive). It relies on explicit refresh signals: `lc:tier-refresh`, explicit `refreshTier()` calls, or the upgrade panel close handler.
- If a user upgrades inside the desktop auth-panel webview, the panel close handler *does* call `/sync` and dispatches `lc:tier-refresh` (`App.tsx` lines 393–406 and `GlobalAuthPanel` lines 2428–2465). That path works.
- But if the user upgrades in a standalone browser tab, or if the webview navigates to checkout directly without the panel-close path firing, the desktop never learns the tier changed. The user can pay and still see locked features, watermark exports, and upgrade walls.

### Evidence

```bash
rg "lc:checkout-complete" desktop/src
# No matches.
```

### Fix needed

Add a `window.addEventListener("message", …)` listener in `App.tsx` (or the auth-panel Rust layer) that:

1. Verifies `event.data?.type === "lc:checkout-complete"`.
2. Calls `refreshTier()` (from `useTier`) or directly hits `/sync` + `/me`.
3. Dispatches `lc:tier-refresh` with the normalized tier so all consumers update.
4. Calls `sidecar.tierInvalidate()` to clear the 10-minute watermark cache.

Security note: verify `event.origin` is `https://liquidclips.app` (or the configured `ACCOUNT_HOST`) before trusting the payload.

## 4. Critical bug: upgrade CTAs can strand a signed-out user

### What happens

Several surfaces call `openAuthPanel("upgrade")` without checking whether the desktop has a valid session:

| Surface | File | Line | CTA copy |
|---------|------|------|----------|
| Settings free banner | `Settings.tsx` | 446 | "Upgrade to Solo" |
| SubscriptionAction | `Settings.tsx` | 1220 | "Upgrade →" |
| Community locked room | `CommunityTab.tsx` | 306 | "Upgrade →" |
| PublishModal upgrade wall | `PublishModal.tsx` | 711 | "Upgrade to {tier} →" |

For a **signed-in** user these are correct: the upgrade panel loads `/upgrade`, Clerk/Whop checkout runs, and on success the tier refreshes.

For a **signed-out** user these are broken:

1. `openAuthPanel("upgrade")` opens `https://liquidclips.app/upgrade` in the auth-panel webview.
2. The user can sign up and pay on the web.
3. But the desktop keychain has no `LICENSE_JWT`, so the app remains in state **A** (signed-out) even after money changes hands.
4. The user has paid for a subscription but still sees locked features.

### Why it matters

This is a money-strand: a user can give us revenue and receive no product. It violates the core invariant that "money/actions require authentication" because the auth we collect is web-only, not desktop-bound.

### Fix needed

Before opening the upgrade panel, ensure the desktop session exists:

```ts
function openUpgradeWithAuthFallback() {
  if (getCachedLicenseJwt()) {
    openAuthPanel("upgrade");
  } else {
    // Route through activation first; on success, open upgrade.
    void activate({ via: "browser" }).then(() => openAuthPanel("upgrade"));
  }
}
```

Because `activate()` is async and the user may complete it in a browser tab, the cleaner pattern is:

- Open `activate()` flow.
- Listen for `lc:desktop-auth-ready`.
- On that event, if an upgrade was requested, automatically open `openAuthPanel("upgrade")`.

This should be centralized so every surface (Settings, Community, Publish, ResultsGrid, ClipPreview, BottomCockpit, etc.) uses the same helper.

## 5. Signed-out dead-end copy

### 5.1 `RewardClipsPanel` — no action button

`desktop/src/components/earn/RewardClipsPanel.tsx` line 85:

```tsx
{state.kind === "signed-out" && (
  <EmptyShell hint="Sign in to see your reward clips." />
)}
```

There is no CTA. A signed-out user sees static text and no path forward.

### 5.2 `PayoutsView` — no action button

`desktop/src/components/earn/PayoutsView.tsx` lines 154–159:

```tsx
{signedOut ? (
  <Card padding="md" className="border-dashed">
    <p className="font-sans text-[13px] text-ink">
      Sign in to see your payout sources.
    </p>
  </Card>
) : …}
```

Again, static copy with no button.

### 5.3 Contrast: EarnTab handles this well

- `EarnTab.tsx` line 420: `<PayoutsGatedFallback auth={auth} onSignIn={onSignInClick} />`
- The fallback renders a card with eyebrow, title, body, and a "Sign in to Liquid Clips →" CTA.
- `AffiliateHero.tsx` line 266+: `SignedOutCard` also renders a "Sign in →" CTA when `onSignIn` is provided.

### Fix needed

Add a sign-in/activation CTA to both `RewardClipsPanel` and `PayoutsView` when in the signed-out state. Re-use `useActivation()` → `activate({ via: "browser" })` or the centralized helper proposed in §4.

## 6. Tier-refresh dependency risk

### Current refresh triggers

| Trigger | Source | Status |
|---------|--------|--------|
| Auth panel close | `GlobalAuthPanel` → `setUserTierGlobalEvent` | Works |
| Settings save | `Settings.tsx` (implied by `refreshTier` usage) | Works |
| Post clip-run | `App.tsx` / pipeline completion | Works |
| "I’ve upgraded — recheck" button | `App.tsx` line 1904 | Works, but requires user to find it |
| Checkout complete postMessage | `ClientNotify.tsx` | **Deadletter — no listener** |
| Window focus | Removed in v0.7.56 P0 | Intentionally gone |

### Risk

Because focus-refresh is gone, any upgrade path that does not go through the auth-panel close path depends entirely on explicit signals. The standalone checkout path is currently un-wired. Even the in-panel path has a subtle failure mode: if the webview crashes, closes unexpectedly, or the user refreshes the page, the close handler may not fire.

### Fix needed

- Add the `lc:checkout-complete` listener (§3).
- Consider adding a short-lived poll (e.g. every 30s for 2 minutes after the upgrade panel opens) that calls `/sync` **only while the panel is open and only if no keychain read is required**. Because `authedFetch` reads the keychain, this is only safe if the user is already signed in. Do not add passive keychain reads at boot.
- Optional: expose a "Refresh account" button in Settings → Account that explicitly calls `refreshTier()`.

## 7. Boot / activation flow analysis

### Boot check (`App.tsx` lines 598–604)

```ts
const { present } = await sidecar.licenseJwtPresence();
setSignedIn(present);
```

- Correct: presence-only, no keychain read.
- Limitation: `signedIn` being `true` only means a JWT exists; it does not mean the JWT is valid (that is proven lazily on first `/sync` or `/me`).

### FirstRun (`desktop/src/components/FirstRun.tsx`)

- Card 01 is "Sign in to Liquid Clips" → `activate()`.
- Card 02 is OpenAI key (optional for paid users, required for Free).
- Failed activation shows `FailedLoginRescue` with browser fallback, session reset, and diagnostics copy.
- This is the correct canonical entry point for state A.

### `activate()` vs `openAuthPanel()`

| Function | File | Purpose | When to use |
|----------|------|---------|-------------|
| `activate()` | `lib/activation.ts` | Generates challenge, opens `/connect-desktop`, deep-links back, writes keychain, primes cache. | User needs to **bind this device** to an account. |
| `openAuthPanel("upgrade")` | `components/auth/useAuthPanel.ts` | Opens webview to `/upgrade`. | User is already signed in on desktop and wants to pay. |
| `openAuthPanel("dashboard")` | same | Opens webview to `/dashboard`. | User is signed in and wants to manage billing. |
| `openAuthPanel("payouts")` | same | Opens webview to `/dashboard#payouts`. | User is signed in and wants payout settings. |

The confusion between "activate" (device binding) and "upgrade" (paying) is the root cause of the strand in §4.

## 8. Community, Publish, and Settings specific notes

### Community tab (`CommunityTab.tsx`)

- Locked rooms show "Upgrade →" (line 346). Signed-out users will hit the strand described in §4.
- Admin-only rooms correctly show a static "Admin posts only" pill with no misleading CTA (lines 352–365).
- Fallback rooms correctly open the Whop community URL.

### Publish modal (`PublishModal.tsx`)

- `UpgradeWall` (line 641) calls `openAuthPanel("upgrade")` after `notifyPaywall`.
- Same signed-out strand risk.
- The paywall notification helper (`lib/paywallNotify.ts`) is purely for analytics and does not guard auth.

### Settings (`Settings.tsx`)

- Free banner "Upgrade to Solo" (line 446) and `SubscriptionAction` "Upgrade →" (line 1220) both call `openAuthPanel("upgrade")`.
- `sessionExpired` banner (lines 461–480) correctly uses `activate()` for re-activation, not `openAuthPanel`.
- Affiliate payouts section (lines 1007–1133) has a generic signed-out explainer with no CTA before the data loads; once data loads it routes to Stripe/Whop. The no-data path could also use a sign-in CTA.

## 9. Earn public-first model

`EarnTab.tsx` is the reference implementation for the "public browsing allowed" rule:

- `listPublicWhopBounties()` fires on mount with no auth (line 174).
- Personal/partner layer only loads when `getCachedLicenseJwt()` returns a JWT (line 214).
- Inline Start button gates through `onCardStart` → `activate({ via: "browser" })` when not ready (line 248).
- Payouts sub-tab renders `PayoutsGatedFallback` with a sign-in CTA (line 420).
- `AffiliateHero` renders `SignedOutCard` with a sign-in CTA (line 266).

**Recommendation:** do not change Earn public bounty logic. Use it as the template for the other surfaces.

## 10. Recommended fix plan (minimal, pre-v0.7.68)

The following changes are small, localized, and preserve the P0 "no passive keychain reads" invariant.

### P0 — must fix before v0.7.68

1. **Wire `lc:checkout-complete` to desktop tier refresh.**
   - File: `desktop/src/App.tsx`
   - Add a `message` event listener in the same useEffect block that listens for `lc:tier-refresh`.
   - Verify origin, then call `refreshTier()` / `syncStatus()` / `sidecar.tierInvalidate()` and update `userTier`.

2. **Block upgrade CTAs for signed-out users; route through activation first.**
   - Files: `Settings.tsx`, `CommunityTab.tsx`, `PublishModal.tsx` (and any other `openAuthPanel("upgrade")` callers).
   - Introduce a helper `openUpgradeWithAuthFallback()` that checks `getCachedLicenseJwt()`.
   - If no cache, call `activate({ via: "browser" })` and queue `openAuthPanel("upgrade")` on `lc:desktop-auth-ready`.
   - If cache exists, open upgrade panel immediately.

3. **Add sign-in CTAs to signed-out dead-end copy.**
   - File: `desktop/src/components/earn/RewardClipsPanel.tsx` line 85.
   - File: `desktop/src/components/earn/PayoutsView.tsx` lines 154–159.
   - Re-use the same activation helper from #2.

### P1 — should fix before v0.7.68

4. **Centralize the "upgrade with auth" helper.**
   - New file: `desktop/src/lib/upgradeWithAuth.ts`
   - Export `openUpgradeWhenSignedIn()` so future surfaces cannot accidentally call `openAuthPanel("upgrade")` directly.
   - Add an ESLint/comment guard if possible.

5. **Defensive refresh after unexpected auth-panel teardown.**
   - In `AuthPanel.tsx` or `App.tsx`, if the panel is closed after being open for >N seconds, call `refreshTier()` even if no success event was received. This catches browser-tab upgrades and webview crashes.

6. **Audit remaining `openAuthPanel("upgrade")` callers.**
   - `ResultsGrid.tsx:348`, `ClipPreview.tsx:393`, `UpgradeLockCard.tsx:48`, `BottomCockpit.tsx:189`, `clips-feed/ClipCard.tsx:296`, `clips-feed/ReactionControls.tsx:312`, `EarnPanelMount.tsx:290`.
   - Replace all with the centralized helper from #4.

### P2 — post v0.7.68

7. Add an explicit "Refresh account" row in Settings → Account that calls `refreshTier()`.
8. Instrument the activation → upgrade funnel with distinct PostHog events so we can detect strands in production.
9. Consider a backend webhook push to the desktop (e.g. WebSocket or polling endpoint) for tier changes, reducing reliance on postMessage.

## 11. Invariant check

After any fix, run:

```bash
cd /Users/dipdip/code/jnr
./scripts/assert-no-passive-keychain.sh
npm run test:invariant
```

No fix may introduce a keychain read that is not triggered by an explicit user action.

## 12. Summary

The architecture is sound: in-memory cache + presence mirror + explicit activation correctly prevents passive keychain reads. The remaining holes are at the **edges where money changes hands**:

- Checkout success does not reach the desktop.
- Upgrade CTAs do not verify desktop auth before opening the paywall.
- A few signed-out surfaces show static text instead of a recovery CTA.

Fixing #1 and #2 before v0.7.68 eliminates the two ways a paying customer can end up locked out of the product they just bought.
