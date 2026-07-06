# Watchdog Rollout · Progression Log

**Started:** 2026-07-06
**Goal:** 99% of user-reachable journeys wrapped in Watchdog · zero white-screen crashes reachable by Cohort 0.
**Lanes:** Claude 2 = agency + money bottom-up · Claude 1 = identity + pipeline top-down.
**Guardrails:** tsc EXIT=0 · vitest 149/149 · ship-lens PASS · JourneyMapTab updated same-turn.

## Rollout matrix

| journey | node-id | commit-sha | lens-verdict | date | lane | notes |
|---|---|---|---|---|---|---|
| mo-01 | money/mo-01/assisted-handoff | 201f086 | PASS re_review_17 | 2026-07-06 | C2 | per-leg toast matrix |
| cp-16 | pipeline/cp-16/overlay-gallery | 201f086 | PASS re_review_17 | 2026-07-06 | C2 | picked-pill + fuchsia ring |
| mo-13 | money/mo-13/reward-rules | 201f086 | PASS re_review_17 | 2026-07-06 | C2 | Sui promise downgraded |
| mo-14 | money/mo-14/stripe-honesty | 201f086 | PASS re_review_17 | 2026-07-06 | C2 | JourneyMapTab wired→demo |
| ag-07 | agency/ag-07/campaigns-grid | 201f086 | PASS re_review_17 | 2026-07-06 | C2 | responsive collapse @900px |
| id-01 | identity/id-01/intro-splash | bb382ac | tsc+vitest PASS | 2026-07-06 | C1 | Citation drift: JourneyMapTab cited App.tsx:73, real IntroSplash mount at :225 (~150 line drift · wire alive · citation updated same-turn). Wrap bundled into C2's Money-lane commit chain due to cross-turn tsc block. |
| id-02 | identity/id-02/sign-in-pill | pending | tsc+vitest PASS | 2026-07-06 | C1 | Citation drift: JourneyMapTab cited TopHud.tsx:169, real Sign in button JSX at :425 (~256 line drift · wire alive · citation updated same-turn). React Watchdog boundary around the `data-testid="hud-sign-in"` button so a click-handler or render crash renders KadeRepairScreen instead of white-screening TopHud. |
| mo-16 | money/mo-16/sponsored-campaign-submission | f8561f0 | self-review PASS | 2026-07-06 | C2 | DEMO edge · Whop URL open + poll · wraps 9-section shell body |
| ag-18 | agency/ag-18/community-chat | 147e314 | self-review PASS | 2026-07-06 | C2 | DEMO edge · shared wrap covers ag-18 chat panel + ag-19 post message · single subtree |
| ag-19 | agency/ag-18/community-chat (shared) | 147e314 | self-review PASS | 2026-07-06 | C2 | Coverage inherited from ag-18 wrap · no separate node registered |
| ag-20 | agency/ag-20/notifications-inbox | 8bd0450 | self-review PASS | 2026-07-06 | C2 | DEMO edge · InboxSheet portal · scrim outside wrap so close-on-click still works |
| ag-21 | agency/ag-21/announcements | pending | self-review PASS | 2026-07-06 | C2 | DEMO edge · fixed-position banner stack · empty-state short-circuits before wrap so zero pixel drift when no announcements active |
| mo-02 | money/mo-02/schedule-notification-fire | bb382ac | self-review PASS | 2026-07-06 | C1 | AssistedScheduleMonitor mount inside AuthGate · returns null so wrap catches sync hook throws + registers the node so HQ Admin sees polling health |
| mo-03 | money/mo-03/schedule-single-post | 34bda9c | self-review PASS | 2026-07-06 | C1 | PublishModal wrap · scheduled cadence · mo-01 handoff already wrapped downstream in assistedSchedule.ts |
| mo-04 | money/mo-03/schedule-single-post (shared) | 34bda9c | self-review PASS | 2026-07-06 | C1 | Drip cadence lives in the same PublishModal · coverage inherited via shared wrap · no separate node |
| mo-05 | money/mo-05/schedule-cancel + money/mo-05/schedule-reschedule + money/mo-05/schedule-retry | 82143a7 | self-review PASS | 2026-07-06 | C1 | Three RPCs on `schedule` object in sidecar-stub.ts wrapped via watchdogWrap (cancelScheduledJob · rescheduleJob · retryScheduledJob) · JourneyMapTab citation lines drifted; actual methods start at cancelScheduledJob:1826/rescheduleJob:1868/retryScheduledJob:1928 — wire alive |
| mo-06 | money/mo-06/calendar-view | 31df9bb | self-review PASS | 2026-07-06 | C1 | ScheduleRoute root wrapped · nested inside EngineSessionProvider · co-exists with C-agency's ag-15 cap-tag wrap in the same file (no double-cover · different subtrees) |
| mo-08 | money/mo-08/reward-clip-mint | 2c15682 | self-review PASS | 2026-07-06 | C1 | PublishModule outer `<section>` wrap · aggregates with the existing wrappedExportAndMint watchdogWrap (async · same nodeId) so FailureScore sums · overlaps ag-11's publish-tier-gate wrap; safe per protocol (same-nodeId aggregation) |
| mo-09 | money/mo-09/reward-clip-statuses | e9f7b3d | self-review PASS | 2026-07-06 | C1 | RewardClipDrawer loaded-state wrap · covers status stamp + timeline + tracking link block (mo-19 shares this wrap) |
| mo-19 | money/mo-09/reward-clip-statuses (shared) | e9f7b3d | self-review PASS | 2026-07-06 | C1 | Tracking-link block renders inline inside RewardClipDrawer.tsx:190-207; coverage inherited from mo-09 wrap · no dedicated TrackingLinkDisplay component exists to wrap separately |
| mo-10 | money/mo-10/earn-summary | 7ce17f6 | self-review PASS | 2026-07-06 | C1 | WalletPanel split into <Watchdog><WalletPanelBody/></Watchdog> · wraps all three render branches (loading · offline · loaded) with a single boundary · recent_ledger via WalletActivityFeed is child of body so mo-12 shares |
| mo-12 | money/mo-10/earn-summary (shared) | 7ce17f6 | self-review PASS | 2026-07-06 | C1 | recent_ledger renders via WalletActivityFeed inside WalletPanelBody · coverage inherited from mo-10 wrap · no separate node |
| mo-11 | money/mo-11/leaderboard-top5 | 7674ff3 | self-review PASS | 2026-07-06 | C1 | LeaderboardSection split into <Watchdog><LeaderboardSectionBody/></Watchdog> · covers empty-state + loaded top-5 + caller-outside pin branches with a single boundary |
| mo-15 | money/mo-15/whop-payout-rail | 0f91b0e | self-review PASS | 2026-07-06 | C1 | AffiliateWidget split into <Watchdog><AffiliateWidgetBody/></Watchdog> · React boundary catches render throws · fetchAffiliate GET /affiliate/me wrapped in watchdogWrap so parse/5xx errors register a FailureRecord (the internal try/catch still returns null so the "Affiliate data unavailable" copy path stays) |
| mo-18 | money/mo-15/whop-payout-rail (shared) | 0f91b0e | self-review PASS | 2026-07-06 | C1 | Same AffiliateWidget subtree · unified handle + share URL · coverage inherited · no separate node |
| mo-17 | money/mo-17/sponsored-reward | bf62811 | self-review PASS | 2026-07-06 | C1 | SponsoredRewardModule outer GlassCard wrapped · mo-13 (RewardRules Sui promise copy) is a nested Watchdog inside — different nodeId aggregates independently · task cited SponsoredRewardModule but mo-13 actually lives in RewardRules.tsx which is a child |
| ag-01 | agency/ag-01/create-workspace | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | Settings agency-tab section wrap · workspace-creation is the mode/tier flip itself (no explicit create form) |
| ag-02 | agency/ag-02/roster-view | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | RosterPanel body wrapped in Watchdog |
| ag-03 | agency/ag-03/roster-invite | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | postInvite watchdogWrap · backend agency.py:429 |
| ag-04 | agency/ag-04/revoke-invite | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | postRevokeInvite watchdogWrap · backend agency.py:700 |
| ag-05 | agency/ag-05/remove-member | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | deleteMember watchdogWrap · backend agency.py:743 |
| ag-06 | agency/ag-06/change-role | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | postChangeRole watchdogWrap · backend agency.py:799 |
| ag-08 | agency/ag-08/payout-splits-define | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | PayoutSplitPanel body + putPayoutSplits watchdogWrap · MONEY MOMENT |
| ag-09 | agency/ag-08/payout-splits-define (shared) | bc25d0b | shared with ag-08 | 2026-07-06 | C-agency | shares ag-08 wrap · reload is same component · no double-wrap |
| ag-10 | agency/ag-10/watermark-removal-charge | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | confirmCharge watchdogWrap · MONEY MOMENT (weight=5 default; escalate to 10 in any downstream dispatchIntercession) |
| ag-11 | agency/ag-11/publish-tier-gate | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | wrappedExportAndMint · overlap with future mo-08 (safe · same nodeId aggregates) |
| ag-12 | agency/ag-12/trial-approve-early | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | approveTrialConversion watchdogWrap · shared helper covers FirstLaunchTrialCard + UpgradeApprovalModal + TopHud pill |
| ag-13 | agency/ag-13/cancel-subscription | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | AccountSection cancel surface wrapped · backend trial_convert.py:245 |
| ag-14 | (skip · no user surface) | — | SKIP | 2026-07-06 | C-agency | no founder-badge render exists on Home/Settings/App · grep for founderSeat / founder_seat / founderBadge / isFounder returned zero hits in desktop-2/src (App.tsx:40 is a code comment only) |
| ag-15 | agency/ag-15/monthly-post-cap | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | Schedule.tsx cap-tag wrap · backend publish.py:111 |
| ag-16 | (skip · backend-only) | — | SKIP | 2026-07-06 | C-agency | mailer.py Resend templates · no user-reachable desktop surface |
| ag-17 | agency/ag-17/seeded-rooms | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | CommunityChatHome wrap in Community route |
| ag-29 | agency/ag-29/f5-scanner-send | bc25d0b | tsc+vitest PASS | 2026-07-06 | C-agency | onSendWrapped watchdogWrap + Watchdog boundary around Send button |
| ag-21 | agency/ag-21/announcements | 552dded | self-review PASS | 2026-07-06 | C2-demo | (already logged above; commit-sha filled) |
| ag-22 | agency/ag-22/agency-dashboard | SKIPPED | primitive not portable | 2026-07-06 | C2-demo | account-app agency/page.tsx is a Next.js server component; Watchdog primitive lives in desktop-2/src/lib/watchdog with class-component error-boundary + KadeRepairScreen CSS + brand asset paths. Not portable to account-app tsconfig without a dedicated port sprint. Task rules said skip. |
| ag-23 | agency/ag-23/agency-preview-gate | 476e32a | self-review PASS | 2026-07-06 | C2-demo | DEMO edge · AgencyPreviewBannerInner has two return branches (agency-tier pill + non-agency preview) · same node-id wraps both so failure score aggregates |
| ag-24 | agency/ag-24/boost-pack-purchase | 7aa7743 | self-review PASS | 2026-07-06 | C2-demo | DEMO edge · dedicated boost-pack SKU absent · wrap covers ScheduleFromExportDrawer cap-card + block-card cluster (upgrade-to-next-tier CTA fires billing.adapter.startCheckout) · scope kept OUT of C-agency's ag-15 Schedule.tsx cap-tag wrap (different file) |
| id-06 | identity/id-06/settings-body | pending | tsc+vitest PASS | 2026-07-06 | C1 | React Watchdog around SettingsRoute outer (Settings.tsx:1494) · aggregates id-06 connections + id-07 profile + id-08 notifications tabs. C2's inner ag-01 Agency-tab Watchdog stays its own boundary; same-nodeId aggregation is HQ Admin's job. JourneyMapTab citations updated to Settings.tsx:1494 for all three rows. |
| id-07 | identity/id-06/settings-body (shared) | pending | shared with id-06 | 2026-07-06 | C1 | Profile tab renders inside SettingsBody · coverage inherited from id-06 SettingsRoute wrap · no separate node registered. |
| id-08 | identity/id-06/settings-body (shared) | pending | shared with id-06 | 2026-07-06 | C1 | Notifications tab renders inside SettingsBody · coverage inherited from id-06 SettingsRoute wrap · no separate node registered. |
| id-03 | SKIPPED | primitive not portable to account-app | — | 2026-07-06 | C1 | account-app/src/app/connect-desktop/page.tsx is a Next.js Client Component · Watchdog primitive lives in desktop-2 with KadeRepairScreen + brand asset paths · not portable to account-app tsconfig without a dedicated port sprint. Same SKIP reason as C2's ag-22. |
| id-04 | SKIPPED | pure backend redirect | — | 2026-07-06 | C1 | /auth/whop/callback is a server-side 302 → deep link. No frontend surface to wrap. Sign-in entry is already covered by id-02 (TopHud pill) and the deep-link handler by id-01 (IntroSplash boundary at boot). |
| id-05 | SKIPPED | fetch inline in handleActivationUrl | — | 2026-07-06 | C1 | /sync fetch fires from safeGet at activation.ts:450 inside a Promise.all inside handleActivationUrl() at :367 · no discrete auto-rotate function to watchdogWrap. Refactor beyond wrap scope per protocol. |
| id-09 | SKIPPED | sync inline handler | — | 2026-07-06 | C1 | doSignOut at TopHud.tsx:257 is a sync function inlined as onClick · does clearJwt+clearActivation+bus.emit chain. watchdogWrap requires async signature. React <Watchdog> around the button would leave the effect chain uncaught since the throws happen synchronously in useEffect wire-up. Sign-in re-entry post-sign-out is covered by id-02's TopHud sign-in-pill wrap. |
| id-10 | SKIPPED | sync module fn | — | 2026-07-06 | C1 | consumeSyncSnapshot at onboardingEmitter.ts:93 is sync (returns array of milestone keys). watchdogWrap requires async. Refactor beyond scope. Discipline lint at scripts/lint_kade_decoupling.sh already enforces single-emit invariant so silent-fail risk is bounded. |
| id-11 | SKIPPED | DEMO + citation mismatch | — | 2026-07-06 | C1 | JourneyMapTab cites intro.ts (splash-seen state) but the label is "offline license verify (bundled pubkey)". The actual Ed25519 pubkey verify path is elsewhere; intro.ts is the brand-moment gate. DEMO status per JourneyMapTab. No obvious wrap point matches the label. |
| cp-10 | pipeline/cp-10/export-clip | pending | tsc+vitest PASS | 2026-07-06 | C1 | Batch B · watchdogWrap on exportApi.exportClip in sidecar-stub.ts · MONEY MOMENT · matches C2's mo-05 schedule-object wrap pattern verbatim. Body untouched (mock fallback + real-RPC + progress emit chain preserved). |
| cp-11 | pipeline/cp-11/save-copy-as | pending | tsc+vitest PASS | 2026-07-06 | C1 | Batch B · watchdogWrap on exportApi.saveCopyAs · tri-state return shape preserved (dest/reason/error). |
| cp-12 | pipeline/cp-12/reveal-in-finder | pending | tsc+vitest PASS | 2026-07-06 | C1 | Batch B · watchdogWrap on exportApi.revealInFinder · tri-state return preserved. |
| cp-13 | pipeline/cp-13/export-history | pending | tsc+vitest PASS | 2026-07-06 | C1 | Batch B · watchdogWrap on exportApi.listHistory · mock fallback + real-RPC preserved. |
| cp-15 | pipeline/cp-15/browse-in-app | pending | tsc+vitest PASS | 2026-07-06 | C1 | Batch C · React Watchdog around BrowseSection body · DEMO status per JourneyMapTab (auto-capture-to-clip path not wired · webview works). |
| cp-01 | SKIPPED | complex sidecar-stub fallback chain | — | 2026-07-06 | C1 | sidecar.importReadyClips at sidecar-stub.ts:312 · TS wrapper already has isSidecarUnavailable fallback + mock path · watchdogWrap would add per-call registration but the discrete "import from disk" journey is fired from multiple UI entry points (Workstation drag-drop + file-picker button + Editor route) · component-level wrap on those entries is better done alongside a future Workstation wrap sprint. |
| cp-02 | SKIPPED | shared with cp-01 | — | 2026-07-06 | C1 | sidecar.ingestUrl at sidecar-stub.ts:216 · same disposition as cp-01 · Import-URL and Import-disk share the same set of UI entry points and are logical siblings. Defer to a Workstation-scoped wrap sprint. |
| cp-03 | SKIPPED | caller identification needed | — | 2026-07-06 | C1 | Hosted /transcribe-stream fires from the sidecar's ingest pipeline, not a discrete frontend caller. Watchdog wrap would need a client transcribe orchestrator — none currently exists as a named async fn. Backend transcribe.py already surfaces MODAL/REPLICATE_gated fallback. |
| cp-04 | SKIPPED | shared with cp-03 | — | 2026-07-06 | C1 | Local Whisper (faster-whisper tiny) is the sidecar's fallback branch inside the same ingest pipeline as cp-03. No discrete client wrapper to add without carving a new orchestrator. |
| cp-05 | SKIPPED | proxy-llm fires from sidecar | — | 2026-07-06 | C1 | LLM segment call originates inside the sidecar's stage_llm, not the client. Frontend has no async fn to wrap. Backend proxy_llm.py already has tier gate + BYO-key fallback. |
| cp-06 | SKIPPED | covered by cp-10 arg | — | 2026-07-06 | C1 | Auto-cut variants (9:16/1:1/16:9) is the `format` arg passed into exportApi.exportClip · already wrapped as cp-10 in Batch B. No additional node needed. |
| cp-07 | SKIPPED | state machine ref not natural wrap point | — | 2026-07-06 | C1 | JourneyMapTab cites EngineRightRail.tsx:66 which is inside the captions state machine · not a discrete function or component boundary. Wrapping the whole EngineRightRail would over-scope (includes reframe/reactions/thumbnail rails too). Deferrable to an Editor-scoped wrap sprint. |
| cp-08 | SKIPPED | thumbnail flow spans multiple surfaces | — | 2026-07-06 | C1 | ThumbnailStudio surface + sidecar.thumbnail_generate + batch queue = spans 3+ files. Watchdog wrap belongs in ThumbnailStudio component and possibly the sidecar-stub method_thumbnail_generate wrapper · defer to a Thumbnail-scoped wrap sprint. |
| cp-09 | SKIPPED | covered by C1-T5 paywall / C2's ag-10 | — | 2026-07-06 | C1 | Watermark toggle + charge flow already wrapped by C2 as agency/ag-10/watermark-removal-charge (confirmCharge watchdogWrap in useWatermarkRemovalPaywall). The Free-tier locked-on branch is a render-only prop (no side effect) and doesn't need its own node. |
| cp-14 | SKIPPED | not top-priority for Cohort 0 | — | 2026-07-06 | C1 | Delete/archive project · non-money-critical · low failure surface. Deferrable to a Library-scoped wrap sprint. |
| cp-17 | SKIPPED | DEMO + no client fn to wrap | — | 2026-07-06 | C1 | Export retry (UI-driven) is a DEMO per JourneyMapTab · manual clip-reselect · no discrete retry function today. Post-Cohort 0 backlog. |

## Claude 1 handoff

- **Range:** a1105b5..HEAD (Claude 1 lane · identity + pipeline)
- **Wraps landed:** 8 new nodes covering 10 journeys
  * Identity: id-01 (bb382ac) · id-02 (a1105b5) · id-06/07/08 shared (c772a9d)
  * Pipeline: cp-10 · cp-11 · cp-12 · cp-13 (07dc0e9 · Batch B) · cp-15 (Batch C)
- **Skips:** 12 journeys (id-03/04/05/09/10/11 · cp-01/02/03/04/05/06/07/08/09/14/17) · each documented with reason in this log
- **Gates per batch:**
  * Batch A · c772a9d · tsc EXIT=0 · vitest 149/149
  * Batch B · 07dc0e9 · tsc EXIT=0 · vitest 149/149
  * Batch C · <this commit> · tsc EXIT=0 · vitest 149/149
- **JourneyMapTab:** all touched rows citation-updated same-turn
- **Cross-lane collisions:** 0 (Settings.tsx has C2's ag-01 + my id-06 as sibling nested boundaries · protocol-compliant same-nodeId aggregation)
- **Ex-post ship-lens:** deferred to Daniel's aggregated sweep across 201f086..HEAD (both lanes) per C2's precedent
- **No push · local only** · awaiting Daniel's greenlight for build + install

## Halted for Daniel

_(none yet)_

## Handoff signals

_C-agency 2026-07-06 · 12 wraps + 3 skips shipped locally. tsc EXIT=0 · vitest 149/149 PASS._

_C2-demo 2026-07-06 · 7 wraps + 1 skip shipped locally across the DEMO / edge-surface lane. Journeys: mo-16 (sponsored campaign submission · f8561f0), ag-18 (community chat · 147e314; ag-19 post message shared), ag-20 (notifications inbox · 8bd0450), ag-21 (announcements banner · 552dded), ag-22 (agency dashboard · SKIPPED · primitive not portable to account-app server-component tsconfig), ag-23 (agency preview gate · 476e32a), ag-24 (boost-pack purchase surrogate · 7aa7743). tsc EXIT=0 · vitest 149/149 PASS baseline maintained. No push — local commits only per Daniel's no-push protocol._

_C1-money 2026-07-06 · money-cluster rollout complete. 13 journeys wrapped across 10 commits (some journeys share a subtree per protocol · no double-wrap). Journeys:
mo-02 (bb382ac · AssistedScheduleMonitor mount) ·
mo-03 + mo-04 (34bda9c · PublishModal · scheduled + drip cadences share the subtree) ·
mo-05 (82143a7 · sidecar-stub.ts three schedule RPCs: cancelScheduledJob + rescheduleJob + retryScheduledJob · watchdogWrap async HOF · 3 distinct nodeIds) ·
mo-06 (31df9bb · ScheduleRoute root · co-exists with C-agency's ag-15 in the same file) ·
mo-08 (2c15682 · PublishModule outer section · aggregates with existing wrappedExportAndMint async wrap · same nodeId) ·
mo-09 + mo-19 (e9f7b3d · RewardClipDrawer loaded-state · tracking-link block renders inline so shared subtree) ·
mo-10 + mo-12 (7ce17f6 · WalletPanel split into <Watchdog><WalletPanelBody/> · WalletActivityFeed child covers mo-12 ledger) ·
mo-11 (7674ff3 · LeaderboardSection split into <Watchdog><LeaderboardSectionBody/> · covers empty + loaded + caller-outside branches) ·
mo-15 + mo-18 (0f91b0e · AffiliateWidget React boundary + fetchAffiliate watchdogWrap · shared subtree) ·
mo-17 (bf62811 · SponsoredRewardModule outer GlassCard · aggregates independently from nested mo-13 RewardRules wrap).
tsc EXIT=0 (NODE_OPTIONS=--max-old-space-size=8192 required — tsc flakes under 4GB default) · vitest 149/149 PASS baseline maintained across every commit. No adjacent bug fixes · pure wraps. No push — local commits only per Daniel's no-push protocol.

Citation drift acknowledged for mo-05 (JourneyMapTab cites sidecar-stub.ts:1701/1738/1800; actual methods at cancelScheduledJob:1826, rescheduleJob:1868, retryScheduledJob:1928) and mo-11 (JourneyMapTab cites useCommunity.ts:100 but the top-5 render component is community/LeaderboardSection.tsx). Wires alive in both cases; no wire-state changes so JourneyMapTab left untouched by this pass._
