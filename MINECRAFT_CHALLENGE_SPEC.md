# Minecraft Story Clip Challenge — Whop Campaign Spec

**Status:** Draft v1 — ready for Daniel to create in Whop admin
**Owner:** Daniel (founder, Liquid Clips / Liquid Lift / Uncle Daniel YouTube)
**Drafted by:** Claude (Opus 4.7) — 2026-06-01

This is the spec Daniel pastes into Whop's content rewards campaign admin to launch the first Liquid Clips wrapped campaign. Once live, the desktop app + marketing site integrate against the resulting Whop campaign ID.

---

## 1. Campaign overview

| Field | Value |
|---|---|
| **Campaign name** | Minecraft Story Clip Challenge |
| **Tagline** | Get paid to clip the moments Minecraft stories turn |
| **Host** | Liquid Clips (community + reward layer) |
| **Tool** | Liquid Lift (clipping desktop app) |
| **Platform** | TikTok primary · Instagram Reels secondary · YouTube Shorts tertiary |
| **Campaign type** | Wrapped (Liquid Clips fund + brief; Whop handles payouts) |
| **Test window** | 4 weeks (rolling) |
| **Status at launch** | Open to all Liquid Lift users 18+ |

---

## 2. Strategic thesis (for internal reference — not on Whop public page)

Minecraft viewers already train the clipping eye every time they watch a 1-hour SMP civil-war video and instinctively know which 30 seconds will go viral. This campaign converts that latent skill into clipping behavior, then funnels the best of them into paid Liquid Lift users + the Liquid Clips operator community.

The watermark is the conversion engine — free-trial exports carry an ugly mark, and submissions REQUIRE clean exports. The product limitation IS the upgrade trigger, applied after sunk-cost emotional investment.

This is the **acquisition wedge** for Uncle Daniel's doctrine layer. Liquid Clips is not pitching business education — it's pitching "prove you can spot the moment." Education happens inside the community after they're in.

---

## 3. Reward economics

**Per-accepted-clip:** £0.50 (base) — flat fee, not view-based, paid weekly via Whop.

**Daily best clip:** £25 — selected by Liquid Clips moderation team, posted publicly on the leaderboard.

**Weekly winner ("Story Eye of the Week"):** £100 — top clipper of the week + featured in Uncle Daniel content + unlocks Tier 2 access (higher-paying non-Minecraft campaigns).

**Tier 2 unlock threshold** (auto, no manual review needed once metrics met):
- 5 accepted clips
- 0 rejected for rule violations
- At least 1 clip with >10k views on the clipper's submission

**Test budget (first 4 weeks):**

| Line | Estimate | Notes |
|---|---|---|
| Per-clip accepted (200 clips × £0.50) | £100 | Assumes ~50 accepted/week × 4 weeks |
| Daily best (28 days × £25) | £700 | One pick per day |
| Weekly winner (4 × £100) | £400 | One per week |
| **TOTAL test budget** | **£1,200** | Capped — if exhausted early, pause refills |

**Why these numbers work:**
- £0.50 is high enough to feel "real" for casual clippers but low enough that Liquid Clips MRR can fund it from a single Pro upgrade per ~150 accepted clips
- £25 daily makes the leaderboard worth grinding for
- £100 weekly is the visible flagship prize — Uncle Daniel can name the winner on the channel, generating social proof + new entries
- Total £1,200/4-weeks = £300/week. Break-even at 4 new Solo subscribers/week or 1 new Pro subscriber/week. Conservative.

**If campaign performs:** scale to £2,000/week. If it doesn't (CPM > £6 cost per acquired Liquid Lift trial), pause and re-spec.

---

## 4. Eligibility

| Requirement | Detail |
|---|---|
| **Age** | 18+ (paid rewards — non-negotiable for UK/EU/US tax compliance) |
| **Geo** | Open globally; payouts via Whop's existing rails (Stripe Connect / Whop Wallet) |
| **Account** | Liquid Lift desktop installed + 7-day trial active OR paid Liquid Lift subscription |
| **Identity** | Active TikTok/Instagram/YouTube Shorts account ≥ 30 days old, ≥ 100 followers (anti-burner-account) |
| **Submission cap** | 10 clips/day per clipper (anti-spam; Whop's submission rate limit) |
| **Exclusion** | Bots, AI-generated clips not derived from real source video, re-uploads of others' clips, content stolen from creators without permission |

**Disclosure (required on every submitted clip):** caption or video description includes `#ad` or `#sponsored` (FTC/ASA/CMA compliance).

---

## 5. The brief — what clippers do

### Public brief copy (paste this into Whop's "Campaign description" field):

> # Get Paid To Clip Minecraft Story Moments
>
> If you've watched a Minecraft civil war, SMP betrayal arc, or faction collapse video — you already know the skill clippers get paid for. You know which 30 seconds will go viral. You know when the story turns.
>
> **The Minecraft Story Clip Challenge pays you to spot those moments.**
>
> ## How it works
>
> 1. Install **Liquid Lift** — free 7-day trial: [liquidclips.app/lift](https://liquidclips.app/lift)
> 2. Pick a long-form Minecraft-style story video (SMP, civil war, faction lore, civilisation runs)
> 3. Use Liquid Lift to clip the moment the story turns — betrayal, alliance, emotional speech, final battle, lore reveal
> 4. Export clean (no watermark — free trial exports carry a watermark; clean export is required for submission)
> 5. Post to TikTok / Instagram Reels / YouTube Shorts with `#ad #MinecraftStoryClips`
> 6. Submit your clip URL via Whop
>
> ## Rewards
>
> - **£0.50** per accepted clip
> - **£25** daily best clip of the day
> - **£100** weekly "Story Eye of the Week" winner
> - Top clippers unlock access to higher-paying campaigns
>
> ## What counts as a story moment
>
> - **Betrayal** — the moment alliances break
> - **War declaration** — faction conflict begins
> - **Villain speech** — the antagonist monologue
> - **Underdog victory** — small player takes down a giant
> - **Emotional confession** — vulnerability moment
> - **Friendship** — bond formed or restored
> - **Moral choice** — the player decides between options
> - **Final battle** — the climax moment
> - **Plot twist** — the unexpected reveal
> - **Lore reveal** — the world's secret exposed
> - **Funny moment** — the comedic peak
>
> ## What gets rejected
>
> - Watermarked clips
> - Horizontal clips (must be vertical 9:16)
> - No captions
> - No clear story moment (just gameplay footage without narrative beat)
> - Re-uploads from someone else's TikTok/Reels
> - Clips from creators who haven't given permission (see source rules below)
> - No `#ad` or `#sponsored` disclosure
>
> ## Source content rules
>
> You can clip:
> - Your OWN Minecraft gameplay footage (preferred)
> - Creators who have publicly licensed their content for clipping (e.g., Creative Commons, explicit "anyone can clip" in their channel about page)
> - Public commentary/reaction format on Minecraft moments WITH transformative framing (your hook, your analysis, your story-moment annotation)
>
> You CANNOT clip:
> - Mojang or Microsoft official footage
> - Creators who haven't given permission
> - Full uncut sections (must be edited — story moment isolated)
> - Other clippers' work
>
> ## Disclaimer
>
> This challenge is not official Minecraft, Mojang, or Microsoft. Liquid Clips runs this campaign independently. Participants are responsible for compliance with TikTok/Instagram/YouTube content policies + applicable copyright law.

---

## 6. Submission requirements (technical)

Whop's submission form needs these fields (the in-app Liquid Lift submission portal mirrors them):

| Field | Type | Required | Validation |
|---|---|---|---|
| **Clip URL** | URL | yes | Must resolve to a public TikTok/Instagram Reels/YouTube Shorts URL |
| **Source video URL** | URL | yes | The long-form video you clipped from |
| **Moment type** | enum | yes | One of: betrayal, war_declaration, villain_speech, underdog_victory, emotional_confession, friendship, moral_choice, final_battle, plot_twist, lore_reveal, funny_moment |
| **Hook timestamp** | hh:mm:ss | yes | When in YOUR clip the hook lands |
| **Why this moment?** | text | yes | 1-2 sentences — clipper's own framing of why this turned |
| **Watermark removed** | boolean | yes | "Yes — clean export" (in-app: auto-detected, false → blocks submission) |
| **Source permission** | enum | yes | One of: my_own_footage / creator_licensed / transformative_commentary |
| **Disclosure included** | boolean | yes | "I included #ad or #sponsored in my caption" |

**Liquid Lift desktop runs an auto-watermark-detector before submission** — clips that fail the detector are rejected client-side with a "Upgrade to remove the watermark and submit" CTA. Whop never sees watermarked submissions, keeping their accept-rate rubric clean.

---

## 7. Accept / reject rubric (mod-facing)

Liquid Clips moderation team uses this scorecard. Whop's standard approval queue UI works — moderators tick boxes.

**Auto-reject conditions** (no moderator review needed):
- Watermark present
- Not vertical
- No captions
- URL doesn't resolve
- Disclosure missing
- Duplicate submission

**Manual review scorecard** (out of 10 — minimum 6 to accept):

| Criterion | Max points |
|---|---|
| Story moment clarity (is there a genuine narrative beat?) | 3 |
| Hook strength (first 1.5 seconds — does it stop the scroll?) | 2 |
| Caption quality (legible, well-timed, conveys moment) | 2 |
| Edit pacing (no dead air, no excessive slow-mo abuse) | 1 |
| Source attribution (creator credited in caption or description) | 1 |
| Transformative framing (your angle, not raw re-upload) | 1 |

**Daily winner = highest scoring + most views in 24h.**
**Weekly winner = composite of: daily wins, total accepted clips, top single-clip views.**

---

## 8. Tier progression (auto, no moderator action)

Once a clipper hits these metrics they automatically unlock Tier 2 access (higher-paying non-Minecraft campaigns):

- 5 accepted clips (lifetime)
- Rejection rate < 25%
- At least 1 clip with > 10k views on the submitted post
- No rule violations on file

Tier 2 campaigns will run with similar wrapped-campaign structure (CPM-or-MRR-share, brief + brand + budget set by Liquid Clips). The Minecraft challenge is the on-ramp; Tier 2 is the destination.

---

## 9. Brand assets Daniel needs to produce / approve

Whop campaign page needs:
- **Hero image** — 1200×630 banner. Suggested visual: dark cinematic Minecraft battle scene + Liquid Lift logo + headline "Get paid to clip the moments stories turn"
- **Square logo** — 512×512 Liquid Clips mark
- **Brief banner** — second-fold image inside the brief, suggested: a visual breakdown of the 11 moment types (icon + label grid)

I can generate all three via gpt-image-1 in one batch (~$0.20 total). Daniel approves visuals before they go live.

---

## 10. Whop campaign field mapping (paste-into-Whop checklist)

When you create the campaign in Whop admin, here's what goes where:

| Whop field | Value from this spec |
|---|---|
| **Campaign name** | Minecraft Story Clip Challenge |
| **Tagline** | Get paid to clip the moments Minecraft stories turn |
| **Reward per accepted submission** | £0.50 (or USD equivalent — confirm Whop's currency settings) |
| **Total campaign budget** | £1,200 |
| **Daily bonus pool** | £25 (manual award per day) |
| **Weekly bonus pool** | £100 (manual award per week) |
| **Allowed platforms** | TikTok, Instagram, YouTube Shorts |
| **Submission form fields** | (copy table from §6) |
| **Campaign description** | (paste public brief from §5) |
| **Approval queue assignees** | Daniel + 1-2 trusted Liquid Clips moderators (recruit from Discord) |
| **Disclosure requirement** | `#ad` or `#sponsored` in caption — auto-reject if missing |
| **Geo eligibility** | Global (Whop handles per-country tax) |
| **Age gate** | 18+ |
| **Campaign duration** | 4 weeks rolling (extend if performing) |
| **Liquid Clips affiliate referral code** | (your Whop affiliate code goes in the post-payout signup link so new clippers signing up to Whop attribute to us) |

---

## 11. After-launch checklist (what Daniel does once Whop campaign is live)

1. Share the Whop campaign ID with Claude (Liquid Lift will fetch it via `/whop/*` proxy and surface it in the workspace)
2. Confirm your Whop affiliate referral code so we can route new Whop signups
3. Approve the three brand assets (hero, square, brief banner) — generated via gpt-image-1
4. Record 2-3 Uncle Daniel "Minecraft-bridge" YouTube videos (titles from §uncle_daniel_video_titles in your strategy doc) — these drive top-of-funnel traffic
5. Set up a Discord channel `#minecraft-story-clips` for community + mod reviews
6. Recruit 2 moderators to share the approval queue load (avoid bottlenecking on Daniel)
7. Publish the marketing site landing page at `liquidclips.app/lift/minecraft-challenge`

---

## 12. Risk + safety notes

**Copyright:** the rules in §5 are tight on this — clipper attestation + manual moderation handle 90% of risk. Residual risk = a creator DMCAs a clipped video. Mitigation: the disclosure tag + transformative framing rules + creator-licensing path make Liquid Clips a safe-harbor host. If DMCA arrives, take down the specific clip + 7-day clipper review.

**Mojang/Microsoft:** §5's disclaimer text is the legal armor. Combined with NOT using "official Minecraft" language anywhere, low brand-impersonation risk.

**Age:** 18+ in §4 is hard. Whop's payout rails won't process minors. If we want under-18 participation later, it's gated rewards (in-app badges, doctrine library unlocks) only — no cash.

**Reward manipulation:** the 10 clips/day cap + the 100-follower threshold blocks burner-account farming. If we see brigading, raise the threshold to 500 followers.

**Budget overrun:** £1,200 hard cap on Whop side. If accepts spike (good problem), pause the campaign on day 21 and decide whether to fund extension from MRR.

---

## 13. Success criteria (after 4 weeks)

| Metric | Target | Pause-and-rethink threshold |
|---|---|---|
| Liquid Lift trial starts via challenge | ≥ 300 | < 80 |
| Free → paid upgrade rate | ≥ 8% | < 3% |
| Accepted clip / submission ratio | ≥ 60% | < 30% |
| Cost per paid Liquid Lift signup | ≤ £15 | > £40 |
| Tier 2 unlocks (clippers who graduate) | ≥ 10 | < 2 |
| Uncle Daniel YouTube CTR from Minecraft-bridge videos | ≥ 4% | < 1.5% |

Hit targets → scale budget 2× and add Tier 2 campaign. Miss targets → debrief, iterate brief/rewards, retest.

---

## End of spec

This is the working draft. Iterate freely — once Daniel says "go" on the numbers + brief + rules, this becomes the source-of-truth document for the launch.
