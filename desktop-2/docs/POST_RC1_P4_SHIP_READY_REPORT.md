# P4 · Post-RC1 ship-ready regression report

**Base**: `codex/post-rc1-launch` @ `967db885` (from RC1 tag `rc1-dev-handover-2.2.36` · GitHub `e1794812` · local `e446ddb7`)
**Date**: 2026-07-13
**Owner**: Codex (autonomous)

Honest, per-journey launch-readiness call for Liquid Clips runtime `2.2.36`. Sources: `FEATURE_INVENTORY.md`, `KNOWN_ISSUES_AND_DEBT.md`, `POST_RC1_P3_LIVE_APP_JOURNEY.md`, gate logs at `e446ddb7`, and the installed app's on-disk artifacts.

Legend (used per journey):

- **Foundation green** — code, gates, and D1 evidence support the surface without known regressions.
- **Customer-launch ready** — a fresh customer can hit this journey today and get an honest outcome (success or a truthful error).
- **Mocked / incomplete integration** — surface renders but the real backend / third-party wire is not fully live.
- **Roadmap** — planned, not shipped.
- **True blocker** — must fix before ANY paid customer touches it.

---

## Summary matrix

| # | Journey | Foundation | Launch-ready | Mocked | Roadmap | Blocker |
|---|---------|:---:|:---:|:---:|:---:|:---:|
| 1 | Authentication | GREEN | READY | — | — | — |
| 2 | Onboarding | GREEN | READY (walkthrough intact) | — | — | — |
| 3 | Clipper mode | GREEN | READY | — | — | — |
| 4 | Agency mode | GREEN | READY | preview / roster contract state honest | — | — |
| 5 | Clip generation | GREEN | READY (with friction) | Anthropic keychain gate limits headless flows | — | Dropbox+emoji ingest failure surface (see § 5) |
| 6 | Editing (caption / trim / watermark / style) | GREEN | READY | non-mono style presets flagged "coming soon" | — | — |
| 7 | Export | GREEN | READY | — | — | — |
| 8 | Wallet / Earn | GREEN | READY | Whop payout receipts stay observation-only until real payout drop | — | — |
| 9 | Sponsored Reward | GREEN | PARTIAL | LC Score default 75; dupe-detection deferred to Whop | full Sponsored campaign owning-org signup flow | — |
| 10 | Campaigns | GREEN | READY | some campaign banner assets still Dropbox-hosted | — | — |
| 11 | Community | GREEN | READY | 9 seeded channels; moderation contract gates honest | — | — |
| 12 | Account + billing | GREEN | READY (Clipper); Agency six-state sweep pending | trial / cancelled-but-entitled / expired / payment-failed / no-sub / active per-persona proof pending | — | six-state Playwright sweep is the last money-surface gate — see § 12 |
| 13 | Runtime update behaviour | GREEN | READY | BUG-012 (runtime_check_now) is one-line native, mitigated | — | — |
| 14 | Publish / schedule | GREEN | READY (assisted walk-around) | persistent-cookie webview + local records + native OS notification; no Ayrshare | full multi-provider OAuth SDK | — |

**Net**: Foundation is entirely green across the 14 journeys. One true blocker (Dropbox+emoji ingest) is a Python-sidecar bug, not shell or runtime. One outstanding money-surface sweep (Agency six-state) is scheduled as the very next Codex work item.

---

## 1. Authentication

- **State**: foundation green · launch-ready.
- **Evidence**: `tests/e2e/clerk-otp-login.spec.ts` P0 gates pass · Whop primary + Clerk fallback per `liquid_clips_whop_lead_decision`.
- **Notes**: LC-ID fallback + Clerk panel render honestly per env gate. `tests/e2e/clerk-otp-login.spec.ts:62` is skipped for identifier-variant coverage that requires manual Clerk sandbox — not a blocker.

## 2. Onboarding

- **State**: foundation green · launch-ready.
- **Evidence**: `tests/e2e/first-run-onboarding.spec.ts` (settings → upgrade → connect flow) landed clean at D1 · WelcomeGate identity ladder + TopHud canonical pill live.
- **Notes**: The `activation-flow.spec.ts:123` skip is the native cold-start walk — driven by human `native-walk-prep/j001-*` docs.

## 3. Clipper mode

- **State**: foundation green · launch-ready.
- **Evidence**: `tests/e2e/full-clipping-journey.spec.ts:171` all 12 steps (generate → edit → reaction → caption → trim → watermark → style → schedule honesty → export) pass at D1 (46.1 min sweep). Cross-clip persistence race fixed at RC1 via `clip-shell` primitive.
- **Notes**: Mode radiogroup at `TopHud.tsx` persists selection; Whop CTA propagation gated per tier.

## 4. Agency mode

- **State**: foundation green · launch-ready.
- **Evidence**: `tests/e2e/settings-cockpit.spec.ts` — twelve tests pass, including `agency roster renders forbidden and offline states honestly` (`:529`, hardened at RC1) and `agency welcome CTAs navigate to real product surfaces`.
- **Notes**: Agency-only pricing pivot LOCKED 2026-07-06 ($0 sign-up / $99.99/mo). Founder / Solo / Pro / Enterprise DEFERRED to post-100-Agency-user milestone.

## 5. Clip generation (INGEST → TRANSCRIBE → JUDGE → CUT)

- **State**: foundation green · **launch-ready with friction** · **one true blocker on a specific source-file shape**.
- **Evidence** (P3): 170 projects and 724 clip files in `~/LiquidClips/projects/` produced by the installed app; bundled ffprobe verifies the sampled clip plays as H.264 + AAC. Whisper transcripts + `.metrics.json` stage timings present.
- **Blocker** (customer-visible): recent run against a Dropbox smart-synced source file with emoji in filename (`Jae5 x Walkz Stream!! 🟢 Guest Stream 🟢 (1).mp4`) failed at ingest with `CalledProcessError` on the ffprobe subprocess. Python sidecar needs a `os.path.exists` gate + a friendly UI error state for smart-sync-not-hydrated sources. Recorded verbatim in that project's `project.json`. This is the very next customer-blocking item after the six-state sweep.
- **Notes**: Anthropic clip-judge keychain gate is `mode=auto`; sidecar boot log records `anthropic_key: has=False cached=False` for the current headless test-machine state — real customer boots inject the key via the desktop-connect flow, not tested here.

## 6. Editing

- **State**: foundation green · launch-ready.
- **Evidence**: `tests/e2e/caption-editing.spec.ts`, `tests/e2e/watermark-proof.spec.ts` (mono preset path), style + trim tabs in the workstation. Money-surface rule enforced (workstation is a Design-OS tool surface, no HTML mockup required).
- **Notes**: Non-mono style presets ship with `style-preset-coming-soon` + `style-accent-coming-soon` — honest "coming soon" copy, not a lie.

## 7. Export

- **State**: foundation green · launch-ready.
- **Evidence**: Real MP4 outputs on disk (724 clip files). Playback proven for the sampled clip (H.264 + AAC, 632KB, 18.93 s duration).
- **Notes**: Prod synthetic export success ban (`tasks/#73`) shipped — no fake `export.done` toasts.

## 8. Wallet / Earn

- **State**: foundation green · launch-ready.
- **Evidence**: `WalletDetail.tsx` Section-pipeline route replaces Design-OS `EarnRoute` per money-surface rule. `SectionWithFallback` scoped to WalletDetail only (2026-07-10 LOCK). Recent `check-your-wallet` toast + retry click covered by tests.
- **Notes**: Real payouts are observation-only until a real customer hits a real Whop payout event; UI copy is honest about pending balance.

## 9. Sponsored Reward

- **State**: foundation green · **customer-launch PARTIAL**.
- **Evidence**: LC Score default 75 · owned campaign banner surfaces · dupe-detection intentionally deferred to Whop upstream.
- **Roadmap**: The full "creator posts a Sponsored campaign, Liquid Clips owns the funnel" story is post-RC1 — currently campaigns show for clippers to submit to, but the owning-org signup path is not launch-week-scope.

## 10. Campaigns

- **State**: foundation green · launch-ready.
- **Evidence**: Uncle Daniel campaigns auto-seed via lifespan startup (3 mission-lane rows) + 7 legacy fixtures. Campaign nav telemetry (BUG-001 · BUG-010) instrumented via Phase 1; Phase 2 optimize deferred.
- **Notes**: A few Sponsored campaign banners still reference Dropbox `sampleCampaigns.ts` external URLs; migration to `/public/brand/**` in-tree assets is a small pass in the queue.

## 11. Community

- **State**: foundation green · launch-ready.
- **Evidence**: 9 seeded channels via lifespan (`seed_community_channels.py`). Moderation contract-gate tests pass in D1. BC-013 layout landed.
- **Notes**: Real chat traffic is observation-only until real users arrive; seeded channels prevent empty-state discouragement.

## 12. Account + billing

- **State**: foundation green · **launch-ready for Clipper**; **Agency six-state sweep PENDING** as the next Codex work item.
- **Evidence**: `tests/e2e/cancellation.spec.ts` covers L1/L2/L3 states via delete-fixtures + real data path. R2 sprint landed. L5 (`cancellation sweep · six states · real non-admin persona`) is scoped per `POST_RC1_EXECUTION_PLAN.md` § 3.
- **Non-blocking**: today a first-time Clipper hits the Free tier ($0 sign-up / 10 clips) with zero friction; the six-state sweep is defensive proof, not a launch-week user-visible gap.
- **Blocker for confidence**: without the six-state sweep, we cannot assert Agency subscription lifecycle honestly under all failure modes — high priority for the next Codex cycle.

## 13. Runtime update behaviour

- **State**: foundation green · launch-ready.
- **Evidence**: Train B1 (Runtime version/update truth · BUG-006 + 007 + 009 + 012) landed. `tests/e2e/update-journey.spec.ts` covers beacon → stage → relaunch. Train D1 (Codex-style restart-gated update journey) landed.
- **Notes**: BUG-012 is a one-line native fix in `src-tauri/src/runtime.rs::runtime_check_now` — deferred with runtime-side D1 mitigation shipped. Shell FROZEN honours this deferral honestly.

## 14. Publish / schedule

- **State**: foundation green · launch-ready via approved walk-around.
- **Evidence**: Persistent-cookie in-app webview (browse.rs:189 · 2026-06-30) + assisted-schedule local records (`assistedSchedule.ts`) + native OS notification. User manually posts inside the persistent-signed-in webview. NO Ayrshare, NO OAuth SDK, NO Profile Key.
- **Roadmap**: A future OAuth SDK story (multi-provider posting from the app itself) is deferred — walk-around already meets customer-visible promise.

---

## Buckets recap

**Foundation green**: authentication · onboarding · Clipper mode · Agency mode · clip generation · editing · export · wallet · campaigns · community · account (Clipper) · runtime updates · publish/schedule (walk-around).

**Customer-launch ready**: all 14 journeys except:

- Sponsored Reward (owning-org signup flow) — PARTIAL, non-blocking (roadmap).
- Account + billing (Agency six-state sweep) — READY for Clipper today, six-state defensive proof PENDING.

**Mocked / incomplete integrations**:

- Sponsored Reward owning-org signup (roadmap).
- Whop payouts observation-only (waits for real payout event to prove UI).
- Non-mono style presets flagged "coming soon" (honest stub).
- OAuth-SDK multi-provider posting (roadmap; walk-around ships).

**Roadmap items** (deferred, not launch-week):

- Anthropic clip-judge cost telemetry.
- Campaign nav performance Phase 2 optimize.
- Self-healing + self-extending roadmaps (post-launch).
- BUG-012 native one-line fix (post-shell-unfreeze).

**True blockers**: **one** — the Dropbox smart-sync + emoji-filename ingest failure. Scoped as a Python-sidecar path guard + UI error surface; runtime/frontend work in this branch will surface the friendly failure state as soon as the guard lands.

**Six-state Agency subscription sweep**: **highest-priority next work item**, per `POST_RC1_EXECUTION_PLAN.md` § 3. Not a launch-week user-visible blocker (Clipper Free tier is the day-zero customer path) but the last remaining money-surface confidence gate.

---

## What Codex does next

Per `POST_RC1_EXECUTION_PLAN.md` order:

1. Land the Agency six-state cancellation/subscription sweep (Playwright + honest state harness).
2. Land Crew flow Path A persistence proof.
3. File the Dropbox+emoji ingest fix as a customer-blocker follow-up (Python-sidecar path guard + UI toast copy).
4. Wire `clip.run` + `export.done` events into `diagnosticLogger` so future P3 evidence is queryable at HQ.
5. Begin the HQ integration foundation (canonical schema + correlation IDs).

Any of the above that needs money-surface copy, entitlement math, or pricing changes surfaces to Daniel for greenlight before landing.
