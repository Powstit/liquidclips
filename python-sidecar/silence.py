"""Silence detection + skip-filter generation for the reframe stage.

Approach: ffmpeg's `silencedetect` filter scans audio and prints "silence_start:"
/ "silence_end:" lines to stderr. We parse those into intervals, then build a
filter_complex `select` + `aselect` expression that drops them while keeping
video and audio in sync.

Why filter_complex instead of `silenceremove` filter: `silenceremove` works
only on audio. Applying it would shrink audio while video stays the same
length → instant A/V desync. The select/aselect pair drops the SAME ranges
from both streams + uses setpts/asetpts to rebase timestamps so the output
is gap-free.

Sprint #13 default config:
- noise threshold: -45 dB (anything quieter is "silent")
- min silence duration: 0.5 s (shorter pauses sound natural; longer is dead
  air worth cutting)
- safety margin: keep 150 ms of silence on each side of each cut so speech
  edges aren't clipped (sounds harsh if you don't)
- minimum interval before we bother cutting: 0.4 s (no point cutting 0.5s
  silences down to 0.2s — viewer can't tell)
"""

from __future__ import annotations

import re
import subprocess
from typing import NamedTuple


SILENCE_NOISE_DB = -45
SILENCE_MIN_DURATION_S = 0.5
SAFETY_PAD_S = 0.15
MIN_CUTTABLE_S = 0.4


class SilentInterval(NamedTuple):
    start: float
    end: float


_SILENCE_START_RE = re.compile(r"silence_start:\s*([0-9.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9.]+)")


def detect_silent_intervals(audio_or_video_path: str, ffmpeg_bin: str) -> list[SilentInterval]:
    """Run ffmpeg silencedetect against any file with an audio stream.
    Returns a list of (start, end) intervals in seconds, sorted, deduped.

    Empty list = no significant silence found (or ffmpeg can't read the file —
    we fail open so the pipeline continues unchanged).
    """
    cmd = [
        ffmpeg_bin,
        "-nostdin", "-hide_banner",
        "-i", audio_or_video_path,
        "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_DURATION_S}",
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    # silencedetect prints to stderr regardless of stdout dest
    lines = (result.stderr or "").splitlines()
    starts: list[float] = []
    ends: list[float] = []
    for line in lines:
        m = _SILENCE_START_RE.search(line)
        if m:
            try:
                starts.append(float(m.group(1)))
            except ValueError:
                pass
            continue
        m = _SILENCE_END_RE.search(line)
        if m:
            try:
                ends.append(float(m.group(1)))
            except ValueError:
                pass
    # Pair up: silencedetect always emits start before its matching end.
    # If the count differs (clip ends mid-silence), drop the unpaired tail.
    n = min(len(starts), len(ends))
    return [SilentInterval(starts[i], ends[i]) for i in range(n)]


def cuttable_intervals(intervals: list[SilentInterval]) -> list[SilentInterval]:
    """Filter to intervals we'd actually cut. Skip the ones too short to be
    worth the artefact risk; apply the safety pad on each side so speech
    edges aren't clipped."""
    out: list[SilentInterval] = []
    for s, e in intervals:
        # Shrink the interval by the safety pad on each side.
        s2 = s + SAFETY_PAD_S
        e2 = e - SAFETY_PAD_S
        if e2 - s2 < MIN_CUTTABLE_S:
            continue
        out.append(SilentInterval(s2, e2))
    return out


def build_select_filters(intervals: list[SilentInterval]) -> tuple[str, str] | None:
    """Build `select` + `aselect` filter expressions that drop the given
    intervals from video + audio respectively. Returns (vselect, aselect) or
    None if there are no intervals to skip.

    The expression negates a chained OR of `between(t, start, end)` for each
    interval — keep the frame iff it's NOT inside any silent interval.
    setpts/asetpts re-bases timestamps so the output is gap-free.
    """
    if not intervals:
        return None
    # between(t,start,end) returns 1 inside [start,end], else 0. We KEEP frames
    # where the sum across all intervals is 0 (i.e., not inside any of them).
    parts = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in intervals)
    keep_expr = f"not({parts})"
    vselect = f"select='{keep_expr}',setpts=N/FRAME_RATE/TB"
    aselect = f"aselect='{keep_expr}',asetpts=N/SR/TB"
    return vselect, aselect


def silence_savings_s(intervals: list[SilentInterval]) -> float:
    """How much silence we'd remove, total. For telemetry/logging."""
    return sum(e - s for s, e in intervals)
