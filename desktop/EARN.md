# Junior Earn — v0.4 spec

Snapshot: 2026-05-23 · target ship: v0.4.0

## What this is

A new top-level mode in Junior that lets clippers discover live Whop Content
Rewards campaigns ("bounties" in Whop's API), clip them in Junior's editing
pipeline, publish to YT/TT/IG via Postiz, then submit to Whop with minimum
friction. Read-side integration only until Whop opens the submission mutation
API; submission itself is a one-paste step via deep link until then.

## The strategic positioning

Junior stops being software you subscribe to and becomes the tool that pays
for itself with the first approved clip. Whop owns the marketplace +
payouts + auto-approval. Junior owns the editing workstation + rule-check
intelligence + submission preparation.

## Customer journey

```
Clipper opens Junior → Earn tab
   ↓ (first-time) Sign in with Whop → OAuth → token stored in OS keychain
   ↓
Earn / Available — live bounty cards matching connected platforms
   ↓ pick a bounty
Earn / Detail — Source · Rules · Money columns + Start clipping
   ↓
Workspace (with pinned bounty banner) — pipeline runs, clip grid renders
   ↓ each clip card now shows: Virality · Bounty fit · Rule check N/M
   ↓
Publish & prepare Whop submission → Postiz posts to YT/TT/IG
   ↓ posted URL copied · Whop submission page opens
Background poller hits publicBountySubmission(id) every 10 min
   ↓ status change → Inbox notification (bounty category)
Earn / Submitted → Approved → Earnings tally
```

## Information Architecture

```
[ Logo ]   Workspace   Earn • 24   [ history ] [ queue ] [ inbox ] [ settings ]

Workspace                                       (unchanged — create flow)
Earn (Whop-gated, isolated)
  Splash:    "Sign in with Whop" (no session)
  Tabs:      Available · In progress · Submitted · Approved · Earnings
  Detail:    Source / Rules / Money columns
  Workspace surface with pinned bounty banner when project.whop_bounty_id is set
History                                          (small top-right link)
Queue · Inbox · Settings                         (unchanged)
```

Tab name is **"Earn"** (lowercase mono in nav). The badge `• 24` = open
bounties matching the user's connected platforms.

## Top-level guarantees

- Whop session never touches Workspace flow.
- `project.whop_bounty_id` stays null for non-bounty projects.
- Bounty inbox category only renders when Whop session exists.
- A user who never opens Earn never sees Whop branding anywhere.

## The three questions every screen answers

Each card / detail view must let a clipper decide:

1. **Can I earn from this?** → £/1k views · spots left · budget remaining
2. **Can I finish it fast?** → Effort (low / medium / high) · source duration
3. **Will it get approved?** → Approval risk (low / medium / high) · rule-check pre-flight

These three scores are the meta-feature that beats Whop's native UI.

## Whop GraphQL — what we use

Endpoint: `https://api.whop.com/public-graphql`
Auth: per-user `pos_*`-style token (Whop OAuth 2.1 + PKCE); fallback to
Daniel's seller key for dev / demo.

### Queries (verified against live schema 2026-05-23)

#### `publicBounties(filter, after, before, first, last) → PublicBountyConnection`
List active campaigns. Filterable. Use to populate Earn / Available.

#### `publicBounty(id: ID!) → PublicBounty`
Get one campaign's full detail. Fields used:
- `id, title, description`
- `baseUnitAmount, rewardPerUnitAmount, currency`
- `allowYoutube, allowTiktok, allowInstagram, allowX`
- `acceptedSubmissionsLimit, acceptedSubmissionsCount, spotsRemaining`
- `bountyType, status, discoverStatus`
- `experience` — has the source video URL
- `user` — creator profile (name, avatar)
- `viewCount, totalPaid, budgetAmount`
- `createdAt, updatedAt`

#### `publicBountySubmission(id: ID!) → PublicBountySubmission`
Poll a submission's status. Fields used:
- `id, status` — `pending | claimed | submitted | approved | denied | expired | unclaimed`
- `submittedAt, claimedAt, expiresAt`
- `formattedPayoutAmount, denialReason`
- `verifiedVotesCount, rejectedVotesCount`

### NOT used (no mutation)
- ❌ `createBountySubmission` — does not exist in public schema. Submission
  still requires the clipper to paste the posted URL into Whop's UI. Junior
  pre-fills the URL on the clipboard + deep-links to the submission page.
- Pursued via Whop partnership conversation (separate track).

## Sidecar methods (Python)

```python
# python-sidecar/sidecar.py
METHODS = {
  ...,
  "whop_list_bounties":  method_whop_list_bounties,   # filter? + connected platforms
  "whop_bounty":         method_whop_bounty,          # (id)
  "whop_submission":     method_whop_submission,      # (id)
  "whop_login_start":    method_whop_login_start,     # returns OAuth consent URL
  "whop_login_callback": method_whop_login_callback,  # exchanges code → token
  "whop_logout":         method_whop_logout,          # clears keychain entry
  "whop_session_status": method_whop_session_status,  # returns active/inactive + user
  ...
}
```

Whop tokens stored as a new secret in OS keychain: `JUNIOR_WHOP_TOKEN`.

## Frontend components (new)

```
src/components/earn/
  EarnTab.tsx              top-level surface, manages tab state
  EarnSignInSplash.tsx     pre-OAuth state
  BountyCard.tsx           one card in the Available list
  BountyFilters.tsx        platforms · sort · open-only
  BountyDetail.tsx         3-column Source/Rules/Money view
  BountyBanner.tsx         pinned chrome on Workspace when project has bounty_id
  RuleCheck.tsx            per-clip rule check ✓✗ breakdown
  EarnSubmittedList.tsx    submitted tab — status + check time
  EarnApprovedList.tsx     approved tab — earnings tally
  PrepareSubmissionFlow.tsx publish + clipboard + deep-link Whop
```

```
src/lib/
  whop.ts                  client wrappers around sidecar's whop_* methods
```

## Mock-sidecar fixtures (web preview)

For app.jnremployee.com, the mock-sidecar layer returns:
- 6-8 sample bounties with realistic shapes
- 2-3 active submissions in various statuses
- Simulated Whop OAuth handshake (returns instantly with `mock-whop-token`)
- Status auto-advances after timer (pending → claimed → submitted → approved)
  so the polling notification fires naturally during demo

## Per-clip rule check (the differentiating feature)

When a project has `whop_bounty_id`, the LLM stage receives the bounty's
rules + brief alongside the transcript and scores each clip on:

```
{
  rule_check: {
    length_ok: bool,             # within bounty's required range
    has_subtitles: bool,         # if subtitles required
    has_required_cta: bool,      # if a CTA is mandated
    no_banned_content: bool,     # if banned topics list applies
    platform_fit: bool,          # is this an allowed platform
    opening_hook_strong: bool    # qualitative
  },
  bounty_fit: int,               # 0-100 overall
  approval_risk: "low"|"med"|"high",
  effort: "low"|"med"|"high",
  rule_check_explanation: str    # one-line summary for the expand view
}
```

This adds one new field to the LLM prompt (the bounty rules), one new
extension to ClipBundle, and one new section in the clip card UI.

## Background submission poller

Runs in `python-sidecar` as an async task started on first Whop session
load. Every 10 min:
1. List all submissions in `claimed | submitted` status
2. Hit `publicBountySubmission(id)` for each
3. On status change, write a notification via `emit_event` so the desktop
   sees it via the existing inbox channel
4. Update the local store of submission statuses

## Inbox category

```python
NOTIFICATION_CATEGORIES = (
  "system_update",
  "post_published",
  "post_failed",
  "drip_summary",
  "quota_warning",
  "billing",
  "affiliate",
  "founder",
  "junior_message",
  "pipeline_event",
  "bounty",   # ← new
)
```

Sample bodies:
- "New bounty matching your platforms: @magnet's podcast clip job · £8.50/1k"
- "Submission approved · est. £42 earned"
- "Submission denied — reason: missing CTA"
- "Bounty closing soon: 2 spots left on @creator2's campaign"

## Privacy / messaging

Customer-facing copy:
> *"Whop tracks bounty payouts. Junior helps you make, publish, and prepare submissions."*

Never pre-disclose take-rate strategy. Disclose only at the moment it
becomes real (post mutation-access, at first submission, one-time onboard).

## Tier positioning

Free tier on Earn. Clippers earning generate Junior revenue via the future
take-rate. Don't paywall the door. Workspace stays tier-gated as today.

## Effort estimate (recap)

| Component | Effort |
|---|---|
| Whop GraphQL client + OAuth + keychain | 1.5 hr |
| `whop_list_bounties` / `whop_bounty` / `whop_submission` sidecar methods | 1 hr |
| Earn tab UI (4 sub-tabs + bounty cards + detail view) | 3 hr |
| Bounty-aware project linkage + workspace banner | 1 hr |
| Per-clip rule-check (LLM prompt extension + UI) | 2 hr |
| Background poller + bounty inbox category | 1 hr |
| Publish & prepare submission flow + deep-link + clipboard | 1 hr |
| Mock-sidecar fixtures for web preview | 1 hr |
| **Total** | **~11.5 hr** |

## Open questions for Daniel before any code

1. **OAuth scope** — Whop OAuth needs scopes. The seller-account API key
   already has 14 scopes. Need to confirm with Whop which scopes a CLIPPER
   (not creator) needs to read their own bounty submissions. Likely
   `bounty:read submission:read user:read`.
2. **Whop iframe?** — Should Junior also be installable as a Whop iframe
   app, or only as a desktop binary? Iframe = lower friction for Whop
   community members; binary = full editing power. Suggest: ship desktop
   first; add iframe-companion later.
3. **What about Workspace projects unrelated to bounties?** — Confirm: they
   stay completely unchanged. Earn is additive, not a rewrite of Workspace.

## Sources

- Whop Content Rewards docs: https://docs.whop.com/memberships-and-access/third-party-apps/content-rewards
- Whop GraphQL: https://docs.whop.com/developer/api/getting-started
- Live schema introspected via WHOP_API_KEY on 2026-05-23
