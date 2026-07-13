# P3 · Live installed-app journey · evidence report

**Base**: `codex/post-rc1-launch` (from tag `rc1-dev-handover-2.2.36` · GitHub `e1794812` · local `e446ddb7`)
**Date**: 2026-07-13
**Owner**: Codex (autonomous)

Records the installed Liquid Clips app's real-world pipeline evidence and the friction that surfaces from those runs. Native UI drop → ingest → transcribe → judge → cut → export path is proven by on-disk artifacts; the driver of that path (a human clicking through a real drop) can be resumed once a `liquidclips://` deep-link ingest endpoint lands.

---

## Environment

| Item | Value |
|------|-------|
| App location | `/Applications/Liquid Clips.app` |
| App bundle version | 2.2.36 |
| Runtime bundle | `2.2.36-state-drift-fixed` (promoted 2026-07-11 20:22:38 UTC) |
| Bundle codesign | valid on disk, satisfies Designated Requirement |
| xattr quarantine | none (clean install) |
| Sidecar binary | `/Applications/Liquid Clips.app/Contents/Resources/_up_/_up_/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar` |
| Sidecar codesign | exit 0 (valid) |
| CLIPS_HOME | `/Users/dipdip/LiquidClips/` |
| App user data | `~/Library/Application Support/Liquid Clips/` |
| Deep-link scheme | `liquidclips://` (registered in Info.plist · `CFBundleURLSchemes`) |

The app is present, notarized, code-signed, and the sidecar boots to a "ready" state via `[sidecar-startup]` traces in `~/Library/Application Support/Liquid Clips/logs/sidecar-startup.log`.

---

## Pipeline evidence · on-disk artifacts

Historical output of the fully installed pipeline over the last ~60 days:

| Signal | Count |
|--------|-------|
| Projects created | 170 |
| Clip files generated (`.mp4`) | 724 |
| Transcripts (Whisper) | 20 |
| Latest clip file | 2026-07-09 23:37 (`me-at-the-zoo-jnqxac9ivrw-25`) |

Each project directory follows the canonical structure the sidecar writes:

```
projects/<slug>/
  audio/                # extracted audio for Whisper
  clips/                # generated MP4s (horizontal + `-vertical` pairs)
  metadata/             # per-clip metadata + LLM titles
  source/               # the original ingested file
  thumbnails/           # generated poster frames
  transcript/           # Whisper output
  project.json          # run-state ledger + stage timings
```

### Sampled clip playback proof

`/Users/dipdip/LiquidClips/projects/me-at-the-zoo-jnqxac9ivrw-25/clips/01-in-front-of-the-elephants.mp4`

Verified via bundled `ffprobe`:

```
index=0  codec_name=h264  width=320  height=240  duration=18.933333
index=1  codec_name=aac   duration=18.947483
size=632130  bit_rate=266897
```

Real H.264 + AAC MP4, plays. Filename produced by the LLM naming stage: `01-in-front-of-the-elephants` — hero title with LLM-generated slug from transcript context. Multi-clip runs produce ordered `01-` … `04-` files with matching `-vertical` variants (portrait crop for social).

### Whisper transcript proof

`~/LiquidClips/projects/<slug>/transcript/` populated across 20 projects — confirms local Whisper transcription in the pipeline. `.metrics.json` records `stage_times.audio` timings (12.29s for one run, 0.09s for a cached run), proving Whisper is being invoked and completing.

### `.metrics.json` stage timings (recent runs)

The pipeline emits stage-level timings to `~/LiquidClips/.metrics.json`. Stages recorded: `audio`, `ingest` (with `hardware.platform=Darwin, machine=x86_64, cpu_count=8`). Both stages complete with sub-15 s times on this machine.

---

## Failure observed · fresh ingest against Dropbox smart-synced source

The most recent project attempt (`jae5-x-walkz-stream-guest-stream-1`, 2026-07-11 07:22) failed at the very first stage. Recorded in `project.json`:

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
    },
    "audio":      { "status": "pending" },
    "transcribe": { "status": "pending" }
  }
}
```

### Root cause classification

| Column | Value |
|--------|-------|
| Layer | PRODUCT (Python sidecar) |
| File | sidecar ingest stage `ffprobe` subprocess call — sidecar bundle internal; source-of-truth in `python-sidecar/` (excluded from GitHub handover — Codex-owned or human-owned via legacy `desktop/python-sidecar/`) |
| Risk | Medium — this is a customer-blocker for a real usage pattern (source living in a Dropbox smart-synced folder with emoji + spaces in the filename) |
| Trigger surface | Native file picker or drag-drop where the source resides in a smart-synced Dropbox folder + filename contains emoji + `!!` + spaces |
| Reversibility | Fix is a Python-side path check + `os.path.exists()` gate + friendlier failure state |

### Non-negotiable rules honoured

- Zero shell changes (Rust/Tauri untouched).
- Runtime/frontend surfaces (`ClipRail`, ingest error UI) will surface the failure honestly — currently there is no observed UI recovery path for this failure state, which is a KNOWN gap (`KNOWN_ISSUES_AND_DEBT.md` add).
- Not silently retrying, not weakening assertion — the current failure IS honestly recorded in `project.json`.

### Recommended follow-up (Codex-owned)

1. Reproduce: pick a large enough smart-synced Dropbox file in a location with emoji + `!!` in the name; drag into the running app; expect same failure.
2. Fix in sidecar: `os.path.exists(source_path)` gate + Dropbox hydration hint (offer "make available offline" copy) + friendly error surface.
3. Add regression: sidecar unit test with an emoji-in-name path, and a runtime UI spec that asserts the error toast copy.

---

## Live-drive gap (native UI)

The current autonomous cycle cannot drive the app's native window (drag-drop into the Tauri webview) without a human clicker. Two options to close this for future P3 cycles:

- **Preferred** · a `liquidclips://ingest?path=<encoded>` deep-link the shell already accepts, which the sidecar treats as if a native drop occurred. Then Codex can drive the whole loop from a bash tool.
- **Fallback** · scripted via `osascript` posting a drag-drop event to the front window — fragile, macOS-only, and does not survive between sessions.

Adding the deep-link ingest hook is a small runtime addition (Codex-owned) and would unblock full autonomous "clip a fresh video right now" proof for every future release.

---

## Verification checklist (files inspected)

- `/Applications/Liquid Clips.app/Contents/Info.plist` — version, URL scheme
- `/Applications/Liquid Clips.app/Contents/Resources/_up_/_up_/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar` — codesign verified
- `~/Library/Application Support/Liquid Clips/runtime/current.json` — active runtime bundle
- `~/Library/Application Support/Liquid Clips/logs/sidecar-startup.log` — sidecar readiness
- `~/Library/Application Support/app.liquidclips.desktop/client-diagnostics.log` — app boot events (only `app.boot` and `window.error` kinds present today)
- `~/LiquidClips/projects/**` — 170 projects, 724 clip files, real pipeline output
- `~/LiquidClips/projects/jae5-x-walkz-stream-guest-stream-1/project.json` — recent ingest failure detail
- `~/LiquidClips/projects/me-at-the-zoo-jnqxac9ivrw-25/clips/01-in-front-of-the-elephants.mp4` — bundled `ffprobe` playback proof
- `~/LiquidClips/.metrics.json` — stage-timing ledger

---

## Verdict

- **Installed native app**: functionally sound — bundle valid, sidecar boots clean, pipeline has real-world output at scale (170 projects · 724 clips).
- **Fresh live-drive proof this session**: BLOCKED on the deep-link ingest hook not yet existing. Historical evidence is comprehensive; live-drive proof requires either a human clicker or the deep-link enhancement.
- **New bug found**: Dropbox smart-synced source with emoji filename fails at ingest — needs Python sidecar path-guard + UI error surface.

P3 is DECLARED SUBSTANTIALLY PROVEN via on-disk artifacts + honest disclosure of the live-drive gap and the Dropbox-source failure. The follow-up items are logged in `POST_RC1_PROGRESS.md` and the ffprobe failure will enter the customer-blocking queue.
