"""D · /arcade/prize/* — prize scaling + winner select + idempotent dispatch."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import ArcadeSubmission, User, WinnerPayout
from app.routes import arcade_prize as arcade_prize_module
from app.routes.arcade_prize import prize_amount_cents


@pytest.fixture(autouse=True)
def _clear_internal_secret(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_SECRET", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield
    get_settings.cache_clear()  # type: ignore[attr-defined]


@pytest.fixture()
def client_and_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(arcade_prize_module.router)
    app.dependency_overrides[get_db] = override_get_db

    with SessionLocal() as seed:
        yield TestClient(app), seed
    app.dependency_overrides.clear()


def _mk_user(session, *, email: str, tier: str = "solo", subscription_status: str = "active", handle: str | None = None, whop_sub_merchant_id: str | None = None):
    u = User(
        id=uuid.uuid4().hex,
        clerk_id=f"clerk_{uuid.uuid4().hex[:8]}",
        email=email,
        tier=tier,
        subscription_status=subscription_status,
        handle=handle,
        whop_sub_merchant_id=whop_sub_merchant_id,
    )
    session.add(u)
    session.commit()
    return u


def _mk_submission(session, *, user_id: str, score: int, month_key: str = "2026-07"):
    row = ArcadeSubmission(
        id=uuid.uuid4().hex,
        user_id=user_id,
        score=score,
        wave=5,
        duration_ms=45_000,
        shots_fired=200,
        # Anchor into the middle of the target month so month-bounds queries capture it
        created_at=datetime.strptime(month_key + "-15", "%Y-%m-%d").replace(tzinfo=timezone.utc),
    )
    session.add(row)
    session.commit()
    return row


# --- prize scaling formula ---


def test_prize_scaling_formula():
    """$1k → $2k → $4k → $8k → $16k per 1000-sub milestone, capped."""
    assert prize_amount_cents(0)     == 100_000
    assert prize_amount_cents(999)   == 100_000
    assert prize_amount_cents(1000)  == 200_000
    assert prize_amount_cents(1500)  == 200_000
    assert prize_amount_cents(2000)  == 400_000
    assert prize_amount_cents(3000)  == 800_000
    assert prize_amount_cents(4000)  == 1_600_000
    # Cap at milestone 4
    assert prize_amount_cents(50_000) == 1_600_000


# --- GET /arcade/prize/current ---


def test_current_prize_no_scorers_yet(client_and_session):
    client, session = client_and_session
    r = client.get("/arcade/prize/current")
    assert r.status_code == 200
    body = r.json()
    assert body["prize_amount_cents"] == 100_000
    assert body["current_leader"] is None


def test_current_prize_leader_from_this_month(client_and_session):
    client, session = client_and_session
    winner = _mk_user(session, email="w@example.com", handle="KingKade")
    from app.routes.arcade_prize import _current_month_key
    _mk_submission(session, user_id=winner.id, score=42_500, month_key=_current_month_key())

    r = client.get("/arcade/prize/current")
    body = r.json()
    assert body["current_leader"]["handle"] == "KingKade"
    assert body["current_leader"]["score"] == 42_500


def test_current_prize_ignores_other_months(client_and_session):
    """Only submissions IN the current month count toward the leader."""
    client, session = client_and_session
    other_month_user = _mk_user(session, email="last@example.com", handle="Older")
    _mk_submission(session, user_id=other_month_user.id, score=99_999, month_key="2025-01")

    r = client.get("/arcade/prize/current")
    assert r.json()["current_leader"] is None


def test_current_prize_scales_with_paid_subs(client_and_session):
    client, session = client_and_session
    # 1000 paid subs → milestone 1 → $2,000
    for _ in range(1000):
        _mk_user(session, email=f"{uuid.uuid4().hex[:6]}@ex.com")
    r = client.get("/arcade/prize/current")
    body = r.json()
    assert body["paid_sub_count"] == 1000
    assert body["prize_amount_cents"] == 200_000


# --- POST /arcade/prize/dispatch ---


def test_dispatch_no_winner_records_terminal_row(client_and_session):
    client, session = client_and_session
    admin = _mk_user(session, email="danieldiyepriye@gmail.com")

    r = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "no_winner"

    # Second call for the same month short-circuits with same state
    r2 = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    assert r2.json()["state"] == "no_winner"


def test_dispatch_records_pending_onboarding_when_no_sub_merchant(client_and_session):
    client, session = client_and_session
    admin = _mk_user(session, email="danieldiyepriye@gmail.com")
    winner = _mk_user(session, email="w@example.com", handle="Winner")  # no sub-merchant
    _mk_submission(session, user_id=winner.id, score=5000, month_key="2025-06")

    r = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    body = r.json()
    assert body["state"] == "pending_winner_onboarding"
    assert body["whop_transfer_id"] is None
    assert "onboarding" in (body.get("error_message") or "").lower()


def test_dispatch_pays_via_mock_whop_when_sub_merchant_present(client_and_session):
    client, session = client_and_session
    admin = _mk_user(session, email="danieldiyepriye@gmail.com")
    winner = _mk_user(
        session,
        email="w@example.com",
        handle="Winner",
        whop_sub_merchant_id="sm_xyz",
    )
    _mk_submission(session, user_id=winner.id, score=42_500, month_key="2025-06")

    r = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    body = r.json()
    assert body["state"] == "paid"
    assert body["amount_cents"] == 100_000
    assert body["whop_transfer_id"] and body["whop_transfer_id"].startswith("fake_xfer_")


def test_dispatch_idempotent_second_call_returns_existing(client_and_session):
    client, session = client_and_session
    admin = _mk_user(session, email="danieldiyepriye@gmail.com")
    winner = _mk_user(
        session,
        email="w@example.com",
        handle="Winner",
        whop_sub_merchant_id="sm_xyz",
    )
    _mk_submission(session, user_id=winner.id, score=42_500, month_key="2025-06")

    r1 = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    r2 = client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    assert r1.json()["whop_transfer_id"] == r2.json()["whop_transfer_id"]

    # Only one row landed
    rows = session.query(WinnerPayout).filter_by(month="2025-06").all()
    assert len(rows) == 1


def test_non_admin_dispatch_rejected(client_and_session):
    client, session = client_and_session
    non_admin = _mk_user(session, email="notanadmin@example.com")

    r = client.post(
        f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={non_admin.clerk_id}"
    )
    assert r.status_code == 403


# --- GET /arcade/prize/history ---


def test_history_returns_only_paid_rows(client_and_session):
    client, session = client_and_session
    admin = _mk_user(session, email="danieldiyepriye@gmail.com")
    winner_paid = _mk_user(
        session,
        email="w1@example.com",
        handle="Paid",
        whop_sub_merchant_id="sm_1",
    )
    winner_pending = _mk_user(
        session,
        email="w2@example.com",
        handle="Pending",
    )  # no sub-merchant → pending row
    _mk_submission(session, user_id=winner_paid.id, score=5000, month_key="2025-06")
    _mk_submission(session, user_id=winner_pending.id, score=6000, month_key="2025-05")

    client.post(f"/arcade/prize/dispatch?month=2025-06&clerk_user_id={admin.clerk_id}")
    client.post(f"/arcade/prize/dispatch?month=2025-05&clerk_user_id={admin.clerk_id}")

    r = client.get("/arcade/prize/history")
    body = r.json()
    assert len(body["winners"]) == 1
    assert body["winners"][0]["month"] == "2025-06"
    assert body["winners"][0]["state"] == "paid"
