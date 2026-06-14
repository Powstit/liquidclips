# Earn Customer Experience Architecture

Date: 2026-06-14
Scope: forward-looking design — what to wire next so the v0.7.70 Earn surface stops feeling like a "bounty browser" and starts feeling like a workstation. Read-only audit of current code; no UI rewrite proposed.

---

## Current state (1-page summary)

**Wired end-to-end:**
- Public discovery — `EarnTab.tsx:171-188` → `whopBounties.ts:37` → `/whop/bounties/public` (`whop.py:356-388`). 60s cache, no auth, IP rate-limited.
- Personal/Partner layer when JWT cached, deduped over public (`EarnTab.tsx:214-316`).
- BountyDetail drill-in (`BountyDetail.tsx`) — title, description, payout, spots, budget, views, totalPaid, platforms, thumbnail, status chip.
- Inline Start gate (`EarnTab.tsx:248-257`) routes to activation when locked, otherwise to `bounty-setup`.
- BountySourceSetup (`BountySourceSetup.tsx`) — detected URLs from `description`, paste, or local file pick; brief stays pinned.
- Project creation with bounty linkage — `App.tsx:1331-1361` builds `BountyContext`; persists `whop_bounty_*` fields (`project.py:506-517`, `:564-573`).
- Resume — `sidecar.listBountyProjects()` (`sidecar.py:798-838`) filters `~/LiquidClips/projects/*/project.json` by `whop_bounty_id`; `getProject(slug)` opens Results.
- BountyWorkspaceHeader pinned on Results (`ResultsGrid.tsx:251`) — payout, platforms, source, clips-ready, avg/best fit, next-step CTA.
- Submission capture (`BountySubmissionCapture.tsx:108-120`) — paste `sub_…`, persist per-project + mirror to `junior:my-whop-submissions:v1`.
- Submissions refresh poll (`EarnTab.tsx:712-734`) via `getWhopSubmissionWithCachedSession`.
- Manual fallback — `ManualBountyPrompt.tsx` synthesises a `WhopBounty` (`App.tsx:1659-1687`).

**UI-only / fake / blocked:**
- `SavedBriefs.tsx` "Your Campaigns" + `submissions.ts` + `briefs.ts` live in a **separate world** from the WhopBounty path (`$APPDATA/briefs.json`, `$APPDATA/submissions.json`). No code seeds a `CampaignBrief` from a `WhopBounty` Start click. Empty by default for every Whop-only user.
- `CampaignContextStrip.tsx` reads only `useActiveBrief`, never the project's `whop_bounty_id`. On a bounty project it says "no campaign attached" while BountyWorkspaceHeader says "clipping for Whop reward" — two truths.
- `ClipSubmission` rows have `brief_id` (`submissions.ts:25`) but never `whop_bounty_id`. `BountySubmissionCapture.save()` does NOT call `createSubmission()` — the unified table stays empty unless the user manually logs a post.
- EarnSidebar "Your clips" + "Your campaigns" rails are driven by the orphan stores — empty placeholders forever for a Whop-only user.
- `Project.create` disambiguates by source filename (`project.py:543-547`), not by `whop_bounty_id`. Clicking Start on a bounty you've already started silently creates a duplicate project.
- `attachments` queried in `_LIST_BOUNTIES` (`whop.py:159`) and richer attachments + `optimizedUrl`/`byteSizeV2`/`aspectRatio`/`duration`/`width`/`height`/`blurhash` in `_BOUNTY_DETAIL` (`whop.py:189-200`) are normalised but never rendered.
- `whop_bounty_spots_remaining` / `whop_bounty_creator` / `whop_bounty_url` go stale after creation — never re-fetched.

**Whop data pulled and thrown away:** the entire `attachments` graph. A bounty with a VideoAttachment already has a directly-clippable source on the wire; we never offer it.

---

## Ideal state (the target)

11 steps Daniel wants the user to feel:

1. Open Earn → see live bounties immediately (no auth).
2. Click bounty → understand the brief, payout, rules, source video, deadline, spots.
3. Click Start → if not signed in, one-tap unlock; if signed in, attach this bounty as a real Campaign in one click.
4. Pick source — prefer the brand's own VideoAttachment > detected URL > paste/upload.
5. Pipeline runs against the bounty source — clips inherit the bounty as their Campaign.
6. Results screen shows: this Campaign's pinned context + clip-fit scores + best clip flagged.
7. Polish, export, publish — each clip's submission row appears in the unified "Your clips" table tagged with the Campaign.
8. After posting on a social platform, paste post URL → status flips to `posted`.
9. After submitting on Whop, paste sub_… → status flips to `submitted`, Whop refresh polls real status.
10. Returning user opens Earn → "Your Campaigns" rail shows their started campaigns (3 in progress, 1 paid, etc.) BEFORE the public discovery grid.
11. Payouts roll up by Campaign — "$74 from BrysonTiller, $12 from PodcastA" — not by raw bounty id.

The whole story is one entity moving through one pipeline: **Campaign**. Today there are two parallel entities (WhopBounty and CampaignBrief) that never meet.

---

## Best customer journey (concrete, step by step)

| Step | What happens | File:line | State |
|---|---|---|---|
| 1 | Land on Earn → public grid renders skeleton then bounties | `EarnTab.tsx:170-188`, `whop.py:356-388` | ✅ wired |
| 2 | Click bounty → BountyDetail shows title, brief, eligibility, payout, spots, platforms, thumbnail, status chip | `BountyDetail.tsx:46-256` | ✅ wired (description shown, attachments NOT shown ⚠️) |
| 3 | Click Start (locked) → activation deep link | `EarnTab.tsx:248-257`, `activation.ts` | ✅ wired |
| 3a | Click Start (ready) → bounty-setup view | `App.tsx:1640-1645`, `:1693-1709` | ✅ wired |
| 3b | **MISSING**: check if a project already exists for this `whop_bounty_id`; if so, resume instead of re-creating | — | ❌ missing |
| 4 | Detected URLs scanned from `bounty.description` | `BountySourceSetup.tsx:28-30`, `sourceParser.ts` | ✅ wired |
| 4a | **MISSING**: a VideoAttachment on the bounty (sourceUrl/optimizedUrl) is never offered as a one-click source | `BountySourceSetup.tsx`, `whop.py:189-200` | ❌ missing |
| 5 | Pick source → pipeline runs with `BountyContext` | `App.tsx:1331-1361`, `sidecar.py:358-373`, `project.py:522-576` | ✅ wired |
| 6 | Results page: BountyWorkspaceHeader + per-clip fit chips | `ResultsGrid.tsx:251`, `BountyWorkspaceHeader.tsx:13-176`, `bounty-fit.tsx` | ✅ wired |
| 6a | CampaignContextStrip says "no campaign attached" on the same page | `ResultsGrid.tsx:256`, `CampaignContextStrip.tsx:80-113` | ⚠️ partial — two-truths conflict |
| 7 | Polish → export → publish via PublishModal | (out of scope here) | ✅ wired |
| 8 | Log a post URL — TrackedSubmissions form, no Campaign linkage | `TrackedSubmissions.tsx`, `submissions.ts:96-109` | ⚠️ partial — `brief_id` only, no `whop_bounty_id` |
| 9 | Paste Whop sub_… → BountySubmissionCapture stores per-project + into refresh-poll list | `BountySubmissionCapture.tsx:108-120`, `EarnTab.tsx:894-907` | ✅ wired (but does NOT create a row in `submissions.ts`) |
| 10 | Returning user — "In progress" sub-tab shows started bounty projects | `EarnTab.tsx:191-198`, `:638-693`, `sidecar.py:798-838` | ✅ wired |
| 10a | Returning user — "Your Campaigns" rail (briefs) — empty unless they manually built a CampaignBrief | `EarnSidebar.tsx:41`, `SavedBriefs.tsx` | ⚠️ UI-only for the Whop flow |
| 11 | Payouts roll up | `PayoutsView.tsx`, `payoutsAggregations.ts` | (separate audit) |

---

## Data model proposal

Current entities:

| Entity | Where | Shape |
|---|---|---|
| `WhopBounty` | Remote proxy `whop.py:226-262` | Whop truth, read-only |
| `BountyContext` | Pipeline input `sidecar.ts:584-595` | Compact subset to persist |
| `Project` | `~/LiquidClips/projects/<slug>/project.json` `project.py:489-517` | Carries `whop_bounty_*` |
| `BountyProjectSummary` | RPC `sidecar.ts:599-610` | Derived view |
| `CampaignBrief` | `$APPDATA/briefs.json` `briefs.ts:32-47` | Manual, user-curated |
| `ClipSubmission` | `$APPDATA/submissions.json` `submissions.ts:24-37` | `brief_id` only |
| `Clip` | inside `project.json` `sidecar.ts:471-528` | No campaign FK |
| `submissionIds[]` localStorage `junior:my-whop-submissions:v1` | `sub_…` strings |

**Recommendation:** unify on the **Project as the Campaign source-of-truth**. It already persists, already carries the WhopBounty fields, already has a list-RPC, and lives next to the clips. Then:

- Re-point "Your Campaigns" (`EarnSidebar.tsx:41`) to render `BountyProjectSummary` from `sidecar.listBountyProjects()`. CampaignBrief stays the fallback store for non-Whop briefs (Clipify/Klipy/manual).
- Add optional `whop_bounty_id?: string | null` to `ClipSubmission` so the unified table can show bounty title + payout without joining through a brief.
- Have `BountySubmissionCapture.save()` also call `createSubmission({ brief_id: null, whop_bounty_id, platform: "other", post_url: "", status: "submitted", notes: \`whop:\${id}\` })` so every Whop submission shows up in the table.

**Why not SQLite/backend:** Whop is the truth for bounty metadata + payout. Desktop only needs to remember which campaigns are active and what clips/submissions attach. Project.json + submissions.json on disk is enough. Migration costs > 200 lines for no UX win.

**Why not sidecar state:** lost on restart; Project.json already persists.

---

## Files involved

| Concern | File | Role |
|---|---|---|
| Discovery (public) | `desktop/src/lib/whopBounties.ts:37`, `junior-backend/app/routes/whop.py:356` | Bounty grid feed |
| Drill-in | `desktop/src/components/earn/BountyDetail.tsx` | Single-bounty card |
| Start gate | `desktop/src/components/earn/EarnTab.tsx:248-257`, `desktop/src/lib/activation.ts` | Auth-or-route |
| Source pick | `desktop/src/components/earn/BountySourceSetup.tsx` | URL/paste/upload |
| Project creation | `desktop/src/App.tsx:1331-1361`, `desktop/python-sidecar/sidecar.py:358-373`, `desktop/python-sidecar/project.py:522-576` | Persist BountyContext |
| Resume | `desktop/python-sidecar/sidecar.py:798-838` | List bounty-linked projects |
| Workspace pinning | `desktop/src/components/earn/BountyWorkspaceHeader.tsx`, `desktop/src/components/ResultsGrid.tsx:251` | Bounty header on Results |
| Submission capture | `desktop/src/components/earn/BountySubmissionCapture.tsx` | Paste sub_… |
| Submission refresh | `desktop/src/components/earn/EarnTab.tsx:712-734` | Poll Whop for status |
| Tracked submissions | `desktop/src/lib/submissions.ts`, `desktop/src/components/earn/TrackedSubmissions.tsx` | Local table |
| Saved briefs (legacy) | `desktop/src/lib/briefs.ts`, `desktop/src/components/earn/SavedBriefs.tsx`, `desktop/src/components/earn/CampaignContextStrip.tsx` | Manual brief store |

---

## Minimal implementation plan (smallest-first, each shippable)

**1. Re-point "Your Campaigns" rail to bounty projects (≈40 lines, no schema change)**
In `EarnSidebar.tsx:41`, replace `<SavedBriefsRow compact limit={5} />` with a new `<BountyProjectsRow compact limit={5} />` that consumes `sidecar.listBountyProjects()` (already wired in EarnTab). Reuse the existing compact card style. Result: returning users see their started bounties on the right rail, not an empty placeholder. Keep `SavedBriefsRow` reachable for non-Whop briefs via a "Manual briefs" expander.

**2. Resume-don't-recreate on Start click (≈25 lines)**
In `EarnTab.tsx onCardStart` (`:248-257`), before calling `onStartBounty(bounty)`, check `bountyProjects.find(p => p.whop_bounty_id === bounty.id)`. If found, call `onResumeProject(p.slug)` instead. Result: clicking Start on a bounty you've worked on lands you in your existing project, not a duplicate folder.

**3. Wire BountySubmissionCapture into the unified submissions table (≈20 lines)**
In `BountySubmissionCapture.save()` (`:108-120`), after `rememberSubmissionId(id)`, also call `createSubmission({ brief_id: null, clip_path: "", platform: "other", post_url: "", status: "submitted", views: 0, estimated_payout: "", actual_payout: "", notes: \`whop:\${id}\` })`. Add a `whop_bounty_id` field to `ClipSubmission` (1-field migration, optional). Result: "Your clips" table now reflects every Whop submission a user has made, not only manually-logged ones.

**4. Render bounty VideoAttachments as a primary source choice (≈30 lines)**
In `BountySourceSetup.tsx` "Detected in the brief" block (`:137-189`), prepend a "From the brand" section that reads `bounty.attachments` (need to expose this on `WhopBounty` type at `sidecar.ts:1596` and pass through `_normalize_bounty` at `whop.py:226` — both already query the data). Each VideoAttachment with `sourceUrl` becomes a one-click source. Result: bounties with attached source video skip the brief-link hunt entirely.

**5. Replace CampaignContextStrip on bounty projects (≈10 lines)**
In `ResultsGrid.tsx:256`, guard `<CampaignContextStrip />` with `!project.whop_bounty_id`. The BountyWorkspaceHeader already owns the bounty case. Result: no more "no campaign attached" line on a bounty project that obviously has a campaign attached.

**6. Surface "started" badge on BountyCard (≈15 lines)**
In `BountyCard.tsx`, accept a `startedProjectSlug?: string` prop. When set, the card's primary CTA becomes `"Resume →"` not `"Start"`. EarnTab passes the matched slug from its `bountyProjects` state. Result: at a glance, the user sees which bounties they're already on.

Total: ≈140 lines, no UI rewrite, no new components, no new backend routes, no schema migration beyond one optional submissions.json field.

---

## What MUST be fixed before commit

- Step 1 (sidebar rail) and Step 5 (kill conflicting CampaignContextStrip on bounty projects). These are the two places where the surface lies to a Whop-only user and silently calls the public-bounty experience "empty."
- Step 2 (resume-don't-recreate). Without this, every restart-and-click on the same bounty makes a new project folder, polluting Library and `list_bounty_projects` output.

---

## What can wait until v0.7.71

- Step 3 (submissions table wiring) — needs a 1-field optional schema bump; safe to ship in next patch.
- Step 4 (bounty attachments as source) — requires plumbing through `WhopBounty` type + `_normalize_bounty`. Real win but needs a short type pass.
- Step 6 (resume badge on card) — depends on Step 2 to be meaningful.
- Refresh stale `whop_bounty_spots_remaining` / `whop_bounty_creator` on project load by re-fetching the bounty (would need detail RPC + a stale-after threshold) — defer; not a blocker.
- Migrate briefs.ts entirely to a "manual / non-Whop campaigns" store — defer until the bounty-project path proves out.

---

## What should NOT be touched

- Public bounty browsing — `EarnTab.tsx` Available section + `whop.py /bounties/public`. Works, fast, rate-limited, IG-014 invariant preserved.
- Backend public bounty route + normalization — `whop.py:_LIST_BOUNTIES`, `_normalize_bounty`. Already produces the thumbnail + flattened user shape.
- EarnIconRail icons — already mapped (IG-005 region).
- Brand tokens — IG-012.
- Auth gating model — IG-004; inline "Unlock to start" copy works for the action surface today.
- BountyWorkspaceHeader + bounty-fit scoring — the workstation pin is fine; the fix is making "Your Campaigns" + submissions speak the same bounty language, not replacing the header.
- Manual fallback (`ManualBountyPrompt`) — leave as-is; synthesised WhopBounty path is the proven escape hatch.
