# Liquid Clips — Customer Journey + UI Dead-End Audit

**Repo:** `/Users/dipdip/code/jnr` (canonical only)  
**Excluded:** `/Users/dipdip/Desktop/jnr`, `/Users/dipdip/Desktop/jnr_STALE_DO_NOT_USE_0.7.56`  
**Date:** 2026-06-13  
**Version audited:** desktop `0.7.66`  
**Mode:** Read-only / report-only. No code changes, builds, installs, commits, pushes, tags, releases, `latest.json`, or deploys were performed.  
**Scope:** Every customer-facing section of the desktop app, plus the account-app/web surfaces the desktop links to.

---

## 1. Executive Summary

The Liquid Clips desktop app has moved most high-value surfaces to native React/Tauri, but several **P0 and P1 dead ends remain**. The biggest risks are not broken pixels — they are wrong auth flows, unreachable recovery UI, dead-click shortcuts, and orphaned webview code that contradicts the current Earn spec.

### Headline findings

| # | Finding | Priority |
|---|---------|----------|
| 1 | **Re-activation uses the wrong auth flow.** `Settings`, `AvatarPanel`, and `AvatarOrbit` call `openAuthPanel("sign-in")`, which opens `/sign-in?redirect_url=/dashboard`. Marketing ignores that parameter, so the user lands on `/connect-desktop` with **no challenge** and sees *“Missing activation code.”* The desktop never receives a JWT. | P0 |
| 2 | **Account-app dashboard has a 404 sign-out link.** The *Sign out* card links to `/sign-out`, which does not exist in `account-app`. | P0 |
| 3 | **Sidecar crash recovery UI is built but never mounted.** `SidecarCrashOverlay.tsx` exists but is not imported into `App.tsx`. | P0 |
| 4 | **Bottom-cockpit menu items are dead clicks.** *Brief*, *Add more clips*, and *Earn* dispatch `lc:open-brief`, `lc:go-home`, and `lc:go-earn`, but no listeners exist in `desktop/src`. | P0 |
| 5 | **Account-app “Connect Whop” / “Open Earn in desktop” cards route to `/download`.** Users expecting to connect Whop or open Earn land on the generic marketing download page. | P0 |
| 6 | **Missing OpenAI key silently routes to FirstRun.** Export/pipeline guards send the user to the sign-in flow for an API-key problem. | P0 |
| 7 | **Hosted Earn webview is orphaned, not deleted.** `EarnPanelMount.tsx`, `lib/earn_panel.ts`, Rust `earn_panel`, and `account-app/src/app/embed/earn` still exist. Comments in `App.tsx` and `EarnErrorBoundary.tsx` still describe Earn as a pinned webview, contradicting the native Earn spec. | P1 |
| 8 | **Account-app sign-in/sign-up drop `redirect_url`.** `/get`, `/upgrade`, and other flows pass a return URL, but `account-app/src/app/sign-in` and `sign-up` only use `fallbackRedirectUrl="/dashboard"`, breaking purchase-claim and upgrade redirects. | P1 |
| 9 | **Upgrade CTAs strand signed-out users.** `openAuthPanel("upgrade")` works for activated users, but a signed-out user pays on the web while the desktop keychain stays empty, so the paywall remains. | P1 |
| 10 | **`lc:checkout-complete` has no desktop listener.** The checkout success page promises the desktop will sync instantly, but nothing listens. | P1 |
| 11 | **Publish primary CTA disables without explanation.** `PublishModal.tsx` disables *Publish now* / *Schedule* with no tooltip or disabled reason. | P1 |
| 12 | **Deprecated `partner.jnremployee.com` fallback is still used** for affiliate/partner dashboards in three places. | P1 |
| 13 | **Several external URLs are 404s:** `account.liquidclips.app/earn`, `account.liquidclips.app/billing`. | P1 |
| 14 | **Notifications are functionally hidden.** `NotificationBell` is rendered as `{false && <NotificationBell … />}`, and `AvatarOrbit` hardcodes `notificationCount={0}`. | P1 |
| 15 | **Settings → Connections copy is misleading.** The tab was removed; channels now live under **Schedule → Loadout**, but UI hints still say “Settings → Connections.” | P1 |

### Pass / fail by section

| Section | Status | Notes |
|---------|--------|-------|
| 1. App launch / first open | ⚠️ Conditional pass | Correct activation path exists, but cold boot requires re-activation because the JWT cache is memory-only. |
| 2. Onboarding | ⚠️ Conditional pass | FirstRun flow is sound; API-key step can route to OpenAI correctly. |
| 3. Home / dashboard | ⚠️ Conditional pass | Dashboard OK; account-app dashboard has dead sign-out and Whop/download dead ends. |
| 4. Earn | ⚠️ Conditional pass | Native surface works, but hosted webview leftovers are a regression hazard. |
| 5. Earn Continue Session | ⚠️ Conditional pass | Uses correct `activate({ via: "browser" })`, but copy says “Continue session” instead of spec’s “Refresh session.” |
| 6. Earn Whop bounty loading | ✅ Pass | Bounty list fetches, retry + manual-paste fallbacks exist. |
| 7. Earn bounty detail | ⚠️ Conditional pass | Manual bounty shows status “Closed” because `spotsRemaining` is synthesised as `0`. |
| 8. Earn start bounty flow | ✅ Pass | `BountySourceSetup` → intent picker is wired. |
| 9. Earn manual bounty paste/link flow | ✅ Pass | Manual prompt and cached-session fallback work. |
| 10. Earn in-progress | ✅ Pass | Pipeline states have retry/resume. |
| 11. Earn submissions | ⚠️ Conditional pass | `SubmissionPortal` success does not auto-track the submission locally. |
| 12. Earn payouts | ⚠️ Conditional pass | Payouts recover cleanly, but signed-out state lacks a CTA and old partner domain fallback exists. |
| 13. Earn leaderboard | ✅ Pass | Retry + empty state present. |
| 14. Earn reward clips | ⚠️ Conditional pass | Signed-out state has no CTA; locked tier-gated sponsors open external Whop URL with no upgrade handler. |
| 15. Community | ⚠️ Conditional pass | Hub URL correct, but per-room chat URL comment/code mismatch is a latent 404 risk. |
| 16. Settings | ⚠️ Conditional pass | Many CTAs correct, but re-activate uses wrong flow, Connections tab is gone, API-keys mount scans secrets. |
| 17. Account | ⚠️ Conditional pass | Account dashboard dead sign-out link; web connect-Whop flow missing. |
| 18. Connections | ⚠️ Conditional pass | Channel OAuth recovery is strong, but Settings → Connections copy is wrong. |
| 19. Instagram connection/icons | ✅ Pass | Icons render, state is live, reconnect path exists. |
| 20. TikTok connection/icons | ✅ Pass | Same as Instagram; ClipReadyCard uses a text fallback instead of the brand glyph. |
| 21. YouTube connection/icons | ✅ Pass | Renders and works. |
| 22. X/Twitter connection/icons | ✅ Pass | Renders and works; backend reconciles `x` vs `twitter`. |
| 23. Publish/export | ⚠️ Conditional pass | Good recovery, but missing-OpenAI-key routes to FirstRun and Publish CTA disables without reason. |
| 24. Schedule | ✅ Pass | Most mature journey; empty, loading, error, OAuth recovery all wired. No live polling on ScheduleQueue. |
| 25. Notifications | ❌ Fail | Bell is dead code; badge hardcoded to 0; inbox only reachable via Avatar HUD. |
| 26. Sidebar navigation | ✅ Pass | Routes correct. |
| 27. Browser/open-link buttons | ⚠️ Conditional pass | Most links correct; several 404s and stale domains. |
| 28. Empty states | ⚠️ Conditional pass | Most empty states explain next steps; Community lacks an overall empty hero. |
| 29. Loading states | ✅ Pass | Skeletons and spinners present across major surfaces. |
| 30. Error states | ⚠️ Conditional pass | FailureCard email button silently fails if no mail client. |
| 31. Upgrade/paywall/checkout | ⚠️ Conditional pass | Works for activated users; signed-out users get stranded; `lc:checkout-complete` unhandled. |
| 32. Sign out/reset auth | ⚠️ Conditional pass | Desktop sign-out best-effort; account-app sign-out 404s. |
| 33. Back navigation after failed auth/login | ❌ Fail | `openAuthPanel("sign-in")` dead-end loop; no clear back path. |
| 34. Responsive layout/narrow window | ⚠️ Conditional pass | Sidebar collapse exists; some fixed-width modals may overflow on very narrow windows. |
| 35. Old unused/dead components | ❌ Fail | Many dead files still in tree; NotificationBell dead; SidecarCrashOverlay unmounted; workbench dead. |

---

## 2. Full Customer Journey Map

### 2.1 App launch / first open / onboarding

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 1.1 | Cold boot | Splash / workspace | — | — | Load deps, check presence | `App.tsx` → `checkDeps` → `secretsStatus()` + `licenseJwtPresence()` | Workspace or FirstRun | Sidecar crash | Restart app | **High** if crash overlay not mounted | `secretsStatus()` enumerates secrets on every launch | P1 |
| 1.2 | FirstRun | Sign in card | Sign in → | Sign in via browser | Activate desktop | `activate()` → `/connect-desktop?challenge=…` → deep-link `liquidclips://activate` | JWT written to keychain, cache primed | Deep-link fails | Try again / browser fallback | Low when fallback shown | User-initiated keychain write only | P0 if fallback wrong |
| 1.3 | FirstRun | OpenAI key card | Paste key / Skip | Where do I get a key? | Store BYO key | `sidecar.secretSet("OPENAI_API_KEY")` | Key saved | Save fails | Skip / retry | Low | User-initiated keychain write | — |

### 2.2 Home / dashboard / sidebar

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 2.1 | SideNav | Home icon | Go Home | — | Show home/dashboard | `setView({ kind: "home" })` | Home view | — | Other nav items | Low | None | — |
| 2.2 | SideNav | Settings gear | Open Settings | — | Settings drawer | `setView({ kind: "settings" })` | Settings | — | Back chevron / Close | Low | `secretsStatus()` on mount | P1 |
| 2.3 | Account-app `/dashboard` | Plan/usage cards | Manage plan | Sign out | Manage billing / sign out | `<a href="/sign-out">` | **404** | 404 page | Browser back | **High** | N/A | P0 |
| 2.4 | Account-app `/dashboard` | Connect Whop card | Connect Whop → | — | Start Whop OAuth | `<a href="/download">` | Marketing download | Wrong expectation | Browser back | **High** | N/A | P0 |

### 2.3 Earn

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 3.1 | SideNav Earn | Signed-out banner | Sign in to Liquid Clips → | — | Activate | `activate({ via: "browser" })` | Browser connect-desktop | Browser fails | Retry / manual | Low | Uses cache only | — |
| 3.2 | SideNav Earn | Session expired | Sign in again → | — | Re-activate | `activate({ via: "browser" })` | Browser connect-desktop | Browser fails | Retry | Low | Cache only | — |
| 3.3 | SideNav Earn | Cache empty, presence true | Continue your session → | — | Refresh session | `activate({ via: "browser" })` | Browser connect-desktop | Browser fails | Retry | Low | Cache only | P2 copy |
| 3.4 | SideNav Earn | Bounty grid | Start clipping / Details | Paste manually | Start bounty flow | `BountySourceSetup` → pipeline | Workspace | Source unavailable | Back to Earn | Low | Cache only | — |
| 3.5 | SideNav Earn | Submission portal | Submit clip | Track submission | Create Whop submission | `createSubmission` | Success screen | Submit fails | Inline error + retry | Medium | Cache only | P3 auto-track |
| 3.6 | SideNav Earn | Sponsored locked | Click banner | — | Upgrade | `openExternal(c.whop_url)` | External Whop page | No upgrade path | Back button | **Medium** | No keychain | P2 |

### 2.4 Schedule / Publish / Export

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 4.1 | ResultsGrid | Publish now | Publish to N platforms | — | Publish via Ayrshare | `backend.publishNow` | Per-platform results | Total failure | Retry | Low | Uses cached JWT | P1 disabled reason |
| 4.2 | ResultsGrid | Schedule | Schedule to channels | — | Schedule post | `publishNow` per channel | Scheduled summary | Partial failure | Modal stays open | Low | Uses cached JWT | — |
| 4.3 | Export pipeline | Export button | — | — | Render clips | `guardQuota()` | Results grid | No JWT → FirstRun | Back to workspace | **High** (wrong reason) | Cache only | P0 |
| 4.4 | Export pipeline | Quota exceeded | Continue on Solo / Recheck | — | Upgrade / verify | `openAuthPanel("upgrade")` | Upgrade panel | Signed-out user pays web, desktop still locked | Manual recheck | **High** | Cache only | P1 |
| 4.5 | Schedule → Loadout | No channels | Add your first channel | — | Start OAuth | `createChannel()` → browser | Channel active | OAuth stalls | Reopen browser / try again | Low | No keychain | — |

### 2.5 Settings / Account / Connections

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 5.1 | Settings | Free tier banner | Upgrade to Solo | — | Upgrade | `openAuthPanel("upgrade")` | Upgrade panel | Signed-out → web dashboard, no JWT | Close / re-activate | **High** | None | P1 |
| 5.2 | Settings | Expired banner | Re-activate this device → | — | Re-activate | `openAuthPanel("sign-in")` | `/sign-in?redirect_url=/dashboard` | Missing activation code | Loop | **High** | None | P0 |
| 5.3 | Settings → Account | Subscription action | Manage / Upgrade | — | Billing | `openAuthPanel("dashboard" / "upgrade")` or Whop URL | Correct for activated | Signed-out → web dashboard | Re-activate | **High** | None | P1 |
| 5.4 | Schedule → Loadout | Channel row | Reconnect | Delete | Re-OAuth | `relinkChannel()` → browser | Channel active | Stalls | Reopen browser | Low | No keychain | — |
| 5.5 | Account-app dashboard | Sign out card | Sign out | — | Sign out | `/sign-out` | **404** | 404 page | Browser back | **High** | N/A | P0 |

### 2.6 Community

| # | Entry point | What user sees | Primary CTA | Secondary CTA | Expected action | Actual code path | Destination/result | Failure state | Back/escape path | Dead-end risk | Auth/keychain risk | Priority |
|---|-------------|----------------|-------------|---------------|-----------------|------------------|--------------------|---------------|------------------|---------------|--------------------|----------|
| 6.1 | SideNav Community | Community tab + browse panel | Open community / Open chat | — | Open Whop hub/room | `openBrowsePanel(WHOP_COMMUNITY_URL)` / `whop.com/c/<id>` | Whop panel/browser | 404 if URL wrong | Back to Community | **Medium** if chat URL wrong | None | P1 |
| 6.2 | Community locked room | Upgrade → | — | — | Paywall | `openAuthPanel("upgrade")` | Upgrade panel | Signed-out strand | Re-activate | **High** | None | P1 |

---

## 3. Button / Link Matrix

| Label | Screen / section | Component/file | Handler | Expected result | Actual result | External URL | Opens | Needs auth | Can strand | Fix required |
|-------|------------------|----------------|---------|-----------------|---------------|--------------|-------|------------|------------|--------------|
| Sign in → | FirstRun | `FirstRun.tsx:121` | `activate()` | Open connect-desktop panel | Correct | `https://liquidclips.app/connect-desktop?challenge=…` | Auth panel / browser | No | No | No |
| Sign in via browser | FirstRun error | `FirstRun.tsx:151` | `activate({ via: "browser" })` | Browser connect-desktop | Correct | Same | Browser | No | No | No |
| Re-activate this device → | Settings expired | `Settings.tsx:472` | `openAuthPanel("sign-in")` | Re-activate desktop | **Dead-end** — missing activation code | `https://liquidclips.app/sign-in?redirect_url=/dashboard` | Auth panel | Yes | **Yes** | **Yes** |
| Re-activate → | AvatarPanel | `AvatarPanel.tsx:214` | `openAuthPanel("sign-in")` | Re-activate desktop | **Dead-end** | Same | Auth panel | Yes | **Yes** | **Yes** |
| re-activate | AvatarOrbit | `AvatarOrbit.tsx:124` | `openAuthPanel("sign-in")` | Re-activate desktop | **Dead-end** | Same | Auth panel | Yes | **Yes** | **Yes** |
| Continue session → | EarnTab refresh | `EarnTab.tsx:760` | `activate({ via: "browser" })` | Refresh session | Correct (copy should be “Refresh session”) | `https://liquidclips.app/connect-desktop` | Browser | Yes | No | Copy only |
| Sign in again → | EarnTab expired | `EarnTab.tsx:765` | `activate({ via: "browser" })` | Re-activate | Correct | Same | Browser | Yes | No | No |
| Upgrade to Solo | Settings free banner | `Settings.tsx:443` | `openAuthPanel("upgrade")` | Open upgrade | Works if activated; strands signed-out users | `https://liquidclips.app/upgrade` | Auth panel | Yes | **Yes** | Gate or redirect |
| Manage subscription → | Settings account | `Settings.tsx:1217` | `openAuthPanel("dashboard")` | Account dashboard | Works if activated | `https://liquidclips.app/dashboard` | Auth panel | Yes | **Yes** if signed out | Gate or redirect |
| Manage subscription on Whop → | Settings account | `Settings.tsx:1214` | `openSmart` | Whop billing | Correct | `https://whop.com/liquidclips` | Browser | Yes | No | No |
| Log out | Settings | `Settings.tsx:1788` | `performSignOut()` | Wipe session | Best-effort wipe | — | In-app | Yes | Partial | Surface partial-wipe warning |
| Sign out | Account dashboard (web) | `account-app/dashboard/page.tsx:189` | `<a href="/sign-out">` | Sign out | **404** | `/sign-out` | In-app | Yes | **Yes** | **Yes** |
| Connect Whop | Account dashboard (web) | `account-app/dashboard/page.tsx:197` | `<a href="/download">` | Connect Whop | Goes to download page | `/download` | Browser | Yes | **Yes** | **Yes** |
| Open Earn in desktop | Account dashboard (web) | `account-app/dashboard/page.tsx:213` | `<a href="/download">` | Open desktop Earn | Goes to download page | `/download` | Browser | Yes | **Yes** | **Yes** |
| Add channel | Schedule → Loadout | `ChannelsManager.tsx:394` | `setAddOpen(true)` | Add-channel modal | Correct | — | Modal | Yes | No | No |
| Continue → Link account | AddChannelModal | `AddChannelModal.tsx:317` | `create()` → browser | Start OAuth | Correct | Ayrshare OAuth URL | Browser | Yes | No | No |
| Open browser again | AddChannelModal | `AddChannelModal.tsx:411` | `reopenBrowser` | Resume OAuth | Correct | Ayrshare OAuth URL | Browser | Yes | No | No |
| Try again | AddChannelModal error | `AddChannelModal.tsx:436` | `retryFromError()` | Reset + retry | Correct | — | In-app | Yes | No | No |
| Publish now / Schedule | PublishModal | `PublishModal.tsx:567` | `submit()` | Publish/schedule | Works when enabled | — | In-app | Yes | No | Add disabled reason |
| Open Schedule → Channels | ConnectFirstPrompt | `ConnectFirstPrompt.tsx:61` | `onOpenSchedule()` | Go to Loadout | Correct | — | In-app | Yes | No | No |
| Copy & open Instagram | LocalQueue | `LocalQueue.tsx:663` | `copyAndOpen` | Copy caption + open IG | Opens `instagram.com` (no composer) | `https://www.instagram.com/` | Browser | No | Partial | Add microcopy |
| Retry | Schedule queue | `ScheduleQueue.tsx:243` | `load()` | Refresh queue | Correct | — | In-app | Yes | No | No |
| Cancel | Schedule queue row | `ScheduleQueue.tsx:355` | `cancel(row)` | Cancel post | Correct | — | In-app | Yes | No | No |
| Open chat → | Community room | `CommunityTab.tsx:401` | `openBrowsePanel(whopChatUrl(id))` | Open room chat | Opens `whop.com/c/<id>`; comment says `chat.whop.com` | `https://whop.com/c/<id>` | Browse panel | No | **Yes** if URL wrong | Verify URL |
| Open community → | Community | `CommunityTab.tsx:370` | `openBrowsePanel(WHOP_COMMUNITY_URL)` | Open Whop hub | Correct | `https://whop.com/liquidclips/` | Browse panel | No | No | No |
| Brief | BottomCockpit | `BottomCockpit.tsx:760` | `dispatchEvent(lc:open-brief)` | Open brief | **No listener** | — | — | No | **Yes** | Wire or remove |
| Add more clips | BottomCockpit | `BottomCockpit.tsx:765` | `dispatchEvent(lc:go-home)` | Go home | **No listener** | — | — | No | **Yes** | Wire or remove |
| Earn | BottomCockpit | `BottomCockpit.tsx:789` | `dispatchEvent(lc:go-earn)` | Go to Earn | **No listener** | — | — | No | **Yes** | Wire or remove |
| Email support → | FailureCard | `FailureCard.tsx:123` | `openExternal(mailto:…)` | Compose email | **Silent fail** if no mail client | `mailto:hello@liquidclips.app` | Mail client | No | **Yes** | Add fallback |
| See plans → | AffiliateHero | `AffiliateHero.tsx:366` | `openSmart` | Upgrade page | Correct | `https://account.liquidclips.app/upgrade` | Browser | No | No | No |
| Open partner dashboard ↗ | AffiliateHero | `AffiliateHero.tsx:411` | `openSmart` | Partner dashboard | Uses temporary/old domain | `https://partner.jnremployee.com` | Browser | Yes | **Yes** if dead | Update domain |
| Set up Stripe Connect → | AffiliateHero | `AffiliateHero.tsx:632` | `openSmart` | Stripe onboarding | Correct | Stripe URL | Browser | Yes | No | No |
| Fix payment → | AffiliateHero | `AffiliateHero.tsx:612` | `openSmart` | Billing page | **404** | `https://account.liquidclips.app/billing` | Browser | Yes | **Yes** | **Yes** |
| Open in browser | EarnPanelMount error | `EarnPanelMount.tsx:423` | `openSmart` | Public Earn fallback | **404** | `https://account.liquidclips.app/earn` | Browser | No | **Yes** | Remove or update |
| Submit clip | SubmissionPortal | `SubmissionPortal.tsx:100` | `createSubmission` | Create Whop submission | Correct | — | In-app / backend | No | No | Auto-track after success |
| Start clipping → | BountyDetail | `BountyDetail.tsx:233` | `onStartBounty` | Start bounty | Correct | — | In-app | Yes | No | Fix manual-bounty status |

---

## 4. Social Icon Audit

| Platform | Where it appears | Icon component / import | Renders? | Click handler | URL / action | Connected / disconnected state | Reconnect / recovery | Fake vs live state | Fix recommendation |
|----------|------------------|-------------------------|----------|---------------|--------------|-------------------------------|----------------------|--------------------|--------------------|
| **Instagram** | Schedule rail, ConnectFirstPrompt, ChannelRow, ChannelPicker, AccountBindingChip, InlineScheduler, PublishModal, LocalQueue, ClipReadyCard | `PlatformIcon` (mono SVG), `PlatformBadge`/`PlatformGlyph` (brand), lucide `Instagram` in ClipReadyCard | ✅ Yes | Decorative in icon; action on surrounding row/button | Connect buttons trigger Ayrshare OAuth via `createChannel`/`relinkChannel` | Live from `listChannels` + Ayrshare snapshot; statuses: `active/pending_link/unlinked/error/paused` | “Reconnect” in ChannelsManager, “Connect Instagram” in AccountBindingChip | **Live state**; glyphs static | Minor: unify ClipReadyCard to use `PlatformIcon` |
| **TikTok** | Same surfaces as Instagram | `PlatformIcon` (mono SVG), `PlatformBadge`/`PlatformGlyph` (brand), text “T” fallback in ClipReadyCard | ✅ Yes | Same as Instagram | Same Ayrshare OAuth | Same live status | Same reconnect path | **Live state**; ClipReadyCard uses text fallback | Use brand glyph in ClipReadyCard |
| **YouTube** | Same surfaces | `PlatformIcon` (mono SVG), `PlatformBadge`/`PlatformGlyph` (brand), lucide `Youtube` in ClipReadyCard | ✅ Yes | Same as Instagram | Same Ayrshare OAuth | Same live status | Same reconnect path | **Live state** | — |
| **X / Twitter** | Same surfaces; source parser maps `x.com`/`twitter.com` | `PlatformIcon` (mono SVG), `PlatformBadge`/`PlatformGlyph` (brand) | ✅ Yes | Same as Instagram | Same Ayrshare OAuth | Live; backend stores `x`, Ayrshare reports `twitter` — reconciled in `channelStatus.ts` | Same reconnect path | **Live state** | — |
| **Whop** | Powered-by badge in desktop, account-app, EarnTab banners, CommunityTab, checkout/bounty cards; `WhopMark` custom SVG | `PoweredByWhop.tsx` `WhopMark` | ✅ Yes | **No click handler** — pure attribution badge | None | Whop connection state live in `EarnTab` (`auth.kind`) and dashboard `customer.whop_connected` | Desktop: `activate({via:"browser"})`; Web: dashboard cards route to `/download` (wrong) | **Live connection state**; glyph static | Add click handler to badge if desired; fix web Whop-connect cards |

---

## 5. Dead-End List

| Priority | Location | Issue | Impact | Recommended fix |
|----------|----------|-------|--------|-----------------|
| **P0** | `desktop/src/components/Settings.tsx:472`, `AvatarPanel.tsx:214`, `AvatarOrbit.tsx:124` | `openAuthPanel("sign-in")` opens `/sign-in?redirect_url=/dashboard`, which marketing ignores, landing the user on `/connect-desktop` with no challenge. | User sees *“Missing activation code”* and desktop never gets JWT; loop. | Replace all three with `activate()` or `activate({ via: "browser" })`. |
| **P0** | `account-app/src/app/dashboard/page.tsx:189` | *Sign out* card links to `/sign-out`, which does not exist. | 404. | Use Clerk `<SignOutButton>` or a real sign-out handler. |
| **P0** | `desktop/src/components/SidecarCrashOverlay.tsx` | Component exists but is never imported/mounted in `App.tsx`. | Sidecar crash gives user no actionable panic screen. | Import and mount in `App.tsx`, or delete if not needed. |
| **P0** | `desktop/src/components/cockpit/BottomCockpit.tsx:760,765,789` | *Brief*, *Add more clips*, *Earn* dispatch `lc:open-brief`, `lc:go-home`, `lc:go-earn`; zero listeners. | Dead clicks. | Wire listeners or remove items. |
| **P0** | `account-app/src/app/dashboard/page.tsx:197,213` | *Connect Whop* and *Open Earn in desktop* cards route to `/download`. | User lands on marketing download, not Whop connect or desktop Earn. | Change copy to “Download desktop app” or build real flows. |
| **P0** | `desktop/src/App.tsx:940-949` | `guardQuota()` routes missing-OpenAI-key to `first-run`. | User clicks Export and sees sign-in screen for an API-key problem. | Surface explicit “OpenAI key required” state or route to Settings → API keys. |
| **P1** | `desktop/src/components/earn/EarnPanelMount.tsx`, `lib/earn_panel.ts`, Rust `earn_panel.rs`, `account-app/src/app/embed/earn/*` | Hosted Earn webview and bridge still exist; comments in `App.tsx`/`EarnErrorBoundary.tsx` describe Earn as pinned webview. | Regression hazard; contradicts native Earn spec. | Delete webview path and update comments, or explicitly archive. |
| **P1** | `account-app/src/app/sign-in/[[...sign-in]]/page.tsx`, `sign-up/[[...sign-up]]/page.tsx` | Drop `redirect_url`/`redirect` query params; always redirect to `/dashboard`. | Breaks `/get?claim=…` and `/upgrade` return flows. | Honor return params like marketing sign-in does. |
| **P1** | All `openAuthPanel("upgrade")` call sites (`App.tsx:1858`, `Settings.tsx:445`, `ResultsGrid.tsx:348`, `ClipPreview.tsx:393`, `PublishModal.tsx:700`, `BottomCockpit.tsx:189`, `ReactionControls.tsx:312`, `ClipCard.tsx:296`, `CommunityTab.tsx:305`) | Signed-out user clicks Upgrade, pays on web, desktop never gets JWT; paywall remains. | Conversion appears to fail; user stranded. | Gate upgrade CTAs behind activation or route signed-out users through `activate()` first. |
| **P1** | `account-app/src/app/checkout/complete/ClientNotify.tsx` + `desktop/src/components/earn/EarnPanelMount.tsx` | Success page posts `lc:checkout-complete`, but desktop never listens. | “Desktop will sync instantly” promise broken. | Add listener in `EarnPanelMount.tsx` or App-level global handler to refresh tier. |
| **P1** | `desktop/src/components/PublishModal.tsx:566-572` | Primary action disabled with no `title`/tooltip. | User does not know why Publish/Schedule is unavailable. | Add `title` explaining active blocker. |
| **P1** | `desktop/src/components/earn/AffiliateHero.tsx:411`, `PayoutsView.tsx:201`; `account-app/src/app/dashboard/page.tsx:18` | Partner dashboard falls back to `https://partner.jnremployee.com`. | Old/temporary domain may be dead. | Replace with `https://partner.liquidclips.app` or env-driven URL. |
| **P1** | `desktop/src/components/earn/AffiliateHero.tsx:612` | *Fix payment* links to `https://account.liquidclips.app/billing`. | **404** — no `/billing` route. | Use `/upgrade` or `/dashboard`. |
| **P1** | `desktop/src/components/earn/EarnPanelMount.tsx:51`, `EarnErrorBoundary.tsx:16` | “Open in browser” fallback points to `https://account.liquidclips.app/earn`. | **404** — no `/earn` route. | Remove dead code or update fallback. |
| **P1** | `desktop/src/components/App.tsx:2258` | `NotificationBell` rendered as `{false && <NotificationBell … />}`. | Notifications undiscoverable. | Mount bell or remove dead code and document AvatarPanel entrypoint. |
| **P1** | `desktop/src/components/App.tsx:1531` | `AvatarOrbit notificationCount={0}` hardcoded. | No unread badge. | Restore unread-count polling or badge on `lc:toast`/inbox open. |
| **P1** | Settings/Connections references in `AccountBindingChip.tsx`, `InlineScheduler.tsx`, `channelStatus.ts` | Settings no longer has a Connections tab; channels live in Schedule → Loadout. | Users hunt for missing tab. | Update copy to “Schedule → Loadout” or make text clickable. |
| **P1** | `desktop/src/components/CommunityTab.tsx:100-102` | Comment says chat URLs should be `chat.whop.com/<id>`; code returns `whop.com/c/<id>`. | Latent 404 risk if implementation is wrong. | Confirm live Whop URL format and align code + comment. |
| **P2** | `desktop/src/components/earn/EarnTab.tsx:751-763` | Refresh-session banner says *“Continue your session”* / *“Continue session →”*. | Copy deviates from canonical spec. | Update to *“Refresh your session…”* / *“Refresh session →”*. |
| **P2** | `desktop/src/components/earn/EarnTab.tsx:311` | `SponsoredBannerCarousel` not passed `onUpgrade`; locked items fall through to `openExternal(c.whop_url)`. | Locked users land on Whop campaign without upgrade path. | Pass `onUpgrade` handler or route to upgrade. |
| **P2** | `desktop/src/components/earn/AffiliateHero.tsx:271-284` | Signed-out card uses forbidden *“Activate Liquid Clips”* copy. | Copy deviates from spec. | Change to sign-in copy. |
| **P3** | `desktop/src/App.tsx:1622` + `BountyDetail.tsx:262-267` | Manual bounty synthesised with `spotsRemaining: 0`, so status shows “Closed” despite active. | Misleading status. | Synthesise `spotsRemaining > 0` or special-case manual bounties. |
| **P3** | `desktop/src/components/earn/SubmissionPortal.tsx:116` | Success screen does not call `rememberSubmissionId()` or write local tracker. | User must manually log submission. | Auto-track after success. |
| **P3** | `desktop/src/components/earn/RewardClipsPanel.tsx:84-86`, `PayoutsView.tsx:154-159` | Signed-out states have no CTA. | Minor dead end if reached. | Add sign-in/refresh CTA. |
| **P3** | `desktop/src/components/earn/BountySwipeMount.tsx`, `BountySwipe.tsx`, `SwipeCard.tsx`, `useBountySwipe.ts` | Dead code; “Browse all →” footer pointed to retired webview. | Confusion / bundle bloat. | Delete or wire into native tab. |

---

## 6. Auth / Keychain Risk List

| Priority | Risk | Location | Evidence | Recommended fix |
|----------|------|----------|----------|-----------------|
| **P0** | Re-activation CTAs open web sign-in panel instead of desktop activation flow. | `Settings.tsx:474`, `AvatarPanel.tsx:214`, `AvatarOrbit.tsx:124/130` | `openAuthPanel("sign-in")` → `/sign-in?redirect_url=/dashboard` | Replace with `activate()` or `activate({ via: "browser" })`. |
| **P0** | `activate()` browser fallback copy points at wrong host. | `desktop/src/lib/activation.ts:239` | `account.liquidclips.app/connect-desktop` | Update to `https://liquidclips.app/connect-desktop`. |
| **P0** | Account-app `/connect-desktop` sign-up path does not preserve challenge. | `account-app/src/app/connect-desktop/page.tsx:157-159`, `sign-up/[[...sign-up]]/page.tsx:70-71` | `signUpUrl="/sign-up"` without challenge | Make `/sign-up` honor `redirect_url` and return to `/connect-desktop?challenge=…`. |
| **P1** | Sign-out / reset are best-effort keychain deletes; UI implies full wipe. | `App.tsx:2489-2526`, `activation.ts:281-296`, `FirstRun.tsx:287-303` | `.catch(() => undefined)` | Surface partial-wipe warning in Settings sign-out. |
| **P1** | Settings mount calls `sidecar.secretsStatus()` and `openaiKeyStatus()`, which enumerate secrets and may trigger macOS Keychain prompts. | `Settings.tsx:263-292` | Called on Settings open | Convert to presence-only probes or defer until API-keys section expanded. |
| **P1** | App boot calls `sidecar.secretsStatus()` before FirstRun decision. | `App.tsx:535` | Boot path | Move FirstRun detection to presence-only probe. |
| **P1** | `readLicenseJwtForAuthAction()` is exported but unused. | `desktop/src/lib/authStorage.ts:176-207` | Zero call sites | Wire into explicit reconnect flow or remove helper and update invariant docs. |
| **P2** | `licenseJwtPresence()` is a plaintext mirror; can drift from keychain state. | `authStorage.ts:87-94` | No reconciliation after 401 beyond delete | Reconcile or emit `lc:desktop-auth-invalidated` robustly. |
| **P2** | `AuthPanel.tsx` has no explicit cancel affordance other than X. | `AuthPanel.tsx:141-148` | Single close button | Add “Cancel” label for clarity. |

---

## 7. External URL / Link List

| URL / URI | Source file | How opened | Expected destination | Actual | Fix needed |
|-----------|-------------|------------|----------------------|--------|------------|
| `https://liquidclips.app/connect-desktop?challenge=…` | `activation.ts:225` | `invoke("open_auth_panel")` / `openSmart` | Marketing connect page | ✅ Correct | Update fallback copy host |
| `https://liquidclips.app/sign-in?redirect_url=/dashboard` | `AuthPanel.tsx:31` | `invoke("open_auth_panel")` | Desktop activation | ❌ Marketing ignores param → `/connect-desktop` no challenge | Remove/retire sign-in mode |
| `https://liquidclips.app/sign-up?redirect_url=/dashboard` | `AuthPanel.tsx:32` | `invoke("open_auth_panel")` | Desktop activation | ❌ Same dead-end | Remove/retire sign-up mode |
| `https://liquidclips.app/upgrade` | `AuthPanel.tsx:33` | `invoke("open_auth_panel")` | Upgrade checkout | ⚠️ OK only if activated | Gate or pre-activate |
| `https://liquidclips.app/dashboard` | `AuthPanel.tsx:34` | `invoke("open_auth_panel")` | Web dashboard | ✅ Correct | — |
| `https://liquidclips.app/dashboard#payouts` | `AuthPanel.tsx:35` | `invoke("open_auth_panel")` | Payouts section | ⚠️ Anchor may not resolve | Add `id="payouts"` on dashboard |
| `https://account.liquidclips.app/earn` | `EarnPanelMount.tsx:51`, `EarnErrorBoundary.tsx:16` | `openSmart` | Public Earn fallback | ❌ 404 | Remove dead code |
| `https://account.liquidclips.app/billing` | `AffiliateHero.tsx:612` | `openSmart` | Billing page | ❌ 404 | Use `/upgrade` or `/dashboard` |
| `https://account.liquidclips.app/upgrade` | `AffiliateHero.tsx:366,403` | `openSmart` | Upgrade page | ✅ Correct | — |
| `https://partner.jnremployee.com` | `AffiliateHero.tsx:411`, `PayoutsView.tsx:201`, `account-app/dashboard/page.tsx:18` | `openSmart` | Partner dashboard | ⚠️ Old/temporary | Update to `partner.liquidclips.app` |
| `https://whop.com/liquidclips/` | `lib/browse.ts:36`, `App.tsx:1498`, `CommunityTab.tsx:300` | `openBrowsePanel` | Liquid Clips Whop hub | ✅ Correct | — |
| `https://whop.com/c/<channelId>` | `CommunityTab.tsx:101` | `openBrowsePanel` | Whop chat room | ⚠️ Comment/code mismatch | Verify live URL |
| `https://whop.com/discover/content-rewards/` | `lib/browse.ts:11`, `EarnSidebar.tsx`, `BrowseRewardsPanel.tsx` | `openBrowsePanel` / `openExternal` | Whop rewards marketplace | ✅ Correct | — |
| `https://whop.com/jnremployee` | `account-app/components/embed/EmbedEarnClient.tsx:400` | `openExternal` | Whop product | ❌ Deprecated slug | Use `whop.com/liquidclips` |
| `https://whop.com/dashboard/payouts` | `Settings.tsx:1064`, `PayoutsView.tsx` | `openSmart` / `openExternal` | Whop payouts | ✅ Correct | — |
| `https://platform.openai.com/api-keys` | `FirstRun.tsx:220` | `openSmart` | OpenAI keys | ✅ Correct | — |
| `mailto:hello@liquidclips.app` | `Splash.tsx`, `FailureCard.tsx`, `Settings.tsx` | `openSmart` | Mail client | ⚠️ Silent fail if no client | Add fallback |
| `https://liquidclips.app/privacy`, `/terms` | `Settings.tsx:725,731` | `openSmart` | Legal pages | ✅ Correct | — |

---

## 8. Broken / Missing UI States

| Surface | Broken state | Why broken | Fix |
|---------|--------------|------------|-----|
| **FirstRun / Export guard** | Missing OpenAI key routes to FirstRun | `guardQuota()` uses FirstRun as fallback for both no-JWT and no-key | Add explicit API-key state/CTA |
| **Settings expired banner** | No clear back/cancel from wrong auth panel | `openAuthPanel("sign-in")` opens webview with no in-app cancel path | Use `activate()` |
| **PublishModal** | Primary CTA disabled without reason | No `title` or tooltip on disabled button | Add disabled reason |
| **FailureCard** | “Email support” silently fails | `openExternal(mailto)` catch is no-op | Copy diagnostics + show inline message |
| **Account-app dashboard** | Sign-out 404 | No `/sign-out` route | Use Clerk sign-out |
| **Notification system** | Bell hidden, badge always 0 | `{false && <NotificationBell />}` and hardcoded count | Mount bell or document entrypoint |
| **CommunityTab** | No overall empty hero | Sections with no rooms are omitted | Add “No rooms available” empty state |
| **EarnTab** | Refresh-state copy mismatch | Uses “Continue session” instead of spec’s “Refresh session” | Update copy |
| **EarnTab** | Locked sponsored banners open external Whop | No `onUpgrade` passed | Add upgrade handler |
| **BountyDetail** | Manual bounty status “Closed” | `spotsRemaining: 0` override | Special-case manual bounties |
| **SubmissionPortal** | Success does not auto-track | No `rememberSubmissionId()` call | Auto-track after success |
| **RewardClipsPanel / PayoutsView** | Signed-out states no CTA | Gated but unhandled | Add sign-in/refresh CTA |
| **ScheduleQueue** | No live polling | Removed per policy | Add manual refresh cue |

---

## 9. Prioritised Fix Plan

### P0 — Blocks user from using app / money flow / auth / Earn

1. `fix(auth): remove dead-end login and recovery paths`
   - Replace `openAuthPanel("sign-in")` in `Settings.tsx`, `AvatarPanel.tsx`, `AvatarOrbit.tsx` with `activate()` / `activate({ via: "browser" })`.
   - Fix `activation.ts` browser fallback copy to `liquidclips.app/connect-desktop`.
   - Fix account-app `/sign-in` and `/sign-up` to honor `redirect_url` / `redirect`.
   - Ensure `/connect-desktop` sign-up path preserves challenge.

2. `fix(ui): mount crash recovery and remove dead-click shortcuts`
   - Import and mount `SidecarCrashOverlay.tsx` in `App.tsx`, or delete it.
   - Wire or remove BottomCockpit *Brief*, *Add more clips*, and *Earn* menu items.

3. `fix(account-app): repair dashboard dead links`
   - Replace `/sign-out` link with Clerk `<SignOutButton>`.
   - Change *Connect Whop* / *Open Earn in desktop* cards to real flows or honest “Download desktop app” copy.

4. `fix(export): surface OpenAI key blocker correctly`
   - Route missing-OpenAI-key cases to Settings → API keys, not FirstRun.

### P1 — Broken customer journey / dead end / wrong link

5. `fix(earn): complete end-to-end bounty loading journey`
   - Delete or archive hosted Earn webview (`EarnPanelMount`, `earn_panel`, `account-app/embed/earn`).
   - Update `App.tsx` / `EarnErrorBoundary` comments to reflect native Earn.
   - Fix `/account.liquidclips.app/earn` and `/billing` 404s.
   - Update partner dashboard fallback to `partner.liquidclips.app`.
   - Handle `lc:checkout-complete` in desktop.
   - Gate upgrade CTAs on activation or pre-route signed-out users through `activate()`.

6. `fix(ui): repair social icons and external links`
   - Fix PublishModal disabled reason tooltip.
   - Fix FailureCard email fallback.
   - Verify/fix Community chat URL (`whop.com/c/<id>` vs `chat.whop.com`).
   - Update embed Earn Whop slug to `whop.com/liquidclips`.

7. `fix(ui): remove dead ends across settings and community`
   - Restore or remove `NotificationBell`; stop hardcoding `notificationCount={0}`.
   - Update all “Settings → Connections” copy to “Schedule → Loadout”.
   - Add Community empty hero.

8. `fix(auth): keychain prompt and partial-wipe cleanup`
   - Defer `secretsStatus()` / `openaiKeyStatus()` until user-initiated.
   - Surface partial-wipe warning on Settings sign-out.
   - Decide fate of unused `readLicenseJwtForAuthAction()`.

### P2 — UI polish / clarity / copy / icons

9. Update Earn refresh-session copy to “Refresh session”.
10. Pass `onUpgrade` to `SponsoredBannerCarousel` for locked tier-gated sponsors.
11. Remove forbidden “Activate Liquid Clips” copy in `AffiliateHero`.
12. Add manual-polling/refresh cue to `ScheduleQueue`.
13. Add `#payouts` anchor on account-app dashboard.

### P3 — Nice-to-have cleanup

14. Fix manual bounty status label.
15. Auto-track `SubmissionPortal` success locally.
16. Add signed-out CTAs to `RewardClipsPanel` / `PayoutsView`.
17. Delete dead code: `workbench/*`, unused shadcn primitives, `tauri-web-shims/*`, dead account-app components.

---

## 10. Acceptance Criteria After Fixes

- Every primary CTA performs an action or opens the correct route.
- Every secondary CTA works or is removed.
- Every external link lands on the correct destination.
- Every failed action has retry/back/next step.
- No broken Instagram/social icons.
- No auth dead ends.
- No passive Keychain prompt on launch or Settings mount.
- No `/sign-in?redirect_url=/dashboard` usage.
- No hosted Earn webview mounted or reachable.
- Earn works end to end.
- Community lands on the correct Liquid Clips community.
- Settings/connections recover cleanly.
- No black screens or unmounted crash overlays.
- No customer-facing dead ends.

---

*End of audit. Fixes should not begin until Daniel approves this report.*
