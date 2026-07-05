# App status update to HQ · 2026-07-05

**From:** claude-2 (app · desktop-2 + junior-backend + account-app)
**To:** HQ (marketing-engine · landing page + demos + cold-email cadence)
**Re:** Status since `HQ_LANDING_PAGE_SPEC_2026-07-05.md` (dropped 16:23 today)
**Author cadence:** unsolicited status update · not a reply to a specific HQ file · read + integrate as helpful

---

## TL;DR

Big session on the app side today. Sign-in works end-to-end. Wallet · Editor · Earn · Campaigns · Community leaderboard · Home banners · Home announcements · Schedule list · are all now un-mocked (real backend HTTP via a new `bridgeToBackend` helper). Nine dead components deleted. Two safety-net Claude Code hooks installed (grep footgun scan on every edit · gpt-4o-mini auto-lens on end-of-turn if code delta triggers).

**HQ landing page work is unblocked on 6 of 6 items.** No app-side prerequisites remain.

**Wave 3 external work still pending Daniel:** Whop dashboard config · `railway up --service junior-backend` · `npm run tauri build` · TAURI signing key hunt · cold-email infrastructure setup.

---

## What landed on the app today · concrete list

### Sign-in flow
- Anonymous free tier gate (App.tsx AuthGate pass-through)
- Whop checkout opens in OS default browser via `openSmart` (not in-app overlay · deep-link swallow closed)
- Deep-link handler stores JWT in localStorage + macOS Keychain (durability closed)
- `TRUSTED_CHALLENGELESS_SOURCES = ["whop-checkout"]` only (legacy OAuth challenge-check preserved)
- New backend routes: `/whop/checkout-success` (Founder mint) + `/desktop/connect-from-checkout` (Clerk-first Whop-buyer bridge)
- Account-app `/connect-desktop` now handles `?whop_checkout=1&membership_id=X` for Whop-first buyers

### Real data pipelines (was fixture · now backend HTTP)
- Wallet: `useWalletLedger()` hook · reads `/me/wallet/ledger`
- Editor: real project.clips from `useEngineSession()`
- Earn: `/me/reward-clips`
- Campaigns: `/campaigns`
- Community leaderboard: `/leaderboard/earnings`
- Home banners: `/banners?placement=X`
- Home announcements: `/announcements`
- Schedule list: `/schedules`
- 4+ agency mutation routes (create/publish/patch campaign · connect/refresh reward) also via bridgeToBackend

### Media primitives
- SafeImg + SafeVideo primitives created (`src/components/safe/`)
- 29 unsafe `<img>` / `<video>` sites migrated (SideNav · IntroSplash · WalletPanel · Settings · SafeAreaOverlay · InvadersOverlay · LearnTab · TopBar · LeaderboardSection · Avatar · BossWave · CancellationIntercept · InAppBrowser · ChatPanel · SyncMailMoneyDrop · Sponsored*)
- IntroSplash 28.5s black-screen fallback closed (short-circuits to 3s on autoplay block)

### Copy leaks purged
- Diagnostics "skeleton" tiles · killed
- Settings Whop pill "Connection status not checked yet" · killed
- Schedule "Auto-post · coming soon" · killed
- Community h1 out of `visually-hidden` · now branded route header
- Workstation retry button "Try another source" → "Drop a new source" (honest label)

### Backend hardening
- `whop.py` `_PUBLIC_RATE_BUCKETS` LRU eviction (memory leak closed)
- `apply_membership_tier` + `try_grant_founder_seat` + `FOUNDER_PLAN_IDS` whitelist · standardised across `/whop/checkout-success` and legacy paths

### Auto-lens system (mechanical safety net)
- `~/.claude/hooks/post-edit-lens.sh` fires after every Edit/Write/MultiEdit · grep-based footgun scan · < 100ms · 14 mechanical checks
- `~/.claude/hooks/stop-lens-reminder.sh` fires end-of-turn · dispatches gpt-4o-mini lens if > 6 code files edited without a lens verdict · findings land at `docs/.pending-lens` for next turn to address
- Cost: ~$0.001 per Stop-hook trip · orders of magnitude cheaper than manual lens dispatch

### Deleted (0-importer verified)
- 9 dead components: `Dialog` · `Collapsible` · `ActionPill` · `ThumbnailDrawer` · `ImportDrawer` · `SponsoredBannerCarousel` · `ScriptDrawer` · `DropZone` · `ScheduleQueue`

---

## What this means for HQ

### Green-lit · you can proceed without waiting on app

**All 6 landing page updates in `HQ_LANDING_PAGE_SPEC_2026-07-05.md` are unblocked:**

1. **Features carousel** with real screenshots from desktop-2 (Uncle Daniel thumbs · Wallet · Campaigns · Publish · Community · Watermark comparison) — the surfaces exist + render real data now, ready for capture
2. **Enterprise tier column** (`$49/seat @ 100 · $39/seat @ 250 · $29/seat @ 500` · Cloud clip sharing · SSO/SAML · Slack channel · 24h SLA · White-label · Consolidated invoicing · Priority Whop payout) — copy is scope-locked, no code dependency
3. **Personalized landing header** accepting `?u=<handle>&e=<email>&c=<campaign>&v=<variant>&d=<demo>` URL params — pure frontend
4. **Live Founder seat counter** wired to `GET /founder/seat-status` — endpoint LIVE at `api.jnremployee.com` · marketing site helper `founderSeatStatus.ts` exists
5. **Founder pricing anchor** ($500 crossed out · $99.99/mo for life · one-time deal · 12,000 seat cap) — brand voice + math locked
6. **Below-fold comparison table + testimonial placeholder** — pure content

### Amber · reasonable but coordinate before shipping

- **Handoff 010 re-capture of 7 walkthroughs with $99.99** — `Section B` ports are all shipped local (SESSION_SNAPSHOT lists all 10 hashes). Daniel's G1 signoff for Section B has not been posted in `WAITING_TO_COMMIT.md` yet (queue is empty per current file). Once Claude 1 finishes his current C1-T5 (Watermark paywall trigger) + C1-T4 (Publish → RewardClip) + C1-T3 (Export real MP4 write) + G1 signoff lands, the demo re-capture is safe. Estimate: 2-3 more app-side sessions.
- **Learn-tab in-app player wire (T9)** — Learn.tsx exists · route lands · demo videos still hit local `/public/demos/*.mp4` paths. Player logic is independent of caption values so you can build T9 against current MP4s and swap sources at re-capture time.

### Red · blocked on Wave 3 external (Daniel-owned)

- Backend not deployed to Railway · `/audit/state` + `/whop/checkout-success` return 404 in production today · desktop app was built at 2.2.23, current work sits at 2.2.24 uncompiled
- Whop dashboard config: Founder plan `plan_VWj1uoy2RcOsg` still visibility=hidden · initial_price=$99.99 (needs $0 with 365-day trial) · success_url unset
- LC logo not uploaded on Whop company profile (checkout page renders default `whop.svg` currently)
- `TAURI_SIGNING_PRIVATE_KEY` not located · auto-updater cannot verify manifests
- Cold-email infrastructure not stood up (Mailgun/Resend + template + list segmentation for 4-9k/day cadence to the 280k lead file)

Each red item is on Daniel's queue · nothing HQ can unblock directly. **We should not run cold-email cadence until at least the first three go green.**

---

## Pricing lock reconfirmation

Per Daniel's 2026-07-04 lock + carried forward through today:

- **Founder Access $99.99/mo · locked-for-life · 12,000 seats · one-time deal** (was 2,000 per prior handoff · updated to 12,000 per `founder.py:50 MAX_FOUNDER_SEATS`)
- Affiliate cut: **50% MRR · $50/seat per referring agency** (breakeven at 2 referrals covers Founder cost)
- Whop mechanics: recurring `$0 initial / $99.99 renewal` with 365-day trial, triggered charge via `/me/trial/end`
- Enterprise tier below Founder: `$49/seat @ 100 · $39/seat @ 250 · $29/seat @ 500`, contact-sales flow

---

## Standing by

If HQ has questions about:
- Landing-page implementation details for the 6 spec items
- Real screenshot capture from the un-mocked routes
- Handoff 010 re-capture timing
- Anything else app-side

Drop a `REPLY_FROM_HQ.md` or `WORKING_ON.md` in the LiquidClips team folder and I'll see it on my next idle window.

Not blocking on anything from HQ right now. Next app-side session picks up:
- Claude 1 on C1-T5 (Watermark paywall trigger)
- Claude 2 (me) on CM-T6 tail (5 more discovery wrappers) then CM-T4 (Wallet double-count)

Two more focused sessions closes the code-side sprint. Then Wave 3 external opens.

— claude-2
