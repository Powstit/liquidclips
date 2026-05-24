# Claude Bugfix Report — Packaged URL Ingest + Whop Reward Links

Date: 2026-05-24

## Summary

Two launch-grade bugs were found after the 0.4.15 Content Rewards work:

1. Packaged URL ingest could fail with:

   `DownloadError: ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location`

2. The Earn tab's "Add reward" input could treat a Whop campaign/experience URL as a bounty ID, then call the backend proxy with the wrong ID.

Both are fixed in this patch.

## Bug 1 — yt-dlp Could Not Find Bundled ffmpeg/ffprobe

### Root Cause

The packaged app correctly bundles static binaries here:

- `desktop/python-sidecar/bin/ffmpeg`
- `desktop/python-sidecar/bin/ffprobe`

and inside a packaged `.app`:

- `Junior.app/Contents/Resources/_up_/python-sidecar/bin/ffmpeg`
- `Junior.app/Contents/Resources/_up_/python-sidecar/bin/ffprobe`

`desktop/python-sidecar/stages.py` already knows how to resolve those through:

- `stages.ffmpeg_bin()`
- `stages.ffprobe_bin()`

But `desktop/python-sidecar/sidecar.py` calls `yt_dlp.YoutubeDL(...)` directly in:

- `method_ingest_url`
- `method_lift_transcript`

and did not pass `ffmpeg_location`. In a packaged app, yt-dlp then fell back to `PATH`; if the user did not have system ffmpeg installed, post-processing failed even though Junior had bundled ffmpeg.

### Fix

Added `_yt_dlp_ffmpeg_location()` in `sidecar.py`.

It reuses `stages.ffmpeg_bin()`, then passes the containing directory into both yt-dlp option sets:

```python
ffmpeg_location = _yt_dlp_ffmpeg_location()
if ffmpeg_location:
    ydl_opts["ffmpeg_location"] = ffmpeg_location
```

Also replaced remaining direct `shutil.which("ffmpeg")` / `shutil.which("ffprobe")` bypasses in packaged-sensitive paths:

- `sidecar.py::method_probe()` now uses `stages.ffprobe_bin()`
- `sidecar.py` audio fallback now uses `stages.ffmpeg_bin()`
- `stages.py::_probe_audio_duration()` now uses `ffprobe_bin()`
- `stages.py::_split_audio_at_silences()` now uses `ffmpeg_bin()`

### How To Prevent This Again

Rule: any code path that invokes ffmpeg, ffprobe, yt-dlp postprocessors, OpenCV video IO, or audio splitting must use the central resolver in `stages.py`.

Do not use this in sidecar/stages code:

```python
shutil.which("ffmpeg")
shutil.which("ffprobe")
os.environ.get("JUNIOR_FFMPEG") or shutil.which("ffmpeg")
os.environ.get("JUNIOR_FFPROBE") or shutil.which("ffprobe")
```

Use:

```python
stages.ffmpeg_bin()
stages.ffprobe_bin()
```

For yt-dlp specifically, always pass:

```python
ydl_opts["ffmpeg_location"] = str(Path(stages.ffmpeg_bin()).parent)
```

when the resolved ffmpeg is an absolute path.

Recommended regression grep before every packaged QA:

```bash
cd desktop
grep -R "shutil.which(\"ffmpeg\"\\|shutil.which(\"ffprobe\"\\|ffmpeg_location" python-sidecar/*.py
```

Expected:

- `ffmpeg_location` appears in `sidecar.py` yt-dlp options.
- No packaged-sensitive path bypasses `stages.ffmpeg_bin()` / `stages.ffprobe_bin()`.

Required packaged QA:

```bash
cd /Applications/Junior.app/Contents/Resources/_up_/python-sidecar
PY=/Users/dipdip/Desktop/jnr/desktop/python-sidecar/.venv/bin/python
"$PY" - <<'PY'
import sidecar
print(sidecar._yt_dlp_ffmpeg_location())
PY
```

Expected output should point at:

`/Applications/Junior.app/Contents/Resources/_up_/python-sidecar/bin`

Then test one real URL ingest through the packaged sidecar:

```python
sidecar.method_ingest_url({"url": "<public video URL>", "intent": "clips"})
```

## Bug 2 — Whop Campaign/Experience URLs Were Treated As Bounty IDs

### Root Cause

The "Add reward" field in `EarnTab.tsx` supports raw reward IDs or pasted Whop links. The parser accepted the last URL path segment for any URL.

That meant a URL like:

`https://whop.com/experiences/exp_...`

could be treated as if `exp_...` were a bounty ID and sent to:

```ts
sidecar.whopBounty(id)
```

That backend proxy is correct for `bnty_...` IDs, but an experience/campaign ID is not a public bounty ID. This can surface as a Whop GraphQL error or a confusing "not found" flow.

### Fix

`extractBountyId()` now only returns:

- raw `bnty_...` IDs
- URLs containing `/bounties/bnty_...`
- URL last path segments that match `bnty_...`

Everything else returns an empty string and shows a user-facing error:

> Paste a Content Reward link that contains bnty_… or paste the raw bnty_… ID. Campaign / experience links do not point to a specific reward.

### How To Prevent This Again

Rule: never call `publicBounty(id:)` with an untyped Whop URL segment.

Only call the backend bounty-detail proxy when the ID has the expected `bnty_` shape.

Safe examples:

- `bnty_abc123`
- `https://whop.com/.../bounties/bnty_abc123`

Unsafe examples that should be rejected or handled by a separate resolver:

- `https://whop.com/experiences/exp_abc123`
- `https://whop.com/hub/...`
- `https://whop.com/.../campaign/...`

If we later want campaign/experience URLs to work, add a dedicated backend resolver such as:

`GET /whop/resolve-reward?url=...`

That resolver must authenticate to Whop with the App API Key and explicitly map experience/campaign IDs to reward IDs if Whop exposes that relationship.

## Verification Run

Run after patch:

```bash
cd desktop
npm run build
python3 -m py_compile python-sidecar/sidecar.py python-sidecar/stages.py
```

Optional but recommended:

```bash
cd junior-backend
.venv/bin/python -m py_compile app/routes/whop.py
```

Packaged QA:

1. Rebuild/install `Junior.app`.
2. Launch packaged app.
3. Earn → Add reward:
   - raw `bnty_...` should fetch.
   - `/bounties/bnty_...` URL should fetch.
   - `/experiences/...` URL should show the friendly rejection and should not call Whop.
4. URL ingest from a public video should not throw ffmpeg/ffprobe missing.

## Boundary

This patch does not change:

- Railway env
- Whop backend proxy auth
- PostHog
- Starter-pass ledger
- Stripe/Clerk plans
