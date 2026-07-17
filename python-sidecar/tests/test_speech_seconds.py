"""Phase B · speech-seconds computation + content hashing (2026-07-17)."""
from __future__ import annotations

import hashlib
import os
import tempfile

import pytest

from stages import (
    compute_source_content_hash,
    compute_speech_seconds,
    compute_transcript_hash,
)


# ─────────────────────────────────────────────────────────────────────
# compute_speech_seconds
# ─────────────────────────────────────────────────────────────────────

def test_speech_seconds_sums_segment_durations():
    transcript = {
        "segments": [
            {"start": 0.0, "end": 12.5, "text": "hello"},
            {"start": 15.0, "end": 30.0, "text": "world"},
            {"start": 60.0, "end": 120.0, "text": "long"},
        ]
    }
    # 12.5 + 15 + 60 = 87.5 → round to 88
    assert compute_speech_seconds(transcript) == 88


def test_speech_seconds_ignores_negative_deltas():
    """Whisper occasionally emits end < start on empty/VAD segments.
    Those must not deduct from the total."""
    transcript = {
        "segments": [
            {"start": 5.0, "end": 3.0, "text": ""},   # negative
            {"start": 10.0, "end": 20.0, "text": "real"},
        ]
    }
    assert compute_speech_seconds(transcript) == 10


def test_speech_seconds_handles_missing_fields():
    transcript = {"segments": [{"text": "no-timings"}]}
    assert compute_speech_seconds(transcript) == 0
    assert compute_speech_seconds({"segments": []}) == 0
    assert compute_speech_seconds({}) == 0


# ─────────────────────────────────────────────────────────────────────
# compute_transcript_hash
# ─────────────────────────────────────────────────────────────────────

def test_transcript_hash_is_deterministic():
    a = {"segments": [{"start": 0, "end": 5, "text": "hello"}]}
    b = {"segments": [{"start": 0, "end": 5, "text": "hello"}]}
    assert compute_transcript_hash(a) == compute_transcript_hash(b)


def test_transcript_hash_differs_when_timings_change():
    a = {"segments": [{"start": 0, "end": 5, "text": "hello"}]}
    b = {"segments": [{"start": 0, "end": 6, "text": "hello"}]}
    assert compute_transcript_hash(a) != compute_transcript_hash(b)


def test_transcript_hash_ignores_json_key_order():
    """Two Whisper runs may serialise with different key order but
    yield the same segments — hash must be identical."""
    a = {"segments": [{"start": 0, "end": 5, "text": "hi"}]}
    b = {"segments": [{"end": 5, "text": "hi", "start": 0}]}
    assert compute_transcript_hash(a) == compute_transcript_hash(b)


def test_transcript_hash_is_valid_sha256_hex():
    h = compute_transcript_hash({"segments": [{"start": 0, "end": 1, "text": "a"}]})
    assert len(h) == 64
    int(h, 16)  # raises if not hex


# ─────────────────────────────────────────────────────────────────────
# compute_source_content_hash
# ─────────────────────────────────────────────────────────────────────

def test_source_hash_matches_sha256_of_file(tmp_path):
    data = b"the quick brown fox jumps over the lazy dog"
    f = tmp_path / "src.bin"
    f.write_bytes(data)
    assert compute_source_content_hash(str(f)) == hashlib.sha256(data).hexdigest()


def test_source_hash_streams_large_file(tmp_path):
    """Multiple chunks · a 12MB file (small integer-multiple of the
    4MB chunk) must hash identically to a whole-file digest."""
    data = os.urandom(12 * 1024 * 1024)
    f = tmp_path / "big.bin"
    f.write_bytes(data)
    expected = hashlib.sha256(data).hexdigest()
    assert compute_source_content_hash(str(f)) == expected
