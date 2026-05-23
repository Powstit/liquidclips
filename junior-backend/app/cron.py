"""In-process cron worker — APScheduler ticks every 60s and fires due schedules.

Spec §1.4: "Railway cron worker ticks every 60 seconds: SELECT * FROM schedules
WHERE scheduled_for <= NOW() AND status='pending'. For each match: call Postiz."

Sprint 7 cut: this fires the row through a STUB Postiz call that just marks the
row as 'scheduled' immediately (no real platform post). Sprint 5 wires the real
Postiz internal API; we change only the body of `_fire_schedule` then.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import session_scope
from app.models import Schedule
from app.routes.notifications import write_notification

log = logging.getLogger("junior.cron")


def _fire_schedule(row_id: str) -> None:
    """Run the upload + publish for a single schedule row.

    Right now this is a stub — it transitions pending → scheduled without
    making any external call. Sprint 5 replaces the body with:
        1. POST to Postiz internal API: {post_id, scheduled_at, platform}
        2. Mark row as 'scheduled' + record postiz_post_id.
    """
    import asyncio
    from app import postiz
    with session_scope() as db:
        row = db.get(Schedule, row_id)
        if not row:
            return
        if row.status != "pending":
            return
        try:
            row.status = "uploading"
            db.flush()
            # Real Postiz path (or stub when POSTIZ_INTERNAL_URL not set).
            # The upload happened earlier when the schedule was created — we
            # only call publish_now() here. (Sprint 5.6 will move the upload
            # into the schedule creation handler; until then, we accept a
            # synthetic post_id from the stub.)
            if not row.postiz_post_id:
                # First-time fire — desktop didn't upload at schedule time yet.
                # Fall back to a stub id so the publish call works against the
                # stub backend during development.
                row.postiz_post_id = f"stub_{row.id[:10]}"
            published = asyncio.run(postiz.publish_now(
                user_id=row.user_id,
                postiz_post_id=row.postiz_post_id,
                platform=row.platform,
            ))
            row.post_url = published.get("post_url")
            row.status = "published"
            row.error = None
            write_notification(
                db,
                user_id=row.user_id,
                category="post_published",
                title=f"Published clip {row.clip_idx + 1:02d} → {row.platform}",
                body=f"\"{row.clip_title}\" live at {row.post_url}",
                priority="medium",
                external_dedup_key=f"sched-{row.id}",
                action_kind="open_url",
                action_data={"url": row.post_url},
            )
        except Exception as e:  # noqa: BLE001
            from datetime import timedelta
            row.status = "failed"
            row.retry_count = (row.retry_count or 0) + 1
            row.error = f"{type(e).__name__}: {e}"
            attempt_idx = row.retry_count - 1  # zero-based
            if attempt_idx < len(RETRY_BACKOFFS_MIN):
                backoff = RETRY_BACKOFFS_MIN[attempt_idx]
                row.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=backoff)
                retry_note = f" Retry in {backoff} min ({row.retry_count}/{MAX_RETRIES})."
            else:
                row.next_retry_at = None
                retry_note = f" No retries left after {MAX_RETRIES} attempts."
            write_notification(
                db,
                user_id=row.user_id,
                category="post_failed",
                title=f"Clip {row.clip_idx + 1:02d} didn't post to {row.platform}",
                body=f"{type(e).__name__}: {e}.{retry_note}",
                priority="high",
                # Unique key per attempt so each retry surfaces a fresh row.
                external_dedup_key=f"sched-fail-{row.id}-{row.retry_count}",
                action_kind="open_clip",
                action_data={"project_slug": row.project_slug, "clip_idx": row.clip_idx},
            )


MAX_RETRIES = 3
RETRY_BACKOFFS_MIN = (1, 5, 25)  # minutes between attempts


def _tick() -> None:
    # SQLite stores tz-aware DateTime columns as naive strings under the hood;
    # comparing them against a tz-aware `datetime.now(timezone.utc)` raises a
    # TypeError. Use the matching naive UTC for the filter so the comparison
    # works on both SQLite (dev) and Postgres (Railway, where tz-aware works).
    from sqlalchemy import or_
    from app.db import engine
    now_aware = datetime.now(timezone.utc)
    is_sqlite = engine.dialect.name == "sqlite"
    cutoff = now_aware.replace(tzinfo=None) if is_sqlite else now_aware

    fired: list[str] = []
    with session_scope() as db:
        # Pick up:
        #   - first-time pending posts whose scheduled_for is past, OR
        #   - failed posts that have retries left and next_retry_at is past.
        due = (
            db.query(Schedule)
            .filter(
                or_(
                    (Schedule.status == "pending") & (Schedule.scheduled_for <= cutoff),
                    (Schedule.status == "failed") & (Schedule.retry_count < MAX_RETRIES) & (Schedule.next_retry_at <= cutoff),
                )
            )
            .order_by(Schedule.scheduled_for.asc())
            .limit(50)
            .all()
        )
        fired = [r.id for r in due]
    for sid in fired:
        _fire_schedule(sid)
    if fired:
        log.info("[cron] fired %d schedule(s): %s", len(fired), fired)


_scheduler: BackgroundScheduler | None = None


def start_cron() -> None:
    """Idempotent — Railway can hit the lifespan setup multiple times under load."""
    global _scheduler
    if _scheduler is not None:
        return
    # Skip in tests / when explicitly disabled.
    if os.environ.get("JUNIOR_DISABLE_CRON", "").strip() in {"1", "true"}:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(_tick, "interval", seconds=60, max_instances=1, coalesce=True, id="schedules_tick")
    _scheduler.start()
    log.info("[cron] started, tick every 60s")


def stop_cron() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
