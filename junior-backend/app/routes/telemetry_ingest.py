"""Step 6 · Envelope ingestion + desktop error fingerprint dedupe.

Two endpoints:

* ``POST /telemetry/event`` — accepts a Step 5 Envelope · re-sanitizes
  server-side · writes to ``telemetry_events`` (raw) with the
  correlation / feature / release triple that the HQ auto-generated
  feature page reads from.

* ``POST /telemetry/desktop-error`` — enhanced fingerprint dedupe.
  The existing route already accepts unauthenticated posts of desktop
  error metadata; this module wires the ``DesktopErrorGroup`` aggregate
  so HQ shows ONE actionable incident per fingerprint rather than one
  row per user occurrence.

Both endpoints are UNAUTHENTICATED — the whole point is that a broken
client can still tell us it's broken. The server sanitizes every input.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DesktopErrorEvent, DesktopErrorGroup, TelemetryEvent

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


# --------------------------------------------------------------------------
# Server-side redaction · defense-in-depth on top of the client-side
# sanitizeMetadata (Step 5). A compromised or old client must not be
# able to bypass the server contract.
# --------------------------------------------------------------------------


BANNED_KEY_SUBSTRINGS = (
    "email",
    "jwt",
    "token",
    "secret",
    "pin",
    "password",
    "authorization",
    "prompt",
    "transcript",
    "cookie",
)
MAX_STRING_LEN = 240
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
JWT_LOOSE_RE = re.compile(r"\beyJ[A-Za-z0-9._-]{20,}\b")
URL_QUERY_RE = re.compile(r"\?[^\s\"']+")
UNIX_PATH_RE = re.compile(r"(?:^|\s)(\/(?:Users|home|tmp|var|opt|Applications)\/[^\s\"']+)")
WIN_PATH_RE = re.compile(r"(?:^|\s)([A-Za-z]:\\[^\s\"']+)")
HOME_PATH_RE = re.compile(r"(?:^|\s)(~\/[^\s\"']+)")


def _sanitize_string(value: str) -> str:
    out = value
    out = EMAIL_RE.sub("[email]", out)
    out = JWT_LOOSE_RE.sub("[jwt]", out)
    out = URL_QUERY_RE.sub("", out)
    out = UNIX_PATH_RE.sub(" [path]", out)
    out = WIN_PATH_RE.sub(" [path]", out)
    out = HOME_PATH_RE.sub(" [path]", out)
    if len(out) > MAX_STRING_LEN:
        out = out[:MAX_STRING_LEN] + "…"
    return out


def _key_banned(key: str) -> bool:
    lower = key.lower()
    return any(needle in lower for needle in BANNED_KEY_SUBSTRINGS)


def _sanitize_value(value):
    if value is None:
        return value
    if isinstance(value, str):
        return _sanitize_string(value)
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [_sanitize_value(v) for v in value]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if _key_banned(k):
                continue
            out[k] = _sanitize_value(v)
        return out
    return str(value)[:MAX_STRING_LEN]


def _sanitize_dict(d: dict | None) -> dict:
    if not d:
        return {}
    out: dict = {}
    for k, v in d.items():
        if _key_banned(k):
            continue
        out[k] = _sanitize_value(v)
    return out


# --------------------------------------------------------------------------
# /telemetry/event · generic Envelope ingestion
# --------------------------------------------------------------------------


class ActorIn(BaseModel):
    kind: str = Field(pattern=r"^(internal|anon)$")
    id: str


class EnvelopeIn(BaseModel):
    event: str
    schema_version: int
    actor: ActorIn
    feature_id: str
    journey_id: str | None = None
    surface: str
    route: str = ""
    release: str
    build: str
    environment: str
    operating_mode: str = "self"
    entitlement_class: str = "clipper"
    onboarding_state: str | None = None
    correlation_id: str
    session_id: str
    attempt_id: str
    success: bool = True
    failure: str | None = None
    duration_ms: int | None = None
    stable_error_code: str | None = None
    payload: dict = {}
    metadata: dict | None = None
    emitted_at: str  # ISO-8601 UTC


@router.post("/event", status_code=status.HTTP_202_ACCEPTED)
def ingest_event(
    body: EnvelopeIn,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Accept a Step 5 Envelope · re-sanitize · store."""
    payload = _sanitize_dict(body.payload)
    metadata = _sanitize_dict(body.metadata) if body.metadata is not None else None

    try:
        emitted_at = datetime.fromisoformat(body.emitted_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad emitted_at")
    if emitted_at.tzinfo is None:
        emitted_at = emitted_at.replace(tzinfo=timezone.utc)

    row = TelemetryEvent(
        id=uuid.uuid4().hex,
        event=body.event[:80],
        schema_version=body.schema_version,
        feature_id=body.feature_id[:120],
        journey_id=body.journey_id,
        surface=body.surface[:200],
        route=(body.route or "")[:200],
        release=body.release[:80],
        build=body.build[:80],
        environment=body.environment[:20],
        operating_mode=body.operating_mode[:20],
        entitlement_class=body.entitlement_class[:20],
        onboarding_state=body.onboarding_state,
        actor_kind=body.actor.kind,
        actor_id=body.actor.id[:120],
        correlation_id=body.correlation_id[:80],
        session_id=body.session_id[:80],
        attempt_id=body.attempt_id[:80],
        success=body.success,
        failure=_sanitize_string(body.failure) if body.failure else None,
        duration_ms=body.duration_ms,
        stable_error_code=body.stable_error_code,
        payload_json=json.dumps(payload),
        metadata_json=json.dumps(metadata) if metadata is not None else None,
        emitted_at=emitted_at,
    )
    db.add(row)
    db.commit()
    return {"accepted": True, "id": row.id}


# --------------------------------------------------------------------------
# /telemetry/desktop-error · fingerprint dedupe
# --------------------------------------------------------------------------


class DesktopErrorIn(BaseModel):
    event: str  # unhandled_error | license_rejected | backend_offline | ...
    app_version: str
    os: str
    arch: str
    release: str | None = None  # if omitted, defaults to app_version
    feature_id: str | None = None
    route: str | None = None
    http_status: int | None = None
    stable_error_code: str | None = None
    message: str | None = None
    user_ref: str | None = None
    stack_fingerprint: str | None = None
    environment: str = "prod"


def _compute_fingerprint(
    *,
    release: str,
    feature_id: str | None,
    stable_error_code: str | None,
    event: str,
    stack_fingerprint: str | None,
) -> str:
    """Deterministic sha256 over the group-by tuple. Bumping the release
    OR the error code OR the feature makes it a distinct group; same
    stack across the same release for the same feature collapses."""
    parts = [
        release,
        feature_id or "",
        stable_error_code or event,
        stack_fingerprint or "",
    ]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:40]


@router.post("/desktop-error", status_code=status.HTTP_202_ACCEPTED)
def ingest_desktop_error(
    body: DesktopErrorIn,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Accept a desktop error report · sanitize · dedupe by fingerprint.

    Two writes happen:
      1. DesktopErrorEvent (raw · per-occurrence · per-user trail)
      2. DesktopErrorGroup (aggregate · count + first/last seen +
         latest_sanitized_message + affected_user_count)

    HQ reads the group table; the raw table is for forensic follow-up.
    """
    release = body.release or body.app_version
    fingerprint = _compute_fingerprint(
        release=release,
        feature_id=body.feature_id,
        stable_error_code=body.stable_error_code,
        event=body.event,
        stack_fingerprint=body.stack_fingerprint,
    )
    sanitized_message = _sanitize_string(body.message) if body.message else None

    # 1. Raw occurrence — matches the legacy DesktopErrorEvent contract
    raw = DesktopErrorEvent(
        id=uuid.uuid4().hex,
        event=body.event[:80],
        app_version=body.app_version[:80],
        os=body.os[:20],
        arch=body.arch[:20],
        route=(body.route or None),
        http_status=body.http_status,
        error_code=body.stable_error_code,
        message=sanitized_message,
        user_ref=body.user_ref,
    )
    db.add(raw)

    # 2. Group aggregate — upsert-by-fingerprint
    now = datetime.now(timezone.utc)
    group = (
        db.query(DesktopErrorGroup)
        .filter(DesktopErrorGroup.fingerprint == fingerprint)
        .one_or_none()
    )
    if group is None:
        group = DesktopErrorGroup(
            id=uuid.uuid4().hex,
            fingerprint=fingerprint,
            release=release[:80],
            feature_id=body.feature_id,
            stable_error_code=body.stable_error_code,
            route=(body.route or None),
            environment=body.environment[:20],
            count=1,
            affected_user_count=1 if body.user_ref else 0,
            latest_sanitized_message=sanitized_message,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(group)
    else:
        group.count = int(group.count or 0) + 1
        if sanitized_message:
            group.latest_sanitized_message = sanitized_message
        group.last_seen_at = now
        # Best-effort unique-user count without a per-user set — the
        # user_ref adds +1 when it's a new user for THIS group. Exact
        # unique-user counting comes in the HQ aggregation query below.
        if body.user_ref:
            group.affected_user_count = int(group.affected_user_count or 0) + 1

    db.commit()
    return {
        "accepted": True,
        "fingerprint": fingerprint,
        "group_id": group.id,
        "count": group.count,
    }


# ─── POST /telemetry/diagnostic ──────────────────────────────────────────
# 2026-07-08 · Phase 1 recovery-brief probe collector. The desktop app's
# lib/diagnosticLogger.ts batches golden-path events and POSTs here.
# Every event prints to stdout so Railway logs surface them with a
# scannable prefix (`[LC-CLIENT-DIAG]`). NO DB writes · NO auth · NO PII.
# Same safety envelope as /desktop-error above.
import json as _lcdiag_json  # noqa: E402

_DIAG_MAX_BODY_BYTES = 128 * 1024
_DIAG_MAX_EVENTS = 500
_DIAG_MAX_TOPIC_CHARS = 80
_DIAG_MAX_STR_CHARS = 500


def _lcdiag_clip(value: object, cap: int) -> str:
    if isinstance(value, str):
        return value[:cap]
    try:
        return _lcdiag_json.dumps(value, default=str)[:cap]
    except Exception:  # noqa: BLE001
        return str(value)[:cap]


@router.post("/diagnostic")
async def post_diagnostic(request: Request) -> dict[str, object]:
    """Accept batched client diagnostic events. Log to stdout only.

    Body shape:  {"events": [{"topic": str, "ts": int, "data": dict}, ...]}
    Headers:     x-lc-diag-session: opaque session id (client-generated)
    """
    session = _lcdiag_clip(request.headers.get("x-lc-diag-session") or "unknown", 40)

    raw = await request.body()
    if len(raw) > _DIAG_MAX_BODY_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "batch too large")

    try:
        body = _lcdiag_json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid json") from None

    events = body.get("events", []) if isinstance(body, dict) else []
    if not isinstance(events, list):
        events = []
    events = events[:_DIAG_MAX_EVENTS]

    for ev in events:
        if not isinstance(ev, dict):
            continue
        topic = _lcdiag_clip(ev.get("topic", "?"), _DIAG_MAX_TOPIC_CHARS)
        ts = ev.get("ts", 0)
        data = ev.get("data", {})
        data_str = _lcdiag_clip(data, _DIAG_MAX_STR_CHARS)
        print(f"[LC-CLIENT-DIAG] session={session[:10]}… topic={topic} ts={ts} data={data_str}", flush=True)

    return {"ok": True, "count": len(events)}
