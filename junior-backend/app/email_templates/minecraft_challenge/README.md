# Minecraft Story Clip Challenge — Resend templates (sprint #14c)

6 templates that fire across the clipper funnel. Brand voice = **Uncle
Daniel**: direct, doctrine-heavy, no fake guru polish, no exclamation marks.

| File | Trigger | When |
|---|---|---|
| `01_challenge_join.html` | User joins the challenge (clicks the CTA on liquidclips.app/lift/minecraft-challenge OR signs up to Liquid Lift via a Minecraft-bridge YouTube video) | Within 60s of join |
| `02_first_export.html` | User exports their first clip in Liquid Lift after joining the challenge | Within 5min of export |
| `03_watermark_rejected.html` | Submission rejected because Liquid Lift's free-tier watermark was detected | Within 60s of submission attempt |
| `04_upgrade_confirmed.html` | User upgrades to Solo or Pro (any tier that strips the watermark) | Within 60s of upgrade webhook |
| `05_first_acceptance.html` | First clip approved by mods (or auto-forwarded to Whop after view threshold) | Within 60s of acceptance |
| `06_leaderboard_placement.html` | User enters the weekly top-10 leaderboard | Once per week, fired on Sunday evening |

## Substitution variables

Each template uses `{{var_name}}` Mustache syntax. The backend's Resend
sender fills these from the User row + submission row before dispatch.

| Variable | Meaning |
|---|---|
| `{{first_name}}` | User's first name (Clerk profile) |
| `{{handle}}` | Cached display handle (matches leaderboard) |
| `{{clip_url}}` | The specific clip URL referenced |
| `{{moment_label}}` | Human-readable moment type ("Betrayal", "Final battle", etc.) |
| `{{rejection_reason}}` | One-line human reason from the watermark detector |
| `{{upgrade_url}}` | Clerk checkout deep link for Solo / Pro |
| `{{rank}}` | Leaderboard rank this week |
| `{{earnings_usd}}` | Lifetime $ earned via Whop content rewards |

## Dispatch

Resend env vars (already configured on Railway):
- `RESEND_API_KEY`
- `RESEND_FROM` — e.g. `Uncle Daniel <daniel@liquidclips.app>`

Sending happens from `junior-backend/app/routes/submissions.py` on the
relevant status transitions. The actual Resend wiring is a follow-up task
(after Daniel sets RESEND_API_KEY and confirms the from-address is
domain-verified). The templates ship ready-to-use.

## Voice rules (do not break)

- No exclamation marks
- No "Hey!" / "Hi there!" openers — start with the point
- Past tense for done, plain verb for in-progress
- No emoji
- Subject lines under 50 chars
- Plain doctrine over hype
