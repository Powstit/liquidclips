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


def _refresh_affiliate_cache_tick() -> None:
    """Refresh the leaderboard cache (sprint #14a) by re-pulling each linked
    user's Whop affiliate stats. Runs every 6h. Bounded by 200 users per
    tick to stay polite to the Whop API; a single failed user must NOT
    abort the rest.

    Caches:
      cached_lifetime_earnings_usd  — from Whop total_referral_earnings_usd
      cached_paid_referrals         — from Whop active_members_count
      cached_display_handle         — from Whop username or email-derived
      cached_earnings_at            — now()

    Reads only users with a `whop_affiliate_id` already cached. The first
    affiliate.py /me hit caches that id, so this tick can never run ahead
    of a user signing in.
    """
    import re
    from decimal import Decimal, InvalidOperation

    import httpx

    from app.config import get_settings
    from app.models import User

    s = get_settings()
    if not s.whop_api_key:
        return

    refreshed = 0
    with session_scope() as db:
        # Take rows whose cache is missing or older than 5h (under the 6h
        # tick cadence). New users with a fresh affiliate_id but no cached
        # earnings row yet (cached_earnings_at IS NULL) get picked up
        # immediately. Bounded by 200 to stay under Whop rate limits.
        now_aware = datetime.now(timezone.utc)
        cutoff = now_aware - timedelta(hours=5)
        candidates: list[User] = (
            db.query(User)
            .filter(User.whop_affiliate_id.isnot(None))
            .filter(
                (User.cached_earnings_at.is_(None))
                | (User.cached_earnings_at < cutoff)
            )
            .order_by(User.cached_earnings_at.asc().nullsfirst())
            .limit(200)
            .all()
        )

        for u in candidates:
            try:
                with httpx.Client(timeout=12.0) as client:
                    r = client.get(
                        f"https://api.whop.com/api/v1/affiliates/{u.whop_affiliate_id}",
                        headers={"Authorization": f"Bearer {s.whop_api_key}"},
                    )
                if r.status_code != 200:
                    # Stamp the row so we don't hammer Whop on the same dead
                    # affiliate every tick. Cache stays $0 but timestamp moves.
                    u.cached_earnings_at = now_aware
                    continue
                body = r.json() or {}
            except (httpx.HTTPError, ValueError) as e:
                log.warning("[leaderboard] whop fetch failed for %s: %s", u.whop_affiliate_id, e)
                continue

            try:
                earnings = Decimal(str(body.get("total_referral_earnings_usd") or "0"))
            except (InvalidOperation, TypeError):
                earnings = Decimal("0")
            try:
                paid = int(body.get("active_members_count") or 0)
            except (TypeError, ValueError):
                paid = 0

            # Display handle: Whop username if present, else email local-part
            # truncated. Never the raw email or a real name.
            handle = (body.get("username") or "").strip()
            if not handle and u.email:
                local = u.email.split("@", 1)[0]
                # Scrub anything that looks identifying; cap at 12 chars.
                local = re.sub(r"[^a-z0-9_-]", "", local.lower())[:12] or "anon"
                handle = local
            handle = handle[:24] or "anon"

            u.cached_lifetime_earnings_usd = earnings
            u.cached_paid_referrals = paid
            u.cached_display_handle = handle
            u.cached_earnings_at = now_aware
            refreshed += 1

    if refreshed:
        log.info("[leaderboard] refreshed %d affiliate cache rows", refreshed)


def _refresh_post_analytics_tick() -> None:
    """Schedule v2 — pull per-post engagement from Ayrshare for the last 90
    days of published rows. 30-min cadence + 60-post batch cap = max ~120
    Ayrshare /analytics/post calls/hr (well under any reasonable rate limit).

    Reads only schedules where channel_id IS NOT NULL (skip legacy single-
    profile rows). Uses staleness ordering (NULLS FIRST then oldest
    refreshed_at) so newly-published posts are always picked up first.
    """
    from app import ayrshare
    from app.models import PostAnalytic, Schedule, SocialChannel

    refreshed = 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    with session_scope() as db:
        candidates: list[tuple[Schedule, SocialChannel]] = (
            db.query(Schedule, SocialChannel)
            .join(SocialChannel, SocialChannel.id == Schedule.channel_id)
            .outerjoin(PostAnalytic, PostAnalytic.schedule_id == Schedule.id)
            .filter(Schedule.status == "published")
            .filter(Schedule.created_at >= cutoff)
            .filter(Schedule.ayrshare_scheduled_post_id.isnot(None))
            .filter(SocialChannel.status != "deleted")
            .order_by(PostAnalytic.refreshed_at.asc().nullsfirst())
            .limit(60)
            .all()
        )

        for sched, channel in candidates:
            try:
                resp = ayrshare.analytics(channel.ayrshare_profile_key, sched.ayrshare_scheduled_post_id)
            except Exception as e:  # noqa: BLE001
                log.warning("[analytics] ayrshare.analytics failed for sched=%s: %s", sched.id, e)
                continue

            # Ayrshare returns shape like {"<platform>": {"analytics": {"impressions":..., "likes":...}}}
            per_platform = resp.get(channel.platform, {}) if isinstance(resp, dict) else {}
            metrics = per_platform.get("analytics") if isinstance(per_platform, dict) else {}
            if not isinstance(metrics, dict):
                metrics = {}
            views = int(metrics.get("impressions") or metrics.get("viewCount") or metrics.get("views") or 0)
            likes = int(metrics.get("likeCount") or metrics.get("likes") or 0)
            comments = int(metrics.get("commentCount") or metrics.get("comments") or 0)
            shares = int(metrics.get("shareCount") or metrics.get("shares") or 0)
            saves = int(metrics.get("saveCount") or metrics.get("saves") or 0)
            engagement_rate = None
            if views > 0:
                from decimal import Decimal
                engagement_rate = Decimal(round((likes + comments + shares + saves) / views * 100, 2))

            row = db.get(PostAnalytic, sched.id)
            if row:
                row.views = views
                row.likes = likes
                row.comments = comments
                row.shares = shares
                row.saves = saves
                row.engagement_rate = engagement_rate
                row.refreshed_at = datetime.now(timezone.utc)
                row.raw_payload = resp
            else:
                db.add(PostAnalytic(
                    schedule_id=sched.id,
                    channel_id=channel.id,
                    platform=channel.platform,
                    views=views, likes=likes, comments=comments, shares=shares, saves=saves,
                    engagement_rate=engagement_rate,
                    raw_payload=resp,
                ))
            refreshed += 1

    if refreshed:
        log.info("[analytics] refreshed %d post_analytics rows", refreshed)


def _refresh_channel_status_tick() -> None:
    """Schedule v2 — pull each channel's handle + status from Ayrshare every
    6 hr. Catches disconnects (auth expired, user revoked) so the UI shows
    a red dot + 'reconnect' CTA instead of silent failures."""
    import httpx
    from app import ayrshare
    from app.models import SocialChannel

    refreshed = 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=5)
    with session_scope() as db:
        candidates: list[SocialChannel] = (
            db.query(SocialChannel)
            .filter(SocialChannel.status.in_(("pending_link", "active", "error")))
            .filter(
                (SocialChannel.last_refreshed_at.is_(None))
                | (SocialChannel.last_refreshed_at < cutoff)
            )
            .order_by(SocialChannel.last_refreshed_at.asc().nullsfirst())
            .limit(100)
            .all()
        )
        for channel in candidates:
            try:
                with httpx.Client(timeout=ayrshare.DEFAULT_TIMEOUT) as client:
                    r = client.get(
                        f"{ayrshare.AYRSHARE_BASE}/user",
                        headers=ayrshare._headers(channel.ayrshare_profile_key),
                    )
                if r.status_code != 200:
                    if channel.status != "paused":
                        channel.status = "error"
                    channel.last_refreshed_at = datetime.now(timezone.utc)
                    continue
                body = r.json()
                display_names = body.get("displayNames") or {}
                handle: str | None = None
                if isinstance(display_names, dict):
                    handle = display_names.get(channel.platform)
                active = body.get("activeSocialAccounts") or []
                if isinstance(active, dict):
                    handle = handle or active.get(channel.platform)
                    is_linked = channel.platform in active
                else:
                    is_linked = channel.platform in [str(p).lower() for p in (active or [])]
                channel.handle = handle or channel.handle
                if channel.status != "paused":
                    channel.status = "active" if is_linked else "pending_link"
                channel.last_refreshed_at = datetime.now(timezone.utc)
                refreshed += 1
            except Exception as e:  # noqa: BLE001
                log.warning("[channels] status refresh failed for channel=%s: %s", channel.id, e)
                continue

    if refreshed:
        log.info("[channels] refreshed %d channel status rows", refreshed)


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
    _scheduler.add_job(_refresh_affiliate_cache_tick, "interval", seconds=21600, max_instances=1, coalesce=True, id="leaderboard_refresh")
    _scheduler.add_job(_refresh_post_analytics_tick, "interval", seconds=1800, max_instances=1, coalesce=True, id="post_analytics_refresh")
    _scheduler.add_job(_refresh_channel_status_tick, "interval", seconds=21600, max_instances=1, coalesce=True, id="channel_status_refresh")
    _scheduler.start()
    log.info("[cron] started: schedules 60s, billing 3600s, leaderboard 21600s, analytics 1800s, channel status 21600s")


def stop_cron() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
