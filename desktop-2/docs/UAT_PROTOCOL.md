# Liquid Clips · UAT Protocol · 5-User Think-Aloud

**Owner:** Daniel · **Method:** Nielsen Norman Group 5-User Standard + Think-Aloud (Ericsson & Simon, 1993) · **Scoring:** System Usability Scale (SUS)
**Version:** 2026-07-22 · Reliability Sprint Layer 2

---

## Why this protocol

Testing every button in Playwright catches regressions. It does NOT catch the moment a user doesn't understand what a button does, or reaches for a control the app doesn't expose. **UAT (User Acceptance Testing) with think-aloud protocol reveals 85% of usability problems with just 5 users** — the finding Nielsen has replicated for 30+ years.

- **Playwright** answers: "does the button work?"
- **UAT** answers: "does the user know the button exists, want to press it, understand the outcome, and feel good about the result?"

Both are required. Neither substitutes for the other.

---

## Participant profile

Each session recruits ONE participant matching one of five profiles (mirrors the target 40k-user cohort):

| # | Profile | Where to recruit | Compensation |
|---|---|---|---|
| P1 | TikTok clipper · 6+ months posting daily · has never used a desktop clip tool | Whop bounty channel · @clipfarm subreddit | $30 |
| P2 | Twitch streamer looking to clip highlights · uses OBS + Premiere | Twitch DM outreach · r/Twitch | $30 |
| P3 | Agency owner running 3+ clippers | LinkedIn "clipping agency" search · Twitter DMs | $50 |
| P4 | Content creator with 10k-100k YT followers · never done paid clipping | YouTube DMs · Beehiiv creator newsletters | $30 |
| P5 | Long-form podcaster looking to repurpose | Podnews / Buzzsprout communities | $30 |

**Total budget:** $170 for the 5-user round · 30-45 min per session · 4-6 hours total elapsed.

---

## Session structure (45 min)

### 1. Welcome + baseline (5 min)
- "Thanks for helping · this is not a test of you, it's a test of the app"
- "I'll be silent 90% of the time · just do what feels natural"
- "Please say every thought out loud — even 'I'm confused' or 'where is X?' Silence gives me nothing to work with"
- Get demographics: role, hours/week doing clip-related work, current tools

### 2. Baseline SUS pretest (2 min)
- Rate familiarity with clip tools 1-5

### 3. Warm-up task · Sign in and reach Home (5 min)
- **Task:** "Get signed in and land on the main dashboard."
- **Success criteria:** reaches Home cockpit route (`#/home`) with `.lc-app` visible.
- **Watch for:** Whop OAuth confusion · founder-video interruption · nav clarity.

### 4. Core Task · Create your first clip (15 min)
- **Task:** "Take this YouTube URL [give a 10 min video URL] and produce ONE clip you'd actually post."
- **Success criteria:** Reaches a rendered `.mp4` with the watermark burned in.
- **Watch for:** Source-picker friction · Kade command bar confusion · clip-arrival moment (does user notice?) · trim/caption controls · export destination clarity.
- **Ban:** Do NOT prompt "try Kade" or "use the command bar." Let them find it.

### 5. Discovery Task · Find a bounty (5 min)
- **Task:** "You want to earn money by clipping. Find a bounty and start working on it."
- **Success criteria:** Reaches Whop bounty modal via Composer campaign.submit path.
- **Watch for:** Earn tab confusion · "where do I actually get paid" · $ mental model.

### 6. Recovery Task · What if something breaks? (5 min)
- **Task:** "Pretend your clip export failed. Show me what you'd do."
- **Success criteria:** Reaches Copy Diagnostics OR support contact.
- **Watch for:** How much frustration before quitting · trust in the recovery path.

### 7. SUS post-test (5 min)
- Standard 10-question SUS scale (see UAT_SUS_SURVEY.md)

### 8. Debrief (5 min)
- "What was the most frustrating moment?"
- "If I could fix ONE thing tonight, what would it be?"
- "Would you tell a friend to use this? Why or why not?"

---

## Moderator rules (Ericsson & Simon think-aloud)

- **Never lead.** Never ask "did you see the X button?" Instead: "Let's pause · what were you looking for just now?"
- **Never help mid-task.** If the participant is stuck for 3+ minutes, mark it as a failed task and move on.
- **Never explain.** If they ask "what does this do?" say "what do you think it does?"
- **Fill the silence with silence.** Nod. Wait. Let them think.
- **Only re-prompt for verbalization.** "What are you thinking right now?" is the only allowed nudge.

---

## Recording setup

- **Screen recording:** QuickTime · Cmd+Shift+5 · full desktop
- **Audio:** built-in mic
- **Save as:** `uat/session-P{N}-YYYY-MM-DD.mov`
- **Consent:** email them the [UAT_RECRUITMENT_EMAIL.md](UAT_RECRUITMENT_EMAIL.md) template BEFORE the session · they reply "consent"

---

## Analysis (see UAT_ANALYSIS_TEMPLATE.md)

After each session, within 2 hours, log the findings into the template. After the 5th session, synthesize themes and produce the P0/P1/P2 severity list.

**Launch gate:** SUS score ≥ 68 (industry-standard "above average") AND zero P0 findings unresolved.
