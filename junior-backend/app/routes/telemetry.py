"""Desktop error telemetry — metadata-only collector.

The Junior desktop app POSTs sanitized error metadata here so production
failures are visible in Admin HQ → Bugs without users having to report them.

Why NO auth: the whole point is to receive reports even when the license JWT is
rejected (`license_rejected`) or the desktop thinks the backend is unreachable
(`backend_offline`). Gating this behind auth would silence exactly the failures
we most need to see. To keep an unauthenticated, unkeyed endpoint safe we:

  - accept METADATA ONLY and cap the body at ~8KB (it is not a log sink),
  - SANITIZE the free-text `message` (truncate, redact emails, collapse
    whitespace) before storing,
  - clip every over-long string field to a sane bound,
  - store NO secrets, JWTs, tokens, or file paths (the contract carries none;
    `message` is sanitized; `user_ref` is an internal id only),
  - never 500 a well-formed request — storage is best-effort and a write
    failure still returns {"ok": true}.

This module adds NO billing/payment logic and touches no entitlement state.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DesktopErrorEvent

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


# --- limits ------------------------------------------------------------
# This is a metadata endpoint, not a log shipper. Keep bounds tight.
MAX_BODY_BYTES = 8 * 1024          # reject anything larger — it's metadata
MAX_MESSAGE_CHARS = 300            # sanitized free-text message bound
MAX_FIELD_CHARS = 200             # short scalar fields (event/route/code/version/os/arch)


# Redact anything that looks like an email so the message never leaks PII.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_WHITESPACE_RE = re.compile(r"\s+")


def _sanitize_message(value: str | None) -> str | None:
    """Truncate to ~300 chars, redact emails, collapse whitespace. Returns None
    for empty/blank input. Never raises — sanitization must not break a report."""
    if value is None:
        return None
    try:
        text = str(value)
    except Exception:  # noqa: BLE001 — defensive; never break on weird input
        return None
    text = _EMAIL_RE.sub("[email]", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if not text:
        return None
    if len(text) > MAX_MESSAGE_CHARS:
        text = text[: MAX_MESSAGE_CHARS - 1].rstrip() + "…"  # ellipsis
    return text


def _clip(value: str | None, limit: int = MAX_FIELD_CHARS) -> str | None:
    """Clip an over-long short string field; collapse whitespace; None if blank."""
    if value is None:
        return None
    try:
        text = str(value)
    except Exception:  # noqa: BLE001
        return None
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if not text:
        return None
    return text[:limit]


def _coerce_int(value: object) -> int | None:
    """Best-effort int coercion for http_status; tolerate strings, drop garbage."""
    if value is None:
        return None
    if isinstance(value, bool):  # bool is an int subclass — reject silently
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


class DesktopErrorIn(BaseModel):
    """Matches the desktop contract exactly. All fields optional at the schema
    level so a partial/garbled report still parses — we enforce `event` and
    sanitize in the handler rather than 422-ing telemetry."""

    model_config = ConfigDict(extra="ignore")  # ignore any stray keys the desktop adds

    event: str | None = None
    app_version: str | None = None
    os: str | None = None
    arch: str | None = None
    route: str | None = None
    http_status: int | None = None
    error_code: str | None = None
    message: str | None = None
    user_ref: str | None = None


@router.post("/desktop-error")
async def desktop_error(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Ingest one sanitized desktop error event. NO auth by design (see module
    docstring). Returns {"ok": true} on success. 400 only if `event` is missing;
    413 if the body exceeds the metadata size cap. Storage is best-effort — a DB
    write failure is swallowed and still returns ok so the desktop never retries
    a storm of reports against a struggling backend."""
    # Read the raw body ourselves so we can size-gate BEFORE parsing/validating.
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "telemetry body too large — this endpoint accepts metadata only",
        )

    # Parse defensively. Bad JSON / non-object → treat as a missing-event 400.
    import json

    try:
        parsed = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "event is required")
    if not isinstance(parsed, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "event is required")

    payload = DesktopErrorIn.model_validate(parsed)

    event = _clip(payload.event)
    if not event:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "event is required")

    row = DesktopErrorEvent(
        event=event,
        # Defaulted to "unknown" so the NOT NULL columns are always satisfied
        # even from a sparse report; better a labelled-unknown than a dropped row.
        app_version=_clip(payload.app_version) or "unknown",
        os=_clip(payload.os) or "unknown",
        arch=_clip(payload.arch) or "unknown",
        route=_clip(payload.route),
        http_status=_coerce_int(payload.http_status),
        error_code=_clip(payload.error_code),
        message=_sanitize_message(payload.message),
        user_ref=_clip(payload.user_ref),
    )

    # Best-effort store — never 500 a well-formed request. If the DB write fails
    # we still report ok (the desktop must not loop-retry into a degraded backend).
    try:
        db.add(row)
        db.commit()
    except Exception:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return {"ok": True, "stored": False}

    return {"ok": True}


# ─── /telemetry/diagnostic ───────────────────────────────────────────────
# 2026-07-08 · Phase 1 recovery-brief probe collector. The desktop app's
# lib/diagnosticLogger.ts batches every golden-path event and POSTs to
# this route. We log every event to stdout so Railway logs surface them
# (prefix `[LC-CLIENT-DIAG]` so `railway logs | grep LC-CLIENT-DIAG`
# is the single audit surface).
#
# NO DB writes · NO auth · NO PII stored. Same safety envelope as the
# /desktop-error route above.
import json as _json
import logging as _logging

_diag_logger = _logging.getLogger("junior.client-diag")

_DIAG_MAX_BODY_BYTES = 128 * 1024   # 128KB · client batches ≤500 events every 2s
_DIAG_MAX_EVENTS = 500
_DIAG_MAX_TOPIC_CHARS = 80
_DIAG_MAX_STR_CHARS = 500


def _clip_str(s: object, cap: int) -> str:
    """Clip any value to at most `cap` chars. Non-string values are JSON-encoded."""
    if isinstance(s, str):
        return s[:cap]
    try:
        return _json.dumps(s, default=str)[:cap]
    except Exception:  # noqa: BLE001
        return str(s)[:cap]


@router.post("/diagnostic")
async def post_diagnostic(request: Request) -> dict[str, object]:
    """Accept batched client diagnostic events. Log to stdout only.

    Body shape:
        {"events": [{"topic": str, "ts": int, "data": dict}, ...]}

    Headers:
        x-lc-diag-session: opaque session id (client-generated)
    """
    session = _clip_str(request.headers.get("x-lc-diag-session") or "unknown", 40)

    raw = await request.body()
    if len(raw) > _DIAG_MAX_BODY_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "diagnostic batch too large")

    try:
        body = _json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid json") from None

    events = body.get("events", []) if isinstance(body, dict) else []
    if not isinstance(events, list):
        events = []
    events = events[:_DIAG_MAX_EVENTS]

    for ev in events:
        if not isinstance(ev, dict):
            continue
        topic = _clip_str(ev.get("topic", "?"), _DIAG_MAX_TOPIC_CHARS)
        ts = ev.get("ts", 0)
        data = ev.get("data", {})
        # Serialize data as compact JSON so grep on Railway logs is clean
        data_str = _clip_str(data, _DIAG_MAX_STR_CHARS)
        # Print with stdout flush so Railway's log stream picks it up in near-real-time
        print(f"[LC-CLIENT-DIAG] session={session[:10]}… topic={topic} ts={ts} data={data_str}", flush=True)

    return {"ok": True, "count": len(events)}
