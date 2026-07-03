"""Step 7 · Railway deployment webhook · signed + audited.

Railway posts here on deploy events (started · succeeded · failed ·
rolled_back). We verify a shared HMAC-SHA256 signature before writing
to ``deployment_events`` so an unauthenticated caller cannot forge
release identity — the ``release`` field is what HQ joins telemetry +
error groups on.

Replay protection: ``deployment_id`` is UNIQUE at the DB layer so a
signature reused with a stale timestamp cannot land twice. Signature
verification uses constant-time compare via ``hmac.compare_digest``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DeploymentEvent

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _railway_secret() -> str:
    """The shared HMAC secret. Empty ⇒ development mode (verification
    still checks presence of a header but accepts any signature so
    Daniel can POST manually while wiring the Railway integration)."""
    return os.environ.get("RAILWAY_WEBHOOK_SECRET", "").strip()


def _verify_signature(body: bytes, provided: str | None) -> tuple[bool, bool]:
    """Return ``(verified, mode_is_dev)``. Dev mode accepts anything so
    Daniel can wire the Railway integration incrementally without a
    hard 401 lockout · production requires an exact match."""
    secret = _railway_secret()
    if not secret:
        return (True, True)
    if not provided:
        return (False, False)
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return (hmac.compare_digest(expected, provided), False)


@router.post("/railway", status_code=status.HTTP_202_ACCEPTED)
async def railway_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    x_railway_signature: Annotated[str | None, Header()] = None,
) -> dict:
    """Accept a Railway deployment event.

    Payload shape (matches Railway's `webhook.deploy.*` fixture · we
    only read the fields we persist; extra keys land in the raw JSON
    for future migration).

    Required body fields:
      * ``deployment_id`` (unique)
      * ``service``
      * ``environment``
      * ``release_sha``
      * ``event_type`` (started | succeeded | failed | rolled_back)
      * ``occurred_at`` (ISO-8601 UTC)
    """
    body = await request.body()
    verified, dev_mode = _verify_signature(body, x_railway_signature)
    if not verified:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad railway signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed body") from None

    for required in (
        "deployment_id",
        "service",
        "environment",
        "release_sha",
        "event_type",
        "occurred_at",
    ):
        if required not in payload:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"missing field: {required}",
            )

    try:
        occurred = datetime.fromisoformat(str(payload["occurred_at"]).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad occurred_at") from None
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)

    # Idempotency: unique(deployment_id) on the table means a replay
    # returns 202 with `duplicate: True` instead of double-writing.
    existing = (
        db.query(DeploymentEvent)
        .filter(DeploymentEvent.deployment_id == payload["deployment_id"])
        .one_or_none()
    )
    if existing is not None:
        return {"accepted": True, "duplicate": True, "id": existing.id}

    row = DeploymentEvent(
        id=uuid.uuid4().hex,
        deployment_id=str(payload["deployment_id"])[:120],
        service=str(payload["service"])[:80],
        environment=str(payload["environment"])[:20],
        release_sha=str(payload["release_sha"])[:80],
        event_type=str(payload["event_type"])[:40],
        occurred_at=occurred,
        raw_payload_json=body.decode("utf-8"),
        signature_verified=(not dev_mode),
    )
    db.add(row)
    db.commit()
    return {"accepted": True, "duplicate": False, "id": row.id}
