# HQ YouTube Library Response · Analysis

**Received:** 2026-07-17 · 4 files hydrated from Dropbox
**Verdict:** 🟢 **GREEN · PROCEED WITH FULL SCOPE**
**Bonus scope unlocked:** Podcast archive with real transcripts (whisper_needed:false)

---

## Files delivered

| File | Purpose | Size |
|---|---|---|
| `HQ_YOUTUBE_LIBRARY_API_HANDOFF_2026-07-17.md` | Full API spec + scale + endpoints + rights | 12.9 KB |
| `HQ_FRONT_DOOR_UI_2026-07-17.md` | Thumbnail wall implementation guide | 4.8 KB |
| `FRONT-DOOR-thumbnail-wall.html` | Working self-contained thumbnail wall mockup | 17 KB |
| `go-master.html` | Approved landing page (brand reference) | 44 KB |

---

## Q1-Q6 · classification

| # | Question | State | Notes |
|---|---|---|---|
| Q1 | YouTube Data API v3 | ✅ **ANSWERED** | Live · 2 GCP projects · 20k units/day · **file quota increase now** (5-14d approval) |
| Q2 | 1.3M dataset | ✅ **ANSWERED · with critical correction** | 1,318,249 rows · Railway Postgres · **transcripts NOT stored** · caption-first strategy replaces $0-Whisper assumption |
| Q3 | Legal / rights | 🟡 **PARTIAL** | No formal legal opinion (unreviewed) · no DMCA history · safest posture matches recommendation (thumbnails-only + user-machine bytes) |
| Q4 | Railway infra | ✅ **ANSWERED** | Headroom fine · no 150 GB store needed (metadata-only) · thumbs via YouTube CDN (zero egress) |
| Q5 | yt-dlp | ✅ **ANSWERED** | Not bundled · recommend first-run signed helper download |
| Q6 | Existing endpoints | ✅ **ANSWERED · BONUS** | All requested endpoints exist · PLUS podcast integration LIVE · PLUS deep-dive intelligence · PLUS 5 supporting endpoints |

---

## Reality corrections to my original scope

### Correction 1 · Whisper savings are ~70-90%, not 100%

**My original claim:** $34k/yr saved (indexed episodes = $0 Whisper).
**Real number:** ~$3-10k/yr (caption-first strategy · captions cover 70-90% of videos · Whisper only on fallback).

Still a major saving. Still worth the flywheel argument. But **honest number** is important.

### Correction 2 · Podcasts have REAL transcripts · this is the killer

Podcast integration via Podscan is LIVE with:
- Word-level timestamps
- `whisper_needed: false` universally
- Podcast is the #1 clipping format

**Podcast money endpoint:**
```
GET /api/podcast/handoff/<episode_id>
  → { episode_id, kind:"podcast", source_url, audio_url, image, title,
       podcast, duration_s, word_count,
       transcript_segments:[{start_s, end_s, text}],
       moments:[{start_s, end_s, hook}],  // hook = actual opening words
       whisper_needed: false }
```

**We OWN the data.** First `/handoff` call pulls from Podscan and stores permanently in Railway `/data/podcast_cache.ndjson`. Every subsequent call is $0 and instant. Podscan becomes a one-time seed, not a live dependency.

### Correction 3 · YouTube money endpoint is `/api/handoff/<video_id>`

Cache-first with `/data/clip_cache.ndjson`. First call ~0.3s cold resolve, then instant + $0. Returns:
```
{ video_id, source_url, thumb, caption_track_url|null,
  moments:[{start_s, end_s, hook}],
  whisper_needed: bool }
```

`whisper_needed:true` today until the OAuth `captions.list` path is wired. Not a blocker — just means clip first, transcribe on demand.

---

## Full API surface (LIVE now · use freely)

Base URL: `https://hq.liquidclips.com` (also `tally-production-a56d.up.railway.app`)
Auth: `x-hq-secret: <HQ_READ_SECRET>` header on every call

### Library search
```
GET /api/library/search?q=&niche=&tier=&min_subs=&has_video=1&limit=&cursor=
GET /api/library/channel/<lc_id>
GET /api/library/niches
GET /api/library/video/<video_id>
```

### Clip handoff (the money endpoints)
```
GET /api/clip-search?q=&limit=&cursor=
GET /api/clip/<lc_id>/<moment>
GET /api/handoff/<video_id>                     ← YouTube one-call clip start
POST /api/handoff/batch { video_ids: [] }
```

### Podcast (LIVE with real transcripts)
```
GET /api/podcast/search?q=&limit=
GET /api/podcast/shows?q=&limit=
GET /api/podcast/handoff/<episode_id>           ← Podcast money endpoint
POST /api/podcast/handoff/batch { episode_ids: [] }
GET /api/podcast/cache-stats
```

### Deep-dive intelligence (291k profiled channels)
```
GET /api/deepdive?tier=&bucket=&limit=&offset=
GET /api/deep-email-count
```

### Also live (bonus)
```
GET /api/icp-engine    → live pool counters (1.32M, scan/resolve/deepdive progress)
GET /api/cohorts
GET /api/demos
GET /api/brain/latest
GET /api/costs
```

---

## Front-door UI mechanics (from HQ_FRONT_DOOR_UI)

### Zero-cost thumbnail rendering
Wall of 500 clips = ZERO API calls for the images. Browser loads them straight from YouTube's CDN:
```
https://i.ytimg.com/vi/<video_id>/hqdefault.jpg     ← safe default, always exists
https://i.ytimg.com/vi/<video_id>/hq1.jpg           ← frame 1 (start)
https://i.ytimg.com/vi/<video_id>/hq2.jpg           ← frame 2 (middle)
https://i.ytimg.com/vi/<video_id>/hq3.jpg           ← frame 3 (end)
```

Per-lead personalised frames (fair-use safe, proxied through us):
```
https://preview.liquidclips.com/thumb/<raw_email>/1|2|3
```

⚠️ **RAW email, never URL-encode the `@`.** Encoded ones 404. Documented gotcha.

### Grid CSS (locked-in pattern)
```css
.wall  { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(184px,1fr)); }
.tile  { position:relative; aspect-ratio:9/16; border-radius:14px; overflow:hidden; background:#000;
         box-shadow:inset 0 0 0 1px rgba(255,26,140,.16); }
.tile img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.tile:hover { transform:translateY(-4px); box-shadow:inset 0 0 0 1px rgba(255,26,140,.5); }
```

`auto-fill + minmax` = reflows to any width with zero breakpoints.
`aspect-ratio:9/16` = every tile is a vertical-clip shape · no layout shift while loading.
`object-fit:cover` = thumbnails fill cleanly.

### Render pattern (verbatim from HQ)
```js
const r = await (await fetch(`${HQ}/api/library/search?has_video=1&limit=24&q=${q}`, {
  headers:{ "x-hq-secret": SECRET }
})).json();
wall.innerHTML = r.results.map(x => `
  <div class="tile" data-id="${x.video_id}">
    <img loading="lazy" src="https://i.ytimg.com/vi/${x.video_id}/hqdefault.jpg">
    <div class="meta"><div class="nm">${x.name}</div><div class="sub">${x.subs} subs</div></div>
  </div>`).join("");
```

Click a tile → `GET /api/handoff/${id}` → moments to clip. **Done.**

### Brand lock (matches existing Liquid Clips)
- Accent **fuchsia `#ff1a8c`** only
- Warm ink `#f4f1ea` for text · never pure white
- Paper-dark bg `#0a090d`
- Fonts: Inter (UI) + Geist Mono (numbers/labels)
- Cockpit/HUD framing (thin fuchsia inset borders)
- Pixel-invader as the landmark
- No generic SaaS cards

---

## 🔒 Security gate (MUST honour)

**Don't ship `HQ_READ_SECRET` to the desktop client.**

- The demo file has secret pasted in browser for convenience only.
- Production: proxy `/api/library/*` and `/api/handoff/*` through `junior-backend`.
- Attach `x-hq-secret` header server-side. Same calls, secret stays private.

**junior-backend gets 4 new proxy routes:**
```
GET /library/search   →  proxies HQ /api/library/search (attaches x-hq-secret)
GET /library/channel/<id>
GET /library/handoff/<video_id>
GET /podcast/handoff/<episode_id>
```

Desktop calls `junior-backend/library/*` with the existing license JWT. Backend translates to `hq.liquidclips.com/api/library/*` with the HQ secret. No secret leaves the backend perimeter.

---

## Action items · what needs to happen

### For Daniel to authorize / do
1. **File YouTube Data API quota increase** (only real lead-time item · 5-14d approval · file NOW).
2. **Set `YOUTUBE_API_KEY` in Railway env** — one-line fix. Enables `duration_s` + tightens moment grid.
3. **Decide AI B-roll + voice cloning billing** — Studio Unlimited-only (BYOK) vs Studio-included metered. (Still open from earlier.)
4. **Decide social flywheel scope** — the "held" question from earlier · now unblocked.

### For me (executable without further HQ input)
1. **Amend Feature 1 mockup** — add a NEW source ingestion mode "Search library" (6th tile alongside Upload / URL / Screen record / Camera / Split-screen composition).
2. **Build Feature 1B mockup** — the Library front door · YouTube tab + Podcast tab · thumbnail wall · click-to-clip drawer. Adapt HQ's reference HTML to Liquid Clips brand + 1280×820 viewport.
3. **Draft `junior-backend/app/routes/library.py`** — proxy routes for the 4 endpoints (spec only, not code — dev team implements).
4. **Draft yt-dlp first-run signed helper spec** — download-on-demand path per Q5 recommendation.
5. **Update polymorphic source slot contract** — each split-screen slot can now be filled by a library episode too.
6. **Wire the `/api/handoff/<video_id>` money-endpoint call** into the source ingestion pathway.

---

## Killer insight from HQ

> **"We're not renting the data, we're accumulating it."**

Every `/api/handoff` call caches permanently to Railway. Podscan becomes a one-time seed. The more Liquid Clips users clip, the bigger OUR owned transcript archive gets. This is compounding archive value — no competitor starting from scratch can catch up.

This turns YouTube library from a "search feature" into a **strategic data moat that grows with usage.**

---

## Bottom line

- Original scope was too small · HQ handed us the whole engine
- Whisper savings honest number: $3-10k/yr (not $34k) — still substantial
- Podcast archive with real transcripts is a bonus we didn't ask for and unlocks the podcast clipping vertical for free
- Front-door UI mockup already exists · we adapt to Liquid Clips brand
- Security posture confirmed · backend proxy pattern needed
- Only real lead-time blocker: YouTube quota increase filing

**Feature 6 (Library search) is unblocked. Ships in the current release. No fast-follow needed.**

---

# ADDENDUM · Full-read insights (2026-07-17)

Initial pass missed critical infrastructure that's already live and shipping. Re-read every document end-to-end. Adding what I missed.

## The FRONT-DOOR-thumbnail-wall.html is a working reference build

Not just a mockup — a 306-line self-contained working implementation. Every pattern I need is here:

### Colors used (extends our locked brand tokens)
```
--fuchsia: #ff1a8c           (our existing)
--ink:     #f4f1ea           (our existing)
--dim:     #a49fb0           (new · softer for meta text)
--faint:   #6c6780           (new · very quiet placeholders)
--bg:      #0a090d           (slightly darker than our --paper #0b0b10)
--panel:   #141319           (new · handoff drawer)
--line:    rgba(255,255,255,.08)
--money:   #3ad29f           (NEW · money green for whisper_needed:false / transcript ready flags)
```

### Green vs amber flag pattern for the money moment
- `.flag.ok` (money green) = "transcript ready · $0" — this is the cost saving made visible to the user
- `.flag.warn` (amber #ffbe2e) = "transcribe needed" — honest disclosure
- **Users see the $0 flag before clipping** — that's the visible-value moment

### The pixel-invader logo is a SVG landmark
Rendered inline with `shape-rendering:crispEdges`. Not the current Kade — the "invader" is the corporate mark that goes on the library shell.

### Cache indicator surfaces in the drawer
The handoff response returns `d._cache` (live / warm / cold). The drawer displays this. **This is the "the more we clip, the faster it gets" visualisation.**

## The go-master.html is the LOCKED landing brand — huge implications

This is more than a "brand reference." It's the entire pre-launch lead-conversion engine:

### The personalized-landing flywheel
- Landing takes `?email=x&name=Ali&subs=6000000&v=FktgMN390Xo&vt=...` params
- If email present but name/subs missing → fetches `https://preview-engine-production.up.railway.app/api/spec/{email}` → auto-resolves creator name + subs + video title
- Displays "You said yes. So we cut your last video into **100 clips**, **Ali**."
- Shows 3 REAL frames from their video via `preview.liquidclips.com/thumb/{raw_email}/1|2|3`
- Every unknown creator who lands sees THEIR OWN clips already cut

### The live-app inline simulation
Landing page has a complete app-inside-the-page mockup (`.live` section):
- Sidebar navigation replica: Home · Create · My Clips · Campaigns · Earn · Schedule · Settings
- Home welcome + card grid + Kade celebration hero
- **Auto-plays a "cut" animation:** `Preparing video → Transcribing → Picking clips → Cutting → Rendering` (5 stages, 680ms each)
- Then auto-navigates to My Clips view · reveals 6 clip cards with scores + duration + hook
- Then unlocks · every button becomes clickable
- Every interaction fires `hq.liquidclips.com/track` beacon

### Reservation capture endpoint
`POST https://hq.liquidclips.com/api/reserve` with `{ email, name }` → captures lead. Modal shows "You're reserved · $99 locked for life."

### CTA_MODE toggle (pre-launch vs launch)
Single-line flip between "Reserve my seat" mode and "Download LiquidClips" mode. Currently reserve-only. Flip at launch = every existing lead becomes a download conversion.

### The killer positioning line
> **"$500 studio for a $99 founder seat"**
> **"63 founder seats left"** (scarcity mechanic)
> **"First 100 clips FREE"** (activation hook)
> **"$99/mo, LOCKED FOR LIFE"** (repeated)

### The comparison table
| | LiquidClips | Opus Clips |
|---|---|---|
| Clips/month | 1,000 | Credit-metered |
| Watermark | None | On lower plans |
| Earns you money | Yes | No |
| Price | $99, locked | ~$29/mo, rising |

## Additional live endpoints I missed

Beyond the ones I listed in the initial analysis:

```
GET  https://preview-engine-production.up.railway.app/thumb/<raw_email>/1|2|3
     → per-lead personalised frame from their YouTube channel (302 redirects to their video frames)
GET  https://preview-engine-production.up.railway.app/api/spec/<raw_email>
     → { channelName, subs, videoTitle, videoId } — resolves everything from raw email
POST https://hq.liquidclips.com/api/reserve
     → capture lead (email + name)
POST https://hq.liquidclips.com/track
     → beacon (via navigator.sendBeacon) for user behaviour
```

**These are what power the "we've already cut your clips" landing per-lead flywheel.**

## Landing-page assets I can reuse in Liquid Clips brand

- Wordmark: `https://tally-production-a56d.up.railway.app/lab/landing-assets/wordmark.png`
- Founder hero: `.../landing-assets/founder-hero.png`
- Kade celebration webp: `.../landing-assets/kade-celebration.webp`

These live on Railway lab/landing-assets. Available to any surface.

## The social flywheel Daniel was thinking about — I can see it now

Every lead gets a personalised landing page with THEIR clips already cut. When they sign up, their clips carry attributable watermarks (Feature 3). When viewers see those clips and follow the watermark link, they land on THEIR OWN personalised landing page with THEIR OWN clips already cut. Reserve → cycle compounds.

**Every clip is a lead-generation surface for the next creator.** The archive (Feature 6) + the personalised landing (already live) + the attributable watermark (Feature 3) form a compounding growth loop:

```
Creator A on the 1.3M leads list
  → HQ scans their public channel
  → Personalised landing page auto-generated
  → Email captured, "Reserve my seat"
  → Creator A gets in-app, clips shipped
  → Clips carry attributable watermark
  → Viewer B sees the clip → clicks watermark
  → Viewer B lands on THEIR OWN personalised landing (also on 1.3M list)
  → sees THEIR OWN clips ready
  → reserves → converts
  → cycle repeats

Each cycle: no cold outreach · zero paid ads · the archive + preview-engine + landing template do the work.
```

**The social flywheel isn't a feature we build. It's already partially built. We just need to make sure the desktop-app watermark carries the right URL structure to land viewers on the personalised page (`liquidclips.app?email={handle-to-email}&v={video_id}&name={creator_name}`).**

## Corrected execution priorities

Given what's actually live and shipping-ready:

### T1 · Wire the desktop to the live HQ endpoints (this release)
- Add `junior-backend/app/routes/library.py` proxy routes (4 endpoints)
- Add `src/lib/library.ts` client that calls `/library/*` through backend
- Wire Feature 1's mode selector to include "Search library" mode → calls `/api/library/search` → thumbnail wall using HQ's CSS
- On tile click → `/api/handoff/<video_id>` → paints moment bank → drops selected moment into current clip window

### T2 · Adapt HQ's FRONT-DOOR-thumbnail-wall.html to Liquid Clips workstation shell (this release)
- Take HQ's implementation as the base
- Swap pixel-invader for Kade avatar (or keep both · both are on-brand)
- Add Liquid Clips left nav + TopHud (already existing patterns)
- Render at 1280×820 viewport

### T3 · Update the attributable watermark URL to trigger the flywheel (this release)
- Watermark format: `liquidclips.app/@{creator-handle}` currently
- New format: `liquidclips.app?ref={lc_id}&v={source_video_id}&via={creator_handle}` — hits the personalised landing with attribution
- Landing already handles this
- Cycle compounds

### T4 · Draft the Kade Composer prompt structure that leverages the archive (fast-follow)
Now that we KNOW the archive shape, the conversational layer knows:
- "Find clips about X" → `/api/library/search?q=X` → return matches
- "Give me the top Hormozi hook" → search by name + rank by moment bank → return best
- "Clip from that podcast about customer acquisition" → semantic search across podcast archive (when Podscan captions are cached)

## Sending Claude this

Zero additional questions for HQ. They gave me the whole engine, the UI reference, the brand lock, the landing template, the tracking endpoints, the lead capture, and even documented the security proxy pattern.

**Only outstanding item:** Daniel authorising the YouTube quota increase filing (still the only lead-time blocker).
