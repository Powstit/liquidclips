# Onboarding Chat Rooms · Scope · 2026-06-24

**Status:** SCOPE only. Build is morning work.
**Estimated time:** ~45 min (add 4 seed entries + tiny webhook for wins room)

## Existing 9 community rooms (auto-seeded on every Railway deploy)

| # | Slug | Purpose |
|---|---|---|
| 1 | announcements | Daniel broadcasts product news |
| 2 | free-clipper-lobby | Free-tier hangout |
| 3 | premium-rewards-hq | Paid-tier earnings + payouts |
| 4 | affiliate-growth-room | Affiliate revenue chatter |
| 5 | uncle-daniel-clips | Uncle Daniel campaign assets + submissions |
| 6 | viral-reaction-missions | Reaction-clip mission lane |
| 7 | ddb-beauty-clips | DDB Beauty campaign room |
| 8 | ddb-fashion-clips | DDB Fashion campaign room |
| 9 | sponsor-campaigns | General sponsor campaign discussion |

## Proposed 4 new onboarding rooms

| # | Slug | Purpose | First-pinned content |
|---|---|---|---|
| 10 | **start-here** | First room a new clipper sees · welcome + 3 first things | 90s welcome video · install link · "your first clip in 5 minutes" guide |
| 11 | **install-help** | Friction during install · macOS Gatekeeper · Windows SmartScreen · deep-link activation issues · JWT paste fallback | Pinned screencast for each OS · link to apple notarisation cert status |
| 12 | **first-clip-help** | Friction between install and first export | "How do I import a URL" walkthrough · "trim isn't working" · "captions failed" · pinned 90s screencast |
| 13 | **wins** | Social proof room · auto-posted "first $50" stories from carrot payout webhook | Auto-feed of approved carrot claims (anonymised handle + amount) · drives free→paid conversion |

**Total: 13 community rooms (9 existing + 4 new).**

## Why these 4 specifically

- **start-here** — Reduces "what do I do now" drop-off in first 60 seconds. Acts as a hub.
- **install-help** — Today's #1 friction (per [[liquid-clips-apple-notarization]] memory + the SmartScreen rebrand work). Without a room dedicated to this, every install failure becomes a DM to Daniel.
- **first-clip-help** — The biggest funnel leak: user installs but never produces a clip. A dedicated help room with pinned screencast turns a churn moment into a community moment.
- **wins** — Social proof is the #1 conversion driver for clipping platforms. Auto-feeding real earnings (anonymised) into a public room is free marketing inside the app.

## Implementation

### Step 1 · `junior-backend/scripts/seed_community_channels.py`

Add 4 entries to the existing `SEEDS` list. Each follows the same shape as existing rooms:

```python
{
    "slug": "start-here",
    "name": "Start Here",
    "description": "Welcome — three first things, install link, walkthrough.",
    "kind": "general",
    "order": 0,  # always first in the sidebar
    "auto_subscribe_tiers": ["free", "solo", "growth", "agency"],
    "pinned": True,
},
{
    "slug": "install-help",
    "name": "Install Help",
    "description": "Mac Gatekeeper · Windows SmartScreen · activation issues.",
    "kind": "support",
    "auto_subscribe_tiers": ["free", "solo", "growth", "agency"],
},
{
    "slug": "first-clip-help",
    "name": "First Clip Help",
    "description": "Import a URL · trim · captions · export — pinned screencast.",
    "kind": "support",
    "auto_subscribe_tiers": ["free", "solo", "growth", "agency"],
},
{
    "slug": "wins",
    "name": "Wins",
    "description": "Auto-feed of first earnings — real numbers from real clippers.",
    "kind": "showcase",
    "auto_subscribe_tiers": ["free", "solo", "growth", "agency"],
    "auto_post_from": "carrot_payout_webhook",  # new hook
},
```

The seed runs idempotently on Railway boot — next `railway up` deploys the rooms automatically.

### Step 2 · Tiny webhook for `wins` auto-feed (~30 lines)

When backend `/webhooks/whop` handler maps a submission to `paid`, also POST a message to the `wins` community channel:

```
"🎉 [@anonymised_handle] just earned $[amount] from [campaign_name]"
```

Anonymisation: use first 3 chars of handle + ***. No PII. Skip if amount < $1 (mock-mode test payouts shouldn't pollute the room).

Code location: `junior-backend/app/routes/webhooks_whop.py:_handle_submission_verdict` — after the existing audit log write, conditionally POST to community channel via existing internal community message endpoint.

### Step 3 · No UI work needed

Rooms appear in the existing community panel automatically (already wired). HQ admin observability (community channels admin endpoint) also auto-applies.

## Risks / edge cases

- **`wins` room could embarrass low earners** — solution: only auto-post payouts ≥ $5. Top earners (≥ $50) get a slightly fancier message.
- **`install-help` could become a complaint feed without moderation** — solution: pin a "Daniel responds Mon-Fri" message, set expectations.
- **`start-here` content must be evergreen** — solution: the pinned message is markdown, easy to edit via HQ admin without redeploy.

## Out of scope (deferred)

- Per-platform install-help splits (Mac help vs Windows help separate rooms) — overkill for now
- Localised onboarding rooms (Spanish, Portuguese for the campaign clippers) — Phase 2
- Discord/Slack mirroring — separate decision
- Bot-driven moderation in `wins` room — manual until volume warrants

## Resume command

```bash
cd /Users/dipdip/code/jnr && claude --resume d11d2b24-4ee6-48c4-8d62-09daf0dac363
# Then: "seed onboarding rooms per docs/ONBOARDING_ROOMS_SCOPE.md"
```
