# Claude Customer Journey Audit - 2026-06-01

Purpose: map every current Liquid Clips surface from user acquisition through clipping, publishing, Whop reward work, affiliate earnings, and payout setup. This is a code-grounded audit, not a live production proof. Static checks passed at the bottom.

## Executive Summary

**Public clipping path is mostly ready.** A signed-in user can activate desktop, add an OpenAI key, import/paste a public source, choose intent, run the local sidecar pipeline, view/export/edit generated clips, and use local drip reminders.

**Getting paid has two separate paths and they are not equally complete.**

1. **Whop Content Rewards:** users can browse public rewards through the backend Whop proxy, start bounty projects, keep briefs attached, publish/prepare submissions, and track locally remembered Whop submission IDs. Actual Whop submission remains manual because Whop has no public submit API in this app path.
2. **Liquid Clips affiliate commission:** paid/founder/admin users can see their referral dashboard via `/me/affiliate`. Whop-native affiliates are paid through Whop. Non-Whop affiliates are routed to Stripe Connect Express from the account dashboard. The Stripe Connect setup path is wired, but live payout completion depends on Stripe env, webhook delivery, and Connect return URLs.

**Highest-risk breaks before public launch:**

1. **Tier vocabulary split remains user-facing in desktop.** `useTier.ts` still exposes `growth/autopilot` and Growth/Autopilot prices, while marketing/account app now sell Free/Solo/Pro/Agency. This can confuse upgrade walls and quota copy.
2. **Publishing says it is on, but live success depends on backend env.** `PUBLISHING_ENABLED` is `true`; users can enter PublishModal. If `AYRSHARE_API_KEY` or profile key/platforms are not ready, the flow degrades to Settings/errors.
3. **Whop rewards browsing depends on backend `WHOP_API_KEY`.** If absent, Earn is activated but shows an error and manual paste fallback. That is acceptable only if manual fallback is considered launch-ready.
4. **Minecraft Challenge accepts submissions to Liquid Clips, not Whop payouts.** `/submissions` stores and reviews campaign submissions, but `_ACTIVE_CAMPAIGNS[0].whop_campaign_id` is `None`; there is no automatic Whop payout/forwarding.
5. **Affiliate payout state is split by rail.** Whop-native affiliates show Whop payout dashboard. Non-Whop affiliates can set up Stripe Connect, but actual commission payout ledger/disbursement is not visible in the inspected code.

## Screen Inventory And Flow Status

| Surface | Code | End-to-end status | Notes |
|---|---|---|---|
| Marketing home | `liquidclips-marketing/src/app/page.tsx` | Works as static acquisition surface | Download URL env must point to final notarized DMG/release. |
| Marketing help | `liquidclips-marketing/src/app/help/**` | Works as static support surface | Covers getting started, publishing, billing, troubleshooting. |
| Minecraft challenge landing | `liquidclips-marketing/src/app/lift/minecraft-challenge/page.tsx` | Needs live marketing QA | Route exists after Claude #14c. Verify copy matches actual `/submissions` behavior. |
| Account landing/pricing | `account-app/src/app/page.tsx`, `PricingCards.tsx` | Mostly ready | Depends on final Clerk plan ids/env. |
| Whop affiliate checkout | `account-app/src/app/checkout/page.tsx` | Wired, needs live Whop proof | Captures `?a=`, sets `jnr_ref`, mounts Whop checkout, redirects to `/get`. Needs live embedded checkout run. |
| Get/onboarding after checkout | `account-app/src/app/get/page.tsx` | Needs focused proof | Existing doc says parked Whop membership can link silently. Verify emails/notifications for common pay-before-signup flow. |
| Account dashboard | `account-app/src/app/dashboard/page.tsx` | Improved source of truth | Now fetches backend `/affiliate/me` and uses Clerk metadata only as fallback. This reduces previous split-brain. |
| Stripe Connect button | `account-app/src/components/AffiliateCard.tsx`, `app/api/affiliate/stripe-connect/route.ts` | Wired, needs live Stripe proof | Browser POSTs account app API, server forwards to backend, backend creates Express AccountLink. |
| Desktop splash | `desktop/src/components/Splash.tsx`, `SplashGame.tsx` | Type-checks | Current dirty changes in `SplashGame.tsx` are not mine; visual/manual QA needed. |
| Desktop onboarding overlay | `desktop/src/components/onboarding/OnboardingOverlay.tsx` | Wired | Shows only true first-run, persists `LIQUIDCLIPS_ONBOARDED=v1`. |
| Desktop first-run sign-in/key | `desktop/src/components/FirstRun.tsx` | Wired | Activates via browser and saves OpenAI key. Copy still says hosted AI private beta. |
| Workspace/dropzone | `desktop/src/components/DropZone.tsx` | Ready | File import, URL import, Script mode entrypoints. |
| Intent picker | `desktop/src/components/IntentPicker.tsx` | Ready | Routes file/URL into clips, YouTube metadata, or both. |
| URL ingest/downloading | `desktop/src/App.tsx`, sidecar ingest | Ready with public-source caveat | Private/login-walled sources fail into `FailureCard`. |
| Clip pipeline | `desktop/python-sidecar/stages.py`, `sidecar.py` | Static checks pass | Real media smoke test still recommended on clean install. |
| Script/lift transcript | `desktop/python-sidecar/whisper_backend.py`, `sidecar.py` | Wired | MLX path falls back to faster-whisper. MLX real-audio runtime still unproven in this audit. |
| Results grid | `desktop/src/components/ResultsGrid.tsx` | Ready | Shows clips, YouTube tab, files, local drip, publish entrypoints. |
| Clip editor/preview | `desktop/src/components/ClipPreview.tsx` | Needs manual QA | Not deeply audited in this pass because user asked journey breadth. |
| Local drip reminders | `DripCalendar.tsx`, `UploadTab.tsx`, `LocalQueue.tsx` | Ready local path | No backend dependency. |
| Publish now/schedule | `PublishModal.tsx`, `backend.publishNow`, `/publish-now` | Wired, env-dependent | Requires paid tier, license JWT, Ayrshare Profile Key, connected platform, backend Ayrshare env. Instagram is visible but queued/unsupported in code. |
| Upload tab | `desktop/src/components/upload/UploadTab.tsx` | Ready as status surface | Shows connected platforms and local queue; hosted auto-publish section visible if flag true. |
| Settings/account/keys | `Settings.tsx`, `AyrshareConnectionPanel.tsx` | Wired | Keychain secrets and Ayrshare profile key save/refresh paths exist. Telemetry toggle now appears wired via `getTelemetryConsent/setTelemetryConsent` imports. |
| Inbox | `NotificationSheet.tsx` | Wired | Requires license JWT and backend notifications. |
| Earn tab | `EarnTab.tsx` | Wired with fallback | Activation-gated. Lists Whop rewards via backend proxy, supports link/ID paste fallback. |
| Bounty setup | `BountySourceSetup.tsx` | Wired | Detects/picks source before pipeline. |
| Bounty project resume | `listBountyProjects`, `EarnTab` | Wired local path | Reads local project metadata. |
| Reward clips panel | `RewardClipsPanel.tsx`, `/me/reward-clips` | Needs deeper payout audit | Tracks generated reward clips/links, not actual Whop payment truth. |
| Leaderboard | `Leaderboard.tsx`, `/leaderboard/earnings` | Wired | Needs live backend data proof. |
| Payouts tab | `PayoutsTab.tsx` | Partly real, partly local | Whop reward totals are local tracker-derived; affiliate totals come from `/me/affiliate`. |
| Minecraft card/portal | `MinecraftChallengeCard.tsx`, `SubmissionPortal.tsx`, `/submissions` | Wired for Liquid Clips submissions | Not yet automatic Whop payout forwarding. |
| Learn tab/doctrine | `LearnTab.tsx`, `DoctrineLibrary.tsx`, `/doctrine` | Wired | Needs content QA, not revenue-critical. |
| Browse Rewards panel | `BrowseRewardsPanel.tsx`, `lib/browse.ts` | Wired | Commerce paths bounce to browser. Needs Tauri manual QA. |
| Partner app | `partner-app/src/app/page.tsx` | Whop-native affiliate dashboard | Separate Whop OAuth flow, not Clerk. Needs live Whop OAuth proof. |
| Admin HQ bugs/submissions | `account-app/src/components/admin/AdminHQ.tsx`, backend admin routes | Wired | Admin can view desktop bugs and submission statuses. |

## Customer Journey Maps

### A. New Creator - Free Starter To First Clip

1. Marketing/download route sends user to latest DMG.
2. Desktop launch shows splash, then first-run onboarding if no keychain entries exist.
3. User signs in via `account-app/connect-desktop`; account app mints license JWT; desktop stores `LICENSE_JWT`.
4. User adds OpenAI key in FirstRun or Settings.
5. User drops file or pastes public URL in Workspace.
6. IntentPicker routes to pipeline.
7. Sidecar ingests, extracts audio, transcribes, picks clips, cuts/reframes/thumbs.
8. ResultsGrid shows clips; user can edit, export, local-drip, or try Publish.

**Likely breakpoints:** missing Python deps, no OpenAI key, private URL source, local media codec edge cases, first-run user skips both account and key then hits pipeline guard.

**Launch readiness:** Good, with one real clean-install media smoke test still needed.

### B. Creator Publishes A Clip

1. User must be signed in and on a tier with publish capability per `useTier`.
2. User connects Ayrshare in Settings by pasting Profile Key.
3. Settings refreshes platforms from backend `/social`.
4. ResultsGrid opens PublishModal.
5. PublishModal calls `backend.publishNow`, uploading the local vertical mp4.
6. Backend `/publish-now` sends to Ayrshare and returns per-platform results.

**Likely breakpoints:** free tier upgrade wall, missing license JWT, no Ayrshare profile key, backend `AYRSHARE_API_KEY` missing, platform unsupported, Instagram selected but code treats it as next-sprint.

**Launch readiness:** Needs live Railway/Ayrshare env proof. UI is wired.

### C. User Clips For Whop Content Rewards

1. User signs in/activates desktop.
2. Earn tab checks `whopSessionStatus`; public reward browsing only requires Liquid Clips license JWT.
3. Sidecar calls backend `/whop/bounties`; backend uses server-side Whop App API key.
4. User picks or pastes a reward.
5. BountySourceSetup selects source URL or local file.
6. Pipeline creates clips with bounty metadata attached.
7. ResultsGrid shows bounty context and submission capture.
8. User posts the clip publicly.
9. User submits manually on Whop or uses local tracking panels to remember submission IDs/status.

**Likely breakpoints:** backend `WHOP_API_KEY` missing, Whop GraphQL changes/complexity, bounty has no source URL in description/attachments, Whop has no public submit API, submission status requires remembered ID.

**Launch readiness:** Good as “assistive Whop clipping”, not as fully automated Whop submission.

### D. Minecraft Story Clip Challenge

1. Workspace shows MinecraftChallengeCard.
2. User opens SubmissionPortal.
3. Portal fetches `/submissions/campaigns/active`.
4. User submits public clip URL and metadata.
5. Backend downloads clip via `yt-dlp`, runs watermark detector.
6. Clean submission is stored as `submitted`; watermarked clip is stored as rejected and returns upgrade CTA.
7. Admin/mod can update status to accepted/rejected/forwarded.

**Likely breakpoints:** unauthenticated users cannot list campaigns, `yt-dlp` missing on Railway, platform download blocked, detector false positives/negatives, no Whop campaign id set, no automatic payout forwarding.

**Launch readiness:** Good for internal challenge intake, not yet full Whop payout automation.

### E. Affiliate Earner - Whop Native

1. Partner signs in at partner app through Whop OAuth.
2. Partner app calls Whop and ensures affiliate.
3. Partner shares `account.jnremployee.com/checkout?a=<affiliate_id>`.
4. Buyer checks out through Whop, then signs up/links account.
5. Backend stores buyer `affiliate_id` first-touch.
6. `/me/affiliate` get-or-creates user’s own Whop affiliate by email and reports Whop stats.
7. Whop owns partner payouts.

**Likely breakpoints:** Whop OAuth/cookies, affiliate id mismatch if Whop regenerates ids, pay-before-signup parked membership still needs live confirmation, no Junior-side payout ledger for Whop.

**Launch readiness:** Good if Whop OAuth and checkout are live-tested.

### F. Affiliate Earner - Stripe Connect

1. Paid/founder/admin user without Whop affiliate sees Stripe Connect payout rail.
2. Account dashboard “Set up Stripe Connect” POSTs `/api/affiliate/stripe-connect`.
3. Account app forwards verified Clerk user id to backend `/me/affiliate/stripe-connect/onboarding`.
4. Backend creates/reuses Express account and returns Stripe AccountLink.
5. Stripe returns to configured URL; webhook `account.updated` must persist active status.
6. Desktop Payouts tab and AffiliateHero read `/me/affiliate` payout status.

**Likely breakpoints:** `STRIPE_SECRET_KEY` missing, Connect return/refresh URL wrong, webhook not configured, Whop-native users get 409 by design, no inspected commission disbursement job.

**Launch readiness:** Onboarding path is wired. Actual payouts require a live Stripe Connect QA run and commission payout job confirmation.

## Specific Issues For Claude

### P0/P1 Before Public Launch

1. **Resolve tier vocabulary on desktop.**
   - `desktop/src/lib/useTier.ts` still uses `growth/autopilot` and `$99.99/$199.99`.
   - Marketing/account app are now Free/Solo/Pro/Agency.
   - Risk: upgrade walls and quota copy contradict pricing.

2. **Run live env proof for publish.**
   - Verify `AYRSHARE_API_KEY`, `/social/connect`, `/social/refresh-platforms`, and `/publish-now` on Railway.
   - Test one YouTube/TikTok/X publish from an actual generated vertical mp4.
   - Decide Instagram posture: hidden, disabled, or explicitly “coming next sprint”.

3. **Run live env proof for Whop rewards.**
   - Verify backend `WHOP_API_KEY` can list `/whop/bounties`.
   - Test pasted `bnty_...` detail fetch.
   - Test common no-source bounty and manual fallback.

4. **Clarify payout promise.**
   - Whop reward payouts are Whop-owned and mostly local-tracked in Payouts.
   - Affiliate commissions show Whop or Stripe Connect setup, but I did not find a full Stripe Connect commission disbursement job in this pass.
   - Public copy should not promise automatic direct payouts unless the payout job exists and is tested.

5. **Minecraft Challenge needs “submission intake” language unless Whop forwarding is added.**
   - `whop_campaign_id` is `None`.
   - `/submissions` stores/reviews entries but does not forward/pay through Whop automatically.

### P2 Hardening

1. Add a real one-click “Open Settings Connections” handler for Earn’s `junior:open-settings` event if not already handled elsewhere.
2. Add direct live test for first-run skip state: skip onboarding, no JWT, no OpenAI key, then attempt clip. Ensure guard copy is clean.
3. Add live clean-install MLX transcript smoke test on Apple Silicon.
4. Add an Admin HQ view or export for Minecraft submissions if mod review is expected at launch.
5. Confirm `yt-dlp` exists in the production backend image if `/submissions` is public.

## Validation Run During Audit

Passed:

- `npx tsc --noEmit` in `desktop/`
- `npx tsc --noEmit` in `account-app/`
- `npx tsc --noEmit` in `liquidclips-marketing/`
- `PYTHONPYCACHEPREFIX=/private/tmp/jnr-pycache python3 -m py_compile junior-backend/app/*.py junior-backend/app/routes/*.py desktop/python-sidecar/*.py`
- `git diff --check`

Not run:

- No live Clerk checkout.
- No live Whop checkout/OAuth.
- No live Stripe Connect onboarding.
- No live Ayrshare publish.
- No real media import/export smoke test from a clean installed app.

## Current Working Tree Note

At audit start, the only dirty source files were:

- `desktop/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src/components/invaders/SplashGame.tsx`

I did not inspect those as my own changes and did not edit them. This report is the only file added by this audit.
