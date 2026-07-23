"""Admin-side remote-control enqueue.

External operator (Claude session / support agent / cron) POSTs commands
here via `x-internal-secret`. The target user's SSE stream picks them up
and executes them.

2026-07-22 · Sprint remote-1
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret
from app.models import RemoteCommand, User


router = APIRouter(prefix="/admin/remote", tags=["admin-remote-control"])


# ── Allowed command kinds · matches remoteControlDispatch.ts on the client ──
_ALLOWED_KINDS: set[str] = {
    "composer.submit",
    "composer.acceptSource",
    "composer.pickFile",
    "composer.forceShell",
    "composer.clearSession",
    # 2026-07-22 · already_settled recovery. Loads any prior settled
    # project's clips into the composer state without re-running the
    # sidecar pipeline. Frontend dispatcher: composer.hydrateFromSlug.
    "composer.hydrateFromSlug",
    "nav.click",
    "state.snapshot",
    "page.screenshot",
    # 2026-07-22 · diagnostic — reads dist/VERSION so remote probes
    # can tell what bundle is actually running vs what the pill offers.
    "page.getVersion",
}


class EnqueueRequest(BaseModel):
    target_user_id: str = Field(..., min_length=8, max_length=64)
    kind: str = Field(..., min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


class EnqueueResponse(BaseModel):
    id: str
    target_user_id: str
    kind: str
    created_at: str


class StatusResponse(BaseModel):
    id: str
    target_user_id: str
    kind: str
    payload: dict[str, Any]
    created_at: str
    executed_at: str | None
    result: dict[str, Any] | None
    executed: bool


# Rate limit: max N commands per user per hour (belt-and-braces, internal-
# secret is the primary defense). Runs a simple SQL count on enqueue.
# 2026-07-22 · Raised 60 → 600 so Claude-driven pipeline probes don't get
# blocked when polling snapshot every few seconds. The internal-secret gate
# is still the primary defense; 600/hr just prevents runaway loops.
_RATE_LIMIT_PER_HOUR = int(os.environ.get("REMOTE_RATE_LIMIT_PER_HOUR", "600"))


def _rate_limit_check(db: Session, target_user_id: str) -> None:
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    count = (
        db.query(RemoteCommand)
        .filter(RemoteCommand.target_user_id == target_user_id)
        .filter(RemoteCommand.created_at >= since)
        .count()
    )
    if count >= _RATE_LIMIT_PER_HOUR:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"rate limit exceeded · {_RATE_LIMIT_PER_HOUR} commands/hour per user",
        )


@router.post("/enqueue", response_model=EnqueueResponse)
def remote_enqueue(
    body: EnqueueRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> EnqueueResponse:
    """Enqueue a remote command for a specific user. Founder-flag gate
    is enforced on the READ side (user_remote.py) so a command
    targeting a non-founder user is enqueued but never delivered
    (silently dropped when the user connects — no SSE stream opens for
    them). This preserves audit trail even for rejected targets."""
    if body.kind not in _ALLOWED_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"kind must be one of: {sorted(_ALLOWED_KINDS)}",
        )
    target = db.query(User).filter(User.id == body.target_user_id).one_or_none()
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown target_user_id")
    _rate_limit_check(db, body.target_user_id)

    ip = request.client.host if request.client else None
    cmd = RemoteCommand(
        target_user_id=body.target_user_id,
        kind=body.kind,
        payload=body.payload,
        created_by_ip=ip,
    )
    db.add(cmd)
    db.commit()
    db.refresh(cmd)
    return EnqueueResponse(
        id=cmd.id,
        target_user_id=cmd.target_user_id,
        kind=cmd.kind,
        created_at=cmd.created_at.isoformat(),
    )


@router.get("/status/{command_id}", response_model=StatusResponse)
def remote_status(
    command_id: str,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> StatusResponse:
    cmd = db.query(RemoteCommand).filter(RemoteCommand.id == command_id).one_or_none()
    if not cmd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown command_id")
    return StatusResponse(
        id=cmd.id,
        target_user_id=cmd.target_user_id,
        kind=cmd.kind,
        payload=cmd.payload or {},
        created_at=cmd.created_at.isoformat(),
        executed_at=cmd.executed_at.isoformat() if cmd.executed_at else None,
        result=cmd.result,
        executed=cmd.executed_at is not None,
    )
