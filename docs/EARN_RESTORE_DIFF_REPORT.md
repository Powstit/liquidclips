# Earn Restore — Forensic Diff Report

> Generated 2026-06-13 against the canonical repo `/Users/dipdip/code/jnr`.
> No code was edited to produce this report.

## Sources compared

| Side | Path | Lines | Version |
|---|---|---|---|
| **CURRENT** | `/Users/dipdip/code/jnr/desktop/src/components/earn/EarnTab.tsx` (uncommitted, on `main`) | 581 | v0.7.62 |
| **OLD WORKING** | `git show 73d1a2c~1:desktop/src/components/earn/EarnTab.tsx` | 885 | v0.6.41 era (commit before the webview-embed turn) |

Both are real native React renders. The intermediate `f73084c` (v0.7.56) HEAD has only the 81-line webview wrapper that mounts `EarnPanelMount`; it is NOT the lineage we are restoring from. The lineage is OLD (`73d1a2c~1`) → 81-line wrapper (`73d1a2c` → `f73084c`) → CURRENT native rewrite (`f73084c` + uncommitted v0.7.62 work).

---

## 1. Liquid Clips auth — OLD Earn

Old Earn never touched the keychain from React. Its single auth probe was a sidecar RPC:

```ts
// /tmp/earn_old.tsx:117
const s = await sidecar.whopSessionStatus();
setAuthed(s.junior_activated);
setAuthSource(s.whop_desktop_oauth_source);
```

* **`useActivation()` used?** Yes — but only inside the `ActivateJuniorSplash` sub-component, fired by the explicit "Activate Liquid Clips →" button. Old Earn did NOT call `activate()` automatically on mount.
* **`sidecar.licenseJwtRead()` used?** No — directly. Old Earn relied on the sidecar Python `whopSessionStatus()` method to do its own activation/keychain check server-side.
* **Cached JWT used?** No. The `getCachedLicenseJwt()` / `primeLicenseJwtCache()` model did not exist yet (introduced v0.7.58 P0 per `authStorage.ts:48` comment).
* **`authedFetch()` used?** No. Old Earn went sidecar → backend proxy (server-side App API Key); the React side never built an `Authorization: Bearer` header itself.
* **Depended on Clerk cookies?** No. The only Clerk dependency was inside the activation deep-link path — and only when the user explicitly clicked Activate.
* **Depended on a webview?** No. The Whop iframe path (`inWhopIframe()`) existed as a separate render branch but was disabled in desktop builds.

The probe answer was a single boolean (`junior_activated`) — true → render data UI immediately; false → render `ActivateJuniorSplash`.

---

## 2. Whop auth/status — OLD Earn

* **Load function for Whop auth status:** `sidecar.whopSessionStatus()` returned `{ junior_activated, whop_desktop_oauth_source }`. The OAuth-source field drove the `ConnectionBadge` ("connected · env", "connected · standalone key", "dev mode · seller key", "whop iframe · preview", "Sign in with Whop").
* **Whop sign-in CTA:** `ConnectionBadge` with `source === "none"` rendered an inline "Sign in with Whop →" button that dispatched `window.dispatchEvent(new CustomEvent("lc:open-settings", { detail: { section: "connections" } }))` — Settings drawer owned the actual Whop OAuth flow (kept session lifecycle in one place).
* **Unauthenticated-Whop handling:** Old Earn distinguished four sources (`iframe`, `env_user`, `keychain`, `seller_key`, `none`) and rendered them differently. The "none" case was the only one that prompted action; the other four just badged status and let bounty loading proceed.
* **Whop iframe failure mode:** `WhopIframeFailed` component rendered when `inWhopIframe()` was true and the postMessage bridge timed out — offered Retry + "Open Liquid Clips in Whop" link.

---

## 3. Bounty loading — OLD Earn

* **List load:** `sidecar.whopListBounties(25)` — single call inside `bootstrap()`. Twenty-five was the GraphQL-complexity cap; detail fetches went per-id (`whopBounty(id)`).
* **Add by link:** `extractBountyId()` parsed pasted Whop URLs or raw `bnty_…` IDs, then `sidecar.whopBounty(id)` fetched the single reward and routed to `onStartBounty(bounty)`.
* **Client-side filter/sort:** `matchesFilter()` + `sortBounties()` from `./types`, fed by `filterPlatforms`, `openOnly`, `search` (free text), `sort` (`best_match` / etc.). Whop's public bounties query has no text search, so old Earn pulled a wider pool and filtered locally.
* **Error surfacing:** `bountyError` state held the real backend error message and rendered a red card with a `<pre>` block + Retry + "Paste a reward manually →" — never silently flipped back to the auth splash.
* **Stuck-spinner fail-safe:** `setTimeout(() => setAuthed((c) => c === null ? false : c), 8000)` forced the splash if `bootstrap()` neither resolved nor rejected in 8s.
* **In-progress local list:** `sidecar.listBountyProjects()` returned `BountyProjectSummary[]` for local-disk bounty-linked projects, rendered as `BountyProjectCard` rows with "Resume →" in the `in_progress` sub-tab.

---

## 4. Connected platforms / channels — OLD Earn

* `BountyFilters` exposed a platform multi-select (`filterPlatforms: ConnectedPlatform[]`) that filtered the bounty grid by which platforms the user could publish to.
* The `ConnectedPlatform` selection was also passed into each `BountyCard` (`connectedPlatforms={filterPlatforms}`) so the card could badge platform alignment.
* Connected-platform STATUS (Instagram/TikTok/etc. channel rows) was NOT owned by old Earn directly — `Settings → Connections` (`ChannelsManager`) handled OAuth + status; old Earn only consumed the filter list.
* Channel-link confirmation (`junior:channel-linked` event) was wired in `activation.ts:134` — same as v0.7.62 — but old Earn didn't subscribe to it.

---

## 5. Start-a-bounty flow — OLD Earn

* `onStartBounty(bounty)` — passed up to App.tsx, which owned the view-state machine. Triggered from:
  * `BountyCard.onStart` (the "Start →" button on a card)
  * `BountyDetail` drill-in (after `setActiveBountyId(b.id)`)
  * `handleAddByLink()` after a successful `whopBounty(id)` fetch
  * `ManualBountyPrompt` modal (via `onStartManualBounty(b, sourceUrl)`)
* `setActiveBountyId(b.id)` opened `BountyDetail` inline — full-page replacement of the listing — with `<BountyDetail bounty={activeBounty} onBack={...} onStart={...} />`. Old Earn rendered THIS instead of the grid when `activeBounty` was non-null.

---

## 6. Submissions / in-progress / status polling — OLD Earn

* **Submission ID store:** `junior:my-whop-submissions:v1` in `localStorage` (50-entry cap). `rememberSubmissionId(id)` was called by `PublishModal` + `BountySubmissionCapture` whenever a Whop post was made.
* **Submission polling:** `refreshSubmissions()` walked the stored IDs and called `sidecar.whopSubmission(id)` per entry, collected results. Triggered on mount (inside `bootstrap()`) AND on a 10-minute `setInterval` while the tab was mounted (`useEffect` keyed on `authed`).
* **Submissions sub-tab UI:** `SubmissionsView` with `HudChip` filter (`all`/`submitted`/`approved`/`denied`/`paid`), per-row status colour treatment, denial-reason surfacing, "auto-approves in Xh" hint, payout column with currency-symbol formatting.
* **Status timestamp:** `lastChecked: Date | null` rendered as "polled Xs ago · auto-refresh every 10 min".
* **In-progress sub-tab:** Sidecar-disk list of resumable bounty projects (`listBountyProjects` RPC), rendered as `BountyProjectCard` rows.

---

## 7. Modules removed or bypassed in v0.7.62

| Module | Status in v0.7.62 | Notes |
|---|---|---|
| `EarnIconRail` | **Removed** | Old `EarnLayout` had a vertical sub-tab rail (Available / In progress / Submissions / Payouts / Leaderboard). v0.7.62 collapsed to a single scrollable column. |
| `BountyDetail` | **Removed** | Click on a bounty card now calls `onStartBounty` directly — no inline detail view. |
| `PayoutsView` | **Removed** | No payouts surface in v0.7.62. |
| `Leaderboard` | **Removed** | No leaderboard surface in v0.7.62. |
| `RewardClipsPanel` | **Removed** | No tracking-links / generated-clips list at the bottom. |
| `BountyFilters` | **Removed** | No sort, no platform multi-select, no open-only toggle. |
| `ManualBountyPrompt` (modal) | **Removed** | Replaced by `ManualEntryHint` collapsible hint that defers to the Workspace import bar. |
| `EarnLayout` / `EarnSidebar` / `EarnTickerStrip` | **Removed** | Whole shell layout collapsed. |
| `ConnectionBadge` | **Removed** | No Whop session-source surfacing. |
| `inWhopIframe()` / `WhopIframeFailed` | **Removed** | Iframe path gone (v0.7.62 is desktop-only). |
| `ActivateJuniorSplash` | **Removed** | Banners now render inline; no full-page splash. |
| Search input | **Removed** | No text search across bounties. |
| Paste-link add bounty | **Removed** | No `addUrl` / `whopBounty(id)` / `extractBountyId` flow. |
| `bountyProjects` (in-progress local list) | **Removed** | No `listBountyProjects()` call. |
| 10-min submission polling | **Removed** | No `refreshSubmissions()`, no interval. |
| `whopSessionStatus` probe | **Bypassed** | Replaced by `getCachedLicenseJwt()` + `licenseJwtPresence()`. |
| `connectedPlatforms` on `BountyCard` | **Stubbed** | `connectedPlatforms={[]}` literal at line 459. |
| 8-second stuck-spinner timer | **Removed** | No fail-safe if `licenseJwtPresence()` hangs. |
| `bountyError` red card with `<pre>` | **Removed** | Error rendered as a `FallbackCard` with the message in plain copy. |
| `BountyProjectCard` | **Removed** | No resume flow on Earn. |
| `SubmissionsView` + `SubmissionRow` | **Removed** | No submission tracking UI. |
| `lc:open-settings` event | **Replaced** | v0.7.62 dispatches `lc:settings-open-tab` with `detail: { tab: "connections" }`. |

What v0.7.62 ADDED:

* `EarnAuthState` 5-state union (`checking` / `signed-out` / `refresh-needed` / `expired` / `ready`).
* `SignInBanner` / `RefreshSessionBanner` / `ExpiredBanner` with cockpit-tile + fuchsia tone styling.
* `EarnErrorBoundary` wrapper (per-section failure containment, per file header).
* `setOnUnauthorized()` 401 self-heal hook → flips to `expired`.
* `lc:tier-refresh` + `focus` + `junior:whop-auth` re-probe listeners.
* `activate({ via: "browser" })` activation flow via `useActivation()`.
* `EARN SURFACE: native EarnTab v0.7.62` visible test marker (line 156).
* `AffiliateHero` mount gated on `auth.kind === "ready"`.
* `SponsoredBannerCarousel` always-visible policy (unauth-safe public endpoint).
* `FallbackCard` with `cockpit-tile-corner` brackets.

---

## 8. Why v0.7.62 sticks in `Refresh your session to load earnings`

The journey through `EarnTab.tsx:90` `probe()`:

```ts
const cached = getCachedLicenseJwt();
if (cached) { setAuth({ kind: "ready" }); return; }
const r = await sidecar.licenseJwtPresence();
setAuth(r.present ? { kind: "refresh-needed" } : { kind: "signed-out" });
```

Compared against `authStorage.ts:69` — `_jwtCache` is a **module-scope variable that resets to null on every cold launch of the app**. It is populated ONLY by the four explicit auth actions per `authStorage.ts:109`:

> AUTH-ACTION ONLY — prime the in-memory cache from a known-good JWT obtained by one of the five explicit auth actions: Sign in / Sign out re-mint / Reconnect account / Connect-desktop callback / Reset login session.

Concrete consequence at app startup:

1. App boots. `_jwtCache = null`.
2. EarnTab mounts. `getCachedLicenseJwt()` → null.
3. `sidecar.licenseJwtPresence()` reads the presence-mirror file (NOT the keychain — IG-014 forbids passive keychain reads). The file says `present: true` because a prior session left a real JWT in the keychain.
4. `setAuth({ kind: "refresh-needed" })`. Banner renders. Bounty section locks to "Refresh your session to see live bounties." card.
5. The cache stays null UNTIL the user clicks Refresh, browses to `liquidclips.app/connect-desktop`, completes Clerk, hits the deep-link approval, AND the deep-link handler successfully runs `primeLicenseJwtCache(token)` in `activation.ts:166`.

That is the loop. Each individual hop is functional; the design intentionally requires the user to re-mint a JWT on every cold launch.

Concrete failure points to check against your specific stuck state:

| Hypothesis | Symptom | How to confirm |
|---|---|---|
| (a) Cache empty + presence true is the normal cold-start state | "Refresh your session to load earnings" on every fresh launch | Quit app → relaunch → see banner immediately. This is the design, not a bug. |
| (b) Deep-link return doesn't fire | Click Refresh → browser opens → Clerk → app shows macOS "Open Liquid Clips?" → click Open → banner STILL says refresh-needed | `defaults read app.liquidclips.desktop` for log lines mentioning `handleDeepLink` / `pendingChallenge mismatch`. Old `pendingChallenge` from a prior abandoned attempt could cause challenge mismatch on the new return. |
| (c) primeLicenseJwtCache fires but `licenseJwtPresence()` reads from a stale namespace | Banner clears momentarily then snaps back to refresh-needed | `security find-generic-password -s app.liquidclips.auth.v1 -a LICENSE_JWT` returns the new token, but the presence file in `~/Library/Application Support/.../jwt_presence` is in the old namespace. IG-014 namespace migration check. |
| (d) `focus` listener doesn't fire on browser hand-off | Banner stays refresh-needed but a manual cmd-tab or click-into-window flips it to ready | macOS sometimes withholds focus events when an external opener (browser) re-foregrounds the app. The OLD Earn solved this via `junior:whop-auth` event dispatched directly by `whop-iframe.ts` AND a 10s stuck-timer fail-safe — both are wired in v0.7.62 (`EarnTab.tsx:113-114`) but worth tracing. |
| (e) sidecar Python `licenseJwtPresence` returns true even when keychain is empty | Banner shows refresh-needed forever; Refresh CTA opens browser, mints token, but next launch starts the loop again | Presence file is the source of truth and may have desynced from real keychain state on a prior crash. Delete the presence file → relaunch → should now show `signed-out` banner (then sign-in works fresh). |

The pasted PASS/FAIL audit from the prior agent confirms hypothesis (a) is the current observed state and steps 6–10 in their hand-walk are gated on the user actually completing the browser → deep-link return. The screen will stay in `refresh-needed` until that hand-walk lands — by design.

What this means for your "Earn does not behave like the product should" report: it's not that the auth code is broken; **the new model REQUIRES the user to re-mint a JWT on every cold launch**, while the old model trusted whatever the sidecar said was already in the keychain. That trip — through Refresh → browser → Clerk → deep link → cache primed — is the new friction floor.

---

## 9. Why old Earn avoided the loop

Yes — by design difference, not by accident.

* Old Earn used **sidecar-side activation check** (`sidecar.whopSessionStatus()`). The sidecar is Python, uses `keyring`, reads the OS keychain directly. Python `keyring` does NOT trigger the macOS "Liquid Clips wants to access keychain item LICENSE_JWT" prompt the way Tauri's secret store would for a rebuilt binary — Python is its own keychain client identity. So the sidecar could freely check "do I have a valid JWT?" without bothering the user.
* On `junior_activated === true`, old Earn called `sidecar.whopListBounties(25)` directly. The sidecar attached the JWT to the backend proxy call server-side. The React layer never needed a JS-visible JWT to render the bounty grid.
* The OS-keychain-prompt avoidance that IG-014 enforces is a JS-side problem: Tauri's `secretGet` triggers the prompt because Tauri identifies as a different keychain client than the Python sidecar. The fix was to ban JS-side `secretGet` outside auth actions — but the OLD Earn never used JS-side `secretGet` in the first place. It went around the JS keychain entirely via the sidecar.
* So old Earn's data path was: mount → sidecar status (no prompt) → bootstrap list (no prompt) → render. Three steps, zero browser detours, zero deep-link handoffs.
* New Earn's data path is: mount → JS-cache null → presence file → banner → wait for user → browser → Clerk → deep-link → cache primed → focus refresh → bootstrap → render. Nine steps, two browser tabs, one macOS approval dialog.

**The OLD model used a different auth source for the data path — the sidecar — and bypassed the JS-side JWT requirement entirely for read-only operations.**

---

## 10. Recommendation

Daniel's stated preference: **C — hybrid (keep new shell + copy, restore old working data/state engine).**

The code supports C as the right call, with one specific augmentation. Here is why each path lands where it does:

### A — Patch v0.7.62 auth/Whop only

Tractable. Two changes:

1. Add a sidecar-side check to `probe()`: if `getCachedLicenseJwt()` is null AND `licenseJwtPresence()` is true, call `sidecar.whopSessionStatus()`. If `junior_activated === true`, set `auth.kind = "ready"` WITHOUT requiring the JS cache. Then `BountySection.load()` works because it routes through `sidecar.whopListBounties()` — sidecar-side, no JS JWT required.
2. Restore `bountyError` surfacing on the bounty section so a backend-proxy failure shows the real reason instead of a generic FallbackCard.

This removes the cold-start Refresh-loop without bringing back any of the removed modules. AffiliateHero is still gated on cache because `meAffiliate()` is a JS-side `authedFetch` — and the only fix there is sidecar-side proxy OR an explicit "read keychain once on mount with explicitAuthAction=true" (violates IG-014's intent).

**Verdict:** ships the smallest possible change that closes the loop, but the Earn surface stays vastly thinner than the old one. Daniel's product complaint ("Earn does not behave like the product should") is mostly about feature loss, not just the auth loop — A doesn't address that.

### B — Restore old EarnTab as baseline, then reapply new styling

Drops the 581-line v0.7.62 and restores the 885-line old file. Then re-skin with cockpit-tile brackets, the new banners, the `data-testid="earn-surface-marker"`, the EarnErrorBoundary, etc.

**Verdict:** brings back every removed module but throws away:

* The 5-state auth model (checking/signed-out/refresh-needed/expired/ready) — which IS valuable for the cold-start UX
* The `setOnUnauthorized` 401 self-heal hook
* The `EarnErrorBoundary` per-section containment
* The Customer Journey Map mapping (banners locked to `docs/EARN_CUSTOMER_JOURNEY.md`)
* IG-014 compliance — old Earn predates the keychain invariant; restoring it wholesale would re-introduce the keychain-prompt regression IG-014 was created to prevent

The IG-014 conflict is the dealbreaker for pure B. The old code itself doesn't read the keychain from JS, but it depends on `whopSessionStatus()` returning `junior_activated` that's TRUSTED — and any reskin work would tend to creep auth checks back into the JS layer.

### C — Hybrid (Daniel's pref): new shell + copy, old data/state engine

The right call. The 581-line shell already has the right product framing — banners, copy, marker, `auth.kind` model, error boundary, sponsored carousel always-visible policy. What it lacks is the data/state machinery that made the old Earn feel like a workspace.

Hybrid plan, code-level:

| Keep from v0.7.62 (the shell) | Restore from old Earn (the engine) |
|---|---|
| `EarnAuthState` 5-state union | `sidecar.whopSessionStatus()` augmentation of `probe()` — fixes hypothesis (a) cold-start loop |
| `SignInBanner` / `RefreshSessionBanner` / `ExpiredBanner` | `bountyError` surfacing (red card + `<pre>` + Retry + Paste manually) |
| `EarnErrorBoundary` wrapper | 8-second stuck-spinner fail-safe |
| `setOnUnauthorized` 401 self-heal | Search input over fetched bounties |
| `lc:tier-refresh` + `focus` + `junior:whop-auth` re-probes | Paste-link add-by-link flow (`extractBountyId` + `whopBounty(id)`) |
| `useActivation({ via: "browser" })` for the Refresh CTA | `BountyFilters` (sort + platform multi-select + open-only) |
| `EARN SURFACE: native EarnTab v0.7.62` marker (delete after sign-off) | `BountyDetail` drill-in (replaces grid when `activeBountyId !== null`) |
| `AffiliateHero` gated on `ready` | `BountyProjectCard` in-progress list via `listBountyProjects()` |
| `SponsoredBannerCarousel` always-visible | `SubmissionsView` + 10-min submission polling |
| `FallbackCard` with cockpit-tile corner brackets | `EarnIconRail` sub-tabs (Available / In progress / Submissions / Payouts / Leaderboard) — or a v0.7.62-styled equivalent |
| `ManualEntryHint` collapsible details | `PayoutsView`, `Leaderboard`, `RewardClipsPanel` mounts |
| Cockpit-tile fuchsia palette | `ConnectionBadge` (re-styled — kept for "Sign in with Whop" CTA when source === "none") |

The single critical augmentation is making `probe()` look like:

```ts
const cached = getCachedLicenseJwt();
if (cached) return setAuth({ kind: "ready" });

const present = await sidecar.licenseJwtPresence();
if (!present) return setAuth({ kind: "signed-out" });

// New step — sidecar-side trust check before insisting on JS-cache prime
try {
  const s = await sidecar.whopSessionStatus();
  if (s.junior_activated) {
    return setAuth({ kind: "ready" });  // sidecar will attach JWT for whopListBounties
  }
} catch { /* fall through to refresh-needed */ }

setAuth({ kind: "refresh-needed" });
```

That single change closes the cold-start loop while preserving every IG-014 contract — the JS layer never reads the keychain; the sidecar does.

The remaining hybrid work is mechanical re-mount of removed components into the new shell, with new styling applied. Sub-tabs (`EarnIconRail`-equivalent) should match the cockpit-tile language already established in `FallbackCard`.

### Recommendation: **C**, with the `probe()` augmentation as the first step

C addresses both the cold-start `refresh-needed` loop AND the feature-loss complaint. A only addresses the loop. B addresses features but regresses on IG-014 and the journey-map model.

C's first commit should be the `probe()` augmentation in isolation — that alone unblocks the bounty list on every cold start where the keychain already has a valid JWT. The rest of the hybrid (sub-tabs, submissions, payouts, leaderboard, filters, search, paste-link, in-progress) lands incrementally on top of that working baseline.

---

## End

Report complete. No code edits made. No build, install, tag, release, or `latest.json` change. Awaiting Daniel's go on path C (or alternate).
