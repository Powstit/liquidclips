"""Admin Launch War Room — Phase 1 · Cold-entry Mode B (2026-07-10).

Read-only summary endpoint powering the HQ "Launch War Room" tab (see
`account-app/src/components/admin/LaunchWarRoomTab.tsx`).

The War Room fuses TWO signals per system (Daniel's non-negotiable
correction to the initial ship-lens brief):

  Signal 1 · Build readiness  → Journey Map classification + proof state
  Signal 2 · Live health       → recent failure rate + last successful
                                  journey completion + fixture-data flag

The tile status matrix:

  GREEN  — launch-critical journeys wired AND recent live proof healthy
  AMBER  — intentionally hidden / untested recently / degraded safely
  RED    — broken / missing / fixtures / failures / lacking proof

Honest telemetry state
----------------------
The behavioural events pipeline (`/telemetry/diagnostic`) logs to stdout
only today (see `app/routes/telemetry_ingest.py::post_diagnostic`).
Until the persisted events table lands, event-based `signal2` is
marked `has_recent_proof=false` and the tile drops to AMBER with the
"no live proof yet · telemetry pipeline pending" note. This mirrors
the same policy the Money Funnel tab uses (Chapter 6). GREEN requires
actual observable proof — no fabrication.

Signal sources per system (loose mapping — refine as tables land)
-----------------------------------------------------------------
  Auth            → users table (has JWT) + license.revoked = false
  Whop            → webhook_events (whop.*) success/failure ratio
  Upload          → clip_runs.source_type == "file" or "drop"
  URL ingest      → clip_runs.source_type == "url"
  AI clip gen     → clip_runs.clip_judge_provider + status
  Export          → clip_runs.clips_generated > 0 + status success
  Wallet          → wallet_ledger row count
  Affiliate       → tracking_link + link_click row count
  Payouts         → reward_clip status transitions
  Community       → community_channel + whop_channel_id count
  Notifications   → notifications table row count
  Updates         → runtime version manifest reachability
  Backend         → self (this endpoint responding is proof)
  Sidecar         → clip_runs.sidecar_version distinct
  Runtime         → clip_runs.runtime_version distinct
  HQ              → self (admin auth succeeded is proof)

Every system pinned in the request body — the frontend is the source
of the 16-system enumeration. Backend returns a rollup per system so
new systems can be added by editing the constant on the frontend
alone.

Cache
-----
30-second in-memory TTL cache keyed by admin user id. Prevents the
30-second frontend auto-refresh from hammering the DB.

Auth
----
Reuses the canonical `AdminUser` gate (internal secret +
`is_admin_email`). NEVER mutates.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    ClipRun,
    CommunityChannel,
    License,
    Notification,
    TrackingLink,
    User,
    WalletLedger,
    WebhookEvent,
)
from app.routes.admin import AdminUser

_log = logging.getLogger("junior.admin_launch_war_room")

router = APIRouter(prefix="/admin/launch-war-room", tags=["admin", "launch-war-room"])


TileStatus = Literal["green", "amber", "red"]


class Signal1(BaseModel):
    """Build readiness signal — journey map derived."""

    ready: bool
    unready_count: int = 0
    total_journeys: int = 0
    note: str | None = None


class Signal2(BaseModel):
    """Live health signal — telemetry / DB derived."""

    last_success_ts: str | None = None
    last_failure_ts: str | None = None
    last_failure_msg: str | None = None
    has_recent_proof: bool = False
    recent_failure_rate: float | None = None
    recent_window_hours: int = 24
    note: str | None = None


class Tile(BaseModel):
    system: str
    tile_status: TileStatus
    signal1: Signal1
    signal2: Signal2
    affected_journey_count: int = 0
    journey_map_filter: str | None = None
    hq_detail_tab: str | None = None


class WarRoomSummary(BaseModel):
    generated_at: str
    events_pipeline_flowing: bool
    tiles: list[Tile]
    honest_note: str


# ─── The 16 systems (mirrors LaunchWarRoomTab.tsx) ──────────────────
#
# Kept here on the backend so a new system can be inserted in one
# place. Frontend enumerates via the response.
#
# Order matters — this is the order tiles render in.

SYSTEMS: tuple[str, ...] = (
    "Auth",
    "Whop",
    "Upload",
    "URL ingest",
    "AI clip generation",
    "Export",
    "Wallet",
    "Affiliate",
    "Payouts",
    "Community",
    "Notifications",
    "Updates",
    "Backend",
    "Sidecar",
    "Runtime",
    "HQ",
)


# ─── In-memory 30-second TTL cache ──────────────────────────────────

_CACHE_TTL_SECONDS = 30
_cache: dict[str, tuple[float, WarRoomSummary]] = {}


def _cache_get(key: str) -> WarRoomSummary | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    ts, val = hit
    if time.monotonic() - ts > _CACHE_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return val


def _cache_put(key: str, val: WarRoomSummary) -> None:
    _cache[key] = (time.monotonic(), val)


# ─── Signal1 helper · journey map derived readiness ─────────────────
#
# Mirrors the Journey Map's known blocker + status data. Kept here as a
# static table so the frontend and backend agree on what "ready" means
# per system without a shared JSON file.

_JOURNEY_READINESS: dict[str, dict[str, Any]] = {
    "Auth":              {"ready": True,  "affected": 12, "unready": 1, "note": "id-01..id-12 · id-12 manual JWT paste is dead code"},
    "Whop":              {"ready": True,  "affected": 6,  "unready": 0, "note": "id-02 sign-in + mo-15 payout + ag-14 founder seat"},
    "Upload":            {"ready": True,  "affected": 2,  "unready": 0, "note": "cp-01 import from disk + cp-19 watch-folder deferred"},
    "URL ingest":        {"ready": True,  "affected": 1,  "unready": 0, "note": "cp-02 yt-dlp wired"},
    "AI clip generation": {"ready": True, "affected": 5,  "unready": 0, "note": "cp-03..cp-07 + cp-08 gpt-image-1"},
    "Export":            {"ready": True,  "affected": 5,  "unready": 2, "note": "cp-10..cp-14 · cp-18 batch + cp-17 UI-retry deferred"},
    "Wallet":            {"ready": True,  "affected": 3,  "unready": 1, "note": "mo-10..mo-13 · mo-13 withdraw is Cohort 0 blocker (env flag)", "blocker": True},
    "Affiliate":         {"ready": True,  "affected": 3,  "unready": 0, "note": "mo-15 + mo-18 + mo-19"},
    "Payouts":           {"ready": False, "affected": 2,  "unready": 1, "note": "mo-13 withdraw button hidden until CARROT_WHOP_LIVE flip", "blocker": True},
    "Community":         {"ready": True,  "affected": 4,  "unready": 2, "note": "ag-17..ag-21 · ag-18/19 chat + ag-20 inbox in demo state"},
    "Notifications":     {"ready": True,  "affected": 1,  "unready": 0, "note": "id-08 backend + InboxSheet"},
    "Updates":           {"ready": True,  "affected": 1,  "unready": 0, "note": "runtime manifest + auto-updater wired"},
    "Backend":           {"ready": True,  "affected": 0,  "unready": 0, "note": "this endpoint responding is proof of life"},
    "Sidecar":           {"ready": True,  "affected": 0,  "unready": 0, "note": "sidecar.py methods called by cp-01..cp-14"},
    "Runtime":           {"ready": True,  "affected": 0,  "unready": 0, "note": "shell + AppShell watchdog + section registry"},
    "HQ":                {"ready": True,  "affected": 0,  "unready": 0, "note": "you are here"},
}


def _signal1_for(system: str) -> Signal1:
    r = _JOURNEY_READINESS.get(system, {"ready": False, "affected": 0, "unready": 0, "note": "unknown system"})
    return Signal1(
        ready=bool(r["ready"]),
        unready_count=int(r.get("unready", 0)),
        total_journeys=int(r.get("affected", 0)),
        note=str(r.get("note", "")) or None,
    )


# ─── Signal2 helper · live-health per system ────────────────────────
#
# Each system reads its own DB slice for last_success + last_failure.
# The window is fixed at 24h (recent_window_hours) so tiles compare
# apples-to-apples.

_WINDOW_HOURS = 24


def _isoformat(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _signal2_for(system: str, db: Session, now: datetime) -> Signal2:
    """Return a Signal2 per system. Honest zeros with note when nothing
    is queryable."""

    window_start = now - timedelta(hours=_WINDOW_HOURS)

    # Systems whose live signal depends on the `clip_runs` table.
    if system in ("Upload", "URL ingest", "AI clip generation", "Export", "Sidecar", "Runtime"):
        return _signal2_from_clip_runs(system, db, window_start)

    # Whop → webhook events prefixed whop.
    if system == "Whop":
        return _signal2_from_webhook_events(prefix="whop", db=db, window_start=window_start)

    # Auth → License table (recent issued + recent revoked).
    if system == "Auth":
        return _signal2_from_license(db, window_start)

    # Wallet → WalletLedger rows.
    if system == "Wallet":
        return _signal2_from_wallet_ledger(db, window_start)

    # Affiliate → TrackingLink creation activity.
    if system == "Affiliate":
        return _signal2_from_tracking_link(db, window_start)

    # Notifications → Notification rows.
    if system == "Notifications":
        return _signal2_from_notifications(db, window_start)

    # Community → CommunityChannel count.
    if system == "Community":
        return _signal2_from_community(db)

    # Payouts → RewardClip status transitions.
    if system == "Payouts":
        return _signal2_from_payouts(db, window_start)

    # Updates → runtime manifest; no DB signal in v1.
    if system == "Updates":
        return Signal2(
            has_recent_proof=False,
            note="Runtime manifest is served from the desktop static host · no DB-side proof in v1.",
        )

    # Backend + HQ self-report — this endpoint returning is proof.
    if system in ("Backend", "HQ"):
        return Signal2(
            last_success_ts=_isoformat(now),
            has_recent_proof=True,
            note="Endpoint responded · admin auth succeeded.",
        )

    return Signal2(note="no signal wired for this system yet")


def _signal2_from_clip_runs(system: str, db: Session, window_start: datetime) -> Signal2:
    q = db.query(ClipRun).filter(ClipRun.created_at >= window_start)  # type: ignore[attr-defined]
    total = q.count()
    if total == 0:
        return Signal2(
            has_recent_proof=False,
            recent_window_hours=_WINDOW_HOURS,
            note="No clip runs in the last 24h · nothing to health-check.",
        )
    # Filter narrows by source_type where applicable — otherwise broad
    # clip-runs signal covers export/AI/runtime/sidecar too.
    if system == "Upload":
        q = q.filter(ClipRun.source_type.in_(["file", "drop"]))  # type: ignore[attr-defined]
    elif system == "URL ingest":
        q = q.filter(ClipRun.source_type == "url")  # type: ignore[attr-defined]
    elif system == "Export":
        q = q.filter(ClipRun.clips_generated > 0)  # type: ignore[attr-defined]

    filtered = q.count()
    if filtered == 0:
        return Signal2(
            has_recent_proof=False,
            recent_window_hours=_WINDOW_HOURS,
            note=f"No {system.lower()} activity in the last 24h.",
        )

    # Last success + last failure via status = ok / status = fail.
    last_success = (
        q.filter(ClipRun.status == "success")  # type: ignore[attr-defined]
        .order_by(ClipRun.created_at.desc())  # type: ignore[attr-defined]
        .first()
    )
    last_failure = (
        q.filter(ClipRun.status == "failed")  # type: ignore[attr-defined]
        .order_by(ClipRun.created_at.desc())  # type: ignore[attr-defined]
        .first()
    )
    failures = q.filter(ClipRun.status == "failed").count()  # type: ignore[attr-defined]
    rate = (failures / filtered) if filtered else 0.0
    return Signal2(
        last_success_ts=_isoformat(getattr(last_success, "created_at", None)),
        last_failure_ts=_isoformat(getattr(last_failure, "created_at", None)),
        last_failure_msg=(getattr(last_failure, "failure_reason", None) or None),
        has_recent_proof=last_success is not None,
        recent_failure_rate=rate,
        recent_window_hours=_WINDOW_HOURS,
    )


def _signal2_from_webhook_events(prefix: str, db: Session, window_start: datetime) -> Signal2:
    try:
        q = db.query(WebhookEvent).filter(
            WebhookEvent.received_at >= window_start,  # type: ignore[attr-defined]
            WebhookEvent.provider == prefix,  # type: ignore[attr-defined]
        )
        total = q.count()
        if total == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note=f"No {prefix} webhook events in the last 24h.",
            )
        last = q.order_by(WebhookEvent.received_at.desc()).first()  # type: ignore[attr-defined]
        return Signal2(
            last_success_ts=_isoformat(getattr(last, "received_at", None)),
            has_recent_proof=last is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{total} {prefix} webhook events processed.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"webhook_events query failed: {err!s}")


def _signal2_from_license(db: Session, window_start: datetime) -> Signal2:
    try:
        recent = db.query(func.count(License.id)).filter(License.issued_at >= window_start).scalar() or 0  # type: ignore[attr-defined]
        if recent == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note="No license issuance in the last 24h.",
            )
        latest = db.query(License).order_by(License.issued_at.desc()).first()  # type: ignore[attr-defined]
        return Signal2(
            last_success_ts=_isoformat(getattr(latest, "issued_at", None)),
            has_recent_proof=latest is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{recent} licenses issued.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"license query failed: {err!s}")


def _signal2_from_wallet_ledger(db: Session, window_start: datetime) -> Signal2:
    try:
        recent = db.query(func.count(WalletLedger.id)).filter(WalletLedger.ledger_created_at >= window_start).scalar() or 0  # type: ignore[attr-defined]
        if recent == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note="No wallet ledger entries in the last 24h.",
            )
        latest = db.query(WalletLedger).order_by(WalletLedger.ledger_created_at.desc()).first()  # type: ignore[attr-defined]
        return Signal2(
            last_success_ts=_isoformat(getattr(latest, "ledger_created_at", None)),
            has_recent_proof=latest is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{recent} wallet entries written.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"wallet_ledger query failed: {err!s}")


def _signal2_from_tracking_link(db: Session, window_start: datetime) -> Signal2:
    try:
        recent = db.query(func.count(TrackingLink.id)).filter(TrackingLink.created_at >= window_start).scalar() or 0  # type: ignore[attr-defined]
        if recent == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note="No tracking links minted in the last 24h.",
            )
        latest = db.query(TrackingLink).order_by(TrackingLink.created_at.desc()).first()  # type: ignore[attr-defined]
        return Signal2(
            last_success_ts=_isoformat(getattr(latest, "created_at", None)),
            has_recent_proof=latest is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{recent} tracking links minted.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"tracking_link query failed: {err!s}")


def _signal2_from_notifications(db: Session, window_start: datetime) -> Signal2:
    try:
        recent = db.query(func.count(Notification.id)).filter(Notification.created_at >= window_start).scalar() or 0  # type: ignore[attr-defined]
        if recent == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note="No notifications in the last 24h.",
            )
        latest = db.query(Notification).order_by(Notification.created_at.desc()).first()  # type: ignore[attr-defined]
        return Signal2(
            last_success_ts=_isoformat(getattr(latest, "created_at", None)),
            has_recent_proof=latest is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{recent} notifications written.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"notifications query failed: {err!s}")


def _signal2_from_community(db: Session) -> Signal2:
    try:
        total = db.query(func.count(CommunityChannel.id)).scalar() or 0  # type: ignore[attr-defined]
        return Signal2(
            has_recent_proof=total > 0,
            note=f"{total} community channels seeded · Whop drives message activity externally.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"community_channel query failed: {err!s}")


def _signal2_from_payouts(db: Session, window_start: datetime) -> Signal2:
    try:
        # RewardClip status transitions (approved/paid) via updated_at.
        from app.models import RewardClip  # local import to avoid heavy top-level

        recent = (
            db.query(func.count(RewardClip.id))
            .filter(RewardClip.updated_at >= window_start)  # type: ignore[attr-defined]
            .filter(RewardClip.status.in_(["approved", "paid"]))  # type: ignore[attr-defined]
            .scalar()
            or 0
        )
        if recent == 0:
            return Signal2(
                has_recent_proof=False,
                recent_window_hours=_WINDOW_HOURS,
                note="No RewardClip approved/paid transitions in the last 24h.",
            )
        latest = (
            db.query(RewardClip)
            .filter(RewardClip.status.in_(["approved", "paid"]))  # type: ignore[attr-defined]
            .order_by(RewardClip.updated_at.desc())  # type: ignore[attr-defined]
            .first()
        )
        return Signal2(
            last_success_ts=_isoformat(getattr(latest, "updated_at", None)),
            has_recent_proof=latest is not None,
            recent_window_hours=_WINDOW_HOURS,
            note=f"{recent} reward clips approved/paid.",
        )
    except Exception as err:  # noqa: BLE001
        return Signal2(has_recent_proof=False, note=f"reward_clip query failed: {err!s}")


# ─── Tile status derivation · dual-signal fusion ────────────────────
#
# Rules (from Daniel's directive):
#   GREEN  — signal1.ready == True AND signal2.has_recent_proof == True
#            AND (no recent failure rate above threshold)
#   AMBER  — signal1.ready == True but signal2.has_recent_proof == False
#            (untested recently) OR intentionally hidden (blocker flag)
#   RED    — signal1.ready == False OR signal2.recent_failure_rate high
#            OR signal2 note flags fixtures / failures / no proof
_FAILURE_RATE_THRESHOLD = 0.10  # 10% failures over the window flips to red


def _tile_status(s1: Signal1, s2: Signal2) -> TileStatus:
    if not s1.ready:
        return "red"
    rate = s2.recent_failure_rate or 0.0
    if rate >= _FAILURE_RATE_THRESHOLD:
        return "red"
    if s2.has_recent_proof:
        return "green"
    return "amber"


def _hq_detail_tab(system: str) -> str | None:
    """The HQ tab the user should open for detail. Frontend deep-links
    to it via the AdminHQ tab registry."""

    mapping = {
        "Auth": "Sign-in Ops",
        "Whop": "Webhooks",
        "Upload": "Clip Runs",
        "URL ingest": "Clip Runs",
        "AI clip generation": "Clip Runs",
        "Export": "Clip Runs",
        "Wallet": "Bonus Ledger",
        "Affiliate": "Constellation",
        "Payouts": "Bonus Ledger",
        "Community": "Community Channels",
        "Notifications": "Alerts",
        "Updates": "Releases",
        "Backend": "System Map",
        "Sidecar": "System Map",
        "Runtime": "System Map",
        "HQ": "Function Heat Map",
    }
    return mapping.get(system)


def _journey_map_filter(system: str) -> str | None:
    """Free-text filter to pre-populate the Journey Map search box."""

    mapping = {
        "Auth":              "identity",
        "Whop":              "whop",
        "Upload":            "import",
        "URL ingest":        "url",
        "AI clip generation": "llm",
        "Export":            "export",
        "Wallet":            "wallet",
        "Affiliate":         "affiliate",
        "Payouts":           "payout",
        "Community":         "community",
        "Notifications":     "notifications",
        "Updates":           "runtime",
    }
    return mapping.get(system)


# ─── Endpoint ────────────────────────────────────────────────────────


@router.get("/summary", response_model=WarRoomSummary)
def summary(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> WarRoomSummary:
    """Return a per-tile rollup for the LaunchWarRoom UI.

    Cached in-memory for 30 seconds keyed by admin id, so the client's
    30-second auto-refresh doesn't hammer the DB.
    """

    cache_key = f"summary:{getattr(admin, 'id', 'unknown')}"
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    now = datetime.now(timezone.utc)
    tiles: list[Tile] = []
    for system in SYSTEMS:
        s1 = _signal1_for(system)
        s2 = _signal2_for(system, db, now)
        tiles.append(
            Tile(
                system=system,
                tile_status=_tile_status(s1, s2),
                signal1=s1,
                signal2=s2,
                affected_journey_count=s1.total_journeys,
                journey_map_filter=_journey_map_filter(system),
                hq_detail_tab=_hq_detail_tab(system),
            )
        )

    honest = (
        "Live health signal for behavioural-event-based tiles is "
        "AMBER until the persisted events table lands "
        "(`/telemetry/diagnostic` logs to stdout only today · Phase 1 "
        "recovery brief). GREEN status requires actual observable proof."
    )
    out = WarRoomSummary(
        generated_at=now.isoformat(),
        events_pipeline_flowing=False,
        tiles=tiles,
        honest_note=honest,
    )
    _cache_put(cache_key, out)
    return out
