# HQ Handoff · YouTube Library + Clipping Engine

**From:** Desktop / product
**To:** HQ / backend / infra
**Date:** 2026-07-17
**Priority:** Fast-follow release blocker · Feature 6 depends on this
**Estimated HQ effort:** 3-5 days to answer + confirm · 1-2 weeks for backend endpoints

---

## Vision · in one sentence

Turn Liquid Clips from *"clip your own content"* into *"clip the entire clip-worthy internet"* — powered by our existing 1.3M YouTube episode archive + live YouTube API fallback + local user-machine bytes for legal safety.

---

## Why this matters · the business case

### Money saved · Whisper cost per user

Current model: every free / Studio source requires Whisper transcription (~$0.036/hour of audio).

If the 1.3M episode archive already has transcripts:
- User searches for and clips an indexed episode → **$0.00 Whisper cost**
- Only clip-selection LLM runs (~$0.001 per clip · negligible)

At 40k users each clipping ~2 hours/month of archive content:
- **Without archive:** 40,000 × 2h × $0.036 = **$2,880/month Whisper**
- **With archive:** 40,000 × 2h × $0.00 = **$0/month Whisper**
- **Annual saving:** ~$34,000 (assuming half of clipped content is from archive vs uploaded)

### Product moat

- CapCut / Clipzie / OpusClip make you IMPORT content first
- Liquid Clips lets you SEARCH content inside the app
- 1.3M episodes = larger archive than any competitor exposes
- Every clip carries our attributable watermark → viral distribution

### Endless-content flywheel

```
User searches "customer acquisition"
  → picks episode from our archive
  → transcript + moment bank load INSTANT (indexed)
  → clips a moment into split-screen slot A
  → records own reaction as slot B
  → exports with attributable watermark
  → viewer signs up via watermark → Crew MRR
  → user returns tomorrow to search "hormozi customer acquisition"
  → gets fresh archive to clip → loop compounds
```

---

## PART 1 · What I need to know · MUST-HAVE ANSWERS

Please answer each with the specific format requested. If any answer is "no" or "don't have," say so explicitly — I'd rather know now than assume.

### Q1 · YouTube Data API v3 access

- **Q1.1** Do we currently hold a Google Cloud project with YouTube Data API v3 enabled? **Yes / No**
- **Q1.2** If yes: project name, API key location (Railway env var name is fine, no need to send the key value), current daily quota (default is 10,000 units — search costs 100/query)
- **Q1.3** If no: can you provision one? Google Cloud project setup takes ~15 min. I need `youtube.readonly` scope minimum.
- **Q1.4** Have we ever requested quota increase? If not, we'll need to file one before launch (they take 5-14 days to approve).

### Q2 · The 1.3M episode dataset · WHERE and WHAT

This is the load-bearing question. Please be exact.

- **Q2.1** Where is the dataset stored today? Pick all that apply:
  - [ ] Railway Postgres (which service, which table?)
  - [ ] Railway Volume (which path?)
  - [ ] S3 bucket (bucket name?)
  - [ ] Dropbox / Google Drive (shared folder link?)
  - [ ] Local hard drive somewhere (whose?)
  - [ ] It doesn't exist yet · we need to build it
  - [ ] Other: __________

- **Q2.2** What does each row / record contain? Circle all that apply:
  - [ ] YouTube video ID
  - [ ] Video title
  - [ ] Channel name / channel ID
  - [ ] Upload date
  - [ ] Duration seconds
  - [ ] View count (at time of index)
  - [ ] Thumbnail URL (YouTube-hosted or our copy?)
  - [ ] **Full transcript** (this is the value driver · with word-level timestamps?)
  - [ ] Auto-generated moment bank (previous clip suggestions?)
  - [ ] Language
  - [ ] Category / tags
  - [ ] Description
  - [ ] Licence field (CC-BY / all rights reserved / unknown)
  - [ ] Speech-seconds actually detected (not just duration)

- **Q2.3** Total size on disk / storage:
  - Transcripts only: ~__ GB (expected ~65 GB for 1.3M at 50 KB avg)
  - With thumbnails: ~__ GB
  - With full metadata: ~__ GB

- **Q2.4** How is search implemented today?
  - [ ] Postgres full-text search
  - [ ] Elasticsearch / OpenSearch
  - [ ] Meilisearch / Typesense
  - [ ] No search — just row lookups by ID
  - [ ] External service (which?)

- **Q2.5** How was the dataset collected? (This drives the rights question)
  - [ ] YouTube Data API (metadata + captions endpoint)
  - [ ] Scraped from YouTube frontend
  - [ ] Purchased from a third party (which?)
  - [ ] Podcastindex.org / Listen Notes / similar aggregator
  - [ ] User-submitted URLs we processed
  - [ ] Combination

### Q3 · Legal / rights posture

- **Q3.1** Do we have written legal opinion on: (a) storing transcripts of YouTube-hosted content, (b) serving them to end-users, (c) allowing end-users to clip from them? **Yes / No**
- **Q3.2** Per-episode licensing metadata: does any row in the 1.3M dataset carry a licence field (CC / all-rights / unknown)?
- **Q3.3** Have we ever received a DMCA takedown for this dataset? If yes, how many, and how were they resolved?
- **Q3.4** Are we OK with serving thumbnails (fair-use safe) but NOT serving video bytes from our servers (would proxy through user's machine via yt-dlp)? **Yes = safest posture / No = we prefer to serve bytes**

### Q4 · Infrastructure limits

- **Q4.1** Railway plan tier and current usage — do we have headroom for a new service that stores 150 GB of transcripts + serves search queries at 100 req/s?
- **Q4.2** Do we have a caching layer (Redis)? If yes, what's the max mem allocated?
- **Q4.3** Existing CDN for thumbnails? If not, are we OK proxying through Railway or should we set up Cloudflare / Bunny?

### Q5 · yt-dlp bundling

- **Q5.1** Do we currently bundle yt-dlp anywhere?
- **Q5.2** Is there a legal review needed to bundle it in the packaged desktop app? (yt-dlp is public domain but some jurisdictions restrict distribution.)
- **Q5.3** Alternative: do we OK a first-run download of yt-dlp from GitHub releases (Apple notarised signed helper only)?

### Q6 · Existing endpoints we might already have

- **Q6.1** Is there ANY existing endpoint that queries this archive today? If yes, share URL + auth model.
- **Q6.2** Is there a Postiz / Ayrshare / third-party account that already gives us YouTube episode search? If yes, name it.
- **Q6.3** Is there a POC / prototype anywhere in the org that touches this data? (Even a Jupyter notebook is useful — share the query patterns.)

---

## PART 2 · What I need HQ to build · SPECIFIC ENDPOINTS

Once Q1-Q6 are answered, HQ needs to expose these endpoints. Requested backend home: `junior-backend/app/routes/library.py`.

### Endpoint 1 · Search the archive

```
GET /api/library/search?q={query}&limit=24&cursor={cursor}
Authorization: Bearer {license_jwt}

Response 200:
{
  "results": [
    {
      "episode_id": "yt:dQw4w9WgXcQ",           // stable ID · yt: prefix distinguishes source
      "source": "youtube",                       // youtube | podcast | user_upload
      "title": "How I Built A $10M SaaS Business",
      "channel": {
        "id": "UC-lHJZR3Gqxm24_Vd_AJ5Yw",
        "name": "Marcus Lemonis",
        "avatar_url": "https://..."
      },
      "thumbnail_url": "https://i.ytimg.com/...",  // small thumbnail
      "thumbnail_hq_url": "https://i.ytimg.com/...", // hq thumbnail
      "duration_seconds": 3421,
      "view_count": 1523000,
      "upload_date": "2024-03-14",
      "language": "en",
      "indexed": true,                             // do we have transcript?
      "clips_generated": 42,                       // has anyone clipped it before?
      "license": "youtube_standard",               // youtube_standard | cc_by | unknown
      "canonical_hash": "sha256..."                // for cache lookups
    },
    ...
  ],
  "cursor": "next_page_opaque_token",
  "total_matches": 15234,
  "search_backend": "postgres_fts | elasticsearch | ..."
}

Response 429: Rate-limited
Response 402: Studio tier required (if we lock archive behind paid tier)
```

**Notes:**
- Sort by relevance by default · allow `sort=views|recent|duration`
- Filter: `filter[duration_min]=60&filter[duration_max]=3600`
- Filter: `filter[channels]=UC-lHJZR3Gqxm24_Vd_AJ5Yw`
- Filter: `filter[language]=en`
- Cursor pagination, not offset (better for large archives)

### Endpoint 2 · Fetch full episode metadata + transcript

```
GET /api/library/episodes/{episode_id}
Authorization: Bearer {license_jwt}

Response 200:
{
  "episode_id": "yt:dQw4w9WgXcQ",
  "title": "...",
  "duration_seconds": 3421,
  "transcript": {
    "segments": [
      {"start": 0.0, "end": 4.2, "text": "So the trick with customer acquisition is..."},
      {"start": 4.2, "end": 8.7, "text": "you have to think about your ICP first."}
    ],
    "language": "en",
    "confidence": 0.94,
    "source": "youtube_captions | whisper_reindex | user_correction"
  },
  "moment_bank": [                    // optional · previously generated clip suggestions
    {"start": 142.3, "end": 173.8, "score": 0.87, "hook": "The real secret to..."}
  ],
  "canonical_hash": "sha256...",
  "media_access": {
    "policy": "user_fetches",           // user_fetches | backend_proxies | signed_url
    "youtube_url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "signed_url": null,
    "expires_at": null
  }
}
```

### Endpoint 3 · Register a new URL for indexing (user pastes YouTube URL not in archive)

```
POST /api/library/import
Authorization: Bearer {license_jwt}
Body: { "url": "https://youtube.com/watch?v=NEW_VIDEO", "priority": "user_active" }

Response 202:
{
  "job_id": "idx_abc123",
  "episode_id": "yt:NEW_VIDEO",
  "status": "queued",
  "estimated_seconds": 45,
  "polling_url": "/api/library/import/idx_abc123"
}

Response 200 (if already indexed):
{
  "job_id": null,
  "episode_id": "yt:NEW_VIDEO",
  "status": "already_indexed",
  "cached_at": "2026-04-12T14:30:00Z"
}
```

**Backend flow:**
1. Check if `yt:{video_id}` already in archive → return immediately
2. If not: enqueue background worker
3. Worker calls yt-dlp to fetch audio (audio-only, ~10 MB per hour)
4. Send audio to Whisper (or our sidecar Whisper if we run it centrally)
5. Store transcript + metadata in archive
6. Emit `library:episode-indexed` event

### Endpoint 4 · Reserve archive-source analysis (cost + billing hook)

Same shape as existing `/api/analysis/reserve` from Studio billing work. If a user clips an already-indexed episode:

```
POST /api/analysis/reserve
Body: {
  "source_id": "yt:dQw4w9WgXcQ",
  "source_type": "library_episode",     // NEW · was upload | url
  "speech_seconds": 3421,
  "run_id": "run_..."
}

Response 200:
{
  "reservation_id": "res_...",
  "analysis_hours_debited": 0,           // ZERO because transcript exists
  "cost_usd_micros": 8000,               // just LLM clip-selection cost
  "provider_route": "hosted_openai_mini"
}
```

**Zero speech-hour debit for indexed episodes.** This is the money-saving contract.

### Endpoint 5 · Attribution telemetry

```
POST /api/library/episodes/{episode_id}/track
Body: { "action": "viewed | clipped | exported | published", "clip_ids": ["..."] }

// Purely observational · no user impact · lets us:
//   - Report clip-count per episode
//   - Detect trending episodes
//   - Feed "creators clipping this episode" back into search ranking
```

---

## PART 3 · What I recommend HQ does BEFORE the endpoints

### Step 1 (day 1-2) · Confirm dataset state
Answer Q2.1-Q2.5 with real numbers. If dataset doesn't exist, decide: build it now (est 2 weeks with Whisper on Railway workers), or launch with YouTube API only (no transcript cache · higher runtime cost per clip).

### Step 2 (day 2-3) · Legal review of Q3
Ideally get 30-min sync with legal advisor. Establish posture:
- Thumbnails via YouTube CDN (safe)
- Transcripts stored by us (grey but common — Descript, Podcastle, Chopcast all do it)
- Video bytes served by us (risky — avoid, use yt-dlp on user machine)
- Attribution watermark carries original creator name

### Step 3 (day 3-5) · Provision Railway resources
- New service `junior-backend-library` (search + episode lookup)
- Postgres extension or Meilisearch for text search
- Redis cache for hot episodes
- Storage for transcripts (Postgres or S3)

### Step 4 (day 5-10) · Build endpoints
Start with Endpoint 2 (fetch episode) since it's simplest. Then Endpoint 1 (search) which depends on the search backend choice. Then Endpoints 3-5.

### Step 5 (day 10-14) · Return to me with:
- Live endpoint URLs (dev + prod)
- Auth model (existing license JWT expected)
- Rate limits
- Legal posture document
- Sample search responses (real data · so I mock the UI accurately)

---

## PART 4 · What I'll do in parallel · zero blocking on HQ

Regardless of HQ answers, I can immediately:

### T1 · Amend Feature 1 mockup to polymorphic source slots
Currently split-screen shows "region A + region B from same source." I'll refactor to "slot A + slot B, each is a `source_slot`" so when YouTube library is ready, the slot just gains a new source type — no re-mock needed.

### T2 · Ship the main 5-feature release
Studio billing + founder-journey are already pushed. The core release (clip range, screen recording, watermark referral, campaign recording, editor push) doesn't depend on YouTube library.

### T3 · Prepare Feature 6 mockup skeleton
Search grid + episode detail + import-flow states — I'll draft the UI without hitting HQ endpoints. When HQ delivers real data, I swap the mocks for real bindings.

### T4 · Draft the yt-dlp local-fetch spec
Since the safest legal posture is "user's machine fetches video bytes," I'll draft the desktop-side spec: how the sidecar invokes yt-dlp, where the audio caches, permission surface for network access.

---

## PART 5 · Success criteria

**HQ has delivered what I need when:**

- [ ] Every Q1-Q6 answered in writing
- [ ] Endpoints 1-5 live on dev environment
- [ ] I can call `GET /api/library/search?q=hormozi` from my machine and get results
- [ ] I can call `GET /api/library/episodes/yt:xxx` and get a transcript back
- [ ] Legal posture documented (even 1 paragraph is fine)
- [ ] Rate limits + quota documented
- [ ] Auth model confirmed (existing license JWT works)

Once those are green, I mock up Feature 6 in 2 days, wire it in 1 week, ship in fast-follow release.

---

## PART 6 · Fallback if HQ can't deliver 1.3M archive

If Q2 answers "the dataset doesn't exist" or "the storage is unrecoverable":

- Ship Feature 6 with **YouTube Data API only** as the search backend
- Every user clip becomes: search → click → yt-dlp on user machine → Whisper on user's sidecar → clip
- Cost per user goes back up ~$0.036/h Whisper
- But: no archive infrastructure needed · faster to ship · legally cleaner

This is the safe fallback. The 1.3M archive is a strong optimisation but not a hard blocker.

---

## Contact for questions on this handoff

Reach out to me (Claude / Desktop team) via any channel. I will not touch backend code · this handoff is entirely HQ's execution surface.

**Read time budget for HQ:** ~15 minutes to review this doc, 20-30 minutes to answer Q1-Q6, plus scoped engineering time for endpoints.

**Handoff receipt:** please respond with a single message confirming which parts you can commit to and which need escalation.
