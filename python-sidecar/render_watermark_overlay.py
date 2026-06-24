"""Render the "Made with Liquid Clips" animated watermark overlay.

Bakes the 3D crawling bug + wordmark lockup into a transparent WebM
loop suitable for ffmpeg compositing into free-tier exports. Output is
4:1 aspect (corner-bug + wordmark size) — the export pipeline scales
it to the clip's watermark dimensions at composite time.

Motion timeline matches `desktop/src/assets/made-with-liquid-clips.svg`:
  0 – 3s   intro crawl   bug enters from x=-110, ease to settle at x=0
  3 – 10.2s settled idle bug holds, micro-bob via Y oscillation
  10.2 – 12s walk-off    bug exits to x=520 (off-canvas right)
  loop at 12s.

Wordmark "MADE WITH" + "LIQUID/CLIPS" is rendered as a static PNG via
ffmpeg's drawtext (Geist falls back to system mono/sans on first run).

Why ffmpeg-only (no headless Chrome):
  • Pure deterministic — no Chromium version drift, no flaky frame
    capture, no chrome dependency on Tauri-app machines.
  • The animation IS just translateX of a PNG. ffmpeg's overlay filter
    accepts time expressions natively (x='if(lt(t,3),...)' etc).
  • Builds in ~3s on a 2020 MBP. Runs in CI on every release tag.

Run from `python-sidecar/`:
  .venv/bin/python -m render_watermark_overlay
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUG_PNG = ROOT / "src" / "assets" / "bug-3d" / "invader-evolution-320.png"
OUT_DIR = ROOT / "python-sidecar" / "assets" / "watermark"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_OVERLAY = OUT_DIR / "made-with-liquid-clips.mov"
OUT_STATIC = OUT_DIR / "made-with-liquid-clips-static.png"

CANVAS_W = 480
CANVAS_H = 120
BUG_W = 80  # rendered size inside the canvas
BUG_H = 80
SETTLE_X = 14
SETTLE_Y = 28
DURATION = 12.0
FPS = 30

# Position expression — three phases. ffmpeg overlay filter accepts
# `t` (seconds) so this whole thing baked into one filter graph.
#   0 – 3s    : x goes from -110 → SETTLE_X (ease cubic).
#   3 – 10.2s : x stays at SETTLE_X.
#   10.2 – 12s: x goes from SETTLE_X → 520 (off-canvas right).
X_EXPR = (
    f"if(lt(t,3),"
    f"  {SETTLE_X} + (-110-{SETTLE_X})*pow(1-t/3\\,3),"
    f"  if(lt(t,10.2),"
    f"    {SETTLE_X},"
    f"    {SETTLE_X} + (520-{SETTLE_X})*((t-10.2)/1.8)"
    f"  )"
    f")"
)
# Y micro-bob — gentle sine. Amplitude 1.2px, period 0.5s.
Y_EXPR = f"{SETTLE_Y} - 1.2*abs(sin(t*PI*2))"


def must_have_ffmpeg() -> str:
    """Look for ffmpeg in the sidecar's bundled bin/ first (matches the
    runtime lookup path used by stages.py), then fall back to PATH."""
    bundled = ROOT / "python-sidecar" / "bin" / "ffmpeg"
    if bundled.exists():
        return str(bundled)
    path_ff = shutil.which("ffmpeg")
    if path_ff:
        return path_ff
    print("ffmpeg not found (bundled or on PATH)", file=sys.stderr)
    sys.exit(1)


def font_path() -> str | None:
    """Pick a system font that renders the wordmark. Geist falls back
    to a clean system sans-serif so the lockup reads coherently even
    without Geist installed on every dev's machine."""
    for candidate in (
        "/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def render_overlay(ffmpeg: str) -> None:
    if not BUG_PNG.exists():
        print(f"bug PNG missing: {BUG_PNG}", file=sys.stderr)
        sys.exit(1)
    font = font_path()
    if not font:
        print("no system font found — wordmark won't render", file=sys.stderr)
        sys.exit(1)

    # Filter graph:
    #   [0:v] transparent canvas — color=black@0, forced yuva420p so
    #         the alpha channel survives the overlay → drawtext chain.
    #   [1:v] bug PNG scaled to BUG_W×BUG_H
    #   overlay onto canvas with time-varying x/y, format=yuva420p so
    #         the overlay filter keeps alpha (default would discard it).
    #   drawtext "MADE WITH" (mono eyebrow)
    #   drawtext "LIQUID/CLIPS" (display wordmark)
    #   final format=yuva420p forces libvpx-vp9 to encode with alpha.
    filter_complex = (
        f"color=color=black@0:size={CANVAS_W}x{CANVAS_H}:rate={FPS}:duration={DURATION},"
        f"format=yuva420p[bg];"
        f"[1:v]scale={BUG_W}:{BUG_H},format=yuva420p[bug];"
        f"[bg][bug]overlay=x='{X_EXPR}':y='{Y_EXPR}':shortest=1:format=auto,"
        f"drawtext=text='MADE WITH':"
        f"fontfile='{font}':fontsize=12:fontcolor=0xF4F1EAB3:"
        f"x=120:y=46:"
        f"alpha='if(lt(t,1.95),0,min(1\\,(t-1.95)/0.5))',"
        f"drawtext=text='LIQUID/CLIPS':"
        f"fontfile='{font}':fontsize=28:fontcolor=0xF4F1EAFF:"
        f"x=120:y=64:"
        f"alpha='if(lt(t,2.1),0,min(1\\,(t-2.1)/0.5))',"
        f"format=yuva420p"
    )

    # ProRes 4444 in a MOV container. Industry-standard alpha format
    # used in every NLE + ffmpeg's overlay filter natively composites
    # it onto any RGB/YUV source. libvpx-vp9 alpha had reliability
    # issues across ffmpeg versions, so we ship MOV instead.
    print("→ rendering animated overlay (ProRes 4444 MOV)…")
    cmd = [
        ffmpeg,
        "-y",
        "-f", "lavfi",
        "-i", f"color=color=black@0:size={CANVAS_W}x{CANVAS_H}:rate={FPS}:duration={DURATION}",
        "-loop", "1",
        "-i", str(BUG_PNG),
        "-filter_complex", filter_complex,
        "-c:v", "prores_ks",
        "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le",
        "-an",
        "-t", str(DURATION),
        str(OUT_OVERLAY),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-2000:], file=sys.stderr)
        sys.exit(res.returncode)
    print(f"  → {OUT_OVERLAY}  ({OUT_OVERLAY.stat().st_size // 1024} KB)")


def render_static_fallback(ffmpeg: str) -> None:
    """Static PNG fallback used by the export pipeline when WebM overlay
    fails (codec missing, corrupted file, etc). Renders the SETTLED
    state — bug at the wordmark position, both fully visible."""
    print("→ rendering static fallback PNG…")
    font = font_path()
    if not font:
        sys.exit(1)
    filter_complex = (
        f"color=color=black@0:size={CANVAS_W}x{CANVAS_H}:duration=0.1[bg];"
        f"[1:v]scale={BUG_W}:{BUG_H}[bug];"
        f"[bg][bug]overlay=x={SETTLE_X}:y={SETTLE_Y},"
        f"drawtext=text='MADE WITH':fontfile='{font}':fontsize=12:fontcolor=0xF4F1EAB3:x=120:y=46,"
        f"drawtext=text='LIQUID/CLIPS':fontfile='{font}':fontsize=28:fontcolor=0xF4F1EAFF:x=120:y=64"
    )
    cmd = [
        ffmpeg,
        "-y",
        "-f", "lavfi",
        "-i", f"color=color=black@0:size={CANVAS_W}x{CANVAS_H}:duration=0.1",
        "-loop", "1",
        "-i", str(BUG_PNG),
        "-filter_complex", filter_complex,
        "-frames:v", "1",
        str(OUT_STATIC),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(res.stderr[-2000:], file=sys.stderr)
        sys.exit(res.returncode)
    print(f"  → {OUT_STATIC}  ({OUT_STATIC.stat().st_size // 1024} KB)")


def main() -> None:
    ffmpeg = must_have_ffmpeg()
    render_overlay(ffmpeg)
    render_static_fallback(ffmpeg)
    print("\ndone.")


if __name__ == "__main__":
    main()
