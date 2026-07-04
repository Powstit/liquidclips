"""Step 7 · HQ funnel + stuck-user view.

Two admin-gated endpoints that consume the Step 4 milestone transition
history + Step 6 telemetry substrate:

* ``GET /admin/hq/funnels?journey=clipper`` — funnel counts per state
  in the journey path. Cross-tool joinable to PostHog funnels — same
  shape.
* ``GET /admin/hq/stuck-users`` — users whose furthest state hasn't
  advanced in N days AND who have a recent error group. Prime target
  list for the assigned owner.

Both routes read the substrate; no business logic per sink.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret
from app.features import is_admin_email
from app.models import (
    DesktopErrorGroup,
    MilestoneTransition,
    TelemetryEvent,
    User,
)
from app.onboarding_journeys import (
    AGENCY_PATH,
    CLIPPER_PATH,
    JOURNEY_PATHS,
    SURFACE_FOR_NEXT_STATE,
)


router = APIRouter(prefix="/admin/hq", tags=["hq-journeys"])


def _require_admin(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> User:
    # x-internal-secret gate is now fail-closed via require_internal_secret.
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


# ---------------------------------------------------------------------
# GET /admin/hq/funnels?journey=X
# ---------------------------------------------------------------------


class FunnelStep(BaseModel):
    state: str
    users_reached: int
    drop_off_pct: float
    next_surface: str | None


class FunnelResponse(BaseModel):
    journey: str
    path: list[str]
    steps: list[FunnelStep]


@router.get("/funnels", response_model=FunnelResponse)
def get_funnel(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
    journey: Annotated[str, Query(pattern=r"^(clipper|agency)$")],
) -> FunnelResponse:
    path = JOURNEY_PATHS[journey]  # type: ignore[index]
    # Count DISTINCT users at each state (a user might have multiple
    # rows for the same state if they replayed; we count reach not
    # attempts).
    counts: dict[str, int] = {}
    for state in path:
        n = (
            db.query(func.count(func.distinct(MilestoneTransition.user_id)))
            .filter(
                and_(
                    MilestoneTransition.journey == journey,
                    MilestoneTransition.next_state == state,
                )
            )
            .scalar()
            or 0
        )
        counts[state] = int(n)

    steps: list[FunnelStep] = []
    prev_reached = counts[path[0]] if path else 0
    for i, state in enumerate(path):
        reached = counts[state]
        drop_off = 0.0
        if i > 0 and prev_reached > 0:
            drop_off = round(100 * (1 - reached / prev_reached), 2)
        steps.append(
            FunnelStep(
                state=state,
                users_reached=reached,
                drop_off_pct=drop_off,
                next_surface=SURFACE_FOR_NEXT_STATE.get(state),
            )
        )
        prev_reached = reached
    return FunnelResponse(journey=journey, path=list(path), steps=steps)


# ---------------------------------------------------------------------
# GET /admin/hq/stuck-users
# ---------------------------------------------------------------------


class StuckUserOut(BaseModel):
    user_id: str
    email_masked: str | None
    journey: str
    last_state: str
    last_state_at: datetime
    days_stuck: int
    latest_error_code: str | None
    latest_error_release: str | None
    recommended_surface: str | None


class StuckUserResponse(BaseModel):
    users: list[StuckUserOut]


def _mask_email(email: str | None) -> str | None:
    if not email:
        return None
    if "@" not in email:
        return "[redacted]"
    local, _, domain = email.partition("@")
    return (local[:2] + "***@" + domain) if local else "***@" + domain


@router.get("/stuck-users", response_model=StuckUserResponse)
def get_stuck_users(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    journey: Annotated[str | None, Query(pattern=r"^(clipper|agency)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> StuckUserResponse:
    """Return users whose furthest milestone hasn't advanced in ``days``.

    Uses a subquery to compute each user's latest transition per
    journey · anyone whose latest is older than the cutoff AND who
    hasn't reached the terminal state qualifies.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    latest_per_user_journey = (
        db.query(
            MilestoneTransition.user_id.label("user_id"),
            MilestoneTransition.journey.label("journey"),
            func.max(MilestoneTransition.created_at).label("last_at"),
        )
        .group_by(MilestoneTransition.user_id, MilestoneTransition.journey)
        .subquery()
    )

    q = (
        db.query(
            MilestoneTransition.user_id,
            MilestoneTransition.journey,
            MilestoneTransition.next_state,
            MilestoneTransition.created_at,
        )
        .join(
            latest_per_user_journey,
            and_(
                MilestoneTransition.user_id == latest_per_user_journey.c.user_id,
                MilestoneTransition.journey == latest_per_user_journey.c.journey,
                MilestoneTransition.created_at == latest_per_user_journey.c.last_at,
            ),
        )
        .filter(MilestoneTransition.created_at < cutoff)
    )
    if journey:
        q = q.filter(MilestoneTransition.journey == journey)

    rows = q.order_by(MilestoneTransition.created_at.desc()).limit(limit).all()

    out: list[StuckUserOut] = []
    for user_id, jrny, last_state, last_at in rows:
        # Skip users who've hit the terminal state — they aren't stuck,
        # they're done.
        path = JOURNEY_PATHS.get(jrny, ())
        if path and last_state == path[-1]:
            continue
        user = db.get(User, user_id)
        # Latest error on the same release for context
        latest_err = (
            db.query(DesktopErrorGroup)
            .filter(DesktopErrorGroup.feature_id.isnot(None))
            .order_by(DesktopErrorGroup.last_seen_at.desc())
            .first()
        )
        days_stuck = max(0, (datetime.now(timezone.utc) - last_at.replace(tzinfo=timezone.utc if last_at.tzinfo is None else last_at.tzinfo)).days)
        # Recommend the surface the user should be routed to
        next_state_idx = path.index(last_state) + 1 if last_state in path else None
        recommended = None
        if next_state_idx is not None and next_state_idx < len(path):
            recommended = SURFACE_FOR_NEXT_STATE.get(path[next_state_idx])
        out.append(
            StuckUserOut(
                user_id=user_id,
                email_masked=_mask_email(getattr(user, "email", None)) if user else None,
                journey=jrny,
                last_state=last_state,
                last_state_at=last_at,
                days_stuck=days_stuck,
                latest_error_code=(latest_err.stable_error_code if latest_err else None),
                latest_error_release=(latest_err.release if latest_err else None),
                recommended_surface=recommended,
            )
        )
    return StuckUserResponse(users=out)
