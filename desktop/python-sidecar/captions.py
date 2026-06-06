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
# ASS colors are AABBGGRR — alpha, blue, green, red — each two hex digits.
# So &H008C1AFF = opaque (00), blue 8C, green 1A, red FF = #FF1A8C fuchsia.
# `words_per_line` is a style-level override the caption engine reads when
# packing words into on-screen units (lower = faster read pace, stacked feel).
# Module-level stash for the ASS text the most-recent bake produced. Sidecar
# helpers read it via `last_baked_ass_text()` so they can hand the .ass
# content back to the desktop's libass-wasm overlay without re-walking the
# filesystem. Single-threaded sidecar = a module-level dict is fine; the
# helper resets it before each call to make races impossible.
_LAST_BAKED_ASS: dict[str, str] = {"text": ""}


def last_baked_ass_text() -> str:
    """Return the ASS text from the most-recent bake. Empty string if no
    bake has run this session."""
    return _LAST_BAKED_ASS.get("text", "")


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
        "words_per_line": 4,
    },
    "brand_fuchsia": {
        # The Liquid Clips brand voice — fuchsia karaoke fill on ink-soft
        # baseline, paper-black outline. Matches the marketing site and the
        # desktop arcade theme so a brand_fuchsia clip reads as part of the
        # Liquid Clips identity at a glance.
        "fontname": "Inter",
        "fontsize": 72,
        "secondary_color": "&H00BEC4C8",  # ink-soft (#c8c4be)
        "primary_color":   "&H008C1AFF",  # fuchsia (#ff1a8c)
        "outline_color":   "&H00100B0B",  # paper black (#0b0b10)
        "back_color":      "&H80000000",  # 50% drop shadow
        "bold": -1,
        "outline": 5,
        "shadow": 2,
        "border_style": 1,
        "alignment": 2,
        "margin_l": 80,
        "margin_r": 80,
        "margin_v": 240,
        "words_per_line": 4,
    },
    "tiktok_stack": {
        # The TikTok / Reels stacked look — big white with cyan accent and a
        # heavy black box behind every line for guaranteed contrast over busy
        # creator-cam footage. Fewer words per line (2) so each chunk reads
        # like a separate beat.
        "fontname": "Inter",
        "fontsize": 80,
        "secondary_color": "&H00FFFFFF",  # white baseline
        "primary_color":   "&H00FFE500",  # cyan highlight (#00e5ff)
        "outline_color":   "&H00000000",  # crisp black
        "back_color":      "&HC0000000",  # near-opaque black box
        "bold": -1,
        "outline": 8,
        "shadow": 4,
        "border_style": 3,                # 3 = filled box behind glyphs
        "alignment": 2,
        "margin_l": 60,
        "margin_r": 60,
        "margin_v": 320,                  # higher up — TikTok overlays bottom
        "words_per_line": 2,
    },
    "clean_white": {
        # Editorial / podcast-friendly. Thinner stroke, smaller size, no
        # karaoke highlight (secondary and primary are the same so all words
        # render in plain white). For long-form clips where the read time
        # matters more than the bounce.
        "fontname": "Inter",
        "fontsize": 56,
        "secondary_color": "&H00FFFFFF",
        "primary_color":   "&H00FFFFFF",
        "outline_color":   "&H00000000",
        "back_color":      "&H80000000",
        "bold": 0,
        "outline": 3,
        "shadow": 1,
        "border_style": 1,
        "alignment": 2,
        "margin_l": 100,
        "margin_r": 100,
        "margin_v": 200,
        "words_per_line": 5,
    },
    "subway_surfer": {
        # Maximum read pace — Impact, big, fuchsia outline, cyan karaoke fill.
        # One or two words at a time for that Subway Surfers / hyperloop look
        # that performs on Shorts. The fuchsia outline ties it back to brand.
        "fontname": "Impact",
        "fontsize": 84,
        "secondary_color": "&H00FFFFFF",  # white baseline
        "primary_color":   "&H00FFE500",  # cyan when "sung"
        "outline_color":   "&H008C1AFF",  # fuchsia outline (brand tie)
        "back_color":      "&H80000000",
        "bold": -1,
        "outline": 6,
        "shadow": 3,
        "border_style": 1,
        "alignment": 2,
        "margin_l": 60,
        "margin_r": 60,
        "margin_v": 280,
        "words_per_line": 2,
    },
    "custom": {
        # User-tunable starter. The drawer's react-colorful trio overrides
        # primary_color / secondary_color / outline_color at bake time via
        # the `palette` argument on bake_captions_to_video. Defaults match
        # brand_fuchsia so a clipper who clicks Custom without dragging the
        # pickers still gets a brand-safe render. Everything else is the
        # baseline tikok_stack rhythm — readable on busy footage, 3 words
        # per line so colour reads cleanly per-word.
        "fontname": "Inter",
        "fontsize": 76,
        "secondary_color": "&H00FFFFFF",
        "primary_color":   "&H008C1AFF",  # fuchsia default
        "outline_color":   "&H00100B0B",  # paper-black default
        "back_color":      "&H80000000",
        "bold": -1,
        "outline": 6,
        "shadow": 3,
        "border_style": 1,
        "alignment": 2,
        "margin_l": 60,
        "margin_r": 60,
        "margin_v": 240,
        "words_per_line": 3,
    },
}


# Public — used by the drawer UI to know which style keys exist and how to
# label them. Order here is the order the drawer renders the picker cards.
STYLE_KEYS: list[str] = ["brand_fuchsia", "tiktok_stack", "bold_yellow", "clean_white", "subway_surfer", "custom"]

STYLE_LABELS: dict[str, str] = {
    "brand_fuchsia": "Brand Fuchsia",
    "tiktok_stack":  "TikTok Stack",
    "bold_yellow":   "Bold Yellow",
    "clean_white":   "Clean White",
    "subway_surfer": "Subway Surfer",
    "custom":        "Custom",
}


# Hex (#RRGGBB or RRGGBB) → ASS (&HBBGGRR) — react-colorful gives us standard
# CSS hex; the ASS spec wants byte-reversed RGB with a leading &H00. Tolerant
# of "#" prefix + 3/6 digit forms. Returns None for bad input so the bake
# falls back to the style's default colour rather than rendering garbage.
def hex_to_ass(hex_str: str | None) -> str | None:
    if not hex_str:
        return None
    h = hex_str.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
    except ValueError:
        return None
    return f"&H00{b:02X}{g:02X}{r:02X}"


def style_words_per_line(style_name: str) -> int:
    """Per-style override for line packing. Falls back to 4 if missing."""
    s = _STYLES.get(style_name) or _STYLES["bold_yellow"]
    return int(s.get("words_per_line") or 4)


def _build_style_line(style_name: str, palette: dict[str, str] | None = None) -> str:
    """Render the `Style: Default,...` block per the V4+ format spec.

    `palette` (optional) overrides primary/secondary/outline colours from a
    user-picked palette. Used by the "custom" style so the react-colorful
    swatches in the drawer drive what gets baked. Keys: `primary`,
    `secondary`, `outline`; values are CSS hex (#RRGGBB) or None. Anything
    missing / malformed falls back to the named style's preset colour so a
    half-filled palette never breaks the bake.
    """
    s = _STYLES.get(style_name, _STYLES["bold_yellow"])
    primary = s["primary_color"]
    secondary = s["secondary_color"]
    outline = s["outline_color"]
    if palette:
        p_override = hex_to_ass(palette.get("primary")) if palette.get("primary") else None
        s_override = hex_to_ass(palette.get("secondary")) if palette.get("secondary") else None
        o_override = hex_to_ass(palette.get("outline")) if palette.get("outline") else None
        if p_override:
            primary = p_override
        if s_override:
            secondary = s_override
        if o_override:
            outline = o_override
    s = {**s, "primary_color": primary, "secondary_color": secondary, "outline_color": outline}
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


# ===========================================================================
# PHASE 1 — Standalone caption bake.
#
# The original generate_ass() consumes word-level transcript segments and
# re-bases them. The drawer UI lets users post-edit lines DIRECTLY — they
# already arrive in clip-relative time, already grouped. So we add two siblings:
#
#   generate_ass_from_lines(lines, out_path, style)
#   bake_captions_to_video(clip_path, lines, style)
#
# bake_captions_to_video runs ffmpeg with the `ass` filter to burn fresh
# captions onto an already-reframed clip — no full reframe re-run needed.
# Atomic replace: write to .{stem}.editing.mp4, then os.replace to swap in.
#
# Avoid importing from `stages.py` (would be a cycle — stages imports from
# captions). Inline tiny ffmpeg-discovery helper instead.
# ===========================================================================

import os as _os
import shutil as _shutil
import subprocess as _subprocess
from pathlib import Path as _Path


def _bundled_ffmpeg() -> str | None:
    here = _Path(__file__).resolve().parent
    candidates = [
        here / "bin" / "ffmpeg",
        here.parent / "_up_" / "python-sidecar" / "bin" / "ffmpeg",
    ]
    for c in candidates:
        if c.is_file() and _os.access(c, _os.X_OK):
            return str(c)
    return None


def _ffmpeg_bin() -> str:
    return (
        _os.environ.get("JUNIOR_FFMPEG")
        or _bundled_ffmpeg()
        or _shutil.which("ffmpeg")
        or "ffmpeg"
    )


def _ass_filter_arg(ass_path: _Path) -> str:
    """Escape colons + backslashes so ffmpeg's filter parser accepts the path."""
    return "ass=" + str(ass_path).replace("\\", "\\\\").replace(":", "\\:")


def generate_ass_from_lines(
    lines: list[dict[str, Any]],
    out_path: _Path,
    *,
    style: str = "bold_yellow",
    canvas_w: int = DEFAULT_PLAY_W,
    canvas_h: int = DEFAULT_PLAY_H,
    palette: dict[str, str] | None = None,
) -> _Path:
    """Emit an ASS file directly from user-edited caption lines.

    Line shape (already clip-relative, already grouped):
        { "start": 1.234, "end": 3.456, "text": "the part nobody talks about",
          "words": [{"start": .., "end": .., "text": ".."}]  # optional
        }

    If `words` is present, each gets its own karaoke fill tag (per-word
    highlight). If `words` is missing, the whole line gets one karaoke fill
    spanning the full line duration (no per-word animation, but still picks
    up the style's primary/secondary colors).
    """
    style_key = style if style in _STYLES else "bold_yellow"

    body_events: list[str] = []
    for ln in lines or []:
        try:
            start_s = float(ln.get("start") or 0.0)
            end_s = float(ln.get("end") or 0.0)
        except (TypeError, ValueError):
            continue
        if end_s <= start_s:
            continue

        words = ln.get("words")
        if isinstance(words, list) and words:
            # Per-word karaoke: emit one {\kf<centi>} per word with its own
            # duration. Clamp to line bounds in case the editor leaves slop.
            packed: list[tuple[float, float, str]] = []
            for w in words:
                try:
                    ws = max(start_s, float(w.get("start") or start_s))
                    we = min(end_s, float(w.get("end") or end_s))
                except (TypeError, ValueError):
                    continue
                text = (w.get("text") or w.get("word") or "").strip()
                if not text or we <= ws:
                    continue
                packed.append((ws, we, text))
            if packed:
                body_events.append(_dialogue_for_line(packed))
                continue

        # No word data → render the whole line as a single karaoke unit.
        whole_text = (ln.get("text") or "").strip()
        if not whole_text:
            continue
        body_events.append(_dialogue_for_line([(start_s, end_s, whole_text)]))

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
        f"{_build_style_line(style_key, palette)}\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(header + "\n".join(body_events) + "\n", encoding="utf-8")
    return out_path


def bake_captions_to_video(
    clip_path: _Path,
    lines: list[dict[str, Any]],
    *,
    style: str = "brand_fuchsia",
    out_path: _Path | None = None,
    canvas_w: int = DEFAULT_PLAY_W,
    canvas_h: int = DEFAULT_PLAY_H,
    palette: dict[str, str] | None = None,
) -> _Path:
    """Burn caption `lines` into `clip_path` using the named style.

    Defaults to ATOMIC REPLACE — writes to a sibling `.editing.mp4`, then
    `os.replace`s into `clip_path`. Pass `out_path` to write somewhere else
    and keep the original.

    Returns the path of the written file (clip_path on atomic replace).
    """
    clip_path = _Path(clip_path)
    if not clip_path.is_file():
        raise FileNotFoundError(f"clip not found: {clip_path}")

    ass_path = clip_path.with_name(clip_path.stem + ".edit.ass")
    target = out_path if out_path is not None else clip_path.with_name(
        f".{clip_path.stem}.editing{clip_path.suffix}"
    )

    # Track files we created so we can scrub them on either path. The .ass file
    # always gets removed (was a transient artefact for ffmpeg). The .editing
    # temp only sticks around on the out_path-supplied branch or on failure;
    # on the atomic-replace branch we want it gone after os.replace anyway
    # (the rename moves it, so the original path no longer exists — but the
    # try/finally still guards against a half-written file on ffmpeg failure
    # for an out_path that points at an explicit destination).
    bake_ok = False
    ass_text_snapshot = ""
    try:
        generate_ass_from_lines(
            lines,
            ass_path,
            style=style,
            canvas_w=canvas_w,
            canvas_h=canvas_h,
            palette=palette,
        )
        # Snapshot the ASS file BEFORE the finally-block unlinks it so the
        # sidecar can hand it back to the desktop's libass-wasm overlay
        # without us shipping a transient path. Same data, no per-clip disk
        # pollution.
        try:
            ass_text_snapshot = ass_path.read_text(encoding="utf-8")
        except OSError:
            ass_text_snapshot = ""

        cmd = [
            _ffmpeg_bin(), "-nostdin", "-hide_banner",
            "-loglevel", "error", "-y",
            "-i", str(clip_path),
            "-vf", _ass_filter_arg(ass_path),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(target),
        ]
        proc = _subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            # Surface ffmpeg's stderr so the sidecar can show it to the user.
            raise RuntimeError(
                f"ffmpeg caption bake failed for {clip_path.name}: "
                f"{proc.stderr.strip()[:400]}"
            )

        if out_path is None:
            # Atomic swap onto the original file.
            _os.replace(target, clip_path)
            result = clip_path
        else:
            result = target
        bake_ok = True
        # Stash the ASS text on the returned Path so the sidecar wrapper can
        # surface it without a second function signature. Path subclassing
        # would be the cleaner shape — for now we lean on the caller asking
        # for it via a sibling helper (`last_baked_ass_text`) instead.
        _LAST_BAKED_ASS["text"] = ass_text_snapshot
        return result
    finally:
        # Always scrub the .ass transient artefact (per-clip pollution).
        try:
            ass_path.unlink(missing_ok=True)
        except OSError:
            pass
        # On failure path, scrub the partial .editing.mp4 temp if it leaked.
        # On atomic-replace success, the target was moved onto clip_path so
        # the path no longer exists — unlink(missing_ok) is a no-op.
        if not bake_ok and out_path is None:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
