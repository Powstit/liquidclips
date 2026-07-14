# j006 · Clip Generation · Native Walk Prep

**Journey ID:** `j006-clip-generation`
**Capability:** `capability.content-production`
**Simulatable:** `partial` — URL ingest submission + polling UI + the "no clips yet" result state are simulatable; the actual Whisper transcription + Anthropic judgment + ffmpeg cut are native-only (Python sidecar + real model files + real API keys).
**Beta gate item satisfied:** *Real upload → clips proven (clip leg)* + *Whisper actually runs* + *Anthropic judgment produces titles + timestamps* + *ffmpeg output creates real MP4 files*.

---

## Purpose

Prove that after a file (or URL) reaches the sidecar via j005, the pipeline actually runs:

1. Whisper transcription (local model) produces a transcript.
2. Anthropic judgment (real API) produces per-segment titles + start/end timestamps.
3. ffmpeg cuts real MP4 files on disk with valid duration and codec.
4. My Clips UI reveals the finished clips with reveal / open / copy affordances.

The automated slice covers the submission + polling + result-shape UI. The manual slice attests that the media on disk is real.

---

## Prerequisites

### Credentials

- `INTERNAL_API_SECRET` — mint fresh JWT.
- `ANTHROPIC_API_KEY` — from `~/.claude-credentials/` (`anthropic-admin.env`). Real key required for the beta receipt; walk cannot use a stub because "Anthropic judgment produces real titles" is the acceptance criterion.
- Optional: `OPENAI_API_KEY` if the pipeline uses hosted Whisper as a fallback (per `junior_hosted_compute.md`). Default RC1 build uses local Whisper only.

### Test accounts

- Fresh Liquid Clips user, Base or Agency tier (Base has a 10-clip quota; walk uses one).

### Env + processes

- Backend + sidecar both running (either through the installed shell or `junior-backend` + `python -m junior_sidecar` locally).
- Whisper model file present on disk. Verify:
  ```bash
  ls -lh ~/Library/Application\ Support/Liquid\ Clips/models/*.bin
  # or wherever the shell caches it per the sidecar config
  ```
- ffmpeg on `$PATH` (Tauri sidecar bundles it in the release build; verify locally with `which ffmpeg`).

### Test files

- Upstream from j005: `desktop-2/tests/fixtures/walk-video-tiny.mp4` (3s, 720p) OR
- A public YouTube URL for the URL-ingest path. Walk records the URL used so the transcript can be diffed against known content. Suggested: a 30-60s public commencement/speech clip · avoid copyrighted music tracks.

### State

- SQLite reset.
- `~/Library/Application Support/Liquid Clips/media/` cleared (removes cached clip outputs from prior walks).

---

## Step-by-step walk

### Step 1 · Seed + upload (dependencies)

Run j005 walk first · or seed via `scripts/rc1-beta/seed-fresh-user.sh` + trigger `POST /ingest/start` directly with a known fixture path.

**Automated?** Yes (harness reuse).

### Step 2 · URL ingest submission (automated)

Alternative entry: user pastes a URL into the URL ingest input on CreateClips.

Assert:
- URL input visible.
- On submit, `POST /ingest/start` fired with `{source: "url", url: "..."}`.
- Backend returns `{run_id: "run_..."}`.
- UI transitions from empty → "downloading" or "ingesting" state.

Capture: screenshot pre-submit, screenshot post-submit, backend log tail.

**Automated?** Yes for the submission + response. The download of the real URL is sidecar work.

### Step 3 · Polling UI progresses (automated)

Frontend polls `GET /ingest/state/<run_id>` on 1-2s cadence. State machine expected:
```
ingesting → transcribing → judging → cutting → complete
                                             → error (branch)
```

Assert:
- At each poll, `[data-ingest-state]` reflects the backend state.
- Between states, no premature "success" copy renders.
- If state stays in one bucket > 90s, walk records a stall warning (not a failure) and continues polling for another 180s. RC1 beta target: total pipeline ≤ 120s for a 3-second clip.

Capture: screenshot per state transition, canonical-state, telemetry (`clip_run_state_changed` topic per transition · if wired).

**Automated?** Yes for the polling. Sidecar's actual work runs in native · out of C1 scope but the polling loop verifies its output.

### Step 4 · Whisper ran · proof on disk (MANUAL / semi-automated)

After `state=transcribing` → `state=judging`, a transcript file exists:
```
~/Library/Application Support/Liquid Clips/runs/<run_id>/transcript.json
```

Manual verification:
```bash
cat "~/Library/Application Support/Liquid Clips/runs/<run_id>/transcript.json" | jq '.segments | length'
```

Assert:
- File exists (non-zero size).
- JSON has ≥1 segment with `text` + `start` + `end` fields.
- Text is not gibberish (manual read against the source video's known content).

**Automated?** Semi — Playwright can `fs.readFile` the transcript path and assert its shape. The "text matches source" claim requires manual audit but that is a one-time RC1 receipt, not a per-walk gate.

Capture: transcript.json copy in the capture bundle.

### Step 5 · Anthropic judgment ran · titles + timestamps (semi-automated)

After `state=judging` → `state=cutting`, backend returns judged segments via `GET /clip-run/<run_id>/segments` or equivalent. Each segment has `{title, start_s, end_s, confidence}`.

Assert:
- ≥1 segment returned.
- `title` is a real title (>3 chars, not "Untitled").
- `start_s < end_s`, both in `[0, video_duration]`.
- No two segments have byte-identical titles (uniqueness · Anthropic didn't return a template).

**Automated?** Yes for the shape assertions; the "titles are actually good" claim needs human review (one-time RC1 receipt).

Capture: segments JSON in capture bundle.

### Step 6 · ffmpeg produced real MP4 files (automated + manual)

After `state=complete`, clip files exist on disk:
```
~/Library/Application Support/Liquid Clips/runs/<run_id>/clips/<n>.mp4
```

Assert (automated):
- ≥1 file exists.
- Each file size > 10KB (a real MP4, not a zero-byte placeholder).
- `ffprobe <file>` returns a valid `duration` field.
- Duration matches `end_s - start_s` from the judgment segment (± 0.5s tolerance for ffmpeg keyframe alignment).

Assert (manual):
- Open one file in QuickTime · confirm it plays.

**Automated?** Yes for the file existence + ffprobe. The playback test is a one-time RC1 receipt.

Capture: `ls -la` of the clip dir, ffprobe output, one clip file copied to `capture/j006-clip-generation/06-clips-on-disk/`.

### Step 7 · My Clips UI shows the real clips (automated)

Navigate to `#/library` or wherever My Clips route lives (C3 owns the exact path).

Assert:
- Grid shows ≥1 clip tile.
- Tile has: thumbnail (poster · not fake), title (matches Anthropic output), duration, "Open" / "Reveal in Finder" / "Copy path" affordances.
- No "Sample Clip" or fixture data.
- Tile's title byte-identical to the segment title from step 5.

**Automated?** Yes.

Capture: screenshot of grid, canonical-state.

### Step 8 · Reveal in Finder / Open affordance (MANUAL)

Click "Reveal in Finder" on one tile. Finder opens and highlights the file.

Assert (manual):
- Finder actually opens (Tauri `plugin-shell::open` on the parent directory).
- File is highlighted / selected.

**Automated?** NO — Finder open is native. `test.skip` in the spec.

Capture: screen recording.

---

## Expected capture artifacts per step

| Step | screenshot | canonical-state | telemetry | backend.log | FS artifact |
|---|---|---|---|---|---|
| 1 seed | — | — | — | ✅ | — |
| 2 URL submit | ✅ | ✅ | ✅ | ✅ | — |
| 3 polling | ✅ ×N | ✅ ×N | ✅ | ✅ | — |
| 4 whisper | — | — | ✅ | ✅ | ✅ transcript.json |
| 5 judgment | — | ✅ | ✅ | ✅ | ✅ segments.json |
| 6 ffmpeg | — | — | ✅ | ✅ | ✅ clip.mp4 + ffprobe.txt |
| 7 my clips grid | ✅ | ✅ | ✅ | — | — |
| 8 reveal (MANUAL) | ✅ (recording) | — | — | — | — |

All artifacts land under `lcos/reports/golden-path/capture/j006-clip-generation/<NN-step>/`.

---

## Pass / fail criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| P1 | URL ingest submission accepted with `run_id` | ✅ if `POST /ingest/start` returns 201 with `run_id` | ❌ 4xx / 5xx / missing run_id |
| P2 | Polling state machine advances · no frozen state > 180s | ✅ if state changes observed | ❌ frozen state = stall |
| P3 | Transcript file exists + has ≥1 segment | ✅ | ❌ missing file or empty segments = Whisper never ran |
| P4 | Anthropic segments returned with real titles + valid ranges | ✅ if ≥1 segment with title.length>3 + valid timestamps | ❌ empty / template-only / invalid ranges |
| P5 | ffmpeg produced ≥1 clip.mp4 file · ffprobe reports valid duration | ✅ | ❌ zero files or ffprobe error = ffmpeg cut broken |
| P6 | Clip duration matches segment.end_s − segment.start_s ± 0.5s | ✅ | ❌ significant divergence = wrong cut points |
| P7 | My Clips tile title byte-identical to segment title | ✅ | ❌ divergence = BC-005 (UI reading divergent store) |
| P8 | Zero fixture / sample data in the grid | ✅ | ❌ any "sample clip" tile = fake completion |
| P9 | Reveal in Finder actually opens (MANUAL) | ✅ | ❌ silent fail = broken affordance |

Overall pass = P1 through P8 all pass. P9 is the manual receipt.

---

## Known gaps · what cannot be automated

1. **Sidecar's actual Whisper run.** Model file, GPU / CPU acceleration, memory pressure — none simulatable from Playwright. Walk observes outputs only.
2. **Anthropic API round-trip.** Real key + real network call. Cost per walk ≈ $0.01. If key absent, `test.skip("no ANTHROPIC_API_KEY")` and manual walk required.
3. **ffmpeg keyframe alignment quirks.** Cut points can drift by 100-500ms from the requested timestamp. Walk uses ±0.5s tolerance; a wider tolerance would hide real bugs.
4. **Reveal in Finder.** Native `plugin-shell::open`. Manual step.
5. **Sidecar lifecycle.** If the sidecar isn't running, backend polling returns `state=pending` indefinitely. Walk's 180s stall guard catches this but attribution is "sidecar not running" vs "sidecar running but stuck." Add a `/sidecar/healthcheck` probe if not already present · C3 concern.
6. **BUG-012 · runtime staleness.** Same as j005 · run after quit+relaunch.
7. **BC-002 · title source of truth.** Segment title lives in backend `clip_segments` table; My Clips reads it via `/me/clips`. If a title changes mid-walk (e.g. Anthropic returns a different result on a retry), the UI must read from the canonical store · not cache.

---

## Beta gate impact

Satisfies (with j005):
- ✅ *Real upload → clips proven* — end-to-end proven.
- ✅ *Whisper actually runs* — proven by P3.
- ✅ *Anthropic judgment produces titles + timestamps* — proven by P4.
- ✅ *ffmpeg output creates real MP4 files* — proven by P5.
- ✅ *My Clips shows the real clip* — proven by P7.

Does NOT satisfy:
- ⏭ *Publish to social* — see `j007-publish.md`.
- ⏭ *Campaign submit uses real ID* — C3's `campaign-submit.real-id.test.ts`.

---

## Rollback / reversal

1. `scripts/rc1-beta/reset-test-env.sh` wipes SQLite.
2. Clear the runs directory: `rm -rf ~/Library/Application\ Support/Liquid\ Clips/runs/`.
3. Kill sidecar: `pkill -f junior_sidecar`.
4. Anthropic API charges are not reversible · walk records cost per run so the RC1 receipt can budget the beta cohort.

---

## Cross-references

- Sidecar: legacy `desktop/junior_sidecar/` (READ-ONLY · shell freeze).
- Backend: `junior-backend/app/routes/ingest.py`, `clip_run.py` (READ-ONLY for C1 · C3 owns edits).
- Frontend polling: `desktop-2/src/design-os/engine/sidecar-stub.ts` (READ-ONLY).
- My Clips UI: TBD by C3 · likely `desktop-2/src/design-os/routes/Library.tsx`.
- Related bugs: BUG-005 (notifications badge · unrelated) · BUG-012 (relaunch requirement · relevant to pre-walk state).
- Depends-on: j005 (upload), j001 (JWT).
- Enables: j007 (publish).
