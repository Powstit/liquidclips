# j005 · Upload · Native Walk Prep

**Journey ID:** `j005-upload`
**Capability:** `capability.content-production`
**Simulatable:** `partial` — empty state UI + preflight rejection UI + drop-zone visibility are simulatable; the native file picker + Tauri drag/drop event + real video ingest are native-only.
**Beta gate item satisfied:** *Real upload → clips proven* (upload half; clip half in `j006-clip-generation.md`).

---

## Purpose

Prove that a signed-in Liquid Clips user can upload a local video file through the shell's native file picker OR drag-drop it onto the shell, that the shell correctly hands the file path to the Python sidecar for ingestion, and that the upload UI states (empty · picking · uploading · rejected · handed-off) render honest, non-fake copy per INV-002.

---

## Prerequisites

### Credentials

- `INTERNAL_API_SECRET` — from `~/.claude-credentials/junior-internal.env`. Used by `scripts/rc1-beta/seed-fresh-user.sh` to mint a JWT.

### Test accounts

- One clean Liquid Clips user seeded via `scripts/rc1-beta/seed-fresh-user.sh` with `identity_kind="email-local"`.
- Tier must be `Base` (10-clip free tier) or `Agency`. Upload quota is enforced by tier; walk records the pre-upload counter.

### Env + processes

- Backend `junior-backend` on `http://localhost:8000` — real, not stubbed.
- Frontend Vite dev on `http://localhost:5173` for the automated slice.
- Desktop 2 shell installed at `~/Applications/Liquid Clips.app` for the native slice (`tauri build` + install if missing · out of C1 scope per shell-freeze).
- Python sidecar running (embedded in the shell in prod · started separately for the walk if targeting Vite dev).

### Test files

Checked in under `desktop-2/tests/fixtures/`:
- `walk-video-tiny.mp4` — 3-second 720p H.264 clip (~200KB) · used for the happy-path walk.
- `walk-video-oversized.mp4` — placeholder path for the rejection test (do NOT commit an actual oversized file · document the file size the walk expects and skip the assertion if fixture absent).
- `walk-video-corrupt.txt` — a text file renamed to `.mp4` · used to prove preflight rejection.

**C3 owns the fixture set.** This walk-prep doc references them; do NOT create them in C1.

### State

- SQLite dev DB reset before each walk (`scripts/rc1-beta/reset-test-env.sh`).
- Local sidecar Whisper model file present (`~/Library/Application Support/Liquid Clips/models/ggml-base.en.bin` or equivalent · see `desktop-2/CLAUDE.md` for path).

---

## Step-by-step walk

### Step 1 · Seed fresh user (automated)

`scripts/rc1-beta/seed-fresh-user.sh user_walk_j005_$(date +%s)` returns a JWT. Playwright harness seeds it into localStorage.

**Automated?** Yes.

### Step 2 · Boot app · navigate to Create Clips

Playwright: `page.goto("/#/create")` (Vite dev) OR shell click Console Nav → Create Clips (native).

Assert:
- Route mounts within 5s.
- No boot error boundary text.
- Body length > 20 chars (route rendered).

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 3 · Empty state · Upload Portal CTA present

`UploadPortal` component mounts under `CreateClipsBody`. The floating CTA labelled "Upload portal" (`CreateClips.tsx:328`) must be visible.

Assert:
- `button:has-text("Upload portal")` visible.
- Drop-zone hint copy visible (e.g. "Drop a video here or paste a URL").
- No pre-populated "sample video" placeholder (INV-002 · no fake data).

Capture: screenshot, canonical-state.

**Automated?** Yes.

### Step 4a · Native file picker (MANUAL)

Click "Upload portal" or the file input trigger. macOS native file picker opens (`NSOpenPanel`).

Manual steps:
1. Navigate to `desktop-2/tests/fixtures/walk-video-tiny.mp4`.
2. Select · click Open.
3. Native panel dismisses.

**Automated?** NO — Playwright cannot drive `NSOpenPanel`. `test.skip(true, "NATIVE: NSOpenPanel not scriptable from Playwright · manual pick required")`.

### Step 4b · Drag-drop alternative (MANUAL)

Alternative to 4a: drag `walk-video-tiny.mp4` from Finder onto the app window. Tauri fires `tauri://drag-drop` event; shell's `useEvent("source:drop", ...)` handler (CreateClips.tsx:197) picks it up.

Manual steps:
1. Open Finder alongside app.
2. Drag file onto app window drop-zone.
3. Observe drop-zone highlight state (should visibly darken / show target ring).

**Automated?** NO — Tauri file drop events are shell-native. Simulatable via `bus.emit("source:drop", {path, ...})` in dev mode with a JS harness · document that path but the beta receipt needs the real drag.

### Step 5 · Preflight rejection · corrupt file (partial)

Manual (native picker) or automated (via bus emit with mocked path).

Attempt to select `walk-video-corrupt.txt` renamed as `.mp4`. Backend preflight (`/ingest/preflight` or equivalent) rejects with a copy like `"Not a valid video. Try another file."`.

Assert:
- Rejection banner visible.
- No ingest row written to `ingest_runs` table.
- User can dismiss the banner + try again.

Capture: screenshot of rejection state, canonical-state, backend log slice showing 400 response.

**Automated?** Partial — the UI state assertion is automated; the actual picker step is not. Playwright asserts the rejection banner renders when the harness fires a `bus.emit("source:file-rejected")` in dev mode.

### Step 6 · Happy-path upload progresses

After valid file selected:
1. `startPersistedSession` fires (CreateClips.tsx:216).
2. `ingest_started` telemetry emitted with `source: "drop"` or `source: "picker"`.
3. Progress state visible (spinner, progress bar, or step indicator).
4. Backend POST `/ingest/start` returns `{run_id: "run_..."}`.
5. UI transitions to "Analyzing" or "Cutting" state.

Assert (automated where possible):
- `[data-run-id]` attribute (if wired) or `[data-ingest-state]` transitions.
- Backend log shows `ingest_started` line.
- SQLite `ingest_runs` table has a new row with `state="ingesting"`.

**Automated?** Partial — automated up to the point where the sidecar starts real work. The sidecar's `whisper` invocation + `ffmpeg` cuts are C3's territory (see `j006-clip-generation.md`).

### Step 7 · Handoff proof · no fake completion

Before the walk ends, prove that the file actually reached the sidecar (not just the backend). Backend log must contain a line like `[sidecar] received ingest task run_id=run_...`. If the sidecar isn't running, the walk correctly fails at this step rather than falsely reporting success.

Assert:
- Sidecar log or backend log line references the run_id.
- No `zero-clip fake success` — the walk does not claim upload complete until sidecar acknowledges the task.

**Automated?** Yes (log-tail grep from Playwright fs read).

---

## Expected capture artifacts per step

| Step | screenshot | canonical-state | telemetry | backend.log | DB snapshot |
|---|---|---|---|---|---|
| 1 seed | — | — | — | ✅ | ✅ (user row) |
| 2 boot | ✅ | ✅ | ✅ | — | — |
| 3 empty state | ✅ | ✅ | ✅ | — | — |
| 4a picker (MANUAL) | ✅ (screen recording) | — | — | — | — |
| 4b drop (MANUAL) | ✅ | — | — | — | — |
| 5 rejection | ✅ | ✅ | ✅ | ✅ (400) | ✅ (no row written) |
| 6 progress | ✅ | ✅ | ✅ | ✅ (201) | ✅ (row `state=ingesting`) |
| 7 handoff | — | — | ✅ (`ingest_started`) | ✅ (sidecar line) | ✅ (row updated) |

All artifacts land under `lcos/reports/golden-path/capture/j005-upload/<NN-step>/`.

---

## Pass / fail criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| P1 | Empty state renders without fake video thumb | ✅ if no `<img src=".../sample.jpg">` in DOM · no `$XX earnings` literal | ❌ any fixture data rendered |
| P2 | Drop-zone visually indicates drag-target on drag-over | ✅ if `data-drop-active="true"` OR CSS class transition observed | ❌ no visible state change |
| P3 | Corrupt file rejected with honest copy · not silent | ✅ if banner visible + backend logged rejection reason | ❌ silent swallow (INV-002) |
| P4 | Valid file starts an `ingest_runs` row in SQLite | ✅ if `SELECT * FROM ingest_runs WHERE run_id=…` returns 1 row | ❌ 0 rows (backend never received) |
| P5 | UI progress state actually transitions | ✅ if `[data-ingest-state]` changes over ≥3 samples during walk | ❌ frozen state (BC-005 · UI reading divergent store) |
| P6 | Sidecar handoff proven by log line | ✅ if backend log or sidecar log has `run_id` match | ❌ backend row but no sidecar log = broken |
| P7 | No fake "upload complete" until sidecar work is real | ✅ if state stays `ingesting` until sidecar returns | ❌ premature `state=complete` (zero-clip fake success) |

Overall pass = P1 through P6 all pass. P7 tests the walk's honesty guard (not the app).

---

## Known gaps · what cannot be automated

1. **NSOpenPanel · macOS native picker.** No Playwright hook. Manual step; documented via screen recording in the capture bundle.
2. **Tauri drag-drop events.** Shell fires them; simulatable in dev via `bus.emit("source:drop", {...})` but that path skips the OS-level file resolution. Beta receipt requires the real drag.
3. **Sidecar invocation.** C3 owns the ingest test end-to-end; this walk verifies handoff only.
4. **Preflight coverage matrix.** Corrupt file · oversized file · unsupported codec · zero-byte file. This walk covers ONE (corrupt); the others are documented as C3's `upload.journey.test.ts` fixtures.
5. **BUG-012 relationship.** If the walk runs after a runtime hot-swap without relaunch, the CreateClips route may render the stale bundle · drop-zone hooks may silently miss the new bus event registration. **Always quit + relaunch before running j005** per BUG-012 disposition.

---

## Beta gate impact

Satisfies (upload half):
- ✅ *Real upload → clips proven (upload leg)* — proven by P4 + P6.
- ✅ *Empty state renders without fake data* — proven by P1.

Does NOT satisfy:
- ⏭ *Real upload → clips proven (clip leg)* — see `j006-clip-generation.md`.
- ⏭ *Whisper actually runs* — see `j006`.

---

## Rollback / reversal

1. `scripts/rc1-beta/reset-test-env.sh` wipes the SQLite dev DB (including `ingest_runs`).
2. Delete any created ingest files under `~/Library/Application Support/Liquid Clips/media/`.
3. Kill lingering sidecar workers via `pkill -f "junior_sidecar"` (safe · sidecar is idempotent).

---

## Cross-references

- Route: `desktop-2/src/design-os/routes/CreateClips.tsx` (READ-ONLY for C1).
- Portal: `desktop-2/src/design-os/engine/UploadPortal.tsx` (READ-ONLY).
- Backend ingest: `junior-backend/app/routes/ingest.py` (READ-ONLY · C3 owns edits).
- Related bugs: BUG-005 (notifications badge · unrelated) · none directly.
- Depends-on: j001 (JWT hydration) must pass first.
- Enables: j006 (clip generation).
