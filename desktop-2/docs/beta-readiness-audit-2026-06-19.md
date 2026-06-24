# Beta Readiness Audit + Build Order Review
### desktop-2 · single-report scope-freeze

*Date · 2026-06-19 · Author · Claude · No code, no builds, no refactors*

The purpose: determine the **exact** shortest path from today's state to a complete Liquid Clips beta launch. This report classifies every remaining item, audits every user journey + route, and recommends the build sequence. Nothing is built. Nothing is refactored.

---

## 0 · Headline

| | |
|---|---|
| **Beta readiness** | **~62%** |
| **Critical-path remaining** | **12–15 days** (Phase 1 only) |
| **Total to ship-ready beta** | **23–26 days** (Phase 1 + 2) |
| **Recommended next phase** | **Phase 1 · Critical Path** · start with LoginOnboarding + brief-link inline CRUD + v0.7.56 CI pipeline |

The architecture is in good shape. The §8 URL-first patch + 6N-G user-facing reads shipped today land the agency → clipper → Whop loop cleanly. The remaining work is concentrated in 5 placeholder routes, one CI pipeline gap, and one banner-generation gap (6N-H proposed). Notably absent from the blocker list: any new OAuth, any new payout infrastructure, any deep Whop integration — those are all locked out of v1 by design.

---

## SECTION A · End-to-End User Journey Audit

### Agency journey

| Step | Status | Notes |
|---|---|---|
| Sign up + sign in | ❌ **Missing** | `LoginOnboarding.tsx` is a SimPage placeholder. v1 agencies must be admin-allowlisted manually (`is_admin_email`). |
| Discover "Create campaign" CTA | ✅ **Working** | Floating CTA on `Campaigns.tsx` (agency-tier gated) |
| Step 1 · Connect Whop reward (URL paste) | ✅ **Working** | §8 URL-first patch shipped. Validate optional. "Use this URL anyway" CTA added. |
| Step 1 · Open Whop to create reward | ✅ **Working** | `WHOP_CREATE_REWARD_URL` → `bus.emit("browse:open")` |
| Step 2 · Title + Brief (mirror Whop rules) | ✅ **Working** | "Mirror the Whop reward rules" subsection + "Open Whop reward to copy rules" link |
| Step 3 · Banner | ⚠️ **Partial** | Picker over 8 brand presets works. **AUTO-GENERATION NOT BUILT** (6N-H audit complete, locked, no build) |
| Step 4 · Brief links | ⚠️ **Partial** | Read-only display. **Inline add/edit NOT BUILT** (flagged in 6N-E §8 gaps) |
| Step 5 · Discussion picker | ✅ **Working** | Picker over `useCommunity().channels` |
| Step 6 · Targeting (tiers + platforms) | ✅ **Working** | Whop-allowed platforms read-only; LC tiers editable |
| Step 7 · Featured (mission lane) | ⚠️ **Partial** | Field exists, **billing-wire-up deferred** |
| Step 8 · Review + Publish | ✅ **Working** | URL-first 3-gate publish (URL + title + brief + type) |
| Manage campaign · edit post-publish | ⚠️ **Partial** | Backend supports PATCH but no UI in v1 (drafts only) |
| Manage campaign · unpublish | ❌ **Missing** | Not in v1. Required for reward swaps after live. |
| Review submissions | ❌ **Stub** | LC does NOT own submission state per lock. Whop owns it. LC surfaces leaderboard preview only. Acceptable for beta. |
| Withdraw / archive campaign | ❌ **Missing** | Backend supports `status=closed` but no UI flow |

**Agency journey assessment:** Functional with 2 hard gaps (LoginOnboarding, brief-link inline CRUD) and 1 visual gap (banner generation). Without those, agencies can ship campaigns but the surface feels half-built.

### Clipper journey

| Step | Status | Notes |
|---|---|---|
| Sign up + sign in | ❌ **Missing** | Same LoginOnboarding blocker |
| Discover campaigns | ✅ **Working** | `Campaigns.tsx` route + `useCampaigns()` + filter chips |
| Browse marketplace | ⚠️ **Partial** | Card visuals exist but banner uniformity blocked on 6N-H. Marketplace consistency rule violated until banner gen ships. |
| Open campaign detail | ✅ **Working** | `CampaignPageShell` drawer with §2 WhopRewardCard (shipped today) |
| Read brief | ✅ **Working** | Description block + 6N-D v1 brief-links read |
| Access asset links | ✅ **Working** | `CampaignAssetLinkRow` opens via `browse:open` |
| Join campaign | ✅ **Working** | "Submit on Whop ↗" CTA opens the Whop reward URL (§8 lock-aligned) |
| Submit content (on Whop) | ✅ **External · honest** | Whop owns submission workflow per lock. LC opens the URL. |
| Track submission status | ⚠️ **Partial** | `Earn.tsx` shows mirrored approved submissions from bonus_ledger. **Pending submissions invisible to LC** by design (Whop owns the state). Worth a copy pass to make this clear to the clipper. |
| View earnings | ✅ **Working** | `Earn.tsx` + 5-tile summary strip + filtered rows |
| View payout (after Whop pays) | ⚠️ **Partial** | LC mirrors approved rows but explicit "payout in Whop" CTA missing on Earn row drawer |
| First-run onboarding | ❌ **Missing** | `ClipperJourney.tsx` is SimPage placeholder · 3-of-8 hardcoded |

**Clipper journey assessment:** Functional core. The two real gaps are LoginOnboarding (shared with agency) and clipper-facing onboarding. Submission tracking is honest-by-lock but needs copy work so clippers don't blame LC for the state delay.

### Community journey

| Step | Status | Notes |
|---|---|---|
| Discover rooms | ✅ **Working** | `RoomGrid` 4-section layout |
| Open room | ✅ **Working** | `RoomDetailDrawer` over generic Discussion shape |
| Read discussion (Whop mirror) | ✅ **Working** | `bus.emit("browse:open", mirror: "whop")` to Whop community URL |
| Native discussion | ❌ **Deferred** | Out of scope per `liquid_clips_browse_rewards` memory |
| Announcements | ❌ **Stub** | `AnnouncementsRail` safe empty state. **No backend `/announcements` endpoint confirmed** (Phase 6K gap) |
| Leaderboards | ✅ **Working** | `LeaderboardSection` top-5 earners + caller pin |
| Achievement unlocks | ✅ **Working** | `AchievementToast` listens to `achievement:unlocked` bus event |
| Wall of clippers | ❌ **Missing** | Doesn't exist in legacy · new ask · scope decision needed |
| Direct messages | ❌ **N/A** | Out of scope · Whop owns DMs |

**Community journey assessment:** Largely working. Announcements is the one real gap. Wall of Clippers is a scope question, not a build blocker.

---

## SECTION B · Route Audit

17 route files in `desktop-2/src/design-os/routes/`. Classification:

| Route | LOC | Status | Real backend | Stub strings | Beta-blocker? |
|---|---|---|---|---|---|
| `CommandRoom.tsx` | 324 | ✅ **Fully complete** | Home dashboard · no backend dependence | None | No |
| `Campaigns.tsx` | 192 | ✅ **Mostly complete** | `useCampaigns()` → `/campaigns` (shipped 6N-G) | "dedicated /campaigns/<slug> URL lands later" — drawer pattern OK for beta | No |
| `Channels.tsx` | 118 | ✅ **Mostly complete** | `useChannels()` → `/channels` | OAuth flow + disconnect UI deferred | **Partial** |
| `Schedule.tsx` | 227 | ✅ **Mostly complete** | `useSchedule()` → `/schedules` | Drag-to-reschedule stub | No |
| `Earn.tsx` | 165 | ✅ **Mostly complete** | `useRewardClips()` → `/me/reward-clips` | Mutations deferred | No |
| `Community.tsx` | 168 | ✅ **Mostly complete** | `useCommunity()` channels | Announcements rail empty · "real Whop wiring lands later" | **Partial** |
| `ThumbnailStudio.tsx` | 370 | ✅ **Mostly complete** | Thumbnail sidecar stubs · 7 sub-components | "real generation lands when sidecar runtime installed" | No (Pro feature) |
| `TimelineStudio.tsx` | 195 | ✅ **Mostly complete** | Fixture project only · no backend wiring | "in real wiring this comes from live project" | No |
| `ClippingEngine.tsx` | 136 | ✅ **Mostly complete** | `sidecar.startRun()` | "Engine preview" tag in mock mode | No |
| `CreateClips.tsx` | 133 | ✅ **Mostly complete** | `sidecar.startRun()` on drop/paste | "Engine preview" mock | No |
| `ExportRoute.tsx` | 283 | ✅ **Mostly complete** | `useChannels()` + `exportApi` stub | Whop publish path deferred (correct per lock) | No |
| `Library.tsx` | 27 | ⚠️ **Placeholder** | None — SimPage | "1,420 clips archived" is mock eyebrow | **Yes** for clipper-facing beta |
| `Settings.tsx` | 27 | ⚠️ **Placeholder** | None — SimPage | All theme/motion/audio/privacy controls deferred | **Yes** for any beta |
| `ClipperJourney.tsx` | 28 | ⚠️ **Placeholder** | None — SimPage | "Step 3 of 8" hardcoded | No (nice-to-have onboarding) |
| `LoginOnboarding.tsx` | 27 | ❌ **Placeholder** | None — SimPage | "Email/Google/Apple auth deferred" | **YES · HARD BLOCKER** |
| `StopPages.tsx` | 27 | ⚠️ **Placeholder** | None — SimPage | "10 stops mapped" is mock | Partial (error/empty UX) |
| `SimPage.tsx` | 200 | n/a (template) | Shared placeholder template | — | n/a |

**Route audit summary:**
- 11 mostly complete with real or stubbed backend
- 1 fully complete (CommandRoom)
- 5 placeholders, of which **2 are hard beta blockers (LoginOnboarding, Settings)** and 3 are partial blockers (Library, StopPages, ClipperJourney)

---

## SECTION C · Remaining Build Plan

Each item carries: **Name · Current state · Completion % · Dependency · Risk · Effort · Category**.

### Phase 1 · Critical Path (12–15 days · MUST land for beta)

| # | Item | Current | % | Dependency | Risk | Effort | Category |
|---|---|---|---|---|---|---|---|
| P1-1 | **LoginOnboarding · Clerk + Whop OAuth wire** | SimPage placeholder; Clerk + Whop wired in legacy desktop | 0 | Clerk JWT (existing), Whop OAuth login (existing) | Med — auth surface is sensitive | **3–5d** | Launch Blocking |
| P1-2 | **Settings · Account + Connections + Tier basics** | SimPage placeholder; legacy desktop has Connections panel | 0 | `social/connections`, `/me`, `/tier` (existing) | Low | **2–3d** | Launch Blocking |
| P1-3 | **v0.7.56 CI updater pipeline unblock** | B1–B5 in `desktop/docs/SHIP_v0.7.56_BLOCKERS.md`; CI builds but manifest stale | 40 | GitHub Actions, notarisation chain (IG-013) | Med — updater is silent-fail-prone | **2d** | Launch Blocking |
| P1-4 | **Brief-link inline CRUD (Step 4 of agency flow)** | Read-only display | 60 | Existing 6N-D v1 hook `useCampaignAssetLinks` | Low | **1d** | Launch Blocking |
| P1-5 | **6h reward refresh cron + stale state** | Manual refresh button only | 50 | APScheduler in junior-backend; `whop_reward_state = "stale"` derivation | Low | **1d** | Launch Blocking |
| P1-6 | **Notarised installer for desktop-2 binary** | desktop-2 is `v0.8.0-shell`; CI not wired | 30 | IG-013 chain | Med — Apple gatekeeping is brittle | **3d** | Launch Blocking |
| P1-7 | **Agency tier provisioning (admin-bootstrap)** | `is_admin_email` allowlist only | 50 | `/admin/users` (existing) | Low | **0.5d** | Launch Blocking |
| P1-8 | **Pending-submission copy pass on Earn** | Approved-only mirror today; clipper doesn't know "pending lives in Whop" | 80 | None | Low | **0.5d** | Launch Blocking |

**Phase 1 subtotal:** ~12–15 days (with parallel work)

### Phase 2 · Launch Polish (~11 days · beta-quality)

| # | Item | Current | % | Dependency | Risk | Effort | Category |
|---|---|---|---|---|---|---|---|
| P2-1 | **Banner generation v1 (6N-H)** · marketplace-rectangle template | Audit + lock complete; no build | 0 | OpenAI API key, Thumbnail Studio engine reuse, banner compositor | Med — text rendering reliability | **3d** | Revenue Blocking (marketplace consistency) |
| P2-2 | **Library route fill** | SimPage placeholder | 0 | `/me/clips` (legacy has it) | Low | **3d** | Important |
| P2-3 | **Empty / error / loading state sweep** | Spot-checked, inconsistent across routes | 50 | None | Low — high impact | **2d** | Important |
| P2-4 | **Settings polish (motion/theme/keyboard)** | Phase 1 ships basics; Phase 2 adds polish | 30 | Existing brand-kit tokens | Low | **1d** | Important |
| P2-5 | **CampaignPageShell · §3-9 polish pass** | Functional but unpolished | 60 | None | Low | **1d** | Important |
| P2-6 | **Visual walkthrough screenshots + ship-lens sweep** | Some manual, no systematic capture | 30 | `ship-lens-reviewer` agent | Low | **1d** | Important |

**Phase 2 subtotal:** ~11 days

### Phase 3 · Post-Beta / V2 (deferred · do NOT build for beta)

| # | Item | Reason deferred |
|---|---|---|
| P3-1 | **Phase 6P · Browser Capture v1** | Approved future capability, locked DO NOT BUILD YET (`desktop/docs/ROADMAP_LOCK.md` PHASE LOCKS) |
| P3-2 | **Phase 6P v1.5 · Reconciliation** | Gated on 6P v1 |
| P3-3 | **Phase 6P v2 · Deep Assist** | Gated on graduation criteria (100/10k/95%/90d) |
| P3-4 | **Phase 6N-F · Whop agency OAuth + bounty:create** | Conflicts with pre-6N-E lock ("no new OAuth") |
| P3-5 | **Asset ingestion · Drive/Dropbox** | 6N-D v2 (`asset-source-foundation-audit.md`) · ~5d, post-beta |
| P3-6 | **ClipperJourney onboarding tour** | Nice-to-have, not blocking |
| P3-7 | **StopPages design pass** | Nice-to-have polish |
| P3-8 | **Wall of clippers** | Scope decision pending |
| P3-9 | **Native LC reward engine** | Locked behind graduation criteria |
| P3-10 | **Hosted compute (Modal/Replicate)** | Sprint #14b post-beta |
| P3-11 | **Native discussion (non-Whop)** | Out of scope per `liquid_clips_browse_rewards` memory |
| P3-12 | **Sponsored/featured billing wire** | Step 7 stub, post-beta |
| P3-13 | **Animated banners / video banners** | Banner v1.5+ |
| P3-14 | **Banner social-share + OG variants** | Banner v1.5 |

---

## SECTION D · Fast Wins

Smallest tasks with the largest visible-quality bump. Rank by `impact / effort`.

| Rank | Item | Effort | Impact | Notes |
|---|---|---|---|---|
| 1 | **Add "Powered by Whop" pill** to `CampaignCard` + `CampaignBanner` + `CampaignPageShell` | 1h | High — completes the §0.G lock vocabulary | Lock requires it on every card with a Whop reward; current cards omit it |
| 2 | **Snapshot qualifier polish** · italicize "via Whop snapshot" consistently | 0.5h | Med | Already in `CampaignPageShell` §4/§5; mirror to `CampaignCard` + `CampaignBanner` |
| 3 | **Brief-link inline add/edit** (P1-4) | 1d | High | Agency Step 4 currently read-only · the only Step that doesn't accept input |
| 4 | **Pending-submission copy on Earn** (P1-8) | 0.5d | High | Stops clipper confusion · prevents support tickets |
| 5 | **Reward snapshot refresh button surfacing** on `CampaignPageShell §2` | 0.5h | Med | `onRefresh` prop exists; not wired in PageShell |
| 6 | **6h refresh cron** (P1-5) | 1d | Med | Reward staleness limit; replaces manual refresh need |
| 7 | **CampaignBanner loading skeleton** when snapshot is `not_attempted` | 0.5d | Med | Currently renders payoutRules fallback silently · better to indicate "fetching from Whop" briefly |
| 8 | **Brand-asset wiring on remaining 8 banner presets** | 1h | Med | Step 3 already has them; cross-check the discovery banners use the same set |
| 9 | **Agency-tier "Create campaign" CTA on Home** | 1h | Med | Currently only on `Campaigns.tsx`; agency expects it on landing |
| 10 | **WhopRewardCard "Open in Whop ↗" footer button** | 0.5h | Med | Symmetric with Step 1's "Open Whop reward to copy rules" |
| 11 | **Status pill consistency · "Funded" vs "Reward linked" vs "Open in Whop"** per §0.D lock | 1h | High | Card visual coherence; current cards still render status from `whopRewardState` enum, not the lock's pill rules |
| 12 | **Library SimPage → minimal "Your clips" list** | 1d | Med | Read-only list from `/me/clips`; closes the placeholder visible cliff |
| 13 | **Floating "Help" / "Docs" pin** on every route | 0.5d | Med | Beta needs a feedback channel · cheap insurance |
| 14 | **"You're on the beta" banner** under main nav | 0.5h | Med | Sets expectations; reduces "but this is broken" support |

**Fast-win bundle (1.5 days total):** 1 + 2 + 4 + 5 + 7 + 8 + 9 + 10 + 11 + 14 = ~1.5d for a noticeable polish bump.

---

## SECTION E · Honest Launch Assessment

### Could 3 agencies use this next week?

**YES · with manual provisioning.**

What works for 3 agencies:
- Admin-bootstrap their email via `is_admin_email` allowlist (P1-7 · 0.5d)
- They paste a Whop reward URL, write a brief, publish a campaign
- Clippers (already on Whop) see the campaign, click "Submit on Whop ↗", flow goes to Whop
- Earn tab mirrors approved submissions from the bonus ledger
- Discussion mirror to Whop community works

Blockers for 3 agencies:
- ❌ No self-serve sign-up — admin must add them (acceptable for 3)
- ⚠️ Banner generation missing — every campaign uses one of 8 brand presets, repetition visible
- ⚠️ Brief-link inline CRUD missing — agencies need direct API call or admin support to edit
- ⚠️ Settings placeholder — they can't manage connections in-app

**Verdict:** Functionally yes, with the agency-bootstrap admin doing 30 minutes of setup each.

### Could 10 agencies use this next week?

**NO.**

Blockers at 10:
- ❌ **LoginOnboarding missing (P1-1)** — admin-bootstrap doesn't scale past ~5
- ❌ **Settings placeholder (P1-2)** — agencies need self-serve connections + tier visibility
- ⚠️ **Banner repetition becomes visible** — 10 campaigns × 8 brand presets = cards start to feel "templated"
- ⚠️ **Brief-link inline CRUD** — at 10 agencies the API workaround starts breaking ([see fast-wins])
- ⚠️ **No agency-side analytics surface** — agencies expect to see "how many clippers viewed my campaign"

What 10 needs that 3 didn't:
- Phase 1 (P1-1 + P1-2) complete
- Banner generation v1 (P2-1) at least in beta
- A 1-page "Agency dashboard" view (~1d add to Phase 2)

### Could 100 clippers use this next week?

**NO.**

Blockers at 100:
- ❌ **LoginOnboarding missing** — same hard gate
- ❌ **No notarised installer for desktop-2** (P1-6) — Apple Gatekeeper blocks unsigned downloads at scale
- ❌ **Updater pipeline broken** (P1-3, v0.7.56) — first patch ship after beta = breaking
- ⚠️ **Library placeholder** — clippers will look for "my clips" and find SimPage
- ⚠️ **No clipper onboarding tour** (`ClipperJourney`) — first-time UX is harsh
- ⚠️ **Marketplace consistency violated** (banner gen) — 50+ campaigns in the grid look fragmented
- ⚠️ **Pending submission state confusing** — 100 clippers will produce ~30 "where's my submission?" tickets weekly without P1-8 copy fix
- ⚠️ **No bug-report surface** — clippers can't tell us what's broken

What 100 needs:
- All of Phase 1 (~12–15d) + most of Phase 2 (~11d)
- A clipper-friendly Library route
- A "Beta · please report bugs" footer with a real channel

---

## SECTION F · Open dependencies + risks

| Dependency | What it gates | Status | Mitigation if blocked |
|---|---|---|---|
| Whop developer relations sign-off for Browser Capture (6P) | Phase 6P v1 ship | Not requested | Phase 6P is post-beta · zero impact on beta launch |
| Notarisation pipeline (IG-013) | P1-6 | Wired in legacy, not in desktop-2 | Port the GH Actions workflow (~3d) |
| OpenAI API quota | Banner generation (P2-1) | Daniel has key + quota per `api_keys.md` memory | None — proceed |
| Higgsfield Ultra | Cinematic intro / atmosphere assets | Available per `higgsfield_capability.md` | Use existing intro mp4 |
| Apple Developer cert | Notarisation | In login keychain, KT68NGT4LX | Renewal calendar item |
| Railway backend uptime | All real-data routes | Live at api.liquidclips.app | Single-replica risk · acceptable for beta |
| Backend disconnected from GitHub source | Manual `railway up` deploys | Per `desktop/CLAUDE.md` rule (B0) | Document the manual deploy step for the team |

---

## SECTION G · Critical-path checklist (final)

Copy this checklist into a ship tracker. Each row maps to a single PR or deploy unit.

```
[ ] P1-1 · LoginOnboarding · Clerk + Whop OAuth wire             (3–5d)
[ ] P1-2 · Settings · Account + Connections + Tier basics         (2–3d)
[ ] P1-3 · v0.7.56 CI updater pipeline unblock                    (2d)
[ ] P1-4 · Brief-link inline CRUD (Step 4)                        (1d)
[ ] P1-5 · 6h reward refresh cron + stale state                   (1d)
[ ] P1-6 · Notarised installer for desktop-2                      (3d)
[ ] P1-7 · Agency tier provisioning (admin bootstrap)             (0.5d)
[ ] P1-8 · Pending-submission copy pass on Earn                   (0.5d)
─────────────────────────────────────────────────────────────────────
PHASE 1 GATE · 12–15 days · YES this is the beta line

[ ] P2-1 · Banner generation v1 (6N-H) marketplace rectangle      (3d)
[ ] P2-2 · Library route fill (read-only /me/clips)               (3d)
[ ] P2-3 · Empty/error/loading state sweep                        (2d)
[ ] P2-4 · Settings polish                                         (1d)
[ ] P2-5 · CampaignPageShell §3-9 polish pass                     (1d)
[ ] P2-6 · Visual walkthrough screenshots + ship-lens sweep       (1d)
─────────────────────────────────────────────────────────────────────
PHASE 2 GATE · 11 days · Beta-quality polish line

[X] Phase 3+ · Browser Capture · Whop OAuth bounty:create · Wall · Native rewards
   · explicitly DEFERRED · do not build
```

---

## SECTION H · Recommended next implementation phase

**Start Phase 1 · Critical Path · Begin with P1-1 (LoginOnboarding) + P1-4 (brief-link inline CRUD) in parallel.**

Rationale:
- P1-1 is the single biggest beta blocker. Estimating 3–5d means start it now.
- P1-4 is the fastest user-visible improvement (1d) and removes the only "step in the agency flow that isn't actually editable" surface.
- P1-3 (CI pipeline) and P1-6 (notarisation) can run in parallel since they're separate worktrees (CI vs binary signing).
- P1-2 (Settings) starts when P1-1 has a stable Clerk hook to read from.
- P1-5 (refresh cron), P1-7 (bootstrap), P1-8 (Earn copy) are tail items, ~2d combined.

**Suggested 2-week sprint:**

| Day | Work |
|---|---|
| Day 1 | P1-7 (0.5d) + P1-8 (0.5d) + start P1-4 |
| Day 2 | finish P1-4 + start P1-1 + P1-3 (parallel agents) |
| Day 3–5 | P1-1 main · P1-3 main · P1-5 in tail |
| Day 6–7 | P1-1 finish · P1-2 start · P1-6 start |
| Day 8–10 | P1-2 finish · P1-6 finish · ship-lens sweep on all 8 P1 items |
| Day 11–12 | Bug-fix on P1 sprint findings · prep for Phase 2 entry |
| Day 13–15 | Phase 1 stabilization · 3-agency soft beta with admin bootstrap |

After Day 15: gate decision · enter Phase 2 (Launch Polish) OR open the 3-agency soft beta and harden in flight.

---

## SECTION I · Beta readiness scoring detail

| Pillar | Weight | Score | Weighted |
|---|---|---|---|
| Core architecture (Routes + State + Sidecar bridge + Backend) | 25% | 85% | 21.25 |
| Agency campaign creation flow (6N-E + §8 patch) | 15% | 95% | 14.25 |
| Clipper discovery + submission (6N-G + URL-first CTA) | 15% | 85% | 12.75 |
| Community surfaces (channels + leaderboard + announcements) | 10% | 60% | 6.0 |
| Earn + payout mirror | 10% | 75% | 7.5 |
| Auth + onboarding + Settings | 10% | 20% | 2.0 |
| Banner / marketplace visual consistency | 5% | 30% | 1.5 |
| CI / notarisation / updater | 5% | 40% | 2.0 |
| Polish (empty / error / loading states) | 5% | 60% | 3.0 |
| **Total** | | | **~62.25%** |

Phase 1 completion pushes scoring to ~80%.
Phase 1 + Phase 2 completion pushes to ~90%, the beta-launch line.

---

## SECTION J · Frozen scope summary

**For the beta cut:**
- Build: all P1 items + all P2 items (per fast-win bundle judgment call)
- Do NOT build: anything in Phase 3 list (browser capture, new OAuth, native reward engine, asset ingestion, etc.)
- Do NOT refactor: the existing route shells stay where they are; replace SimPage internals only
- Do NOT scope-add: marketplace social-share variants, animated banners, custom agency layouts, etc.

**Scope-freeze decision rule:** If a new ask lands during the sprint that isn't in P1 or P2, route it to "P3 backlog" and continue. The point of this audit is the freeze.

---

## SECTION K · Confidence + caveats

**High confidence in:**
- 6N-E + 6N-G architecture readiness (audited and shipped)
- Route inventory completeness (17 routes mapped)
- Phase 3 deferrals (each has explicit lock or memory backing)
- Day-estimate scale (sized against the 6N-E shipped scope of similar files)

**Medium confidence in:**
- LoginOnboarding effort (3–5d) · depends on whether desktop-2 inherits the legacy Clerk hook or needs a fresh port
- Banner generation visual quality on the first OpenAI call · gpt-image-1 text-rendering risk mitigated by the §0.B lock but background art quality is variable
- Settings completeness · "Phase 1 basics" is loosely scoped · may need a separate scope-locking pass

**Low confidence in:**
- Whether 3 agencies will tolerate the manual bootstrap experience for the duration of the soft beta
- Whether Apple notarisation will pass cleanly on a desktop-2 binary the first time (legacy took 2 iterations)
- Whether announcements (Community) need a build before 100 clippers or whether the empty state is acceptable

---

## TL;DR

- **Beta readiness · 62%.** Phase 1 → 80%. Phase 1 + Phase 2 → 90%.
- **Shortest path · ~12–15 days** of Phase 1 work.
- **Next phase · Phase 1 Critical Path.** Start P1-1 (LoginOnboarding) + P1-4 (brief-link inline CRUD) in parallel.
- **3 agencies next week · YES** with manual provisioning.
- **10 agencies / 100 clippers · NO** without Phase 1 complete.
- **Build gates · do not expand scope past P1 + P2.** Phase 3 is post-beta · explicitly deferred.

---

*Audit complete · no code written · scope frozen · awaiting build authorization for Phase 1 entry.*
