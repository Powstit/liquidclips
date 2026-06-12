# "Made with Liquid Clips" watermark — acceptance checklist

v0.7.55 · animated overlay in `python-sidecar/assets/watermark/made-with-liquid-clips.mov`.

## Architecture summary

```
_should_watermark()  →  tier check (server-authoritative via /sync · cache 10min)
                       │
                       ├─ False (paid: solo/pro/agency)  →  no filter added
                       └─ True  (free / no JWT / network fail) →
                              _watermark_filter(out_w, out_h, clip_seconds)
                                ├─ clip ≥ 2.5s AND MOV exists →
                                │     _made_with_animated_watermark_filter
                                └─ else →
                                      _liquid_lift_watermark_filter (static fallback)
```

Source of truth for the tier mapping: `junior-backend/app/features.py` →
`features.watermark`. Free tier = `True` (apply), every paid tier =
`False` (skip). Override for local testing only:
`JUNIOR_FREE_WATERMARK=1` forces on, `=0` forces off.

## Manual QA — 6 checks before push

### 1. Free user → animated watermark burned into MP4

```bash
# Clear any local override
unset JUNIOR_FREE_WATERMARK
# Confirm tier
curl -H "Authorization: Bearer $(security find-generic-password -s app.liquidclips.desktop -a LICENSE_JWT -w 2>/dev/null)" \
     https://api.liquidclips.app/sync | jq '.features.watermark'
# Expect: true (you're on free)
```

Export a clip from the app. Open the resulting MP4 in QuickTime. Pause
between 3–10s — the pixel-invader bug should be visible in the bottom-
right corner next to `MADE WITH / LIQUID/CLIPS`. Pause at 0–3s — the
bug is mid-crawl (entering from the left of the lockup area).

Probe the actual encoded bytes (NOT React preview):

```bash
ffmpeg -i /path/to/exported.mp4 -ss 5 -frames:v 1 /tmp/wm-check.png
open /tmp/wm-check.png
```

Pass: bug + wordmark visible in the rasterized frame.
Fail: clean export (means the filter chain didn't apply — check
`_should_watermark()` cache + JWT).

### 2. Paid user → no watermark in final MP4

```bash
# Sign in as a paid user (or set the override)
JUNIOR_FREE_WATERMARK=0
```

Export the same clip. Open in QuickTime. No bug, no wordmark, no static
fallback. Probe a frame to confirm:

```bash
ffmpeg -i /path/to/paid-exported.mp4 -ss 5 -frames:v 1 /tmp/paid-check.png
```

Pass: clean frame, no pixel-invader, no wordmark.
Fail: any watermark visible → tier check regression.

### 3. Upgrade flow → next export after membership refresh is clean

1. Start signed in as free. Export a clip → verify watermarked.
2. Complete the Whop checkout via `/upgrade`.
3. The `/sync` endpoint reports `features.watermark=false`. Caches
   refresh on the next clip export (10-min cache) or restart.
4. Force-refresh: quit + reopen Liquid Clips OR wait 10 minutes.
5. Export the same clip → no watermark.

Pass: clean export after upgrade.
Fail: still watermarked → the 10-min cache is stale or `/sync` returned
the wrong tier. Check `_WATERMARK_TIER_CACHE` clear paths.

### 4. React preview and exported MP4 agree

The desktop React preview MUST NOT show a watermark when the export
won't have one, and vice versa. Per-pixel match isn't required (the
preview is canvas-rendered SVG, the export is ffmpeg-composited MP4),
but the presence/absence is binary and MUST match.

Test matrix:

| Tier      | Preview watermark | Export watermark | Pass when |
|-----------|-------------------|------------------|-----------|
| Free      | visible           | visible          | both show |
| Paid      | hidden            | hidden           | neither   |
| Just-upgraded (cache stale) | hidden after refresh | hidden after refresh | both clean after `/sync` reflects upgrade |

Fail mode to catch: preview shows clean but export contains the
watermark. Means `_should_watermark()` is being bypassed at preview
time but not at export time. Don't ship — both surfaces must agree.

### 5. Watermark must not cover captions or faces

On 1080×1920 vertical layout:
- **Faces** sit at y≈380–670 (upper-center, per face-aware crop).
- **Captions** sit at y≈1150–1450 (lower-center band, per ASS subtitle
  template).
- **Watermark** sits at y≈1714+ (bottom 11% of frame) and the right
  ~32% width (x≈680–1020).

Bottom-right corner is outside both face and caption zones. Verify on
a real clip with both face-aware crop AND captions:

```bash
ffmpeg -i /path/to/clip-with-captions.mp4 -ss 5 -frames:v 1 /tmp/wm-overlap.png
open /tmp/wm-overlap.png
```

Pass: bug + wordmark visible in bottom-right corner. Captions readable
in center band. Subject's face untouched.

### 6. Sub-12s clip handling (no glitch on short exports)

The animated overlay is 12 seconds long. Test three short durations:

| Clip duration | Expected watermark behaviour |
|---------------|------------------------------|
| < 2.5s        | Static fallback (`_liquid_lift_watermark_filter`) — animated needs ≥2.5s to settle and read. |
| 2.5s ≤ d < 12s | Animated overlay plays partially. Bug enters → settles → clip ends. No mid-flight glitch. |
| ≥ 12s         | Animated overlay loops via `movie=:loop=0`. Bug walks off right, re-enters left, repeats. |

Test:

```bash
# 2s clip
ffmpeg -y -hide_banner -loglevel error -i /path/to/clip.mp4 -t 2 /tmp/short.mp4
# Export through the app. Watermark should be the static PNG fallback.

# 5s clip
ffmpeg -y -hide_banner -loglevel error -i /path/to/clip.mp4 -t 5 /tmp/med.mp4
# Export. Animated should play through the intro + settled phase, then
# clip ends mid-loop. No corruption, no missing frames.
```

Pass: no codec errors. Watermark renders coherently for every duration.
Fail: ffmpeg errors at filter graph parse OR the bug appears clipped/
glitched mid-render.

## Fallback test (P0 safety)

Move the animated MOV aside and re-export to verify the static fallback
fires:

```bash
mv ~/Desktop/jnr/desktop/python-sidecar/assets/watermark/made-with-liquid-clips.mov{,.disabled}
# Export. Expect: static wordmark watermark appears at the same position.
mv ~/Desktop/jnr/desktop/python-sidecar/assets/watermark/made-with-liquid-clips.mov{.disabled,}
# Export. Expect: animated bug returns.
```

Pass: free export ALWAYS gets watermarked (animated OR static, never
nothing). Paid export NEVER gets watermarked.

## Regression watch list

- Paid-tier watermark regression: ANY frame from a paid export
  containing a fuchsia pixel near the bottom-right is a regression.
- Free-tier clean export: any frame from a free export WITHOUT a
  watermark is a regression (likely `_should_watermark()` cache
  poisoning).
- Cache staleness: a just-upgraded user still seeing the watermark
  after 15 minutes is a `_WATERMARK_TIER_CACHE` bug.

## Files

| Path | What |
|---|---|
| `desktop/src/assets/made-with-liquid-clips.svg` | Master SVG (React preview source). |
| `desktop/src/assets/bug-3d/invader-evolution.png` | gpt-image-1 master (1024×1024). |
| `desktop/python-sidecar/assets/watermark/made-with-liquid-clips.mov` | Animated overlay (ProRes 4444 alpha · 12s loop · 480×120). |
| `desktop/python-sidecar/assets/watermark/made-with-liquid-clips-static.png` | Static fallback (480×120 RGBA). |
| `desktop/python-sidecar/assets/liquid-clips-wordmark.png` | Legacy static watermark (still used by `_liquid_lift_watermark_filter` for sub-2.5s clips). |
| `desktop/python-sidecar/stages.py` | `_should_watermark()` · `_watermark_filter()` · `_made_with_animated_watermark_filter()` · `_liquid_lift_watermark_filter()`. |
| `desktop/python-sidecar/render_watermark_overlay.py` | Re-render the MOV + static PNG from the gpt-image-1 source. |
