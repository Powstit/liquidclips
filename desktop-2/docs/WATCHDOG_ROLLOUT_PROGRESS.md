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
| id-01 | identity/id-01/intro-splash | pending | pending | 2026-07-06 | C1 | Citation drift: JourneyMapTab cites App.tsx:73, real IntroSplash mount at :220 (~150 line drift, wire alive, citation updated same-turn). |
| mo-16 | money/mo-16/sponsored-campaign-submission | f8561f0 | self-review PASS | 2026-07-06 | C2 | DEMO edge · Whop URL open + poll · wraps 9-section shell body |
| ag-18 | agency/ag-18/community-chat | 147e314 | self-review PASS | 2026-07-06 | C2 | DEMO edge · shared wrap covers ag-18 chat panel + ag-19 post message · single subtree |
| ag-19 | agency/ag-18/community-chat (shared) | 147e314 | self-review PASS | 2026-07-06 | C2 | Coverage inherited from ag-18 wrap · no separate node registered |
| ag-20 | agency/ag-20/notifications-inbox | 8bd0450 | self-review PASS | 2026-07-06 | C2 | DEMO edge · InboxSheet portal · scrim outside wrap so close-on-click still works |
| ag-21 | agency/ag-21/announcements | pending | self-review PASS | 2026-07-06 | C2 | DEMO edge · fixed-position banner stack · empty-state short-circuits before wrap so zero pixel drift when no announcements active |
| mo-02 | money/mo-02/schedule-notification-fire | bb382ac | self-review PASS | 2026-07-06 | C1 | AssistedScheduleMonitor mount inside AuthGate · returns null so wrap catches sync hook throws + registers the node so HQ Admin sees polling health |
| mo-03 | money/mo-03/schedule-single-post | 34bda9c | self-review PASS | 2026-07-06 | C1 | PublishModal wrap · scheduled cadence · mo-01 handoff already wrapped downstream in assistedSchedule.ts |
| mo-04 | money/mo-03/schedule-single-post (shared) | 34bda9c | self-review PASS | 2026-07-06 | C1 | Drip cadence lives in the same PublishModal · coverage inherited via shared wrap · no separate node |
| ag-01 | agency/ag-01/create-workspace | pending | tsc+vitest PASS | 2026-07-06 | C-agency | Settings agency-tab section wrap · workspace-creation is the mode/tier flip itself (no explicit create form) |
| ag-02 | agency/ag-02/roster-view | pending | tsc+vitest PASS | 2026-07-06 | C-agency | RosterPanel body wrapped in Watchdog |
| ag-03 | agency/ag-03/roster-invite | pending | tsc+vitest PASS | 2026-07-06 | C-agency | postInvite watchdogWrap · backend agency.py:429 |
| ag-04 | agency/ag-04/revoke-invite | pending | tsc+vitest PASS | 2026-07-06 | C-agency | postRevokeInvite watchdogWrap · backend agency.py:700 |
| ag-05 | agency/ag-05/remove-member | pending | tsc+vitest PASS | 2026-07-06 | C-agency | deleteMember watchdogWrap · backend agency.py:743 |
| ag-06 | agency/ag-06/change-role | pending | tsc+vitest PASS | 2026-07-06 | C-agency | postChangeRole watchdogWrap · backend agency.py:799 |
| ag-08 | agency/ag-08/payout-splits-define | pending | tsc+vitest PASS | 2026-07-06 | C-agency | PayoutSplitPanel body + putPayoutSplits watchdogWrap · MONEY MOMENT |
| ag-09 | agency/ag-08/payout-splits-define (shared) | pending | shared with ag-08 | 2026-07-06 | C-agency | shares ag-08 wrap · reload is same component · no double-wrap |
| ag-10 | agency/ag-10/watermark-removal-charge | pending | tsc+vitest PASS | 2026-07-06 | C-agency | confirmCharge watchdogWrap · MONEY MOMENT (weight=5 default; escalate to 10 in any downstream dispatchIntercession) |
| ag-11 | agency/ag-11/publish-tier-gate | pending | tsc+vitest PASS | 2026-07-06 | C-agency | wrappedExportAndMint · overlap with future mo-08 (safe · same nodeId aggregates) |
| ag-12 | agency/ag-12/trial-approve-early | pending | tsc+vitest PASS | 2026-07-06 | C-agency | approveTrialConversion watchdogWrap · shared helper covers FirstLaunchTrialCard + UpgradeApprovalModal + TopHud pill |
| ag-13 | agency/ag-13/cancel-subscription | pending | tsc+vitest PASS | 2026-07-06 | C-agency | AccountSection cancel surface wrapped · backend trial_convert.py:245 |
| ag-14 | (skip · no user surface) | — | SKIP | 2026-07-06 | C-agency | no founder-badge render exists on Home/Settings/App · grep for founderSeat / founder_seat / founderBadge / isFounder returned zero hits in desktop-2/src (App.tsx:40 is a code comment only) |
| ag-15 | agency/ag-15/monthly-post-cap | pending | tsc+vitest PASS | 2026-07-06 | C-agency | Schedule.tsx cap-tag wrap · backend publish.py:111 |
| ag-16 | (skip · backend-only) | — | SKIP | 2026-07-06 | C-agency | mailer.py Resend templates · no user-reachable desktop surface |
| ag-17 | agency/ag-17/seeded-rooms | pending | tsc+vitest PASS | 2026-07-06 | C-agency | CommunityChatHome wrap in Community route |
| ag-29 | agency/ag-29/f5-scanner-send | pending | tsc+vitest PASS | 2026-07-06 | C-agency | onSendWrapped watchdogWrap + Watchdog boundary around Send button |
| ag-21 | agency/ag-21/announcements | 552dded | self-review PASS | 2026-07-06 | C2-demo | (already logged above; commit-sha filled) |
| ag-22 | agency/ag-22/agency-dashboard | SKIPPED | primitive not portable | 2026-07-06 | C2-demo | account-app agency/page.tsx is a Next.js server component; Watchdog primitive lives in desktop-2/src/lib/watchdog with class-component error-boundary + KadeRepairScreen CSS + brand asset paths. Not portable to account-app tsconfig without a dedicated port sprint. Task rules said skip. |
| ag-23 | agency/ag-23/agency-preview-gate | 476e32a | self-review PASS | 2026-07-06 | C2-demo | DEMO edge · AgencyPreviewBannerInner has two return branches (agency-tier pill + non-agency preview) · same node-id wraps both so failure score aggregates |
| ag-24 | agency/ag-24/boost-pack-purchase | pending | self-review PASS | 2026-07-06 | C2-demo | DEMO edge · dedicated boost-pack SKU absent · wrap covers ScheduleFromExportDrawer cap-card + block-card cluster (upgrade-to-next-tier CTA fires billing.adapter.startCheckout) · scope kept OUT of C-agency's ag-15 Schedule.tsx cap-tag wrap (different file) |

## Halted for Daniel

_(none yet)_

## Handoff signals

_C-agency 2026-07-06 · 12 wraps + 3 skips shipped locally. tsc EXIT=0 · vitest 149/149 PASS._
