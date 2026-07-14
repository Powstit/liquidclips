"""Admin Money Funnel — Lane serial · Chapter 6 (2026-07-10).

Read-only aggregation endpoints powering the HQ "Money Funnel" tab.
Reads the User table for the "new users" count and returns
`events_pipeline_flowing: false` on the four event-derived tiles until
the behavioural events pipeline (`lcDiag → /telemetry/diagnostic`) is
persisted. Today `/telemetry/diagnostic` (see
`app/routes/telemetry_ingest.py::post_diagnostic`) prints to stdout only
— by design in Phase 1 of the recovery brief — so the tiles that depend
on `wallet_viewed`, `founder_video_finished`, wallet-CTA clicks, and
`section_fallback_triggered` return 0 with an explicit "not flowing"
flag. Frontend renders an honest banner in that case.

When the events table lands, swap the `_events_flowing` short-circuit
for real GROUP BY queries. Every zero-return path here is marked with a
`_TODO(events-table)` comment so a follow-up sprint can flip it in one
change.

Auth: reuses the canonical `AdminUser` gate (internal secret +
`is_admin_email`). NEVER mutates.

Endpoints
---------
GET /admin/money-funnel/summary?since=<iso>&until=<iso>&pipeline=<>
GET /admin/money-funnel/per-surface?since=<iso>&until=<iso>
GET /admin/money-funnel/recent-events?limit=20
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.routes.admin import AdminUser

_log = logging.getLogger("junior.admin_money_funnel")

router = APIRouter(prefix="/admin/money-funnel", tags=["admin", "money-funnel"])


# The eight approved money surfaces, in the same order as
# `desktop-2/docs/mockups/approved/*.html`. Every surface here MUST have
# a matching approved mockup — ship-lens Rule 5 (Chapter 8) enforces the
# JourneyMap ↔ mockup wire.
APPROVED_MONEY_SURFACES: list[str] = [
    "wallet-detail",
    "sync-mail-money-drop",
    "catalog-carousel",
    "cancellation-intercept",
    "in-app-browser",
    "learn",
    "campaign-builder-embed-preview",
    "login-activation",
]


def _events_flowing() -> bool:
    """Return True iff a persisted behavioural-events table exists in
    the database schema. Today the client → `/telemetry/diagnostic`
    endpoint logs to stdout only; when Chapter 6b lands and persists
    events (or a downstream ingest lands them in Postgres), flip this.
    """
    # _TODO(events-table): probe `information_schema.tables` for
    # `behavioral_events` OR query a lightweight ping table once the
    # pipeline is persisted. Until then, honest false.
    return False


# ────────────────────────────────────────────────────────────────────
# I/O shapes
# ────────────────────────────────────────────────────────────────────


class FunnelTile(BaseModel):
    key: str
    label: str
    value: int
    source: str
    honest_note: str | None = Field(
        default=None,
        description="Honest note when the tile is 0 because the events "
        "pipeline isn't flowing yet. Frontend surfaces this as an "
        "info banner, never as a fake tooltip.",
    )


class FunnelSummary(BaseModel):
    since: datetime
    until: datetime
    pipeline: Literal["section", "design-os", "all"]
    events_pipeline_flowing: bool
    tiles: list[FunnelTile]


class SurfaceRow(BaseModel):
    surface: str
    view_count: int
    video_finish_count: int
    cta_click_count: int
    fallback_trip_count: int


class PerSurfaceResponse(BaseModel):
    since: datetime
    until: datetime
    events_pipeline_flowing: bool
    rows: list[SurfaceRow]


class RecentEventItem(BaseModel):
    topic: str
    ts_iso: str
    session_id: str | None
    data_preview: str


class RecentEventsResponse(BaseModel):
    events_pipeline_flowing: bool
    events: list[RecentEventItem]


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


def _parse_window(
    since: datetime | None, until: datetime | None
) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if until is None:
        until = now
    if since is None:
        since = until - timedelta(days=7)
    # Force UTC to keep DB comparisons sane.
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return since, until


# ────────────────────────────────────────────────────────────────────
# GET /admin/money-funnel/summary
# ────────────────────────────────────────────────────────────────────


@router.get("/summary", response_model=FunnelSummary)
def money_funnel_summary(
    admin: AdminUser,  # noqa: ARG001 — auth gate only
    db: Annotated[Session, Depends(get_db)],
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
    pipeline: Annotated[
        Literal["section", "design-os", "all"], Query()
    ] = "section",
) -> FunnelSummary:
    since_dt, until_dt = _parse_window(since, until)
    flowing = _events_flowing()

    # Tile 1 · new users. Sourced from the User table directly — always
    # honest, always the real count. Pipeline filter doesn't apply.
    new_users = (
        db.query(User)
        .filter(User.created_at >= since_dt, User.created_at <= until_dt)
        .count()
    )

    honest_note = (
        None
        if flowing
        else "Behavioural events pipeline logs to stdout only. Tile shows "
             "0 until the persisted events table lands."
    )

    # Tiles 2-5 · derived from lcDiag events. Zero + honest note until
    # the pipeline is persisted.
    tiles = [
        FunnelTile(
            key="new_users",
            label="New users",
            value=new_users,
            source="users.created_at",
        ),
        FunnelTile(
            key="reached_wallet_detail",
            label="Reached wallet detail",
            value=0,
            source="lcDiag:wallet_viewed",
            honest_note=honest_note,
        ),
        FunnelTile(
            key="watched_founder_wallet",
            label="Watched founder wallet video",
            value=0,
            source="lcDiag:founder_video_finished{surface=wallet-detail}",
            honest_note=honest_note,
        ),
        FunnelTile(
            key="wallet_cta_clicked",
            label="Wallet CTA clicked (share / withdraw / connect)",
            value=0,
            source="lcDiag:withdraw_clicked + share_clicked + connect_clicked",
            honest_note=honest_note,
        ),
        FunnelTile(
            key="section_fallback_trips",
            label="Section fallback trips",
            value=0,
            source="lcDiag:section_fallback_triggered",
            honest_note=honest_note,
        ),
    ]

    return FunnelSummary(
        since=since_dt,
        until=until_dt,
        pipeline=pipeline,
        events_pipeline_flowing=flowing,
        tiles=tiles,
    )


# ────────────────────────────────────────────────────────────────────
# GET /admin/money-funnel/per-surface
# ────────────────────────────────────────────────────────────────────


@router.get("/per-surface", response_model=PerSurfaceResponse)
def money_funnel_per_surface(
    admin: AdminUser,  # noqa: ARG001 — auth gate only
    db: Annotated[Session, Depends(get_db)],  # noqa: ARG001 — reserved for future queries
    since: Annotated[datetime | None, Query()] = None,
    until: Annotated[datetime | None, Query()] = None,
) -> PerSurfaceResponse:
    since_dt, until_dt = _parse_window(since, until)
    flowing = _events_flowing()

    # _TODO(events-table): GROUP BY surface. Until then, zero rows for
    # every approved money surface so the table still paints its
    # skeleton and the HQ operator can see the surfaces we're
    # instrumenting.
    rows = [
        SurfaceRow(
            surface=name,
            view_count=0,
            video_finish_count=0,
            cta_click_count=0,
            fallback_trip_count=0,
        )
        for name in APPROVED_MONEY_SURFACES
    ]

    return PerSurfaceResponse(
        since=since_dt,
        until=until_dt,
        events_pipeline_flowing=flowing,
        rows=rows,
    )


# ────────────────────────────────────────────────────────────────────
# GET /admin/money-funnel/recent-events
# ────────────────────────────────────────────────────────────────────


@router.get("/recent-events", response_model=RecentEventsResponse)
def money_funnel_recent_events(
    admin: AdminUser,  # noqa: ARG001 — auth gate only
    limit: Annotated[int, Query(ge=1, le=100)] = 20,  # noqa: ARG001 — no-op until persisted
) -> RecentEventsResponse:
    flowing = _events_flowing()
    # _TODO(events-table): SELECT topic, ts, session_id, data FROM
    # behavioral_events ORDER BY ts DESC LIMIT limit.
    return RecentEventsResponse(events_pipeline_flowing=flowing, events=[])
