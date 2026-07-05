# HQ · pricing model update (2026-07-05 ship-day walk)

**From:** Claude Me (CM lane)
**For:** HQ · marketing site + cold-email cohort 0
**Type:** Handoff — please update landing site copy + Whop links before Cohort 0 blast

---

## The two pricing changes marketing needs to reflect

### 1 · Whop plan ID rotated (again)

| Old (deprecated) | New (canonical for Cohort 0) |
|---|---|
| `plan_svbzoXoT4oj6b` — 365-day trial with card at signup | `plan_NMKvKj8SVVKsY` — no trial · immediate charge · unlocks clip 11+ |

**Any hardcoded checkout links** on `liquidclips.app` or in cold-email templates need to swap:

```
OLD:  https://whop.com/checkout/plan_svbzoXoT4oj6b
NEW:  https://whop.com/checkout/plan_NMKvKj8SVVKsY
```

Legacy plans (`plan_VWj1uoy2RcOsg`, `plan_svbzoXoT4oj6b`) are grandfathered in the backend so in-flight checkouts from stale links still resolve to the founder tier — but new outbound links should point at `plan_NMKvKj8SVVKsY`.

### 2 · Pricing narrative shift

**Old narrative (wrong · killed today):**
- "365 days free, then $99.99/mo"
- "Card captured at signup"
- User signs up on Whop first, gives card, gets 365 days

**New narrative (canonical):**
- "10 free clips inside the app · no card, no signup"
- "Clip 11 unlocks with a $99.99/mo Founder Access subscription · locked at $99.99 for life"
- User installs, clips 10 for free, hits paywall at clip 11, THEN sees Whop checkout with immediate charge

**Why the change:** the 365-day trial felt sketchy (card captured for a year, opaque charge date). The new model is symmetric — the user gets real value (10 free clips) before ever giving a card. Cohort 0 cold-email hook should lean into "download and clip for free, no card, no signup" as the top-of-funnel offer.

---

## Recommended copy edits (drop-in)

### Landing hero
```
OLD:
  "Start your 365-day free trial. Card captured at signup."
NEW:
  "Download and clip 10 videos free. No card, no signup.
   $99.99/mo unlocks clip 11 · locked for life for the first 12,000 clippers."
```

### Pricing section
```
OLD:
  "Founder Access
   365 days free · $99.99/mo after
   First 12,000 clippers"
NEW:
  "Founder Access
   10 free clips in-app · $99.99/mo unlocks the rest
   First 12,000 clippers · locked at $99.99 for life"
```

### Cold-email subject lines (drafts)
- "10 free clips. No card. Try Liquid Clips."
- "Your first 10 clips are on us. Card only when you're sold."
- "We killed the 365-day trial. Here's why."

### Cold-email body top-line
```
Hey {first_name},

Download Liquid Clips. Clip 10 videos free. No signup, no card, no trial.

If you're still clipping after 10, you already know it works — $99.99/mo
unlocks the rest, locked for life for the first 12,000 clippers.

If you're not, you owe us nothing. Delete the app.
```

---

## Other app-side changes marketing may want to align on

Not landing-page-blocking, just FYI so brand voice matches the app:

- **Cold-open** on the installed app went from 6-second sit → 1.5-second brand moment
- **Mini-game splash was pulled** — cold-open lands directly on the shell after the brand moment
- **Sign-in / sign-up split** — the app's Sign in pill now opens `account.liquidclips.app/connect-desktop` which surfaces BOTH Clerk sign-in (returning users) AND the founder-access buy path (new users) instead of dropping straight into paid checkout
- **10-clip counter** — backend `clips_per_ip = 10` (was 100); every "100 free clips" copy in the app + welcome-email templates now says "10 free clip exports"

If the marketing site currently says "100 free clips" or "start your trial", those need matching edits.

---

## Ship state

- Backend deployed 2026-07-05 with `plan_NMKvKj8SVVKsY` and `clips_per_ip=10` (Railway)
- Desktop app v2.2.26 building now with all app-side copy + wire fixes
- Legacy plans grandfathered (no in-flight checkout regression)

---

## Ownership

- **HQ owns:** landing site copy · pricing section · cold-email templates · any hardcoded checkout links
- **CM lane owns:** in-app copy · Whop plan config · backend features · desktop shell

If HQ needs a preview of the new in-app flow (screenshot walk), Daniel can `open` the fresh 2.2.26 install after CI builds. Cohort 0 blast should reference `plan_NMKvKj8SVVKsY` in every outbound checkout URL.

Ping back with any copy questions or if the narrative needs more punch.
