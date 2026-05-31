r"""Animated caption (ASS subtitle) generator.

The competitive differentiator per UPGRADE_OPPORTUNITIES.md: word-by-word
highlighted captions like OpusClip / Submagic ship. Implemented via the ASS
subtitle format + ffmpeg's `ass` filter — zero new Python deps, drop-in
replacement for the SRT-based subtitles filter the reframe stage already
uses.

How it works:
- Per clip we slice the project's word-level transcript (faster-whisper
  word_timestamps=True; segments include .words) to just the words inside
  the clip's start/end window
- Group consecutive words into short on-screen "lines" (4 words ≈ TikTok
  reading speed)
- Emit one ASS Dialogue event per line. Inside the line, each word gets a
  `{\kf<centi>}` karaoke fill tag so it highlights from baseline color
  (SecondaryColour) to active color (PrimaryColour) over its real duration

ASS playback rules (kept for memory):
- Color format `&HAABBGGRR` (alpha, blue, green, red — each 2 hex digits)
- `{\kf<n>}` = karaoke FILL: fade SecondaryColour → PrimaryColour over n
  centi-seconds, then leave at PrimaryColour
- `Alignment 2` = bottom-center; MarginV pushes up from the bottom edge
- `BorderStyle 1` + `Outline N` = stroke around glyphs (no box behind)

v1 ships ONE style ("Bold Yellow"). Style picker UI lives in sprint #18a
(icon batch + caption swatch generation) + a future ClipPreview component
edit. The CSS-equivalent style swatch artwork is generated separately via
gpt-image-1.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


# Default canvas the reframe stage targets (vertical 9:16 at 1080x1920).
DEFAULT_PLAY_W = 1080
DEFAULT_PLAY_H = 1920


def _format_ass_time(seconds: float) -> str:
    """ASS uses H:MM:SS.cc (centiseconds, two digits)."""
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds - (h * 3600) - (m * 60)
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_escape(text: str) -> str:
    """Escape characters that break ASS line parsing. Newline tokens (\\N)
    are intentionally not used here — the line grouping below already keeps
    each on-screen chunk on its own Dialogue event."""
    return (
        text.replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\n", " ")
    )


def _group_words_into_lines(
    words: list[tuple[float, float, str]],
    words_per_line: int = 4,
) -> list[list[tuple[float, float, str]]]:
    """Pack consecutive words into lines of up to N words. Real OpusClip-style
    caption rendering uses 3-5 words per on-screen unit so the viewer can
    read each chunk without saccading. Breaks ALSO if the gap between two
    consecutive words is >= 1.2s (natural sentence break)."""
    if not words:
        return []
    lines: list[list[tuple[float, float, str]]] = []
    current: list[tuple[float, float, str]] = []
    last_end = words[0][0]
    for w in words:
        start, end, text = w
        gap = start - last_end
        if current and (len(current) >= words_per_line or gap >= 1.2):
            lines.append(current)
            current = []
        current.append(w)
        last_end = end
    if current:
        lines.append(current)
    return lines


# v1 style preset. Future sprints add more (TikTok Stack, Subway Surfer,
# Clean White, Brand Fuchsia) via gpt-image-1 swatches + new entries here.
_STYLES: dict[str, dict[str, Any]] = {
    "bold_yellow": {
        # Visible-area font sizing — large enough to read on a phone, not so
        # huge it eats the frame. 72px on a 1920-tall canvas ≈ ~3.7% of height.
        "fontname": "Helvetica Neue",
        "fontsize": 72,
        # SecondaryColour = baseline word color (everything not yet "sung")
        "secondary_color": "&H00FFFFFF",  # pure white
        # PrimaryColour = highlighted/sung word color
        "primary_color": "&H0000FFFF",   # bright yellow #FFFF00 (BBGGRR)
        # OutlineColour = stroke around every glyph
        "outline_color": "&H00000000",   # black
        # BackColour = drop-shadow / box behind (only renders with BorderStyle 3)
        "back_color": "&H80000000",
        "bold": -1,                      # -1 = bold ON in ASS
        "outline": 5,                    # thick stroke for readability
        "shadow": 0,
        "border_style": 1,               # 1 = outline + shadow; 3 = filled box
        "alignment": 2,                  # bottom-center
        "margin_l": 80,
        "margin_r": 80,
        "margin_v": 240,                 # push up from bottom edge so it sits in lower-third
    }
}


def _build_style_line(style_name: str) -> str:
    """Render the `Style: Default,...` block per the V4+ format spec."""
    s = _STYLES.get(style_name, _STYLES["bold_yellow"])
    # Format columns (per ASS V4+ spec, exact order matters):
    # Name, Fontname, Fontsize,
    # PrimaryColour, SecondaryColour, OutlineColour, BackColour,
    # Bold, Italic, Underline, StrikeOut,
    # ScaleX, ScaleY, Spacing, Angle,
    # BorderStyle, Outline, Shadow,
    # Alignment, MarginL, MarginR, MarginV, Encoding
    fields = [
        "Default",
        s["fontname"],
        str(s["fontsize"]),
        s["primary_color"],
        s["secondary_color"],
        s["outline_color"],
        s["back_color"],
        str(s["bold"]),
        "0",  # italic
        "0",  # underline
        "0",  # strikeout
        "100", "100",  # scale x/y
        "0",   # spacing
        "0",   # angle
        str(s["border_style"]),
        str(s["outline"]),
        str(s["shadow"]),
        str(s["alignment"]),
        str(s["margin_l"]),
        str(s["margin_r"]),
        str(s["margin_v"]),
        "1",   # encoding
    ]
    return "Style: " + ",".join(fields)


def _dialogue_for_line(line: list[tuple[float, float, str]]) -> str:
    """Emit one Dialogue event with karaoke fill timing for each word."""
    if not line:
        return ""
    start_s = line[0][0]
    end_s = line[-1][1]
    parts: list[str] = []
    for ws, we, text in line:
        # centiseconds rounded; min 1 centi so each word has at least a tick
        dur_cs = max(1, int(round((we - ws) * 100)))
        parts.append(f"{{\\kf{dur_cs}}}{_ass_escape(text.strip())}")
    text_field = " ".join(parts)
    return (
        f"Dialogue: 0,{_format_ass_time(start_s)},{_format_ass_time(end_s)},"
        f"Default,,0,0,0,,{text_field}"
    )


def generate_ass(
    word_segments: list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
    out_path: Path,
    *,
    canvas_w: int = DEFAULT_PLAY_W,
    canvas_h: int = DEFAULT_PLAY_H,
    style: str = "bold_yellow",
    words_per_line: int = 4,
) -> Path:
    """Write an ASS file for a single clip's word-level captions.

    `word_segments` is the full project transcript's `segments_list` — each
    segment with a `words: [{start, end, word, ...}]` array (faster-whisper
    output shape). We flatten and filter to the [clip_start, clip_end] window,
    re-base timestamps to clip-relative time, group into lines, and emit.
    """
    # Flatten + filter to the clip window, re-base to clip-relative timestamps.
    rel: list[tuple[float, float, str]] = []
    for seg in word_segments or []:
        for w in (seg.get("words") or []):
            try:
                ws = float(w.get("start") or 0)
                we = float(w.get("end") or 0)
            except (TypeError, ValueError):
                continue
            text = (w.get("word") or "").strip()
            if not text:
                continue
            # Keep words that overlap the clip window at all.
            if we <= clip_start or ws >= clip_end:
                continue
            # Clamp to the window edges.
            rs = max(0.0, ws - clip_start)
            re_ = max(rs + 0.01, min(clip_end - clip_start, we - clip_start))
            rel.append((rs, re_, text))

    lines = _group_words_into_lines(rel, words_per_line=words_per_line)

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {canvas_w}\n"
        f"PlayResY: {canvas_h}\n"
        "ScaledBorderAndShadow: yes\n"
        "WrapStyle: 2\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"{_build_style_line(style)}\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    body = "\n".join(_dialogue_for_line(line) for line in lines if line)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(header + body + "\n", encoding="utf-8")
    return out_path


def has_word_level_data(segments: list[dict[str, Any]] | None) -> bool:
    """Cheap probe — does the transcript include per-word timestamps? If not,
    the reframe stage falls back to the SRT-based static captions."""
    if not segments:
        return False
    for seg in segments:
        words = seg.get("words") or []
        if words and isinstance(words, list) and isinstance(words[0], dict):
            if "start" in words[0] and "end" in words[0]:
                return True
    return False
