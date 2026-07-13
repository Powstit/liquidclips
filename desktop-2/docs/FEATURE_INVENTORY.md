# Liquid Clips · Feature Inventory

**Doc 3 of 12** in the RC1 handover series. Read [`PRODUCT_OVERVIEW.md`](./PRODUCT_OVERVIEW.md) first for the two-mode model and the FROZEN shell rules.
Certified against commit `e446ddb7` · tag `rc1-dev-handover-2.2.36` · desktop shell v2.2.36.

Every row cites the file it references so a reader can jump to the actual code. Status values:

- **live** — wired end-to-end, real backend or shipped-frontend, walked in the linked spec.
- **gated** — wired but tier-gated (Free sees stub/upsell, Agency sees full).
- **partial** — visible in-app, honest "coming soon" copy, not fully wired.
- **mocked** — front-end only; backend or third-party not yet wired.
- **planned** — designed but no on-disk implementation.
- **deprecated** — kept on disk for fallback / reference; no new work should land here.
- **unclear · verify with Daniel** — evidence in the tree is ambiguous.

Ownership pipeline values follow `desktop-2/CLAUDE.md` §"Two-pipeline pattern":
- **Section** — `src/routes/**` + `src/sections/**`, registered in `src/shell/sectionRegistry.ts`.
- **Design-OS** — `src/design-os/routes/**`, registered in `src/design-os/routing/SimulatorRouter.tsx`.
- **Shell/util** — supporting code that runs outside the route registries (auth gates, boot, overlays).

Route/surface uses the customer-visible hash. Tier column: `Free`, `Agency`, `Both` (shown to both tiers with mode-specific copy), `Founder-deferred` (built but locked to a deferred plan). Ownership column: `Clipper`, `Agency`, `Both`.

Dropbox references at the bottom of the doc.

---

## 1 · Auth · Onboarding · Session

| Feature | Route / surface | Pipeline | Tier | Clipper / Agency | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Boot + hash router | (root) | Shell/util | Both | Both | `src/App.tsx`, `src/shell/routes.ts:useHashRoute` | none | live | `boot-baseline.spec.ts`, `cold-start-fresh.spec.ts`, `cold-start-returning.spec.ts` | Section-registry hashes short-circuit; unknown hashes fall through to Design-OS `SimulatorRouter`. |
| Intro splash + Invaders game | overlay (pre-`#/home`) | Shell/util | Both | Both | `src/overlays/IntroSplash.tsx`, `src/overlays/invaders/*` | `useArcadeLeaderboard` | live | `splash-and-agency-palette.spec.ts` | Cheat via `?skipIntro=1`. Splash game is TASK 8B; deleting it breaks brand + first-run pattern. |
| Whop hosted checkout (primary sign-in) | TopHud "Sign in" CTA | Shell/util | Free → Agency | Both | `src/design-os/components/TopHud.tsx`, `src/lib/whopCheckout.ts:openSignInOrSignUpBridge` | Whop `plan_NMKvKj8SVVKsY` | live | `login-whop-authorization.spec.ts` | Opens in OS default browser or persistent BrowseOverlay. **Never build a competing in-app auth webview** — the old one was deleted in 2.2.24 (see `App.tsx:69-75`). |
| Clerk OTP fallback sign-in | inline panel | Shell/util | Free | Both | `src/components/auth/ClerkOtpPanel.tsx`, `src/components/auth/SimpleLoginPanel.tsx` | Clerk + `junior-backend /desktop/connect` | live | `clerk-otp-login.spec.ts`, `login-lc-id-email.spec.ts` | Secondary rail. Do not add revenue through Clerk. |
| Activation deep-link (`liquidclips://activate`) | deep-link | Shell/util | Both | Both | `src/lib/activation.ts`, `src/lib/deepLinkBoot.ts` | `junior-backend /whop/checkout-success` → 302 | live | `activation-flow.spec.ts`, `activation-bonus-states.spec.ts` | Tauri deep-link plugin registered in FROZEN shell. Don't touch. |
| JWT storage + keychain resume | (root) | Shell/util | Both | Both | `src/lib/authStorage.ts`, `src/lib/useAuth.ts` | `junior-backend /me` | live | `keychain-presence-contract.spec.ts` | Keychain service `video.junior.desktop` / entry `JUNIOR_LICENSE_JWT` (see memory `junior_local_qa_stack`). |
| Welcome / cold-lead landing | (post-splash) | Design-OS | Free | Both | `src/design-os/routes/WelcomeRoute.tsx` | HQ cold-lead `?e=&u=&c=` in launch URL | live | `first-run-onboarding.spec.ts` | Two states: fresh install vs cold-traffic lead. Marquee of demo mp4s from `public/brand/`. |
| Crew onboarding (post-verify referral flywheel) | `#/crew-onboarding` | Section | Free | Clipper | `src/routes/crew-onboarding/CrewOnboarding.tsx` | `/me` `onboarding_status` markers | live | `CrewOnboarding.test.ts` (unit) | Routed from WelcomeRoute when `crew_onboarding_*` markers unset. |
| Membership gate (paywall wrapper) | (overlay) | Shell/util | Both | Both | `src/components/gate/MembershipGate.tsx`, `src/components/gate/ActivateFounderPanel.tsx` | `useBillingState()` | live | `ransom-paywall-flow.spec.ts` | Wraps app when JWT present but no active membership. |
| Asset ransom paywall (clip 11+) | (overlay) | Shell/util | Free | Both | `src/components/paywall/AssetRansomPaywall.tsx` | `useTierCaps()` | live | `ransom-paywall-flow.spec.ts`, `AssetRansomPaywallTestHook` | Locks assets after 10-clip Free cap. **10 clips is the ONLY free-tier limit** per pricing pivot (2026-07-06). |
| Sign-out | Settings > Account | Design-OS | Both | Both | `src/design-os/routes/Settings.tsx` (Account tab) | `authStorage.clearJwt` | live | covered indirectly in `settings-avatar.spec.ts` | Removes JWT from keychain, hard-refreshes. |

---

## 2 · Cold entry / money-surface shells (Section pipeline)

The money-surface rule (locked 2026-07-10) applies here: each of these needs an approved HTML mockup in `docs/mockups/approved/` + founder video in `public/brand/founder/*.mp4` + 3+ explicit states. See `desktop-2/CLAUDE.md` §"The money-surface rule".

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Cold-entry route family | (no `src/routes/cold-entry/**` directory on disk at HEAD) | Section | Free | Both | — | — | **unclear · verify with Daniel** | none | Spec references `src/routes/cold-entry/**`; `find` returns nothing. May be planned/renamed. Approved mockup `docs/mockups/approved/login-activation.html` covers the same slot. |
| Cold-email preview embed card | agency campaign builder | Section | Agency | Agency | `src/routes/campaign-builder/EmbedPreviewCard.tsx` | none (preview only) | live | none dedicated | Approved mockup: `docs/mockups/approved/cold-email-preview-embed-card.html`. |
| Sync-mail money drop (warm-peer intro) | `#/outreach` | Section | Free | Both | `src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx`, `src/sections/outreach/OutreachSection.tsx` | none client-side | live | `OutreachSection.test.ts` | `navVisible: false` in registry — reachable only via direct hash today. Approved mockup: `docs/mockups/approved/sync-mail-money-drop.html`. |
| Catalog carousel | (embedded in Home + Wallet) | Section | Both | Both | `src/routes/catalog/CatalogCarousel.tsx` | `src/design-os/assets/bannerRegistry.ts` | live | none dedicated | Approved mockup: `docs/mockups/approved/catalog-carousel.html`. |
| Cancellation intercept | (modal from Wallet) | Section | Agency | Both | `src/routes/cancellation-intercept/CancellationIntercept.tsx` | `POST /me/trial/cancel` | live | `cancellation.6-state.test.ts` | Real Whop cancel via backend (see `AccountSection.tsx:99`). 6 states covered. Approved mockup: `docs/mockups/approved/cancellation-intercept.html`. |

---

## 3 · Clip generation

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Generate from URL (browser capture) | `#/create` → Home panel URL tab | Design-OS | Both | Clipper | `src/design-os/routes/CommandRoom.tsx` (panel), `HomeSection.tsx` | Python sidecar via `src/lib/bridgeToBackend.ts` | live | `url-clip-export.spec.ts`, `generate-create.spec.ts` | Uses the legacy `desktop/` Python sidecar (Whisper + Anthropic + ffmpeg). Sidecar handshake is IG-002 in FROZEN shell. |
| Generate from upload (mp4/mov) | `#/import` → Home panel Upload tab | Design-OS | Both | Both | `src/routes/upload/portalUrlContract.ts` + Home panel | Python sidecar | live | `upload.journey.test.ts`, `file-drop-export.spec.ts` | `GlobalDropConsumer` catches drops on any route (`src/lib/globalDropConsumer.tsx`). |
| Whisper transcription | (sidecar-side) | Shell/util | Both | Both | `src/design-os/engine/sidecar-stub.ts` (dev stub) | Python sidecar Whisper | live | covered indirectly by URL/upload specs | Real sidecar in the legacy `desktop/` repo; env-gated Modal/Replicate GPU is planned (see `[[junior-hosted-compute]]` memory). |
| Anthropic clip judgment | (sidecar-side) | Shell/util | Both | Both | none client-side | Python sidecar `proxy_llm` | live | covered indirectly by URL/upload specs | LLM-titled clips are the "done" signal per memory `feedback_clipping_engine_done_definition`. |
| ffmpeg cut + package | (sidecar-side) | Shell/util | Both | Both | none client-side | Python sidecar | live | `export-clip.spec.ts` | Output paths land under user Application Support dir. |
| Retrieve past project | `#/retrieve` (aliases to Workstation) | Design-OS | Both | Both | `src/design-os/routes/Workstation.tsx`, `ProjectsSection.tsx` | local project store | live | `home-library-route.spec.ts`, `library-my-clips.spec.ts` | Library was folded into My Clips (UX-4). `#/library` still resolves via alias. |

---

## 4 · Workstation / editor cockpit

The Workstation route (`#/workstation`) is the primary editing surface. A cockpit dock at the bottom exposes five modules; a switcher pill row navigates between them. Every module reads `clipSettingsStore` for per-clip persistence.

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Workstation shell (My Clips grid + dock) | `#/workstation` | Design-OS | Both | Both | `src/design-os/routes/Workstation.tsx`, `src/design-os/engine/cockpit/CockpitDock.tsx` | none (reads local session) | live | `full-clipping-journey.spec.ts`, `my-clips.journey.test.tsx` | UI-1 collapsed: Engine / Studio / Export / Schedule / Library all resolve here via `ALIAS_FOR` in `SimulatorRouter.tsx`. |
| Reaction module (facecam split) | Workstation cockpit `data-module="reaction"` | Design-OS | Both | Clipper | `src/design-os/engine/cockpit/ReactionModule.tsx` | Python sidecar bake | live | `reaction-journey.spec.ts` | 8 layouts; some tier-gated per `docs/PRICING_PLAN.md` (green-screen, podcast-commentary, quote-reaction locked to Pro+ historically — currently tier-gated per `useTierCaps`). |
| Caption module | Workstation cockpit `data-module="caption"` | Design-OS | Both | Both | `src/design-os/engine/cockpit/CaptionModule.tsx` (testid `caption-text`) | none | live | `caption-editing.spec.ts`, `full-clipping-journey.spec.ts` (step 4) | Presets: style + position (cyan-bold, top, etc.). Per-clip persistence proved by full-clipping-journey step 12. |
| Trim module | Workstation cockpit `data-module="trim"` | Design-OS | Both | Both | `src/design-os/engine/cockpit/TrimModule.tsx` | Python sidecar re-cut | live | `trim-clip.spec.ts`, `full-clipping-journey.spec.ts` (step 5) | In/out inputs with mm:ss readouts. |
| Watermark toggle + preview | Workstation cockpit `data-module="publish"` block `[data-testid=watermark-block]` | Design-OS | Free forced ON, Paid choice | Both | `src/design-os/engine/cockpit/PublishModule.tsx` (`WatermarkPreview` derived state) | `useTierCaps().watermarkLocked` | live | `watermark-proof.spec.ts`, `watermark-paywall.spec.ts` | Single source of truth = `deriveWatermarkPromise` (BUG-036). Style tab and Publish tab MUST show identical `data-watermark-effective`. |
| Style module | Workstation cockpit `data-module="style"` | Design-OS | Both | Both | `src/design-os/engine/cockpit/StyleModule.tsx` | none | partial | `style-journey.spec.ts` | Only mono preset actually applies today. `style-preset-coming-soon` + `style-accent-coming-soon` are honest stubs. |
| Publish module (export CTA + assisted-schedule row) | Workstation cockpit `data-module="publish"` | Design-OS | Both | Both | `src/design-os/engine/cockpit/PublishModule.tsx` | Python sidecar export | live | `full-clipping-journey.spec.ts` (steps 9-11), `export-clip.spec.ts` | `publish-now` button flips `data-export-state`. `publish-schedule-hour` opens Schedule module. |
| Schedule module (assisted reminder) | Workstation cockpit `data-module="schedule"` | Design-OS | Both | Both | `src/design-os/engine/cockpit/ScheduleModule.tsx`, `scheduleStatus.ts` | writes `localStorage["lc.assisted-schedule.v1"]` | live | `schedule-honesty.spec.ts`, `schedule-paywall.spec.ts` | Publish tab + Schedule tab both read `deriveSchedulePromise` (BUG-038). |

---

## 5 · Delivery · Scheduling · Posting

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Local mp4 export | `data-testid="export-success"` (dock) | Design-OS | Both | Both | `PublishModule.tsx` + Python sidecar | Python sidecar | live | `export-clip.spec.ts` | Success card exposes `data-export-watermark` + `data-output-path`. |
| Assisted-schedule local record | localStorage + Schedule tab | Design-OS | Both | Both | `src/design-os/schedule/assistedSchedule.ts`, `AssistedScheduleMonitor.tsx` | none | live | `schedule-honesty.spec.ts`, `full-clipping-journey.spec.ts` (step 11) | Storage key `lc.assisted-schedule.v1`. Per memory `liquidclips_publish_walkaround`. |
| Assisted-schedule native OS notification | (Tauri notification plugin) | Shell/util | Both | Both | `AssistedScheduleMonitor.tsx` | `@tauri-apps/plugin-notification` | live | none dedicated | Fires at the reminder time when app is running. |
| Persistent-cookie BrowseOverlay (manual post surface) | overlay on any route | Section (state) | Both | Both | `src/components/browser/BrowseOverlay.tsx`, `src/state/browseOverlay.ts` | Tauri child webview | live | `browse-tab-omnipresent.spec.ts`, `browse-shortcuts.spec.ts` | Always-on side browser. User pastes the exported clip inside their still-signed-in TikTok/IG session. Do NOT replace with OAuth SDK. |
| Ayrshare / OAuth SDK / Profile Key | — | — | — | — | — | — | **not planned** | — | Explicitly rejected. See memory `feedback_ayrshare_mistake`. |
| Real schedule surface (WeekStrip + assisted rows) | `#/schedule` | Design-OS | Both | Both | `src/design-os/routes/Schedule.tsx` (Phase 6J-A) | reads `lc.assisted-schedule.v1` | live | `schedule-honesty.spec.ts` | Registered directly in `SURFACE_FOR` after L3 (2026-07-11) fix — no longer aliased to Workstation. |
| Multi-account targeting (tier-capped) | Schedule module | Design-OS | Free 1 / Agency ∞ | Both | `src/design-os/schedule/ScheduleFromExportDrawer.tsx` | `useTierCaps` | gated | `schedule-paywall.spec.ts` | Cap read from tier caps table. |
| Monthly post cap | Schedule module | Design-OS | Free 25 / Agency 2500 | Both | `ScheduleFromExportDrawer.tsx` (lines 108-313 per `PRICING_PLAN.md`) | `useTierCaps` | gated | `schedule-paywall.spec.ts` | Copy: "Monthly post cap reached · Upgrade to AGENCY". |

---

## 6 · Whop submission · Campaigns · Sponsored

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Submit-to-Whop modal (`SubmitToWhopModule` in spec) | Publish-module trigger + `#/submissions` | Design-OS | Both | Clipper | `src/design-os/components/SubmitToWhopModal.tsx`, `src/components/publish/SubmitToWhopModal.tsx` | Whop API via `openWhopAction` + `junior-backend /whop/*` proxy | live | `publish-reward-mint.spec.ts` | Spec references "SubmitToWhopModule" — the on-disk name is `SubmitToWhopModal` (two copies: Design-OS + legacy). |
| Campaigns discovery (read-only clipper) | `#/campaigns` | Section (`SECTION_CAMPAIGNS`) + Design-OS wrapper | Both | Clipper | `src/sections/campaigns/CampaignsSection.tsx`, `src/design-os/routes/Campaigns.tsx` | `junior-backend` campaigns + Whop proxy | live | `campaigns-station.spec.ts` | Seeded with 3 Uncle Daniel funnel rows + 7 legacy = 10 campaigns (per repo-root `CLAUDE.md` v0.7.55 note). |
| Campaign submission review (Agency-write) | `#/submissions` | Design-OS | Agency | Agency | `src/design-os/routes/SubmissionsReview.tsx` | `junior-backend /submissions/*` | live | `agency-launch-readiness.spec.ts` | Trusted-source gate: `canUseAgencyActions({tier,source})`. |
| Agency campaign builder | `#/campaign-builder` | Design-OS | Agency | Agency | `src/design-os/routes/AgencyCampaigns.tsx`, `src/routes/campaign-builder/EmbedPreviewCard.tsx` | `junior-backend /campaigns` write | live | `agency-campaign-syndicate.spec.ts`, `gate4-campaign-draft.spec.ts` | Distinct chunk from CampaignsRoute so clippers don't ship the builder code. |
| Uncle Daniel campaigns (seeded funnel) | `#/campaigns` | Section | Both | Clipper | `src/fixtures/fakeCampaigns.ts` + backend seed | `junior-backend scripts/seed_uncle_daniel_campaigns.py` | live | `campaigns-station.spec.ts` | 3 rows auto-seeded on Railway lifespan startup. Upserts by slug. |
| Sponsored Rewards module | mounted above WalletDetail on `#/earn` | Design-OS | Free (convert carrot) | Clipper | `src/design-os/earn/SponsoredRewardModule.tsx`, `SponsoredRewardCard.tsx`, `SponsoredRewardStrip.tsx` | banner registry (`src/design-os/assets/bannerRegistry.ts`) | live | `earn-station.spec.ts` (peripheral) | D1 Cluster F (2026-07-12) re-mounts this above the ledger. Own Watchdog boundary. |
| Sponsored Reward mint list | mounted below WalletDetail | Design-OS | Both | Clipper | `src/design-os/earn/WalletRewardClipsSection.tsx` | reward-clip mint API | live | `publish-reward-mint.spec.ts` | D1-cluster-Z (2026-07-12). |
| Campaign banner assets | (various) | Design-OS | Both | Both | `src/design-os/campaigns/CampaignBanner.tsx`, `bannerRegistry.ts` | none | live | none dedicated | Brand-asset rule: must come from `/public/brand/` (memory `feedback_use_brand_assets`). |

---

## 7 · Wallet · Earn · Referral

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Wallet detail (canonical money surface) | `#/earn` → WalletDetail + `#/account` | Section | Both | Clipper | `src/routes/wallet-detail/WalletDetail.tsx`, `src/sections/account/AccountSection.tsx` | `/me/wallet/summary`, `useWalletLedger()` (`src/lib/wallet.ts`) | live | `money-rollup.test.ts`, `wallet-malformed-response.spec.ts`, `referral.journey.test.ts` | **The only Section-pipeline surface wrapped in `SectionWithFallback`** (falls back to legacy Design-OS `EarnRoute`). 6 puppeteer states: `fresh_install`, `populated`, `paid_normal`, `paid_streak`, `grace`, `cancelled`. |
| Legacy Design-OS Earn | (unreachable) | Design-OS | Both | Clipper | `src/design-os/routes/Earn.tsx` | `/me/wallet/summary` | deprecated | none | Kept on disk as WalletDetail fallback only. Do not ship new UI here. `#/earn` nav resolves to WalletDetail (see `SimulatorRouter.tsx:145`). |
| Withdraw CTA | WalletDetail | Section | Both | Clipper | `WalletDetail.tsx` uses `useMoneyRollup().withdraw_gates` | Whop payouts via `openWhopAction(WITHDRAW,…)` | live | `referral.journey.test.ts`, `money-rollup.test.ts` | INV-004: disabled unless every gate in `rollup.withdraw_gates` is true. |
| Money rollup (canonical monetary hook) | (used by WalletDetail) | Shell/util | Both | Both | `src/lib/moneyRollup.ts` | `/me/money/rollup` | live | `money-rollup.test.ts`, `money-fixture-scan.test.ts` | Every visible money value MUST read from this hook. Regression proof via `moneyRollup` test. |
| Referral pipeline tile | inside WalletDetail | Section | Both | Both | `src/design-os/earn/ReferralPipelineTile.tsx` | `/me/crew/pipeline` | live | `referral.journey.test.ts` | Live pipeline count. |
| Crew match tool | inside WalletDetail | Section | Both | Both | `src/design-os/earn/CrewMatchTool.tsx` | `/me/crew/match` | live | `referral.journey.test.ts` | Paste-list check flow. |
| Affiliate link + QR share | inside WalletDetail | Section (mounted) | Both | Both | `src/design-os/earn/AffiliateWidget.tsx` | `/me/affiliate` (referral_url) | live | `earn-affiliate-polish.spec.ts` | Uses `qrcode.react` for QR. Copy-URL + copy-QR + download-QR actions. |
| Cancel subscription trigger | corner-pinned in AccountSection | Section | Agency | Both | `AccountSection.tsx:CANCEL_TRIGGER_STYLE` + `CancellationIntercept.tsx` | `POST /me/trial/cancel` | live | `cancellation.6-state.test.ts` | Wrapped in `Watchdog` id `agency/ag-13/cancel-subscription`. 4 backend states surface distinct copy. |
| Connect Whop CTA (activate payouts) | inside WalletDetail | Section | Free (no whopUserId) | Both | `WalletDetail.tsx` calls `connectWhop()` (`src/lib/whopConnect.ts`) | Whop OAuth via `junior-backend` | live | none dedicated | Emits `connect_whop_completed` / `connect_whop_failed`. |

---

## 8 · Community · Channels · Content

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Community chat home (9 seeded rooms · BC-013) | `#/community` | Design-OS | Both | Both | `src/design-os/community/CommunityChatHome.tsx` (line 111, 140) | `/community/channels` + `junior-backend scripts/seed_community_channels.py` | live | `community-chat-home.spec.ts` | BC-013 locked layout: pending rooms in sidebar. 9 default rooms auto-seeded. |
| Featured discussion | inside Community | Design-OS | Both | Both | `FeaturedDiscussion.tsx` | `/community/featured` | live | covered in `community-chat-home.spec.ts` | — |
| Leaderboard section | inside Community | Design-OS | Both | Both | `LeaderboardSection.tsx` | `/community/leaderboard` | live | covered in `community-chat-home.spec.ts` | — |
| Room grid + detail drawer | inside Community | Design-OS | Both | Both | `RoomGrid.tsx`, `RoomCard.tsx`, `RoomDetailDrawer.tsx` | `/community/rooms` | live | covered in `community-chat-home.spec.ts` | — |
| Announcements rail | inside Community + Home | Design-OS | Both | Both | `AnnouncementsRail.tsx`, `AnnouncementBanner.tsx` | `/announcements` | live | none dedicated | — |
| Achievements toast | Community + earn events | Design-OS | Both | Both | `AchievementToast.tsx`, `achievements.ts` | client-side derivation | mocked | none dedicated | Client-side derivation; no backend achievements API yet. **unclear · verify with Daniel** whether this is scope-defined for RC1. |
| Channels (connected posting accounts) | `#/channels` | Design-OS | Free 2 / Agency 15 | Both | `src/design-os/routes/Channels.tsx` | `/channels` | gated | `channels-station.spec.ts` | Read-only cap display today; add-channel UI not yet wired per `docs/PRICING_PLAN.md:99`. |
| Platform icons + accountpack | Channels | Design-OS | Both | Both | `src/design-os/channels/PlanLimitStrip.tsx` | `useTierCaps` | live | `platform-icons-and-accountpack-proof.spec.ts` | — |

---

## 9 · Home · TopHud · Kade

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Home cockpit (4 tiles: Create / Import / Retrieve / Open Engine) | `#/home` | Design-OS | Both | Both | `src/design-os/routes/CommandRoom.tsx`, `src/sections/home/HomeSection.tsx` | none | live | `home-dashboard.spec.ts`, `home-library-route.spec.ts` | UI-1 collapsed pattern. Section registry sends `#/home` → `HomeSection` → SimulatorRouter falls through to CommandRoom. |
| TopHud identity + version pill + streak | fixed top strip | Design-OS | Both | Both | `src/design-os/components/TopHud.tsx` | `useMe`, `useAuth`, `__APP_VERSION__` | live | `TopHud.identity.test.ts`, `TopHud.version.test.ts`, `TopHud.pill.test.ts`, `TopHud.whop-chip.test.ts`, `TopHud.canonical-identity.test.ts` | Canonical identity ladder. Streak pill hides when `streakDays` is undefined (2.2.24 dummy-data purge). |
| App mode radiogroup (Clipper / Agency) | inside TopHud | Design-OS | Both | Both | `TopHud.tsx:653-681`, `src/design-os/bridge/useMode.ts` | localStorage `lc.mode` | live | `splash-and-agency-palette.spec.ts` | Writes `body[data-app-mode]` so CSS accent tokens swap. UI affordance only — no backend persistence. |
| WhopStatusChip (persistent Whop connection state) | inside TopHud | Design-OS | Both | Both | `WhopStatusChip` referenced from `TopHud.tsx:703` | `useMe().snapshot.whopUserId` + `useAuth().hasJwt` | live | `WhopStatusChip.test.ts` | Renders nothing for anonymous users. |
| Trial status pill | inside TopHud | Design-OS | Free (trial) | Both | `src/design-os/components/TrialStatusPill.tsx` | `/me` `paid_until` | live | none dedicated | Hides for paid + non-trial states. |
| Kade ergonomic assistant (sticky) | fixed corner | Design-OS | Both | Both | `src/design-os/components/StickyKade.tsx`, `KadeController.tsx`, `KadeIgnition.tsx`, `KadeSpeechBubble.tsx` | `useEvent("kade:*")` | live | none dedicated | Poses/scripts per route. WalletDetail computes its own kade pose via `stageDataState` — do not import shared Kade anchor there. |
| Kade repair screen (Watchdog fallback) | full-screen overlay on crash | Design-OS | Both | Both | `src/lib/watchdog/*` | HQ intercession event | live | `console-error-transport-probe.spec.ts` | Every user-reachable Watchdog boundary renders KadeRepairScreen on error. |
| Search pill in TopHud | inside TopHud | Design-OS | Both | Both | `TopHud.tsx:641-650` | none | partial | none | Disabled + readonly with placeholder "Search · lands in the next release". Honest coming-soon. |

---

## 10 · BrowseOverlay · In-app browser

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| BrowseOverlay (persistent-cookie Tauri child webview) | overlay on any route | Section (state) | Both | Both | `src/components/browser/BrowseOverlay.tsx`, `src/state/browseOverlay.ts` | Tauri webview + native persistent cookies | live | `browse-shortcuts.spec.ts`, `browse-tab-omnipresent.spec.ts` | Always-on side browser. The manual-post surface: user pastes exported clip inside their signed-in social session. Esc closes. |
| Browse launcher (source picker) | `#/browse` | Section | Both | Both | `src/sections/browse/BrowseSection.tsx` | none | live | `browse-tab-omnipresent.spec.ts` | Watchdog id `pipeline/cp-15/browse-in-app`. |
| In-app browser standalone route | `#/in-app-browser` | Section | Both | Both | `src/routes/in-app-browser/InAppBrowser.tsx` | Tauri webview | live | none dedicated | Approved mockup: `docs/mockups/approved/in-app-browser.html`. |
| Whop-rewards deep-link | (from Home / Wallet / Campaigns) | Shell/util | Both | Clipper | `src/state/browseOverlay.ts:WHOP_REWARDS_URL` | Whop discover page | live | none dedicated | Default target for Whop bounty browse. |

---

## 11 · Runtime updates (state machine + gates)

Read `src/lib/updateJourney.ts` (j015-runtime-update state machine) — 7 states: `checking`, `downloading`, `staged`, `gate`, `restarting`, `restored`, `failed`. Ships FROZEN-shell-compatible: zero Rust, uses `@tauri-apps/plugin-process::relaunch`.

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Runtime update state machine | (background) | Shell/util | Both | Both | `src/lib/updateJourney.ts`, `updateJourney.state-machine.test.ts` | `/runtime/manifest.json` | live | `updateJourney.state-machine.test.ts` (unit) | j015 canonical state machine. |
| UpdateBeacon (persistent bottom-right pill) | overlay | Shell/util | Both | Both | `src/components/UpdateBeacon.tsx` | update state | live | none dedicated | AU-C-1 (2026-07-10). |
| UpdateReadyIndicator (staged non-critical) | overlay | Design-OS | Both | Both | `src/design-os/update/UpdateReadyIndicator.tsx` | update state | live | `UpdateReadyIndicator.test.tsx` | — |
| RestartGate (mandatory blocking modal) | overlay | Design-OS | Both | Both | `src/design-os/update/RestartGate.tsx` | update state | live | `RestartGate.test.tsx` | Copy: "Restart to continue" / "Restart now". **Never use the R-word "reload" — that was the BUG-012 failure phrasing.** |
| HardUpdateGate (mandatory / security) | full-viewport overlay | Shell/util | Both | Both | `src/components/update/HardUpdateGate.tsx` | update criticality | live | none dedicated | Full-viewport blocker. |
| BootRestore + protectedJourney | (background) | Shell/util | Both | Both | `src/lib/bootRestore.ts`, `src/lib/protectedJourney.ts` | in-flight journey ids | live | `bootRestore.test.ts`, `protectedJourney.test.tsx` | Protects j011-payout / wallet-claim mid-signature from a restart. |
| Native tauri-plugin-updater (shell shell) | (background) | Shell/util (native) | Both | Both | Tauri plugin | `updates.liquidclips.app/latest.json` | live | none | Rare, signed DMG/tar.gz. Coexists with runtime bundle updater. **FROZEN — don't touch.** |

Related open bugs (per `updateJourney.ts:16-20`):
- **BUG-012 open** — native cache-switch bug. Journey always gates activation behind quit + relaunch as workaround.

---

## 12 · Settings · Account · Diagnostics · HQ Bridge

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Settings route (unified) | `#/settings` | Design-OS | Both | Both | `src/design-os/routes/Settings.tsx` | `useMe`, `useTierCaps`, channels | live | `settings-cockpit.spec.ts`, `settings-avatar.spec.ts` | Common tabs + mode-specific tabs (`CLIPPER_SETTINGS_TABS` / `AGENCY_SETTINGS_TABS` at Settings.tsx:126-130). Cockpit copy swaps at line 643. |
| Support tab (via `#/support`) | Settings tab | Design-OS | Both | Both | inside `SettingsRoute` | none | live | `remaining-surfaces.spec.ts` | L2 (2026-07-11): `#/support` primary surface with post-mount `settings:open-tab` emit (SimulatorRouter.tsx:244). |
| Login deep-link (`#/login`) | Settings tab | Design-OS | Both | Both | inside `SettingsRoute` | none | live | none dedicated | 2.2.24: LoginOnboardingRoute deleted; `#/login` resolves to Settings + sign-in CTA in TopHud. |
| Account section (Wallet wrapper) | `#/account` | Section | Both | Both | `src/sections/account/AccountSection.tsx` | see §7 | live | `AccountSection.test.ts`, `AccountSection.mount5.test.ts` | Cross-section selectors only. See `CONTRACT_ACCOUNT_SELECTORS.md`. |
| Diagnostics section | `#/diagnostics` (also Settings sub-tab) | Section | Both | Both | `src/sections/diagnostics/DiagnosticsSection.tsx` | `lcDiag` buffer | live | none dedicated | Flow trace + health summary. |
| HQ Bridge (deep-link landing) | `#/hq` | Section | Both | Both | `src/sections/hq/HQBridgeSection.tsx` | HQ verbs | live | none dedicated | Deep-link landing for `liquidclips://` verbs into HQ admin (account-app). |
| Analytics (Agency roll-ups) | `#/analytics` | Design-OS | Agency | Agency | `src/design-os/routes/Analytics.tsx` | `/analytics/*` | gated / partial | none dedicated | Preview rendered for all tiers; real numbers Agency-only. Stub `analytics-stub` `data-state="coming-soon"` — Batch D wires real data. |
| Thumbnail Studio | `#/thumbnail` | Design-OS | Both | Both | `src/design-os/routes/ThumbnailStudio.tsx`, `src/design-os/thumbnail/*` | Python sidecar image | live | `thumbnail-identity.spec.ts` | Mode toggle (`ThumbnailModeToggle.tsx`), brand preset panel. |
| ClaimScreen (post-checkout LC-ID paste recovery) | (overlay) | Design-OS | Free → Agency | Both | `src/design-os/routes/ClaimScreen.tsx` | `junior-backend /desktop/claim` | live | `login-lc-id-email.spec.ts` | Ship-lens P0-001 (2026-07-06): `/desktop/connect-from-checkout` is server-secret-gated, so users paste the LC-ID from email. |
| StopPages (dead-end handler) | `#/stop-pages` | Design-OS | Both | Both | `src/design-os/routes/StopPages.tsx` | none | live | none | Rendered when a route intentionally sends the user to a stop. |

---

## 13 · Agency preview · paywall · upsell surfaces

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Agency Preview Banner | fixed top of Design-OS routes | Design-OS | Free (Agency mode) | Agency preview | `src/components/paywall/AgencyPreviewBanner.tsx` (mounted in `src/design-os/components/AppShell.tsx:241`) | `useBillingState`, `useMode` | live | `agency-upgrade-cta-verify.spec.ts`, `agency-launch-readiness.spec.ts` | Renders nothing in clipper mode; shows upgrade wall for Free clippers who flip to Agency. |
| Paywall gate (generic) | (wrapper) | Shell/util | Free | Both | `src/components/paywall/PaywallGate.tsx` | `useBillingState().startCheckout` | live | `ransom-paywall-flow.spec.ts` | `paywall-upgrade-cta` testid. Opens upgrade flow + posts `billing.upgrade_required` inbox. |
| Asset Ransom Paywall | overlay when Free hits clip 11+ | Shell/util | Free | Both | `src/components/paywall/AssetRansomPaywall.tsx` | `useTierCaps` | live | `ransom-paywall-flow.spec.ts` | Testable via `AssetRansomPaywallTestHook` (dev-only per `App.tsx:20`). |
| Agency Welcome overlay | (post-toggle to Agency) | Shell/util | Free (Agency mode) | Agency preview | `src/overlays/AgencyWelcome.tsx` | none | live | `splash-and-agency-palette.spec.ts` | First-time Agency-toggle welcome. |
| Founder Access activation | (overlay) | Shell/util | Free → Agency | Both | `src/components/gate/ActivateFounderPanel.tsx` | Whop `plan_NMKvKj8SVVKsY` | live | none dedicated | The $99.99 Agency plan is labelled "Founder Access v2" on Whop (see `MAX_HANDOFF_RANSOM_PAYWALL_2026-07-06.md:17`). Copy still says Agency in-app. |
| PlanLimitStrip | inside Channels | Design-OS | Free | Both | `src/design-os/channels/PlanLimitStrip.tsx` | `useTierCaps` | live | `channels-station.spec.ts` | Reads channel-slot cap; hides for Agency. |

---

## 14 · Inbox · Announcements · Notifications

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Inbox sheet | slide-in from side | Shell/util | Both | Both | `src/shell/InboxSheet.tsx` | `/inbox/*` | live | `inbox-notifications.spec.ts` | Kept behind news chip; NEWS chip in TopHud hides when count = 0 (Phase 6E-NewsChip-Hide). |
| Announcement banner | inside AppShell | Design-OS | Both | Both | `src/design-os/components/AnnouncementBanner.tsx` | `/announcements` | live | none dedicated | — |
| HomeBanner | inside Home | Design-OS | Both | Both | `src/design-os/components/HomeBanner.tsx` | banner registry | live | none | — |

---

## 15 · Cross-cutting infra

| Feature | Route / surface | Pipeline | Tier | Ownership | Frontend component | Backend / API | Status | Automated coverage | Known limits / rules |
|---|---|---|---|---|---|---|---|---|---|
| Watchdog + EngineErrorBoundary | wraps every user-reachable route | Shell/util | Both | Both | `src/lib/watchdog/*`, `src/design-os/components/EngineErrorBoundary.tsx` | HQ intercession events on `lcDiag` | live | `console-error-transport-probe.spec.ts` | Every route + every risky module gets a Watchdog node. `lcDiag` is behavioural only — no `*_rendered` events (per `desktop-2/CLAUDE.md`). |
| Global drop consumer | listens on all routes | Shell/util | Both | Both | `src/lib/globalDropConsumer.tsx` | Python sidecar | live | `file-drop-export.spec.ts` | Catches file drops on any route. |
| Runtime version sync | (boot) | Shell/util | Both | Both | `src/lib/useRuntimeVersion.ts` | `/runtime/manifest.json` | live | `useRuntimeVersion.test.ts` | — |
| Diagnostic logger + persistence | (background) | Shell/util | Both | Both | `src/lib/diagnosticLogger.ts` | HQ `lcDiag` | live | `diagnosticLogger.persistence.test.ts` | Behavioural-only event stream. |
| Feature flags | (read-only) | Shell/util | Both | Both | `src/lib/useFeature.ts` | `/features` | live | none dedicated | — |
| Tier caps table | (read-only) | Shell/util | Both | Both | `src/design-os/state/useTierCaps.ts` | `/me` `effective_tier` | live | `tier-enforcement-backend.spec.ts` | Canonical `TIER_CAPS`. `mapBackendTier()` switch still supports `growth` + `pro` for backwards compat. |
| Money rollup (canonical monetary hook) | (read-only) | Shell/util | Both | Both | `src/lib/moneyRollup.ts` | `/me/money/rollup` | live | `money-rollup.test.ts`, `money-fixture-scan.test.ts` | Single source of truth for every visible money value. |

---

## 16 · Related surfaces (outside this repo)

| Surface | URL / path | Repo | Status | Notes |
|---|---|---|---|---|
| Account app | `account.liquidclips.app` | `account-app/` (Next.js 16, Vercel) | live | Whop-backed checkout UI + admin HQ + journey map + state puppeteer. Manual `vercel deploy --prod`. |
| Marketing | `liquidclips.app` | `liquidclips-marketing/` (Next.js, Vercel) | live | Manual `vercel deploy --prod`. |
| Backend | `api.liquidclips.app` | `junior-backend/` (FastAPI on Railway) | live | Manual `railway up --service junior-backend --detach`. GitHub source disconnected intentionally. Seeds auto-run on lifespan startup. |
| Legacy desktop (v0.7.x) | `desktop/` | Tauri + Python sidecar | deprecated | Source-of-truth is `desktop-2/`. Many primitives still ported from here into `desktop-2/src/lib/*`. Do not build/ship from here. |

---

## Dropbox references

Standard Dropbox root: `Dropbox: /Liquid Clips/RC1 Handover/`

- Founder walkthrough videos for each major surface → TODO: Daniel · generate Dropbox share link for RC1 founder-walkthrough playlist.
- Full-clipping-journey screenshot bundle (Playwright output) → TODO: Daniel · generate Dropbox share link for `desktop-2/tests/e2e/screenshots/`.
- Brand kit + prod screenshots → TODO: Daniel · generate Dropbox share link for `Dropbox: /Liquid Clips/RC1 Handover/brand/`.
- HQ Admin dashboard reference captures → TODO: Daniel · generate Dropbox share link for HQ Admin screenshot set.

Small illustrative screenshots ≤500KB may stay in git (see `desktop-2/screenshots/`).

---

## Features I flagged as `unclear · verify with Daniel`

1. **Cold-entry route family** (`src/routes/cold-entry/**`) — spec references this path, but `find` returns no matches at HEAD. The nearest on-disk surfaces are `login-activation.html` (approved mockup) and `WelcomeRoute.tsx`. Confirm whether the cold-entry directory has been renamed, deferred, or lives elsewhere.
2. **Achievements toast backend** — `AchievementToast.tsx` derives from client state; unclear whether a backend achievements API is scope-defined for RC1.
3. **Style module non-mono presets** — only mono preset applies. Marked `partial`. Confirm whether landing mono-only is the RC1 target or a bug.

---

## Verification checklist

Files inspected while writing this doc:

- `/Users/dipdip/code/jnr/desktop-2/CLAUDE.md`
- `/Users/dipdip/code/jnr/desktop-2/package.json`
- `/Users/dipdip/code/jnr/desktop-2/src/App.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/shell/sectionRegistry.ts`
- `/Users/dipdip/code/jnr/desktop-2/src/shell/routes.ts`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routing/SimulatorRouter.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/TopHud.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/components/AppShell.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/bridge/useMode.ts`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routes/WelcomeRoute.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routes/Settings.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/routes/Analytics.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/community/CommunityChatHome.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/engine/cockpit/` (directory listing + PublishModule.tsx)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/earn/` (directory listing)
- `/Users/dipdip/code/jnr/desktop-2/src/design-os/update/` (directory listing)
- `/Users/dipdip/code/jnr/desktop-2/src/sections/account/AccountSection.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/sections/browse/BrowseSection.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/routes/wallet-detail/WalletDetail.tsx`
- `/Users/dipdip/code/jnr/desktop-2/src/routes/` (subdirectory listing)
- `/Users/dipdip/code/jnr/desktop-2/src/sections/` (subdirectory listing)
- `/Users/dipdip/code/jnr/desktop-2/src/lib/billing/adapter.ts`
- `/Users/dipdip/code/jnr/desktop-2/src/lib/openWhopAction.ts`
- `/Users/dipdip/code/jnr/desktop-2/src/lib/updateJourney.ts`
- `/Users/dipdip/code/jnr/desktop-2/tests/e2e/` (full spec directory)
- `/Users/dipdip/code/jnr/desktop-2/tests/e2e/full-clipping-journey.spec.ts`
- `/Users/dipdip/code/jnr/desktop-2/docs/mockups/approved/` (directory listing)
- `/Users/dipdip/code/jnr/desktop-2/docs/PRICING_PLAN.md`
- `/Users/dipdip/code/jnr/desktop-2/docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md`
- `/Users/dipdip/code/jnr/desktop-2/docs/DEV_TEAM_HANDOVER.md`
- `/Users/dipdip/code/jnr/MAX_HANDOFF_RANSOM_PAYWALL_2026-07-06.md`
- `/Users/dipdip/code/jnr/CLAUDE.md`
