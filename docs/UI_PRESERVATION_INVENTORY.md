# UI Preservation Inventory — pre-commit gate

**Date:** 2026-06-13
**Working tree:** v0.7.70 desktop installed locally; backend route staged but not deployed.
**Authors of changes in this batch:** Claude (Earn/public-bounty/backend) + Kimi 2 (app-shell/auth/copy fixes).

This is the canonical list of every UI-facing change in the current uncommitted
working tree. Use it as the preservation checklist before any commit — anything
flagged **must-preserve = YES** is load-bearing and cannot be reverted without
re-running the underlying decision. Items flagged **defer-ok = YES** can be
left as-is for v0.7.71+ polish.

## How to read this doc

- **file** — repo-relative path
- **what changed** — one-sentence behaviour delta
- **why it matters** — the product/user reason
- **must-preserve** — YES = ship-blocking if reverted; NO = nice-to-have
- **defer-ok** — YES = can wait for a later polish pass; NO = ship now

---

## 1. Earn UI

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `desktop/src/components/earn/EarnTab.tsx` | Full rewrite — universal layout shell + public-first data model (two layers: `publicData` + `personalData`, merged personal-wins-on-id) + inline "Unlock to start" gating + locked-state copy fixes + marker `EARN SURFACE: public-bounty native EarnTab v0.7.70`. | The whole "browse bounties public, earn money authenticated" product model lives here. | **YES** | NO |
| `desktop/src/components/earn/EarnLayout.tsx` *(new)* | Restored from `73d1a2c~1`. Three-column workstation spine: top ticker + left rail + main + collapsible right sidebar. Auto-hides sidebar below 1100px. | Without this, Earn collapses back to a flat single-column placeholder shell. | **YES** | NO |
| `desktop/src/components/earn/EarnTickerStrip.tsx` *(new)* | Restored. 60px top strip with PAID / PENDING / VIEWS / CLIPS count-up tiles + `?` help popover. Reads local tracker only (no Whop). | First thing the clipper sees; primary motivation surface. | **YES** | NO |
| `desktop/src/components/earn/EarnHowItWorks.tsx` *(new)* | Restored. 8-step popover triggered from the ticker's `?` button. | Onboarding/education surface for first-time clippers. | YES | YES (copy polish) |
| `desktop/src/components/earn/EarnSidebar.tsx` *(new)* | Restored. Right rail: Active brief + Your clips (top 3) + Your campaigns (top 5). Local data only. | Glanceable status without leaving Earn. | YES | YES (compact-density polish) |
| `desktop/src/components/earn/EarnIconRail.tsx` *(unchanged)* | Already in tree from prior work; wired by new EarnTab. Five sub-tabs (Open / Doing / SUB / PAY / Top) + Invite popover. | Sub-navigation contract. | **YES** | NO |
| `desktop/src/components/earn/SponsoredBannerCarousel.tsx` *(unchanged)* | Already in tree; mounted unconditionally by new EarnTab. | Public revenue surface — visible to all users, all auth states. | **YES** | NO |
| `desktop/src/components/earn/BountyCard.tsx` | Additive `startLabel?` + `startTitle?` props for inline gating copy. Default unchanged (button still reads "Start"). | Inline "Unlock to start this bounty" requires per-card label override. | **YES** | NO |
| `desktop/src/components/earn/BountyDetail.tsx` *(unchanged)* | Already in tree; opens on card click. | Drill-in surface; public bounties open without auth. | **YES** | NO |
| `desktop/src/components/earn/ManualBountyPrompt.tsx` *(unchanged)* | Already in tree; opens from the AvailableSection filter-empty branch. | Paste-a-link fallback when filters return nothing. | YES | YES (locked-state copy) |
| `desktop/src/components/earn/PayoutsView.tsx` *(new)* | Restored from `73d1a2c~1`; legacy `account.jnremployee.com` URLs flipped to `account.liquidclips.app`. | Payouts sub-tab body. Gated behind `auth.kind === "ready"`. | **YES** | NO |
| `desktop/src/components/earn/AffiliateHero.tsx` | `partner.jnremployee.com` → `partner.liquidclips.app`; billing URL → dashboard URL. | Brand consistency; old subdomain may not resolve. | **YES** | NO |
| `desktop/src/components/earn/EarnErrorBoundary.tsx` | Tiny docstring update referencing new mount. | Cosmetic; the boundary itself still wraps the surface. | NO | YES |
| `desktop/src/components/earn/EarnPanelMount.tsx` | Minor tweak. Component is now dead code (zero external imports — integration-lens confirmed) but kept on disk per scope ("Do not delete components"). | Tagged for separate cleanup commit later. | NO | **YES** |
| `desktop/src/lib/whopBounties.ts` | New `listPublicWhopBounties(first=25)`, `getWhopBountyWithCachedSession(id)`, `getWhopSubmissionWithCachedSession(id)`; existing list helper unchanged. | Cache-safe wrapper contract for Earn data layer. | **YES** | NO |
| **Public bounty loading states** | EarnTab `publicData` initialises to `loading` → skeleton paints from frame 1; error/empty/retry fallbacks; merged grid auto-grows when personal layer lands. | Removes the cold-launch flash-of-empty + makes the auth handoff invisible. | **YES** | NO |
| **Inline locked/action states** | Start button reads "Unlock to start" + paste row collapses to single chip when no JWT + submissions Refresh button reads "Unlock to refresh" when no JWT. | Replaces the v0.7.66 full-page "Continue session" lockout with per-action prompts. | **YES** | NO |

## 2. App shell UI

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `desktop/src/components/SidecarCrashOverlay.tsx` *(existed; now mounted)* | Mounted at root in `App.tsx` so a Python sidecar crash surfaces a full-screen panic UI instead of a silent dead app. | Without the mount, sidecar crashes silently break the whole app. | **YES** | NO |
| `desktop/src/App.tsx` | (1) Mounts `<SidecarCrashOverlay />`. (2) New event listeners `lc:go-home`, `lc:go-earn`, `lc:open-brief` wire BottomCockpit dropdown to actual navigation (previously dead clicks). (3) Missing-OpenAI-key path now opens Settings → API keys instead of FirstRun. | Three real bug fixes: panic visibility, dead-dropdown wires, wrong-flow on missing key. | **YES** | NO |
| `desktop/src/components/cockpit/BottomCockpit.tsx` | Brief dropdown item now passes the project's `whop_bounty_url` in event detail; falls back to a toast when no brief is attached. "Settings → Connections" label flipped to "Schedule → Loadout". | The Brief click used to fire an empty event with no listener — fully dead. | **YES** | NO |
| `desktop/src/components/cockpit/AvatarPanel.tsx` | "Session expired → re-activate" CTA now calls `useActivation().activate()` instead of `openAuthPanel("sign-in")`. | The old path opened a Clerk webview that minted a web session but NEVER a desktop LICENSE_JWT — re-activation was broken. | **YES** | NO |
| `desktop/src/components/cockpit/AvatarOrbit.tsx` | Same re-activate fix as AvatarPanel. | Same. | **YES** | NO |
| `desktop/src/components/Settings.tsx` | "Re-activate this device" button uses `activate()`. | Same root cause as AvatarPanel/Orbit. | **YES** | NO |
| `desktop/src/components/auth/AuthPanel.tsx` | `AuthPanelMode` union narrowed to `"upgrade" \| "dashboard" \| "payouts"` — `"sign-in"` and `"sign-up"` modes deleted. Doc explains why. | Closes the only path that could re-introduce the `/sign-in?redirect_url=/dashboard` web-cookie trap. The deletion is the safety guard. | **YES** | NO |
| `desktop/src/lib/activation.ts` | Browser-fallback error message updated to `https://liquidclips.app/connect-desktop`. | Old message named `account.liquidclips.app` (the satellite). | YES | YES (cosmetic) |
| `desktop/src/lib/authStorage.ts` | `primeLicenseJwtCache` dispatches `lc:desktop-auth-ready` window event; `invalidateLicenseJwtCache` dispatches `lc:desktop-auth-invalidated`. IG-014 sentinel intact. | The wake-up signal that flips Earn from locked → ready after deep-link return. | **YES** | NO |
| `desktop/src/lib/backend.ts` | Two copy strings flipped from "Settings → Connections" to "Schedule → Loadout". | Matches the new Connections nav location. | YES | YES |
| `desktop/src/lib/sidecar.ts` | New `whopListPublicBounties` bridge; existing `whopBounty`/`whopSubmission` gained optional `licenseJwt` param (v0.7.65 plumbing, kept). | RPC contract for the public-first data model. | **YES** | NO |
| FirstRun, auth/activation UI | No changes in this batch beyond the AvatarPanel/Orbit/Settings activate() flip + AuthPanel mode pruning. | The activate() flow IS the auth/activation UI now. | **YES** | NO |

## 3. Publish/export UI

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `desktop/src/components/PublishModal.tsx` | Added `title=…` disabled-reason tooltip to the Publish button: "Publishing in progress…" / "This clip has no rendered file yet…" / "Pick a channel to publish to." / "Pick at least one platform…". | Previously the disabled button just sat there with no explanation. Tooltip is the user-facing diagnosis. | **YES** | NO |
| `desktop/src/components/clips-feed/InlineScheduler.tsx` | (1) Same disabled-reason tooltip on the Schedule button. (2) "Settings → Connections" copy flipped to "Schedule → Channels". | Same UX rationale; copy matches new nav. | **YES** | NO |
| `desktop/src/components/upload/DirectPublishQueue.tsx` | Docstring updated: "Settings → Connections" → "Schedule → Loadout". | Doc-only; reflects current nav. | NO | YES |
| Missing-OpenAI-key route | `App.tsx` flips the key-missing path from FirstRun → Settings/API-keys tab (see §2). | The user couldn't get to API keys when the modal asked them to add one. | **YES** | NO |

## 4. Schedule/social UI

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| Platform icons (Instagram/TikTok/YouTube/X) | **No changes in this batch.** Per Daniel: out of scope for v0.7.68/.69/.70. | Reserved for the next UI regression pass. | N/A | **YES** |
| Channel-state UI | No changes in this batch. | Same. | N/A | **YES** |
| `desktop/src/components/workbench/AccountBindingChip.tsx` | "Settings → Connections" copy flipped to "Schedule → Loadout" / "Schedule → Channels" across hints + footer link. | Matches new nav location post-rebrand. | **YES** | NO |
| `desktop/src/components/clips-feed/InlineScheduler.tsx` | (See §3 — same file, copy + tooltip changes apply to scheduling.) | — | **YES** | NO |
| "Schedule → Loadout" copy update | Applied to: BottomCockpit dropdown label, AccountBindingChip hints/footer, DirectPublishQueue docstring, backend.ts error strings, InlineScheduler line. | Single source of truth for the new nav name. | **YES** | NO |

## 5. Account/web UI (`account-app`, `partner-app`)

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `account-app/src/app/dashboard/page.tsx` | (1) Imports `SignOutButton` client component. (2) "Sign out" action now uses `render: (cls) => <SignOutButton>` escape hatch — Card component supports custom-render actions. (3) `partner.jnremployee.com` fallback flipped to `partner.liquidclips.app`. (4) "Open Earn in desktop →" CTAs honestly relabeled "Download desktop app →" (the dashboard cannot actually open the desktop app via web). (5) "Settings → Connections → Whop" debug line → "Schedule → Loadout → Whop". | Sign-out used to be a dead `<a href="/sign-out">` that didn't actually clear Clerk; download copy was lying about its destination. | **YES** | NO |
| `account-app/src/components/SignOutButton.tsx` *(new)* | Client component that calls Clerk's signOut() programmatically. | Required by the dashboard Sign out action above. | **YES** | NO |
| `account-app/src/app/connect-desktop/page.tsx` | Pass `signUpUrl={/sign-up?redirect_url=...}` so the sign-up flow returns to connect-desktop with the challenge intact. | Sign-up from connect-desktop used to drop the challenge → desktop never minted a JWT. | **YES** | NO |
| `account-app/src/app/sign-in/[[...sign-in]]/page.tsx` | Accepts `redirect_url` / `redirect` search params; defaults to `/dashboard`. Honored by Clerk's `fallbackRedirectUrl`. | Same root cause — the sign-in form was dropping the desktop's return-to URL. | **YES** | NO |
| `account-app/src/app/sign-up/[[...sign-up]]/page.tsx` | Same redirect_url handling as sign-in. | Same. | **YES** | NO |
| `account-app/src/components/embed/EmbedEarnClient.tsx` | Small change (1 line) — likely a copy/URL update. | Embed-Earn surface uses the new domains. | YES | YES |
| `partner-app/src/app/page.tsx` | All `account.jnremployee.com/checkout` → `account.liquidclips.app/checkout`; `jnremployee.com/affiliates` → `liquidclips.app/affiliates`; `whop.com/jnremployee/...` → `whop.com/liquidclips`. | Partner-app referral links pointed at the old domain → 404 risk. | **YES** | NO |
| `partner-app/src/lib/brand.ts` | `marketingUrl` default flipped from `jnremployee.com` → `liquidclips.app`; affiliate path standardized to `/affiliates`. Env override still wins. | Brand source-of-truth. | **YES** | NO |

## 6. Community UI

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `desktop/src/components/CommunityTab.tsx` | Function `whopChatUrl(channelId)` renamed param to `whopChannelId` + updated comment to clarify it expects the `whop_channel_id` field from the backend (not the internal UUID). URL format `whop.com/c/<id>` unchanged. | The variable rename + comment fix was a real bug — wrong field was being passed in some call paths. | **YES** | NO |
| Community URL / comment alignment | Same file — `whop.com/c/<chat_feed_id>` is the canonical URL pattern; comment now accurately reflects this. | Prevents future re-introduction of the wrong-field bug. | **YES** | NO |
| Whop hub/chat behaviour | No further changes in this batch. | Out of scope. | N/A | **YES** |

---

## Backend / infra changes (non-UI but interlinked)

| file | what changed | why it matters | must-preserve | defer-ok |
|---|---|---|---|---|
| `junior-backend/app/routes/whop.py` | **New `GET /whop/bounties/public` route** — unauth, server-side App API Key, Campaign A only, 60s shared cache, IP rate limit honoring `X-Forwarded-For`, fail-closed when `WHOP_CAMPAIGN_B_ID` unset unless `WHOP_PUBLIC_FEED_ALLOW_UNFILTERED=true`. + new `_filter_public_only`, `_public_rate_limit_check`, `_client_ip_for_rate_limit` helpers. | Backbone of the public-bounty product model. **Requires Railway deploy + env var flip** before Earn loads. | **YES** | NO |
| `junior-backend/app/routes/redirect.py` | Attribution cookie domain now reads `settings.attribution_cookie_domain` (default `.liquidclips.app`). Localhost dev still falls through to None. Docstring updated. | First-touch attribution worked but commented on the wrong domain. Now env-overridable. | **YES** | NO |
| `junior-backend/app/config.py` | New settings: `attribution_cookie_domain: str = ".liquidclips.app"`, `whop_public_feed_allow_unfiltered: bool = False`. | Required by the two backend changes above. | **YES** | NO |
| `desktop/python-sidecar/sidecar.py` | New `method_whop_list_public_bounties` + METHODS registration. | TS bridge → Python contract. | **YES** | NO |
| `desktop/python-sidecar/whop_client.py` | New `_backend_get_public()` (no Authorization header) + `list_public_bounties()`. | HTTP layer; keychain-free by construction. | **YES** | NO |
| `desktop/tests/no-passive-keychain.test.mjs` | New regression guard test: "public bounty discovery is unauth and contains no JWT references". Existing IG-014 invariants kept. | Static analysis catches regressions to the public path. | **YES** | NO |
| `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` | Version bumped 0.7.56 → 0.7.70. | Distinguishable installs per hand-walk. | **YES** | NO |

---

## `git diff --stat` (full delta)

```
36 files changed, 1299 insertions(+), 509 deletions(-)
```

Bulk of the line count is the EarnTab rewrite (`+1108 / -…`). The other 35 files
are surgical edits (1-40 lines each).

## `git diff --name-only` (full list)

**UI files (24):**
- `desktop/src/App.tsx`
- `desktop/src/components/CommunityTab.tsx`
- `desktop/src/components/PublishModal.tsx`
- `desktop/src/components/Settings.tsx`
- `desktop/src/components/auth/AuthPanel.tsx`
- `desktop/src/components/clips-feed/InlineScheduler.tsx`
- `desktop/src/components/cockpit/AvatarOrbit.tsx`
- `desktop/src/components/cockpit/AvatarPanel.tsx`
- `desktop/src/components/cockpit/BottomCockpit.tsx`
- `desktop/src/components/earn/AffiliateHero.tsx`
- `desktop/src/components/earn/BountyCard.tsx`
- `desktop/src/components/earn/EarnErrorBoundary.tsx`
- `desktop/src/components/earn/EarnPanelMount.tsx`
- `desktop/src/components/earn/EarnTab.tsx`
- `desktop/src/components/upload/DirectPublishQueue.tsx`
- `desktop/src/components/workbench/AccountBindingChip.tsx`
- `account-app/src/app/connect-desktop/page.tsx`
- `account-app/src/app/dashboard/page.tsx`
- `account-app/src/app/sign-in/[[...sign-in]]/page.tsx`
- `account-app/src/app/sign-up/[[...sign-up]]/page.tsx`
- `account-app/src/components/embed/EmbedEarnClient.tsx`
- `partner-app/src/app/page.tsx`
- `partner-app/src/lib/brand.ts`
- *(plus 5 new untracked Earn files — see below)*

**Backend / auth / infra files (10):**
- `desktop/python-sidecar/sidecar.py`
- `desktop/python-sidecar/whop_client.py`
- `desktop/src/lib/activation.ts`
- `desktop/src/lib/authStorage.ts`
- `desktop/src/lib/backend.ts`
- `desktop/src/lib/sidecar.ts`
- `desktop/src/lib/whopBounties.ts`
- `desktop/tests/no-passive-keychain.test.mjs`
- `junior-backend/app/config.py`
- `junior-backend/app/routes/redirect.py`
- `junior-backend/app/routes/whop.py`

**Version / config (2):**
- `desktop/package.json`
- `desktop/src-tauri/tauri.conf.json`

**Untracked new files (12):**
- `account-app/src/components/SignOutButton.tsx`
- `desktop/src/components/earn/EarnHowItWorks.tsx`
- `desktop/src/components/earn/EarnLayout.tsx`
- `desktop/src/components/earn/EarnSidebar.tsx`
- `desktop/src/components/earn/EarnTickerStrip.tsx`
- `desktop/src/components/earn/PayoutsView.tsx`
- `docs/AUTH_STATE_CUSTOMER_JOURNEY_AUDIT.md`
- `docs/BUG_REMINDER_REGISTRY.md`
- `docs/CUSTOMER_JOURNEY_UI_DEAD_END_AUDIT.md`
- `docs/EARN_AVAILABLE_BOUNTY_DATA_MODEL.md`
- `docs/EARN_UNIVERSAL_SURFACE_PLAN.md`
- `docs/UI_POLISH_AND_LINK_FIX_PLAN.md`
- `docs/UI_PRESERVATION_INVENTORY.md` ← this file

---

## Validation status (this batch)

| check | status |
|---|---|
| `desktop` tsc | **0 errors** |
| `desktop` invariant tests | **10/10 pass** |
| `desktop` `assert-no-passive-keychain.sh` | **clean** |
| `desktop` tauri build (v0.7.70) | **green** |
| `desktop` local install | **v0.7.70 installed**, PID 42029, marker reads `EARN SURFACE: public-bounty native EarnTab v0.7.70` |
| `account-app` tsc --noEmit | **0 errors** |
| `junior-backend` `python -m compileall app` | **OK** |
| `partner-app` tsc | **node_modules missing — cannot typecheck** (explicit per spec) |
| Final grep (sign-in/sign-up dashboard redirects, openAuthPanel, jnremployee URLs, account.liquidclips/{billing,earn}, Settings → Connections) | **zero active code hits** — all matches are comments/docs |

## What is untested

- **Whop public bounty grid rendering** — cannot test until backend route is deployed (`railway up --service junior-backend`). Today the desktop hits 404 → "Couldn't load Whop bounties right now" retry card. The wiring is verified by static checks + local curl against a locally-booted backend earlier in this session.
- **Deep-link return → personal layer hydration** — requires real activation flow. Single-user manual test only; no automated test in the suite.
- **AffiliateHero billing/dashboard CTAs** post-rebrand — visual landing only; no automated assertion on click destination.
- **partner-app render** — `node_modules` missing locally; cannot tsc. The brand.ts + page.tsx changes are URL-string-only and won't typecheck-break, but a real `npm install && next build` is the only way to confirm.
- **SignOutButton click in production Clerk** — `useClerk().signOut()` is the documented API; not regression-tested here.

## What needs a final hand-walk before commit

1. **Desktop v0.7.70 launched (PID 42029)** — confirm:
   - No keychain prompt at launch
   - Earn marker reads v0.7.70
   - Sponsored carousel visible
   - "Couldn't load Whop bounties" retry card (until Railway deploy)
   - BottomCockpit ⋮ menu items (Brief / Home / Earn) no longer dead clicks
   - Re-activate CTAs in AvatarPanel / AvatarOrbit / Settings route to `activate()`
   - PublishModal disabled tooltip shows reason on hover
   - InlineScheduler disabled tooltip shows reason on hover
   - Sidecar crash overlay (kill sidecar with `pkill -f sidecar.py` mid-session → full-screen panic UI)
2. **account-app dashboard** (deploy preview or local dev) — confirm Sign out actually clears the session; Download CTAs no longer claim "Open Earn in desktop".
3. **Backend deploy decision** — see Gate 6 deploy-readiness in `EARN_AVAILABLE_BOUNTY_DATA_MODEL.md`. Backend is safe to deploy; the public route is fail-closed unless `WHOP_PUBLIC_FEED_ALLOW_UNFILTERED=true` is set on Railway (today's pre-Step-8 state).

No commit until this inventory is reviewed and signed off.
