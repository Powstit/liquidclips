"""User-side remote-control endpoints.

The desktop app's `useRemoteControl` hook opens an SSE connection to
`GET /remote/stream` on boot (only if founder-flag + session opt-in on
the client). The stream pushes any `RemoteCommand` rows targeted at
this user as `event: command\ndata: {...json...}\n\n` chunks.

The app executes each command via `remoteControlDispatch.ts` and POSTs
the result to `POST /remote/ack/{id}`.

Founder-only at the JWT claim level · non-founder users get 403.

2026-07-22 · Sprint remote-1
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import jwt as _jwt

from app.db import get_db
from app.deps import current_user
from app.jwt_signer import verify_license_jwt
from app.models import RemoteCommand, User


def _user_from_jwt_query(
    jwt_param: Annotated[str | None, Query(alias="jwt")],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """SSE-friendly auth · EventSource can't set headers, so accept the
    License JWT as a query param. Same validation rules as license_claims
    in deps.py · plus the founder-flag override for admin emails."""
    if not jwt_param:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing jwt query param")
    try:
        claims = verify_license_jwt(jwt_param)
    except _jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license expired") from None
    except _jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid license: {e}") from None
    user = db.get(User, claims["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license user not found")
    from app.features import is_admin_email
    if is_admin_email(user.email):
        user.tier = "autopilot"
        user.founder_flag = True
        db.expunge(user)
    return user


router = APIRouter(prefix="/remote", tags=["remote-control"])


# ⛔ IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY · founder-flag gate.
# Every route in this module MUST call _require_founder before doing any
# work. Non-founder users receive HTTP_403_FORBIDDEN with "founder" in
# the detail — this exact string is regex-checked by the lint fence
# (scripts/lint-remote-control-staff-only.sh).
def _require_founder(user: User) -> None:
    if not user.founder_flag:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Remote control is founder-flag only",
        )


@router.get("/stream")
async def remote_stream(
    request: Request,
    user: Annotated[User, Depends(_user_from_jwt_query)],
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    """SSE stream · pushes queued RemoteCommand rows for this user.

    Client (browser EventSource) sees:

        event: hello
        data: {"user_id":"...", "server_time":"..."}

        event: command
        data: {"id":"...", "kind":"composer.submit", "payload":{...}}

        event: heartbeat
        data: {"ts":"..."}

    Heartbeat every 15s so proxies don't close the connection.
    """
    _require_founder(user)
    target_user_id = user.id

    async def event_gen():
        # Initial hello · lets the client know the stream is authenticated + live.
        yield f"event: hello\ndata: {json.dumps({'user_id': target_user_id, 'server_time': datetime.now(timezone.utc).isoformat()})}\n\n"

        last_seen_id: str | None = None
        last_heartbeat = time.monotonic()

        while True:
            # Client disconnected · exit cleanly so the DB connection is freed.
            if await request.is_disconnected():
                return

            # Poll for unexecuted commands targeted at this user. Cheap query
            # (indexed on target_user_id + executed_at). Emits any new rows.
            try:
                q = (
                    db.query(RemoteCommand)
                    .filter(RemoteCommand.target_user_id == target_user_id)
                    .filter(RemoteCommand.executed_at.is_(None))
                    .order_by(RemoteCommand.created_at.asc())
                    .limit(20)
                )
                rows = q.all()
                for row in rows:
                    if last_seen_id and row.id == last_seen_id:
                        continue
                    payload = {
                        "id": row.id,
                        "kind": row.kind,
                        "payload": row.payload or {},
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                    yield f"event: command\ndata: {json.dumps(payload)}\n\n"
                    last_seen_id = row.id
            except Exception as exc:
                yield f"event: error\ndata: {json.dumps({'message': str(exc)[:200]})}\n\n"

            # Heartbeat every 15s so intermediate proxies / load balancers
            # keep the connection open.
            now = time.monotonic()
            if now - last_heartbeat > 15:
                yield f"event: heartbeat\ndata: {json.dumps({'ts': datetime.now(timezone.utc).isoformat()})}\n\n"
                last_heartbeat = now

            # Sleep 500ms · low enough for <1s perceived latency, high
            # enough to keep DB load negligible (2 queries/sec per user).
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.post("/ack/{command_id}")
def remote_ack(
    command_id: str,
    body: dict[str, Any] | None,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """The app calls this after it executes a queued command.
    Writes executed_at + result. Idempotent."""
    _require_founder(user)
    cmd = db.query(RemoteCommand).filter(RemoteCommand.id == command_id).one_or_none()
    if not cmd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown command_id")
    if cmd.target_user_id != user.id:
        # Silent 404 · don't leak which command ids exist for other users.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown command_id")
    if cmd.executed_at is not None:
        # Already acked · return current state (idempotent).
        return {"id": cmd.id, "executed_at": cmd.executed_at.isoformat(), "already_acked": True}
    cmd.executed_at = datetime.now(timezone.utc)
    if body is not None:
        cmd.result = body.get("result", body)
    db.add(cmd)
    db.commit()
    return {"id": cmd.id, "executed_at": cmd.executed_at.isoformat(), "already_acked": False}
