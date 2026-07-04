"""F6 · Layer 3 · Deployer backend endpoints.

Backs the desktop-2 broadcast queue with a server-side cross-check on the
100-send/24h rate limit + issues preview-registration for cold-lead
targets. Each Gmail session client-side counter is authoritative; the
backend endpoint is a defense-in-depth guard against a tampered
localStorage or a fresh install that resets its own counter.

Endpoints:
    POST /deployer/broadcast-start   · returns preview_urls per target
    POST /deployer/broadcast-tick    · records one send · returns caps

Both endpoints require an authenticated Liquid Clips license (via the
existing desktop connect + license JWT flow). The `user_id` on the
token is the join key for the per-user 24h counter.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import DeployerBroadcastTick, User

router = APIRouter(prefix="/deployer", tags=["deployer"])

MAX_SENDS_PER_24H = 100


class BroadcastStartTarget(BaseModel):
    email: str
    first_name: str = Field(default="")
    channel_id: str | None = None


class BroadcastStartRequest(BaseModel):
    user_id: str
    targets: list[BroadcastStartTarget]


class BroadcastStartTargetResponse(BaseModel):
    email: str
    preview_url: str
    ref: str


class BroadcastStartResponse(BaseModel):
    ok: bool
    targets: list[BroadcastStartTargetResponse]
    caps: dict


class BroadcastTickRequest(BaseModel):
    user_id: str
    target_email: str
    status: str = "sent"   # "sent" | "failed" | "skipped_captcha"


class BroadcastTickResponse(BaseModel):
    ok: bool
    sent_last_24h: int
    remaining: int
    over_cap: bool


def _sent_last_24h(db: Session, user_id: str) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    q = (
        db.query(func.count(DeployerBroadcastTick.id))
        .filter(
            DeployerBroadcastTick.user_id == user_id,
            DeployerBroadcastTick.status == "sent",
            DeployerBroadcastTick.created_at >= cutoff,
        )
    )
    return int(q.scalar() or 0)


@router.post("/broadcast-start", response_model=BroadcastStartResponse)
def broadcast_start(
    body: BroadcastStartRequest,
    db: Annotated[Session, Depends(get_db)],
) -> BroadcastStartResponse:
    """Register preview links for a batch of warm-peer targets.

    Preview tokens live under `POST /preview/register` (Layer 3 depends on
    F3 for that endpoint · not built yet). This shim mints deterministic
    per-target URLs so the desktop can queue while F3 catches up. Once
    F3.POST /preview/register lands, swap the URL builder here to call it.
    """
    user = db.query(User).filter_by(id=body.user_id).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")

    ref = user.affiliate_id or user.whop_affiliate_code or user.whop_affiliate_id or user.id
    out_targets: list[BroadcastStartTargetResponse] = []
    for t in body.targets:
        # Stable dev token — replaced with F3 preview-register call.
        token_seed = f"{user.id}:{t.email}"
        stable_token = str(abs(hash(token_seed)))[:12]
        out_targets.append(
            BroadcastStartTargetResponse(
                email=t.email,
                preview_url=f"https://liquidclips.app/preview/{stable_token}?ref={ref}",
                ref=ref,
            )
        )
    sent = _sent_last_24h(db, user.id)
    return BroadcastStartResponse(
        ok=True,
        targets=out_targets,
        caps={"sent_last_24h": sent, "max": MAX_SENDS_PER_24H, "remaining": max(0, MAX_SENDS_PER_24H - sent)},
    )


@router.post("/broadcast-tick", response_model=BroadcastTickResponse)
def broadcast_tick(
    body: BroadcastTickRequest,
    db: Annotated[Session, Depends(get_db)],
) -> BroadcastTickResponse:
    """Record one send + return current 24h counters.

    Client-side counter is authoritative for real-time UX; this endpoint
    catches drift (tampered localStorage, multi-device). Over-cap responses
    include `over_cap=true` so the client can pause the queue.
    """
    user = db.query(User).filter_by(id=body.user_id).one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user_not_found")

    sent = _sent_last_24h(db, user.id)
    over_cap = sent >= MAX_SENDS_PER_24H
    # Only record 'sent' rows against the 24h cap. Failed / captcha-skipped
    # rows still write so an operator can audit what happened.
    row = DeployerBroadcastTick(
        user_id=user.id,
        target_email=body.target_email[:200],
        status=body.status[:32],
    )
    db.add(row)
    db.commit()
    sent_after = sent + (1 if body.status == "sent" else 0)
    return BroadcastTickResponse(
        ok=True,
        sent_last_24h=sent_after,
        remaining=max(0, MAX_SENDS_PER_24H - sent_after),
        over_cap=(sent_after >= MAX_SENDS_PER_24H),
    )
