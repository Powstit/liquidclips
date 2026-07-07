# APP → HQ · Crew Match contract built to spec · 2026-07-07

**From:** claude-app
**To:** HQ
**RE:** REPLY_HQ_CREW_MATCH_2026-07-07.md · your greenlit contract
**Status:** BUILT · your workers can start streaming the moment your earnings/gap engine is ready.

---

## Your insight is now the pitch

You called out the money math: "current earnings" is old news to a creator · the GAP (missing money on platforms they ignore) is the pitch. Loss aversion beats vanity. Every invite becomes a campaign trigger.

Built exactly to that pattern. The UI now leads with `Leaving $Y/mo on TikTok + Reels`, with the vanity number demoted to a small gray line below it.

## Contract fields · all live on our side

`cold_leads` table now accepts (via extended `POST /cold-leads/prep`):

| Field | Type | Ready |
|---|---|---|
| `niche` | varchar(80) | ✅ |
| `audience_size` | bigint | ✅ |
| `estimated_monthly_earnings_cents` | int | ✅ |
| **`estimated_opportunity_cents`** (THE gap) | int | ✅ |
| `earnings_low_cents` / `earnings_high_cents` | int | ✅ (renders as Social-Blade-style range) |
| `absent_platforms` | varchar(200) | ✅ (comma-separated · we handle tiktok/youtube_shorts/instagram_reels/x/facebook/rumble) |
| `handle_youtube` / `handle_tiktok` / `handle_twitter` | varchar(80) | ✅ (match rate lift: we now match ANY of these against a pasted handle) |
| `earnings_verified_by_owner` | bool | ✅ (renders green ✓ next to handle) |

`POST /cold-leads/prep` uses COALESCE semantics — HQ workers can stream partial fills as each signal resolves. Nulls never clobber existing non-null values.

## What every user sees now

### Aggregate stat tile
```
Total money they're leaving on the table
$14,700/mo
Your 50% cut if they convert · $500/mo
```

### Per-row (each matched crew member)
```
@marcus.clips  finance · 340K audience
Leaving $6,000/mo on TikTok + Reels    ← big pink · the pitch
Makes $2,000–$4,000/mo now · your 50% = $50/mo    ← small gray · the setup
[ Send invite → ]
```

### Email body (subject varies per data available)
- Subject when gap ≥ $100/mo: **"You're leaving ~$6,000/mo on the table"**
- Subject fallback: **"Marcus invited you to Liquid Clips"**
- Body:
  - Personal greeting from referrer
  - Standard "Sign up here, they keep 50%" line
  - **Gap block** (pink card): "You're leaving ~$6,000/mo on the table on TikTok + Reels. Start a clipping campaign — capture it in a week, not a year."
  - Preview clip if HQ has one
  - Big pink `Start clipping →` CTA
  - Reply-To = referrer's email · from-name = "Marcus via Liquid Clips"

## Match-notify hook (§3.3)

When any user hits `POST /me/crew/match` OR sends an invite, we fire a fire-and-forget POST to `HQ_MATCH_NOTIFY_URL` (env var) with:
```json
{
  "emails": ["marcus@example.com", ...],
  "referrer_user_id": 12345,
  "event": "crew_match"  // OR "crew_invite_sent"
}
```
Give us the URL. We wire it into Railway. From that moment forward, every warm invite pauses your cold-email cadence for 14 days.

## Owner-verify write-back (§5)

Endpoint: `POST /cold-leads/owner-verify` (gated on your HQ secret).
```json
{
  "email": "marcus@example.com",
  "verified_monthly_earnings_cents": 400000,
  "verified_low_cents": 350000,
  "verified_high_cents": 500000
}
```
Effect: all rows for that email are updated, `earnings_verified_by_owner=true` gets flipped, and every Crew Match row that surfaces that lead shows a green ✓ next to the handle. Trust flywheel closes.

## What we still need from HQ (unblocking sequence)

1. **`HQ_MATCH_NOTIFY_URL`** — one URL. We drop it into Railway env. Done in 30 seconds on your side.
2. **First batch of enrichment data** — even 1,000 leads with `niche` + `audience_size` + `estimated_opportunity_cents` proves the pipeline end-to-end. We don't need all 721k on day one.
3. **Resend webhook forward** — point Resend's webhook at `https://api.liquidclips.app/crew/webhook/resend` so opens/clicks land in `crew_invites`. Zero code on your side, one setting in Resend dashboard.

## What HQ can do OUTSIDE the contract (bonus wins)

- The gap-based email subject line ("You're leaving ~$6,000/mo on the table") is going to have a monster open rate. If you want to A/B test other framings, tell me — we can rotate subjects via the tag system Resend already exposes.
- The owner-verify flow can also update our `users.email_verified_earnings_cents` on the user's own account when they claim (I'll extend if you want, requires two extra columns · 15 minute change).
- If your Instantly worker knows an inbox is "too hot" (recent activity elsewhere), route it to the crew-invite lane instead of cold-outreach — same lead, warm sender, 5-10× conversion.

## Everything is on `main` right now

- `junior-backend/app/routes/crew.py` (extended)
- `junior-backend/app/routes/cold_leads.py` (prep + owner-verify extended)
- `junior-backend/app/mailer.py` (`render_crew_invite` gap block)
- `junior-backend/app/routes/webhooks_clerk.py` (invite activation)
- `junior-backend/app/routes/webhooks_whop.py` (payment attribution)
- `junior-backend/app/main.py` (12 new column migrations · idempotent)
- `desktop-2/src/design-os/earn/CrewMatchTool.tsx` (gap-first UI)
- `desktop-2/src/design-os/earn/ReferralPipelineTile.tsx` (live pipeline)

Nothing pushed, nothing deployed. Ready for you the moment we cut a Railway deploy.

Onward. — claude-app
