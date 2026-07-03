"""Step 6 · Feature registry admin routes.

HQ auto-generates its per-feature detail page from ``GET /admin/hq/features/{id}``
so adding a new feature = one ``INSERT`` here, not a code deploy in
the account-app. HQ writers use ``POST /admin/hq/features`` +
``POST /admin/hq/features/{id}/endpoints`` (both admin-gated).

Every mutation reuses the Step 2 admin-support pattern — internal
secret + is_admin_email — and audits into AdminAuditLog.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status, Header
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.features import is_admin_email
from app.models import (
    DesktopErrorGroup,
    Endpoint,
    Feature,
    TelemetryEvent,
    User,
)


router = APIRouter(prefix="/admin/hq/features", tags=["hq-features"])


def _require_admin(
    db: Annotated[Session, Depends(get_db)],
    clerk_user_id: Annotated[str, Query(min_length=1)],
    x_internal_secret: Annotated[str | None, Header()] = None,
) -> User:
    secret = get_settings().internal_api_secret
    if secret and x_internal_secret != secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad internal secret")
    user = db.query(User).filter_by(clerk_id=clerk_user_id).one_or_none()
    if not user or not is_admin_email(user.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access required")
    return user


# ---------------------------------------------------------------------
# Read models
# ---------------------------------------------------------------------


class EndpointOut(BaseModel):
    id: str
    method: str
    path_pattern: str
    expected_status: int
    expected_error_codes: list
    enabled: bool


class FeatureOut(BaseModel):
    id: str
    feature_id: str
    name: str
    journey: str | None
    owner: str
    canary: bool
    enabled: bool
    baseline_error_rate: float


class FeatureDetailOut(FeatureOut):
    endpoints: list[EndpointOut]
    recent_events_24h: int
    recent_errors_24h: int
    open_incident_count: int


# ---------------------------------------------------------------------
# GET / — list all features
# ---------------------------------------------------------------------


@router.get("", response_model=list[FeatureOut])
def list_features(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[FeatureOut]:
    rows = db.query(Feature).order_by(Feature.created_at.desc()).all()
    return [
        FeatureOut(
            id=r.id,
            feature_id=r.feature_id,
            name=r.name,
            journey=r.journey,
            owner=r.owner,
            canary=bool(r.canary),
            enabled=bool(r.enabled),
            baseline_error_rate=float(r.baseline_error_rate or 0),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------
# GET /{feature_id} — auto-generated feature detail page
# ---------------------------------------------------------------------


@router.get("/{feature_id}", response_model=FeatureDetailOut)
def get_feature_detail(
    feature_id: str,
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> FeatureDetailOut:
    feat = db.query(Feature).filter_by(feature_id=feature_id).one_or_none()
    if feat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "feature not found")
    endpoints = (
        db.query(Endpoint)
        .filter(Endpoint.feature_id == feature_id)
        .order_by(Endpoint.created_at.asc())
        .all()
    )
    yesterday = datetime.now(timezone.utc).timestamp() - 86400
    recent_events = (
        db.query(func.count(TelemetryEvent.id))
        .filter(TelemetryEvent.feature_id == feature_id)
        .filter(func.strftime("%s", TelemetryEvent.stored_at) > str(int(yesterday)))
        .scalar()
        or 0
    ) if _using_sqlite(db) else (
        db.query(func.count(TelemetryEvent.id))
        .filter(TelemetryEvent.feature_id == feature_id)
        .filter(TelemetryEvent.stored_at >= datetime.fromtimestamp(yesterday, tz=timezone.utc))
        .scalar()
        or 0
    )
    recent_errors = (
        db.query(func.count(TelemetryEvent.id))
        .filter(TelemetryEvent.feature_id == feature_id)
        .filter(TelemetryEvent.success.is_(False))
        .filter(func.strftime("%s", TelemetryEvent.stored_at) > str(int(yesterday)))
        .scalar()
        or 0
    ) if _using_sqlite(db) else (
        db.query(func.count(TelemetryEvent.id))
        .filter(TelemetryEvent.feature_id == feature_id)
        .filter(TelemetryEvent.success.is_(False))
        .filter(TelemetryEvent.stored_at >= datetime.fromtimestamp(yesterday, tz=timezone.utc))
        .scalar()
        or 0
    )
    open_incidents = (
        db.query(func.count(DesktopErrorGroup.id))
        .filter(DesktopErrorGroup.feature_id == feature_id)
        .filter(DesktopErrorGroup.status == "open")
        .scalar()
        or 0
    )
    return FeatureDetailOut(
        id=feat.id,
        feature_id=feat.feature_id,
        name=feat.name,
        journey=feat.journey,
        owner=feat.owner,
        canary=bool(feat.canary),
        enabled=bool(feat.enabled),
        baseline_error_rate=float(feat.baseline_error_rate or 0),
        endpoints=[
            EndpointOut(
                id=e.id,
                method=e.method,
                path_pattern=e.path_pattern,
                expected_status=e.expected_status,
                expected_error_codes=list(e.expected_error_codes or []),
                enabled=bool(e.enabled),
            )
            for e in endpoints
        ],
        recent_events_24h=int(recent_events),
        recent_errors_24h=int(recent_errors),
        open_incident_count=int(open_incidents),
    )


def _using_sqlite(db: Session) -> bool:
    """Best-effort dialect check for the datetime function branch."""
    return db.get_bind().dialect.name == "sqlite"


# ---------------------------------------------------------------------
# Registry mutations — POST /admin/hq/features + endpoints
# ---------------------------------------------------------------------


class FeatureCreateIn(BaseModel):
    feature_id: str
    name: str
    owner: str
    journey: str | None = None
    canary: bool = True
    enabled: bool = True
    baseline_error_rate: float = 0


@router.post("", response_model=FeatureOut, status_code=status.HTTP_201_CREATED)
def create_feature(
    body: FeatureCreateIn,
    admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> FeatureOut:
    existing = db.query(Feature).filter_by(feature_id=body.feature_id).one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "feature_id already exists")
    row = Feature(
        id=uuid.uuid4().hex,
        feature_id=body.feature_id,
        name=body.name,
        owner=body.owner,
        journey=body.journey,
        canary=body.canary,
        enabled=body.enabled,
        baseline_error_rate=body.baseline_error_rate,
    )
    db.add(row)
    db.commit()
    return FeatureOut(
        id=row.id,
        feature_id=row.feature_id,
        name=row.name,
        journey=row.journey,
        owner=row.owner,
        canary=bool(row.canary),
        enabled=bool(row.enabled),
        baseline_error_rate=float(row.baseline_error_rate or 0),
    )


class EndpointCreateIn(BaseModel):
    method: str
    path_pattern: str
    expected_status: int = 200
    expected_error_codes: list[str] = []
    health_check_body: dict | None = None
    enabled: bool = True


@router.post(
    "/{feature_id}/endpoints",
    response_model=EndpointOut,
    status_code=status.HTTP_201_CREATED,
)
def add_endpoint(
    feature_id: str,
    body: EndpointCreateIn,
    admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> EndpointOut:
    feat = db.query(Feature).filter_by(feature_id=feature_id).one_or_none()
    if feat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "feature not found")
    row = Endpoint(
        id=uuid.uuid4().hex,
        feature_id=feature_id,
        method=body.method.upper(),
        path_pattern=body.path_pattern,
        expected_status=body.expected_status,
        expected_error_codes=body.expected_error_codes,
        health_check_body=body.health_check_body,
        enabled=body.enabled,
    )
    db.add(row)
    db.commit()
    return EndpointOut(
        id=row.id,
        method=row.method,
        path_pattern=row.path_pattern,
        expected_status=row.expected_status,
        expected_error_codes=list(row.expected_error_codes or []),
        enabled=bool(row.enabled),
    )


# ---------------------------------------------------------------------
# Desktop error groups — the HQ Incidents view
# ---------------------------------------------------------------------


class DesktopErrorGroupOut(BaseModel):
    id: str
    fingerprint: str
    release: str
    feature_id: str | None
    stable_error_code: str | None
    route: str | None
    environment: str
    count: int
    affected_user_count: int
    latest_sanitized_message: str | None
    first_seen_at: datetime
    last_seen_at: datetime
    status: str


error_group_router = APIRouter(
    prefix="/admin/hq/desktop-errors", tags=["hq-desktop-errors"]
)


@error_group_router.get("", response_model=list[DesktopErrorGroupOut])
def list_error_groups(
    _admin: Annotated[User, Depends(_require_admin)],
    db: Annotated[Session, Depends(get_db)],
    status_filter: Annotated[str | None, Query()] = None,
    release: Annotated[str | None, Query()] = None,
    feature_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[DesktopErrorGroupOut]:
    q = db.query(DesktopErrorGroup)
    if status_filter:
        q = q.filter(DesktopErrorGroup.status == status_filter)
    if release:
        q = q.filter(DesktopErrorGroup.release == release)
    if feature_id:
        q = q.filter(DesktopErrorGroup.feature_id == feature_id)
    rows = q.order_by(DesktopErrorGroup.last_seen_at.desc()).limit(limit).all()
    return [
        DesktopErrorGroupOut(
            id=r.id,
            fingerprint=r.fingerprint,
            release=r.release,
            feature_id=r.feature_id,
            stable_error_code=r.stable_error_code,
            route=r.route,
            environment=r.environment,
            count=int(r.count or 0),
            affected_user_count=int(r.affected_user_count or 0),
            latest_sanitized_message=r.latest_sanitized_message,
            first_seen_at=r.first_seen_at,
            last_seen_at=r.last_seen_at,
            status=r.status,
        )
        for r in rows
    ]
