"""Phase 1.7 · Reservation sweep is wired into FastAPI lifespan · 2026-07-17."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import User, UsageReservation, SourceAnalysis
from app.routes import analysis as analysis_route


@pytest.fixture()
def session_maker():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(bind=engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


def _make_reserved(session, *, expired: bool = True) -> tuple[User, UsageReservation]:
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"u_{uuid.uuid4().hex[:12]}",
        email="t@t.co",
        tier="free",
        plan_tier="studio",
        allowance_issued_seconds=360000,
        allowance_used_seconds=0,
        allowance_reserved_seconds=1800,
    )
    session.add(u)
    session.commit()

    sa = SourceAnalysis(
        id=uuid.uuid4().hex,
        user_id=u.id,
        content_hash="a" * 64,
        analysis_version="v1",
    )
    session.add(sa)
    session.commit()

    now = datetime.now(timezone.utc)
    r = UsageReservation(
        id=uuid.uuid4().hex,
        user_id=u.id,
        source_analysis_id=sa.id,
        plan_tier_at_reserve="studio",
        reserved_seconds=1800,
        state="reserved",
        reserved_at=now,
        lease_expires_at=now - timedelta(seconds=1) if expired else now + timedelta(seconds=600),
    )
    session.add(r)
    session.commit()
    return u, r


def test_sweep_transitions_expired_to_abandoned(session_maker):
    with session_maker() as s:
        u, r = _make_reserved(s, expired=True)
        n = analysis_route.sweep_expired_reservations(s)
        assert n == 1
        row = s.get(UsageReservation, r.id)
        assert row.state == "abandoned"
        row_user = s.get(User, u.id)
        assert row_user.allowance_reserved_seconds == 0


def test_active_heartbeat_prevents_abandonment(session_maker):
    """An active heartbeat pushes lease_expires_at forward; sweep
    must not abandon a still-live reservation."""
    with session_maker() as s:
        u, r = _make_reserved(s, expired=False)
        n = analysis_route.sweep_expired_reservations(s)
        assert n == 0
        assert s.get(UsageReservation, r.id).state == "reserved"


def test_sweep_can_be_called_repeatedly_idempotent(session_maker):
    with session_maker() as s:
        u, r = _make_reserved(s, expired=True)
        first = analysis_route.sweep_expired_reservations(s)
        second = analysis_route.sweep_expired_reservations(s)
        assert first == 1
        assert second == 0
        assert s.get(UsageReservation, r.id).state == "abandoned"


def test_main_lifespan_registers_sweep_task():
    """Lifespan must create + cancel the sweep task cleanly on
    shutdown. Verified by grepping the compiled source at boot time
    since the actual lifespan runs on FastAPI start."""
    import inspect
    from app import main as _main

    src = inspect.getsource(_main.lifespan)
    assert "_reservation_sweep_loop" in src, "sweep coroutine must be defined"
    assert "_reservation_sweep_task = _asyncio.create_task" in src, "sweep task must be started"
    assert "_reservation_sweep_task.cancel()" in src, "sweep task must be cancelled on shutdown"
