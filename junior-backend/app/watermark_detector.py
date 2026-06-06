"""Liquid Clips free-tier watermark detector.

Free-tier exports carry the brand wordmark (Kade alien glyph + LIQUID/CLIPS
text) overlaid across the bottom of every clip. The watermark is the
conversion engine: submitted clips must be clean to qualify for Whop content
rewards, so users who want to monetise have to upgrade off the free tier.

This module powers SERVER-SIDE detection. The desktop can't be trusted to
self-validate (a user could patch out the check). Every submission ingested
via routes/submissions.py runs through `clip_has_watermark()` before being
forwarded to Whop's content reward queue.

Detection signature (must stay in sync with desktop/python-sidecar/stages.py
`_liquid_lift_watermark_filter`):
  • Color: fuchsia, RGB (255, 26, 140) ≈ #FF1A8C — the Liquid brand fuchsia.
    The Kade alien glyph is solid fuchsia; the wordmark text is light but
    the alien alone exposes enough pixels for HSV masking.
  • Position: BOTTOM strip, anchored right with ~5% margin. Wordmark spans
    ~89% of frame width so the ROI covers most of the bottom band.
  • Asset: liquid-clips-wordmark.png overlaid at 85% alpha.

Detection method:
  • Sample 3 frames via ffmpeg at 1s, 3s, 5s (covers the typical 9-75s clip)
  • For each frame: HSV-convert, mask the fuchsia color range, count pixels
    in the target region. If >1.5% of pixels in the bottom-strip match
    fuchsia, watermark detected.
  • False-positive risk: brands with fuchsia logos. Mitigated by requiring
    2-of-3 frames to trigger so a transient pink poster frame doesn't pass.

Returns a structured result so the submission UI can render a clean error
("Free-tier watermark detected at 0:03 — re-export from Pro/Solo to submit").
"""

from __future__ import annotations

import base64
import logging
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("junior.watermark")

# ── Detection constants ──────────────────────────────────────────────────
# Fuchsia HSV range. OpenCV uses H in [0,179], S/V in [0,255].
# Brand fuchsia #FF1A8C → H≈325 → OpenCV H≈162.
_HSV_LOW = (155, 140, 140)   # lower bound (H, S, V)
_HSV_HIGH = (175, 255, 255)  # upper bound

# Sample timestamps (seconds). Cover the typical clip range without being
# slow — 3 frames is plenty for a heuristic.
_SAMPLE_TIMESTAMPS_S = (1.0, 3.0, 5.0)

# Region of interest: BOTTOM strip. v0.6.14 watermark spans ~89% of frame
# width anchored right (5% margin) and sits in the bottom 25-30% with a
# ~7% bottom margin. ROI covers slightly more than the wordmark footprint
# so cropping / letterboxing doesn't push it off-screen.
_ROI_X_START_FRAC = 0.05
_ROI_X_END_FRAC = 0.97
_ROI_Y_START_FRAC = 0.72
_ROI_Y_END_FRAC = 0.97

# Detection threshold — % of ROI pixels matching fuchsia mask.
# Empirically: clean clip ≈ 0.05%, watermarked clip ≈ 3-8%.
_FUCHSIA_PIXEL_THRESHOLD_PCT = 1.5

# Minimum frames matching to call it watermarked. 2-of-3 frames must trigger,
# so a single fuchsia poster frame doesn't false-positive.
_MIN_MATCHING_FRAMES = 2


@dataclass
class WatermarkResult:
    detected: bool
    confidence: float            # 0..1; 1.0 = all 3 frames matched
    matching_frames: list[float] # timestamps where the watermark was seen
    sample_pct_per_frame: list[float]  # debug: % fuchsia pixels per frame
    reason: str                  # human-readable explanation


def clip_has_watermark(video_path: str | Path) -> WatermarkResult:
    """Run the full detection pipeline on a local video file.

    Caller is responsible for downloading the clip (e.g. fetching from the
    submitted TikTok/Reels URL via yt-dlp + storing to a temp path) and
    cleaning up after. This module is pure detection.
    """
    try:
        import cv2  # noqa: F401 — lazy import; only required when detection runs
        import numpy as np  # noqa: F401
    except ImportError:
        log.warning("[watermark] cv2/numpy missing — detection disabled")
        return WatermarkResult(
            detected=False,
            confidence=0.0,
            matching_frames=[],
            sample_pct_per_frame=[],
            reason="detector not available (missing cv2/numpy)",
        )

    path = Path(video_path)
    if not path.exists() or path.stat().st_size == 0:
        return WatermarkResult(
            detected=False,
            confidence=0.0,
            matching_frames=[],
            sample_pct_per_frame=[],
            reason=f"video not readable: {path}",
        )

    frames = _sample_frames(path)
    if not frames:
        return WatermarkResult(
            detected=False,
            confidence=0.0,
            matching_frames=[],
            sample_pct_per_frame=[],
            reason="couldn't sample any frames — clip may be shorter than 5s",
        )

    pct_per_frame: list[float] = []
    matching: list[float] = []
    for ts, frame_path in frames:
        pct = _fuchsia_pct_in_roi(frame_path)
        pct_per_frame.append(pct)
        if pct >= _FUCHSIA_PIXEL_THRESHOLD_PCT:
            matching.append(ts)
        try:
            frame_path.unlink()
        except OSError:
            pass

    detected = len(matching) >= _MIN_MATCHING_FRAMES
    confidence = len(matching) / max(1, len(frames))

    if detected:
        reason = (
            f"Liquid Lift free-tier watermark detected at "
            f"{', '.join(f'{t:.0f}s' for t in matching)}. "
            "Upgrade to Solo or Pro to export without watermark, then re-submit."
        )
    else:
        reason = "no watermark detected — clean export"

    return WatermarkResult(
        detected=detected,
        confidence=confidence,
        matching_frames=matching,
        sample_pct_per_frame=pct_per_frame,
        reason=reason,
    )


# ── Internals ────────────────────────────────────────────────────────────

def _sample_frames(video_path: Path) -> list[tuple[float, Path]]:
    """Extract still frames at the sample timestamps. Returns (ts, path)."""
    out: list[tuple[float, Path]] = []
    tmpdir = Path(tempfile.mkdtemp(prefix="watermark_"))
    for ts in _SAMPLE_TIMESTAMPS_S:
        frame_path = tmpdir / f"frame_{int(ts * 1000)}ms.png"
        # ffmpeg -ss <ts> -i <input> -vframes 1 -q:v 2 <output>
        # -ss before -i = fast seek (less precise but fine for thumbnail-grade
        # sampling). -q:v 2 = high-quality JPEG/PNG.
        cmd = [
            _ffmpeg_bin(),
            "-y",
            "-loglevel", "error",
            "-ss", f"{ts}",
            "-i", str(video_path),
            "-frames:v", "1",
            "-q:v", "2",
            str(frame_path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=20)
            if result.returncode != 0 or not frame_path.exists():
                # Clip may be shorter than this timestamp — skip silently.
                continue
            out.append((ts, frame_path))
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            log.warning("[watermark] ffmpeg sample failed at %.1fs: %s", ts, e)
            continue
    return out


def _fuchsia_pct_in_roi(frame_path: Path) -> float:
    """Return % of pixels in the right-strip ROI matching the fuchsia HSV range."""
    import cv2
    import numpy as np

    img = cv2.imread(str(frame_path))
    if img is None:
        return 0.0
    h, w = img.shape[:2]

    x0 = int(w * _ROI_X_START_FRAC)
    x1 = int(w * _ROI_X_END_FRAC)
    y0 = int(h * _ROI_Y_START_FRAC)
    y1 = int(h * _ROI_Y_END_FRAC)
    roi = img[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0

    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(
        hsv,
        np.array(_HSV_LOW, dtype=np.uint8),
        np.array(_HSV_HIGH, dtype=np.uint8),
    )
    matching_pixels = int(np.count_nonzero(mask))
    total_pixels = int(mask.size)
    if total_pixels == 0:
        return 0.0
    return (matching_pixels / total_pixels) * 100.0


def _ffmpeg_bin() -> str:
    """Resolve ffmpeg path. Prefers bundled sidecar binary on the desktop;
    falls back to PATH lookup on the backend."""
    bundled = Path(__file__).parent.parent.parent / "desktop" / "python-sidecar" / "bin" / "ffmpeg"
    if bundled.exists():
        return str(bundled)
    return os.environ.get("FFMPEG_BIN", "ffmpeg")
