"""LCOS event persistence · RC1 Train B3 (2026-07-12).

BC-005 class-elimination target — the existing ``POST /telemetry/diagnostic``
endpoint logs every lcDiag event to stdout ONLY. Doctor Full and the HQ
LcosEventsTab had no queryable store, so INV-011 transition proofs
could not be verified against real event data.

This router provides the durable mirror:

* ``POST /lcos/events/ingest`` — public / unauthenticated. Accepts one
  event ``{ topic, payload, ts_ms, source_sha?, session_id? }``. Writes
  to the ``lcos_event`` table. Idempotency: ``(topic, ts_ms, hash(payload))``
  is UNIQUE, so re-flushed batches during transient network failures
  dedupe at INSERT-time. Returns ``202`` on the first accept, ``200`` on
  a duplicate.

* ``GET /lcos/events`` — admin-only. Filters ``topic``, ``since``,
  ``until``, ``session_id``. Paginated (``limit`` ≤ 200, ``offset``).

* ``GET /lcos/events/topics`` — admin-only. Returns distinct topic
  names + row counts + last-seen timestamp — powers the HQ topic-
  dropdown filter.

Admin gate reuses the ``x-internal-secret`` + ``is_admin_email`` pattern
that every other ``/admin/*`` route wires; the same gate the
``account-app`` proxy already routes through.

Frontend contract note: this router NEVER renames existing telemetry
topics. The persistence layer stores whatever ``topic`` string the
client sent, one-for-one.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret
from app.features import is_admin_email
from app.models import LcosEvent, User


# ---------------------------------------------------------------------
# Routers — split so the ingestion path (unauthenticated) is separately
# reasoned about from the admin query path.
# ---------------------------------------------------------------------


router = APIRouter(prefix="/lcos/events", tags=["lcos-events"])
admin_router = APIRouter(prefix="/admin/lcos-events", tags=["lcos-events-admin"])


# ---------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------


_MAX_TOPIC_LEN = 120
_MAX_SESSION_LEN = 80
_MAX_SHA_LEN = 40
_MAX_PAYLOAD_BYTES = 32 * 1024  # 32 KiB per event


class IngestIn(BaseModel):
    topic: str = Field(min_length=1, max_length=_MAX_TOPIC_LEN)
    payload: dict = Field(default_factory=dict)
    ts_ms: int = Field(ge=0)
    source_sha: str | None = Field(default=None, max_length=_MAX_SHA_LEN)
    session_id: str | None = Field(default=None, max_length=_MAX_SESSION_LEN)


def _canonical_payload(payload: dict) -> str:
    """Deterministic JSON encoding for idempotency hashing.

    ``sort_keys=True`` + ``separators`` = same input → same string,
    regardless of dict key order at the client.
    """
    try:
        return json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            default=str,
        )
    except Exception:  # noqa: BLE001
        return "{}"


def _payload_hash(canonical: str) -> str:
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:64]


@router.post("/ingest")
def ingest_lcos_event(
    body: IngestIn,
    db: Annotated[Session, Depends(get_db)],
    response: Response,
) -> dict:
    """Persist one LCOS event · idempotent by (topic, ts_ms, payload_hash).

    Returns HTTP ``202`` on the first accept · HTTP ``200`` on duplicate.
    This mirrors the sprint contract in the OWNERSHIP_MATRIX_TRAIN_B
    design block. FastAPI's ``Response`` dependency lets us flip the
    status code per-branch inside the same handler without a duplicate
    route declaration.
    """
    canonical = _canonical_payload(body.payload)
    if len(canonical.encode("utf-8")) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "payload too large",
        )
    phash = _payload_hash(canonical)

    # SELECT-first dedupe. Two callers hitting the same (topic, ts_ms,
    # payload_hash) tuple concurrently is rare (ts_ms is millisecond-
    # granular and includes the client-generated clock); if it does
    # happen, the UNIQUE constraint below still guards the DB.
    existing = (
        db.query(LcosEvent)
        .filter(
            LcosEvent.topic == body.topic,
            LcosEvent.ts_ms == body.ts_ms,
            LcosEvent.payload_hash == phash,
        )
        .one_or_none()
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return {"accepted": True, "duplicate": True, "id": int(existing.id)}

    row = LcosEvent(
        topic=body.topic[:_MAX_TOPIC_LEN],
        payload_json=canonical,
        ts_ms=body.ts_ms,
        source_sha=body.source_sha[:_MAX_SHA_LEN] if body.source_sha else None,
        session_id=body.session_id[:_MAX_SESSION_LEN] if body.session_id else None,
        payload_hash=phash,
    )
    db.add(row)
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        # Unique-constraint collision from a concurrent duplicate insert
        # → surface as duplicate rather than 500. Read-back returns the
        # winning row id.
        db.rollback()
        winner = (
            db.query(LcosEvent)
            .filter(
                LcosEvent.topic == body.topic,
                LcosEvent.ts_ms == body.ts_ms,
                LcosEvent.payload_hash == phash,
            )
            .one_or_none()
        )
        if winner is not None:
            response.status_code = status.HTTP_200_OK
            return {"accepted": True, "duplicate": True, "id": int(winner.id)}
        raise
    db.refresh(row)
    response.status_code = status.HTTP_202_ACCEPTED
    return {"accepted": True, "duplicate": False, "id": int(row.id)}


# ---------------------------------------------------------------------
# Admin query surface
# ---------------------------------------------------------------------


def _require_admin(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> User:
    """Mirror of ``hq_features._require_admin``. Same gate as every other
    ``/admin/*`` proxy path (see account-app/src/app/api/admin/…).
    """
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


class EventOut(BaseModel):
    id: int
    topic: str
    payload: dict
    ts_ms: int
    source_sha: str | None
    session_id: str | None
    created_at: str  # ISO-8601 UTC


class EventsListOut(BaseModel):
    events: list[EventOut]
    total: int
    limit: int
    offset: int


class TopicOut(BaseModel):
    topic: str
    count: int
    last_seen_ts_ms: int
    last_seen_at: str  # ISO-8601 UTC


class TopicsListOut(BaseModel):
    topics: list[TopicOut]
    total_events: int


def _row_to_out(row: LcosEvent) -> EventOut:
    try:
        payload = json.loads(row.payload_json) if row.payload_json else {}
    except (ValueError, TypeError):
        payload = {"__parse_error__": True, "raw": row.payload_json[:200]}
    return EventOut(
        id=int(row.id),
        topic=row.topic,
        payload=payload if isinstance(payload, dict) else {"value": payload},
        ts_ms=int(row.ts_ms),
        source_sha=row.source_sha,
        session_id=row.session_id,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


@admin_router.get("", response_model=EventsListOut)
def list_events(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
    topic: str | None = Query(default=None, max_length=_MAX_TOPIC_LEN),
    session_id: str | None = Query(default=None, max_length=_MAX_SESSION_LEN),
    since_ms: int | None = Query(default=None, ge=0),
    until_ms: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> EventsListOut:
    q = db.query(LcosEvent)
    if topic:
        q = q.filter(LcosEvent.topic == topic)
    if session_id:
        q = q.filter(LcosEvent.session_id == session_id)
    if since_ms is not None:
        q = q.filter(LcosEvent.ts_ms >= since_ms)
    if until_ms is not None:
        q = q.filter(LcosEvent.ts_ms <= until_ms)

    total = q.count()
    rows = (
        q.order_by(LcosEvent.ts_ms.desc(), LcosEvent.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return EventsListOut(
        events=[_row_to_out(r) for r in rows],
        total=int(total),
        limit=limit,
        offset=offset,
    )


@admin_router.get("/topics", response_model=TopicsListOut)
def list_topics(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> TopicsListOut:
    stmt = (
        select(
            LcosEvent.topic,
            func.count(LcosEvent.id).label("count"),
            func.max(LcosEvent.ts_ms).label("last_ts_ms"),
            func.max(LcosEvent.created_at).label("last_at"),
        )
        .group_by(LcosEvent.topic)
        .order_by(func.count(LcosEvent.id).desc())
    )
    rows = db.execute(stmt).all()
    total = int(db.query(func.count(LcosEvent.id)).scalar() or 0)
    topics: list[TopicOut] = []
    for r in rows:
        last_at_iso = ""
        if r.last_at:
            # Postgres/SQLite may hand us naive or aware — normalize to UTC.
            dt = r.last_at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            last_at_iso = dt.isoformat()
        topics.append(
            TopicOut(
                topic=r.topic,
                count=int(r.count or 0),
                last_seen_ts_ms=int(r.last_ts_ms or 0),
                last_seen_at=last_at_iso,
            )
        )
    return TopicsListOut(topics=topics, total_events=total)
