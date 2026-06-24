# Phase 6G · Publishing Stack Extraction Audit

**Status:** Audit report. No code modified.
**Date:** 2026-06-18
**Scope:** Inventory the **export pipeline** (clip render polish through to final MP4), **publishing UI + Ayrshare integration** (PublishModal, ChannelPicker, SchedulePage, backend HTTP wrappers), and the **queue system** (local schedule, direct publish, render queues, backend Schedule table). Map every brick to the Design OS shell (`desktop-2/src/design-os/`) and produce a Phase 6H–6J build order.
**Scope-out:** No backend / auth / payment / release changes. No runtime wiring. No new assets. No code touches.

---

## 0 · Executive summary

The legacy publishing stack is **production-mature** but unevenly persisted. Four queue families overlap; one is **dead code** (`DirectPublishQueue` superseded by `SchedulePage`); the render queue has **no persistence** (lost on app crash); only the backend `Schedule` Postgres table survives across sessions reliably.

**Ayrshare ships four platforms end-to-end** (YouTube Shorts · TikTok · Instagram Reels · X) through a **single org-wide API key** with webhook-driven state sync. Two more platforms (LinkedIn · Facebook) are wired at the API layer but not yet exposed at full fidelity in the UI.

The **Design OS shell is mostly ready**. `ExportPanel` already exists from Phase 6D — it currently lives inside TimelineStudio, needs to be hosted on a dedicated Export route in Phase 6H. `Channels` and `Schedule` are still SimPage stubs but have correct world / Kade / placement entries in `routeRegistry`.

**6 bricks REUSE direct** (sidecar publish RPCs, PlatformBadge logic, watermark gate, error toast envelope, Ayrshare backend wrappers, Schedule table contract) · **12 bricks PORT** (PublishModal · ChannelPicker · ChannelsManager · 4 LinkedIn/Facebook surfaces · DirectPublishQueue stragglers) · **18 bricks REBUILD** (Channels grid, Schedule calendar, OAuth deep-link, retry surface, history view, render-queue persistence) · **4 bricks DEFER** (calendar primitive, drip scheduling, document uploads, audience-network exposure).

**Three critical infrastructure gaps surface:**
1. **OAuth deep-link** for Channels (YouTube specifically uses an iframe-redirect-then-app-bounce flow) — needs Tauri scheme handler.
2. **Long-poll mechanism** for Schedule (countdown UI on every queued row) — new `useSchedulePolling` hook.
3. **Render-queue persistence** (every in-flight bake / regenerate is in-memory `threading.Event` — crash discards work). Defer the persistence work; surface "lost on crash" honestly in Phase 6H UI.

**Stop / wait per the directive. Phase 6H is the build phase — this report is read-only.**

---

## 1 · Export inventory

### 1.1 Frontend surfaces (UI)

| File | Component | Role | IPC | Mounted |
|---|---|---|---|---|
| `desktop/src/components/ClipPreview.tsx` (L59–1300) | `ClipPreview` | 1180px modal editor · ratio chips (9:16 / 1:1 / 4:5) · trim · regenerate · captions · overlay · "Save copy as…" · "Reveal in Finder" | `regenerateClip`, `getCaptions`, `editCaptions`, `startOverlayBake`, `cancelOverlayBake` | ✅ |
| `desktop/src/components/captions/CaptionDrawer.tsx` | `CaptionDrawer` + `CaptionOverlay` | Drawer · loads `getCaptions` · live preview via `CaptionOverlay` · Apply re-bakes clip MP4 via `editCaptions` · persists style/palette/position to `captions/<idx>-edits.json` | `getCaptions`, `editCaptions` | ✅ |
| `desktop/src/components/OverlayTemplateGallery.tsx` (L1–130) | `OverlayTemplateGallery` | 8 pre-made reaction templates (PiP corners · side-by-side · full-bottom · react-overlay) · Solo+ tier-gate | `startApplyOverlayTemplate` | ✅ |
| `desktop/src/components/clips-feed/ReactionControls.tsx` (L63–250+) | `ReactionControls` | Single source of truth for `clip.overlay` (IG-005) · bake state machine · audio/offset Apply pattern (v0.8.0) · mounted in ClipPreview + BottomCockpit mutually exclusive | `startOverlayBake`, `onBakeComplete`, `onBakeError` | ✅ |
| `desktop/src/lib/useGlobalBakeEvents.ts` | `useGlobalBakeEvents` hook | IG-010 singleton wait-hook · attaches on mount (line 103) · returns `waitForBake(slug, idx)` promise · race-safe | listens `sidecar:bake_complete`, `sidecar:bake_error` | ✅ |
| `desktop/src/components/ClipPreview.tsx:563–597` | `saveCopyAs()` | Native `dialog.save()` + `fs.copyFile()` · default name `<baseName>.mp4` · MP4 filter | Tauri `@tauri-apps/plugin-dialog` + `plugin-fs` | ✅ |
| `desktop/src/components/ClipPreview.tsx` (Reveal) | inline button | `openSmart()` wrapper around `shell.open` · target = containing folder | Tauri `shell.open` | ✅ |

### 1.2 Sidecar RPC methods (export polish)

| Method (sidecar.ts) | Python (sidecar.py:line) | Signature | IG-010 pair | Timeout |
|---|---|---|---|---|
| `regenerateClip` | `1341–1408` | `(slug, idx, start, end) → {project}` | NO (blocking) | 180s (cancel-on-timeout) |
| `startRegenerateClip` | `1413–1510` | `(slug, idx, start, end) → {started: bool}` | ✅ YES | none |
| `cancelRegenerateClip` | `1512–1519` | `(slug, idx) → {canceled: bool, reason?}` | ✅ YES | — |
| `getCaptions` | `1521–1640` | `(slug, idx) → {idx, style, lines, source, has_word_data, has_transcript, palette?, position?}` | NO | none |
| `editCaptions` | `1643–1800+` | `(slug, idx, lines, style, palette?, position?) → {project, clip_idx, style, updated_at, video_path, ass_text?}` | NO | none |
| `startOverlayBake` | `1244–1325` | `(slug, idx, overlay) → {started: bool}` | ✅ YES | none |
| `cancelOverlayBake` | `1328–1339` | `(slug, idx) → {canceled: bool, reason?}` | ✅ YES | — |
| `startApplyOverlayTemplate` | `2107–2206` | `(slug, idx, template, sourcePath?) → {started: bool}` | ✅ YES | none |
| `cancelApplyOverlayTemplate` | `2208–2218` | `(slug, idx) → {canceled: bool, reason?}` | ✅ YES | — |

### 1.3 Python pipeline (the actual MP4 work)

#### `stage_reframe` · `python-sidecar/stages.py:1207–1470`
1. Load `transcript.srt`; slice to clip bounds → `clip_srt`
2. Convert SRT → VTT (`clip_vtt`)
3. If `animated_captions_on`: generate ASS from transcript.json word-level data (L1279–1291)
4. Face detection once per clip (L1293–1297) for smart crop centering
5. Hook text extraction (L1299–1300)
6. Silence detection (optional, L1302–1322)
7. **For each ratio** (vertical 9:16, square 1:1, portrait 4:5):
   - Build ffmpeg filter chain: `crop → captions (ASS or SRT) → hook text → watermark (free tier) → voice enhance`
   - Run `libx264` encode (preset=veryfast, crf=22, AAC 128k)
   - Output: `<cut_stem>-vertical.mp4`, `-square.mp4`, `-portrait.mp4`

#### `apply_overlay_to_clip` · `stages.py:2325–2474`
- Per ratio: ffmpeg overlay filter (PiP positioning · side-by-side crop · etc.)
- Output: `<base>-overlay.mp4` (sibling of base, untouched)
- Stores `clip.overlay.applied_paths[ratio] → path`

#### Watermark · `stages.py:1631–1784`
- Cache: `_WATERMARK_TIER_CACHE` (600s TTL)
- `_should_watermark()` queries `/sync` endpoint → `features.watermark` (server-authoritative)
- Free tier: animated MOV overlay via `_made_with_animated_watermark_filter()` (loops to cover any clip duration; falls back to static "Liquid Lift" wordmark)
- Paid tier: no watermark
- Override env: `JUNIOR_FREE_WATERMARK=1/0`

#### Caption bake · `captions.py` + `stages.py:1643–1800+`
- **ASS** (animated word-by-word karaoke) when `_captions_burn_enabled()` and word-level data exists
- **SRT fallback** (static) otherwise
- `editCaptions` rebakes the vertical_path with new ASS; persists user edits to `captions/<idx>-edits.json`

### 1.4 Output artifacts

```
projects/<slug>/
├── project.json                                      # clip.vertical_path, clip.square_path, etc.
├── clips/
│   ├── <idx+1:02d>-<clip_slug>-vertical.mp4          # 1080x1920 (9:16, TikTok/Shorts)
│   ├── <idx+1:02d>-<clip_slug>-square.mp4            # 1080x1080 (1:1, Insta feed)
│   ├── <idx+1:02d>-<clip_slug>-portrait.mp4          # 1080x1350 (4:5, Insta feed max CTR)
│   ├── <idx+1:02d>-<clip_slug>-vertical-overlay.mp4  # w/ b-roll composite
│   ├── <idx+1:02d>-<clip_slug>.srt                   # Static captions (persisted)
│   ├── <idx+1:02d>-<clip_slug>.vtt                   # WebVTT (derived from SRT)
│   └── <idx+1:02d>-<clip_slug>.ass                   # Animated ASS (word-level, if enabled)
├── captions/
│   └── <idx+1:02d>-edits.json                        # User edits: {style, lines, palette, position, updated_at}
├── transcript/                                       # transcript.srt + .json + .vtt
└── thumbnails/<idx+1:02d>-<clip_slug>/*.jpg
```

### 1.5 Final-render contract (the canonical sequence)

1. `project.json` created via `start_run → stage_ingest`
2. Transcript lifted: `stage_transcribe → transcript.json`
3. Clips cut: `stage_cut → clip.cut_path`
4. Ratios reframed: `stage_reframe` (3 ratios + ASS/SRT burn + watermark + voice enhance)
5. Optional captions edited: `editCaptions(slug, idx, lines, style, palette, position)` re-bakes vertical_path
6. Optional overlay applied: `startOverlayBake(slug, idx, overlay)` → `bake_complete` event → `clip.overlay.applied_paths` updated
7. Export: `saveCopyAs()` (`dialog.save` + `fs.copyFile`) OR publish path (next section)

---

## 2 · Publishing inventory

### 2.1 Frontend surfaces

| File | Component | Role | IPC | Mounted |
|---|---|---|---|---|
| `desktop/src/components/PublishModal.tsx` | `PublishModal` | Full-screen modal · 3 modes (`publish-now` · `schedule-one` · v1 Ayrshare) · platform tabs · auto-filled metadata | `backend.publishNow`, `backend.scheduleOne`, `usePlatformConnections` | ✅ |
| `desktop/src/components/schedule/SchedulePage.tsx` | `SchedulePage` | 3-tab landing (Queue / Channels / Analytics) · central hub | sub-components do the work | ✅ |
| `desktop/src/components/schedule/ChannelPicker.tsx` | `ChannelPicker` | Single-select channel list · platform-grouped · disabled when pending_link/unlinked but Ayrshare reports linked | `usePlatformConnections` | ✅ |
| `desktop/src/components/PlatformBadge.tsx` | `PlatformBadge` + `PlatformBadgePicker` | 34×34 brand glyphs (YT red · TT black · IG gradient · X black · LI blue · FB blue · Threads black) · optional connection-status dot · multi-select picker for clip pre-routing | none | ✅ |
| `desktop/src/components/cockpit/BottomCockpit.tsx` (L1–150+) | `BottomCockpit` | Sticky fixed bottom-right · Publish + Schedule popovers · datetime input · "Publish to N channels" / "Schedule N posts" CTAs | `publishClipsNow`, `scheduleClips` | ✅ |
| `desktop/src/components/schedule/ChannelsManager.tsx` | `ChannelsManager` | Standalone Channels surface · OAuth flow per platform · connect/disconnect/refresh | backend channel endpoints | ✅ |
| `desktop/src/components/upload/DirectPublishQueue.tsx` | `DirectPublishQueue` | Drop zone for finished clips (legacy · superseded by SchedulePage v0.6.39+) | sidecar passthrough | legacy/conditional |

### 2.2 Per-platform mapping

| Platform | Connection | Aspect ratio | Format | Metadata | Quirks | DS verdict |
|---|---|---|---|---|---|---|
| **YouTube Shorts** | Ayrshare OAuth (hosted) | 9:16 | vertical MP4 <60s | title · description | auto-Shorts detection · 60s max | REUSE |
| **TikTok** | Ayrshare OAuth + JWT fallback | 9:16 | vertical MP4 <3min | title · description | up to 3min · Ayrshare handles appeal | REUSE |
| **Instagram Reels** | Ayrshare OAuth | 9:16 or 1:1 | vertical/square MP4 | title · description | Carousel not supported in v0 · feed = square | REUSE (Reels) · DEFER (Feed) |
| **X** | Ayrshare OAuth | 9:16 · 1:1 · 16:9 | <2:20 video | 280-char post text · description | no quoted-reply support | REUSE |
| **LinkedIn** | Ayrshare OAuth | 1:1 (preferred) | document/video | title · description | document PDFs · lower FPS tolerance | WRAPPER (UI not yet exposing all options) |
| **Facebook** | Ayrshare OAuth | 9:16 · 1:1 | Reels/Feed | title · description | auto-Reels detection · Audience Network optional | WRAPPER |
| **YouTube long-form** | Ayrshare OAuth | 16:9 | MP4 | full description · tags · category | thumbnail set via Ayrshare metadata | REUSE (pairs with Phase 6F episode thumbnails) |

---

## 3 · Ayrshare inventory

### 3.1 Backend wrapper · `junior-backend/app/ayrshare.py`

- **API key:** `AYRSHARE_API_KEY` env var (org-wide Bearer token)
- **Core methods:**
  - `post(text, platforms, media_urls, profile_key, scheduled_at=None)` → publishes or schedules
  - `media_upload(file_path, profile_key)` → returns Ayrshare CDN URL
  - `history(profile_key, limit=50)` → recent posts
  - `analytics(post_id, profile_key)` → per-post engagement
  - `cancel_scheduled(post_id, profile_key)` → cancel a queued post
  - `check_key()` → health check
  - `create_profile(title, email=None)` → mint sub-profile (Schedule v2 link flow)
- **Rate-limit handling:** `AyrshareRateLimited` wraps 429 responses with `retry_after`
- **OAuth:** opens `https://app.ayrshare.com/profile/link` in system browser → user OAuth's with platform → Ayrshare redirects to backend callback → backend captures `profileKey` + connected platforms via webhook

### 3.2 OAuth callback flow (YouTube iframe redirect)

`junior-backend/app/routes/channels.py` + `desktop/src/components/schedule/ChannelsManager.tsx`

1. Desktop opens Ayrshare link URL in system browser
2. User OAuth's with YouTube/TikTok/etc.
3. Ayrshare redirects to post-OAuth callback URL (configured server-side)
4. Backend captures `profileKey` + `platform` from Ayrshare webhook at `POST /webhooks/ayrshare`
5. Desktop polls `GET /channels/{id}/refresh` to pull updated `handle` + `status`
6. ChannelsManager re-fetches via `usePlatformConnections()` hook

### 3.3 Webhook handlers · `junior-backend/app/routes/webhooks_ayrshare.py`

`POST /webhooks/ayrshare` consumes:
- `type: "post"` + `status: "success"` → flip Schedule rows `scheduled → published` + write notification
- `type: "post"` + `status: "error"` → flip rows `scheduled → failed` + write notification with error
- `type: "channel.linked"` → flip SocialChannel `pending_link → active` + set `handle`
- `type: "channel.unlinked"` → flip SocialChannel `active → unlinked` + note token expiry
- **Idempotency:** `idempotencyKey` stored in `WebhookEvent` table
- **Out-of-order safety:** ignore events older than `channel.last_probe_at`

### 3.4 Account-connection state

| Table | Purpose | Fields |
|---|---|---|
| `social_connections` | Legacy single-profile flow | `ayrshare_profile_key`, `connected_platforms[]`, `active`, `updated_at` |
| `social_channels` | Schedule v2 · per-platform | `id`, `user_id`, `platform`, `label`, `handle`, `ayrshare_profile_key`, `status` (active / pending_link / unlinked / error / paused / deleted), `created_at` |

### 3.5 Endpoints

| Endpoint | Method | Role |
|---|---|---|
| `/social/connections` | GET | Legacy SocialConnection state |
| `/social/connect` | POST | Paste profile key + verify with Ayrshare /user |
| `/social/refresh-platforms` | POST | Re-pull connected platforms |
| `/social/disconnect/{platform}` | DELETE | Locally hide a platform |
| `/channels` | GET | List all user channels (auto-backfill legacy on first call) |
| `/channels` | POST | Create channel · mint Ayrshare profile · return link URL |
| `/channels/{id}` | GET / PATCH / DELETE | Channel detail · pause/unpause · soft-delete |
| `/channels/{id}/refresh` | POST | Pull handle + status from Ayrshare /user |
| `/publish-now` | POST | Multipart upload + publish to channel or platforms |
| `/webhooks/ayrshare` | POST | Webhook receiver |

### 3.6 Sidecar wrappers (the publish RPCs)

| Method | Signature | Timeout |
|---|---|---|
| `publishClipsNow(project, idxs[], channelIds[])` | one backend call per channel · returns `ClipActionResult` | 60s per fan-out |
| `scheduleClips(project, idxs[], when, channelIds[])` | `when: {kind: "now" \| "+1h" \| "+24h" \| "custom", date?}` · routes to publish-now or schedule-one | 60s |

### 3.7 Integration-readiness verdict per platform

| Platform | Status | Mechanism | Notes |
|---|---|---|---|
| **YouTube Shorts** | ✅ REUSE | Ayrshare native | 60s max · auto-Shorts detection |
| **TikTok** | ✅ REUSE | Ayrshare native + JWT fallback | up to 3min · appeal flow handled by Ayrshare |
| **Instagram Reels** | ✅ REUSE | Ayrshare native | 9:16 + 1:1 · feed posts untested in prod |
| **X** | ✅ REUSE | Ayrshare native | char limit enforced · no quoted-reply support |
| **LinkedIn** | ⚠ WRAPPER | Ayrshare native + local queue | document uploads not wired in legacy UI |
| **Facebook** | ⚠ WRAPPER | Ayrshare native | Reels auto-detected · Audience Network not exposed |

---

## 4 · Queue inventory

### 4.1 Queue families · ownership matrix

| Queue | Owner | Persistence | Producer | Consumer | Retry | Failed path |
|---|---|---|---|---|---|---|
| **Local Schedule** | Sidecar (`local_schedule.py`) | `~/LiquidClips/.schedule.json` (atomic temp-file write) | `local_schedule_add` RPC | `LocalQueue.tsx`, `SchedulePage` Queue tab | manual remove+add | hard-delete from array |
| **Direct Publish** | Frontend (passthrough sidecar) | `~/LiquidClips/.direct-publish-queue.json` | `directPublishQueueWrite` | `DirectPublishQueue.tsx → PublishModal` | — | manual re-add | **DEAD CODE · superseded by SchedulePage** |
| **Overlay Bake** | Sidecar worker thread | **NONE** (in-memory `threading.Event`) | `start_overlay_bake` RPC | `OverlayPanel.tsx`, events bridge | cancel-only (`event.set()`) | lost on crash |
| **Clip Regenerate** | Sidecar worker thread | **NONE** | `start_regenerate_clip` RPC | `ClipPreview` trim editor | cancel-only | lost on crash |
| **LLM Pick** | Sidecar worker thread | **NONE** | `start_pick_more_clips` RPC | `ClipPicker.tsx` | cancel-only | lost on crash |
| **Apply Template** | Sidecar worker thread | **NONE** | `start_apply_overlay_template` RPC | `OverlayTemplateGallery` | cancel-only | lost on crash |
| **Ingest URL** | Sidecar worker thread | `.lift_cancel` marker (sidecar.py:2656) | `start_ingest_url` RPC | `WorkingStage` | marker file polled | lost on crash |
| **Lift Transcript** | Sidecar worker thread | `.lift_cancel` marker (shared) | `start_lift_transcript` RPC | `TranscriptResult` | marker file polled | lost on crash |
| **Thumbnail Batch** | Sidecar worker thread | `.thumbgen_cancel.<slug>` marker (sidecar.ts:1251) | `thumbnail_batch_start` RPC | `ThumbnailStudio` | marker file polled | lost on crash |
| **Backend Schedule** | Backend (Railway Postgres) | `schedules` table | `POST /schedules` | `ScheduleQueue.tsx` | manual `/schedules/{id}/retry` · max 3x · exponential backoff (1min · 5min · 25min) | `status=failed` rows stay in table |
| **Submissions tracker** | Frontend file (`desktop/src/lib/submissions.ts`) | `$APPDATA/submissions.json` | `createSubmission`/`updateSubmission` | `useSubmissions` | n/a — brief-tracker, not publish queue | n/a |

### 4.2 Local-schedule item shape (`sidecar.ts:1753`)

```ts
type LocalScheduleItem = {
  id: string;                      // "ls_<12-char-base62>"
  project_slug: string;
  clip_idx: number;
  clip_title: string;
  vertical_path: string;
  platform: "youtube" | "tiktok" | "instagram" | "x";
  scheduled_for: string;           // ISO UTC
  status: "pending" | "posted" | "canceled";
  caption: string;
  created_at: string;
  posted_at: string | null;
  post_url?: string;
};
```

### 4.3 Backend Schedule item shape (`junior-backend/app/models.py:134–169`)

```python
class Schedule(Base):
    id: str                                    # UUID
    user_id: str
    project_slug: str
    clip_idx: int
    clip_title: str
    vertical_path: str
    platform: str                              # "youtube" | "tiktok" | "x" | ...
    scheduled_for: datetime                    # UTC, indexed
    status: str                                # "pending" | "uploading" | "scheduled" | "published" | "failed" | "canceled"
    error: str | None
    retry_count: int                           # 0–3 (MAX_RETRIES)
    next_retry_at: datetime | None
    ayrshare_scheduled_post_id: str | None     # Ayrshare's job id
    actual_post_url: str | None                # post URL after publish
    channel_id: str | None                     # FK → social_channels
    caption_override: str | None
    created_at / updated_at: datetime
```

### 4.4 State diagrams

#### Local schedule
```
pending → posted (user marks via UI)
pending → canceled (user cancels)
posted | canceled → [removed from array]
```

#### Overlay bake (in-memory)
```
[start_overlay_bake]
  → register threading.Event in _ACTIVE_BAKES[(slug, idx)]
  → spawn worker thread · monkey-patch stages._check_canceled
  → worker:
    → polls event.is_set() via _check_canceled
    → on timeout: raises CanceledError
    → on success: emit bake_complete, clear bake_status
    → on error: emit bake_error, set bake_error
  → cleanup: restore _check_canceled, pop from registry
```

#### Backend Schedule (post-Ayrshare)
```
pending → uploading (transient · Ayrshare accepting)
uploading → scheduled (in Ayrshare's queue)
scheduled → published (Ayrshare fires at scheduled_for)
pending → failed (Ayrshare rejects · error populated · retry_count=0)
failed → manual retry → pending (retry_count++, next_retry_at = NOW + backoff)
failed (retry_count≥3) → stays failed (manual review only)
any → canceled (user cancels · no undo)
```

### 4.5 Critical gaps

- **Render queue persistence:** every in-flight `threading.Event` is lost on sidecar crash. `clip.overlay.bake_status = "pending"` lingers in `project.json` until next bake.
- **No auto-retry on backend Schedule:** cron is now a reconciliation poll only · manual retry only.
- **Unified queue UI absent:** Local + Backend rendered separately (`LocalQueue.tsx` vs `ScheduleQueue.tsx`) — users see two "pending" states.
- **Retry-depth visibility absent:** `retry_count / MAX_RETRIES` not surfaced in UI.

---

## 5 · Lego brick map

> 60+ bricks. Risk weighs sidecar-runtime dependence + OAuth flow complexity + queue persistence gaps.

### 5.1 Export pipeline (Phase 6H)

| # | Brick | Legacy file | Move unchanged | Wrapper | Mount slot | Risk |
|---|---|---|---|---|---|---|
| 1 | ExportPanel chips (format + preset + watermark) | `design-os/studio/ExportPanel.tsx` (already built Phase 6D) | Yes (built in DS) | No | Export route centerPanel | LOW |
| 2 | CaptionDrawer | `captions/CaptionDrawer.tsx` · already PORTED in Phase 6D | Yes (DS version exists) | Light · wire onApply → export-queue event | Drawer slot | LOW |
| 3 | OverlayTemplateGallery | `OverlayTemplateGallery.tsx` · already PORTED in Phase 6D | Yes (DS version exists) | Light | GlassCard slot | LOW |
| 4 | Render-queue progress bar | n/a · NEW | n/a | New component | Export route below ExportPanel | MED |
| 5 | Export-queue history table | n/a · NEW | n/a | New | Export route bottom | MED |
| 6 | "Save copy as…" | inline `saveCopyAs()` in `ClipPreview.tsx` | Yes (small fn) | No | ExportPanel CTA row | LOW |
| 7 | "Reveal in Finder" | `openSmart()` | Yes | No | ExportPanel CTA row | LOW |
| 8 | Export error strip | `BakeErrorStrip` (already in DS · extend `engine:error` kind to include `export`) | Yes | No | Export route inline | LOW |
| 9 | Runtime honesty tag | `lc-runtime-tag` from Phase 6C-Lockdown | Yes | No | Export route eyebrow | LOW |
| 10 | Watermark gate (free → forced on) | `_should_watermark()` + UI gate | Yes (gated by tier) | No | inside ExportPanel | LOW |
| 11 | `regenerateClip` RPC stub | `sidecar.ts` legacy · DS stub already mocks ingest pattern | Yes (extend stub) | No | sidecar-stub.ts addition | LOW |
| 12 | `startRegenerateClip / cancelRegenerateClip` (IG-010 pair) | sidecar.ts L1310–1322 | Yes (extend stub) | No | sidecar-stub.ts | LOW |
| 13 | `editCaptions` rebake call | sidecar.ts L971–994 | Yes | No | CaptionDrawer Apply | LOW |
| 14 | `startApplyOverlayTemplate` (IG-010) | sidecar.ts L1314–1322 | Yes | No | OverlayTemplateGallery onSelect | LOW |
| 15 | `useGlobalBakeEvents` singleton wait-hook | `desktop/src/lib/useGlobalBakeEvents.ts` | Yes (port hook into DS) | No | Phase 6H foundation | LOW |
| 16 | Native file save · `Tauri dialog.save + fs.copyFile` | inline | n/a (Tauri plugin not in desktop-2 yet) | NEW (defer to runtime ship) | ExportPanel CTA | MED |
| 17 | "Reveal in Finder" via `shell.open` | inline `openSmart()` | n/a (Tauri shell plugin) | NEW (defer to runtime ship) | ExportPanel CTA | MED |

### 5.2 Publishing UI + Channels (Phase 6I)

| # | Brick | Legacy file | Move unchanged | Wrapper | Mount slot | Risk |
|---|---|---|---|---|---|---|
| 18 | PublishModal | `PublishModal.tsx` | No (modal-in-modal pattern → DS ModalPortal rebuild) | Yes — substantial | ModalPortal triggered from Schedule + ExportPanel | MED |
| 19 | ChannelPicker (single-select) | `ChannelPicker.tsx` | Light port | Light · wrap rows in GlassCard | inside PublishModal + Channels route | LOW |
| 20 | PlatformBadge (34×34 brand glyphs) | `PlatformBadge.tsx` | Yes (props-driven) | No | reused everywhere | LOW |
| 21 | PlatformBadgePicker (multi-select) | `PlatformBadge.tsx` | Yes | No | inside ClipPreview / Export | LOW |
| 22 | ChannelsManager · standalone surface | `schedule/ChannelsManager.tsx` | No (legacy chrome) | Yes — significant | Channels route centerPanel | MED |
| 23 | OAuth deep-link handler (YouTube iframe → web → app) | backend webhook flow + custom URL scheme | NEW | NEW infrastructure (Tauri scheme handler) | `bridge/tauri-adapter.ts` extension | **HIGH** |
| 24 | `usePlatformConnections` hook | `desktop/src/hooks/...` | Yes (port hook) | No | Channels route + PublishModal | LOW |
| 25 | Channel grid (8 platform tiles) | n/a · NEW (legacy was list) | n/a | NEW | Channels.centerPanel | MED |
| 26 | Per-platform connection card | partially in `ChannelPicker` | NEW component | NEW | inside Channels grid | MED |
| 27 | Connection-health panel | n/a · NEW | n/a | NEW | Channels right rail | LOW |
| 28 | Account-info pill (avatar + handle + tier) | inline in PlatformBadge | Yes (extract) | Light | inside connection card | LOW |
| 29 | Channel disconnect confirmation | inline in ChannelsManager | NEW (use Drawer) | NEW | Drawer slot | LOW |
| 30 | Empty state when no channels connected | n/a · NEW | n/a | Port `EngineEmptyState` | Channels.centerPanel | LOW |
| 31 | `backend.publishNow` HTTP wrapper | `desktop/src/lib/backend.ts` | Yes (port unchanged) | No | DS engine layer extension | LOW |
| 32 | `backend.scheduleOne` HTTP wrapper | `backend.ts` | Yes | No | same | LOW |
| 33 | Webhook subscription (`lc:publish-result`) | inline window event listener | Yes | Light · subscribe through bus | route-level effect | LOW |

### 5.3 Schedule + queue (Phase 6J)

| # | Brick | Legacy file | Move unchanged | Wrapper | Mount slot | Risk |
|---|---|---|---|---|---|---|
| 34 | SchedulePage (Queue / Channels / Analytics tabs) | `schedule/SchedulePage.tsx` | No (decompose) | Yes — significant | Schedule.centerPanel + Channels route (separate) | MED |
| 35 | Local queue table | `LocalQueue.tsx` | Light · wrap rows in GlassCard | Light | Schedule.centerPanel | LOW |
| 36 | Backend ScheduleQueue table | `ScheduleQueue.tsx` | Light · wrap rows | Light | Schedule.centerPanel · merged view | LOW |
| 37 | Status badges (queued / uploading / posted / error / canceled) | inline | Yes (extract chips) | No | per-row | LOW |
| 38 | Per-row Cancel + Edit-time + Reschedule | inline | Yes (extract buttons) | No | per-row · Edit opens Drawer | MED |
| 39 | Calendar / drip view (per-platform lanes) | n/a · NEW | NEW | NEW component (defer external library) | Schedule alt tab | MED |
| 40 | Per-day cap warning | n/a · NEW | NEW | NEW | inside Schedule.centerPanel | LOW |
| 41 | "Add to queue" CTA from clip | inline · BottomCockpit schedule popover | Yes (extract) | Light | Schedule + ClipPreview action | LOW |
| 42 | Failed-queue panel (retry from dead-letter) | `ScheduleQueue` filter | NEW surface | NEW | Schedule.centerPanel sub-section | MED |
| 43 | Schedule presets (Now / +1h / Tomorrow 9am / custom) | inline BottomCockpit popover | Yes (extract) | No | Schedule + PublishModal | LOW |
| 44 | Retry-count visibility (`retry_count / 3`) | n/a · NEW | NEW | NEW | Schedule rows | LOW |
| 45 | `local_schedule_list / add / cancel / mark_posted / remove` RPCs | sidecar.ts (multi-method) | Yes (extend stub) | No | sidecar-stub.ts | LOW |
| 46 | `directPublishQueueRead / Write` RPCs | sidecar.ts | n/a · DEFER (dead code) | n/a | n/a | DEFER |
| 47 | `useSchedulePolling` hook · 10s interval | NEW | NEW | NEW | `state/useSchedulePolling.ts` | MED |
| 48 | `useScheduleCountdown` hook · minutes/seconds until fire | NEW | NEW | NEW | per-row | LOW |
| 49 | Render-queue persistence (`.bake-queue.jsonl`) | n/a · NEW (gap callout) | NEW | NEW | sidecar.py side — DEFER to runtime ship | HIGH |
| 50 | Auto-retry cron logic | server-side · partial | NEW | NEW | backend — DEFER | HIGH |
| 51 | `cron.py` reconciliation poll | `junior-backend/app/cron.py` | n/a (lives in backend) | n/a | n/a | DEFER |
| 52 | Webhook receiver (`POST /webhooks/ayrshare`) | `webhooks_ayrshare.py` | n/a · backend | n/a | n/a | DEFER |
| 53 | Notification surface (post failed, channel linked) | `write_notification()` | n/a · backend writes | n/a | Schedule route via toast | LOW |
| 54 | Ayrshare account-connection state · `social_channels` table | backend Postgres | n/a · backend | n/a | n/a | DEFER |
| 55 | DirectPublishQueue (dead code) | `DirectPublishQueue.tsx` | n/a | n/a | n/a | **DEFER (archive)** |
| 56 | Drip scheduling · `DripSlot` shape | sidecar.ts L1731 | n/a | n/a | Schedule.centerPanel alt view | DEFER (Phase 7+) |
| 57 | Per-channel connection persistence | engineSessionPersistence extension | extend types | NEW field | `state/engineSessionPersistence.ts` | LOW |
| 58 | Posting history view | uses Ayrshare `/history` | n/a (backend call) | NEW | Schedule.centerPanel tab | DEFER |
| 59 | Analytics (per-post engagement) | uses Ayrshare `/analytics` | n/a | NEW | Schedule.centerPanel tab | DEFER |
| 60 | Submissions tracker (`submissions.ts`) | `desktop/src/lib/submissions.ts` | Yes | No | Schedule.centerPanel sub-section | LOW |

---

## 6 · Design OS plug-points

### 6.1 Route registry · already correct

| Route | World | Default Kade | Placement | Status |
|---|---|---|---|---|
| `studio` | studio-deck | generating-captions | helper-right | already wired Phase 6D |
| `thumbnail` | studio-deck | reading-brief | helper-right | already wired Phase 6F |
| **`channels`** | relay-tower | publishing | helper-right | ✅ correct in routeRegistry.ts |
| **`schedule`** | cockpit-home | publishing | helper-right | ✅ correct in routeRegistry.ts |

### 6.2 Reused infrastructure (already in place)

| Need | Existing Design OS component | Phase |
|---|---|---|
| Modal host | `<ModalPortal>` · createPortal to body | Phase 6B |
| Side panel host | `<Drawer>` · portal-to-body | Phase 6B |
| Glass surface | `<GlassCard>` | Phase 5A |
| Numeric metric | `<MetricBoard>` · `<CountdownBoard>` (perfect for "scheduled for") | Phase 5A |
| Progress bar | `<AllowanceBar>` | Phase 5A |
| Sticky Kade reaction | `useKadeFromSession()` · `publishing` pose | Phase 6B |
| Crash isolation per brick | `<EngineErrorBoundary>` | Phase 6C |
| AI failure banner | `<BakeErrorStrip>` (extend to publish-fail kinds) | Phase 6C |
| Session state | `useEngineSession()` + `EngineSessionProvider` | Phase 6B |
| Persistence | `useEngineSessionPersistence()` (extend with scheduled queue ids) | Phase 6C-Lockdown |
| Runtime honesty | `useRuntimeInfo()` → "Studio preview" tag | Phase 6C-Lockdown |
| Cancel/Clear/Retry strip | `<EngineActions>` | Phase 6C-Lockdown |
| Toast surface | `<ToastHost>` (subscribes to `bus.emit("toast")` + window `lc:toast`) | Phase 6B |
| File drop entry | `<DropOverlay>` → `bus.on("source:drop")` | Phase 6B |

### 6.3 Engine bus channels · ready for extension

Current `EngineStage` includes `bake`, `regenerate`, `lift`, `pick`, `thumbnail`. Phase 6H needs:
- **Add `"export"` to `EngineStage` union** (events.ts)
- **Add `"export"` and `"publish"` to `EngineCompletionKind`** (events.ts)
- **`tauri-adapter` re-emits** any new `sidecar:export_*` / `sidecar:publish_*` channels onto the existing `engine:progress/complete/error` bus

### 6.4 Per-route mount matrix

#### Export route (Phase 6H)
| Brick | Host | Mount point | Verdict |
|---|---|---|---|
| Format chips · preset · watermark | `ExportPanel.tsx` (built Phase 6D) | Export.centerPanel · move from TimelineStudio | **REUSE** |
| Caption style picker | `CaptionDrawer.tsx` (built Phase 6D) | `<Drawer>` triggered from ExportPanel | **REUSE** |
| Overlay picker | `OverlayTemplateGallery.tsx` (built Phase 6D) | `<GlassCard>` slot inside ExportPanel right rail | **REUSE** |
| Render-queue progress | NEW | new `.lc-export-queue-progress` row using `AllowanceBar` | REBUILD |
| Export-queue history | NEW | bottom of Export route | REBUILD |
| "Save copy as…" | NEW (Tauri plugin) | ExportPanel CTA row | REBUILD (defer until runtime) |
| "Reveal in Finder" | NEW (Tauri plugin) | ExportPanel CTA row | REBUILD (defer) |
| Export error strip | `BakeErrorStrip` (extend kinds) | inline above queue | PORT |
| Honesty tag | `lc-runtime-tag` | hero eyebrow | REUSE |
| `useGlobalBakeEvents` singleton | NEW (port from legacy) | route mount | PORT |

#### Channels route (Phase 6I)
| Brick | Host | Mount point | Verdict |
|---|---|---|---|
| Channel grid (8 platform tiles) | NEW | Channels.centerPanel | REBUILD |
| Per-platform connection card | NEW · build from `GlassCard` + `PlatformBadge` ported | inside grid | REBUILD |
| OAuth-redirect handler | NEW · Tauri scheme handler + bus event | `bridge/tauri-adapter.ts` extension | **REBUILD · HIGH** |
| Channel disconnect confirmation | `<Drawer>` | triggered from connection card | REBUILD (use Drawer primitive) |
| Account-info pill | `<GlassCard>` sub-component · extract from PlatformBadge | per-tile footer | PORT |
| Connection-health panel | NEW | Channels right rail | REBUILD |
| Empty state | `EngineEmptyState` pattern | route-level fallback | PORT |
| PlatformBadge / PlatformBadgePicker | extract + port unchanged | reused everywhere | PORT |

#### Schedule route (Phase 6J)
| Brick | Host | Mount point | Verdict |
|---|---|---|---|
| Queue table (clip thumb · platform · scheduled_for · status) | NEW · use `<GlassCard>` rows | Schedule.centerPanel main view | REBUILD |
| Status badges | NEW · reuse Kade badge color tokens (fx / cy / amber / danger) | per-row | REBUILD |
| Per-row Cancel · Edit-time · Reschedule | NEW buttons + Drawer for edit | per-row | REBUILD |
| Calendar / drip view | NEW · simple grid (defer `react-big-calendar`) | alt tab inside Schedule | REBUILD (basic now) |
| Per-day cap warning | NEW | inside Schedule top strip | REBUILD |
| "Add to queue" CTA | NEW button | Schedule + ClipPreview action | PORT |
| Failed-queue panel | NEW · uses `BakeErrorStrip` pattern | Schedule sub-section | REBUILD |
| Empty state | `EngineEmptyState` pattern | route-level fallback | PORT |
| Schedule presets | NEW chip group | Schedule + PublishModal | PORT (extract from BottomCockpit popover) |
| Retry-count visibility (`retry_count / 3`) | NEW · inline pill | per failed row | REBUILD |
| `useSchedulePolling` hook | NEW | `state/useSchedulePolling.ts` | REBUILD |
| `useScheduleCountdown` hook | NEW | per-row | REBUILD |

### 6.5 New infrastructure required (cross-route)

| Infrastructure | File | Risk | Notes |
|---|---|---|---|
| Add `"export"` to `EngineStage` + `EngineCompletionKind` | `bridge/events.ts` | LOW | one-line additions |
| Extend `tauri-adapter` to re-emit `sidecar:export_*` and `sidecar:publish_*` | `bridge/tauri-adapter.ts` | LOW | additive |
| Sidecar-stub: `exportClip`, `connectChannel`, `disconnectChannel`, `listChannels`, `scheduleClip`, `listScheduledClips`, `rescheduleClip`, `cancelSchedule`, `listFailedSchedules` | `engine/sidecar-stub.ts` | LOW | mirror legacy signatures + mock fallbacks |
| Tauri scheme handler for OAuth deep-link · `tauri://channel-oauth?code=…&state=…` | new Rust shell command + bus emit | **HIGH** | requires Tauri capability + Rust touch (out of "no backend" rule — keep as deferred until runtime phase) |
| `useSchedulePolling` · 10s interval · `bus.emit("schedule:update")` | `state/useSchedulePolling.ts` | MED | care needed on cleanup + tab visibility |
| `useScheduleCountdown(scheduledFor)` | inline | LOW | pure time math |
| Extend `engineSessionPersistence`: `connectedChannels: Record<platform, ConnectedChannelInfo>`, `scheduledQueueIds: string[]` | `state/engineSessionPersistence.ts` | LOW | additive |

### 6.6 Assets · already shipped

- `/brand/clip-fx/trail-publish.svg` (already exists · used in Channels nav row)
- `/brand/clip-fx/rocket-export.webp` (exists · used in CommandRoom action card)
- Per-platform glyphs · need to confirm presence under `/brand/icons/social/` or similar; if missing, defer with PlatformBadge using inline SVG fallback (legacy uses inline brand SVG)

---

## 7 · Missing pieces

### 7.1 What already exists (clean port)
- All 9 publish RPCs in legacy `sidecar.ts` — shape-stable
- Ayrshare backend wrapper (full surface, including `media_upload`, `post`, `history`, `analytics`, `create_profile`, `cancel_scheduled`)
- 4 platform paths live end-to-end (YT Shorts · TikTok · IG Reels · X)
- Webhook receiver (`POST /webhooks/ayrshare`) with idempotency + out-of-order guards
- Backend Schedule table contract + retry policy (max 3x · exponential backoff)
- Phase 6D Studio bricks `ExportPanel` + `CaptionDrawer` + `OverlayTemplateGallery` ready to host the Export route
- Design OS `ModalPortal` · `Drawer` · `GlassCard` · `MetricBoard` · `CountdownBoard` · `AllowanceBar` · `BakeErrorStrip` · `EngineActions` · `EngineHealthPanel` · `EngineEmptyState` · `useEngineSession` · `useEngineSessionPersistence` · `useRuntimeInfo` · `useKadeFromSession`
- Iron Gates IG-005 (clip.overlay single source of truth) · IG-010 (bake/regenerate/template start/cancel pairs)

### 7.2 What's broken / inconsistent
- **Render queue lost on crash** — every `threading.Event` is in-memory; `clip.overlay.bake_status = "pending"` lingers in project.json
- **Auto-retry cron now reconciliation poll only** — no automatic retry on backend Schedule; all retries are manual
- **Two "pending" states surfaced separately** — `LocalQueue` and `ScheduleQueue` not merged in UI
- **Retry depth not visible** — users don't see `retry_count / 3`
- **DirectPublishQueue is dead code** — still mounted conditionally on Upload tab; consolidate into Schedule
- **Document uploads (LinkedIn)** not exposed in legacy UI
- **Audience Network (Facebook)** not exposed in legacy UI
- **Carousel (Instagram)** not supported in v0

### 7.3 What must be REBUILT (not just ported)
- `<ModalPortal>` host for PublishModal (already present in DS · just mount the migrated modal)
- OAuth deep-link Tauri scheme handler (requires Rust shell capability)
- Channel grid (legacy was a list · DS wants tile layout)
- Schedule calendar view (legacy had only a queue table)
- Failed-queue panel with retry-from-dead-letter affordance
- Render-queue persistence (file-backed for crash recovery)
- `useSchedulePolling` long-poll hook
- Per-platform connection card with health panel

### 7.4 What must be REDESIGNED (decision points)
- **Merged queue view** — Local + Backend rendered as one timeline · per-row indicator says "local reminder" vs "Ayrshare auto-fire"
- **Channel grid layout** — 8 tiles? 6 tiles + "more"? Per Daniel's brief
- **OAuth flow positioning** — full-modal vs Drawer · per platform variance (YouTube's iframe-bounce is unique)
- **Retry surface** — failed-queue panel inline vs separate route

### 7.5 What can be DEFERRED
- `DirectPublishQueue` (dead code · archive)
- Calendar primitive upgrade (`react-big-calendar` etc.)
- Drip scheduling · `DripSlot` shape
- Document uploads (LinkedIn) · Audience Network (Facebook)
- Analytics (per-post engagement)
- Posting history view (Ayrshare `/history`)
- Real OAuth deep-link Tauri handler (until runtime phase ships)
- Render-queue persistence (sidecar runtime change)
- Auto-retry cron logic (backend change)
- Long-form YouTube full publish (Phase 6F episode thumbnails pair with this · sequencing decision)

---

## 8 · Phase 6H–6J build order

> Easiest → hardest. One brick per step. Each step ends with tsc green + leak test clean. No step ships a real Ayrshare call until the runtime phase.

### Phase 6H · Export fit-out (10 steps · ~3 hours focused work)

| # | Brick | Risk |
|---|---|---|
| H-1 | Extend `EngineStage` + `EngineCompletionKind` with `"export"` (events.ts · two-line change) | LOW |
| H-2 | Extend `tauri-adapter` to re-emit `sidecar:export_*` channels (defensive — no Tauri events fire today) | LOW |
| H-3 | Extend `sidecar-stub.ts` with `exportClip(slug, idx, format, preset, watermark)` mock + bus emits matching ingest pattern | LOW |
| H-4 | Route registration · Export already exists in registry as `studio` · build dedicated `export` SimPage stub OR mount ExportPanel inside Studio (decision: Export gets its own route id?) | LOW |
| H-5 | Move `ExportPanel` from TimelineStudio to dedicated Export route surface · keep TimelineStudio mount as a "shortcut" | LOW |
| H-6 | Build `ExportQueueProgress` GlassCard · uses `AllowanceBar` to show "X of Y exporting" | LOW |
| H-7 | Build `ExportQueueHistory` table · per-row clip thumb · format · preset · status · timestamp · path | LOW |
| H-8 | Extend `BakeErrorStrip` to catch `engine:error { kind: "export" }` | LOW |
| H-9 | Wire `useGlobalBakeEvents` style singleton wait-hook for export complete | LOW |
| H-10 | Add `EngineErrorBoundary` around each Export brick · verification + screenshots | LOW |

### Phase 6I · Channels fit-out (12 steps · ~4 hours)

| # | Brick | Risk |
|---|---|---|
| I-1 | Add `connectedChannels: Record<platform, ConnectedChannelInfo>` to `engineSessionPersistence` types | LOW |
| I-2 | Extend sidecar-stub with `listChannels()`, `connectChannel(platform)`, `disconnectChannel(platform)`, `refreshChannel(id)` (mock implementations) | LOW |
| I-3 | Port `PlatformBadge` + `PlatformBadgePicker` into `design-os/channels/PlatformBadge.tsx` · strip lucide if present · brand glyphs | LOW |
| I-4 | Build `ChannelEmptyState` (pattern matches EngineEmptyState) | LOW |
| I-5 | Build `ChannelTile` (per-platform card · connected/pending/disconnected states · health badge) | MED |
| I-6 | Build `ChannelGrid` (8 tiles · `<GlassCard>` grid · uses `ChannelTile`) | MED |
| I-7 | Build `ChannelDisconnectDrawer` (confirmation in `<Drawer>` · two-step) | LOW |
| I-8 | Mount Channels route · empty state + grid + disconnect drawer · per-card error boundary | LOW |
| I-9 | Build `ChannelConnectionHealth` panel (last publish · monthly post count · token expiry) | LOW |
| I-10 | Build `ChannelOAuthStub` — opens system browser to Ayrshare link URL · displays "complete in browser then return" copy · listens for window focus to re-query channels (no Tauri scheme handler in this phase) | MED |
| I-11 | Wire `usePlatformConnections` style hook reading from `engineSessionPersistence` + `sidecar.listChannels()` polling on focus | MED |
| I-12 | Verification + screenshots · empty · grid · OAuth-in-progress · connected · disconnect drawer | LOW |

### Phase 6J · Schedule fit-out (14 steps · ~4.5 hours)

| # | Brick | Risk |
|---|---|---|
| J-1 | Add `scheduledQueueIds: string[]` to `engineSessionPersistence` types | LOW |
| J-2 | Extend sidecar-stub with `localScheduleList / Add / Cancel / MarkPosted` + `scheduleClip / listScheduledClips / rescheduleClip / cancelSchedule / listFailedSchedules` (mock fallbacks) | LOW |
| J-3 | Port `LocalScheduleItem` shape · `BackendScheduleRow` shape into `design-os/schedule/types.ts` (mirror legacy) | LOW |
| J-4 | Build `useSchedulePolling(intervalMs)` hook (10s interval · pauses when `document.hidden`) | MED |
| J-5 | Build `useScheduleCountdown(scheduledFor)` hook (minutes/seconds until fire) | LOW |
| J-6 | Build `ScheduleEmptyState` (pattern · CTA back to clips) | LOW |
| J-7 | Build `SchedulePresets` (Now / +1h / Tomorrow 9am / custom datetime-local) — extract pattern from BottomCockpit | LOW |
| J-8 | Build `ScheduleRow` (clip thumb · platform badge · status badge · countdown · Cancel + Edit time + Reschedule buttons) | MED |
| J-9 | Build `ScheduleTable` (merged Local + Backend rows · sortable by scheduled_for · uses ScheduleRow) | MED |
| J-10 | Build `RetryFromDeadLetter` panel (`failed` filter · `retry_count / 3` visible · manual retry button) | MED |
| J-11 | Build `ScheduleEditDrawer` (date-time picker · platform selector · save) | MED |
| J-12 | Mount Schedule route · empty state + table + presets + dead-letter + edit drawer · per-brick error boundary | LOW |
| J-13 | Wire `useSchedulePolling` at route root · drives ScheduleTable refresh | MED |
| J-14 | Verification + screenshots · empty · queue with mixed local + backend · failed queue · edit drawer · countdown live | LOW |

### Deferred (Phase 7+ · explicit)
- DirectPublishQueue cleanup (archive component)
- Tauri OAuth scheme handler (`tauri://channel-oauth?...`) — requires Rust capability
- Render-queue persistence (`.bake-queue.jsonl`) — sidecar runtime change
- Auto-retry cron logic — backend change
- Drip-scheduling `DripSlot` view
- LinkedIn document uploads · Facebook Audience Network
- Instagram Carousel
- Posting history view
- Analytics per-post engagement
- Calendar primitive upgrade
- Real Ayrshare backend call wiring

---

## 9 · Risk ledger

| Risk | Likelihood | Mitigation |
|---|---|---|
| Render queue persistence missing — crashes lose work | MED · already a known legacy gap | Surface "lost on crash" in Phase 6H UI honestly; defer persistence to runtime phase |
| OAuth deep-link Tauri handler complexity | HIGH · Rust shell touch | Phase 6I uses "open in browser + poll on focus" pattern · real deep-link in Phase 7+ |
| Two queue families merged into one UI confuses users | MED | Per-row indicator says "local reminder" vs "Ayrshare auto-fire" |
| Schedule polling drains battery | MED | Pause when `document.hidden` · stretch interval to 30s if no in-flight rows |
| Webhook deduplication relies on `idempotencyKey` | LOW · backend-side | n/a for Phase 6H–6J · backend already handles |
| Ayrshare org key exposure | LOW · server-only | n/a · key never leaves backend |
| `_should_watermark()` cache TTL (600s) vs UI state | LOW | Phase 6H reads tier via existing `useRuntimeInfo` extension · 10s drift OK |
| Iron Gate violation during port | LOW | IG-005 (clip.overlay) + IG-010 (start/cancel pairs) travel with the RPC names · names unchanged |

---

## 10 · Phase 6H–6J readiness checklist

- [x] Route entries exist (`channels` + `schedule` in routeRegistry · `studio` already has ExportPanel)
- [x] `ModalPortal` + `Drawer` portal-to-body ready
- [x] `GlassCard` + `AllowanceBar` + `MetricBoard` + `CountdownBoard` ready
- [x] `EngineErrorBoundary` ready
- [x] `BakeErrorStrip` ready (extend for `kind: "export"` + `kind: "publish"`)
- [x] `useEngineSession` · `EngineSessionProvider` already wraps Engine + Studio + Thumbnail
- [x] `useEngineSessionPersistence` extensible
- [x] `useRuntimeInfo` + `EngineHealthPanel` ready
- [x] `ToastHost` + `DropOverlay` ready
- [x] `engine:progress / complete / error` ready (add `"export"` to stage + completion-kind unions)
- [x] `tauri-adapter` extensible
- [x] PlatformBadge brand glyphs available (inline SVG fallback if `/brand/icons/social/` missing)
- [x] Watermark gate via tier read available through `useRuntimeInfo` pattern
- [ ] **Phase 6H step H-1 onwards** (route + 4 new sidecar-stub methods + 3 new components + verification)

---

## 11 · Multi-account campaign publishing model

> **Critical requirement (added 2026-06-18):** Liquid Clips must support multi-account publishing at scale. Example: **Brand A · 10 campaigns · 10 clips per campaign · 5 social accounts per clip = 500 scheduled publishing jobs.**
>
> This section audits whether the existing stack supports that shape, identifies the gaps, proposes a data model, and ranks the new build work alongside Phase 6H–6J.

### 11.1 Verdict at a glance

**Capability matrix — what works today vs what's needed for 500-job campaign publishing:**

| Capability | Today | Needed for example | Verdict |
|---|---|---|---|
| Multi-account per platform · DB | ✅ supported (`SocialChannel` table · no unique(`user_id`,`platform`) constraint) | needs to remain | ✅ KEEP |
| Multi-account per platform · UI | ✅ supported (`PublishModal` + `ChannelPicker` pick channel_id not platform) | needs to remain | ✅ KEEP |
| Per-channel scheduled time | ✅ supported (each `Schedule` row independent `scheduled_for`) | needs to remain | ✅ KEEP |
| Per-channel caption override | ✅ supported (`Schedule.caption_override`) | needs to remain | ✅ KEEP |
| Per-channel failure tracking | ✅ supported (`Schedule.status` + `Schedule.error` per row) | needs to remain | ✅ KEEP |
| Webhook differentiation by profileKey | ✅ supported (matches on `profileKey` then falls back to `refId`) | needs to remain | ✅ KEEP |
| Connect a SECOND account on the same platform | ❌ **BLOCKED** · `channels.py:319-322,342-372` reuses existing `(user_id, platform)` row | must work | 🔴 **MUST FIX** |
| Tier ceiling at Agency=15 / Founder=30 channels | ⚠ hard cap = Ayrshare Business 30-profile limit | 5 accounts per clip × clip count = many channels per brand | 🟠 RAISE / re-tier |
| Brand entity | ❌ NO `Brand` table | required (1 brand owns N accounts + N campaigns) | 🔴 **NEW MODEL** |
| Campaign entity (user-owned) | ❌ NO `Campaign` table · campaigns only exist as Whop sponsored bounties (admin-only) | required (10 campaigns per brand) | 🔴 **NEW MODEL** |
| Clip → multi-account fan-out endpoint | ❌ NO batch endpoint · desktop loops one `POST /publish-now` per channel | 5 calls per clip · acceptable for now · batch later | 🟠 OPTIMISE later |
| Queue scale to 500 rows | ✅ Postgres + `(scheduled_for)` index handles it · backend Schedule was designed for this | required | ✅ KEEP |
| Auto-retry on failure | ⚠ manual only (`/schedules/{id}/retry`) · `MAX_RETRIES=3` exponential backoff exists in cron but is no longer auto-firing | required for 500 jobs (manual retry of dozens unrealistic) | 🟠 RE-ENABLE cron |
| Per-job cancellation | ✅ supported (`/schedules/{id}/cancel`) | required | ✅ KEEP |
| Status updates per job | ✅ supported (webhook flips `scheduled` → `published` or `failed`) | required | ✅ KEEP |
| Workspace / brand-scoped account ownership | ❌ `SocialChannel.user_id` only · no `brand_id` or `workspace_id` | required (one user can manage multiple brands eventually) | 🟠 DEFER until multi-tenant phase |

**Bottom line:** the **data layer for one clip → multiple channels is fully wired** (channels · captions · times · status all independent). The **missing pieces are the Brand + Campaign entities and the second-account-per-platform OAuth flow**. Ayrshare's per-profile pricing is a real constraint at scale but doesn't block the architecture.

### 11.2 Audit findings · what's there

#### A · Multi-account per platform · DB
Legacy `SocialChannel` table (`junior-backend/app/models.py:271-312`):
- `user_id` (FK to users.id) — sole owner reference
- `platform` (string · "tiktok" / "youtube" / …)
- `label` (str · user-facing differentiation · e.g. "TikTok @alice", "TikTok @bob")
- `handle` (str · @username pulled from Ayrshare)
- `ayrshare_profile_key` (str · `unique=True` constraint · **one profileKey per channel**)
- `status` (active · pending_link · unlinked · error · paused · deleted)
- **No unique constraint on `(user_id, platform)`** — DB allows N channels per user per platform.

#### B · Multi-account per platform · UI + Publish RPC
- `usePlatformConnections.ts:76-79` — `getChannel()` returns one Channel; status is channel-level not platform-level.
- `ChannelPicker.tsx:48-49,81-84` — picker holds `value: string | null` = channel_id (not platform name). Filters by platform but selects individual channel.
- `PublishModal.tsx:145-146,285-292` — stores `pickedChannelId` (UUID). One `/publish-now` call per channel.
- `masterClipActions.ts:144-155,185-191` — `publishClipsNow(project, idxs, channelIds[])` uses `Promise.allSettled()` to fan out per-channel independently. **One bad channel doesn't sink the rest.**
- `publish.py:77-127` — `/publish-now` accepts `channel_id` OR legacy `platforms` string. New path (110-118): resolves ONE channel by id, infers platform, posts to that channel's Ayrshare profile.

#### C · Per-job state · independent
Each `Schedule` row (`models.py:138-169`):
- `channel_id` (FK to social_channels.id) — one row per (clip, channel, time) tuple
- `scheduled_for` (UTC indexed)
- `status` (pending · uploading · scheduled · published · failed · canceled)
- `error` (per-row failure reason · independent)
- `caption_override` (per-row caption · different captions to different accounts WORKS)
- `retry_count` (0–3 · MAX_RETRIES)
- `next_retry_at` (exponential backoff: 1min · 5min · 25min)
- `actual_post_url` (post URL when `published`)
- `ayrshare_scheduled_post_id` (Ayrshare's job id for cancellation)

→ The **example "scheduling 1 clip to 5 accounts with different captions and different times"** produces 5 `Schedule` rows, each independent. ✅ This works.

#### D · Ayrshare profile model
`ayrshare.py` summary:
- Single org-wide API key (`AYRSHARE_API_KEY`) at Business tier ($599/mo · 30 profiles included)
- `create_profile(title, email=None)` mints a new sub-profile per channel
- `post(text, platforms, media_urls, profile_key, scheduled_at=None)` targets a specific profile via `Profile-Key` HTTP header
- Each `SocialChannel.ayrshare_profile_key` is unique — one profileKey per channel — and webhook events differentiate via that key (`webhooks_ayrshare.py:182-197`)

### 11.3 Audit findings · what's blocked

#### Blocker 1 · Cannot connect a second account on the same platform
**Code path:** `channels.py:315-373`. When a user clicks "Link TikTok" for the second time:
- Line 319-322 checks if `(user_id, platform='tiktok')` already exists.
- Line 342-372 **REUSES** the existing row + same profileKey. The OAuth flow re-opens for the SAME Ayrshare profile, which would overwrite the existing connection rather than create a second one.

**Effect:** Brand A can only own ONE TikTok channel through the legacy UI. The DB allows multiple rows; the UI flow does not.

**Fix shape:** Add a "Label this account" step at the start of the second connect → bypass the reuse block → call `ayrshare.create_profile(title=label)` → store a new SocialChannel row with the new profileKey. Estimated ~80 LOC backend + a small Drawer in the UI.

#### Blocker 2 · No Brand entity
**Code path:** `junior-backend/app/models.py:1-855`. No `Brand` table. No `brand_id` on `SocialChannel`, `Schedule`, or `User`.

**Effect:** Multi-tenant management of multiple brands by one user is impossible. Currently `user_id` doubles as the implicit brand identifier.

**Fix shape:** New `Brand` table · `brand_id` FK on `SocialChannel`, `Campaign`, and `Schedule`. **Defer to a multi-tenant phase** — Phase 6H–6J ships as `brand_id = user_id` shim.

#### Blocker 3 · No user-owned Campaign entity
**Code path:** `models.py:511-563` — `CampaignSubmission` exists but is a **Whop proxy** for sponsored bounties (admin-created). `SponsoredCampaign` (`models.py:565-658`) is the same Whop-admin pattern. There is no `Campaign` model that a user can create as "this is my Wednesday-drop campaign."

**Effect:** No way to group clips into campaigns at the data layer. Currently `project_slug` is the only grouping (one project = one campaign roughly).

**Fix shape:** New `Campaign` table · `campaign_id` FK on `Schedule` row · UI shows campaigns in Library. Estimated 1-2 days backend + 2-3 days UI.

#### Blocker 4 · No batch publish endpoint
**Code path:** `publish.py:118` — `platform_list = [channel.platform]` (single platform per call). To publish one clip to 6 channels, desktop must loop 6 times.

**Effect:** Bandwidth and rate-limit pressure at scale. For 500 jobs you'd make 500 outbound HTTP calls.

**Fix shape:** `POST /publish-multi` accepting `[ {channel_id, caption_override, scheduled_at}, … ]`. Backend uploads media once, loops Ayrshare `post()` per channel, persists N Schedule rows. Roughly 200 LOC backend. **Defer until Phase 6J load testing.**

#### Blocker 5 · Tier ceiling + Ayrshare cost
- Tier caps: Free=0 · Solo=2 · Pro=5 · Agency=15 · Founder=30 (= Ayrshare Business 30-profile limit).
- Each connected channel = 1 Ayrshare sub-profile = ~$20/profile/month at Business tier.
- For 100 users × 10 channels = 1,000 profiles needed → **Ayrshare Enterprise contract required.**

**Effect:** the architecture supports 500-job campaigns per brand but the **billing relationship with Ayrshare must upgrade** before this becomes a real-world flow.

**Fix shape:** out of Phase 6H–6J scope · commercial decision.

#### Blocker 6 · Auto-retry cron is reconciliation-only
**Code path:** `junior-backend/app/cron.py:57-59` — the cron job that was meant to auto-retry failed `Schedule` rows is now a reconciliation poll only. All retries are manual via `/schedules/{id}/retry`.

**Effect:** 500 jobs with even a 2% failure rate = 10 failed rows that a human must click Retry on individually.

**Fix shape:** re-enable cron's auto-retry path · enforce `MAX_RETRIES=3` exponential backoff server-side · publish notification on permanent failure. Estimated 50 LOC backend.

### 11.4 Required data model

The minimal addition to support the example (no multi-tenant yet · `brand_id = user_id` shim):

```
existing:
  User
    └─ user_id (PK)

NEW · user-owned campaign hierarchy:
  Campaign
    ├─ id (PK · UUID)
    ├─ brand_id (FK · for now = user_id)
    ├─ name (str · e.g. "Wednesday drop")
    ├─ project_slug (FK → sidecar Project · the long-form source)
    ├─ status (draft / active / archived)
    ├─ created_at / updated_at
    └─ (1:N clips via Clip table or via project.json)

  Clip (already in sidecar project.json — no DB table for now)
    └─ {project_slug, clip_idx} composite identity

EXTEND · existing tables:
  SocialChannel
    ├─ ... (existing fields)
    └─ + brand_id (FK · for now = user_id) — preps for multi-tenant phase

  Schedule
    ├─ ... (existing fields)
    └─ + campaign_id (FK → Campaign) — surfaces campaign-grouped views
```

**Cardinality:**
- 1 Brand → N Campaigns
- 1 Campaign → N Clips (via project_slug)
- 1 Campaign → N Schedule rows (1 per clip × target account × scheduled time)
- 1 Clip → N target accounts (each = 1 SocialChannel row)
- 1 Schedule row → exactly 1 SocialChannel · 1 Clip · 1 scheduled_for · 1 caption_override

**For the example (Brand A · 10 campaigns · 10 clips · 5 accounts each):**
- 10 Campaign rows
- 50 SocialChannel rows (5 accounts could be shared across campaigns if same brand owns them all)
- 100 Clips (in 10 Project files on the sidecar side)
- 500 Schedule rows (10 × 10 × 5)

**500 rows is well within Postgres's comfort zone** (the `scheduled_for` index keeps the cron poll cheap). The bottleneck is the **outbound HTTP fan-out** (one Ayrshare call per row · solved by Blocker 4's batch endpoint when load demands it).

### 11.5 Design OS requirements (Phase 6I + 6J updates)

#### Channels route — extends Phase 6I plan
| Brick | Existing 6I plan | Multi-account addition |
|---|---|---|
| Channel grid (8 platform tiles) | one tile per platform | one tile **per account**; tiles group by platform with collapse/expand; tile shows account label + handle + tier + brand badge |
| Per-platform connection card | shows status | shows status + **account label** + **brand badge** + per-account "edit label" affordance |
| OAuth redirect handler | one per platform | OAuth flow opens with required "Label this account" step BEFORE Ayrshare redirect; on second-account flow, bypasses the reuse block |
| Account-info pill | avatar + handle + tier | + **brand badge** + per-account "campaign assignment" pill (which campaigns target this account) |
| Connection-health panel | last publish · monthly posts | + per-campaign breakdown · "this account is in 3 active campaigns" |
| Campaign-assignment column | n/a · NEW | List of campaigns currently targeting this account · click to filter Schedule |

#### Schedule route — extends Phase 6J plan
| Brick | Existing 6J plan | Multi-account addition |
|---|---|---|
| Queue table | clip · platform · time · status | + **campaign column** · + **account column** (account label + handle) |
| Filter chips | n/a | by campaign · by brand · by platform · by account · by status |
| Calendar / drip view | per-platform lanes | per-platform-per-account lanes (5 accounts = 5 sublanes) |
| Per-day cap | shared across user | per-account cap (TikTok caps differ from YouTube) |
| Failed-queue panel | retry from dead-letter | + **bulk retry per campaign** affordance |
| Schedule presets | Now / +1h / Tomorrow 9am / custom | + per-account staggering ("post to account A now, account B in 30min, account C in 2h" — drip strategy) |
| Campaign breakdown widget | n/a · NEW | "Wednesday Drop campaign: 47/50 posted · 2 pending · 1 failed" header strip |

#### New routes implied (DEFER beyond Phase 6J)
- **Campaigns route** — user creates/manages campaign entities. Currently Campaigns route in routeRegistry maps to Whop sponsored bounties; a new tab or route for "My campaigns" is needed. Phase 7+.
- **Brand settings** — multi-tenant phase only.

### 11.6 Build order (slots into Phase 6H–6J)

> No new phases. New bricks slot into 6I (Channels) and 6J (Schedule). One brick per step. Easy → hard.

#### Phase 6I additions (Channels · ~3 extra hours)
| # | Brick | Risk |
|---|---|---|
| I-13 | Extend `SocialChannel` mock data in `sidecar-stub` to support N rows per platform · 2 fixture TikTok accounts · 1 fixture IG · 1 fixture YT | LOW |
| I-14 | Build "Label this account" Drawer that opens BEFORE the OAuth browser handoff · required for any second-account flow | LOW |
| I-15 | Extend `ChannelTile` to display account label + handle + brand badge | LOW |
| I-16 | Group ChannelGrid by platform (collapse/expand per-platform) · show count chip per platform | LOW |
| I-17 | Add "campaigns using this account" pill on ChannelTile (count + click-to-filter Schedule) | LOW |

#### Phase 6J additions (Schedule · ~5 extra hours)
| # | Brick | Risk |
|---|---|---|
| J-15 | Add `campaign_id` + `account_label` + `brand_id` to mock `Schedule` shape in `sidecar-stub` | LOW |
| J-16 | Extend `ScheduleTable` with Campaign + Account columns · keep narrow on mobile | LOW |
| J-17 | Build `ScheduleFilters` (brand · campaign · platform · account · status · date range) · chip row above the table | MED |
| J-18 | Build `CampaignBreakdownStrip` (47/50 posted · 2 pending · 1 failed badge row) above the table when campaign filter is set | LOW |
| J-19 | Extend calendar view to per-account sublanes (each connected account = own row) | MED |
| J-20 | Add per-account stagger to `SchedulePresets` (drip strategy: account A now · B +30min · C +2h) | MED |
| J-21 | Bulk-retry-per-campaign button in failed-queue panel | MED |
| J-22 | Verification: 500-row fixture · scroll perf · filter perf · cancel-all-in-campaign perf | LOW |

#### Phase 7+ (deferred)
- New `Campaign` + `Brand` Postgres tables · `/api/campaigns` CRUD · `/api/brands` CRUD
- Bypass-the-reuse-block in `/channels` POST + "Label this account" step in backend
- `POST /publish-multi` batch endpoint (load testing flag)
- Re-enable cron auto-retry path (`MAX_RETRIES=3` server-side enforcement)
- Brand multi-tenancy (workspace abstraction)
- Ayrshare Enterprise contract negotiation
- Campaigns route surface (separate from Whop sponsored bounties)
- New `Campaign` ownership of clips (decouple from `project_slug`)

### 11.7 Risk ledger (multi-account specific)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Reuse-block in `channels.py:319-322` breaks second-account UX | HIGH (it already does) | Phase 7 backend fix · Phase 6I UI uses mock fixtures with multiple accounts so the surface is correct from day one |
| Ayrshare Business cap (30 profiles) bites at scale | MED · only when brands exceed 30 connected channels | Phase 6I shows "X of 30 used" prominently · upgrade to Enterprise becomes a billing event not a code event |
| Auto-retry cron silent · 500-job runs see manual retry pile | HIGH at scale | Phase 7 re-enable backend cron · Phase 6J surface `retry_count / 3` clearly so user knows what's pending |
| No batch publish endpoint · 500 POST calls per drop | LOW initially · MED at 10+ brands | Phase 6J accepts the serial pattern · Phase 7 adds batch endpoint when load testing demands |
| Campaign hierarchy invented at UI layer before backend persists it | MED | Phase 6J stores `campaign_id` in `engineSessionPersistence` so a campaign-as-frontend-construct works · backend Campaign table follows in Phase 7 |
| User confusion: "which TikTok account am I posting to?" | HIGH if not surfaced | Phase 6I requires account-label on every tile · Phase 6J Schedule row always shows account name not just platform |
| Multi-tenant phase (Brand entity) confused with Phase 6I-J campaign work | LOW | Brand entity DEFERRED · Phase 6I-J ships `brand_id = user_id` shim cleanly |

### 11.8 Summary

The legacy stack is **architecturally ready for multi-account campaign publishing at 500-job scale**. Every per-channel concern (caption · time · status · retry · cancel · webhook routing) works independently and correctly. The **two real gaps are the missing Campaign entity (deferred to Phase 7) and the OAuth reuse-block that prevents a second account from being connected** (also Phase 7 backend fix). Phase 6I + 6J ship a UI that **assumes multi-account is the default** (account-labelled tiles · campaign-filtered Schedule · per-account drip presets) so the moment the backend fixes land, the surface absorbs them without rebuild.

The example **Brand A · 10 campaigns · 10 clips · 5 accounts = 500 jobs**:
- Database can persist 500 `Schedule` rows comfortably (indexed by `scheduled_for`).
- Webhook routing per-profileKey correctly differentiates 500 simultaneous outbound posts.
- Postgres + the existing `(scheduled_for, status)` composite scan keeps the cron poll cheap.
- The bottleneck is **commercial** (Ayrshare Enterprise) and **operational** (auto-retry cron re-enabling), not architectural.

---

## 12 · Publishing UI + gating requirements

> **Added 2026-06-18.** Builds on §11. Spec for where account icons surface across the app, what "add account" does, every UI state, the tier-gating model, and how the data model expresses all of it.
>
> **Audit only. No build until Daniel says go.**

### 12.1 Account-icon surfaces · what appears where

The user must see the same connected-account information in the **5 places they touch publishing**: while reviewing clip candidates (Engine), inside the Studio export panel, on the Schedule queue, on the Channels management surface, and on the Campaigns route.

#### 12.1.1 `ClipCard` (Engine route)
**Currently shows:** virality score (0-100) · breakdown chips (hook/clarity/contrast/face) · platform badges (Y/T/I/X/L/F).

**Phase 6I+ must add:**
- Per-platform badge → **expandable account stack** (avatar pile when ≤3 accounts targeted · "+N" pill when more).
- Tiny status dot per account: queued · uploading · posted · failed · retrying.
- Hover/long-press → tooltip showing each account's label + status + scheduled time.
- **Inline "add account" affordance** below the badge row: small `+` chip that opens a popover with the eligible accounts for this platform plus the upgrade CTA when gated (see §12.2).

#### 12.1.2 Studio `ExportPanel` (Phase 6H surface)
**Currently shows:** format chips · preset chips · watermark line · "Studio preview" CTA.

**Phase 6H must add:**
- **Target-accounts row** above the CTA: chips of `{platform-glyph · account-label · scheduled-time}` · click chip to edit scheduled time / caption-override · "x" removes that target.
- **"Add account" chip** at end of row that opens the same popover as the ClipCard `+`.
- **Status mini-stack** when re-opening an exported clip: per-target status dot + "View on Schedule →" link.

#### 12.1.3 Schedule route (Phase 6J primary surface)
**Currently planned:** Queue table · status badges · per-row Cancel/Edit-time/Reschedule · Failed-queue panel · presets · `useSchedulePolling`.

**Multi-account additions (already in §11.5):**
- **Account column** with account label + handle + per-platform glyph + tier badge.
- **Campaign column** with campaign name + count chip ("3 of 50 in campaign").
- **Filter chips**: brand · campaign · platform · account · status · date range.
- **Per-campaign breakdown strip** above the table when a campaign is filtered: "47/50 posted · 2 pending · 1 failed".
- **Bulk-actions toolbar** when ≥1 row selected: bulk reschedule · bulk cancel · bulk retry · bulk export status report.

#### 12.1.4 Channels route (Phase 6I primary surface)
**Currently planned:** Channel grid · per-platform connection card · OAuth handler · disconnect drawer · empty state.

**Multi-account additions:**
- Tiles **group by platform** (collapse/expand). Header pill shows "TikTok · 3 of 5" (used/cap-for-tier).
- Each tile is **one account** (not one platform): avatar + label + handle + brand badge + per-tile health (last successful publish, posts this month).
- **"Add account" tile** at the end of each platform group (or after the last connected one): opens the OAuth flow with the "Label this account" Drawer first (per §11.3 Blocker 1).
- **Locked tile** appears when the user has hit their tier cap for that platform: greyed avatar + lock glyph + "Pro: up to 3 TikTok accounts · Upgrade".
- **Plan-limit strip** at top of the route: "Pro · 12 of 30 channel slots used · 5 brands max". Click to open Settings → Billing.

#### 12.1.5 Campaigns route
**Currently:** a SimPage stub mapped to mission-pedestal world (Whop sponsored bounties). The multi-account model needs a **user-owned campaigns view** that may live as a second tab inside the existing Campaigns route, OR as a new route.

**Phase 7+ scope:** for each user-owned campaign card:
- campaign name · brand badge · status (draft / active / archived)
- **target-account pile**: stack of account avatars across all clips in the campaign · "+N" pill
- per-campaign metrics: clips · scheduled · posted · failed (rolls up to the Schedule view filter)
- **"Campaign account template"** editor (Agency tier) — define which accounts every new clip in this campaign inherits.

### 12.2 "Add account" behaviour

When the user clicks `+ Add account` from any surface (ClipCard chip · ExportPanel chip · Channels tile · Campaign template), the **same component** opens — a portaled popover/drawer that shows:

1. **Connected accounts** for the originating platform · click to toggle as target for the active clip/export/campaign.
2. **Eligible-but-not-connected accounts** — buttons to start a new OAuth flow (uses the Drawer-first "Label this account" pattern from §11.3 Blocker 1).
3. **Locked accounts** · greyed out · lock glyph · per-tier reason copy. Example: a 4th TikTok slot shown to a Pro user (cap=3) with copy: "Upgrade to Agency to connect more TikTok accounts."
4. **Plan-limit notice** at the bottom: "X of Y channels used in your plan."
5. **Upgrade CTA** · pink primary button → routes to Settings → Billing.

| Surface | Component used | Mount slot |
|---|---|---|
| ClipCard `+` | `<AddAccountPopover>` (NEW) | small popover anchored to the chip |
| ExportPanel `+` | same `<AddAccountPopover>` | popover anchored to target-accounts row |
| Channels "Add account" tile | `<AddAccountDrawer>` (NEW) | Drawer on right rail, opens OAuth-first flow |
| Campaign template editor | `<AddAccountDrawer>` | reuses the Channels-tier drawer with a "Apply to all clips" toggle |

The popover and drawer **read from the same state** (the user's connected/eligible/locked channel list + their tier caps) so the experience is consistent. State source: `useChannels()` hook + `useRuntimeInfo().tier`.

### 12.3 Required UI states · per surface

Every account chip / row / tile must distinctly render these states. The Phase 6I+ design system must define one CSS token per state and one optional copy line for tooltip / aria-label.

| State | Visual cue | Copy (default) | Tooltip / a11y |
|---|---|---|---|
| **no-accounts** | dashed border · `+` glyph · grey | "Add account" | "No accounts connected yet" |
| **connected (idle)** | full-colour avatar · platform glyph corner | "Daniel · @ddbeauty" | "Connected · click to manage" |
| **connected (active target)** | fuchsia ring · "Targeted" pill | "Targeted for this clip" | "Will publish here · click to remove" |
| **scheduled** | clock glyph · "9:00 AM" | "Scheduled · in 3h 24m" | accessible countdown |
| **uploading** | spinner + pulsing border | "Uploading…" | live status |
| **posted** | cyan ring · check glyph · link icon | "Posted 2h ago" | clicking opens published URL |
| **failed** | red ring · `!` glyph | "Failed · 2 of 3 retries" | "Click to retry" |
| **retrying** | amber ring · countdown to next attempt | "Retrying in 4m" | "Next retry at HH:MM" |
| **account-expired** | grey ring · key glyph | "Reconnect needed" | "Token expired · click to relink" |
| **plan-limit-reached** | locked tile · pink lock glyph | "Pro: up to 3 · Upgrade" | "Plan limit hit · upgrade for more accounts" |
| **campaign-account-locked** | grey overlay · campaign-stamped glyph | "Campaign template" | "Locked by campaign template · edit in Campaigns" |

These eleven states are the contract. Any new surface introduced after Phase 6J must consume the existing state-renderer rather than invent a new one.

### 12.4 Gating model · per tier

Tier names align with the Phase 6F brand-preset audit (Clipper / Pro / Agency) and the legacy `_MAX_CHANNELS_BY_TIER` constants (`channels.py:48-50`).

| Limit | Clipper (Free/entry) | Pro | Agency |
|---|---|---|---|
| **Connected channel slots (total)** | 2 | 5 | 15 |
| **Connected channels per platform** | 1 | 3 | 5 |
| **Brands / workspaces** | 1 | 1 | 5 |
| **Campaigns per brand** | 1 | 5 | 20 |
| **Clips per campaign** | 10 | 50 | unlimited (soft cap 200) |
| **Scheduled posts per month** | 25 | 250 | 2,500 |
| **Accounts targeted per clip** | 1 | 3 | 10 |
| **Bulk-scheduling actions** | n/a · single only | up to 25 rows in one action | unlimited |
| **Campaign account templates** | n/a | n/a · per-campaign only | yes · per-brand and per-campaign |
| **Watermark on export** | always on · cannot disable | off by default · cannot re-enable | off by default · cannot re-enable |
| **Queue priority** | standard | priority lane (fires first when minute slot is shared) | priority + drip-strategy presets |
| **Brand identity (gpt-image-1)** | shared default | custom per brand | custom per brand × campaign |
| **Auto-retry depth** | 3 (legacy default) | 3 + email on permanent failure | 3 + Slack/email + manual-retry batch |
| **Posting history retention** | 30 days | 90 days | 1 year |
| **Analytics access** | post URLs only | post URLs + engagement counts | + per-campaign rollups + CSV export |

**Hard caps anchored to commercial reality:**
- Agency total = **15 channels** stays under the Ayrshare Business 30-profile umbrella with headroom for 2 Agency seats / org.
- Agency monthly = **2,500 posts** stays below Ayrshare's 3,000 post / profile / month rate-limit at $599/mo.
- Founder tier (=30 channels) is **not exposed in the UI** — it's an internal billing tier for Daniel + the team.

#### Gating enforcement points

| Where | What's checked | Failure behaviour |
|---|---|---|
| Channels "Add account" | tier_total_cap > current_connected_count AND tier_per_platform_cap > current_platform_count | render locked tile + upgrade CTA · no OAuth flow opens |
| Schedule "Add to queue" | tier_monthly_posts > current_month_scheduled_count | toast "You've used X of Y scheduled posts this month · upgrade" · row not created |
| ClipCard `+ Add account` | per-clip target cap (Clipper=1 · Pro=3 · Agency=10) | locked entries in the popover with upgrade CTA |
| Campaigns "New campaign" | tier_campaigns_per_brand cap | toast + upgrade CTA · creation blocked |
| ExportPanel watermark toggle | tier == "Clipper" | toggle disabled + tooltip "Upgrade to Pro for watermark-free" |
| Campaign template apply | tier == "Agency" | template UI hidden for non-Agency · "Agency feature" pill |

All checks read from a **single `useTierCaps()` hook** that returns `{ tier, caps, currentUsage }` so every surface enforces the same numbers. Backend mirrors the cap with `_MAX_CHANNELS_BY_TIER` already · monthly post cap is new and must land server-side.

### 12.5 Required data model · referenced from §11.4

The data model proposed in §11.4 already accommodates the UI requirements above. The UI surfaces add **no new tables** beyond the §11.4 spec; they reuse:

```
User
  └─ user_id (PK) · tier (FK to billing_plan)

NEW · Brand                              # Phase 7
  ├─ id · brand_id (PK)
  ├─ owner_user_id (FK) · the user who owns the brand
  ├─ name
  ├─ logo_path (optional)
  └─ tier_override (optional · Agency seats per brand)

NEW · Campaign                           # Phase 7
  ├─ id · campaign_id (PK)
  ├─ brand_id (FK)
  ├─ name
  ├─ project_slug (FK to sidecar Project)
  ├─ status (draft / active / archived)
  ├─ account_template (json · "every new clip in this campaign targets [account_ids]" · Agency only)
  └─ created_at / updated_at

EXTEND · SocialChannel                   # tweak existing
  ├─ ... (existing)
  └─ + brand_id (FK · shim = user_id during Phase 6I-J)

EXTEND · Schedule                        # tweak existing
  ├─ ... (existing)
  ├─ + campaign_id (FK · surfaces campaign-grouped views)
  └─ + retry_eta (optional · for "retrying in 4m" countdown UI)
```

**UI-state derivations** (no new persistence):
- `no-accounts` ← `SocialChannel.where(user_id=?, brand_id=?).count() == 0`
- `connected` ← `SocialChannel.status == "active"`
- `scheduled / uploading / posted / failed / retrying` ← `Schedule.status` + `Schedule.retry_eta`
- `account-expired` ← `SocialChannel.status == "unlinked"` OR `... == "error"` with token-expiry code
- `plan-limit-reached` ← `useTierCaps()` hook
- `campaign-account-locked` ← `Campaign.account_template` includes this account-id

### 12.6 Build-order integration with Phase 6H–6J

The UI work folds back into the existing build sequence. No new phases.

#### Slots into Phase 6H (Export)
| # | Brick |
|---|---|
| H-11 | Build `<TargetAccountsRow>` for ExportPanel · reads connected channels from `useChannels()` |
| H-12 | Wire `<AddAccountPopover>` (NEW) from Phase 6I as the `+` chip target |
| H-13 | Per-target status dot · reads `Schedule.status` if a row exists |
| H-14 | Watermark toggle disabled-state for Clipper · uses `useTierCaps()` |

#### Slots into Phase 6I (Channels)
| # | Brick |
|---|---|
| I-18 | Build `<AccountChipState>` (NEW · 11-state renderer per §12.3) — single canonical component |
| I-19 | Build `<PlanLimitStrip>` header on Channels route |
| I-20 | Build `<AddAccountPopover>` + `<AddAccountDrawer>` · same internal logic · different mount affordances |
| I-21 | Wire `useTierCaps()` hook · reads runtime mode + persisted tier · returns `{ tier, caps, currentUsage, isAtCap }` |
| I-22 | Show "X of Y used" copy at top of each platform group · click to open Settings → Billing |
| I-23 | "Locked tile" rendering + upgrade CTA · 6F-style cinematic pink button |

#### Slots into Phase 6J (Schedule)
| # | Brick |
|---|---|
| J-23 | Schedule row uses `<AccountChipState>` for the account column |
| J-24 | Filter chips honour tier caps · "Brands" filter hidden for non-Agency tiers |
| J-25 | "Add to queue" CTA checks `tier_monthly_posts_cap` · blocks + toasts when at cap |
| J-26 | Bulk-scheduling toolbar honours `tier.bulk_scheduling_cap` (Pro=25 · Agency=∞) |
| J-27 | Failed-queue retry button shows retry depth `(2 of 3)` per row · Agency surfaces "manual retry batch" affordance |
| J-28 | Drip-strategy presets (per-account staggering) gated to Agency tier |

#### Deferred to Phase 7+ (commercial / multi-tenant work)
- `Brand` + `Campaign` tables persisted server-side
- `Campaign.account_template` UI editor
- Backend monthly-post-cap enforcement (server-side · cron + DB)
- Multi-brand workspace switcher
- Founder-tier billing flow
- Ayrshare Enterprise contract negotiation
- Per-campaign analytics rollup + CSV export
- Posting-history view tied to tier retention (30 / 90 / 365 days)

### 12.7 Risk ledger (UI + gating specific)

| Risk | Likelihood | Mitigation |
|---|---|---|
| 11 states render inconsistently across 5 surfaces | HIGH if each surface re-implements | Single `<AccountChipState>` component (I-18) is the only place state→visual mapping lives |
| Tier caps drift between client and server | MED | `useTierCaps()` hook is the only source · backend mirrors via the existing `_MAX_CHANNELS_BY_TIER` + new monthly-post mirror |
| Locked tiles look broken vs intentional | MED | Lock glyph + pink upgrade CTA is the canonical "locked but actionable" pattern · keep distinct from `account-expired` (key glyph) |
| Bulk actions exceed Ayrshare rate limits | MED at Agency scale | Bulk-scheduling cap (Pro=25 · Agency surfaces a warning above 100) · backend enforces rate-limit-aware fan-out |
| "Add account" popover/drawer divergence | LOW · same internal component | One component · two mount affordances · single state |
| Campaign-locked accounts confuse the user | MED | Stamp the chip with campaign glyph + "Locked by [Campaign Name]" tooltip · always navigable to the Campaigns view |
| Plan-limit upgrade flow lands on wrong tier suggestion | LOW | Single source: `useTierCaps().nextTierFor("add_account")` returns the smallest tier that unlocks the feature |
| Brand badge on every tile clutters Clipper tier UI | MED | Hide brand badge entirely until tier ≥ Agency · brand_id stays in data layer but UI surfaces it conditionally |

### 12.8 Summary

The publishing UI surfaces (ClipCard · ExportPanel · Schedule · Channels · Campaigns) all consume **the same eleven-state account chip** (§12.3) and **the same `useTierCaps()` hook** (§12.4). "Add account" is **one component with two mount affordances** (popover + drawer · §12.2). The gating model is **enforced at six checkpoints** (§12.4 enforcement table) reading from one runtime source so backend and client never drift.

The data model in §11.4 already supports every UI state and every gate — no new tables are required by §12. Phase 6H–6J gain 18 additional bricks across the three routes (H+4 · I+6 · J+6 · §12.6) totalling **~9 extra hours of focused work** on top of the original Phase 6H–6J estimates. All commercial / multi-tenant work (Brand entity · server-side cap enforcement · campaign templates) **defers to Phase 7+**.

The example **Brand A · 10 campaigns · 10 clips · 5 accounts · 500 jobs** is the **Agency-tier target** spec: stays within the 15-channel hard cap, fits in the 2,500-posts-per-month Agency allowance, and uses the per-campaign account-template UI to keep manual targeting overhead bounded.

---

## 13 · What comes next

**Stop after this audit per the directive.**

Phase 6H is the next build phase. Recommended first commit: **H-1 · Add `"export"` to `EngineStage` + `EngineCompletionKind` unions in `bridge/events.ts`** — tiny, reversible, foundational. From there the build sequences in the order above with one brick per step, mirroring the Phase 6C/6D/6F cadence.

No code changes will be made until Daniel says go.
