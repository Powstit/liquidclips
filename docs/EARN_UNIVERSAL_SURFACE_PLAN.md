# Earn Universal Surface Plan

Date: 2026-06-13

Canonical repo: `/Users/dipdip/code/jnr`

Old working Earn source: `git show 73d1a2c~1:desktop/src/components/earn/EarnTab.tsx`

Current safe Earn source: `desktop/src/components/earn/EarnTab.tsx`

## Scope

This is a planning document only. Do not restore old Earn modules, build, install, commit, push, tag, release, update `latest.json`, or deploy until this plan is approved.

The v0.7.65 Earn work should keep the v0.7.64 auth/keychain contract:

- No passive macOS Keychain access on app launch, Earn open, focus, passive refresh, Settings Account open, polling, or Whop passive loads.
- No passive `sidecar.whopSessionStatus()`.
- No passive `sidecar.whopListBounties()` unless a safe in-memory session is ready.
- No hosted Earn webview.
- No `/sign-in?redirect_url=/dashboard`.
- Saved-session recovery must be an explicit user action such as "Continue session".

## High-Level Finding

The old Earn page is the better product surface, but its data boot path is unsafe for v0.7.64. The old `EarnTab.tsx` directly called `sidecar.whopSessionStatus()` and `sidecar.whopListBounties()` during bootstrap, and polled `sidecar.whopSubmission()` every 10 minutes. That must not be copied back as-is.

The current v0.7.64 Earn page is the safer auth shell. It uses cached JS auth plus `licenseJwtPresence()` to decide whether to show a "Continue your session to load earnings." state, and it routes bounty loading through `listWhopBountiesWithCachedSession()`. That shell should remain the outer contract.

Recommended direction: restore the old product modules inside the current v0.7.64-safe shell.

## Feature Matrix

| Feature | Exists in old Earn? | Exists in current v0.7.64? | Should restore? | Restore source file/component | Keychain risk | Implementation notes |
|---|---|---|---|---|---|---|
| EarnIconRail tabs | Yes. Old `EarnTab.tsx` mounted `EarnIconRail` with `available`, `in_progress`, `submissions`, `payouts`, and `leaderboard` sub-tabs. | Component exists, but current `EarnTab.tsx` does not mount it. | Yes. | Current `desktop/src/components/earn/EarnIconRail.tsx`; old wiring from `73d1a2c~1:desktop/src/components/earn/EarnTab.tsx`. | Low if tab changes only update local React state. The rail's affiliate popover can indirectly mount `AffiliateHero`, so keep it cache-safe. | Add the rail inside the new universal shell. Use current explicit auth CTA. Do not let rail mount a component that triggers keychain recovery. |
| Open / in-progress / submissions / payouts / leaderboard states | Yes. Old `subTab` controlled all five product states. | Mostly absent from current `EarnTab.tsx`; current page has one campaigns section plus auth banners. `Leaderboard.tsx` exists but is not mounted. | Yes. | Old `EarnTab.tsx` state model, current existing components, plus restored `PayoutsView.tsx`. | Medium. Open bounties and submissions previously called sidecar Whop RPCs passively. | Keep sub-tabs as UI state, but gate every Whop-backed tab behind `auth.kind === "ready"` and cached-token helpers. |
| BountyFilters/search | Yes. Old page had search, sort, platform filters, open-only toggle. | `BountyFilters.tsx` exists, but current `EarnTab.tsx` does not use it. | Yes. | Current `desktop/src/components/earn/BountyFilters.tsx`; old wiring from old `EarnTab.tsx`. | Low. Pure local filtering if the bounty list is already loaded safely. | Restore search/filter/sort around the cached bounty list. Keep filtering client-side. |
| BountyCard grid | Yes. Old available tab rendered a responsive `BountyCard` grid. | Yes, current `BountySection` renders a small grid of `BountyCard`. | Yes, expand to old behavior. | Current `desktop/src/components/earn/BountyCard.tsx`; old grid/list logic from old `EarnTab.tsx`. | Low after data is loaded through cached-session helper. | Preserve current safe list loader; reattach old filter and selection behavior. |
| BountyDetail drill-in | Yes. Old page opened `BountyDetail` when `activeBountyId` was set. | Component exists, but current `EarnTab.tsx` does not drill in. | Yes. | Current `desktop/src/components/earn/BountyDetail.tsx`; old active-bounty wiring from old `EarnTab.tsx`. | Medium. Detail refresh may call `sidecar.whopBounty(id)` in other surfaces. That must not happen without cached auth. | Add or reuse a `getWhopBountyWithCachedSession(id)` helper that passes the cached JWT to sidecar. If no cache, return "Continue session" instead of calling sidecar. |
| Connected platform/channel status | Yes. Old `ConnectionBadge` used `authSource` from `whopSessionStatus()`. | Partial. Current auth banners show signed-out/continue/expired states; no full platform/channel status. | Restore partially. | Old `ConnectionBadge` concept, not its passive source. | High if restored from `whopSessionStatus()`. | Rebuild status from safe sources only: in-memory license JWT, presence mirror, local Whop connection metadata/cache if available. Live verification needs an explicit "Check connection" or "Continue session" click. |
| Start bounty flow | Yes. Old `BountyCard` actions and in-progress project tab supported starting and resuming campaigns. | Partial. Current `BountyCard` shows bounties but the old multi-state workflow is not mounted. | Yes. | Current `BountyCard.tsx`, `BountySourceSetup.tsx`, `BountyWorkspaceHeader.tsx`, `CampaignContextStrip.tsx`, `SubmissionPortal.tsx`, `TrackedSubmissions.tsx`; old `EarnTab.tsx` wiring. | Medium. Starting may need user-specific Whop/brief data. | Treat "Start" as explicit user action. It may call auth/keychain recovery only after the click, or use cached token if already ready. |
| Manual bounty paste/link flow | Yes. Old page mounted `ManualBountyPrompt` and had `addUrl` flow. | Only a small manual-entry hint exists. `ManualBountyPrompt.tsx` still exists. | Yes. | Current `desktop/src/components/earn/ManualBountyPrompt.tsx`; old manual state and handlers. | Low if it only validates/parses user-provided links. Medium if it calls Whop detail. | User paste is explicit action. Any Whop lookup after paste is allowed only through cached session or after an explicit continue/connect action. |
| Submissions / status polling | Yes. Old page stored local submission IDs and polled `sidecar.whopSubmission()` every 10 minutes. | Components exist (`TrackedSubmissions.tsx`, `SubmissionPortal.tsx`, local submission libs), but current `EarnTab.tsx` does not mount the old submissions tab. | Yes, but change the data model. | Current `TrackedSubmissions.tsx`, `SubmissionPortal.tsx`, `desktop/src/lib/submissions.ts`; old `SubmissionsView` logic from old `EarnTab.tsx`. | High. Old passive polling can hit Whop sidecar RPCs. | Do not restore passive polling. Load local tracker data freely. Remote status refresh must be gated by `auth.kind === "ready"` and cached JWT, or triggered by an explicit "Refresh status" action. |
| PayoutsView | Yes. Old `PayoutsView.tsx` was a dedicated Earn sub-tab. | Missing from current working tree. | Yes. | Restore `73d1a2c~1:desktop/src/components/earn/PayoutsView.tsx`, then update auth copy/gating. | Low-to-medium. It calls backend `meAffiliate()`, which is cache-only after v0.7.64, but it still passively fetches account data. | Safe if `authedFetch()` remains cache-only. If cache is empty, show "Continue session to load earnings" instead of implying sign-in failure. |
| Leaderboard | Yes. Old page mounted `Leaderboard` tab. | `Leaderboard.tsx` exists, not mounted in current `EarnTab.tsx`. | Yes. | Current `desktop/src/components/earn/Leaderboard.tsx`. | Low. It uses backend leaderboard fetch and preview fallback, not Keychain. | Mount behind the rail tab. If backend auth fails, keep existing preview/error behavior; do not trigger session recovery. |
| RewardClipsPanel | Yes. Old page mounted it below non-payout/non-leaderboard tabs. | Component exists, not mounted in current `EarnTab.tsx`. | Yes, if still product-relevant. | Current `desktop/src/components/earn/RewardClipsPanel.tsx`. | Low-to-medium. It checks `getCachedLicenseJwt()` before backend reward clip fetches. | Mount only when cache is ready or ensure its signed-out state says "Continue session" and never attempts recovery. |
| AffiliateHero | The old file comment references it, but old `EarnTab.tsx` mainly uses the rail affiliate popover. | Yes. Current `EarnTab.tsx` mounts `AffiliateHero` only when `auth.kind === "ready"`. | Keep current behavior; optionally expose through rail. | Current `desktop/src/components/earn/AffiliateHero.tsx` and `AffiliateHeroPopover`. | Low if mounted only with cache-ready auth. Medium if mounted passively without cache because it calls `meAffiliate()`. | Keep v0.7.64 gating. Update signed-out copy to "Continue session" where needed. |
| SponsoredBannerCarousel | Yes. Old page mounted it above the main bounty tabs. | Yes. Current page mounts it unconditionally. | Keep. | Current `desktop/src/components/earn/SponsoredBannerCarousel.tsx`. | Low. Public campaigns carousel and local timer only. | Keep visible even when auth is not ready so sponsored campaigns still show. |
| Whop connect state | Yes. Old state used `whopSessionStatus()` and showed connected/expired/signed-out status. | Partial. Current page has safe signed-out/continue/expired/unauthenticated states. | Restore visual clarity, not old data source. | Current auth shell plus a rewritten safe `ConnectionBadge`. | High if it calls `whopSessionStatus()` or token source passively. | Use `getCachedLicenseJwt()` and `licenseJwtPresence()` only. If live Whop verification is needed, show explicit "Check connection" / "Continue session". |
| Empty/loading/error states | Yes. Old page had loading, empty, error, retry, manual paste, and signed-out surfaces. | Yes, but simplified around one bounty list. | Yes, merge. | Current safe auth/data states plus old empty/error variants. | Medium if retry calls unsafe sidecar methods. | Retry buttons are explicit actions, but passive retry on focus/mount must remain cache-gated. Empty states should preserve manual paste and sponsored campaigns. |
| Responsive layout | Yes. Old `EarnLayout.tsx` provided ticker, left rail, main area, and collapsible right sidebar under 1100px. | Current page is a simpler stacked scroll layout. | Yes, with minimal adaptation. | Restore `73d1a2c~1:desktop/src/components/earn/EarnLayout.tsx`, `EarnTickerStrip.tsx`, and `EarnSidebar.tsx`. | Low. Layout-only, but sidebar children may fetch. | Use old structure as the universal shell: left rail, main content, right status/detail panel. Mobile/narrow widths should collapse to stacked cards or hide the sidebar without triggering new fetches. |

## Recommended Build Shape

Keep the current v0.7.64 shell as the auth boundary:

- `probe()` may read only in-memory JS cache and safe presence mirror.
- If `getCachedLicenseJwt()` is empty but `licenseJwtPresence()` is true, show "Continue your session to load earnings."
- Sponsored campaigns can remain visible before auth is ready.
- Affiliate/user-specific panels mount only when the cache is ready, or render a safe continue state.

Restore the old Earn product surface inside that boundary:

- Add the old `EarnLayout` spine: top ticker, left `EarnIconRail`, central content, optional right status/detail panel.
- Restore the five sub-tabs: available, in-progress, submissions, payouts, leaderboard.
- Restore old filtering/search, detail drill-in, manual paste, local submissions, payouts, leaderboard, and reward clips.
- Treat old bootstrap code as a reference for UI wiring only. Do not restore its passive sidecar calls.

The universal layout should be:

- Left: `EarnIconRail` for Earn modes and affiliate popover.
- Main: sponsored campaigns, open bounty grid, filters/search, detail drill-in, start/manual flows, submissions, payouts, or leaderboard depending on selected tab.
- Right: local status, saved briefs, active brief, tracked submissions, or selected bounty context when useful.
- Mobile/narrow: collapse right panel and stack cards below the main content.

## Safe Data Contracts Needed

Before or during implementation, add small wrappers rather than calling sidecar Whop RPCs directly from UI:

- Keep `listWhopBountiesWithCachedSession(first)` for open bounty lists.
- Add `getWhopBountyWithCachedSession(id)` if `BountyDetail` needs live details.
- Add `getWhopSubmissionWithCachedSession(id)` only if remote submission status is needed.
- Keep local tracker reads (`useSubmissions`, `useBriefs`, saved briefs, project state) available without auth.
- Keep backend calls behind `authedFetch()` cache-only behavior; empty cache should render "Continue session" copy, not recover from Keychain.

The UI must not call these directly in passive paths:

- `sidecar.whopSessionStatus()`
- `sidecar.whopListBounties()`
- `sidecar.whopBounty()`
- `sidecar.whopSubmission()`
- any sidecar method that internally calls `get_secret()` or `token_source()`

## Suggested Implementation Sequence After Approval

1. Restore layout files from `73d1a2c~1`: `EarnLayout.tsx`, `EarnTickerStrip.tsx`, `EarnSidebar.tsx`, and `PayoutsView.tsx`.
2. Refactor current `EarnTab.tsx` into a universal shell that preserves v0.7.64 auth states and the `EARN SURFACE` marker.
3. Reintroduce `EarnIconRail` and sub-tab state without adding data fetches.
4. Reintroduce available campaign search/filter/grid using `listWhopBountiesWithCachedSession()`.
5. Reintroduce detail/start/manual flows behind cached-session helpers or explicit user action.
6. Reintroduce submissions using local tracker data first; add explicit or cached-session remote refresh only if needed.
7. Reintroduce payouts, leaderboard, reward clips, and affiliate popover with cache-safe signed-out/continue states.
8. Extend IG-014 invariant tests so passive Earn files cannot directly call sidecar Whop RPCs.
9. Bump version only when implementation is complete and locally accepted.

## Acceptance Checklist For v0.7.65

- Fresh app launch causes no macOS Keychain prompt.
- Opening Earn causes no macOS Keychain prompt.
- Focusing the app causes no macOS Keychain prompt.
- Passive tab changes cause no macOS Keychain prompt.
- Sponsored campaigns still show before session recovery.
- Saved-session presence shows "Continue session" or equivalent.
- Clicking Continue/Refresh/Connect is explicit user action and may recover auth.
- Open campaigns render with filters/search.
- Bounty detail opens without using passive Keychain recovery.
- In-progress, submissions, payouts, leaderboard, reward clips, and affiliate surfaces render safe states.
- No hosted account-app Earn webview.
- No `/sign-in?redirect_url=/dashboard`.
- No black screen.

