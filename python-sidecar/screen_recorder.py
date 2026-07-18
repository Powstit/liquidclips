"""Screen recorder (Composer D · Reaction Record mode).

⚠ IRON GATE IG-COMPOSER-JJ · Sidecar screen recorder + merge contract.

Reuses stages.ffmpeg_bin (bundled ffmpeg 6.x) via a LONG-RUNNING Popen
process. Distinct from `run_ffmpeg` in stages.py which is a synchronous
one-shot; recording sessions need to stay alive between the client's
start and stop RPC calls.

Session map (`_SESSIONS`) keys are opaque UUIDs the client passes back
to stop. On stop we send SIGINT so ffmpeg writes a valid mp4 trailer,
then wait up to 10 s for graceful shutdown before SIGKILL.

Live merge (`merge_reaction_recording`) is a separate one-shot: given
a screen file + camera file + a layout key from CockpitSettings, it
composes a vertical 9:16 output using the same intelligent
scale/crop pattern the export stage already uses for reaction PIP.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any


_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSIONS_LOCK = threading.Lock()


def _ffmpeg_bin() -> str:
    """Resolve the bundled ffmpeg. Delegates to stages.ffmpeg_bin so the
    resolver logic (PyInstaller bundle path · PATH fallback) stays in
    one place."""
    from stages import ffmpeg_bin
    return ffmpeg_bin()


def _validate_output_path(raw: object) -> Path:
    """Ensure a client-supplied output path is under a safe writable
    directory and does not attempt path traversal. Callers get a
    ValueError on bad input which the sidecar dispatcher converts to a
    JSON-RPC error the client can surface."""
    if not isinstance(raw, str) or not raw:
        raise ValueError("output_path must be a non-empty string")
    path = Path(raw).expanduser().resolve()
    # Allow AppData / project / temp roots. Reject anything with '..'
    # or that escapes the caller's home.
    if ".." in Path(raw).parts:
        raise ValueError("output_path must not contain '..'")
    if not path.suffix.lower() in {".mp4", ".mov"}:
        raise ValueError("output_path suffix must be .mp4 or .mov")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def start_screen_recording(
    output_path: object,
    screen_index: object = 1,
    audio_index: object | None = None,
    fps: object = 30,
) -> dict[str, Any]:
    """Start a long-running ffmpeg avfoundation subprocess.

    Args
    ----
    output_path : path under user home / AppData · .mp4 or .mov
    screen_index : avfoundation video device index (usually 1 for main display)
    audio_index : optional avfoundation audio index · None → no audio track
    fps : capture framerate (default 30 · matches TikTok/Reels/Shorts)

    Returns
    -------
    { session_id, pid, output_path, started_at_ms }
    """
    output = _validate_output_path(output_path)
    if not isinstance(screen_index, int) or screen_index < 0 or screen_index > 8:
        raise ValueError("screen_index out of range")
    if audio_index is not None and (not isinstance(audio_index, int) or audio_index < 0 or audio_index > 32):
        raise ValueError("audio_index out of range")
    if not isinstance(fps, int) or fps < 15 or fps > 60:
        raise ValueError("fps must be 15..60")

    device_spec = (
        f"{screen_index}:{audio_index}"
        if audio_index is not None
        else f"{screen_index}:none"
    )
    cmd = [
        _ffmpeg_bin(),
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "avfoundation",
        "-framerate", str(fps),
        "-capture_cursor", "1",
        "-i", device_spec,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
    ]
    if audio_index is not None:
        cmd += ["-c:a", "aac", "-b:a", "128k"]
    cmd.append(str(output))

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        shell=False,
    )
    session_id = f"rec_{uuid.uuid4().hex[:12]}"
    started_at_ms = int(time.time() * 1000)
    with _SESSIONS_LOCK:
        _SESSIONS[session_id] = {
            "proc": proc,
            "output_path": str(output),
            "started_at_ms": started_at_ms,
        }
    return {
        "session_id": session_id,
        "pid": proc.pid,
        "output_path": str(output),
        "started_at_ms": started_at_ms,
    }


def stop_screen_recording(session_id: object, grace_seconds: object = 10.0) -> dict[str, Any]:
    """Send SIGINT so ffmpeg writes the mp4 trailer, wait for exit,
    escalate to SIGKILL on grace timeout. Removes the session from the
    map either way."""
    if not isinstance(session_id, str) or not session_id:
        raise ValueError("session_id must be a non-empty string")
    if not isinstance(grace_seconds, (int, float)) or grace_seconds <= 0:
        raise ValueError("grace_seconds must be positive")
    with _SESSIONS_LOCK:
        session = _SESSIONS.pop(session_id, None)
    if session is None:
        raise ValueError(f"unknown session_id: {session_id}")
    proc: subprocess.Popen = session["proc"]
    output_path = session["output_path"]
    started_at_ms = session["started_at_ms"]

    try:
        proc.send_signal(signal.SIGINT)
    except ProcessLookupError:
        # Already exited · fall through to size check.
        pass

    try:
        proc.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        proc.wait(timeout=2.0)

    ended_at_ms = int(time.time() * 1000)
    size = 0
    try:
        size = Path(output_path).stat().st_size
    except OSError:
        pass

    return {
        "session_id": session_id,
        "output_path": output_path,
        "size_bytes": size,
        "duration_ms": ended_at_ms - started_at_ms,
        "exit_code": proc.returncode if proc.returncode is not None else -1,
    }


def list_avfoundation_devices() -> dict[str, Any]:
    """Enumerate macOS avfoundation devices so the client picker can
    render display + audio input options. Runs `ffmpeg -f avfoundation
    -list_devices true -i ""` and parses the stderr output."""
    cmd = [
        _ffmpeg_bin(),
        "-nostdin",
        "-hide_banner",
        "-f", "avfoundation",
        "-list_devices", "true",
        "-i", "",
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=15,
    )
    lines = (proc.stderr or "").splitlines()
    video: list[dict[str, Any]] = []
    audio: list[dict[str, Any]] = []
    section: str | None = None
    for line in lines:
        low = line.lower()
        if "avfoundation video devices" in low:
            section = "video"
            continue
        if "avfoundation audio devices" in low:
            section = "audio"
            continue
        if section is None:
            continue
        # Lines look like: "[AVFoundation indev @ 0x123] [0] FaceTime HD Camera"
        idx_start = line.find("] [")
        if idx_start < 0:
            continue
        rest = line[idx_start + 3:]
        bracket_end = rest.find("]")
        if bracket_end < 0:
            continue
        try:
            idx = int(rest[:bracket_end].strip())
        except ValueError:
            continue
        name = rest[bracket_end + 1:].strip()
        entry = {"index": idx, "name": name}
        if section == "video":
            video.append(entry)
        elif section == "audio":
            audio.append(entry)
    return {"video": video, "audio": audio}


def merge_reaction_recording(
    screen_path: object,
    camera_path: object,
    layout: object = "top-bottom",
    output_path: object | None = None,
    output_width: object = 1080,
    output_height: object = 1920,
) -> dict[str, Any]:
    """Compose the final MP4 from a screen recording + camera recording.

    Layout keys mirror the ReactionLayoutKey Composer already writes to
    CockpitSettings.reaction.layout so the panel choice flows through
    unchanged.

    * top-bottom  → vstack (screen top, camera bottom)  · TikTok classic
    * side-by-side → hstack (screen left, camera right)
    * grid-2x2    → xstack (screen top-left, camera bottom-right, blanks
                     for the other two cells so users can drop more
                     sources later)
    * pip-tr / tl / br / bl → PIP overlay in the named corner
    * solo         → screen only (camera dropped)

    Intelligent scaling: every input is scaled with
    `force_original_aspect_ratio=increase,crop=W:H` so the source fills
    its half without letterbox or stretch. That matches the sidecar's
    existing reaction render pattern in stages._build_overlay_filter.
    """
    if not isinstance(screen_path, str) or not Path(screen_path).exists():
        raise ValueError("screen_path must be an existing file")
    if not isinstance(camera_path, str) or not Path(camera_path).exists():
        raise ValueError("camera_path must be an existing file")
    if not isinstance(output_width, int) or output_width < 240 or output_width > 4096:
        raise ValueError("output_width out of range")
    if not isinstance(output_height, int) or output_height < 240 or output_height > 4096:
        raise ValueError("output_height out of range")
    if output_path is None:
        out = Path(screen_path).with_name(f"reaction_merged_{uuid.uuid4().hex[:8]}.mp4")
    else:
        out = _validate_output_path(output_path)

    W = output_width
    H = output_height
    half_h = H // 2
    half_w = W // 2

    # P1-1 fix (ship-lens 2026-07-18) · reject unknown layouts loudly
    # instead of silently defaulting to top-bottom. The CockpitContext
    # ReactionLayoutKey union has 9 members; every one must be listed
    # below explicitly. Any drift → ValueError → JSON-RPC error →
    # client sees "unknown layout" instead of a silent-wrong render.
    valid_layouts = {
        "top-bottom", "side-by-side", "grid-2x2",
        "pip-tr", "pip-tl", "pip-br", "pip-bl",
        "solo", "full-overlay",
    }
    if layout not in valid_layouts:
        raise ValueError(f"unknown reaction layout: {layout!r}")

    if layout == "side-by-side":
        filter_complex = (
            f"[0:v]scale={half_w}:{H}:force_original_aspect_ratio=increase,crop={half_w}:{H}[s];"
            f"[1:v]scale={half_w}:{H}:force_original_aspect_ratio=increase,crop={half_w}:{H}[c];"
            f"[s][c]hstack=inputs=2[v]"
        )
    elif layout in ("grid-2x2",):
        filter_complex = (
            f"[0:v]scale={half_w}:{half_h}:force_original_aspect_ratio=increase,crop={half_w}:{half_h}[s];"
            f"[1:v]scale={half_w}:{half_h}:force_original_aspect_ratio=increase,crop={half_w}:{half_h}[c];"
            f"color=c=black:s={half_w}x{half_h}:d=60[b1];"
            f"color=c=black:s={half_w}x{half_h}:d=60[b2];"
            f"[s][c][b1][b2]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v]"
        )
    elif layout in ("pip-tr", "pip-tl", "pip-br", "pip-bl"):
        pip_w = W // 3
        pip_h = H // 3
        margin = 40
        if layout == "pip-tr":
            x = W - pip_w - margin
            y = margin
        elif layout == "pip-tl":
            x = margin
            y = margin
        elif layout == "pip-br":
            x = W - pip_w - margin
            y = H - pip_h - margin
        else:  # pip-bl
            x = margin
            y = H - pip_h - margin
        filter_complex = (
            f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[s];"
            f"[1:v]scale={pip_w}:{pip_h}:force_original_aspect_ratio=increase,crop={pip_w}:{pip_h}[c];"
            f"[s][c]overlay={x}:{y}[v]"
        )
    elif layout == "solo":
        filter_complex = (
            f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[v]"
        )
    elif layout == "full-overlay":
        # ReactionLayoutKey comment: "reaction takes the entire canvas
        # · source ducks under." Camera fills the frame · screen is
        # dropped from the visual (audio still preferred via -map 1:a?).
        # Symmetric with `solo` which drops the camera.
        filter_complex = (
            f"[1:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}[v]"
        )
    else:  # default: top-bottom
        filter_complex = (
            f"[0:v]scale={W}:{half_h}:force_original_aspect_ratio=increase,crop={W}:{half_h}[s];"
            f"[1:v]scale={W}:{half_h}:force_original_aspect_ratio=increase,crop={W}:{half_h}[c];"
            f"[s][c]vstack=inputs=2[v]"
        )

    map_args = ["-map", "[v]"]
    # Prefer camera audio if the camera file has audio; fall back to
    # screen audio otherwise. `-map 1:a?` uses optional map so a
    # missing track doesn't error.
    map_args += ["-map", "1:a?", "-map", "0:a?"]

    cmd = [
        _ffmpeg_bin(),
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(screen_path),
        "-i", str(camera_path),
        "-filter_complex", filter_complex,
        *map_args,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        str(out),
    ]

    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()[-800:]
        raise RuntimeError(f"reaction merge failed: {stderr}")

    size = Path(out).stat().st_size if Path(out).exists() else 0
    return {
        "output_path": str(out),
        "layout": layout,
        "size_bytes": size,
    }
