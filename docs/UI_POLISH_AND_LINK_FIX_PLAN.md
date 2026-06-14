# UI / Link / Social / Customer-Journey Polish Fix Plan

**Repo:** `/Users/dipdip/code/jnr` (canonical only)  
**Source audit:** `docs/CUSTOMER_JOURNEY_UI_DEAD_END_AUDIT.md`  
**Scope:** P1/P2 polish items only. Excluded from this plan:
- Earn v0.7.68 public-bounty architecture work.
- P0 auth fixes assigned to Kimi Agent 1 (re-activation flow, account-app sign-out, etc.).
- Builds, releases, commits, pushes, tags, deploys.

**Goal:** Produce a minimal, surgical fix plan for UI/link/social/customer-journey dead ends. No code changes are part of this document.

---

## 1. Instagram / social icons

### 1.1 Confirm Instagram works
- **Priority:** P2 (verification / no-op if confirmed)
- **File / component:** `desktop/src/components/PlatformIcon.tsx`, `desktop/src/components/upload/ClipReadyCard.tsx`, surfaces: `PublishModal`, `ChannelPicker`, `ChannelRow`, `InlineScheduler`, `AccountBindingChip`, `LocalQueue`
- **Expected behaviour:** Instagram glyph renders consistently and connection state is live (active / pending / unlinked / error / paused) from `listChannels` + Ayrshare.
- **Current problem:** Audit shows no functional bug; `PlatformIcon` has a monochrome SVG glyph and `ClipReadyCard` uses `lucide-react` `Instagram`. Need explicit QA confirmation that the glyph renders and the status chip updates when the connection state changes.
- **Minimal fix:** No code change required. Add a QA checklist item: toggle an Instagram channel between active/error and confirm glyph + status update.
- **Risk:** None.
- **Can be fixed after v0.7.68:** Yes.

### 1.2 TikTok glyph fallback
- **Priority:** P2
- **File / component:** `desktop/src/components/upload/ClipReadyCard.tsx:43` (`PlatformGlyph`)
- **Expected behaviour:** TikTok shows the same brand glyph used elsewhere in the app.
- **Current problem:** `PlatformGlyph` falls back to a plain text "T" for TikTok while other platforms use Lucide or SVG brand marks.
- **Minimal fix:** Import `PlatformIcon` for TikTok (or inline the SVG path from `PlatformIcon.tsx:15-19`) inside `PlatformGlyph` so TikTok renders a brand glyph.
- **Risk:** Very low — purely visual; no state or logic change.
- **Can be fixed after v0.7.68:** Yes.

### 1.3 X / Twitter state
- **Priority:** P2
- **File / component:** `desktop/src/components/PlatformIcon.tsx:27`, `desktop/src/components/schedule/channelStatus.ts`, `desktop/src/lib/backend.ts`
- **Expected behaviour:** Backend stores `x`, Ayrshare may report `twitter`, and the UI reconciles both to a single connected state and renders the X glyph.
- **Current problem:** Audit says reconciliation is already implemented and works, but it is a latent breakage risk if any new call site forgets to normalize.
- **Minimal fix:** No code change required if audit is confirmed. Optionally add a defensive `platform === "x" || platform === "twitter"` helper in `channelStatus.ts` and enforce its use in any new consumer.
- **Risk:** Low.
- **Can be fixed after v0.7.68:** Yes.

### 1.4 YouTube state
- **Priority:** P2
- **File / component:** `desktop/src/components/PlatformIcon.tsx:9`, channel status logic across schedule/publish surfaces
- **Expected behaviour:** YouTube glyph renders and connection state is live.
- **Current problem:** Audit shows it works.
- **Minimal fix:** QA verification only.
- **Risk:** None.
- **Can be fixed after v0.7.68:** Yes.

### 1.5 Whop badge click behaviour
- **Priority:** P2
- **File / component:** `desktop/src/components/PoweredByWhop.tsx:19`, `account-app/src/components/embed/PoweredByWhop.tsx:24`
- **Expected behaviour:** Either the badge is intentionally non-clickable attribution (documented) or it opens the canonical Whop hub / product page.
- **Current problem:** No click handler exists. On the account-app dashboard, adjacent *Connect Whop* / *Open Earn in desktop* cards route to `/download` instead of Whop connect, which is a separate P0/P1 issue.
- **Minimal fix:**
  - Option A (recommended): Add an optional `onClick` prop defaulting to `https://whop.com/liquidclips/`. Wrap the span in a button when clickable so keyboard users can activate it.
  - Option B: Leave non-clickable but add an explicit code comment and `cursor: default` styling so future developers do not assume it is broken.
- **Risk:** Low. Option A could create an unexpected navigation if clicked accidentally; keep the hit target small.
- **Can be fixed after v0.7.68:** Yes.

---

## 2. Broken external URLs

### 2.1 `account.liquidclips.app/earn`
- **Priority:** P1
- **File / component:** `desktop/src/components/earn/EarnPanelMount.tsx:51`, `desktop/src/components/earn/EarnErrorBoundary.tsx:16`
- **Expected behaviour:** No customer-facing dead link. Since hosted Earn webview is orphaned, the fallback should either open the correct public page or be removed.
- **Current problem:** `EMBED_BROWSER_FALLBACK_URL = "https://account.liquidclips.app/earn"` points to a route that does not exist (404).
- **Minimal fix:**
  - If `https://liquidclips.app/earn` exists and is the canonical public Earn page, update both constants to that URL.
  - If no public Earn page exists, delete `EarnPanelMount.tsx`, `EarnErrorBoundary.tsx`, and the Rust `earn_panel` bridge (out of scope for public-bounty architecture; this is dead-code removal only).
- **Risk:** Medium if partial deletion leaves dangling imports; low if only updating the URL.
- **Can be fixed after v0.7.68:** No — a 404 fallback is a live dead end.

### 2.2 `account.liquidclips.app/billing`
- **Priority:** P1
- **File / component:** `desktop/src/components/earn/AffiliateHero.tsx:612`
- **Expected behaviour:** *Fix payment* opens the real billing/subscription management surface.
- **Current problem:** URL returns 404; no `/billing` route exists in `account-app`.
- **Minimal fix:** Replace with `https://account.liquidclips.app/dashboard` or `https://whop.com/liquidclips` (whichever is the canonical place to update a payment method). If Whop manages billing, use the Whop URL.
- **Risk:** Low.
- **Can be fixed after v0.7.68:** No.

### 2.3 `partner.jnremployee.com`
- **Priority:** P1
- **File / component:** `desktop/src/components/earn/AffiliateHero.tsx:411`, `desktop/src/components/earn/PayoutsView.tsx:201`, `account-app/src/app/dashboard/page.tsx:18`, `desktop/src/lib/backend.ts:1064` (comment)
- **Expected behaviour:** Partner dashboard links use the canonical domain.
- **Current problem:** Fallback hardcoded to old/temporary domain `partner.jnremployee.com`.
- **Minimal fix:** Replace with `https://partner.liquidclips.app` or, preferably, an env-driven URL (`NEXT_PUBLIC_PARTNER_DASHBOARD_URL` / `VITE_PARTNER_DASHBOARD_URL`) so it can be changed without a code release. Update the comment in `backend.ts`.
- **Risk:** Low if `partner.liquidclips.app` is provisioned; blocked if the new subdomain is not live.
- **Can be fixed after v0.7.68:** Only if the new domain is not provisioned yet; otherwise no.

### 2.4 `whop.com/jnremployee`
- **Priority:** P1
- **File / component:** `account-app/src/components/embed/EmbedEarnClient.tsx:400`, `partner-app/src/app/page.tsx:282`
- **Expected behaviour:** Links use the current Whop product slug for Liquid Clips.
- **Current problem:** Slug `jnremployee` is deprecated.
- **Minimal fix:** Replace with `https://whop.com/liquidclips` or an env-driven `NEXT_PUBLIC_WHOP_PRODUCT_URL`. If a specific forum path is needed, verify the new slug with Whop.
- **Risk:** Low.
- **Can be fixed after v0.7.68:** No.

### 2.5 Community chat URL mismatch
- **Priority:** P1
- **File / component:** `desktop/src/components/CommunityTab.tsx:98-101` (`whopChatUrl`)
- **Expected behaviour:** Comment and code agree, and the URL opens a real Whop chat room.
- **Current problem:** Comment says chat URLs should be `chat.whop.com/<channel_id>`; code returns `https://whop.com/c/<channel_id>`.
- **Minimal fix:** Verify the live Whop URL format (check Whop docs or test a real room link). Then:
  - If `whop.com/c/<id>` is correct, update the comment.
  - If `chat.whop.com/<id>` is correct, update the function return value.
- **Risk:** Medium if the wrong format is chosen — community chat links become 404s.
- **Can be fixed after v0.7.68:** No.

---

## 3. Notifications

### 3.1 NotificationBell hidden behind `{false && ...}`
- **Priority:** P1
- **File / component:** `desktop/src/App.tsx:2255-2258`
- **Expected behaviour:** Notifications are discoverable, or the dead code is removed and the remaining entrypoint documented.
- **Current problem:** `<NotificationBell />` is wrapped in `{false && …}`, so it never renders. The comment says it is kept for legacy callers, but the header entrypoint is gone.
- **Minimal fix:**
  - Option A: If an unread-count API exists, remove `{false &&}` and mount the bell in the header when signed in.
  - Option B (short-term): Delete the dead JSX and import, and document that the inbox is opened from the AvatarPanel HUD.
- **Risk:** Low for Option B; Option A may add UI clutter if the count is unreliable.
- **Can be fixed after v0.7.68:** Yes.

### 3.2 AvatarOrbit hardcoded `notificationCount={0}`
- **Priority:** P1
- **File / component:** `desktop/src/App.tsx:1531`
- **Expected behaviour:** Avatar orbit badge shows real unread notification count.
- **Current problem:** `notificationCount={0}` is hardcoded, so the badge never appears even when notifications exist.
- **Minimal fix:**
  - If an unread-count endpoint exists, wire `AvatarOrbit` to it (poll or derive from `lc:toast` events).
  - If no endpoint exists, keep the hardcoded `0` but add a `TODO` comment linking to the backend ticket, and do not show a misleading badge.
- **Risk:** Medium; requires a reliable count source. Faking it could show phantom badges.
- **Can be fixed after v0.7.68:** Yes if the API is missing; no if the API exists and only needs wiring.

---

## 4. Publish / export

### 4.1 Disabled Publish / Schedule buttons need reason
- **Priority:** P1
- **File / component:** `desktop/src/components/PublishModal.tsx:566-572`
- **Expected behaviour:** When *Publish now* / *Schedule* is disabled, the user knows why (no platform selected, no channel selected, no rendered clip, or publishing in progress).
- **Current problem:** `disabled={busy || !hasTargetSelection || !videoPath}` with no `title` or tooltip.
- **Minimal fix:** Compute a `disabledReason` string before the button:
  - `busy ? "Publishing in progress…"`
  - `!videoPath ? "This clip has no rendered file yet."`
  - `!hasTargetSelection ? (channels.length > 0 ? "Pick a channel." : "Pick at least one platform.")`
  Add `title={disabledReason}` to the submit button. Optionally reuse the existing `disabledReason` pattern already present in `PlatformTile`.
- **Risk:** Very low.
- **Can be fixed after v0.7.68:** Yes.

### 4.2 Missing OpenAI key should route to Settings / API keys, not FirstRun
- **Priority:** P1
- **File / component:** `desktop/src/App.tsx:923-954` (`guardQuota`)
- **Expected behaviour:** When the user clicks Export and no OpenAI key is available, the Settings drawer opens focused on the API keys tab.
- **Current problem:** Both "no JWT" and "no OpenAI key" route to `setView({ kind: "first-run" })`, so an API-key problem shows a sign-in screen.
- **Minimal fix:**
  - Keep the no-JWT branch routing to FirstRun.
  - In the `!available` OpenAI branch, open Settings with the API-keys tab active. This requires either:
    - Passing an `initialTab` prop to `<Settings />` (currently rendered conditionally at `App.tsx:2205`), or
    - Dispatching a new `lc:settings-open-tab` event with `detail.tab === "api-keys"` and adding a handler similar to the existing channels handler (`App.tsx:222-233`).
- **Risk:** Low. Requires a small Settings contract change.
- **Can be fixed after v0.7.68:** No — wrong-route UX is a live dead end.

### 4.3 FailureCard email fallback
- **Priority:** P1
- **File / component:** `desktop/src/components/FailureCard.tsx:60-69`
- **Expected behaviour:** If the user's system has no mail client, they still have a way to contact support.
- **Current problem:** `onEmailSupport` calls `openExternal(mailto:…)` and `.catch(() => undefined)` silently swallows failures.
- **Minimal fix:** On failure, copy `SUPPORT_EMAIL` (and ideally the prefilled subject/body) to the clipboard and show inline microcopy: "Couldn't open your mail app. Support email copied to clipboard." Alternatively, add a second button that copies the email address.
- **Risk:** Low.
- **Can be fixed after v0.7.68:** Yes.

---

## 5. Settings / Connections copy

- **Priority:** P1
- **File / component:**
  - `desktop/src/components/upload/DirectPublishQueue.tsx:77`
  - `desktop/src/lib/backend.ts:485,1202`
  - `desktop/src/components/schedule/SchedulePage.tsx:43,52`
  - `desktop/src/components/Settings.tsx:93,132`
  - `desktop/src/components/PublishModal.tsx:39`
  - `desktop/src/components/cockpit/BottomCockpit.tsx:785`
  - `desktop/src/components/workbench/AccountBindingChip.tsx:514,611,617,623`
  - `desktop/src/components/clips-feed/InlineScheduler.tsx:603,920`
  - `account-app/src/app/dashboard/page.tsx:279`
- **Expected behaviour:** Every user-facing reference to linked social accounts points to the current canonical location, **Schedule → Loadout** (or "Schedule → Channels" where the code specifically refers to that sub-tab). The old "Settings → Connections" tab no longer exists.
- **Current problem:** Many strings, comments, and hints still say "Settings → Connections", sending users to a missing tab.
- **Minimal fix:**
  1. Replace user-visible copy with "Schedule → Loadout" (or "Schedule → Channels" if the context is the channel list).
  2. Make the text a clickable link that opens `Schedule → Loadout` where feasible (reuse existing `onOpenSchedule` / `lc:settings-open-tab` channel logic).
  3. Update stale comments so future developers do not reintroduce the old name.
- **Risk:** Very low — copy and comment change only.
- **Can be fixed after v0.7.68:** Yes.

---

## 6. Earn polish issues (not public-bounty architecture)

### 6.1 Manual bounty status shows "Closed"
- **Priority:** P2
- **File / component:** `desktop/src/App.tsx:1622`, `desktop/src/components/earn/BountyDetail.tsx:39,262-266`
- **Expected behaviour:** A manually pasted bounty shows an actionable status (e.g., "Live" or "Manual") instead of "Closed".
- **Current problem:** Manual bounties are synthesised with `spotsRemaining: 0`, and `bountyStatusLabel` returns "Closed" whenever `spotsRemaining <= 0`.
- **Minimal fix:**
  - Option A: In the synthetic manual bounty, set `spotsRemaining` to a positive value (e.g., `1`) and `acceptedSubmissionsLimit` to a matching value.
  - Option B: In `bountyStatusLabel`, special-case `bounty.bountyType === "manual"` to return "Manual" or "Live" before the spots-remaining check.
- **Risk:** Low. Option B is safer because it does not pretend to know real availability.
- **Can be fixed after v0.7.68:** Yes.

### 6.2 SubmissionPortal success should auto-track
- **Priority:** P2
- **File / component:** `desktop/src/components/earn/SubmissionPortal.tsx:116`, `desktop/src/components/earn/EarnTab.tsx:973` (`rememberSubmissionId`)
- **Expected behaviour:** After a successful submission, the submission ID is written to local storage so the user can track it later.
- **Current problem:** `SubmissionPortal` sets success state but never calls `rememberSubmissionId(result.id)`.
- **Minimal fix:** Import `rememberSubmissionId` from `./EarnTab` and call it immediately after `setState({ kind: "success", submissionId: result.id })`.
- **Risk:** Very low.
- **Can be fixed after v0.7.68:** Yes.

### 6.3 RewardClipsPanel / PayoutsView signed-out CTAs
- **Priority:** P2
- **File / component:** `desktop/src/components/earn/RewardClipsPanel.tsx:84-86`, `desktop/src/components/earn/PayoutsView.tsx:154-159`
- **Expected behaviour:** When the user is signed out, these panels show a CTA to sign in or refresh the session.
- **Current problem:** Both surfaces show only static copy ("Sign in to see your reward clips" / "Sign in to see your payout sources") with no action.
- **Minimal fix:** Add a button that calls the existing sign-in/refresh handler (e.g., `activate()` or the panel's `onSignIn` prop) with copy like "Sign in to Liquid Clips" or "Refresh session".
- **Risk:** Low.
- **Can be fixed after v0.7.68:** Yes.

### 6.4 Sponsored locked upgrade handler
- **Priority:** P2
- **File / component:** `desktop/src/components/earn/EarnTab.tsx:311`, `desktop/src/components/earn/SponsoredBannerCarousel.tsx:87-89`
- **Expected behaviour:** Clicking a tier-locked sponsored banner triggers the in-app upgrade flow instead of dumping the user onto an external Whop campaign page.
- **Current problem:** `EarnTab` renders `<SponsoredBannerCarousel tier={userTier ?? "free"} />` without passing `onUpgrade`. When a campaign is not visible for the user's tier, `SponsoredBannerCarousel.go(c)` falls through to `openExternal(c.whop_url)`.
- **Minimal fix:** Pass an `onUpgrade` handler:
  ```tsx
  <SponsoredBannerCarousel
    tier={userTier ?? "free"}
    onUpgrade={() => {
      // For signed-out users, activate first; for activated users, open upgrade panel.
      if (auth.kind === "signed-out") onSignInClick();
      else openAuthPanel("upgrade");
    }}
  />
  ```
  Ensure signed-out users are routed through activation before upgrade to avoid the known signed-out-upgrade strand issue.
- **Risk:** Low-medium. Without the signed-out gate, the user could pay on the web while the desktop keychain stays empty.
- **Can be fixed after v0.7.68:** Yes.

---

## 7. Post-v0.7.68 summary

| Category | Items safe to defer | Items that should land before v0.7.68 |
|----------|---------------------|----------------------------------------|
| Social icons | All five items can be deferred. | — |
| Broken URLs | — | `account.liquidclips.app/earn`, `account.liquidclips.app/billing`, `partner.jnremployee.com`, `whop.com/jnremployee`, Community chat URL mismatch |
| Notifications | Bell cleanup/mount decision, count wiring if API missing | — |
| Publish / export | Disabled reason tooltip, FailureCard fallback | Missing OpenAI key route to Settings/API keys |
| Settings / Connections copy | All copy updates | — |
| Earn polish | Manual bounty status, auto-track, signed-out CTAs, sponsored upgrade handler | — |

**Recommended sequencing for v0.7.68:**
1. Fix all broken external URLs (Section 2).
2. Route missing OpenAI key to Settings / API keys (Section 4.2).
3. Add Publish/Schedule disabled reason (Section 4.1) — small but high-visibility.
4. Defer everything else to a v0.7.69 polish pass unless QA time permits.

---

*Plan only. No code changes, commits, or pushes included.*
