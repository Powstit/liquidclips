# Whop Clipping Rewards · Honesty Pre-Build Correction

Pre-6N-E correction. Report-only. **No code until acknowledged.**

The 6N-E v1 implementation that just shipped assumed every Whop reward is readable via the existing `/whop/bounties/{id}` proxy. **That assumption is too generous.** Whop's "Clipping Rewards" / "Content Rewards" consumer product is not the same surface area as the `bounties` API resource. Some Clipping Rewards expose through `publicBounty` GraphQL; many do not. The honest v1 must accept a URL even when the API can't enrich it.

This report restates what's actually knowable from where we stand today (Whop App API Key only · no user-OAuth · no `bounty:create`) and proposes the minimum changes to 6N-E to defang the API-dependent assumptions.

---

## 1 · What Whop Clipping Rewards expose through API · proven

Two distinct Whop API surfaces that have been confused in the prior reports. Both surfaces touch Clipping Rewards, but neither is a complete read of the consumer feature.

### 1.a · Existing legacy proxy · `publicBounty` GraphQL via App API Key

Live in production at `junior-backend/app/routes/whop.py:393-452`. Comment at line 399 explicitly says "Return public Content Rewards bounties." Reads:

| Field | What we get | Caveats |
| --- | --- | --- |
| `id`, `title`, `description` | yes | description is short marketing copy · not the rich brief markdown the agency wrote |
| `baseUnitAmount`, `rewardPerUnitAmount`, `currency` | yes | per-action / per-1k-view payout |
| `allowYoutube/Tiktok/Instagram/X` | yes | platform whitelist flags |
| `acceptedSubmissionsLimit`, `acceptedSubmissionsCount`, `spotsRemaining` | yes | capacity counters |
| `bountyType` (`classic / user_funded / workforce`) | yes | implementation discriminator |
| `status` | yes | published / archived / etc. |
| `viewCount`, `totalPaid`, `budgetAmount` | yes | aggregate counters · agency-facing |
| `user { username, profilePicture.sourceUrl }` | yes | reward owner |
| `experience { id, name, logo.sourceUrl }` | yes | Whop community/org |
| `attachments[]` | yes but rare | per existing line 126: "rare in practice — most creators paste source URLs into the description instead" |
| `discussionPost.muxAssets[]` | partial · public Mux thumbnail URLs only | sufficient for a card thumbnail |
| `discussionPost.markdownContent` | **no** | richer brief body requires user-OAuth (line 124: "User does not have access to this feed") |
| `publicBountySubmission(id)` | yes for the few it returns | submission-level read · limited |

**Coverage:** publicly-discoverable Content Rewards bounties · clipper-facing. **Not coverage of:** private Clipping Rewards · Partner-only Campaign B · members-only rewards · most rich brief content.

### 1.b · New REST · `/api/v1/bounties` workforce surface

Per the OpenAPI spec pasted earlier:

- `POST /api/v1/bounties` (create) — requires `bounty:create` scope. We don't have it. Defers to Phase 6N-F.
- `GET /api/v1/bounties/{id}` (retrieve) — "Retrieves a workforce bounty for the **current authenticated user**." Requires bearer auth with bounty scope. **Cannot be called from the App API Key.**

The OpenAPI spec returns `total_available`, `total_paid`, `currency`, `bounty_type`, `vote_threshold`, `status`. Notably **the REST `Bounty` response does NOT include `allowYoutube/Tiktok/Instagram/X`** · the platform constraints visible on the legacy GraphQL surface are missing from the REST schema. So even if we had the scope, the REST surface is narrower for platform metadata than the GraphQL surface.

### 1.c · What's confirmed by reading the existing live backend

- `_normalize_bounty` flattens nested `user.profilePicture.sourceUrl` → `user.image` and derives a public Mux thumbnail URL if available. **Both adapters work today** for publicly-readable bounties.
- IP rate limiter + 60s cache + Partner Engine gate are intact.
- `_filter_partner_only` strips the $10 RPM Campaign B from non-Partners. **Partner gating is enforced server-side; non-Partners pasting a Partner-only Clipping Reward URL/id will hit a 404 today.**

### 1.d · What's NOT confirmed (assumed but unproven)

- **That every consumer Clipping Reward gets a `b_*` id surfaced through `publicBounty`.** Whop may serve some Clipping Rewards entirely inside its app UI without exposing them on the public GraphQL surface.
- **That the bnty_* REST shape and the b_* GraphQL shape are interchangeable.** They share some fields and lifecycle semantics, but the schemas are clearly different products: workforce-bounties (REST) and Content Rewards bounties (GraphQL). They overlap but are not aliased.
- **That `attachments[]` carries Drive/Dropbox links in real-world Clipping Rewards.** Existing comment says "rare in practice."
- **That `description` carries enough text to display as a brief.** Real Clipping Rewards probably link out to a longer brief or chat.

---

## 2 · What is URL-only

For Clipping Rewards specifically · until proven otherwise · assume the following are accessible **only by visiting Whop in a browser**:

- The full reward brief / rules / conditions
- Reward-specific hook copy and creative breakdown
- Reward funding model details (any non-flat tier · bonus rules · clawbacks)
- Approval / payout workflow (queue position · rejection reasons · payment status)
- Per-submission state (the clipper's own queue · their views · their pending payouts)
- Geographic / membership constraints
- The agency's brand guidance / safety rules
- Anti-fraud safeguards · watermarks · audience-quality bars

A Whop Clipping Reward URL may be the **only canonical handle** Liquid Clips can rely on. Anything we read via `publicBounty` is best-effort enrichment, not a contract.

---

## 3 · What must be manually mirrored into Liquid Clips

For the v1 brief surface to be useful when the API enrichment fails, the agency must be able to hand-enter the following inside Liquid Clips:

| Field | Why mirror | Source |
| --- | --- | --- |
| Campaign title | display-time control · sometimes the Whop reward title is internal-only or technical | Agency-written |
| Campaign description / brief | the API doesn't carry the rich brief markdown today | Agency-written (markdown-ish · plaintext) |
| Reward conditions in human words | "what counts as a qualifying clip" | Agency-written |
| Payout summary copy | "$3 per 1k verified views" or whatever the Whop tier is | Agency-written |
| Eligibility / geographic / age rules | inherits from Whop but display-text only | Agency-written |
| Platform list | inherited from `allowYoutube/Tiktok/...` when readable · otherwise agency picks | Agency-confirmed |
| Hashtags / mention requirements | not surfaced through API | Agency-written |
| Required brand guidance / safety rules | Whop-side hard rules · LC duplicates as display | Agency-written |
| Brief asset links (6N-D v1) | how clippers get the source material | Agency-pasted |
| Submission instructions | how the clipper hands the final post back into Whop | Agency-written |

The Whop reward URL itself is **always the source of truth for the actual rules.** What's in Liquid Clips is a faithful summary. The reward-page link is shown prominently so a clipper can always go check.

---

## 4 · Best v1 campaign flow using a Whop reward URL

The corrected flow · no API enrichment dependency · works even when `publicBounty` returns nothing:

```
1. Agency pastes Whop reward URL (or bnty_*/b_* id, optional)
   │
   ├─ Liquid Clips stores it as `whop_reward_url` (always)
   │  and `whop_reward_id` if a recognizable id pattern matched
   │
   └─ Liquid Clips attempts a best-effort enrichment via the existing
      `publicBounty` proxy:
        - success → snapshot stored, UI surfaces the few fields we got
        - 404 / unreachable / Partner-gated → row still saves, status
          stays "draft" / "pending_reward", UI surfaces "We can't read
          this reward from our side · the brief below is what clippers
          will follow"
       (validation NEVER blocks campaign creation in v1)

2. Agency fills the Liquid Clips brief manually:
     - Title
     - Description (markdown-ish · rich enough to host the rules verbatim)
     - Reward conditions (copy-paste from the Whop reward page is the
       expected flow · we even surface a sample template)
     - Payout summary copy (display-text only, not parsed)
     - Platform list (pre-checked from enrichment when available)
     - Brief asset links (6N-D v1 surface)
     - Discussion provider (Whop chat picker · existing 6L-B path)

3. Liquid Clips publishes the campaign:
     - Campaign-publish gate: requires whop_reward_url (any URL · not
       necessarily one we could enrich), title, description, brief
     - No API re-validation required to publish
     - Whop reward URL is just stored; no fake "live" attribution

4. Campaign page (clipper-facing) shows:
     - Reward banner (LC-owned art from the brand library)
     - Title + description + manual reward conditions
     - Brief asset links (6N-D v1)
     - "Open Whop reward" CTA · external link
     - "Submit in Whop" CTA · external link (initially the same as
       "Open Whop reward" until we have a deeper Whop link)
     - Optional small Whop snapshot card IF enrichment succeeded
       (otherwise hidden · no fake fields)

5. Clipper workflow:
     - Clipper must be a Whop user to join/submit/track payout · we
       don't pretend to handle any of that
     - Liquid Clips owns: building the clip, exporting, scheduling
     - Whop owns: receiving the submission, approving it, paying out

6. Liquid Clips does NOT:
     - Show a Whop-derived payout amount as if it were an LC commitment
     - Compute "spots remaining" or "funded %" unless enrichment is
       fresh and unambiguous · degrades to "see Whop" otherwise
     - Track per-clipper submission state unless Whop pushes it · today
       it doesn't
```

---

## 5 · What Liquid Clips should own

- The campaign shell · banner / brief / asset links / discussion provider / leaderboard / targeting
- The clipper experience inside the desktop app — Engine / Studio / Captions / Thumbnail / Schedule / Export
- The brief mirror of the Whop reward rules · written by the agency · displayed honestly
- The discovery surface · "find a campaign to clip for"
- The brief-link surface (6N-D v1 · live) · Drive / Dropbox / Whop / direct URL / upload-note rows
- The discussion mirror via Whop chat (6L-B · live)
- Existing leaderboard preview (6L-C · live) · driven by our own affiliate earnings cache, separate from Whop reward payouts
- Submission **affordances** · the "Submit in Whop" CTA is a deeplink, not a write-through
- Optional Whop snapshot card · only when enrichment succeeded

---

## 6 · What Whop should own

- The reward funding pool · what's actually paid out
- The reward eligibility logic · who can submit, geographic gates, account-age gates
- The submission queue · what's pending review
- The approval workflow · accept / reject / dispute
- The payout settlement · withdraw to bank, Stripe Connect, etc.
- The clipper's signed-in identity for reward purposes · Whop login
- Anti-fraud and content-quality enforcement
- The canonical brief copy and the rules of record · the Whop reward page is the source of truth even when Liquid Clips mirrors it for convenience
- All money flow · always · without exception

---

## 7 · What can wait until after the first 100 users

Honest deferrals · these don't block the launch:

- **Deep Whop submission sync** · we don't know what real Clipping Reward data looks like in practice yet · wait for evidence
- **Per-clipper payout state inside LC** · Whop's app UI is the source of truth · clipper can just open Whop
- **`bnty_*` ids via REST** · entirely Phase 6N-F · workforce-bounty REST is a different product surface; we shouldn't lean on it for Clipping Rewards
- **Automated reward conditions parsing** · today the agency types it · automation lands when there's a real signal that mirroring is painful
- **Cron 6h refresh of snapshot** · manual refresh button is enough at low volume · cron when we have campaigns whose UI accuracy degrades visibly
- **Featured / sponsored billing** · already plan §6 deferred
- **Native Liquid Clips discussion** · already 6N-F-or-later
- **In-app reward creation via OAuth** · 6N-F · genuinely optional · the deeplink-to-Whop path stays the default forever if that's what clippers prefer
- **Submission write-through (`POST /me/reward-clips` from campaign page)** · the reward-clip row is internal LC tracking and doesn't need to fire until the clipper actually wants to mint a tracking link
- **Snapshot fields on `<CampaignCard>` and `<CampaignBanner>`** · the existing mock fallback path is honest enough until enrichment is provably reliable
- **`whop_reward_snapshot` cron · staleness pill · Mux thumbnail extraction** · all polish

Defer aggressively. The first 100 users will tell us which of these matter.

---

## 8 · 6N-E implementation changes to avoid overpromising

The 6N-E v1 code that shipped IS overoptimistic in a few specific spots. Minimum changes to bring it honest:

### 8.a · Backend `agency_campaigns.py` changes

| Change | Where | Why |
| --- | --- | --- |
| `POST /agency/campaigns` accepts `whop_reward_url` (free-text URL) in addition to `whop_reward_id` | route + Pydantic model | URL-only flow is the v1 default; the row should store the URL regardless of whether we extracted an id |
| Make `_validate_via_proxy` truly optional · failure should never block creation | `create_campaign` + `connect_reward` | "We tried, we didn't get a snapshot, the row still saves" must be the behaviour |
| `publish_campaign` 3-gate check · weaken the reward-validation gate · accept "URL set, validation tried, row marked `pending_reward` if enrichment failed" | `publish_campaign` | Campaign can publish without enrichment as long as the agency has the brief written |
| Treat `pending_reward` as a publishable state for `campaign_type = clip` rewards when enrichment fails | publish path | Honest about not being able to verify · agency takes responsibility for the URL being right |
| Add `whop_reward_snapshot_status` column · `enriched / not_enriched / unreachable` | schema delta + model | Separate "we tried but couldn't enrich" from "we never tried" · UI uses this to render the right empty state |

### 8.b · Frontend changes

| Change | Where | Why |
| --- | --- | --- |
| `<StepConnectReward>` accepts a bare URL even when no id is extracted · "Use this URL anyway" CTA | `agency-creation/steps.tsx` | URL is the source of truth · always accept it |
| `<WhopRewardCard>` "unreachable" state copy must be reframed · not a failure, just no enrichment | `agency-creation/WhopRewardCard.tsx` | The card is a bonus, not a requirement |
| Step 2 (Title/Description) gains a **"Mirror the Whop reward rules"** subsection with a template paste · markdown allowed | `agency-creation/steps.tsx` | Surfaces the manual-mirror expectation in the flow itself |
| Step 2 ALSO surfaces a "Open Whop reward to copy the rules" link button when the URL is set | `agency-creation/steps.tsx` | Reduces friction for the manual mirror |
| Campaign page (`<CampaignPageShell>` section work in 6N-G) needs two prominent CTAs · "Open Whop reward" + "Submit in Whop" · both fire `bus.emit("browse:open", { mirror: "whop" })` | future 6N-G | clipper-facing call-to-action · honest |
| Remove `bnty_*` first-class handling in the regex extractor · the prior 6N-E commit treats `bnty_*` as REST-readable · it isn't (private to authenticated user) | `agency-campaigns.py` + sidecar regex | Stop suggesting we can read REST workforce bounties when we can't |
| Toast / pill copy review · everywhere we say "live" or "funded" from snapshot data, add a "via Whop snapshot" qualifier so the user knows it's read-through, not LC-attested | `WhopRewardCard.tsx` + future card surfaces | No fake attribution |
| Remove the `useWhopReward.validating` blocking state on Step 1's Validate button · don't make the agency wait for an enrichment that might never succeed | `useWhopReward.ts` + `<StepConnectReward>` | Don't pretend the validate call is the gate |
| Surface "Whop reward URL · always opens externally" everywhere the URL appears · make it visually obvious this is an external link, not LC content | UI polish | Source-of-truth display rule |

### 8.c · What does NOT need to change

- The 6N-D v1 brief-link backend + UI · those are LC-owned and unaffected
- The `agencyCampaigns.{create,patch,connectReward,publish,refreshReward}` sidecar shim · only the internal behaviours behind the endpoints change, not the contract
- The 8-step flow structure · just the copy and gate semantics inside the steps
- The clipboard-copy button on reward id · still useful
- The PASTE button on Step 1 input · still useful
- The "Open Whop ↗" Option B button · still correct framing per the prior brief

### 8.d · A new column the v1 schema is missing

Add `whop_reward_snapshot_status` to `sponsored_campaigns`:

| Value | Meaning |
| --- | --- |
| `not_attempted` | URL set but we haven't tried to enrich yet (never written today) |
| `enriched` | publicBounty returned a usable snapshot |
| `not_enriched` | publicBounty returned 404 / not_visible / Partner-gated (deliberate read failure) |
| `unreachable` | publicBounty returned 5xx / network error (transient) |

This separates "URL is verified usable" from "we can't read it but the agency says it's good". The campaign-status enum stays the same.

---

## 9 · Recommendation

Before any more 6N-E code lands · acknowledge this correction · apply the 8.a / 8.b / 8.d changes as a single follow-up patch. Estimated size: ~150 LOC delta, no new files.

After that, ship 6N-E v1 with the URL-only path as the default and enrichment as optional polish. Move to Phase 6N-G (campaign page · discovery card snapshot reads) only after the first agency campaigns are live with URL-paste + manual brief mirror.

**Phase 6N-F (Whop agency OAuth + `bounty:create`) becomes lower priority** under this correction · creating bounties in-app is an even further leap if we don't yet trust that we can read Clipping Rewards consistently.

**No 6N-E follow-up code until this correction is acknowledged.**
