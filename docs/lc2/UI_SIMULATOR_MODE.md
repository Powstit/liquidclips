# Liquid Clips 2.0 — UI simulator mode

Source-of-truth for the two-persona UI skeleton simulator. No real feature
wiring — every button navigates to the right section or opens a Whop/Ayrshare
placeholder.

## Two user modes

The simulator must make the product split obvious:

1. **Clipper Mode** — supply side. Join a campaign → clip source → edit in
   Engine → publish via Ayrshare placeholder → submit to Whop Content Rewards.
2. **Campaign Owner / Agency Mode** — demand side. Create a campaign → set a
   locked watermark → link a Whop reward pool → invite clippers → review output.

## Mode choice

`Home` presents a forced-choice card:

- **"I am a Clipper"** → sets mode to `clipper`, surfaces bounties/missions.
- **"I am creating a Campaign"** → sets mode to `campaign`, surfaces campaign
  creation/review.
- **"Clear choice"** resets mode to `null`.

Mode state lives in `desktop-2/src/shell/modeStore.ts`.

## Build-vs-integrate labels

| Capability | Owner | UI label / door |
| ---------- | ----- | --------------- |
| Engine, brand layer, watermark, clean UX | **BUILD** | Engine, Watermark composer, Clipper studio |
| Rewards, view tracking, payouts, tiers, community, affiliates | **WHOP** | "Open in Whop", "Submit to Whop rewards", "Invite clippers on Whop" |
| Social publishing, OAuth/social connections | **AYRSHARE** | "Publish via Ayrshare" |
| Thin broker/proxy | **BACKEND** | Quota probe, social token exchange, publish proxy |

## Honesty rules

- No fake native rewards numbers.
- Earn shows mission cards and link-out buttons only.
- No native payout totals, view counts, submission totals, or leaderboard figures.
- Campaign output shows clip count and roster count, not dollar figures.

## Section roles in simulator

| Section | Mode relevance | Key doors |
| ------- | -------------- | --------- |
| Home | Both | Mode picker, digest tiles |
| Campaigns | Owner | Create campaign, watermark composer, Whop reward/invite/community |
| Clipper | Clipper | Hidden route: join campaign, start clipping, missions, earnings link-out |
| Create | Both | Paste/drop source; campaign-bound context; → Engine |
| Engine | Both | Clip grid, action bar, edit rails, timeline, campaign stamp preview, Whop submit, Ayrshare publish |
| Projects | Both | Group clips; link to campaign |
| Schedule | Both | Queue placeholder |
| Channels | Both | Social connections placeholder |
| Community | Both | Whop community launcher |
| Earn | Clipper | Whop launchpad for missions; no native numbers |
| Settings | Both | Account/Billing, API Keys, Integrations, Privacy, Diagnostics, HQ Bridge, About |

## Fake wiring checklist

- [x] Home → Campaigns
- [x] Home → Clipper mode
- [x] Campaigns → Create campaign modal
- [x] Campaigns → Watermark composer
- [x] Campaigns → Whop reward setup placeholder
- [x] Campaigns → Invite clippers placeholder
- [x] Campaigns → Community
- [x] Campaigns → Create with `campaignId`
- [x] Campaigns → Engine clip view
- [x] Campaigns → Earn missions
- [x] Campaigns → Projects linked to campaign
- [x] Clipper join campaign → Whop placeholder
- [x] Clipper → Create
- [x] Create success → Engine
- [x] Engine → Publish placeholder
- [x] Engine → Submit to Whop Rewards placeholder
- [x] Whop rewards return → Earn/Engine fake confirmation (deep-link verb listed)
- [x] Earn mission → Create
- [x] Community room → Whop placeholder
- [x] Browse → Create
- [x] Browse → Projects
- [x] Create → Engine
- [x] Engine → Projects
- [x] Engine → Schedule
- [x] Engine → Channels
- [x] Projects → Engine
- [x] Projects → Schedule
- [x] Schedule → Channels
- [x] Settings → Channels
- [x] Diagnostics row → relevant section
- [x] HQ Bridge fake deep-link → any section

## Change log

| Date | Change |
| ---- | ------ |
| 2026-06-16 | Initial two-persona UI simulator mode doc. |
