# Bug · Ingest fails on Dropbox smart-synced source with emoji filename

**Ticket owner**: unassigned (Nigerian dev team or Codex — first available)
**Severity**: P0 · customer-blocker for a real usage pattern
**Layer**: PRODUCT · Python sidecar `ingest` stage
**Discovered by**: P3 evidence report (`POST_RC1_P3_LIVE_APP_JOURNEY.md`)
**Date filed**: 2026-07-13

---

## Signature

`~/LiquidClips/projects/jae5-x-walkz-stream-guest-stream-1/project.json`:

```json
{
  "run_id": "bc2ad202b0bb4bebbc51dd69f270678f",
  "source_path": "/Users/dipdip/Downloads/Uncle Daniel Dropbox/Daniel Diyepriye/Videos/Jae5 x Walkz Stream!! 🟢 Guest Stream 🟢 (1).mp4",
  "stages": {
    "ingest": {
      "status": "failed",
      "error": "CalledProcessError: … ffprobe … returned non-zero exit status 1.",
      "started_at": 1783750971.716,
      "finished_at": 1783750972.142
    }
  }
}
```

The bundled ffprobe subprocess returns exit 1 when the source lives in a Dropbox smart-synced folder AND the filename contains emoji + `!!` + spaces. The failure lands in ~400 ms so the user sees an instant unexplained crash instead of a real ingest attempt.

## Reproduction candidates (untested — needs a rerun to confirm each dimension)

Any of these could be root cause. Fix the one that reproduces.

1. **Dropbox smart-sync placeholder** · the file exists in Finder listing but not on disk (Dropbox stub). ffprobe hits a zero-byte placeholder and errors.
2. **Filename encoding** · Python subprocess passes the emoji + `!!` bytes to ffprobe without a proper UTF-8 argv encoding on macOS.
3. **Shell interpretation of `!!`** · if the sidecar passes the path through a shell layer, `!!` is history expansion and may corrupt the argv.
4. **Path length** · the Dropbox smart-sync path is long enough (135+ chars) to hit macOS path length limits inside PyInstaller-bundled ffprobe.

## Fix scope (frontend / runtime · shell FROZEN)

Runtime/frontend side (Codex-owned):

- **Add a pre-flight guard** in the ClipRail submit path: before firing ingest, POST to sidecar's `/preflight` (or equivalent) with the source path so the sidecar can `os.path.exists` + `os.stat` + `os.path.getsize` and reject with a typed error before the LLM chain starts.
- **Add the friendly-error UI**: when the sidecar returns `ingest.failed` with an error class matching `["source_not_hydrated", "source_encoding_error", "source_missing"]`, render the toast:
  > "That file isn't fully downloaded from Dropbox. Right-click it in Finder → *Make available offline* → try again."
- **Add the E2E spec** at `tests/e2e/ingest-friendly-failure.spec.ts` that seeds a mock sidecar 4xx `source_not_hydrated` response and asserts the toast copy renders exactly.

Python-sidecar side (Codex OR human developer):

- **Guard the source before ffprobe**: add `os.path.exists(source_path)` + `os.stat().st_size > 0` + read-first-4KB smoke check. Return a typed error class (`source_not_hydrated`) that the runtime UI knows how to render.
- **Encoding fix**: ensure `sys.argv` / `subprocess.run` on macOS accepts UTF-8. Explicitly encode with `os.fsencode` if needed.
- **Add a Python unit test** for the ingest guard: a file that doesn't exist, a file with emoji in path, a file that's a Dropbox placeholder (zero-byte).

## Verification (definition of done)

1. Manual test: drop the specific file `Jae5 x Walkz Stream!! 🟢 Guest Stream 🟢 (1).mp4` into the running app, observe a friendly toast within 500 ms.
2. Deliberate-regression: break the sidecar guard temporarily; the E2E spec must fail.
3. `project.json` records `ingest.status = "failed"` AND `error.class = "source_not_hydrated"` (typed error class, not raw `CalledProcessError`).
4. No shell / Tauri / Rust change.

## Non-negotiable rules honoured

- No shell rebuild.
- No silent retry — the error surfaces honestly.
- No product-intent change — Dropbox is a supported source location.
- No pricing / entitlement change.

## Blast radius

Runtime + Python sidecar. No backend schema change. Ships as a runtime bundle hot-swap. Rollback: revert the manifest to the pre-fix bundle.

## Related

- `POST_RC1_P3_LIVE_APP_JOURNEY.md` § "Failure observed" — original evidence.
- `POST_RC1_P4_SHIP_READY_REPORT.md` § "Journey 5 · Clip generation" — flagged as the one true blocker.
- `POST_RC1_EXECUTION_PLAN.md` § 5 · queue #1 (customer-blocking broken flows).
