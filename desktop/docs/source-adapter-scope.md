# Source Adapter Contract (the "create a clip" boundary)

Where a clip comes from is the user's problem. What happens after is everyone's.
This doc scopes the boundary so adding new sources (Instagram, TikTok,
screen-record, clipboard MP4, etc.) does not require rewriting the engine.

Becomes **IG-007 (Source adapter contract)** on ship.

## The two-stage architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  SOURCE ADAPTER (per-platform)                                 │
│  ─ produces a normalized MP4 at ~/LiquidClips/inbox/<slug>.mp4 │
│  ─ optionally writes <slug>.meta.json with origin metadata     │
│  ─ calls start_run(source_path, brief, intent, bounty)         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ source_path: str (absolute, .mp4)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  ENGINE — `start_run` → `_run_stage` pipeline (LOCKED)          │
│  1. ingest (cover frame, duration, fingerprint)                │
│  2. transcribe (faster-whisper, srt + vtt)                     │
│  3. llm-pick (OpenAI clip selection, virality scoring)         │
│  4. cut (ffmpeg per-clip extraction)                           │
│  5. reframe (face-aware vertical/square/portrait crops)        │
│  6. thumbnails (cover-frame pack per ratio)                    │
│                                                                │
│  OUTPUT: Project { clips[], slug, brief, intent, bounty? }     │
└─────────────────────────────────────────────────────────────────┘
```

## The contract (every source adapter satisfies this)

1. **Produce a single MP4** at `~/LiquidClips/inbox/<slug>.mp4`.
   - Must be H.264 + AAC (re-encode if needed; yt-dlp's `best[ext=mp4]` works).
   - Must be ≤ 4 GB and ≤ 4 hours.
   - Filename slug is your call but lowercase + ASCII; the engine reads + sanitises.

2. **Optionally write origin metadata** at `~/LiquidClips/inbox/<slug>.meta.json`:
   ```json
   {
     "source": "youtube" | "instagram" | "tiktok" | "x" | "twitch" | "import" | "record" | "clipboard" | "<your-source>",
     "url": "https://…",
     "title": "Original video title",
     "uploader": "@channel-handle",
     "duration_seconds": 1234.5,
     "captured_at": "2026-06-08T15:30:00Z",
     "thumbnail_hint": "/abs/path/to/poster.jpg"
   }
   ```
   The engine reads this in stage 1 (ingest), preserves it on `project.source_meta`, surfaces it on the workstation header + ClipPreview.

3. **Call `start_run`** with the absolute `source_path`:
   ```py
   _run_stage_via_method_start_run({
     "source_path": "/abs/path/to/inbox/slug.mp4",
     "brief": <optional user brief>,
     "intent": "clips" | "youtube" | "both",
     "bounty": <optional Whop bounty dict>,
   })
   ```
   The engine creates the Project, claims the MP4 (moves it to `~/LiquidClips/<slug>/source.mp4`), and starts the pipeline.

4. **Don't write Project files yourself.** The engine owns project.json and the directory layout. Adapters write only into `inbox/`.

5. **Stream progress out of band.** Adapters that take time (download, recording, re-encode) emit progress on the `lc:ingest_progress` event so the import tile + onboarding overlay can show "downloading… 42%". Don't pollute stdout (that's the JSON-RPC channel).

## What stays (the engine — locked)

| Layer | Files | Don't touch without an explicit user override |
|---|---|---|
| Project lifecycle | `python-sidecar/project.py` (Project.create, claim_inbox, save) | the `~/LiquidClips/<slug>/` layout, project.json shape |
| Stage runner | `python-sidecar/sidecar.py:_run_stage` | the 6-stage list, the order, the stage names |
| Transcribe | `python-sidecar/transcribe.py` (faster-whisper) | the SRT/VTT writer paths, tiny model selection |
| LLM pick | `python-sidecar/llm_pick.py` (OpenAI) | the clip-selection schema, virality fields |
| Cut | `python-sidecar/cut.py` (ffmpeg) | the cut_path naming, copy-codec preference |
| Reframe | `python-sidecar/reframe.py` (OpenCV face crop) | the vertical/square/portrait outputs |
| Thumbnails | `python-sidecar/thumbnails.py` | the rank-ordered thumbnail pack |

## What shared helpers exist

- **`Project.claim_inbox(source_path)`** — moves the MP4 from `inbox/` into the project's own dir.
- **`humanError(e)`** (TS) and `humanize_error(e)` (Py) — every adapter MUST run errors through this. Raw `String(e)` leaks.
- **`useImportProgress` hook** (TS) — UI side; renders the "downloading 42%" pill from the `lc:ingest_progress` event.

## Sources today

| Adapter | RPC | UI entry | Status |
|---|---|---|---|
| YouTube URL | `ingest_url` | Workstation Home → Create tile (paste URL) | LIVE |
| Drop/Pick MP4 | direct `start_run` from drag-drop | UnifiedDropZone | LIVE |
| Ready-clips MP4 batch | `import_ready_clips` (BYPASSES engine; clips are pre-cut) | Workstation Home → Import tile | LIVE, IG-001 |
| Transcript-only | `lift_transcript` (BYPASSES engine; no cut/reframe) | Workstation Home → Script tile | LIVE |

## Sources we can add cheaply

Each row maps to ~1–3 days of work because the engine doesn't move.

| Source | Adapter strategy | Notes |
|---|---|---|
| **Instagram URL** | yt-dlp with cookies (logged-in sessions) → mp4 → `start_run` | IG gates non-logged-in. Cookies via Selenium or user-imported cookie file. |
| **TikTok URL** | yt-dlp (works without auth) → mp4 → `start_run` | Watermarked vs non — yt-dlp `--no-watermark` flag. |
| **X / Twitter video URL** | yt-dlp → mp4 → `start_run` | Works today via yt-dlp; just a new `ingest_url` alias with platform tag. |
| **Twitch VOD URL** | yt-dlp → mp4 → `start_run` | Long sources; chunk transcribe automatically (engine already handles ≤ 4h). |
| **Screen recording** | macOS `screencapture -v` → ~/LiquidClips/inbox/ → `start_run` | New RPC `start_recording` / `stop_recording`. Output is a clean .mp4. |
| **Clipboard MP4** | Cmd+V trigger → read clipboard binary → write to inbox → `start_run` | New TS clipboard listener; needs Tauri clipboard plugin. |
| **Other-app clip export** | future "Liquid Clips for X" plugin writes to inbox + dispatches event | Lowest-effort path for ecosystem integrations. |

## Add-a-source recipe (for future agents)

1. Create `python-sidecar/adapters/<source>.py` with a `class <Source>Adapter` exposing `fetch(url_or_input, slug_hint) -> Path`.
2. Add an RPC method in `sidecar.py`: `method_ingest_<source>` that:
   - Calls the adapter to produce a `~/LiquidClips/inbox/<slug>.mp4`
   - Optionally writes `<slug>.meta.json`
   - Returns `method_start_run({"source_path": ..., "brief": ..., "intent": ..., "bounty": ...})`
3. Add the TS RPC wrapper in `src/lib/sidecar.ts` with the matching params type.
4. Add a UI entry: either expand the Workstation Home tiles or extend UnifiedDropZone's URL-pattern matcher.
5. Add the source to this doc's "Sources today" table.
6. Add tests against a known-good test URL.

The engine never knows the source happened. That's the point.

## Failure modes the contract prevents

| Bug | Why it can't happen with the contract |
|---|---|
| A new source forgets to set `intent` and the engine drops the YouTube-extras stage | `start_run` validates intent and raises before any stage runs |
| A new source writes its own project.json | Adapters never write to `<slug>/`; only `inbox/`. `Project.create` is the only writer |
| A new source produces a non-H.264 MP4 the cut stage chokes on | Contract says H.264 + AAC. yt-dlp's `best[ext=mp4]` enforces it. Future adapters re-encode if needed |
| Two sources race on the same slug | `Project.create` generates slugs; adapters use `slug_hint` and accept the engine's assignment |
| stdout pollution from yt-dlp / ffmpeg / etc. breaks JSON-RPC | Contract says stream out-of-band; adapters redirect their tool stdout to stderr |

## Iron-gate plan

On ship of the next source after v0.7.29:
- Add IG-007 (Source adapter contract) to `docs/IRON_GATES.md`
- Add sentinels at:
  - `python-sidecar/sidecar.py:method_start_run` — engine entry
  - `python-sidecar/sidecar.py:method_ingest_url` — the first adapter, references the contract
  - `python-sidecar/project.py:Project.create` — the project lifecycle owner
  - `src/lib/sidecar.ts:startRun` (the TS wrapper) — pairs with IG-002 (RPC contract)

## What is NOT a "source"

For clarity, these are NOT source adapters and should not pretend to be:

- **`import_ready_clips`** — bypasses the engine entirely; clips are pre-cut. Lives in IG-001.
- **`lift_transcript`** — transcript-only; no cut, no reframe. Useful for Script tile but not a clip-producer.
- **`apply_overlay` / `edit_captions`** — POST-clip mutations on a clip that already exists in a Project.
- **`duplicate_clip`** — copies an existing clip; no new content.
- **`set_clip_cover_frame`** (planned, IG-005) — picks a thumbnail; no new content.

These all operate on clips that already came from a source. They're not in scope for IG-007.

## Open questions to confirm

1. Should we expose `source_meta` on the workstation header (e.g. show "FROM YOUTUBE · channel: @beautyguru") or keep it metadata-only?
2. Should screen recording be a v0.8 feature (new Tauri capability + UI), or wait?
3. Should clipboard MP4 trigger require Cmd+V or a dedicated paste-target box?
