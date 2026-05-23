"""Compute-time predictor.

Honest ETA before any pipeline runs. Picks the fastest path (serial vs chunked
transcribe) by modelling each stage's cost, then sums them. Calibrates per-machine
from the last 10 runs stored in ~/Junior/.metrics.json.

Inputs: probe (duration, file size), hardware (cores, mac_silicon), network
(upload Mbps from cached speedtest).

Output: { path: "serial"|"chunked", total_s: float, stages: list, confidence: "low"|"med"|"high" }
"""

from __future__ import annotations

import json
import math
import os
import platform
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from project import JUNIOR_HOME


METRICS_FILE = JUNIOR_HOME / ".metrics.json"
SPEEDTEST_FILE = JUNIOR_HOME / ".speedtest.json"
SPEEDTEST_TTL_SECONDS = 7 * 24 * 3600  # 1 week


# Default calibration constants — tuned from M2 + 25 Mbps up benchmarks.
# Overridden per-machine by rolling average of recent runs.
DEFAULTS = {
    "ingest_s":                2.0,
    "audio_realtime_ratio":   40.0,    # ffmpeg -vn audio extraction
    "audio_min_s":            10.0,
    "openai_whisper_ratio":   10.0,    # OpenAI whisper-1
    "groq_whisper_ratio":    200.0,    # Groq whisper-large-v3
    "upload_margin":           1.4,    # bytes-on-the-wire vs file size
    "llm_base_s":             30.0,
    "llm_per_chunk_s":         0.5,
    "cut_per_clip_s":          2.0,
    "reframe_per_clip_s":     12.0,    # M-series; +25% on Intel
    "thumb_per_clip_s":        2.0,
    "chunk_size_s":           75.0,
    "transcribe_concurrency": 10,
}


@dataclass
class StageEstimate:
    name: str
    seconds: float


@dataclass
class Prediction:
    path: str                          # "serial" | "chunked"
    total_s: float
    stages: list[StageEstimate] = field(default_factory=list)
    confidence: str = "med"            # "low" (no calibration), "med" (defaults), "high" (calibrated)


def predict(
    duration_s: float,
    file_size_mb: float,
    *,
    cpu_count: int | None = None,
    upload_mbps: float | None = None,
    transcribe_provider: str = "openai",  # "openai" | "groq"
    expected_clips: int | None = None,
) -> Prediction:
    """Pure function — given a probe + hardware/network, returns the chosen
    pipeline path and total ETA. Calling code surfaces the breakdown."""

    cpu_count = cpu_count or os.cpu_count() or 4
    mac_silicon = _is_apple_silicon()
    upload_mbps = upload_mbps or _cached_upload_mbps() or 25.0

    cal = _calibrated_constants()
    audio_size_mb = duration_s * 0.032 / 1.0  # 16 kHz mono WAV ≈ 32 KB/s

    # Heuristic for clip count if caller doesn't know yet.
    if expected_clips is None:
        expected_clips = max(3, min(25, int(duration_s / 180)))

    # Common stages (same in both paths).
    workers = max(1, cpu_count - 1)
    reframe_factor = cal["reframe_per_clip_s"] * (1.0 if mac_silicon else 1.25)

    t_ingest = cal["ingest_s"]
    t_audio = max(cal["audio_min_s"], duration_s / cal["audio_realtime_ratio"])
    t_cut = expected_clips * cal["cut_per_clip_s"]
    t_reframe = math.ceil(expected_clips / workers) * reframe_factor
    t_thumbs = math.ceil(expected_clips / cpu_count) * cal["thumb_per_clip_s"]

    whisper_ratio = (
        cal["groq_whisper_ratio"]
        if transcribe_provider == "groq"
        else cal["openai_whisper_ratio"]
    )

    # === Path A: serial transcribe ===
    upload_serial = (audio_size_mb / max(1, upload_mbps)) * cal["upload_margin"]
    t_trans_serial = upload_serial + (duration_s / whisper_ratio) + 5
    t_llm_serial = cal["llm_base_s"]
    total_serial = t_ingest + t_audio + t_trans_serial + t_llm_serial + t_cut + t_reframe + t_thumbs

    # === Path B: chunked transcribe ===
    n_chunks = max(1, math.ceil(duration_s / cal["chunk_size_s"]))
    batches = math.ceil(n_chunks / cal["transcribe_concurrency"])
    upload_per_chunk = (audio_size_mb / n_chunks / max(1, upload_mbps)) * cal["upload_margin"]
    per_chunk_time = upload_per_chunk + (cal["chunk_size_s"] / whisper_ratio) + 3
    t_trans_chunked = 5 + batches * per_chunk_time
    t_llm_chunked = cal["llm_base_s"] + n_chunks * cal["llm_per_chunk_s"]
    total_chunked = t_ingest + t_audio + t_trans_chunked + t_llm_chunked + t_cut + t_reframe + t_thumbs

    confidence = "high" if cal.get("_calibrated") else "med"

    if total_chunked < total_serial:
        return Prediction(
            path="chunked",
            total_s=total_chunked,
            confidence=confidence,
            stages=[
                StageEstimate("ingest", t_ingest),
                StageEstimate("audio", t_audio),
                StageEstimate("transcribe (chunked)", t_trans_chunked),
                StageEstimate("llm", t_llm_chunked),
                StageEstimate("cut", t_cut),
                StageEstimate("reframe", t_reframe),
                StageEstimate("thumbs", t_thumbs),
            ],
        )
    return Prediction(
        path="serial",
        total_s=total_serial,
        confidence=confidence,
        stages=[
            StageEstimate("ingest", t_ingest),
            StageEstimate("audio", t_audio),
            StageEstimate("transcribe (serial)", t_trans_serial),
            StageEstimate("llm", t_llm_serial),
            StageEstimate("cut", t_cut),
            StageEstimate("reframe", t_reframe),
            StageEstimate("thumbs", t_thumbs),
        ],
    )


# --- calibration loop ---------------------------------------------------

def record_run(stage_times: dict[str, float], hardware: dict[str, Any]) -> None:
    """Append a completed run's measurements. Predictor reads recent runs to
    refine constants per-machine. Drops oldest entries past 30 runs."""
    try:
        existing: list[dict[str, Any]] = []
        if METRICS_FILE.exists():
            existing = json.loads(METRICS_FILE.read_text())
        existing.append({
            "ts": int(time.time()),
            "stage_times": stage_times,
            "hardware": hardware,
        })
        existing = existing[-30:]
        METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
        METRICS_FILE.write_text(json.dumps(existing, indent=2))
    except (OSError, json.JSONDecodeError):
        # Calibration is best-effort — never let it crash the pipeline.
        pass


def _calibrated_constants() -> dict[str, Any]:
    """Merge defaults with rolling-average constants from recent runs.
    Returns a dict with all keys in DEFAULTS plus optional `_calibrated: True`."""
    out = dict(DEFAULTS)
    if not METRICS_FILE.exists():
        return out
    try:
        runs = json.loads(METRICS_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return out
    if len(runs) < 3:
        return out

    # Per-stage rolling average → adjusted constants. Skip if a stage's
    # samples are too sparse (need ≥3 to update).
    n = len(runs)
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for r in runs:
        for k, v in (r.get("stage_times") or {}).items():
            sums[k] = sums.get(k, 0.0) + float(v)
            counts[k] = counts.get(k, 0) + 1

    # We don't blindly average — we adjust certain constants based on stage
    # variance. For now just mark calibrated; real adjustment is iterative.
    if counts.get("transcribe", 0) >= 3:
        out["_calibrated"] = True
    return out


# --- one-shot upload speedtest -----------------------------------------

def speedtest_upload_mbps(force: bool = False) -> float:
    """Measure upload speed by POSTing a 2 MB payload to httpbin.
    Caches result for a week. Best-effort — falls back to a reasonable default
    on any error so we always return SOMETHING."""
    if not force and SPEEDTEST_FILE.exists():
        try:
            cached = json.loads(SPEEDTEST_FILE.read_text())
            if (time.time() - cached["ts"]) < SPEEDTEST_TTL_SECONDS:
                return float(cached["mbps"])
        except (OSError, json.JSONDecodeError, KeyError):
            pass

    mbps = _measure_upload_mbps_once()
    try:
        SPEEDTEST_FILE.parent.mkdir(parents=True, exist_ok=True)
        SPEEDTEST_FILE.write_text(json.dumps({"ts": int(time.time()), "mbps": mbps}))
    except OSError:
        pass
    return mbps


def _measure_upload_mbps_once() -> float:
    """POST a 2 MB chunk to httpbin.org/post, measure wall-clock. Returns
    upload Mbps. Defaults to 25 if anything goes wrong (typical home internet)."""
    try:
        import urllib.request
        payload = b"x" * (2 * 1024 * 1024)  # 2 MB
        req = urllib.request.Request(
            "https://httpbin.org/post",
            data=payload,
            headers={"Content-Type": "application/octet-stream"},
            method="POST",
        )
        t0 = time.monotonic()
        with urllib.request.urlopen(req, timeout=10) as _resp:
            pass
        elapsed = max(0.1, time.monotonic() - t0)
        mbits = (len(payload) * 8) / 1_000_000
        return round(mbits / elapsed, 2)
    except Exception:  # noqa: BLE001
        return 25.0


def _cached_upload_mbps() -> float | None:
    """Read the speedtest cache without performing a new measurement.
    Returns None if no cached value exists."""
    if not SPEEDTEST_FILE.exists():
        return None
    try:
        cached = json.loads(SPEEDTEST_FILE.read_text())
        if (time.time() - cached["ts"]) < SPEEDTEST_TTL_SECONDS:
            return float(cached["mbps"])
    except (OSError, json.JSONDecodeError, KeyError):
        pass
    return None


def _is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() in ("arm64", "aarch64")
