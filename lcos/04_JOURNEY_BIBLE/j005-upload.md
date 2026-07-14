# journey.j005-upload · Local file upload → sidecar ingest handoff

## Purpose

A signed-in customer opens the CreateClips route (Design-OS pipeline,
`route:"create"`), taps the UploadPortal folder button or drops a video
file onto the app shell, the file passes preflight (extension supported,
non-zero size, not a Dropbox smart-sync placeholder, readable),
`bus.emit("source:drop", { paths: [path] })` fires, and CreateClips
calls `sidecar.startRun(path, …, runId)` — leaving a `clip_run` row in
`status="queued"`/`"running"` for the downstream j006-clip-generation
journey to complete.

j005 is the entry point for the M2 (Revenue) clipping funnel — every
paying user hits this station before any Whop submission, so a silent
break here poisons the whole money loop.

## Owning capability

`capability.clipping-engine.ingest-local`

## Mission fingerprint

`[M2]`

- **M2 (Revenue):** ingest is stage 0 of the paid clipping pipeline.
  Every completed run is one paid render; a broken ingest = zero
  revenue.

## Prerequisites

- User is authenticated (`hasJwt === true`).
- `CreateClipsRoute` is mounted via Design-OS SimulatorRouter.
- Tauri shell (`__TAURI_INTERNALS__` on window) — browser preview
  cannot exercise the native picker; the pasted-URL path is the
  browser-preview equivalent (see j006).
- Sidecar process is spawned and reachable through `sidecarCall`
  (`isSidecarUnavailable(e) === false`).

## Entry conditions

- User is on the CreateClips route (Design-OS `route: "create"`).
- UploadPortal is open OR the user drags a file onto the shell.

## Exit conditions (success)

- `bus.emit("source:drop", { paths: [path] })` fires with a real,
  non-empty file path.
- CreateClipsBody's `useEvent("source:drop", …)` handler calls
  `sidecar.startRun(path, undefined, undefined, undefined, runId)`.
- `ingest_started`, `ingest_success` telemetry fire in that order.
- Session persists via `startPersistedSession(name, { url: undefined })`.
- j006-clip-generation picks up the returned `project.slug` and drives
  the post-ingest stage chain.

## Exit conditions (drift)

- File preflight fails (`preflightSourceFile` returns `{ ok: false }`)
  → inline error surfaces in the portal · `upload_preflight_failed`
  fires · no `source:drop`, no session · j005 exits gracefully to
  drift.
- `startRun` throws with `isSidecarUnavailable(e)` in browser preview
  → mock stage chain runs (documented, honest fallback).
- `startRun` throws for any other reason → `ingest_failed_startrun`
  fires · `engine:error { kind: "ingest" }` bubbles to
  `IngestErrorStrip` · UI shows a customer-safe error string.

## Stations (ordered)

### station.upload.drop-zone-visible

- **Responsible system:** `feature.upload-portal` (Design OS engine).
- **Source code node:**
  `desktop-2/src/design-os/engine/UploadPortal.tsx` — the portal card
  renders `[role="dialog"][aria-label="Upload"]` when `open === true`.
- **DOM seams:**
  - `[role="dialog"][aria-label="Upload"]` on the modal wrapper.
  - `.lc-upload-icon-btn[aria-label="Browse for a file"]` on the
    folder button.
  - `.lc-upload-input[placeholder*="YouTube"]` on the URL field.
- **Expected customer-visible state:** portal card fades in on open,
  URL field focused, folder button visible when
  `intent === "clips"`.
- **Expected event ordering:**
  - `create_screen_mounted` fires from CreateClipsBody's `useEffect`.
- **Success signal:** `useModalPortal` returns a real host element
  and the portal card mounts inside it.
- **Failure outcome:** `useModalPortal` returns null (no host) → the
  portal aborts render — no user-visible surface — no telemetry.
  This is the "modal host missing" regression.
- **Telemetry proof:** `create_screen_mounted` visible in
  `/telemetry/diagnostic` stdout stream.
- **Regression test:**
  `desktop-2/src/routes/upload/upload.journey.test.ts::drop-zone-visible`.

### station.upload.user_action_pick_file

- **Responsible system:** `feature.upload-portal-file-picker`
  (native Tauri dialog).
- **Source code node:**
  `desktop-2/src/design-os/engine/UploadPortal.tsx::browseForFile()`.
- **Expected input:** user clicks the folder button; if `__TAURI_INTERNALS__`
  is present, `@tauri-apps/plugin-dialog::open()` opens the native
  picker.
- **Expected customer-visible state:** OS file picker appears; user
  picks a `.mp4` / `.mov` / `.m4v` / `.webm`; picker closes.
- **Expected event ordering:**
  - `file_picker_selected {source, path_length, filename}` fires the
    moment `open()` returns a non-null path.
- **Success signal:** `chosen` is a string path.
- **Failure outcome:** user cancels → no error, no telemetry, no
  session persistence (deliberate — cancels are silent).
- **Telemetry proof:** `file_picker_selected` in the diagnostic ring.
- **Regression test:**
  Native picker step is **owned by Train C1** (`native-walk-prep`).
  The vitest suite `test.skip`s it with an explicit reference to
  `lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md` — the C1
  manual/Playwright walk exercises the OS dialog.

### station.upload.file_selected_ok

- **Responsible system:** `feature.upload-portal-file-selected`.
- **Source code node:** `UploadPortal.tsx::browseForFile()` — post
  `open()` return, pre `preflightSourceFile()`.
- **Expected event ordering:** none between picker return and
  preflight (fast path).
- **Success signal:** `path.trim()` is non-empty and the file name
  extracted via `path.split("/").pop()` is non-empty.
- **Failure outcome:** picker returned an empty string → `setError`
  surfaces "That file didn't come back with a path. Try dragging it
  in instead." — no downstream call.

### station.upload.preflight_ok

- **Responsible system:** `feature.upload-preflight`.
- **Source code node:**
  `desktop-2/src/design-os/engine/uploadPreflight.ts::preflightSourceFile(path)`.
- **Expected input:** absolute path returned by the picker or the
  drag/drop channel.
- **Expected customer-visible state:** none (preflight is silent on
  success).
- **Expected event ordering:**
  - On failure: `upload_preflight_failed {reason, filename, detail}`
    fires · inline error surfaces the `humanMessage`.
- **Success signal:** `pre.ok === true` — routes into `source:drop`.
- **Failure outcome:** Dropbox smart-sync stub (0 bytes), 0-byte
  writes-in-progress, unsupported extension, deleted-since-picker
  path, permission-denied read → surfaced with the Daniel-locked
  copy from `IngestErrorStrip` (see `IngestErrorStrip.test.tsx`).
- **Telemetry proof:** `upload_preflight_failed` on drift.
- **Regression test:**
  `upload.journey.test.ts::preflight-rejection-ui`.

### station.upload.backend_ingest_started

- **Responsible system:** `feature.upload-source-drop-bus`.
- **Source code node:**
  `UploadPortal.tsx:219` — `bus.emit("source:drop", { paths: [path] })`
  fires — AND `CreateClips.tsx::useEvent("source:drop", …)` picks it
  up. Both the drop channel and the picker channel converge here so
  a native drag/drop and the native picker use one code path.
- **Expected input:** `{ paths: [path] }` with a single absolute
  file path.
- **Expected event ordering:**
  1. `video_input_selected {source:"drop", file_name, path_len, path_starts_with, run_id}`
  2. `sidecar_probe_before_ingest {source:"drop", about_to_call:"sidecar.startRun", run_id}`
  3. `ingest_started {source:"drop", file_name, run_id}`
- **Success signal:** `sidecar.startRun(path, undefined, undefined, undefined, runId)`
  returns `{ project: { slug: <string>, … } }`.
- **Failure outcome:** `sidecar.startRun` throws → `ingest_failed_startrun`
  fires with `{error_name, error_msg, is_sidecar_error, is_prod_fixture_block}`
  · `engine:error {kind:"ingest"}` bubbles.
- **Telemetry proof:** `ingest_started` → `ingest_success` (or
  `ingest_failed_startrun` on failure) in the diagnostic ring; the
  `run_id` correlates back to a `clip_run` row on the backend once
  the sidecar reports.

### station.upload.clip_run_pending

- **Responsible system:** j006-clip-generation (downstream handoff).
- **Source code node:**
  `CreateClips.tsx::drivePostIngestStages(slug, onError)` — pumps
  the `POST_INGEST_STAGES` chain (audio → transcribe → llm → cut →
  reframe → thumbs) via `sidecar.runStage`.
- **Success signal:** control transfers to j006 · j005 exits happy.
- **Failure outcome:** any stage throws → `engine:error {kind:"bake"}`
  · j006 owns the downstream drift.

## Expected telemetry per station

| Topic | Where fired | Payload | Persistence today |
|---|---|---|---|
| `create_screen_mounted` | CreateClipsBody mount effect | `{runtime_mode, session_phase, has_slug, project_slug, tauri_present}` | stdout-only via `/telemetry/diagnostic` |
| `file_picker_selected` | UploadPortal.tsx::browseForFile | `{source, path_length, filename}` | stdout-only |
| `upload_preflight_failed` | UploadPortal.tsx::browseForFile (drift) | `{source, reason, filename, detail}` | stdout-only |
| `video_input_selected` | CreateClips.tsx source:drop handler | `{source, file_name, path_len, path_starts_with, run_id}` | stdout-only |
| `sidecar_probe_before_ingest` | CreateClips.tsx source:drop handler | `{source, about_to_call, run_id}` | stdout-only |
| `ingest_started` | CreateClips.tsx source:drop handler | `{source, file_name, run_id}` | stdout-only |
| `ingest_success` | CreateClips.tsx source:drop `.then` | `{slug, project_is_fixture_slug, stages_present}` | stdout-only |
| `ingest_failed_startrun` | CreateClips.tsx source:drop `.catch` | `{error_name, error_msg, is_sidecar_error, is_prod_fixture_block}` | stdout-only |

### `expected_telemetry_persistence: stdout-only + telemetry/clip_run row on completion`

The `/telemetry/diagnostic` sink prints every event to stdout with
the `[LC-CLIENT-DIAG]` prefix. When the run completes (or dies), the
sidecar posts a `clip_run` row via `POST /telemetry/clip_run` — this
IS persisted in the `clip_runs` table and readable from Admin HQ
Clip Runs tab (`GET /admin/clip-runs`).

## Acceptance test IDs

- `desktop-2/src/routes/upload/upload.journey.test.ts`
  - `drop-zone-visible`
  - `preflight-rejection-ui`
  - `preflight-ok-state`
  - `upload-progress-ui-states`
  - `native-picker-owned-by-c1` (skip · reference to C1's native-walk-prep)

## Current status

AMBER

- Frontend seams + telemetry wired.
- Native picker walk owned by C1 (documented, not asserted here).
- Backend `clip_run` receipt persistence proven by
  `junior-backend/tests/test_clip_run_endtoend.py`.
- Real Whisper invocation deferred to a runtime-only proof — no
  bundled `faster-whisper` model in the test env. STOP documented
  in the Impact Report.

## Last verified

`2026-07-12 · <commit-sha> · Train C3 dispatch`

## Known bugs blocking

- BC-004 (business journey with no canonical owner) · j005 becomes
  the canonical owner with this commit.
- BC-005 (clipping state observability gaps) · progress noted; full
  observability (surfacing `clip_run` rows into HQ Clip Runs tab in
  real time) is Barrier 3 territory.

## Recovery / degrade path

- Sidecar unreachable → `isSidecarUnavailable(e) === true` → the
  design-os stub drives a 6-second mock progress bar so the surface
  is honest ("Engine preview" eyebrow instead of "Source bay"); the
  user is invited to open the desktop app for real ingest.
- Preflight fails → inline error with the Daniel-locked
  human-message; no session persisted; no `source:drop` fired.
- Picker cancelled → no state change; no error; no telemetry.

## HQ dashboard

- Clip Runs tab (`account-app/src/components/admin/ClipRunsTab.tsx`)
  → reads `GET /admin/clip-runs` which surfaces the `clip_run`
  row this journey's run_id ultimately produces.
- Journey Map tab
  (`account-app/src/components/admin/JourneyMapTab.tsx`) → j005
  status.

## Notes

- The URL-paste path (`onPasteUrl` in UploadPortal) is a sibling
  entry into j006 · not part of j005. j006 documents that flow.
- j005 does NOT own the native OS file dialog — Train C1 owns it in
  `lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md`.
- `session.project.clips` is the source of truth for the clip grid
  the user reviews (Workstation surface). j005 does not touch that
  render; only the ingest handoff.
