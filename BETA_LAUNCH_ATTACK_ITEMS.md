# Beta Launch — Attack Items

**Written:** 2026-08-30
**Author:** Claude (working with Daniel)
**Context:** Post-v2.3.70 code freeze. Cohort = 275 invited beta users. Target ship date = end of week.

This doc catalogs everything that is NOT code-and-tests but WILL bite us
between "app boots" and "275 users are happily using it." Read this
before signing off on the launch — the code side is green (see
`launch/community-fix-2.3.70` PR), but the code is ~40% of what beta
readiness actually means.

Priority key:
- **P0** = launch-blocker. Would cause a public disaster if 275 users hit it.
- **P1** = will hurt in week 1. Fix within days.
- **P2** = fix in weeks 2-3, before the next cohort expands.

Owner column:
- **DEV** = engineering (dev team)
- **OPS** = Daniel + support
- **BOTH** = code change + operational process

---

## 1 · Admin — you're flying blind without these

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 1.1 | P0 | **User lookup dashboard.** Search by email → see tier, JWT last-refresh, last submission, payment status, device version, last 50 error events. | Every support ticket takes 20 min instead of 2. See `junior-backend/app/routes/admin.py` — if these are JSON-only, wire a page in `account-app`. | BOTH |
| 1.2 | P0 | **Impersonate/sudo mode.** "Log in as this user" from admin panel. | 60% of bug tickets are unreproducible without it. Clerk backend sessions support this in ~30 min. | DEV |
| 1.3 | P0 | **Kill-switch feature flags.** Env-var-driven flags for: clip generation, submissions, Whop redirect, publishing, community chat. | We shipped `VITE_LAUNCH_COMING_SOON` today — that's one flag. First paid outage at every SaaS I've worked at was "we had to redeploy to disable a feature and the deploy broke something else." | DEV |
| 1.4 | P0 | **Submission review queue.** Admin page listing every `campaign_submission` with status = `submitted`. One-click approve / reject / flag. | Right now the status transitions from `submitted → accepted → forwarded → paid` require a human. Who does the flipping? If Daniel at 3am, that's the bottleneck. | BOTH |
| 1.5 | P0 | **Manual tier bump.** Comp a free upgrade, downgrade someone, refund without asking devs. | You'll do this 5-10x/week for demos, apologies, gifts to power users. Same admin page as #1.1. | DEV |
| 1.6 | P1 | **Audit log.** Who did what and when — especially for money-touching actions (tier bumps, refunds, submission approvals). | When something goes wrong you need to trace back who touched it. | DEV |
| 1.7 | P1 | **Slack ping on new submissions.** Bot posts to a private ops channel when a submission lands. | Beats email or dashboard-polling. | DEV |

---

## 2 · Paywall + money — most likely 3am ticket source

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 2.1 | P0 | **Whop webhook drop resilience.** On app boot AND every 60s while user is on paywall screen, poll `/whop/verify?user_id=…` to check Whop's source-of-truth. Never wait purely on webhooks. | Webhooks are over the internet — sometimes 6s, sometimes 6min, sometimes never. Symptom: user paid on Whop, app says "not upgraded." They rage, refund, screenshot to X. | DEV |
| 2.2 | P0 | **Failed-card banner + one-click fix.** On `subscription_status = past_due`, show persistent banner "your card failed, update it here" that links to `WhopAction.PAYMENT_METHODS` (helper already exists). | Silent lockouts = angriest users. 15 min work. | DEV |
| 2.3 | P0 | **Refund policy in writing.** Public paragraph on marketing site + linked from checkout modal. Suggest: "7-day full refund, no questions." | Beta users will ask. Without a stated policy, every ask is a negotiation. | OPS |
| 2.4 | P1 | **Chargeback = auto-ban.** On Whop `payment.chargeback` webhook, immediately lock the user's account. | Right now Whop tells us via webhook, but I don't see the ban logic. Without it, chargebacked users have permanent free access — farming. | DEV |
| 2.5 | P1 | **Trial-expiry warning.** 24h before free-tier limits kick in (100 exports, N clips, etc.), fire a warning banner + email via Resend. | Silent lockouts = angriest users, part 2. | DEV |
| 2.6 | P2 | **Cancellation save flow.** Before "cancel" completes, offer 30% off next month or a downgrade to a lower tier. | 15-25% save rate is standard in mature SaaS. | DEV |

---

## 3 · Customer journey — the invisible churn

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 3.1 | P0 | **First 30 seconds after install.** Cold-Mac install → what does a new user see? Blank cockpit? A Kade greeting overlay pointing at "click here to start"? | If they can't reach "made my first clip" in <5 min, D1 retention is dead. | DEV |
| 3.2 | P0 | **Funnel instrumentation.** PostHog events on: `install`, `signin`, `import_video`, `clip_generated`, `clip_exported`, `submission_posted`, `first_payout`. | Without this, we can't see where the 275 are dropping off. `VITE_POSTHOG_KEY` is required-env; verify it's set in prod build. | DEV |
| 3.3 | P0 | **Update rollback lever proven.** v2.3.70 ships → 3h later a user reports app boot loop → what do we do? | If it's "wait for devs to cut v2.3.71" you have 275 people churning. Runtime-bundle rollback (`/runtime/manifest.json` demote) needs to be TESTED before launch, not on launch day. | DEV |
| 3.4 | P1 | **Empty states everywhere.** No campaigns? No clips? No submissions? No wallet balance? Each list surface needs a designed empty state with a next-action, not a blank grid. | Blank = "app is broken." | DEV |
| 3.5 | P1 | **Notifications.** User submits a clip → hears nothing for 3 days → forgets app exists. In-app badges + optional email for: submission accepted, clip approved, payout confirmed, campaign brief updated. Resend already installed. | Silence kills retention. | DEV |
| 3.6 | P1 | **Referral loop live.** I saw `/affiliate/*` backend endpoints — is there a user-facing "share to earn" surface? A shareable `/join/{handle}` URL that credits the referrer? | 275 → 10k without WOM is nearly impossible. This is the single highest-leverage add for a beta cohort. | DEV |

---

## 4 · Support surface — where beta users will scream

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 4.1 | P0 | **In-app "report a bug" that reaches you.** A visible button in settings/Kade menu that opens the `#bugs` community channel or emails support@liquidclips.app with diagnostic auto-attached. | I saw a `#bugs` channel in the community seed — is a button pointing at it? If it's buried, expect X @-mentions instead. | DEV |
| 4.2 | P0 | **support@liquidclips.app is a real, monitored inbox.** With a public SLA (12h response, 48h resolution). | Say it publicly so users don't spiral. | OPS |
| 4.3 | P0 | **Status page.** `status.liquidclips.app` — free-tier Statuspage.io or a Vercel-hosted markdown. Auto-updated (Better Uptime hits `/healthcheck` every minute). Linked from the Kade crash-repair screen. | When Railway backend is down, users see "everything is broken" and blame us. Status page redirects the rage. | DEV |
| 4.4 | P1 | **Diagnostic export from happy-path.** "Copy diagnostics to clipboard" button in Settings that dumps: version, JWT status, last 10 error events, sidecar health. | I saw this in the crash-repair screen — need it in Settings too, before things break. | DEV |
| 4.5 | P1 | **FAQ + 20 short video walkthroughs.** 20 questions cover 80% of tickets. | One page answers everyone instead of 275 replies. | OPS |

---

## 5 · Data — measure or you're guessing

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 5.1 | P0 | **Sentry wired end-to-end + alerts routed to phone.** `VITE_SENTRY_DSN` in required-env — verify it's set in prod. Alerts fire to phone/email? Or does no one see them? | You can't fix what you can't see. | BOTH |
| 5.2 | P0 | **PostHog events firing in prod.** See #3.2 — same story. Verify events land in the actual PostHog project before launch. | Ditto. | DEV |
| 5.3 | P1 | **Founder-morning dashboard.** ONE URL with: DAU, WAU, signups today, MRR, top 5 errors last 24h, oldest unanswered ticket. Grafana or scheduled Slack report. | Everything else is noise; this is the daily pulse. | BOTH |

---

## 6 · Legal + compliance — the boring, launch-blocking one

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 6.1 | P0 | **Terms of Service + Privacy Policy exist, live, linked at signup.** Termly / Iubenda templates work — $10/mo. Cover Whop payment relationship. | Non-negotiable. LC handles user videos, PII, payment info. | OPS |
| 6.2 | P0 | **DMCA takedown process.** Public page `liquidclips.app/dmca` with a contact form + response SLA. | Clipping = downloading + reposting = copyright landmines. Whop can suspend our merchant status if complaints go unanswered. | OPS |
| 6.3 | P0 | **Age gate at signup.** Clerk supports a birthday field — add it. Whop requires 18+. | Under-18 users = legal liability. | DEV |
| 6.4 | P1 | **Data deletion endpoint.** `DELETE /me` that cascades: user row, submissions, wallet ledger, chat messages. GDPR/CCPA compliance. | Auditable process — not "email us to delete." | DEV |
| 6.5 | P1 | **Tax messaging in ToS + FAQ.** Users earning >$600/yr get 1099s (Whop handles issuance). Make the relationship clear so we don't get "you owe me a 1099" tickets. | OPS | OPS |

---

## 7 · Scale at 275 users specifically

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 7.1 | P0 | **WebSocket ceiling load test.** 275 concurrent users = 275 open WS connections to junior-backend. Railway single-replica (`numReplicas: 1` per `railway.json`) — verify uvicorn workers × connections handle this. `wrk` or `artillery` to 300 concurrent. | If backend falls over at 200 users, launch = disaster. | DEV |
| 7.2 | P0 | **AI provider spend caps.** Anthropic + OpenAI hard $/day caps in their dashboards. Code-level circuit breaker if a request loop starts spending. | Without caps, one buggy loop can eat $10k in a day. | DEV |
| 7.3 | P1 | **Storage cost model.** Each user × N clips × 20MB. At 275 users × 10 clips/wk × 20MB = 55 GB/wk. Where does that live? Local? R2? Vercel Blob? What's the monthly cost? | You'll get a surprise bill in month 2. | DEV |
| 7.4 | P1 | **Video processing queue depth.** If 50 users export simultaneously, does the 51st get "queued 15 min" or "failed"? Test with concurrent invocations. | Timeout errors on paid features = churn. | DEV |
| 7.5 | P2 | **Backend memory watch.** FastAPI + APScheduler + sync SQLAlchemy has a ceiling. Watch Railway metrics under load. | Railway auto-restarts on OOM but session state drops. | DEV |

---

## 8 · Hidden dependencies — the "unknown unknowns"

| # | P | Item | Why it hurts | Owner |
|---|---|---|---|---|
| 8.1 | P0 | **M-series (aarch64) DMG walked on real M-series Mac.** The Intel DMG was walked today (this Mac). The M-series build is a separate binary that ships in the same release. | Half of Mac buyers are M-series. Untested = Rosetta bugs, dylib crashes, notarization drift. | OPS |
| 8.2 | P1 | **OpenAI down fallback tested.** Sidecar already has OpenAI → Anthropic fallback per commit history. Verify it actually flips when OpenAI 500s (mock it). | If untested, first OpenAI outage kills clip generation for everyone. | DEV |
| 8.3 | P1 | **Whop down banner.** When Whop's `/api` returns 5xx, show a status banner in the paywall + payout surfaces. Queue submissions locally to retry. | Prevents the "app is broken" screams. | DEV |
| 8.4 | P1 | **JWT refresh under real load.** `sync` rotates JWT when ≤5 days left. Verify a user who's been offline for 25 days gets a clean refresh on next boot, not a login loop. | Silent lockouts, part 3. | DEV |
| 8.5 | P2 | **min-macOS version gate.** Some users are on Big Sur (11.x) — Tauri 2 requires 10.15+ but some plugin deps drift higher. Add a gate at signup or in the DMG so they don't install a broken app. | Prevents the "app crashes on launch" ticket flood from OS-outdated users. | DEV |

---

## The 24-hour prioritized list

If we only had 24 hours before launch, in order:

1. **Instrument the funnel + wire Sentry alerts to Daniel's phone** (#3.2, #5.1). Without these, we launch blind.
2. **User lookup + kill switches in admin** (#1.1, #1.3). Everything else is a paper cut. Not having admin tools is a heart attack.
3. **Whop webhook resilience polling** (#2.1). Otherwise every payment-not-recognized ticket comes to you.
4. **ToS + Privacy + DMCA pages live** (#6.1, #6.2). Compliance-blocking.
5. **Status page live + linked from crash screen** (#4.3). Deflects the rage.
6. **M-series DMG walked end-to-end** (#8.1). Half your users.
7. **Cold-start user journey verified** (#3.1). If new users can't reach the aha moment, everything else is wasted.

---

## What's already handled by the current PR

For clarity, the following are DONE on `launch/community-fix-2.3.70`:

- Community route crash fix (`mentioned_user_ids` + `reactions` both defensive)
- Whop URL auto-capture (Rust `browse:url-changed` event + JS matcher)
- Kade wizard for the Post-to-Whop flow (4 steps, per-campaign dismiss, auto-advance on capture)
- Auto-fill of Whop reward URL into agency campaign forms (both create + edit)
- Coming-soon coerce for every clipper-facing campaign (env-flag gated, belt-and-suspenders Submit CTA gate)
- Community-chat-home Playwright suite fixed (11/11 pass, was 11/11 failing pre-fix)

Verified: `tsc` clean, vitest 713 pass, targeted Playwright green.

---

## How to use this doc

- **Devs Monday review:** treat sections 1-8 as a single sprint backlog for the 2-3 weeks post-launch. Tag each item with an issue number.
- **Daniel:** own the OPS-labeled items yourself. Don't ask devs to write ToS.
- **Update this doc** as items land. Delete rows that are done. Add rows we discover in production.

The launch is not "ship the DMG." The launch is "275 people used the app for a week without a fire." The gap between those two is this doc.
