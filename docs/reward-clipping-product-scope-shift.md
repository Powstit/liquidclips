# Liquid Clips reward-clipping product scope shift

> Created 2026-05-28.
> Source insight: three clipping-market transcripts Daniel supplied covering Whop Content Rewards, Clipify-style clipping campaigns, OpusClip workflows, payout anxiety, posting cadence, and scaling tactics.

## Executive decision

Liquid Clips should stop presenting itself primarily as a broad "AI video clipping app" and become the desktop command center for reward clippers.

The sharper job-to-be-done:

> Help a clipper find a paid campaign, understand the rules, create many eligible clips, post/submit them, and track what gets paid.

This does not mean the local AI clipping pipeline is less important. It means the pipeline is now one part of a money workflow: campaign discovery -> brief -> batch clips -> variants -> post -> submit -> track views/approval/payout.

## What changed

| Area | Current scope | Changed scope | Why |
|---|---|---|---|
| Product category | Local-first AI clipping tool with Whop/Earn additions | Reward-campaign clipping workbench | The market talks about making money from campaigns, not "repurposing content" in the abstract. |
| Core user | Creator/editor making clips from long videos | Clipper/operator trying to win Whop/Clipify-style rewards | The transcripts are about users with fresh social accounts, campaign briefs, payout rules, and volume. |
| Primary workflow | Drop video -> generate clips -> export | Pick campaign -> keep rules visible -> generate clips -> export/submit/track | Campaign rules and payout status define success, not just clip quality. |
| Differentiator vs OpusClip | Local processing, no upload wait, desktop app | Campaign-native workflow plus local batch clipping | OpusClip already owns generic auto-clipping. Liquid Clips can own "campaign-aware clipping." |
| Earn tab | Affiliate/referral plus Whop browse | Operator home for campaigns, submissions, payouts, and strategy | "Earn" should become the user's money cockpit. |
| Payments | Customer billing + affiliate payout plumbing | Clear split by payout source: Whop rewards, external campaign platforms, Liquid Clips affiliate commissions | Users must know who pays them and where. Confusion here kills trust. |

## New product narrative

Short version:

> Liquid Clips helps reward clippers find better campaigns, make more eligible clips, and track what gets paid.

Long version:

> Browse reward campaigns, keep the brief beside your editor, generate batches of short-form clips, make variants of winners, and track submissions, approvals, and payouts from one desktop workspace.

## Current scope assessment

### Already aligned

| Existing piece | Why it still matters |
|---|---|
| Local-first desktop pipeline | Reward clippers need volume. Local processing means no upload wait and fewer source-minute limits. |
| Browse Rewards side webview | Core to campaign-native workflow. Users should browse Whop without leaving the app. |
| Earn tab | Natural place to become the campaign/submission/payout cockpit. |
| Whop bounty data / open-brief flow | Becomes the first campaign brief integration. |
| Stripe Connect affiliate plumbing | Correct for Liquid Clips' own non-Whop affiliate commissions. |
| Beta-gated publish/schedule/drip | Good: do not over-promise posting automation before it works. |

### Misaligned or too broad

| Current emphasis | Problem | Recommendation |
|---|---|---|
| "AI editor that lives on your computer" | Useful, but too generic and OpusClip-adjacent. | Keep as proof point, not the headline. |
| "Runs your whole channel" | Too broad and implies auto-posting/strategy the product does not fully own yet. | Replace with "runs your clipping workflow" or "campaign clipping workbench." |
| General social publishing features | Not the immediate buyer trigger from the transcripts. | Keep beta-gated; do not center launch around publishing. |
| Heavy affiliate-program emphasis on homepage | Important for growth, but secondary to the clipper's own earning workflow. | Move below core campaign workflow. |
| Hosted AI / cloud claims | Already beta-labeled, keep quiet until real. | Do not use hosted AI to sell this market yet. |
| Polished generic design uplift | Nice, but less urgent than campaign workflow clarity. | Only do polish that helps the money workflow. |

## Market insights from the transcripts

| Signal | Product implication |
|---|---|
| Users sort campaigns by "most paid out" to reduce non-payment risk. | Add campaign trust/score fields: paid-out history, budget remaining, waitlist status, requirements complexity. |
| Users avoid campaigns with budgets nearly complete. | Surface budget remaining and warn when a campaign is almost exhausted. |
| Users prefer $2-$3 per 1k views unless requirements are easy. | Campaign score must weigh RPM against difficulty. |
| Users need rules visible: platforms, countries, minimum views, product must appear, hashtags, mentions. | Build a campaign brief object and pin it beside editing/export. |
| Hook/title/context drives retention. | Generate hook/title overlays, not just captions. |
| First 2 seconds matter. | Rank clips by hook strength and opening visual. |
| Batch creation reduces burnout. | Clip batches and queues matter more than one-off export polish. |
| Doubling down on winners is a top-1% tactic. | Add "Make variants" for any successful clip. |
| Payout approval speed matters. | Track submission status, payout estimate, and payout source. |
| Platforms are fragmented: Whop, Clipify, possibly more. | Architect "campaign platform" generically; Whop is v1, not the whole category. |

## Product principle

Every feature should answer at least one of these:

1. Does it help the user pick a better campaign?
2. Does it help the user create more eligible clips faster?
3. Does it reduce rejection or payout confusion?
4. Does it help the user double down on what already worked?
5. Does it preserve trust with Apple/payment/platform rules?

If a feature does not answer one of those, it is probably not launch-critical.

## Scope impact

### Add or elevate

| Feature | Impact | Notes |
|---|---|---|
| Campaign Brief object | High | Store payout, rules, platforms, source links, submission instructions. |
| Campaign Score | High | "Worth clipping?" signal based on payout, budget, rules, waitlist, allowed platforms. |
| Batch Clip workspace | High | Generate and review many candidates against one campaign. |
| Hook/Title generator | High | Clip titles are a core viral mechanism. |
| Variant generator | High | Make 3 alternate versions from a winner. |
| Submission Tracker | High | Tracks post URL, upload, approval, views, estimated/actual payout. |
| Payout Source clarity | High | Whop rewards vs external platforms vs Liquid Clips affiliate commissions. |
| Warm-up/posting plan | Medium | Guides new users without requiring auto-posting. |
| Campaign platform abstraction | Medium | Lets Clipify-style platforms fit later. |

### Reduce or cut from launch narrative

| Feature/narrative | Decision | Reason |
|---|---|---|
| Auto-publish/schedule/drip | Keep beta/off-center | Valuable later, but not needed to prove reward-clipping PMF. |
| Hosted AI | Keep beta/off-center | Do not compete on cloud AI until it is real and stable. |
| General creator/channel management copy | Cut from primary pitch | Too broad. Campaign money workflow is sharper. |
| "Autopilot" as the main story | Reduce | It can imply hands-off posting/payout guarantees. |
| Broad affiliate-program marketing | Move lower | The user first wants to earn from clipping, then from referrals. |
| Deep design polish passes | Defer unless they clarify workflow | Product clarity beats animation at this stage. |

## Success definition

Liquid Clips is speaking to the market when a first-time clipper can open the app and understand:

1. Where to find a campaign.
2. Which campaign is worth clipping.
3. What rules must be followed to get paid.
4. Which clips are ready to post.
5. What has been submitted.
6. Who pays them and what status the money is in.

If the product does that, it is no longer "another OpusClip." It is the operating system for reward clippers.
