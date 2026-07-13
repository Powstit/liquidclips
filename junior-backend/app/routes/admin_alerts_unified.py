"""AU-D-2 · unified admin alerts endpoint.

Prior behaviour: /admin/alerts read ONLY from the `notifications` table.
Real production failure signals live in several other tables, so an
admin looking at the Alerts panel was blind to state_puppet audit
rows, desktop error events (auth failures, backend offline), and any
section fallback triggers. This endpoint joins those sources into a
single time-sorted list capped at 50 rows.

Design:
  * Fan-out is server-side · single HTTP round-trip from the panel.
  * Every row uses the shared `UnifiedAlert` shape so the client renders
    heterogeneous sources through the same JSX row.
  * `honest_gaps` names each source we couldn't read (missing table,
    reserved for future) so the panel can surface a footer instead of
    silently hiding data.
  * Read-only. No mutation. No side effects.

Sources fused:
  1. notifications         · Notification model (existing /admin/alerts source)
  2. admin_audit_log       · AdminAuditLog rows where action LIKE 'state_puppet_%'
  3. desktop_error_event   · DesktopErrorEvent rows for auth / backend / update failures
  4. clip_runs             · does NOT exist as an ORM model (2026-07-10) — noted as honest gap.
  5. telemetry_diagnostic  · dedicated events table does NOT exist as an ORM model
                             (client-side lcDiag rows POST to `/telemetry/diagnostic`
                             but land in application logs, not a queryable table) —
                             noted as honest gap.

Auth: reuses `require_admin` from `app.routes.admin` (defence-in-depth:
internal-secret + admin allowlist).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AdminAuditLog,
    DesktopErrorEvent,
    Notification,
)
from app.routes.admin import AdminUser

router = APIRouter(prefix="/admin", tags=["admin"])


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _sort_key(dt: datetime | None) -> datetime:
    """Newest-first sort key. `None` timestamps drop to epoch so they land
    at the very end without raising a mixed-tz comparison error."""
    if dt is None:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/alerts-unified")
def admin_alerts_unified(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 50,
) -> dict[str, Any]:
    """Fan out into every alert source we can honestly query and return
    the newest `limit` rows, sorted by timestamp descending.

    Response shape:
        {
          "unread": int,
          "alerts": [ UnifiedAlert, ... ],
          "sources": [ "notifications", "admin_audit_log", "desktop_error_event" ],
          "honest_gaps": [ "clip_runs", "telemetry_diagnostic" ],
        }
    """
    limit = max(1, min(limit, 100))

    unified: list[dict[str, Any]] = []

    # ── Source 1 · notifications (mirror of legacy /admin/alerts) ──
    notif_rows = (
        db.query(Notification)
        .filter(
            Notification.user_id == admin.id,
            Notification.dismissed_at.is_(None),
        )
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )
    unread = sum(1 for n in notif_rows if n.read_at is None)
    for n in notif_rows:
        unified.append(
            {
                "id": f"notif:{n.id}",
                "source": "notifications",
                "category": n.category,
                "title": n.title,
                "body": n.body,
                "priority": n.priority,
                "action_kind": n.action_kind,
                "action_data": n.action_data or {},
                "read_at": _iso(n.read_at),
                "created_at": _iso(n.created_at),
                "_ts": n.created_at,
            }
        )

    # ── Source 2 · admin_audit_log · state_puppet_* actions ──
    # state_puppet mutations are how HQ nudges a user's tier / plan /
    # billing state during triage. An admin should see these fanned into
    # Alerts so a fellow admin's escalation is visible.
    puppet_rows = (
        db.query(AdminAuditLog)
        .filter(AdminAuditLog.action.like("state_puppet_%"))
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    for row in puppet_rows:
        title = f"state puppet · {row.action}"
        body = f"{row.actor_email} → {row.target_type}:{row.target_id} · {row.result}"
        if row.error_message:
            body = f"{body} · {row.error_message[:200]}"
        unified.append(
            {
                "id": f"audit:{row.id}",
                "source": "admin_audit_log",
                "category": row.action,
                "title": title,
                "body": body,
                "priority": "high" if row.result == "error" else "medium",
                "action_kind": None,
                "action_data": {"target_type": row.target_type, "target_id": row.target_id},
                "read_at": None,  # audit rows have no read state
                "created_at": _iso(row.created_at),
                "_ts": row.created_at,
            }
        )

    # ── Source 3 · desktop_error_event · auth / backend / provider fails ──
    # DesktopErrorEvent's `event` column carries the failure family
    # (`license_rejected`, `backend_offline`, `update_failed`, plus
    # anything future). We treat all three as high-signal admin alerts.
    err_events = {
        "license_rejected",
        "backend_offline",
        "update_failed",
        "auth_failed",
        "provider_5xx",
    }
    err_rows = (
        db.query(DesktopErrorEvent)
        .filter(DesktopErrorEvent.event.in_(list(err_events)))
        .order_by(DesktopErrorEvent.created_at.desc())
        .limit(limit)
        .all()
    )
    for e in err_rows:
        title = f"desktop · {e.event}"
        body_parts = [f"{e.app_version} · {e.os}/{e.arch}"]
        if e.route:
            body_parts.append(f"route={e.route}")
        if e.http_status is not None:
            body_parts.append(f"status={e.http_status}")
        if e.error_code:
            body_parts.append(f"code={e.error_code}")
        if e.message:
            body_parts.append(e.message[:200])
        unified.append(
            {
                "id": f"desktop_err:{e.id}",
                "source": "desktop_error_event",
                "category": e.event,
                "title": title,
                "body": " · ".join(body_parts),
                "priority": "high",
                "action_kind": None,
                "action_data": {
                    "user_ref": e.user_ref,
                    "app_version": e.app_version,
                    "error_code": e.error_code,
                },
                "read_at": None,
                "created_at": _iso(e.created_at),
                "_ts": e.created_at,
            }
        )

    # Newest-first sort across the merged set + cap at `limit`.
    unified.sort(key=lambda r: _sort_key(r.get("_ts")), reverse=True)
    trimmed = unified[:limit]
    # Strip the sort key before returning.
    for row in trimmed:
        row.pop("_ts", None)

    return {
        "unread": unread,
        "alerts": trimmed,
        "sources": [
            "notifications",
            "admin_audit_log",
            "desktop_error_event",
        ],
        # HONEST gaps — sources the task named that we can NOT query
        # today because no ORM model exists for them. Panel surfaces
        # these so an operator knows what's missing rather than assuming
        # the union is complete.
        "honest_gaps": [
            {
                "source": "clip_runs",
                "reason": (
                    "no ORM model exists for `clip_runs` in this backend "
                    "as of 2026-07-10 · sidecar-side clip_run rows would "
                    "need to be persisted server-side first"
                ),
            },
            {
                "source": "telemetry_diagnostic",
                "reason": (
                    "client-side lcDiag events POST to /telemetry/diagnostic "
                    "and land in application logs but are not persisted to a "
                    "queryable table"
                ),
            },
        ],
    }
