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
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.db import session_scope
from app.models import Schedule
from app.routes.notifications import write_notification

log = logging.getLogger("junior.cron")


def _fire_schedule(row_id: str) -> None:
    """Reconcile a single schedule row.

    Under the P1 Ayrshare design, scheduling is NATIVE on Ayrshare's side:
    the desktop POSTs to /publish-now with `scheduled_at` set, Ayrshare
    queues + fires the post itself, and the returned post id is cached on
    the row. The cron worker is no longer the firing engine — it's a
    reconciliation poll that:

      - Marks rows past `scheduled_for` with no Ayrshare id as failed (the
        Ayrshare submission never happened, so we won't recover by retrying
        a fire-from-Railway path we don't have).
      - Leaves Ayrshare-tracked rows alone (their published-state flips via
        the analytics polling path; not implemented yet).

    Legacy Postiz path is removed. Existing pending rows from before the
    migration are surfaced to the user as "needs re-scheduling" — better
    than silent stub-publish.
    """
    with session_scope() as db:
        row = db.get(Schedule, row_id)
        if not row or row.status != "pending":
            return
        # If Ayrshare returned a post id at schedule-create time, the post
        # is in Ayrshare's queue. Nothing for us to do until the analytics
        # reconciler polls it.
        if row.postiz_post_id:
            return
        # No Ayrshare id + scheduled_for is in the past -> this row was
        # created under the legacy Postiz path that never went live. Surface
        # it cleanly instead of stub-firing.
        row.status = "failed"
        row.error = "Scheduling backend changed; please re-schedule this clip from Liquid Clips."
        row.retry_count = MAX_RETRIES  # no retries — user action required
        row.next_retry_at = None
        write_notification(
            db,
            user_id=row.user_id,
            category="post_failed",
            title=f"Clip {row.clip_idx + 1:02d} → {row.platform} needs re-scheduling",
            body=f"\"{row.clip_title}\" was queued under the old publisher. Re-schedule it from Liquid Clips and it'll post normally.",
            priority="high",
            external_dedup_key=f"sched-legacy-{row.id}",
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


def _billing_sweep_tick() -> None:
    """Hourly billing reconciliation (the 'period-end cron' the cancel handlers
    referenced):
      - A paid tier whose period has ended — canceled/expired/past_due/refunded
        with paid_until in the PAST — drops to Free, so access + the 100-export
        cap actually end after the grace period (the entitlement keeps them
        unlimited until paid_until; this finalises it).
      - LOUD warning on stale unclaimed Whop pending memberships (>3d old) — the
        buyer likely used a different email at signup, so make it reconcilable
        instead of silently lost.
    """
    from app.db import engine
    from app.models import PendingWhopMembership, User

    now_aware = datetime.now(timezone.utc)
    now = now_aware.replace(tzinfo=None) if engine.dialect.name == "sqlite" else now_aware
    swept = 0
    with session_scope() as db:
        due = (
            db.query(User)
            .filter(
                User.tier != "free",
                User.founder_flag.is_(False),
                User.subscription_status.in_(("canceled", "expired", "past_due", "refunded")),
                User.paid_until.isnot(None),
                User.paid_until < now,
            )
            .limit(200)
            .all()
        )
        for u in due:
            u.tier = "free"
            u.subscription_status = "expired"
            swept += 1
            try:
                from app.clerk_sync import sync_clerk_metadata
                sync_clerk_metadata(u.clerk_id, tier="free", subscription_status="expired", founder=u.founder_flag)
            except Exception:  # noqa: BLE001
                pass

        cutoff = now - timedelta(days=3)
        stale = (
            db.query(PendingWhopMembership)
            .filter(
                PendingWhopMembership.consumed_at.is_(None),
                PendingWhopMembership.created_at < cutoff,
            )
            .limit(100)
            .all()
        )
        if stale:
            log.warning(
                "[billing] %d unclaimed Whop pending membership(s) >3d old — likely "
                "email mismatch at signup; reconcile manually: %s",
                len(stale), [p.email for p in stale],
            )
    if swept:
        log.info("[billing] swept %d expired paid sub(s) → Free", swept)


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
    _scheduler.add_job(_billing_sweep_tick, "interval", seconds=3600, max_instances=1, coalesce=True, id="billing_sweep")
    _scheduler.start()
    log.info("[cron] started: schedules tick 60s, billing sweep 3600s")


def stop_cron() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
