"""Hybrid transcribe — see ~/Desktop/jnr/transcribe-hybrid.md.

Two endpoints:
  POST /transcribe-stream             — audio-only stream for drag-drop input
  POST /transcribe-stream/from-url    — URL pointer for YouTube / public sources

Both run on Channel+ tiers. The license JWT carries the tier; we 402 on free.

Provider routing:
  - MODAL_TRANSCRIBE_URL env var set     → forward to Modal
  - Else REPLICATE_API_TOKEN env var set → forward to Replicate
  - Else                                   → stub via local faster-whisper

The stub path is the one running today — it lets the desktop wire the
endpoint and validate the full streaming contract before Modal exists.
When you flip MODAL_TRANSCRIBE_URL on Railway, no client change required.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Annotated, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

router = APIRouter(prefix="/transcribe-stream", tags=["transcribe"])


def _provider() -> str:
    if os.environ.get("MODAL_TRANSCRIBE_URL"):
        return "modal"
    if os.environ.get("REPLICATE_API_TOKEN"):
        return "replicate"
    return "stub"


def _require_paid_tier(user: User) -> None:
    from app.features import has_feature
    if not has_feature(user.tier, "hosted_transcribe", founder=user.founder_flag):
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "Hosted transcribe is on Growth, Autopilot, and Founder tiers. Upgrade or use local.",
        )


# --- audio-stream endpoint -------------------------------------------

class TranscribeMetadata(BaseModel):
    duration_seconds: float
    language: str | None = None


@router.post("")
async def transcribe_audio_stream(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],  # noqa: ARG001 — claimed for future usage logging
) -> Response:
    """Accept an opus stream (or wav, multipart). Return transcript JSON.

    For Sprint 5.5 simplicity, this is a single-request multipart POST —
    not yet the speculative-streaming chunked variant. Streaming chunks
    add complexity but the wall-clock win is incremental once Modal warm
    is in place. Defer to Sprint 5.6.
    """
    _require_paid_tier(user)

    content_type = request.headers.get("content-type", "")
    if not content_type.startswith(("audio/", "application/octet-stream", "multipart/form-data")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unexpected content-type: {content_type}")

    body = await request.body()
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty body")

    provider = _provider()
    if provider == "modal":
        transcript = await _transcribe_via_modal(body, content_type)
    elif provider == "replicate":
        transcript = await _transcribe_via_replicate(body, content_type)
    else:
        transcript = await _transcribe_via_stub(body, content_type)

    return Response(
        content=json.dumps(transcript),
        media_type="application/json",
        headers={"X-Junior-Transcribe-Provider": provider},
    )


# --- url-direct endpoint ---------------------------------------------

class UrlTranscribeRequest(BaseModel):
    url: str


@router.post("/from-url")
async def transcribe_from_url(
    body: UrlTranscribeRequest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],  # noqa: ARG001
) -> Response:
    """For public URLs (YouTube etc.) on paid tiers. The Modal worker does
    yt-dlp + transcribe in one shot — desktop sends only the URL pointer."""
    _require_paid_tier(user)

    provider = _provider()
    if provider == "modal":
        transcript = await _transcribe_url_via_modal(body.url)
    else:
        # Stub + replicate both fall through to a local yt-dlp + faster-whisper.
        # That defeats the "no upload" win in production (we'd run yt-dlp on
        # Junior Backend) but proves the contract. Real Modal path is the only
        # one with the real bandwidth + speed advantage.
        transcript = await _transcribe_url_via_stub(body.url)

    return Response(
        content=json.dumps(transcript),
        media_type="application/json",
        headers={"X-Junior-Transcribe-Provider": provider},
    )


# --- providers --------------------------------------------------------

async def _transcribe_via_modal(body: bytes, content_type: str) -> dict:
    url = os.environ["MODAL_TRANSCRIBE_URL"]
    async with httpx.AsyncClient(timeout=600.0) as client:
        resp = await client.post(url, content=body, headers={"content-type": content_type})
        resp.raise_for_status()
        return resp.json()


async def _transcribe_url_via_modal(source_url: str) -> dict:
    base = os.environ["MODAL_TRANSCRIBE_URL"]
    async with httpx.AsyncClient(timeout=600.0) as client:
        resp = await client.post(f"{base}/from-url", json={"url": source_url})
        resp.raise_for_status()
        return resp.json()


async def _transcribe_via_replicate(body: bytes, content_type: str) -> dict:
    # Replicate's Whisper model deployment URL — set at deploy time.
    # Format expected by Replicate is multipart/form-data with `audio` field.
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Replicate failover not wired in this cut.")


async def _transcribe_via_stub(body: bytes, content_type: str) -> dict:
    """Local faster-whisper for the no-MODAL-no-REPLICATE case.

    This is what runs today on your local backend so the desktop can wire
    and exercise the full streaming contract. Production path swaps this
    for Modal with a one-line env var.
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(body)
        tmp_path = tmp.name
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _local_transcribe, tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


async def _transcribe_url_via_stub(source_url: str) -> dict:
    """Local yt-dlp + faster-whisper for the dev path. Not a "no upload" path
    — exists only so the desktop can hit a working endpoint pre-Modal.
    """
    import yt_dlp  # type: ignore
    tmpdir = tempfile.mkdtemp(prefix="junior-stub-yt-")
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(Path(tmpdir) / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(source_url, download=True)
    if not info:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "yt-dlp could not resolve the URL")
    requested = info.get("requested_downloads") or []
    audio_path = requested[0].get("filepath") if requested else None
    if not audio_path or not os.path.isfile(audio_path):
        # ExtractAudio may rewrite the path — fall back to scanning the dir
        candidates = list(Path(tmpdir).glob("*.wav")) + list(Path(tmpdir).glob("*.m4a"))
        if candidates:
            audio_path = str(candidates[0])
    if not audio_path:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "no audio extracted")

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, _local_transcribe, audio_path)
    finally:
        for f in Path(tmpdir).iterdir():
            try:
                f.unlink()
            except OSError:
                pass
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass


def _local_transcribe(audio_path: str) -> dict:
    """Faster-whisper tiny — same engine the desktop sidecar uses for the
    Free tier. Wire format we return matches what Modal will return so
    the desktop's parser doesn't care which side did the work.
    """
    from faster_whisper import WhisperModel
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    segments_list: list[dict] = []
    word_count = 0
    for seg in segments:
        words: list[dict] = []
        if seg.words:
            for w in seg.words:
                words.append({"start": w.start, "end": w.end, "word": w.word, "probability": w.probability})
                word_count += 1
        segments_list.append({
            "id": seg.id,
            "start": seg.start,
            "end": seg.end,
            "text": seg.text.strip(),
            "words": words,
        })

    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "model": "tiny",
        "word_count": word_count,
        "segments": segments_list,
    }
