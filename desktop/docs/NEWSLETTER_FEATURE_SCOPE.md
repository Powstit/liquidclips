# Newsletter Feature — Scope (Liquid Clips marketing site)

**Status:** SCOPE ONLY (no code in this doc). Awaiting Daniel decisions before execution.
**Repo:** `liquidclips-marketing/` (Next.js 16 App Router, Vercel-deployed at `liquidclips.app`).
**Author:** Claude, 2026-06-10.
**Reference style:** matches `SHIP_v0.7.32_BLOCKERS.md` + `KIMI_B3_WHOP_HANDOFF.md` — specific, opinionated, action-oriented.

---

## Goal

Ship `liquidclips.app/newsletter` as a programmatic-SEO surface that publishes 1-3 long-form posts per week, targeting the long-tail clipping keyword cluster (`clipping rewards`, `YouTube to TikTok clips`, `creator clipping platform`, `podcast clip maker`, `Whop content rewards explained`, `how to make money clipping podcasts`, etc.). Every post is an organic-search entry point that funnels readers to `/start` and `/download`.

Success measured as:
- 20+ indexed posts within 30 days of launch.
- First post ranks page 1 for at least one tracked long-tail term within 90 days.
- Newsletter referral traffic → `/start` conversion ≥ 1.5% of post pageviews.

## Non-goals

- Not a content-marketing blog with author bylines, comments, or social-style engagement.
- Not a CMS rebuild of the marketing site. The site stays statically generated; newsletter posts join the same SSG output.
- Not gated content. Every post is fully public, no email-capture wall in front of the body.
- Not a news aggregator (no scraping competitor blogs / Reddit / Twitter).
- Not Windows/Linux content (we stay Mac-only consistent with the rest of the site).
- Not multi-author. One brand voice (Daniel-as-arcade-owner), no contributor model.

---

## Information architecture

```
/newsletter                       → index, 12 most-recent posts, paginated /newsletter?page=2
/newsletter/<slug>                → individual post (MDX → static HTML)
/newsletter/tag/<topic>           → tag landing page (e.g. /newsletter/tag/whop-rewards)
/newsletter/rss.xml               → RSS 2.0 feed of full post bodies (Vercel-edge generated)
/newsletter/sitemap.xml           → posts sitemap, merged into root /sitemap.xml
```

**Route ownership:**
- `liquidclips-marketing/src/app/newsletter/page.tsx` — index list.
- `liquidclips-marketing/src/app/newsletter/[slug]/page.tsx` — post page (uses `generateStaticParams`).
- `liquidclips-marketing/src/app/newsletter/tag/[topic]/page.tsx` — tag landing.
- `liquidclips-marketing/src/app/newsletter/rss.xml/route.ts` — RSS route handler.
- `liquidclips-marketing/src/app/newsletter/sitemap.ts` — Next 16 sitemap export.

**Index page layout:** mirrors `/help` — a single `PageShell` with an arcade eyebrow (`NEWS WIRE` or `BONUS LEVEL`), section heading, and a `.feature-grid` of post cards. Each card = thumbnail (optional), date, title, lede (160 char), tag chips, "Continue reading →".

**Tag taxonomy (fixed at launch — no free-form tags):**
- `clipping-101`
- `whop-rewards`
- `youtube-to-shorts`
- `podcast-clips`
- `twitch-vods`
- `tiktok-strategy`
- `case-study`
- `app-release`

Free-form tags create canonical-tag hell. A fixed 8-tag set keeps the IA shallow.

---

## Content generation pipeline

### Option compare

| Option | Cost / post | Quality control | Brand voice risk | Ship time |
|---|---|---|---|---|
| (a) Fully automated cron — GPT-4o + prompt template, push straight to MDX | ~$0.05 | None | High (drift to generic SEO) | 3 days |
| (b) Human-in-the-loop — AI drafts → Daniel approves in CLI → publish | ~$0.05 + 5 min review | High | Low | 3 days |
| (c) Full automation + quality gate (auto-rubric scoring, retry, threshold) | ~$0.15 | Medium | Medium | 7 days |

### Recommendation: **Option (b) — human-in-the-loop CLI**

Reasoning:
1. Daniel personally lands the brand voice (`/start` page, homepage, arcade vocabulary). One bad auto-published post that calls Liquid Clips "a leading creator monetization SaaS" undoes the moat the brand is built on.
2. Review takes 3-5 minutes per post once the template is dialed. At 2 posts/week that's a 10-minute weekly tax.
3. Option (a) earns one Google AI-content penalty hit and the whole `/newsletter` subtree gets demoted.
4. Option (c)'s rubric scoring is engineering theater — every "quality gate" worth shipping ends up being "would Daniel approve this?" and we've reimplemented option (b) with extra steps.

### Pipeline shape

```
liquidclips-marketing/scripts/newsletter/
  ├── topic-queue.json          ← seed list + future topics, append-only
  ├── generate.ts               ← reads queue, calls OpenAI/Anthropic, writes draft .mdx to /drafts
  ├── prompt-template.md        ← the system prompt (brand voice, structure rules, banned phrases)
  └── publish.ts                ← validates frontmatter, moves draft → /content/newsletter, commits
```

**Generator command:**

```bash
cd liquidclips-marketing
npm run newsletter:draft          # generates next post from queue, opens in $EDITOR
npm run newsletter:publish <slug> # validates + moves draft → published, commits + opens PR
```

**Model choice:** Claude Sonnet 4.6 via Anthropic SDK (per `~/.claude-credentials/anthropic.env`). Lower hallucination rate than GPT-4o on style-mimic tasks, and the prompt caching on the brand template cuts per-post cost by ~60%.

**Cadence:** Daniel runs `newsletter:draft` Sunday evening, approves + ships 2 posts for the week.

---

## Storage

### Option compare

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| MDX files in repo (`content/newsletter/*.mdx`) | Version controlled, no runtime DB, SSG-native, $0 hosting, diffable in PRs | Manual frontmatter, no live preview without rebuild | ✅ Pick |
| Supabase / Postgres | Live edits without redeploy, multi-author capable | Adds DB to a static site, runtime cost, eventual consistency on cache | Skip |
| Notion-as-CMS | Daniel edits in Notion | API rate limits, Notion's rich-text → MDX conversion is lossy, vendor lock | Skip |
| Sanity / Contentful | Production CMS | Overkill, monthly cost, schema migration overhead | Skip |

### Recommendation: **MDX files in repo**

`liquidclips-marketing/content/newsletter/<slug>.mdx`. Each post is a versioned artifact. Publishing = commit + PR + auto-deploy via Vercel. Rollback = `git revert`. No runtime database surface for Google to find slow.

**MDX frontmatter (locked schema):**

```yaml
---
title: "How to clip a 3-hour podcast into 30 TikToks in under 15 minutes"
slug: "podcast-to-tiktoks-in-15-minutes"
date: "2026-06-15"
lede: "The honest workflow — paste the YouTube link, let hosted AI pick the 30 strongest moments, scrub the obvious ones, ship them with burnt captions. No timeline."
tags: ["podcast-clips", "clipping-101"]
keywords: ["clip podcast to tiktok", "podcast clip maker", "youtube podcast to shorts"]
ogImage: "/newsletter/og/podcast-to-tiktoks.png"   # optional, falls back to /brand/og-default.png
generated: true                                     # auto-true if AI-drafted, false if Daniel-written
reviewedBy: "daniel"                                # required for `generated: true` posts
---
```

**MDX rendering:** `@next/mdx` plugin already standard in Next 16. Custom components mapped to brand classes (`<h2>` → `.section-title`, callouts → `.help-callout`, code → JetBrains Mono inline).

---

## SEO defaults

Every post page auto-emits:

1. **`<title>`** — `<post.title> — Liquid Clips`
2. **Meta description** — `post.lede` (≤ 160 chars, validated at build).
3. **Canonical** — `https://liquidclips.app/newsletter/<slug>`.
4. **OpenGraph** — title, description, `og:type=article`, `og:url`, `og:image` (post-specific or `/brand/og-default.png`), `article:published_time`.
5. **Twitter Card** — `summary_large_image`.
6. **Keywords meta** — `post.keywords` joined.
7. **JSON-LD `Article` schema** (see below).
8. **`hreflang`** — single `en-US`, no i18n at launch.

### JSON-LD Article schema (auto-injected)

```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "How to clip a 3-hour podcast into 30 TikToks in under 15 minutes",
  "description": "The honest workflow — paste the YouTube link, let hosted AI pick...",
  "image": "https://liquidclips.app/newsletter/og/podcast-to-tiktoks.png",
  "datePublished": "2026-06-15T00:00:00Z",
  "dateModified": "2026-06-15T00:00:00Z",
  "author": { "@type": "Organization", "name": "Liquid Clips" },
  "publisher": {
    "@type": "Organization",
    "name": "Liquid Clips",
    "logo": { "@type": "ImageObject", "url": "https://liquidclips.app/brand/logo-512.png" }
  },
  "mainEntityOfPage": "https://liquidclips.app/newsletter/<slug>"
}
```

### Internal linking pattern

Every post MUST contain:
- One inline link to `/start` ("get started clipping" anchor or similar contextual).
- One inline link to `/download` (or to a `DownloadCTA` component embedded mid-post).
- At least two tag-page links to related posts (`/newsletter/tag/<topic>`).
- One footer CTA component shared across all posts — see `NewsletterFooterCTA` below.

Enforced at build by `scripts/newsletter/validate.ts`. Missing links = build fails.

### robots.txt + sitemap

- `liquidclips-marketing/public/robots.txt` allows all of `/newsletter/*` (it already allows everything except `/api/*`).
- `liquidclips-marketing/src/app/sitemap.ts` extends to merge in newsletter slugs at build time via `generateSitemaps` + the same source-of-truth glob as `generateStaticParams`.
- RSS feed at `/newsletter/rss.xml` referenced from `<head>` on `/newsletter` index for feed-reader discovery.

---

## Newsletter delivery (email)

### Decision: web-first at launch. Email = Sprint follow-up.

Reasoning:
- The primary goal is SEO, not email-list growth.
- Resend is wired in `junior-backend/`, NOT in `liquidclips-marketing/`. Wiring it into the marketing repo means a new Resend project, audience setup, double-opt-in form, unsubscribe page, GDPR footer. That's a sprint of its own.
- The RSS feed at `/newsletter/rss.xml` gives early subscribers a path without us building email infra.

**Phase 2 (post v0.7.45):** add email if `/newsletter` index pageviews show a meaningful follower curve. Plan:
- Add Resend to `liquidclips-marketing/` with a dedicated audience `newsletter-subscribers`.
- Build `<NewsletterSignup>` component (paper form, single email field, fuchsia submit, JetBrains Mono confirmation).
- Cron Vercel route `/api/newsletter/dispatch` sends each new post to the audience on publish.
- Compliance page: `/newsletter/unsubscribe` + footer link.

Not in v0.7.45. Logged here so it's not forgotten.

---

## Brand tone

Match the arcade vocabulary from `/start` and `/page.tsx`. The posts are written from the arcade-owner POV — opinionated, specific, hostile to fluff.

**Voice rules:**
- Headers use eyebrows: `BONUS LEVEL`, `POWER-UP`, `NEW WIRE`, `CHEAT CODE`, `LEVEL CLEAR`.
- Open with a concrete claim or numbered fact. Not "In today's fast-paced creator economy…".
- Past tense for done work, present tense for product capability, no future-promise hedges ("will eventually support…").
- No emojis. No exclamation marks. No "leverage", "unlock", "synergy", "in this article we'll explore".
- Specific dollar amounts, specific clip counts, specific runtime numbers. Same as the AISHA / MARCO / ZARA testimonials on the homepage.
- One inline `<em>` per H2 for emphasis (mirror `/start` H1: "Start clipping. *YouTube, TikTok, podcasts* — all in 60 seconds.")

**Banned phrases (validated at publish time):**
- "creator economy"
- "leverage"
- "in today's fast-paced"
- "unlock the power of"
- "game-changing"
- "revolutionize"
- "next-level"
- "supercharge"

`scripts/newsletter/validate.ts` greps for these and fails the publish step.

**Example post titles (voice-correct):**
- "How AISHA hit $3k/mo clipping Joe Rogan back-catalogue podcasts"
- "The actual math on Whop Content Rewards (CPM, qualifying thresholds, dedupe)"
- "Why we burn captions instead of soft-rendering them — and what TikTok's algorithm rewards"

---

## Topic queue (seed list — 20 posts)

```
1.  How to clip a 3-hour podcast into 30 TikToks in under 15 minutes
2.  The real cost of clipping Joe Rogan back-catalogue (per-clip OpenAI + your time)
3.  Whop Content Rewards explained — payouts, CPM, qualifying thresholds, dedupe
4.  Why we burn captions instead of soft-rendering them (and what TikTok rewards)
5.  YouTube long-form to Shorts — the 5-step Liquid Clips workflow
6.  TikTok 60-minute uploads — what changes for clippers
7.  Twitch VOD clipping — finding stream spikes without watching the stream
8.  Podcast clip maker comparison — Liquid Clips vs Opus vs SubMagic
9.  The Mac-only decision — why we shipped no Windows build (and won't)
10. Face-aware reframing — how the auto-crop actually works
11. Hosted AI vs BYO key — when each plan makes sense for a clipper
12. 100 free clips on the Starter Pass — what you can actually do with them
13. The Earn tab walkthrough — submitting clips, tracking views, getting paid
14. Anatomy of a clip that hits — first 3 seconds, hook, caption, payoff
15. Sunday-night clipping routine — running a podcast farm from one Mac
16. How MARCO turned poker streams into $1.2k his first weekend
17. The 9:16 reframe + dead-air cut — why pacing matters more than picks
18. Twitch-to-TikTok clipping (chat-driven peaks, gameplay clutches, audio reactions)
19. Lifting podcast transcripts — when you want a Script, not a Clip
20. Liquid Clips v0.7.32 release notes — what shipped, what's next
```

Stored in `liquidclips-marketing/scripts/newsletter/topic-queue.json` as an append-only list. `generate.ts` pops the first un-drafted topic each run.

---

## Implementation steps

1. **Add MDX support to marketing site.**
   - `liquidclips-marketing/next.config.ts` → add `@next/mdx` plugin.
   - Install: `@next/mdx`, `@mdx-js/react`, `gray-matter`, `reading-time`.
   - Add `mdxComponents.tsx` mapping `<h2>` → arcade eyebrow + section title, `<a>` → `.inline-link`, etc.

2. **Create content directory + first seed post.**
   - `liquidclips-marketing/content/newsletter/podcast-to-tiktoks-in-15-minutes.mdx`
   - Hand-write this one (Daniel) so the AI has an in-voice target to mimic.

3. **Create route files.**
   - `src/app/newsletter/page.tsx` — index, lists all posts from `content/newsletter/*.mdx` sorted by date desc.
   - `src/app/newsletter/[slug]/page.tsx` — post page with `generateStaticParams` over the content glob.
   - `src/app/newsletter/tag/[topic]/page.tsx` — tag landing.
   - `src/app/newsletter/rss.xml/route.ts` — RSS handler.
   - `src/app/newsletter/sitemap.ts` — sitemap entries.

4. **Build shared `NewsletterFooterCTA` + post-card components.**
   - `src/components/NewsletterFooterCTA.tsx` — full-bleed bottom section, eyebrow `LEVEL CLEAR`, "Ready to clip? — Download Liquid Clips" headline, `DownloadCTA`.
   - `src/components/NewsletterPostCard.tsx` — index card.

5. **Wire SEO emitter.**
   - `src/app/newsletter/[slug]/page.tsx` exports `generateMetadata({ params })` reading frontmatter.
   - Embedded `<script type="application/ld+json">` for `Article` schema, same pattern as `/start`.

6. **Build the generation pipeline.**
   - `scripts/newsletter/generate.ts` — reads `topic-queue.json`, calls Anthropic SDK with the brand prompt template, writes draft to `drafts/<slug>.mdx`.
   - `scripts/newsletter/prompt-template.md` — system prompt: voice rules, banned phrases, structure (H2 count, internal-link requirements, frontmatter shape).
   - `scripts/newsletter/validate.ts` — grep banned phrases, validate frontmatter, check internal links, check word count (1200-2400).
   - `scripts/newsletter/publish.ts` — runs validate, moves `drafts/` → `content/newsletter/`, commits with message `feat(newsletter): publish <slug>`.

7. **npm scripts.**
   ```json
   "newsletter:draft": "tsx scripts/newsletter/generate.ts",
   "newsletter:validate": "tsx scripts/newsletter/validate.ts",
   "newsletter:publish": "tsx scripts/newsletter/publish.ts"
   ```

8. **Ship hand-written seed post + 2 AI-drafted-then-reviewed posts.**
   - Verifies the pipeline end-to-end before claiming feature complete.

9. **Submit `/newsletter/sitemap.xml` to Google Search Console** (Daniel does this in the GSC UI).

10. **Add `<link rel="alternate" type="application/rss+xml" href="/newsletter/rss.xml">`** to root `layout.tsx` head.

---

## Risk + mitigations

| Risk | Mitigation |
|---|---|
| Google AI-content penalty (March 2024 + ongoing updates) | Human-in-the-loop review gate. `generated: true` posts go through Daniel before publish. Word count floor 1200, banned-phrase grep. First-person specifics in every post. |
| Brand voice drift across 20+ auto-drafted posts | Prompt-template caching on Anthropic, locked banned-phrase list, manual review. Re-evaluate template every 10 posts. |
| Duplicate content with `/start`, `/help`, homepage | Canonical URLs locked per page. Posts cite + link to canonical surfaces, never re-explain core product copy verbatim. |
| Slug collisions / typos breaking `generateStaticParams` | `validate.ts` greps for existing slug before publish. CI build fails on collision. |
| RSS feed exposes draft posts | `drafts/` lives outside `content/`. Glob in feed handler is `content/newsletter/*.mdx` only. |
| Newsletter index becomes thin-content on Day 1 (only 1-2 posts) | Hand-write 3 seed posts before launching the route publicly. Daniel writes #1, AI-drafts + reviews #2 and #3. |
| AI hallucinates a Liquid Clips feature that doesn't exist | Prompt template includes "If you'd describe a feature that isn't documented at /start or /help, replace with the closest documented capability or remove the claim." Validate step greps for forbidden terms like `Liquid Clips Cloud`, `Liquid Clips Pro Team`, `Windows`, `Linux`. |
| Resend wiring sprawl creep | Defer email entirely to Sprint 2. v0.7.45 is web-only. |
| iOS/Android post claims | Banned-phrase grep includes "iOS", "Android", "iPhone app", "mobile app". |

---

## Acceptance criteria

- ✅ `liquidclips.app/newsletter` returns HTTP 200 with 3+ post cards rendered.
- ✅ `liquidclips.app/newsletter/podcast-to-tiktoks-in-15-minutes` (or whichever seed slug) renders with brand styling.
- ✅ `liquidclips.app/newsletter/rss.xml` returns valid RSS 2.0 (verified via `https://validator.w3.org/feed/`).
- ✅ `liquidclips.app/newsletter/tag/whop-rewards` returns at least 1 post.
- ✅ Each post page contains JSON-LD `Article` schema (verified via `https://search.google.com/test/rich-results`).
- ✅ Each post links to `/start` AND `/download` at least once (build fails otherwise).
- ✅ `liquidclips.app/sitemap.xml` includes all published slugs.
- ✅ `npm run newsletter:draft` generates a new MDX draft from the topic queue.
- ✅ `npm run newsletter:validate <slug>` passes for all 3 seed posts (banned phrases, frontmatter shape, internal links, word count).
- ✅ `npm run newsletter:publish <slug>` moves draft → published + commits.
- ✅ Google Search Console submission of newsletter sitemap acknowledged.
- ✅ No console errors on any newsletter route (Sentry + browser devtools verified).
- ✅ Lighthouse SEO score ≥ 95 on a sample post.

---

## Sprint target

### Recommendation: **v0.7.45 — MDX-based, human-in-the-loop, web-only**

Reasoning:
1. **Inside v0.7.45 scope:** The route surface, MDX wiring, generation script, and 3 seed posts are 1-2 day's work for a focused sprint. Doesn't touch desktop, doesn't touch backend, doesn't touch account-app.
2. **No iron gates touched:** Pure marketing-site scope. No IG-001 → IG-008 risk.
3. **Email deferred:** Resend wiring + audience setup + double-opt-in is a separate sprint (v0.7.46+). Keeps v0.7.45 ship-shaped.
4. **The polish gate (`feedback_ship_gate.md`) doesn't apply:** This is the marketing site, not the desktop app's polish blockers.
5. **Why not v0.7.46+ with full automation:** Option (c) above adds engineering theater (rubric scoring, retry loops) that doesn't actually beat human review for brand-voice consistency. Ship the simpler version, learn what breaks, then automate.

v0.7.45 ships as: MDX support + 3 routes + 3 seed posts + generation/validate/publish scripts + Search Console submission. ~2 days.

v0.7.46+ ships as: email (Resend wiring + audience + dispatch route + unsubscribe + GDPR footer) — IF v0.7.45 shows real organic traction.

---

## Rollback plan

- Newsletter routes are SSG'd at build. If a bad post ships, `git revert <commit>` + redeploy via Vercel restores the prior state.
- If the entire feature regresses Lighthouse on `/` or other routes (unlikely but possible via `@next/mdx` plugin side effects): delete `src/app/newsletter/` + `content/newsletter/` + revert `next.config.ts` mdx plugin change + redeploy.
- Vercel keeps every prior production deploy. Promote a known-good deployment in the Vercel dashboard if a full revert is faster.

---

## Daniel's call before execution

1. **Sprint slot:** Confirm v0.7.45 (recommended) or push to v0.7.46+. Locks the timing.
2. **AI model:** Claude Sonnet 4.6 (recommended) or GPT-4o for the generator. Affects per-post cost + voice fit.
3. **Seed post #1:** Daniel hand-writes the first one to set the voice target — or Claude drafts it from a sample paragraph Daniel provides. Affects how quickly we can validate the AI loop.
4. **Email later or never:** Confirm Phase 2 email is "deferred but planned" vs "deferred indefinitely". Affects whether we leave the RSS-discovery footer hook in the seed template now.
