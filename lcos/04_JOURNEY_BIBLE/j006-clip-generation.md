# journey.j006-clip-generation · URL ingest + post-ingest stage chain

## Purpose

A signed-in customer either pastes a supported URL into the
UploadPortal (YouTube · TikTok · Instagram · X · Facebook · Vimeo ·
Reddit) OR completes j005-upload with a local file. Either way, the
pipeline is expected to walk the `POST_INGEST_STAGES` chain — `audio`
→ `transcribe` (Whisper) → `llm` (Anthropic clip judgment) → `cut`
(ffmpeg segment) → `reframe` (face-aware crop) → `thumbs` (thumbnail
generation) — and produce ≥1 real MP4 clip file on disk that the
customer can review, edit, and export from the Workstation grid
(`session.project.clips`).

j006 is the M2 (Revenue) production step. A "successful" clip run
that returns zero clips is a FAILURE state — the auto-alert
`paid_provider_zero_clips` fires for any run that spent money and
returned zero clips.

## Owning capability

`capability.clipping-engine.pipeline`

## Mission fingerprint

`[M2]`

- **M2 (Revenue):** every completed clip is a paid render; every
  zero-clip run is money spent for nothing.

## Prerequisites

- User is authenticated (`hasJwt === true`).
- `CreateClipsRoute` is mounted OR the source `bus.emit("source:drop", …)`
  fires from any surface that owns the drop.
- Sidecar reachable (`isSidecarUnavailable(e) === false`).
- `OPENAI_API_KEY` present for local BYO users OR hosted judgment
  routed through `POST /proxy/llm` (Pro+ tier gate — see
  `junior-backend/CLAUDE.md`).

## Entry conditions

- `hasJwt`
- One of:
  - URL pasted into `UploadPortal` → `submitUrl()` calls
    `onPasteUrl(trimmed)` → CreateClips calls
    `sidecar.ingestUrl(url, undefined, undefined, undefined, runId)`.
  - File dropped → j005 completes → CreateClips calls
    `sidecar.startRun(path, …, runId)`.

## Exit conditions (success)

- Every stage in `POST_INGEST_STAGES` returns without throwing.
- Each stage emits `engine:complete { kind: "bake", slug, project }`
  as it lands.
- Final stage emits `engine:complete { kind: "pick", slug }`.
- `project.clips` contains ≥1 clip with a real `cut_path` OR
  `vertical_path` that resolves via `@tauri-apps/plugin-fs::exists`.
- `clips_written {slug, clip_count, first_clip_cut_path, first_clip_vertical_path, first_clip_slug}`
  fires exactly once per bake.
- `fresh_clipping_engine_proven` fires ONLY when a bake yields a real
  MP4 path on disk (looks-real + `fs.exists` confirms).
- Sidecar posts `POST /telemetry/clip_run` with
  `status="success"`, `clips_generated>=1`, and a full `stages`
  timeline — persisted in the `clip_runs` table.

## Exit conditions (drift)

- Any stage throws → `engine:error {kind:"bake", error}` bubbles ·
  `BakeErrorStrip` renders the customer-safe message · `stage_success`
  never fires for that stage.
- Final `project.clips.length === 0` → Workstation renders
  `ws-zero-candidates` state ("Run finished · zero clips") · no
  `fresh_clipping_engine_proven` · sidecar posts
  `clip_run` with `clips_generated=0` — auto-alert
  `paid_provider_zero_clips` fires if `cost_usd_cents > 0`.

## Stations (ordered)

### station.clip-generation.url-input-accepted

- **Responsible system:** `feature.upload-portal-url-submit`.
- **Source code node:** `UploadPortal.tsx::submitUrl()`.
- **Expected input:** a `trim()` URL that passes
  `isSupportedPortalUrl()` (YouTube · TikTok · Instagram · X ·
  Facebook · Vimeo · Reddit host allowlist per IG-001).
- **Expected customer-visible state:** portal closes, session flips
  to `phase: "running"` via `startPersistedSession(url, { url })`.
- **Success signal:** `onPasteUrl(trimmed)` fires; CreateClips's
  `onPasteUrl` prop calls `sidecar.ingestUrl(url, …, runId)`.
- **Failure outcome:** host not allowlisted → inline error
  "That link isn't supported yet. Paste from YouTube, TikTok,
  Instagram, X, Facebook, Vimeo, or Reddit."
- **Regression test:** `desktop-2/src/design-os/engine/UploadPortal.test`
  (existing suites cover the URL-accept path).

### station.clip-generation.sidecar-ingest-fired

- **Responsible system:** `feature.sidecar-ingest-url`.
- **Source code node:**
  - Frontend: `desktop-2/src/design-os/engine/sidecar-stub.ts::sidecar.ingestUrl`.
  - Sidecar: `desktop/python-sidecar/sidecar.py::method_ingest_url`.
- **Expected event ordering:**
  1. `sidecar.ingestUrl` invokes `sidecarCall("ingest_url", { url, run_id, … })`.
  2. Sidecar spawns `yt-dlp` to download best-mp4 into
     `~/LiquidClips/inbox/`.
  3. Sidecar returns `{ project: { slug, source_path, … } }`.
- **Success signal:** returned `project.slug` is a non-empty string.
- **Failure outcome:** yt-dlp fails / cancel marker raised /
  network error → sidecar throws → `engine:error {kind:"ingest"}`
  bubbles from the `.catch` in CreateClips.
- **Telemetry proof:** `ingest_started` → `ingest_success` on the
  frontend; `clip_run.stages[].stage==="ingest"` on the backend.

### station.clip-generation.transcribe-whisper

- **Responsible system:** `feature.local-whisper`.
- **Source code node:**
  - Sidecar dispatch: `sidecar.py::runStage(slug, "transcribe")`.
  - Whisper backend: `desktop/python-sidecar/whisper_backend.py::transcribe_auto`.
- **Expected input:** audio file extracted from the ingested video
  (previous stage `audio`).
- **Expected customer-visible state:** StageRail advances to
  `transcribe` — % complete updates from `stage_progress` events.
- **Success signal:** `transcribe_auto` returns
  `(segments, text_parts, info, engine_name)`. `engine_name` is
  `"mlx-whisper"` (Apple Silicon fast path) OR `"faster-whisper"`
  (fallback).
- **Failure outcome:** MLX fails and faster-whisper fails to load
  → `engine:error {kind:"bake"}`.
- **Telemetry proof:** `stage_started {stage:"transcribe"}` →
  `stage_success {kind:"bake", clip_count: null}` on frontend;
  `clip_run.stages[].stage==="transcribe"` with `provider` /
  `model` / `duration_ms` on backend.
- **Regression test:**
  `desktop-2/src/routes/upload/upload.journey.test.ts` skips the
  real-Whisper leg with a STOP marker; the backend end-to-end test
  at `junior-backend/tests/test_clip_run_endtoend.py` proves the
  ingest → clip_run receipt round-trip using ffmpeg-generated
  fixture assets and mocked Whisper output.

### station.clip-generation.llm-anthropic-judgment

- **Responsible system:** `feature.clip-judge-anthropic`.
- **Source code node:**
  - Sidecar dispatch: `sidecar.py::runStage(slug, "llm")`.
  - LLM wrapper: `desktop/python-sidecar/llm.py`.
  - Backend proxy (Pro+): `junior-backend/app/routes/proxy_anthropic.py`.
- **Expected input:** transcript segments from the previous stage.
- **Expected event ordering:**
  1. Sidecar (or backend proxy) posts to
     `POST https://api.anthropic.com/v1/messages`.
  2. Response yields a JSON list of `{ title, start_s, end_s, score }`
     candidate clips.
- **Success signal:** ≥1 candidate returned. `clip_run.clip_judge_provider`
  starts with `"anthropic"` or `"hosted_anthropic"`.
- **Failure outcome:** API 429 / 500 / timeout → sidecar throws →
  `engine:error`. Auto-alert `openai_called_unexpectedly` fires if
  the provider on the `clip_run` starts with `"openai"` in prod.
- **Telemetry proof:** `stage_started {stage:"llm"}` →
  `stage_success` on frontend; `clip_run.stages[].provider==="anthropic"`
  + `input_tokens` + `output_tokens` + `cost_usd_cents` on backend.

### station.clip-generation.cut-ffmpeg

- **Responsible system:** `feature.ffmpeg-cut`.
- **Source code node:**
  - Sidecar dispatch: `sidecar.py::runStage(slug, "cut")`.
  - ffmpeg invocation: bundled at `desktop/python-sidecar/bin/ffmpeg`.
- **Expected input:** LLM candidates + source video.
- **Expected customer-visible state:** StageRail shows `cut` stage
  advancing.
- **Success signal:** For every LLM candidate, ffmpeg produces a
  real MP4 file on disk with `ffprobe`-verifiable duration ~= end - start.
- **Failure outcome:** ffmpeg missing / permissions / codec unsupported
  → sidecar throws · `engine:error`.
- **Regression test:**
  `junior-backend/tests/test_clip_run_endtoend.py::test_ffmpeg_produces_real_mp4_from_fixture`
  — spawns ffmpeg directly against
  `desktop-2/tests/fixtures/short-video.mp4`, verifies the cut MP4
  has valid duration + file size > 0.

### station.clip-generation.reframe-thumbs

- **Responsible system:** `feature.reframe-thumbs`.
- **Source code node:** sidecar `runStage(slug, "reframe" | "thumbs")`.
- **Expected input:** cut MP4s from previous stage.
- **Success signal:** every clip has a `vertical_path` populated
  after `reframe`; a thumb path after `thumbs`.
- **Failure outcome:** reframe fails → clip enters
  `unreframable_cut_only` state; still counts as a real clip for
  `clips_generated`. `thumbs` failure is non-fatal.

### station.clip-generation.workstation-render

- **Responsible system:** `feature.workstation-grid`.
- **Source code node:** `desktop-2/src/design-os/routes/Workstation.tsx`.
- **Expected input:** `session.project.clips.length >= 1`.
- **Expected customer-visible state:** ClipCard grid renders one
  card per clip · empty / running / complete / zero-candidates /
  error states each have a distinct DOM seam
  (`ws-empty` · `ws-zero-candidates` · `ws-split-workbench`).
- **Success signal:** `chromeClipCount` matches the number of clips
  with `vertical_path` populated.
- **Failure outcome:** empty → `ws-empty` renders; zero after run
  → `ws-zero-candidates` renders with the honest "Drop a new source"
  CTA.
- **Regression test:**
  `desktop-2/src/routes/my-clips/my-clips.journey.test.ts::renders-3-seeded-clips-with-affordances`.

### station.clip-generation.clip-run-receipt

- **Responsible system:** `feature.telemetry-clip-run`.
- **Source code node:** `junior-backend/app/routes/clip_runs.py::ingest_clip_run`.
- **Expected input:** `POST /telemetry/clip_run` with `run_id` +
  full stage timeline + `clips_generated`.
- **Success signal:** row persists in `clip_runs`, HQ Clip Runs tab
  can read it via `GET /admin/clip-runs`.
- **Failure outcome:** POST fails (401 · 500) → row missing → HQ
  invisible to this run. Auto-alert firing is best-effort so it
  never blocks the ingest.
- **Regression test:**
  `junior-backend/tests/test_clip_run_endtoend.py::test_clip_run_receipt_persisted_and_readable`.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `stage_started` | CreateClips `useEvent("engine:progress")` | `{stage, percent, slug}` | stdout-only |
| `stage_success` | CreateClips `useEvent("engine:complete")` | `{kind, slug, clip_count}` | stdout-only |
| `clips_written` | CreateClips (on complete with clips>0) | `{slug, clip_count, first_clip_cut_path, first_clip_vertical_path, first_clip_slug}` | stdout-only |
| `fresh_clipping_engine_proven` | CreateClips (after `fs.exists` check) | `{slug, clip_count, first_clip_cut_path, first_clip_vertical_path, cut_exists, vertical_exists, via}` | stdout-only |
| `ingest_failed` | CreateClips `useEvent("engine:error")` | `{kind, error}` | stdout-only |
| `POST /telemetry/clip_run` | sidecar (end-of-run receipt) | ClipRunIngest envelope | **persisted** in `clip_runs` |

## Acceptance test IDs

- `desktop-2/src/routes/upload/upload.journey.test.ts`
  - `drop-zone-visible`
  - `preflight-rejection-ui`
  - `preflight-ok-state`
  - `upload-progress-ui-states`
- `desktop-2/src/routes/my-clips/my-clips.journey.test.ts`
  - `renders-3-seeded-clips-with-affordances`
- `junior-backend/tests/test_clip_run_endtoend.py`
  - `test_ffmpeg_produces_real_mp4_from_fixture`
  - `test_clip_run_receipt_persisted_and_readable`
  - `test_clip_run_zero_clips_is_failure_state`
  - `test_anthropic_boundary_shape_matches_contract` (mocked at
    outermost HTTP boundary)

## Current status

AMBER

- Frontend seams + telemetry + `clip_run` receipt path proven.
- Real Whisper invocation deferred to a runtime-only proof — no
  bundled `faster-whisper` model in the CI test env; the sidecar's
  whisper_backend requires a downloaded model on first use.
- Real Anthropic invocation mocked at the HTTP boundary in tests
  (no API key in test env by design).
- Real ffmpeg invocation PROVEN — the backend end-to-end test
  spawns ffmpeg against the checked-in fixture and asserts the
  output MP4 is real on disk.
- Live-walk gap documented as `gap:j006-real-whisper-runtime-proof`
  in the Impact Report — closes when Daniel walks the RC1 install
  with a real long-form video and posts the receipt.

## Last verified

`2026-07-12 · <commit-sha> · Train C3 dispatch`

## Known bugs blocking

- BC-004 (unowned journey) · closed with this commit for j006.
- BC-005 (state observability) · progress noted; end-of-run
  receipt now persists.
- BUG-023 (sidecar per-clip heartbeat gap during ffmpeg encodes)
  · orthogonal, referenced by Workstation's client-side elapsed
  ticker (`stillWorking`).

## Recovery / degrade path

- LLM 429 / 5xx → sidecar retries N times then throws; `engine:error`
  bubbles; the run posts a `clip_run` with
  `status="failed" · failure_layer="provider"`.
- ffmpeg missing → sidecar's `check_deps` preflight catches this at
  boot; the surface shows a diagnostic banner rather than starting
  the run.
- Zero candidates from LLM → `ws-zero-candidates` state, honest CTA.
- Sidecar dies mid-run → `clip_run` row lands with a partial
  timeline · `status="running"` · Doctor / HQ Alerts flags the
  orphan.

## HQ dashboard

- Clip Runs tab (Admin HQ) reads `GET /admin/clip-runs` · one row
  per run · full stage timeline + provider + cost.
- Auto-alerts fire on: `clip_run_failed`, `paid_provider_zero_clips`,
  `openai_called_unexpectedly`, `fixture_project_detected`,
  `sidecar_unavailable`, `keychain_touched_in_hosted_mode`.
- Journey Map tab surfaces j006 status.

## Notes

- The URL-paste path shares the post-ingest chain with the
  local-file path (j005) — both call `drivePostIngestStages(slug)`
  in `CreateClips.tsx`. The stages themselves are identical.
- Anthropic is the prod default (`hosted_anthropic`). Auto-alert
  `openai_called_unexpectedly` fires the moment a `clip_run` lands
  with `clip_judge_provider` starting with `"openai"`.
- `session.project.clips` is the frontend-authoritative clip list.
  My Clips (Workstation surface, j007) reads from this same source
  of truth; there is NO backend `GET /me/clips` endpoint today
  (documented in j007).
