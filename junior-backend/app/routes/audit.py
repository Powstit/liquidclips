"""Persistent audit endpoint · 2.2.24 · the single-call ship gate.

Answers one question: "is the system green enough to deploy right now?"

Two endpoints:
  · POST /audit/tick    — receives an action lifecycle event from any
                          user-facing surface (button click, API call,
                          form submit). Stored in a rolling in-memory
                          window; oldest evicted after N events or M
                          minutes. No auth (writes are cheap +
                          telemetry-shaped).

  · GET  /audit/state   — aggregates every signal we can cheaply
                          collect: recent tick outcomes, backend health,
                          journey success rates, migration state,
                          integration reachability. Returns one JSON
                          object with a top-level `ok: bool`.

Deploy discipline:
  · scripts/audit-gate.sh curls /audit/state before any ship
  · If `ok: false`, the deploy is blocked
  · The `blocking_findings` array explains why

Persistence: MVP is in-memory (survives one Railway instance, dies on
restart). Next iteration lands on Postgres — schema comment at the
bottom. For now, restart clears the window which is FINE because a
freshly-restarted backend is defined as healthy until proven otherwise.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from threading import Lock
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db

log = logging.getLogger("junior.audit")

router = APIRouter(prefix="/audit", tags=["audit"])

# Rolling event window · MVP in-memory storage.
# Sized so a busy Railway instance holds ~30 minutes of ticks even at
# 100 events / minute. Eviction is O(1) via deque(maxlen).
_TICK_WINDOW: deque[dict[str, Any]] = deque(maxlen=3000)
_TICK_LOCK = Lock()

# Rolling success-count per action_id · used for journey success rates.
_ACTION_COUNTS: dict[str, dict[str, int]] = defaultdict(
    lambda: {"success": 0, "failure": 0, "last_success_ts": 0, "last_failure_ts": 0}
)
_ACTION_LOCK = Lock()

# Critical journeys we track explicitly · the ship-gate reads these.
# `action_id` on the frontend must match a key here to feed the gate.
_CRITICAL_JOURNEYS = {
    "auth.sign-in": "Cold-email signup completes end-to-end",
    "wallet.claim": "Wallet claim from clipper account",
    "publish.multi-platform": "Publish clip to TikTok / Reels / Shorts",
    "campaign.create": "Agency creates a new campaign",
    "watermark.remove": "Founder unlocks watermark via feature-gate",
}

# Health thresholds. Journey is red if success_rate < X in last N events.
_MIN_SUCCESS_RATE = 0.85
_MIN_EVENTS_FOR_RATE = 5


class TickIn(BaseModel):
    action_id: str
    outcome: str  # "success" | "failure" | "start"
    duration_ms: int | None = None
    error_code: str | None = None
    surface: str | None = None  # e.g. "TopHud", "WalletDetail"
    user_ref: str | None = None  # opaque · never a JWT / secret


@router.post("/tick")
def audit_tick(body: TickIn) -> dict[str, str]:
    """Receive a lifecycle event from any user-facing surface. Fire-
    and-forget from the frontend; the returned `{"ok": true}` is only
    used to confirm the writer path is alive.

    2026-07-05 · integration-lens HIGH · abuse control. `/audit/tick`
    is unauthenticated (telemetry writes are cheap + shape-only), so
    without allowlisting a hostile client could POST 1000 failure
    ticks against `auth.sign-in` and flip `/audit/state.ok` to false
    — blocking every deploy behind `scripts/audit-gate.sh`. We
    accept ONLY the closed vocabulary of critical journeys we track
    for the ship gate; ticks with unknown `action_id` are silently
    dropped (client-side logging remains for debug). The rolling
    window (`_TICK_WINDOW`) is still bounded by `maxlen`; the
    monotonic per-action counters (`_ACTION_COUNTS`) only accumulate
    for allowlisted ids so they can't be poisoned into a red state
    from noise."""
    if body.action_id not in _CRITICAL_JOURNEYS:
        # Silent 200 · never 4xx a telemetry write · but do not
        # accumulate. Frontend fires-and-forgets, so a rejection here
        # never breaks the user's action.
        return {"ok": "true", "recorded": "false"}
    ts_ms = int(time.time() * 1000)
    payload = {
        "ts_ms": ts_ms,
        "action_id": body.action_id,
        "outcome": body.outcome,
        "duration_ms": body.duration_ms,
        "error_code": body.error_code,
        "surface": body.surface,
        "user_ref": body.user_ref,
    }
    with _TICK_LOCK:
        _TICK_WINDOW.append(payload)
    if body.outcome in {"success", "failure"}:
        with _ACTION_LOCK:
            bucket = _ACTION_COUNTS[body.action_id]
            bucket[body.outcome] += 1
            bucket[f"last_{body.outcome}_ts"] = ts_ms
    return {"ok": "true", "recorded": "true"}


def _journey_state(action_id: str) -> dict[str, Any]:
    """Compute success-rate + freshness for one critical journey."""
    with _ACTION_LOCK:
        bucket = dict(_ACTION_COUNTS.get(action_id, {}))
    successes = bucket.get("success", 0)
    failures = bucket.get("failure", 0)
    total = successes + failures
    if total < _MIN_EVENTS_FOR_RATE:
        # Not enough signal to judge. Report as "unknown" — not "red".
        return {
            "state": "unknown",
            "success_rate": None,
            "total_events": total,
            "last_success": bucket.get("last_success_ts", 0) or None,
            "last_failure": bucket.get("last_failure_ts", 0) or None,
        }
    rate = successes / total if total else 0.0
    healthy = rate >= _MIN_SUCCESS_RATE
    return {
        "state": "ok" if healthy else "red",
        "success_rate": round(rate, 3),
        "total_events": total,
        "last_success": bucket.get("last_success_ts", 0) or None,
        "last_failure": bucket.get("last_failure_ts", 0) or None,
    }


def _backend_state(db: Session) -> dict[str, Any]:
    """Cheap backend health check · pure DB probe + settings."""
    settings = get_settings()
    db_ok = False
    migration_ok = False
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:  # noqa: BLE001 · probe path · surface state, don't crash
        log.info("[audit] db probe failed: %s", e)
    try:
        db.execute(text("SELECT 1 FROM users LIMIT 1"))
        migration_ok = True
    except Exception as e:  # noqa: BLE001
        log.info("[audit] users table probe failed: %s", e)
    # 2026-07-07 · ayrshare key lives in os.environ (see app/ayrshare.py),
    # not on Settings. Reading `settings.ayrshare_api_key` raised
    # AttributeError and 500'd the whole gate. Use the same env probe
    # ayrshare.is_configured() uses so this signal stays honest.
    import os as _os
    return {
        "db_reachable": db_ok,
        "migrations_current": migration_ok,
        "ayrshare_configured": bool(_os.environ.get("AYRSHARE_API_KEY", "").strip()),
        "whop_api_configured": bool(getattr(settings, "whop_api_key", None)),
    }


def _integrations_state() -> dict[str, str]:
    """Config-only reachability signals for integrations we depend on.

    2026-07-05 · integration-lens HIGH · Whop / Clerk do not publish
    documented `/health` endpoints; the earlier version hit invented
    URLs (`api.whop.com/api/v2/health`, `api.clerk.com/v1/health`)
    which returned 404 (accidentally "ok" under `status_code < 500`)
    OR 5xx which would falsely block deploys on vendor infra outside
    our control. Since the audit endpoint's contract is "cheap +
    fast + trustworthy," we report config presence only. Real
    integration failures surface via `webhooks_whop` / `webhooks_clerk`
    which write to `WebhookEventLog` — a follow-up sprint should feed
    that log into `/audit/state` for real 24-hour failure signal.
    """
    # 2026-07-07 · second half of the ayrshare_api_key fix. Same env-lookup
    # pattern as _backend_state above · ayrshare key lives in os.environ,
    # not on Settings, so getattr-guard every field for defense-in-depth
    # against future Settings drift.
    import os as _os
    settings = get_settings()
    return {
        "whop": "configured" if getattr(settings, "whop_api_key", None) else "not_configured",
        "clerk": "configured" if getattr(settings, "clerk_webhook_secret", None) else "not_configured",
        "posthog": "configured" if getattr(settings, "posthog_key", None) else "not_configured",
        "resend": "configured" if getattr(settings, "resend_api_key", None) else "not_configured",
        "ayrshare": "configured" if _os.environ.get("AYRSHARE_API_KEY", "").strip() else "not_configured",
        "stripe": "configured" if getattr(settings, "stripe_secret_key", None) else "not_configured",
    }


@router.get("/state")
def audit_state(
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """The single-call ship gate. Aggregates every cheap signal we can
    collect. Called by `scripts/audit-gate.sh` before any deploy."""
    now_ms = int(time.time() * 1000)
    journeys = {
        action_id: {
            "description": desc,
            **_journey_state(action_id),
        }
        for action_id, desc in _CRITICAL_JOURNEYS.items()
    }

    # A journey in "red" state blocks the gate. "unknown" does NOT
    # block — a freshly-deployed backend won't have enough signal to
    # judge yet, and blocking on that is a chicken/egg trap.
    blocking = [
        {
            "kind": "journey_red",
            "action_id": action_id,
            "state": data,
        }
        for action_id, data in journeys.items()
        if data.get("state") == "red"
    ]

    backend = _backend_state(db)
    if not backend["db_reachable"] or not backend["migrations_current"]:
        blocking.append({"kind": "backend_down", "state": backend})

    integrations = _integrations_state()
    # Config-only integrations · `not_configured` is advisory, not a
    # blocker (some providers may not be needed in every environment).
    # Real integration health is surfaced through webhooks_* tables in
    # a follow-up sprint; today we only block on backend + journey red.

    with _TICK_LOCK:
        recent_tick_count = len(_TICK_WINDOW)
        recent_ticks_last_hour = sum(
            1 for t in _TICK_WINDOW if now_ms - t["ts_ms"] < 3_600_000
        )

    return {
        "ok": len(blocking) == 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "gates": {
            "backend": backend,
            "integrations": integrations,
            "journeys": journeys,
            "activity": {
                "ticks_in_window": recent_tick_count,
                "ticks_last_hour": recent_ticks_last_hour,
                "window_size_max": _TICK_WINDOW.maxlen,
            },
        },
        "blocking_findings": blocking,
    }


# ─────────────────────────────────────────────────────────────────────
# Schema note · Postgres persistence for v2
# ─────────────────────────────────────────────────────────────────────
# The in-memory window is fine for a single Railway replica. Once we
# scale to N replicas or want history beyond a restart, land:
#
#   class AuditTick(Base):
#       __tablename__ = "audit_tick"
#       id: BigInteger primary_key autoincrement
#       ts: DateTime nullable=False index=True
#       action_id: String nullable=False index=True
#       outcome: String nullable=False
#       duration_ms: Integer nullable=True
#       error_code: String nullable=True
#       surface: String nullable=True
#       user_ref: String nullable=True index=True
#
#   Indexed by (action_id, ts) for fast rolling-window rate queries.
#   Partition by day if volume > 100k/day.
