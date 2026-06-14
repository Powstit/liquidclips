# Earn Completion — Gaps and Fixes

Date: 2026-06-14
Target: v0.7.76. Earn closure; Kimi keeps Projects Manager.

The Earn surface is the "money path" — Find opportunity → understand
payout/rules/platforms → Start → create/resume Earn Project → make clips →
export → submit → track → payout. Some of this works end-to-end since
v0.7.71; the rest below is what this turn closes.

## 1. What currently works (confirm before changing)

| Surface | State | Evidence |
|---|---|---|
| Public bounty browsing (no login) | ✅ | `EarnTab.tsx:155-190` `loadPublicBounties` runs unconditionally on mount; calls `listPublicWhopBounties(25)` → backend `/whop/bounties/public` |
| Inline "Unlock to start" gating | ✅ | `BountyCard.tsx` accepts `startLabel/startTitle`; v0.7.69 wired this when `auth.kind !== "ready"` |
| Earn icon-rail tabs (Open/Doing/SUB/PAY/Top) | ✅ structurally | `EarnIconRail.tsx`; each routes to a section in EarnTab body |
| Start bounty → resume-don't-recreate | ✅ | `App.tsx:1657-1683` checks `sidecar.listBountyProjects()` for matching `whop_bounty_id` with `!done`, calls `sidecar.getProject(slug)` → results view |
| Earn sidebar "your campaigns" preview | ✅ | `EarnSidebar.tsx ActiveBountyProjectsSection` (v0.7.71) — top 3 non-done bounty projects with RPM + clip count + Resume |
| Results page suppresses "no campaign attached" for Whop projects | ✅ | `ResultsGrid.tsx:255-263` — `!project.whop_bounty_id` gate around `CampaignContextStrip` |
| Sponsored campaigns visible in every auth state | ✅ | `EarnTab.tsx` mounts `<SponsoredBannerCarousel>` unconditionally |
| BountyDetail brief link (in-panel or external) | ✅ | `BountyDetail.tsx:72-119` honours `BROWSE_PANEL_ENABLED` flag with system-browser fallback |
| BountyDetail rewards summary (payout/spots/budget/views/paid) | ✅ | `BountyDetail.tsx:191-230` |
| Cache-only auth model (no passive Keychain) | ✅ | IG-014 invariant — `assert-no-passive-keychain.sh` clean since v0.7.58 |

## 2. What is broken or confusing today

### G-1 — BountyCard never says "Resume Project" even when one exists
`EarnTab.tsx:201-211` loads `bountyProjects` from `sidecar.listBountyProjects()` and uses them for the In-Progress sub-tab. But neither `AvailableSection` nor the `BountyCard` itself is told which bounties the user already has an active project for. So a clipper who started a bounty and went back to Available sees a `Start` button on the same card — and the App.tsx `onStartBounty` resume-don't-recreate handler then quietly routes them into Results, which is correct but feels like a black-box.

**Cost**: confusing UX; user can't tell which bounties they've already touched.

### G-2 — BountyDetail status HudChip is a dead button
`BountyDetail.tsx:61` renders `<HudChip active onClick={() => {}}>Live</HudChip>` — clickable, with no behaviour. Audit caught this in v0.7.70 ship-lens; never fixed.

**Cost**: every clipper reaches the detail page and clicks the Live chip out of curiosity, gets nothing.

### G-3 — SubmissionsSection promises tracking it can't deliver
`EarnTab.tsx SubmissionsSection` shows a "Refresh status" button that calls `getWhopSubmissionWithCachedSession(id)` for every locally-tracked submission ID. Whop's public API has no real status endpoint for clippers — the proxy returns the same record we already had. Users hit Refresh and see no change.

Worse, there is **no "Submit on Whop" CTA anywhere on the surface**. A clipper who finishes a project has to leave the app to find the brief URL again.

**Cost**: clippers think the app submits for them; it doesn't. Trust damage.

### G-4 — PayoutsView copy is technically honest but slightly ambiguous
The "Whop reward campaigns" / "Liquid Clips affiliate" cards are correct, but the headline `"Your money, one place."` reads like Liquid Clips holds the funds. Whop pays the user directly for Content Rewards; Liquid Clips only pays affiliate commissions via Stripe Connect.

**Cost**: low — first-time clippers might think they need to "withdraw from Liquid Clips."

### G-5 — EarnSidebar mixes Whop projects with manual saved briefs
v0.7.71 added `ActiveBountyProjectsSection` (top 3 non-done bounty projects) above the legacy `SavedBriefsRow`. Both look like they're in the same lane. SavedBriefs is a legacy local-only store (`briefs.json`); it's empty for every Whop-only clipper but still renders the section header "saved briefs".

**Cost**: section disambiguation; not a blocker.

### G-6 — No path back to a started bounty's Project from Earn
The Earn sidebar shows up to 3 recent bounty projects but doesn't expose a "See all in Projects" affordance. Clipper has to find the Projects nav item themselves.

**Cost**: one extra click; deferrable.

### G-7 — Leaderboard "Top" tab honesty
`Leaderboard.tsx` fetches `backend.leaderboardGet()`. Backend is wired (per `junior-backend/CLAUDE.md` says `/leaderboard/earnings` is the pending sprint #14a route). Locally this either succeeds or shows a preview fallback. Need to verify the fallback copy doesn't promise data it doesn't have.

**Cost**: low — already has fallback machinery.

## 3. Files involved

| Component | File | Reason |
|---|---|---|
| Available sub-tab | `desktop/src/components/earn/EarnTab.tsx` | Pass `startedBountyIds` set to AvailableSection; SubmissionsSection rewrite |
| Card | `desktop/src/components/earn/BountyCard.tsx` | Surface "Resume Project" label when started |
| Detail | `desktop/src/components/earn/BountyDetail.tsx` | Resume-when-started button; kill dead HudChip |
| Sidebar | `desktop/src/components/earn/EarnSidebar.tsx` | Section header relabel |
| Payouts | `desktop/src/components/earn/PayoutsView.tsx` | Copy tightening |
| Submissions tracker | `desktop/src/components/earn/TrackedSubmissions.tsx` | Read-only (no change) |
| Marker | `desktop/src/components/earn/EarnTab.tsx` | v0.7.76 |
| Version | `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` | Bump |

**Not touched (Kimi's lane)**: `desktop/src/components/projects/*`, `desktop/src/lib/projectMemberships.ts`, ProjectsTab/Detail/Card.

**Not touched (out of scope)**: backend Whop proxy, IG-014 auth model, account-app upgrade flow, social/channel auth.

## 4. Exact fixes (this turn)

### Fix EARN-1 — Resume-not-Start for started bounties
- `EarnTab.tsx`: compute `startedBountyIds = new Set(bountyProjects.filter(p => !p.done).map(p => p.whop_bounty_id))`. Pass to `AvailableSection`. Pass per-card `isStarted` to `BountyCard`.
- `BountyCard.tsx`: when `isStarted` truthy, `startLabel = "Resume Project"`, `startTitle = "Resume your existing project for this bounty"`. Overrides the `Unlock to start` lock-state label (a started bounty implies auth was ready at some point).
- `BountyDetail.tsx`: accept optional `isStarted` prop. Button label: `Resume Project →` when started; `Start clipping →` otherwise.
- App.tsx `onStartBounty` already resumes correctly — this just makes it visible.

### Fix EARN-2 — Dead HudChip → span
- `BountyDetail.tsx:58-64`: replace the `<HudChip active onClick={() => {}}>` with a static `<span>` carrying the same chrome. Status is a label, not an action.

### Fix EARN-3 — SubmissionsSection honest copy + Whop link
- Replace the "Refresh status" affordance with:
  - Top hint: `"Whop owns submission status. Submit on Whop, then track your post URL + status here."`
  - Primary CTA: `Open Whop submissions` → `openExternal("https://whop.com/dashboard/payouts")` (the Whop dashboard route where clippers see their own submissions)
  - Keep the existing `TrackedSubmissionsTable` (local tracker) — that one IS honest
  - Drop the "Refresh status" button entirely

### Fix EARN-4 — PayoutsView copy
- Headline `Your money, one place.` → `Your earnings, at a glance.`
- Add a one-line subtitle under it: `Whop pays direct for reward campaigns. Liquid Clips pays affiliate commissions via Stripe Connect.`
- No data-flow change.

### Fix EARN-5 — Sidebar section disambiguation
- `EarnSidebar.tsx`: SavedBriefsRow `headerLabel` `"saved briefs"` (already in v0.7.71) stays, but add a tiny clarifying subtitle `"manual"` next to it.
- Existing ActiveBountyProjectsSection already says `"your campaigns"` — leave alone.

### Fix EARN-6 — Build/install plumbing
- Bump 0.7.75 → 0.7.76, marker → v0.7.76, validate, build, install.

## 5. What waits

| Defer | Reason |
|---|---|
| `Doing` tab "View all in Projects" link | Kimi owns Projects nav routing; small follow-up after Earn closes |
| Leaderboard backend wiring confirmation | Already has fallback; checking the prod endpoint health is a separate ops task |
| Auto-import-source-from-Whop-attachments | v0.7.65 audit flagged Whop returns video attachments we don't use; bigger lift |
| Submit API path (Whop has no public submit) | Blocked on Whop product roadmap; manual link is honest today |
| Multi-attach UI for clip ↔ project | Lives in Projects, Kimi |

## 6. Final hand-walk checklist

(Validated after build + install of v0.7.76)

1. Cold launch — no Keychain prompt
2. Earn marker reads `v0.7.76`
3. Available tab loads public bounties without login
4. Each bounty card shows real data only (no fake fields when missing)
5. **A bounty you've already started shows `Resume Project` on its card AND in the detail page**, not `Start`
6. Clicking `Resume Project` lands in the project's Results view, no duplicate project
7. BountyDetail status chip (`Live / Coming Soon / Closed`) renders but is NOT clickable
8. BountyDetail brief link opens the Whop brief (panel or external)
9. SUB tab now reads `Submit on Whop, then track here` — has an `Open Whop submissions` link — local tracker table renders untouched
10. PAY tab subtitle clearly distinguishes Whop direct payout vs Liquid Clips affiliate
11. Sidebar `your campaigns` shows started bounty projects with `Resume`; `saved briefs · manual` clearly separates manual briefs
12. Earn Start on a fresh bounty creates a new project; Earn Start on a started bounty resumes (no duplicate)
13. No black screen
14. No Keychain prompt on tab switching
