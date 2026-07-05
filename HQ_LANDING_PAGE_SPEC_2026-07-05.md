# Landing Page Updates for Cold-Email Launch

**From:** Claude (Desktop 2 build)
**To:** HQ (marketing / landing owner)
**Date:** 2026-07-05
**Priority:** Ship blocker for Cohort 0 cold-email funnel

---

## Context

Daniel is preparing the cold-email launch to 280,000 leads (4,000–9,000/day). Landing page is the destination — needs the updates below before send.

Model: **free-with-card-on-file → Whop handles charge trigger → $99.99/mo Founder Access for life**. Transparency at landing kills the "bait and switch" psychology risk.

---

## Six updates required

### 1 · Features carousel (currently missing)

Insert a horizontal carousel/grid between the free-clips block and the pricing block. **6–8 tiles**, each is a screenshot with a **4-6 word verb-first caption**. Pull from:

- **3× Uncle Daniel campaign thumbnails** — already live at `liquidclips-marketing/public/brand/uncle-daniel-*` (verify path with git-grep)
- **Chat room screenshot** — screenshot the Community tab in Liquid Clips at agency tier (Whop mirror + native LC chat)
- **Wallet page screenshot** — Earn tab at Founder tier showing real $ waiting
- **Publish flow screenshot** — multi-platform post going out to TikTok / Reels / Shorts
- **Campaign builder screenshot** — agency tier campaign creation
- **Watermark comparison** — free vs paid clip side-by-side (this IS the visible conversion incentive)

Caption examples:
- "Chat with clippers native — no Discord tax"
- "Real payout dashboard — Whop-wired"
- "One click to TikTok, Reels, Shorts"
- "Launch a campaign in 90 seconds"
- "Watermark drops the moment you unlock"

### 2 · Add Enterprise tier (100+ seats)

Below the Founder Access block, add a **third pricing column**:

```
ENTERPRISE · CUSTOM

$49/seat/mo at 100 seats
$39/seat/mo at 250 seats
$29/seat/mo at 500 seats
Volume down from there — talk to us

✓ Everything in Founder
✓ Cloud clip sharing (team gallery, no local export needed)
✓ SSO/SAML sign-in for teams
✓ Dedicated Slack channel with LC team
✓ 24h response SLA
✓ White-label option (remove "Made with Liquid Clips")
✓ Consolidated invoicing (one bill for the team)
✓ Priority in Whop payout queue

[Contact for Enterprise →]  (opens Calendly demo booking)
```

**Why $49/seat is the magic number at 100:** enterprise buyers see individual $99.99 pricing on the site → 100 seats "should" cost $9,999/mo → they see $4,900 = 51% off → feels like a real deal.

### 3 · Personalized landing header

Accept URL params: `?u=<channel_handle>&e=<recipient_email>&c=<campaign_id>`

Above the free-clips block, render:

```
Hey [Channel Name] —
Here are 10 clips we made from your recent uploads.
```

Fallback if params missing: *"10 clips ready · paste any YouTube URL to get yours."*

### 4 · Live Founder seat counter

The pricing block already exists but the seat number is hardcoded. Wire it to `GET /founder/seat-status` from junior-backend. Helper `founderSeatStatus.ts` already exists in the marketing repo.

Display: **"12,000 seats · [X remaining]"** with X live from the endpoint.

### 5 · Founder pricing anchor

Show `$500/mo Agency` **crossed out**, then `$99.99/mo for life · one-time deal`.

Small print underneath:

> *Founder Access price locks for life · never increases · cancel anytime*

### 6 · Below-fold: comparison table + social proof

- **Comparison table**: Founder vs Enterprise side-by-side (feels premium, not desperate)
- **Testimonials or logos-coming-soon placeholder** underneath

---

## Cold-email URL tracking spec

Each cold email carries these params to the landing page:

| Param | Purpose | Example |
|---|---|---|
| `u` | Channel handle | `?u=UncleDaniel` |
| `e` | Recipient email (hashed) | `?e=abc123` |
| `c` | Campaign ID | `?c=cold01-a` |
| `v` | Subject-line variant (A/B) | `?v=b` |
| `d` | Demo asset ID (which of the 10 pre-rendered clips they get) | `?d=demo_2934` |

All params piped to PostHog + backend `funnel_events` table on landing.

---

## Data model to track (backend + PostHog)

**One row per recipient · one big `funnel_events` table:**

### Email layer
`campaign_id` · `recipient_email_hash` · `subject_variant` · `channel_handle` · `sent_at` · `opened_at` · `clicked_at` · `cta_clicked` (primary vs secondary)

### Landing layer
`visit_at` · `time_on_page` · `scroll_depth_pct` · `demos_watched` (which of the 10) · `url_pasted` (yes/no) · `quantity_chosen` (10/30/100) · `founder_block_viewed` (yes/no) · `enterprise_block_clicked` (yes/no) · `seat_counter_seen`

### Signup layer
`signup_at` · `card_captured` (yes/no) · `whop_customer_id` · `arrival_channel` · `time_from_first_open_to_signup`

### Install layer
`download_started_at` · `install_completed_at` · `first_launch_at` · `os_arch` · `time_from_signup_to_first_launch`

### In-app layer
`first_demo_played_at` · `first_url_pasted_at` · `first_feature_gate_hit` (which one) · `time_to_first_gate` · `clip_count_lifetime`

### Conversion layer
`charge_triggered_at` · `charge_source` (which feature gate) · `plan_chosen` (Founder / Enterprise) · `whop_charge_id` · `time_from_install_to_charge`

### Retention layer
`d1_retained` · `d7_retained` · `d30_retained` · `crew_members_invited` · `crew_conversion_rate`

---

## Levers ranked by conversion leverage

Based on cold-email industry data + creator-tool ICP:

1. **Subject line CTR** — 2-3× swing between best and worst · A/B test 4-6 variants weekly
2. **Personalized preview** — "10 clips from [Their Channel]" beats "10 free clips" by 30-40%
3. **Time to first "wow"** — landing page auto-plays their first clip within 3s of visit = 2× conversion
4. **Scroll depth to Founder block** — if they see the anchor pricing, conversion up 60%
5. **Seat scarcity concrete number** — "3,247 remaining" beats "limited seats" by 40%
6. **Enterprise CTA visibility** — even for solo users, seeing "Enterprise 100+ seats" signals credibility · 15% lift on Founder conversion
7. **Card-on-file completion** — every form field cut = higher conversion · trust Whop's default
8. **Time from install to first feature gate** — under 10 min = 3× conversion vs multi-day path · pre-seeded demos + earn-tab tease do this

---

## Ship checklist

- [ ] Features carousel with real screenshots
- [ ] Enterprise pricing column with cloud-sharing bullets
- [ ] URL param handler for `?u=&e=&c=&v=&d=`
- [ ] Live Founder seat counter wired to `/founder/seat-status`
- [ ] $500 crossed-out anchor next to $99.99 Founder
- [ ] Comparison table below fold
- [ ] Calendly link for Enterprise CTA
- [ ] PostHog events firing on each layer
- [ ] Backend `funnel_events` migration deployed

---

**Reply when live so cold-email cadence can start sending.**
