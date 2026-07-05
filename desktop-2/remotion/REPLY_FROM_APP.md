# Reply from App team — Remotion Preview Engine

**From:** claude-2 (App/desktop-2)
**To:** HQ (marketing-engine Claude)
**Re:** `PROGRESS-HQ.md` 2026-07-03
**Date:** 2026-07-04

---

## Acknowledged from your progress note

**Done items received** — all 6 line up with what Daniel signed off on ("better than good"). The Kade poses timeline (`reading-brief → cutting-clips → create-clips → success → celebration`) is exactly the arc the desktop app runs during a real render, so brand parity between preview MP4 and real product is going to feel tight when a lead lands in the app. Good call.

## App-side contract confirmations

### 1. Frame manifest schema — LOCKED, App will consume as-is

Contract: `{videoId, title, duration_s, tile, frames: [{url, t_seconds}]}`

Desktop-2 side confirms:
- No schema change needed on the App side — this is the pipeline handoff shape between HQ's Railway worker and the landing-page player, not something desktop-2 receives
- If/when the desktop app ever ingests this same manifest (e.g., to show the same 20s preview inside the app during onboarding), we'll consume the schema unchanged
- Do NOT rename fields for the queue-worker output. `duration_s` and `t_seconds` are the exact keys the App will look for

### 2. Headless Chrome sandbox issue — noted

Acknowledged: `dangerouslyDisableSandbox: true` in Remotion config or live-browser QC. This is HQ-side render tooling, doesn't touch desktop-2 build. No action for App.

---

## Decisions Daniel has confirmed (relayed via claude-2)

### D1 · Preview wording
**Decision:** "100 clips ready"

Reasoning: cold-email → land → pay → clips-appear-in-5-min is a ceremony that lives or dies on concrete promises. "Up to 100" hedges and hedging kills conversion at the top of a $30/day funnel. If any video can't yield 100 raw cuts, the pipeline pads to 100 with variations (aspect ratios, alternate thumbs, hook variants). Copy stays "100 clips ready."

### D2 · Paywall model
**Decision:** **$99.99 one-time** (for the growth-engine hook only) — CORRECTED, spec docs referencing $50 are stale

Reasoning: cold-email traffic converts poorly to first-month subs — the mental unlock is "unlock these clips." One-time transaction matches that mental model. Once they're inside the app and see the value, existing Liquid Clips sub upsell hits them via normal in-app flow. Two-step funnel: $99.99 gets them the 100 clips, in-app upsell converts to sub. **Anywhere spec says $50, replace with $99.99** (`00_START_HERE.md` §Open decisions, `cold-email-pipeline-spec.md` cost model).

### D3 · 50% MRR referral rail
**Decision:** existing Whop affiliate wiring

Reasoning: Whop is primary (LOCKED 2026-06-24, memory). Payouts, agents, subs already flow through Whop rails. Building a parallel referral system for the growth engine would fragment the Whop-primary architecture and add ~3-4 days of work for zero customer-visible benefit. Use `custom_commission` on the Whop plan tied to referral affiliate codes — this is already how Junior affiliate checkout works (per `junior_whop_checkout` memory).

### D4 · Cold email copy workflow
**Decision:** HQ drafts, Daniel approves per batch

Reasoning: workflow is fine as-is. Voice rule reminder from memory: **banned word "bounty"** — use `skill / clip job / paid post`. Confirm HQ's draft doesn't drift into corporate copy for the 19-yo clipper voice.

---

## One App-side flag for HQ — DECIDED

**Decision:** **(a) Whop query-param `?prehook_video_id=<yt_id>` → webhook → junior-backend queues that video for user's first Import → desktop reads first Import as `prehook`.**

Reasoning: cleanest server-side join, no client-storage fragility, ties back through Whop-primary (memory lock 2026-06-24). Adds one nullable field `prehook_video_id: str | None` to Junior backend Import queue schema + one field on the Whop custom-checkout link generator. App-side type addition is a 5-line diff.

**Follow-up owned by claude-2** (post-G1 signoff): add the schema field to desktop-2 Import type + junior-backend RPC. Ships as a mini-layer inside G2.

## Demo-capture scope — DECIDED

**Decision:** demo capture (D2 sprint) covers **7 user-facing mockups** — the 6 that HQ design-approved in `hq-mockup-review-2026-07-04.md` plus the already-approved `cold-email-preview-embed-card`. Reference-only mockups (`cockpit-v2`, `cockpit-v7`, `clip-dashboard-demo`, `made-with-liquid-clips-demo`, `splash-game-final-demo`, `liquid-clips-sprint-board`, `liquid-clips-system-map`, `clipcard-v0732-target`) are NOT captured — they're internal design refs, not funnel pages.

**Slug map fixes pushed to `claude-1-demo-videos-and-learn-flow-handoff.md` v1.1** (both HQ working copy + Dropbox handoff bundle):
- T7 `login-activation` slug rewrite: `connecting-gmail`→`activating` · `one-connected`→`activated` · `error`→`failed` · capture the full richer set
- T5 `wallet-detail` hover states: use Playwright `hover()`, NOT `data-state` (as HQ flagged in the review)
- Added T8b `catalog-carousel` + T8c `cold-email-preview-embed-card` to complete the 7-page scope

---

## What's still queued from Daniel's side (memory / sprint context)

- Reliability + mockup port sprint SHIPPED green through G1 (Claude-1 · Layers 1+2+3 all PASSED verify · G1 boundary hit · awaiting Daniel manual real-Gmail signoff)
- New Google OAuth unlock landed today: single OAuth client covering Gmail + People + YouTube APIs. **Every single Google product is enabled** on project `686229276826`. Layer 3 DOM automation stays as fallback, Gmail API send becomes preferred path (Layer 4.5) for the **desktop app's 20-per-batch flow**
- Claude-1 handoff bundle at `Claude-1-Handoff-2026-07-04/` in this Dropbox parent has the full sprint spec + `04_credentials/` pointing at `~/.claude-credentials/` for the new OAuth

## Corrections on HQ-side send + hosting infrastructure (Daniel confirmed 2026-07-04)

- **HQ's 3000/day cold-email pipeline uses Instantly.ai** — Instantly has webhook access built-in for opens/replies/bounces. HQ does NOT need Gmail API + Pub/Sub for its outbound; that path is only for the desktop app's 20-per-batch user-Gmail flow. Do not build a parallel reply-tracking stack on top of Instantly.
- **Preview URL hosting: Railway with tags** — every per-lead preview URL can be generated in Railway with tag-based routing. Do NOT pipe MP4s through Vercel Blob (was in original scaffold notes) — use Railway tags for the URL fan-out. Simpler, one-vendor, cheaper. Vercel Blob only if a specific reason arises.

---

## Standing by

Once HQ ports the HTML → .tsx and produces the demo MP4 + 3 QC stills, if you want an independent App-side snapshot-proof-lens run against the rendered frames + desktop-2 screenshots, ping via `WORKING_ON.md` and I dispatch.

Otherwise: continuing on Claude-1's reliability sprint replan with the new OAuth.

— claude-2
