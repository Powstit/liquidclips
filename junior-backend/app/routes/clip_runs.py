"""Control Tower · Clip Runs ledger + Admin HQ endpoints.

Three surfaces in one file so the schema, ingest, and admin read paths
stay in sync — schema drift between them was one of the pain points that
Control Tower is meant to eliminate.

Routes:
  POST /telemetry/clip_run          · sidecar upsert per attempt (idempotent by run_id)
  GET  /admin/clip-runs             · admin list (filters: status, tier, failure_layer, hours)
  GET  /admin/clip-runs/{run_id}    · admin detail (stage timeline + provider + cost)

Auto-alerts fire from the ingest path:
  - `clip_run_failed`                 · any failure lands one alert row
  - `paid_provider_zero_clips`        · we spent money for zero clips
  - `openai_called_unexpectedly`      · anti-regression on the Anthropic-default policy
  - `fixture_project_detected`        · anti-regression on prod fixture leak
  - `sidecar_unavailable`             · sidecar reported itself down mid-pipeline

15-year-old test: each alert row reads as one plain sentence in the
existing HQ Alerts tab.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import ClipRun, User
from app.routes.admin import AdminUser


# ── request / response envelopes ──────────────────────────────────────────
class StageRecord(BaseModel):
    """One entry in the JSONB stage timeline. Nullable fields let the
    sidecar post partial rows when a stage is in-flight and the pipeline
    dies before completion (`status` stays "running")."""
    stage: str = Field(..., min_length=1, max_length=32)
    status: Literal["queued", "running", "success", "failed", "cancelled", "skipped"] = "queued"
    started_at: datetime | None = None
    duration_ms: int | None = Field(None, ge=0)
    provider: str | None = Field(None, max_length=50)
    model: str | None = Field(None, max_length=80)
    input_tokens: int | None = Field(None, ge=0)
    output_tokens: int | None = Field(None, ge=0)
    cost_usd_cents: int | None = Field(None, ge=0)
    error_code: str | None = Field(None, max_length=64)
    error_message: str | None = Field(None, max_length=500)
    retry_count: int = Field(0, ge=0)


class ClipRunIngest(BaseModel):
    run_id: str = Field(..., min_length=8, max_length=64)
    workspace_id: str | None = Field(None, max_length=80)
    tier: str | None = Field(None, max_length=32)
    app_version: str | None = Field(None, max_length=32)
    runtime_version: str | None = Field(None, max_length=32)
    sidecar_version: str | None = Field(None, max_length=32)
    source_type: Literal["url", "file", "drop"] | None = None
    source_url_or_file_type: str | None = Field(None, max_length=500)
    video_duration_seconds: int | None = Field(None, ge=0)
    requested_clip_count: int | None = Field(None, ge=0, le=200)
    status: Literal["queued", "running", "success", "failed", "cancelled"]
    current_stage: str | None = Field(None, max_length=30)
    failure_layer: Literal[
        "runtime", "sidecar", "backend", "provider", "provider_download", "whop",
        "filesystem", "native", "auth", "billing", "unknown",
    ] | None = None
    failure_reason: str | None = Field(None, max_length=500)
    customer_visible_error: str | None = Field(None, max_length=500)
    clip_judge_provider: str | None = Field(None, max_length=50)
    clip_judge_model: str | None = Field(None, max_length=80)
    input_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)
    cost_usd_cents: int = Field(0, ge=0)
    clips_generated: int = Field(0, ge=0)
    stages: list[StageRecord] = Field(default_factory=list, max_length=64)
    completed_at: datetime | None = None
    # RPC JWT injection · 2026-07-09 (keychain regression guard)
    keychain_read_attempted_count: int | None = Field(None, ge=0)
    clip_judge_mode: Literal["hosted", "auto", "local_byok"] | None = None


class ClipRunListRow(BaseModel):
    """Compact row for the admin table · matches Daniel's spec for the
    Clip Runs tab (6-column list · time / user / status / cost / stage /
    reason)."""
    run_id: str
    user_id: str
    tier: str | None
    status: str
    source_type: str | None
    current_stage: str | None
    clips_generated: int
    failure_reason: str | None
    clip_judge_provider: str | None
    cost_usd: float
    created_at: datetime


class ClipRunListResponse(BaseModel):
    rows: list[ClipRunListRow]
    total: int
    hours: int


class ClipRunDetail(BaseModel):
    run_id: str
    user_id: str
    workspace_id: str | None
    tier: str | None
    app_version: str | None
    runtime_version: str | None
    sidecar_version: str | None
    source_type: str | None
    source_url_or_file_type: str | None
    video_duration_seconds: int | None
    requested_clip_count: int | None
    status: str
    current_stage: str | None
    failure_layer: str | None
    failure_reason: str | None
    customer_visible_error: str | None
    clip_judge_provider: str | None
    clip_judge_model: str | None
    input_tokens: int
    output_tokens: int
    cost_usd: float
    clips_generated: int
    stages: list[dict[str, Any]]
    created_at: datetime
    completed_at: datetime | None
    keychain_read_attempted_count: int | None = None
    clip_judge_mode: str | None = None


# ── telemetry ingest ──────────────────────────────────────────────────────
telemetry_router = APIRouter(prefix="/telemetry", tags=["telemetry-clip-runs"])


@telemetry_router.post("/clip_run", status_code=status.HTTP_202_ACCEPTED)
def ingest_clip_run(
    payload: ClipRunIngest,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Sidecar posts one row per pipeline attempt. Idempotent by run_id
    so a retry after a sidecar restart doesn't double-record.

    Also fires auto-alerts on failure conditions so HQ Alerts tab surfaces
    the incident without Daniel having to grep anything.
    """
    stmt = select(ClipRun).where(ClipRun.run_id == payload.run_id)
    existing = db.execute(stmt).scalar_one_or_none()

    stages_json = [s.model_dump(mode="json") for s in payload.stages]

    if existing:
        # Later stages / final status can overwrite earlier partials.
        existing.status = payload.status
        existing.current_stage = payload.current_stage or existing.current_stage
        existing.failure_layer = payload.failure_layer or existing.failure_layer
        existing.failure_reason = payload.failure_reason or existing.failure_reason
        existing.customer_visible_error = (
            payload.customer_visible_error or existing.customer_visible_error
        )
        existing.clip_judge_provider = (
            payload.clip_judge_provider or existing.clip_judge_provider
        )
        existing.clip_judge_model = payload.clip_judge_model or existing.clip_judge_model
        existing.input_tokens = payload.input_tokens or existing.input_tokens
        existing.output_tokens = payload.output_tokens or existing.output_tokens
        existing.cost_usd_cents = payload.cost_usd_cents or existing.cost_usd_cents
        existing.clips_generated = payload.clips_generated or existing.clips_generated
        if stages_json:
            existing.stages = stages_json
        existing.completed_at = payload.completed_at or existing.completed_at
        # Take latest keychain counter — a later stage may bump it.
        if payload.keychain_read_attempted_count is not None:
            existing.keychain_read_attempted_count = payload.keychain_read_attempted_count
        if payload.clip_judge_mode is not None:
            existing.clip_judge_mode = payload.clip_judge_mode
        row = existing
    else:
        row = ClipRun(
            run_id=payload.run_id,
            user_id=str(user.id),
            workspace_id=payload.workspace_id,
            tier=payload.tier,
            app_version=payload.app_version,
            runtime_version=payload.runtime_version,
            sidecar_version=payload.sidecar_version,
            source_type=payload.source_type,
            source_url_or_file_type=payload.source_url_or_file_type,
            video_duration_seconds=payload.video_duration_seconds,
            requested_clip_count=payload.requested_clip_count,
            status=payload.status,
            current_stage=payload.current_stage,
            failure_layer=payload.failure_layer,
            failure_reason=payload.failure_reason,
            customer_visible_error=payload.customer_visible_error,
            clip_judge_provider=payload.clip_judge_provider,
            clip_judge_model=payload.clip_judge_model,
            input_tokens=payload.input_tokens,
            output_tokens=payload.output_tokens,
            cost_usd_cents=payload.cost_usd_cents,
            clips_generated=payload.clips_generated,
            stages=stages_json,
            completed_at=payload.completed_at,
            keychain_read_attempted_count=payload.keychain_read_attempted_count,
            clip_judge_mode=payload.clip_judge_mode,
        )
        db.add(row)

    db.commit()

    # Auto-alert generation. Each condition writes ONE alert into the
    # existing AdminNotification stream (same table `/admin/alerts` reads).
    _fire_auto_alerts(row, user, db)

    return {
        "ok": True,
        "run_id": row.run_id,
        "status": row.status,
    }


def _fire_auto_alerts(row: ClipRun, user: User, db: Session) -> None:
    """Auto-alert rules · every one produces a plain-sentence title so a
    15-year-old can scan the existing HQ Alerts tab and spot the fire.

    Rules:
      1. clip_run_failed              · any status=failed row
      2. paid_provider_zero_clips     · cost_usd_cents > 0 AND clips_generated == 0
      3. openai_called_unexpectedly   · clip_judge_provider startswith "openai"
                                        (prod default is hosted_anthropic)
      4. fixture_project_detected     · source URL/slug matches fixture
      5. sidecar_unavailable          · failure_layer == "sidecar"
                                        AND failure_reason mentions "unavailable"

    Writes into the same `notifications` table `/admin/alerts` already
    reads · category "pipeline_event" so it slots into the existing HQ
    Alerts filter language. One row per admin (existing admin filter is
    `Notification.user_id == admin.id`).

    Best-effort · never blocks the ingest response.
    """
    from app.features import ADMIN_EMAILS
    from app.models import Notification

    # Find every admin user id so the alert lands in each admin's HQ.
    if not ADMIN_EMAILS:
        return
    admin_ids = [
        uid for (uid,) in db.execute(
            select(User.id).where(User.email.in_(list(ADMIN_EMAILS)))
        ).all()
    ]
    if not admin_ids:
        return

    def _write(kind: str, headline: str, priority: str = "high") -> None:
        body = (
            f"run_id={row.run_id} · user={user.id} · tier={row.tier} · "
            f"stage={row.current_stage} · cost=${row.cost_usd_cents / 100:.2f}"
        )[:500]
        # Idempotency key so a re-emit for the same run + kind doesn't
        # double the alert stream.
        dedup_prefix = f"clip-run:{row.run_id}:{kind}"
        for aid in admin_ids:
            try:
                dedup = f"{dedup_prefix}:{aid}"
                exists = db.query(Notification).filter_by(external_dedup_key=dedup).one_or_none()
                if exists:
                    continue
                note = Notification(
                    user_id=aid,
                    category="pipeline_event",
                    title=headline[:200],
                    body=body,
                    priority=priority,
                    action_kind="open_clip_run",
                    action_data={"run_id": row.run_id, "target_user_id": str(user.id)},
                    external_dedup_key=dedup,
                )
                db.add(note)
            except Exception:  # noqa: BLE001
                db.rollback()
        try:
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()

    if row.status == "failed":
        _write(
            kind="clip_run_failed",
            headline=(
                f"{user.email or user.id}'s clip run failed at {row.current_stage or 'unknown stage'} · "
                f"{row.failure_reason or 'no reason recorded'}"
            ),
        )
    if row.cost_usd_cents > 0 and row.clips_generated == 0:
        _write(
            kind="paid_provider_zero_clips",
            headline=(
                f"${row.cost_usd_cents / 100:.2f} spent on {row.clip_judge_provider or 'unknown provider'} · "
                f"zero clips returned for {user.email or user.id}"
            ),
        )
    if row.clip_judge_provider and row.clip_judge_provider.startswith("openai"):
        _write(
            kind="openai_called_unexpectedly",
            headline=(
                f"OpenAI was used for {user.email or user.id}'s run · "
                f"expected hosted_anthropic in prod"
            ),
            priority="medium",
        )
    slug_or_url = (row.source_url_or_file_type or "").lower()
    if "fixture" in slug_or_url or "fixture-project" in slug_or_url:
        _write(
            kind="fixture_project_detected",
            headline=(
                f"FIXTURE_PROJECT detected in prod for {user.email or user.id} · "
                f"source={slug_or_url[:80]}"
            ),
        )
    if row.failure_layer == "sidecar" and row.failure_reason and "unavailable" in row.failure_reason.lower():
        _write(
            kind="sidecar_unavailable",
            headline=(
                f"Sidecar unavailable during {user.email or user.id}'s run · "
                f"{row.failure_reason[:120]}"
            ),
        )
    # RPC JWT injection regression guard · 2026-07-09
    # Hosted-mode sidecar MUST NOT touch macOS Keychain during clipping.
    # Any non-zero count in hosted mode = the mid-run "security wants to
    # use your confidential information..." prompt regression has landed
    # again. High priority — this bug shipped 3 P0s the last time it hit.
    if (
        row.clip_judge_mode == "hosted"
        and row.keychain_read_attempted_count is not None
        and row.keychain_read_attempted_count > 0
    ):
        _write(
            kind="keychain_touched_in_hosted_mode",
            headline=(
                f"Sidecar touched macOS Keychain {row.keychain_read_attempted_count}x "
                f"during hosted-mode run for {user.email or user.id} · "
                f"mid-run auth prompt regression"
            ),
        )


# ── admin list + detail ───────────────────────────────────────────────────
admin_router = APIRouter(prefix="/admin/clip-runs", tags=["admin-clip-runs"])


def _to_row(cr: ClipRun) -> ClipRunListRow:
    return ClipRunListRow(
        run_id=cr.run_id,
        user_id=cr.user_id,
        tier=cr.tier,
        status=cr.status,
        source_type=cr.source_type,
        current_stage=cr.current_stage,
        clips_generated=cr.clips_generated,
        failure_reason=cr.failure_reason,
        clip_judge_provider=cr.clip_judge_provider,
        cost_usd=round(cr.cost_usd_cents / 100, 4),
        created_at=cr.created_at,
    )


@admin_router.get("", response_model=ClipRunListResponse)
def list_clip_runs(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    hours: Annotated[int, Query(ge=1, le=720)] = 24,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    tier: str | None = None,
    failure_layer: str | None = None,
    provider: str | None = None,
    q: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> ClipRunListResponse:
    """Compact list matching the admin table shape. Sorted newest-first.

    Filters are all optional · defaults show every run in the last 24h.
    `q` matches user_id or run_id substring (bench-line search box).
    """
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    stmt = select(ClipRun).where(ClipRun.created_at >= since)
    if status_filter:
        stmt = stmt.where(ClipRun.status == status_filter)
    if tier:
        stmt = stmt.where(ClipRun.tier == tier)
    if failure_layer:
        stmt = stmt.where(ClipRun.failure_layer == failure_layer)
    if provider:
        stmt = stmt.where(ClipRun.clip_judge_provider == provider)
    if q:
        needle = f"%{q}%"
        stmt = stmt.where(or_(ClipRun.user_id.ilike(needle), ClipRun.run_id.ilike(needle)))

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.execute(total_stmt).scalar_one()

    stmt = stmt.order_by(desc(ClipRun.created_at)).limit(limit)
    rows = [_to_row(cr) for cr in db.execute(stmt).scalars()]
    return ClipRunListResponse(rows=rows, total=int(total), hours=hours)


@admin_router.get("/{run_id}", response_model=ClipRunDetail)
def get_clip_run(
    run_id: str,
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> ClipRunDetail:
    stmt = select(ClipRun).where(ClipRun.run_id == run_id)
    cr = db.execute(stmt).scalar_one_or_none()
    if not cr:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"run_id {run_id} not found")
    return ClipRunDetail(
        run_id=cr.run_id,
        user_id=cr.user_id,
        workspace_id=cr.workspace_id,
        tier=cr.tier,
        app_version=cr.app_version,
        runtime_version=cr.runtime_version,
        sidecar_version=cr.sidecar_version,
        source_type=cr.source_type,
        source_url_or_file_type=cr.source_url_or_file_type,
        video_duration_seconds=cr.video_duration_seconds,
        requested_clip_count=cr.requested_clip_count,
        status=cr.status,
        current_stage=cr.current_stage,
        failure_layer=cr.failure_layer,
        failure_reason=cr.failure_reason,
        customer_visible_error=cr.customer_visible_error,
        clip_judge_provider=cr.clip_judge_provider,
        clip_judge_model=cr.clip_judge_model,
        input_tokens=cr.input_tokens,
        output_tokens=cr.output_tokens,
        cost_usd=round(cr.cost_usd_cents / 100, 4),
        clips_generated=cr.clips_generated,
        stages=cr.stages or [],
        created_at=cr.created_at,
        completed_at=cr.completed_at,
        keychain_read_attempted_count=cr.keychain_read_attempted_count,
        clip_judge_mode=cr.clip_judge_mode,
    )
