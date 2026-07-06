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
| mo-16 | money/mo-16/sponsored-campaign-submission | pending | self-review PASS | 2026-07-06 | C2 | DEMO edge · Whop URL open + poll · wraps 9-section shell body |

## Halted for Daniel

_(none yet)_

## Handoff signals

_(none yet)_
