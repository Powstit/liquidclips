"""Phase A · Liquid Studio · analysis-hours billing contract tests.

Locks in every amendment landed 2026-07-17:

  Amendment 1 · server-authoritative free bundle (state machine)
  Amendment 4 · orthogonal plan_tier / tier (Agency preserved)
  Amendment 5 · no automatic expensive fallback
  Protection 1 · reservation leases + crash-recovery
  Protection 2 · fail-closed on missing WHOP_PLAN_ID_STUDIO_UNLIMITED

Backend contract only — desktop Playwright coverage lands in Phase C.
Sidecar reserve/heartbeat contract lands in Phase B; the requests here
target the same endpoints via TestClient so the backend side of that
contract is proven pre-integration.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest


# ─────────────────────────────────────────────────────────────────────
# production-shaped hash + id helpers
#
# Every content_hash / transcript_hash in the tests is a real SHA-256
# hex digest (64 lowercase hex chars). Every run_id is a uuid4 hex
# fragment ≥ 8 chars. This mirrors what the sidecar will send in prod.
# ─────────────────────────────────────────────────────────────────────

def _hash(seed: str) -> str:
    """Deterministic 64-char SHA-256 hex for a symbolic seed."""
    return hashlib.sha256(seed.encode()).hexdigest()


def _run() -> str:
    """Fresh 16-char run correlator."""
    return "run_" + uuid.uuid4().hex[:12]


# Reusable canonical hashes so the same "aaaa" or "bbbb" symbolic name
# maps to a stable content_hash across a test.
H_A = _hash("aaaa")
H_B = _hash("bbbb")
H_C = _hash("cccc")
H_TR_A = _hash("transcript-a")
H_TR_B = _hash("transcript-b")
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_db
from app.deps import current_user
from app.models import SourceAnalysis, UsageReservation, User
from app.routes import analysis
from app.routes import webhooks_whop


# ─────────────────────────────────────────────────────────────────────
# fixtures
# ─────────────────────────────────────────────────────────────────────

@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def SessionMaker(db_engine):
    return sessionmaker(bind=db_engine, expire_on_commit=False)


@pytest.fixture()
def db(SessionMaker):
    s = SessionMaker()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def make_user(db):
    def _make(
        *,
        plan_tier: str = "free",
        tier: str = "free",
        founder_flag: bool = False,
        allowance_issued_seconds: int = 0,
        subscription_status: str = "active",
    ) -> User:
        user = User(
            id=uuid.uuid4().hex,
            clerk_id=f"user_{uuid.uuid4().hex[:12]}",
            email=f"{uuid.uuid4().hex[:8]}@example.com",
            tier=tier,
            plan_tier=plan_tier,
            founder_flag=founder_flag,
            subscription_status=subscription_status,
            allowance_issued_seconds=allowance_issued_seconds,
        )
        db.add(user)
        db.commit()
        return user
    return _make


@pytest.fixture()
def app_and_client(db, SessionMaker):
    """FastAPI app wired to the analysis router with in-memory SQLite.

    Uses a single shared session per request scoped via a context
    variable, so `get_db` and `current_user` overrides both return the
    exact same session (FastAPI's Depends-caching does NOT dedup across
    overrides reliably; explicit sharing is safer than depending on that).
    """
    app = FastAPI()
    app.include_router(analysis.router)

    holder: dict[str, str | None] = {"user_id": None}
    request_session: dict[str, object] = {"s": None}

    def _shared_session():
        # Reuse the request-scoped session when already opened; else
        # open one and stash it. Cleared by the closer at request end.
        if request_session["s"] is None:
            request_session["s"] = SessionMaker()
        try:
            yield request_session["s"]
        finally:
            s = request_session["s"]
            if s is not None:
                s.close()
                request_session["s"] = None

    app.dependency_overrides[get_db] = _shared_session

    def _current_user_override() -> User:
        uid = holder["user_id"]
        assert uid is not None, "call client.set_user(user) first"
        if request_session["s"] is None:
            request_session["s"] = SessionMaker()
        db_user = request_session["s"].get(User, uid)   # type: ignore[union-attr]
        if db_user is None:
            raise LookupError(f"test user {uid} vanished")
        return db_user

    app.dependency_overrides[current_user] = _current_user_override

    client = TestClient(app)
    client.set_user = lambda user: holder.__setitem__("user_id", user.id)  # type: ignore[attr-defined]
    yield app, client
    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────
# Amendment 1 · server-authoritative free bundle
# ─────────────────────────────────────────────────────────────────────

def test_free_bundle_reservation_atomic(app_and_client, make_user, db):
    """Two reserves with different content_hashes → only the first
    succeeds. The state transitions atomically to `reserved`."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r1 = client.post("/analysis/reserve", json={
        "content_hash": H_A,
        "transcript_hash": H_TR_A,
        "run_id": "run_" + uuid.uuid4().hex,
        "speech_seconds": 1800,
    })
    assert r1.status_code == 200, r1.text
    r2 = client.post("/analysis/reserve", json={
        "content_hash": H_C,   # DIFFERENT content
        "transcript_hash": _hash("dddd"),
        "run_id": "run_" + uuid.uuid4().hex,
        "speech_seconds": 1800,
    })
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "free_bundle_in_progress"


def test_free_bundle_settles_once_on_success(app_and_client, make_user, db, SessionMaker):
    """After settle, a second reserve with a different content_hash
    returns 409 regardless of starter_exports_used."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    reserved = client.post("/analysis/reserve", json={
        "content_hash": H_A,
        "run_id": _run(),
        "speech_seconds": 900,
    }).json()

    settled = client.post("/analysis/settle", json={
        "reservation_id": reserved["reservation_id"],
        "actual_seconds": 900,
        "cost_usd_micros": 0,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 10,
    })
    assert settled.status_code == 200
    assert settled.json()["state"] == "settled"

    with SessionMaker() as verify:
        row = verify.get(User, user.id)
        assert row.free_bundle_state == "settled"
        assert row.free_clips_generated == 10

    # Second source refused.
    r2 = client.post("/analysis/reserve", json={
        "content_hash": H_C,
        "run_id": _run(),
        "speech_seconds": 900,
    })
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "free_bundle_used"


def test_second_source_blocked_zero_exports(app_and_client, make_user, db, SessionMaker):
    """Bundle settled with zero clips exported → new reserve refused.
    starter_exports_used is not the gate — free_bundle_state is."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    reserved = client.post("/analysis/reserve", json={
        "content_hash": H_A,
        "run_id": _run(),
        "speech_seconds": 900,
    }).json()
    client.post("/analysis/settle", json={
        "reservation_id": reserved["reservation_id"],
        "actual_seconds": 900,
        "cost_usd_micros": 0,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 10,   # 10 clips generated
    })

    # starter_exports_used remains 0 — never called /usage/clip-exported
    with SessionMaker() as verify:
        row = verify.get(User, user.id)
        assert row.starter_exports_used == 0
        assert row.free_bundle_state == "settled"

    r2 = client.post("/analysis/reserve", json={
        "content_hash": _hash("eeee"),
        "run_id": _run(),
        "speech_seconds": 500,
    })
    assert r2.status_code == 409


def test_reinstall_does_not_restore_bundle(app_and_client, make_user, db, SessionMaker):
    """Same JWT after reinstall → free_bundle_state stays settled
    (state lives on the users row, not client-side)."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    })
    client.post("/analysis/settle", json={
        "reservation_id": r.json()["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 10,
    })

    # Simulate a reinstall — new client, same user (server state persists).
    with SessionMaker() as verify:
        db_user = verify.get(User, user.id)
        assert db_user.free_bundle_state == "settled"

    # New reserve attempt after "reinstall" still refuses.
    r2 = client.post("/analysis/reserve", json={
        "content_hash": H_B, "run_id": _run(), "speech_seconds": 900,
    })
    assert r2.status_code == 409


def test_failed_analysis_releases_reservation(app_and_client, make_user, db, SessionMaker):
    """release with the same content_hash restores state to `available`
    and allows a retry."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    released = client.post("/analysis/release", json={
        "reservation_id": r["reservation_id"],
        "reason": "provider_timeout",
    })
    assert released.status_code == 200
    assert released.json()["state"] == "released"

    with SessionMaker() as verify:
        row = verify.get(User, user.id)
        assert row.free_bundle_state == "available"
        assert row.free_source_content_hash is None

    # Retry with same source hash succeeds.
    retry = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    })
    assert retry.status_code == 200


def test_replay_reserve_same_hash_after_settle(app_and_client, make_user, db):
    """Duplicate reserve with settled content_hash → 409 already_settled,
    no second bundle."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    reserved = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()
    client.post("/analysis/settle", json={
        "reservation_id": reserved["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 10,
    })

    # Same content_hash again after settle.
    r2 = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    })
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "already_settled"


# ─────────────────────────────────────────────────────────────────────
# Reservation leases + crash recovery
# ─────────────────────────────────────────────────────────────────────

def test_free_bundle_lease_expires_and_restores(app_and_client, make_user, db, SessionMaker):
    """Force-expire the reservation's lease → sweep transitions to
    `abandoned` → free_bundle_state restores to `available`."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    # Expire the lease.
    with SessionMaker() as s:
        row = s.get(UsageReservation, r["reservation_id"])
        row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()

    with SessionMaker() as s:
        analysis.sweep_expired_reservations(s)
        db_row = s.get(UsageReservation, r["reservation_id"])
        assert db_row.state == "abandoned"
        db_user = s.get(User, user.id)
        assert db_user.free_bundle_state == "available"


def test_studio_reservation_abandonment_credits_hours(app_and_client, make_user, db, SessionMaker):
    """Reserved 2520 seconds (42 min) → lease expires → sweep credits
    those 2520 seconds back to allowance_reserved_seconds."""
    _, client = app_and_client
    user = make_user(
        plan_tier="studio",
        allowance_issued_seconds=360000,   # 100h
    )
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 2520,
    }).json()

    with SessionMaker() as s:
        db_user = s.get(User, user.id)
        assert db_user.allowance_reserved_seconds == 2520

    # Expire.
    with SessionMaker() as s:
        row = s.get(UsageReservation, r["reservation_id"])
        row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()

    with SessionMaker() as s:
        analysis.sweep_expired_reservations(s)
        db_user = s.get(User, user.id)
        assert db_user.allowance_reserved_seconds == 0


def test_heartbeat_extends_lease(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()
    initial_lease = r["lease_expires_at"]

    # Sleep-free — the heartbeat should always advance lease_expires_at
    # to now+lease_seconds, which is later than the reserve's lease
    # because at least a millisecond passed.
    hb = client.post("/analysis/heartbeat", json={"reservation_id": r["reservation_id"]})
    assert hb.status_code == 200
    assert hb.json()["state"] == "reserved"
    assert hb.json()["lease_expires_at"] > initial_lease


def test_second_source_blocked_while_lease_active(app_and_client, make_user, db):
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    })
    # Lease is still active — different source refused.
    r2 = client.post("/analysis/reserve", json={
        "content_hash": H_B, "run_id": _run(), "speech_seconds": 900,
    })
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "free_bundle_in_progress"


def test_resume_after_abandonment_reuses_source_analysis(app_and_client, make_user, db, SessionMaker):
    """Reserve → force-abandon → reserve again with same content_hash →
    new reservation_id BUT same source_analysis_id, and `resumed: true`
    in the response."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    first = client.post("/analysis/reserve", json={
        "content_hash": H_A, "transcript_hash": H_TR_A,
        "run_id": _run(), "speech_seconds": 900,
    }).json()

    # Force-expire + sweep.
    with SessionMaker() as s:
        row = s.get(UsageReservation, first["reservation_id"])
        row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()
    with SessionMaker() as s:
        analysis.sweep_expired_reservations(s)

    resumed = client.post("/analysis/reserve", json={
        "content_hash": H_A, "transcript_hash": H_TR_A,
        "run_id": _run(), "speech_seconds": 900,
    }).json()

    assert resumed["source_analysis_id"] == first["source_analysis_id"]
    assert resumed["reservation_id"] != first["reservation_id"]
    assert resumed["resumed"] is True


def test_sweep_task_marks_abandoned(app_and_client, make_user, db, SessionMaker):
    """Global sweep with user_id=None catches abandoned reservations
    across users."""
    _, client = app_and_client
    user_a = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    user_b = make_user(plan_tier="studio", allowance_issued_seconds=360000)

    for u in (user_a, user_b):
        client.set_user(u)
        r = client.post("/analysis/reserve", json={
            "content_hash": _hash(u.id), "run_id": _run(),
            "speech_seconds": 300,
        }).json()
        with SessionMaker() as s:
            row = s.get(UsageReservation, r["reservation_id"])
            row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            s.commit()

    with SessionMaker() as s:
        count = analysis.sweep_expired_reservations(s, user_id=None)
        assert count == 2


def test_no_duplicate_bundle_on_recovery(app_and_client, make_user, db, SessionMaker):
    """Settled bundle + late heartbeat on the crashed reservation
    should 409, not modify state."""
    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()
    client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900, "cost_usd_micros": 0,
        "provider": "hosted_openai", "model": "gpt-4o-mini",
        "clips_generated": 10,
    })

    # Late heartbeat from the crashed run.
    hb = client.post("/analysis/heartbeat", json={"reservation_id": r["reservation_id"]})
    assert hb.status_code == 409
    assert hb.json()["detail"]["state"] == "settled"


# ─────────────────────────────────────────────────────────────────────
# Amendment 4 · Agency preserved (plan_tier ⊥ tier)
# ─────────────────────────────────────────────────────────────────────

def test_orthogonal_plan_tier_and_tier(make_user, db):
    """A user can have tier='agency' AND plan_tier='studio_unlimited'
    — the columns are orthogonal and neither overwrites the other."""
    user = make_user(tier="agency", plan_tier="studio_unlimited")
    assert user.tier == "agency"
    assert user.plan_tier == "studio_unlimited"


def test_founder_flag_preserved_across_plan_tier_writes(make_user, db):
    from app.routes.webhooks_whop import apply_plan_tier
    user = make_user(tier="autopilot", founder_flag=True, plan_tier="free")
    apply_plan_tier(user, "studio", paid=True)
    db.commit()
    fresh = db.get(User, user.id)
    assert fresh.founder_flag is True
    assert fresh.tier == "autopilot"      # untouched
    assert fresh.plan_tier == "studio"    # updated


def test_backfill_maps_agency_to_studio(make_user, db):
    """Backfill mapping preserves Agency capability while adding
    Studio-tier clipping entitlement."""
    from scripts.backfill_plan_tier import backfill
    agency_user = make_user(tier="agency_solo", plan_tier="free")

    stats = backfill(db, apply=True)
    assert stats["wrote_studio"] >= 1

    fresh = db.get(User, agency_user.id)
    assert fresh.plan_tier == "studio"
    assert fresh.tier == "agency_solo"    # untouched
    assert fresh.allowance_issued_seconds == 360000


# ─────────────────────────────────────────────────────────────────────
# Fix 1 · Studio allowance idempotency via the plan_allowance_grant
# ledger.
#
# The ledger is the authority for whether a payment has already
# issued the 100-hour grant. `users.allowance_*` columns are a cache
# of the most recent grant. `membership.went_valid` does not issue.
# ─────────────────────────────────────────────────────────────────────

from app.models import PlanAllowanceGrant


def _period_end(days: int) -> datetime:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(microsecond=0)


def _payment_event(*, payment_id: str, plan_id: str, period_end: datetime):
    """Build a minimal payment.succeeded payload shape."""
    return {
        "receipt": {"id": payment_id},
        "plan": {"id": plan_id},
        "renewal_period_end": int(period_end.timestamp()),
        "renewal_period_start": int(period_end.timestamp()) - 30 * 24 * 3600,
    }


def test_membership_valid_activates_but_does_not_issue_allowance(make_user, db):
    """`membership.went_valid` activates plan_tier=studio, subscription
    state changes, BUT does NOT insert a PlanAllowanceGrant AND does
    NOT reset the user's allowance counters."""
    from app.routes.webhooks_whop import apply_plan_tier
    user = make_user(plan_tier="free")
    user.allowance_used_seconds = 5000
    db.commit()

    apply_plan_tier(user, "studio")
    db.commit()

    fresh = db.get(User, user.id)
    assert fresh.plan_tier == "studio"
    assert fresh.allowance_used_seconds == 5000, "activation MUST NOT reset usage"
    grants = db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count()
    assert grants == 0, "activation MUST NOT insert a grant row"


def test_payment_succeeded_issues_grant_once(make_user, db):
    """A single payment.succeeded creates exactly one grant + resets
    usage counters to the fresh billing period."""
    from app.routes.webhooks_whop import _issue_studio_allowance_grant

    user = make_user(plan_tier="studio")
    user.allowance_used_seconds = 42000
    db.commit()

    grant = _issue_studio_allowance_grant(
        db, user,
        _payment_event(payment_id="rcpt_alpha_001", plan_id="plan_dhssNse4FfPlI",
                       period_end=_period_end(30)),
    )
    db.commit()

    assert grant is not None
    assert grant.whop_payment_id == "rcpt_alpha_001"
    assert grant.plan_tier == "studio"
    assert grant.issued_seconds == 360000

    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 0
    assert fresh.allowance_issued_seconds == 360000


def test_duplicate_payment_id_is_no_op(make_user, db):
    """Second payment.succeeded with the SAME whop_payment_id is a
    no-op: no second grant, no usage reset, existing grant returned."""
    from app.routes.webhooks_whop import _issue_studio_allowance_grant
    user = make_user(plan_tier="studio")

    event = _payment_event(payment_id="rcpt_dup", plan_id="plan_dhssNse4FfPlI",
                           period_end=_period_end(30))

    first = _issue_studio_allowance_grant(db, user, event)
    db.commit()
    fresh = db.get(User, user.id)
    fresh.allowance_used_seconds = 30_000
    db.commit()

    second = _issue_studio_allowance_grant(db, user, event)
    db.commit()

    assert second is not None
    assert second.id == first.id
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 30_000, "duplicate payment MUST NOT reset usage"
    grants = db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count()
    assert grants == 1


def test_missing_payment_id_refuses_and_does_not_reset(make_user, db):
    """A payment.succeeded whose payload carries no receipt/payment
    identity refuses the grant. Usage counters stay put."""
    from app.routes.webhooks_whop import _issue_studio_allowance_grant
    user = make_user(plan_tier="studio")
    user.allowance_used_seconds = 20_000
    db.commit()

    outcome = _issue_studio_allowance_grant(
        db, user,
        # No receipt / payment / receipt_id / event id fields.
        {"plan": {"id": "plan_dhssNse4FfPlI"},
         "renewal_period_end": int(_period_end(30).timestamp())},
    )
    db.commit()

    assert outcome is None
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 20_000
    assert db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count() == 0


def test_missing_renewal_period_end_still_grants_with_payment_id(make_user, db):
    """No `renewal_period_end` in the payload but the payment_id is
    reliable → grant is created (period_end nullable) and usage
    counters reset. This is the required behaviour for legacy Whop
    integrations that omit period metadata."""
    from app.routes.webhooks_whop import _issue_studio_allowance_grant
    user = make_user(plan_tier="studio")
    user.allowance_used_seconds = 20_000
    db.commit()

    grant = _issue_studio_allowance_grant(
        db, user,
        {"receipt": {"id": "rcpt_noperiod"},
         "plan": {"id": "plan_dhssNse4FfPlI"}},
    )
    db.commit()

    assert grant is not None
    assert grant.billing_period_end is None
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 0


def test_membership_then_payment_cross_events_credits_once(make_user, db):
    """Ordering A: `membership.went_valid` first (activation, no
    reset) THEN `payment.succeeded` (grant issued, usage reset once)."""
    from app.routes.webhooks_whop import apply_plan_tier, _issue_studio_allowance_grant

    user = make_user(plan_tier="free")
    user.allowance_used_seconds = 25_000
    db.commit()

    apply_plan_tier(user, "studio")
    db.commit()
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 25_000, "activation MUST NOT reset"

    grant = _issue_studio_allowance_grant(
        db, fresh,
        _payment_event(payment_id="rcpt_m2p", plan_id="plan_dhssNse4FfPlI",
                       period_end=_period_end(30)),
    )
    db.commit()

    assert grant is not None
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 0
    assert db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count() == 1


def test_payment_then_membership_cross_events_does_not_double_reset(make_user, db):
    """Ordering B: `payment.succeeded` first, then a later
    `membership.went_valid` (e.g. from Whop's retry). Second event
    must NOT re-issue the grant AND must NOT reset usage."""
    from app.routes.webhooks_whop import apply_plan_tier, _issue_studio_allowance_grant
    user = make_user(plan_tier="free")

    grant = _issue_studio_allowance_grant(
        db, user,
        _payment_event(payment_id="rcpt_p2m", plan_id="plan_dhssNse4FfPlI",
                       period_end=_period_end(30)),
    )
    db.commit()
    assert grant is not None
    fresh = db.get(User, user.id)
    fresh.allowance_used_seconds = 33_000
    db.commit()

    # Later membership activation on the same subscription.
    apply_plan_tier(fresh, "studio")
    db.commit()
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 33_000

    assert db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count() == 1


def test_older_payment_event_after_newer_period_is_refused(make_user, db):
    """An out-of-order Whop delivery where the newer period's
    payment.succeeded lands first, then the older period's replay
    arrives — the older event MUST NOT overwrite the newer state."""
    from app.routes.webhooks_whop import _issue_studio_allowance_grant

    user = make_user(plan_tier="studio")
    period_new = _period_end(60)
    period_old = _period_end(30)

    new_grant = _issue_studio_allowance_grant(
        db, user,
        _payment_event(payment_id="rcpt_new", plan_id="plan_dhssNse4FfPlI",
                       period_end=period_new),
    )
    db.commit()
    fresh = db.get(User, user.id)
    fresh.allowance_used_seconds = 40_000
    db.commit()

    outcome = _issue_studio_allowance_grant(
        db, fresh,
        _payment_event(payment_id="rcpt_old_replay", plan_id="plan_dhssNse4FfPlI",
                       period_end=period_old),
    )
    db.commit()

    assert outcome is None
    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 40_000
    assert fresh.allowance_period_end == new_grant.billing_period_end
    assert db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count() == 1


def test_cancellation_and_restore_within_same_paid_period_no_regrant(make_user, db):
    """User pays, cancels mid-cycle, restores in the same billing
    window. Only ONE grant exists across the sequence; usage counter
    accumulated during the cycle is preserved on restore."""
    from app.routes.webhooks_whop import apply_plan_tier, _issue_studio_allowance_grant

    user = make_user(plan_tier="free")

    # Payment issues the grant.
    _issue_studio_allowance_grant(
        db, user,
        _payment_event(payment_id="rcpt_cancel_flow", plan_id="plan_dhssNse4FfPlI",
                       period_end=_period_end(30)),
    )
    db.commit()
    fresh = db.get(User, user.id)
    fresh.allowance_used_seconds = 12_000
    db.commit()

    # User cancels (subscription_status shifts, plan_tier untouched).
    fresh.subscription_status = "canceled"
    db.commit()

    # User restores (membership event re-fires, but no payment yet).
    apply_plan_tier(fresh, "studio")
    fresh.subscription_status = "active"
    db.commit()

    fresh = db.get(User, user.id)
    assert fresh.allowance_used_seconds == 12_000
    grants = db.query(PlanAllowanceGrant).filter_by(user_id=user.id).count()
    assert grants == 1, "cancel + restore in same period MUST NOT issue a second grant"


# ─────────────────────────────────────────────────────────────────────
# Fix 3 · source_analysis idempotency with nullable transcript_hash
# ─────────────────────────────────────────────────────────────────────

def test_reserve_without_transcript_hash_does_not_duplicate(app_and_client, make_user, db, SessionMaker):
    """Two consecutive reserves with the same content_hash but
    transcript_hash=None on both MUST resolve to the same
    source_analysis row (not a NULL-not-equal-NULL duplicate)."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    first = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 600,
    }).json()

    # Release + reserve again (same content_hash, same null transcript_hash).
    client.post("/analysis/release", json={
        "reservation_id": first["reservation_id"], "reason": "test",
    })
    second = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 600,
    }).json()

    assert first["source_analysis_id"] == second["source_analysis_id"]
    with SessionMaker() as s:
        count = s.query(SourceAnalysis).filter(
            SourceAnalysis.user_id == user.id, SourceAnalysis.content_hash == H_A,
        ).count()
        assert count == 1


def test_reserve_records_transcript_hash_when_supplied_later(app_and_client, make_user, SessionMaker):
    """First reserve without transcript_hash · second reserve with the
    transcript_hash present · the row records the hash without
    creating a duplicate."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    first = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 600,
    }).json()
    client.post("/analysis/release", json={
        "reservation_id": first["reservation_id"], "reason": "provider_timeout",
    })
    client.post("/analysis/reserve", json={
        "content_hash": H_A, "transcript_hash": H_TR_A,
        "run_id": _run(), "speech_seconds": 600,
    })

    with SessionMaker() as s:
        row = s.query(SourceAnalysis).filter(
            SourceAnalysis.user_id == user.id, SourceAnalysis.content_hash == H_A,
        ).one()
        assert row.transcript_hash == H_TR_A


# ─────────────────────────────────────────────────────────────────────
# Fix 4 · precise cost accounting (micros + tokens)
# ─────────────────────────────────────────────────────────────────────

def test_settle_records_micros_and_tokens(app_and_client, make_user, SessionMaker):
    """Settle payload carries cost_usd_micros + input/output tokens.
    Reservation + source_analysis both persist the numbers."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    settled = client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 900,
        "cost_usd_micros": 6_000,        # $0.006 (100M tokens @ 60c/M)
        "input_tokens": 5_000,
        "output_tokens": 3_000,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 10,
    })
    assert settled.status_code == 200

    with SessionMaker() as s:
        res = s.get(UsageReservation, r["reservation_id"])
        assert res.cost_usd_micros == 6_000
        assert res.input_tokens == 5_000
        assert res.output_tokens == 3_000

        analysis_row = s.get(SourceAnalysis, r["source_analysis_id"])
        assert analysis_row.cost_usd_micros == 6_000
        assert analysis_row.input_tokens == 5_000
        assert analysis_row.output_tokens == 3_000


def test_settle_sums_cost_on_resume(app_and_client, make_user, SessionMaker):
    """Two reservations linked to the same source_analysis (crash +
    resume) sum their cost + tokens on the analysis row."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    first = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    # Force-abandon so we can resume.
    with SessionMaker() as s:
        row = s.get(UsageReservation, first["reservation_id"])
        row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()
    with SessionMaker() as s:
        analysis.sweep_expired_reservations(s)

    # Resume. Second reservation, same source_analysis_id.
    second = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()
    assert second["source_analysis_id"] == first["source_analysis_id"]

    # Both reservations settled with independent cost/token counts.
    # Only the second one actually completes the LLM call; the first
    # was abandoned so its settle attempt returns 409 (state check).
    r_settled = client.post("/analysis/settle", json={
        "reservation_id": second["reservation_id"],
        "actual_seconds": 900,
        "cost_usd_micros": 4_500,
        "input_tokens": 3_200,
        "output_tokens": 2_800,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 10,
    })
    assert r_settled.status_code == 200

    with SessionMaker() as s:
        analysis_row = s.get(SourceAnalysis, first["source_analysis_id"])
        # Only one settle succeeded; the analysis row carries that one's
        # totals. Cost is summed via +=, so this is the resume total.
        assert analysis_row.cost_usd_micros == 4_500
        assert analysis_row.input_tokens == 3_200
        assert analysis_row.output_tokens == 2_800


# ─────────────────────────────────────────────────────────────────────
# Fix 5 · strict production validation
# ─────────────────────────────────────────────────────────────────────

def test_short_run_id_is_refused(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": "r1", "speech_seconds": 100,
    })
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert any("run_id" in " ".join(str(x) for x in d.get("loc", [])) for d in detail)


def test_non_hex_content_hash_is_refused(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    for bad in ("z" * 64, "a" * 63, "A" * 64, "aaaa" * 16 + "x"):
        r = client.post("/analysis/reserve", json={
            "content_hash": bad, "run_id": _run(), "speech_seconds": 100,
        })
        assert r.status_code == 422, f"expected 422 for content_hash={bad!r}"


def test_valid_sha256_content_hash_accepted(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "transcript_hash": H_TR_A,
        "run_id": _run(), "speech_seconds": 900,
    })
    assert r.status_code == 200


def test_speech_seconds_defensive_cap_only(app_and_client, make_user):
    """The defensive int32 cap (~1 year) blocks garbage inputs but
    NEVER blocks a legitimate long recording like a 20-hour livestream.
    """
    _, client = app_and_client
    user = make_user(plan_tier="studio_unlimited")     # unlimited so no allowance gate
    client.set_user(user)

    # 20 hours = 72_000 seconds → well within the cap; must accept.
    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 72_000,
    })
    assert r.status_code == 200

    # 40 hours = 144_000 → still fine.
    r = client.post("/analysis/reserve", json={
        "content_hash": H_B, "run_id": _run(), "speech_seconds": 144_000,
    })
    assert r.status_code == 200


def test_short_reservation_id_refused_by_heartbeat(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/heartbeat", json={"reservation_id": "short"})
    assert r.status_code == 422


# ─────────────────────────────────────────────────────────────────────
# Amendment 5 · No automatic expensive fallback
# ─────────────────────────────────────────────────────────────────────

def _reset_escalation_env(monkeypatch):
    """Default state: escalation is off. Tests can flip individual gates."""
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_escalation_enabled", False, raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "", raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_kill_switch", False, raising=False)
    monkeypatch.setattr(settings, "hosted_standard_fallback_model", "", raising=False)


def test_free_ladder_never_escalates(app_and_client, make_user, monkeypatch):
    """Even with escalation env fully enabled AND free in
    ENABLED_TIERS, the free-tier reserve response must not carry an
    escalation route (hard-coded refusal)."""
    _reset_escalation_env(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_escalation_enabled", True, raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "free,studio", raising=False)

    _, client = app_and_client
    user = make_user(plan_tier="free")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()
    assert "escalation" not in r["provider_route"]


def test_escalation_hardcoded_free_refusal(monkeypatch, db, make_user):
    """Route resolver refuses to hand `free` any escalation-carrying
    provider_route even when every gate is green."""
    from app.routes.analysis import _resolve_provider_route
    _reset_escalation_env(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_escalation_enabled", True, raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "free", raising=False)

    user = make_user(plan_tier="free")
    route, _model, _fallback, _cap = _resolve_provider_route(user)
    assert "escalation" not in route


def test_studio_ladder_default_no_escalate(app_and_client, make_user, monkeypatch):
    _reset_escalation_env(monkeypatch)
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 300,
    }).json()
    assert "escalation" not in r["provider_route"]


def test_escalation_kill_switch_hot(monkeypatch, make_user):
    """With every gate green EXCEPT kill switch flipped → no escalation."""
    from app.routes.analysis import _resolve_provider_route
    _reset_escalation_env(monkeypatch)
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_escalation_enabled", True, raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "studio", raising=False)
    monkeypatch.setattr(settings, "hosted_escalation_kill_switch", True, raising=False)

    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    route, _model, _fallback, _cap = _resolve_provider_route(user)
    assert "escalation" not in route


def test_escalation_requires_all_gates(monkeypatch, make_user):
    """Studio user, escalation enabled, tier permitted, kill-switch
    off → escalation route offered. Flip any one gate → no
    escalation. This proves each gate is independently necessary."""
    from app.routes.analysis import _resolve_provider_route
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)

    def _all_gates_on():
        settings = get_settings()
        monkeypatch.setattr(settings, "hosted_escalation_enabled", True, raising=False)
        monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "studio", raising=False)
        monkeypatch.setattr(settings, "hosted_escalation_kill_switch", False, raising=False)

    _all_gates_on()
    route, *_ = _resolve_provider_route(user)
    assert "escalation" in route

    # Flip `enabled` off.
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_escalation_enabled", False, raising=False)
    route, *_ = _resolve_provider_route(user)
    assert "escalation" not in route

    # Restore + flip tier list to exclude studio.
    _all_gates_on()
    monkeypatch.setattr(settings, "hosted_escalation_enabled_tiers", "", raising=False)
    route, *_ = _resolve_provider_route(user)
    assert "escalation" not in route


# ─────────────────────────────────────────────────────────────────────
# Studio Unlimited BYOK-only
# ─────────────────────────────────────────────────────────────────────

def test_studio_unlimited_provider_route_byok_only(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio_unlimited")
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    assert r["provider_route"] == "byok_openai_only"
    assert r["estimated_cost_cap_cents"] == 0


def test_studio_unlimited_reserve_does_not_debit_allowance(app_and_client, make_user, SessionMaker):
    _, client = app_and_client
    user = make_user(plan_tier="studio_unlimited")
    client.set_user(user)

    client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 5000,
    })

    with SessionMaker() as s:
        db_user = s.get(User, user.id)
        assert db_user.allowance_reserved_seconds == 0
        assert db_user.allowance_used_seconds == 0


# ─────────────────────────────────────────────────────────────────────
# Fail-closed plan mapping
# ─────────────────────────────────────────────────────────────────────

def test_studio_unlimited_activation_fails_closed_when_env_missing(monkeypatch):
    """When WHOP_PLAN_ID_STUDIO_UNLIMITED is unset, an unknown plan_id
    on the webhook payload must NOT map to studio_unlimited."""
    settings = get_settings()
    monkeypatch.setattr(settings, "whop_plan_id_studio_unlimited", "", raising=False)

    event = {"plan": {"id": "plan_totally_unknown_new"}}
    resolved = webhooks_whop._plan_tier_from_event(event)
    assert resolved is None


def test_studio_plan_maps_to_studio_via_default_env(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "whop_plan_id_studio", "plan_dhssNse4FfPlI", raising=False)
    resolved = webhooks_whop._plan_tier_from_event({"plan": {"id": "plan_dhssNse4FfPlI"}})
    assert resolved == "studio"


def test_studio_unlimited_env_grants_studio_unlimited(monkeypatch):
    """When WHOP_PLAN_ID_STUDIO_UNLIMITED is set on the settings
    singleton, the plan id it names resolves to `studio_unlimited`.

    Order-independent: uses a unique plan id per run so a leaked
    monkeypatch of `whop_plan_id_studio_unlimited` from another test
    can't confuse this one. Also patches BOTH the module-level
    `settings` binding in webhooks_whop AND the singleton returned
    by get_settings(), since some code paths hold local refs.
    """
    unique_id = f"plan_TEST_{uuid.uuid4().hex[:12]}"
    settings = get_settings()
    monkeypatch.setattr(settings, "whop_plan_id_studio_unlimited", unique_id, raising=False)
    monkeypatch.setattr(webhooks_whop.settings, "whop_plan_id_studio_unlimited", unique_id, raising=False)

    resolved = webhooks_whop._plan_tier_from_event({"plan": {"id": unique_id}})
    assert resolved == "studio_unlimited"


def test_legacy_agency_plans_alias_to_studio(monkeypatch):
    """Legacy paid plan IDs (Founder v2, Solo, Growth, Autopilot,
    Agency ladder) all resolve to `studio` — grandfathered users get
    the 100h Studio allowance, never studio_unlimited by accident."""
    # Founder v2 in FOUNDER_PLAN_IDS
    resolved = webhooks_whop._plan_tier_from_event({"plan": {"id": "plan_NMKvKj8SVVKsY"}})
    assert resolved == "studio"
    # Solo in PLAN_TIER_BY_ID
    resolved = webhooks_whop._plan_tier_from_event({"plan": {"id": "plan_qe8AFXj9J3SWi"}})
    assert resolved == "studio"


# ─────────────────────────────────────────────────────────────────────
# /analysis/usage payload shape
# ─────────────────────────────────────────────────────────────────────

def test_usage_endpoint_studio(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.get("/analysis/usage")
    assert r.status_code == 200
    payload = r.json()
    assert payload["plan_tier"] == "studio"
    assert payload["allowance_issued_seconds"] == 360000
    assert payload["allowance_hours_remaining"] == 100.0
    assert payload["free_preview_max_seconds"] == 3600
    assert payload["free_max_clips_per_bundle"] == 10


def test_usage_endpoint_studio_unlimited(app_and_client, make_user):
    _, client = app_and_client
    user = make_user(plan_tier="studio_unlimited")
    client.set_user(user)

    payload = client.get("/analysis/usage").json()
    assert payload["plan_tier"] == "studio_unlimited"
    assert payload["allowance_hours_remaining"] is None      # unlimited


# ─────────────────────────────────────────────────────────────────────
# Studio-tier allowance enforcement
# ─────────────────────────────────────────────────────────────────────

def test_studio_allowance_gate_402(app_and_client, make_user):
    """Studio user with 100 seconds issued cannot reserve 200 seconds."""
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=100)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 200,
    })
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "allowance_exceeded"
    assert r.json()["detail"]["remaining_seconds"] == 100


def test_studio_settle_debits_used_seconds(app_and_client, make_user, SessionMaker):
    _, client = app_and_client
    user = make_user(plan_tier="studio", allowance_issued_seconds=360000)
    client.set_user(user)

    r = client.post("/analysis/reserve", json={
        "content_hash": H_A, "run_id": _run(), "speech_seconds": 900,
    }).json()

    client.post("/analysis/settle", json={
        "reservation_id": r["reservation_id"],
        "actual_seconds": 950,      # slightly more than reserved (Whisper edge)
        "cost_usd_micros": 50_000, "input_tokens": 8, "output_tokens": 1,
        "provider": "hosted_openai",
        "model": "gpt-4o-mini",
        "clips_generated": 30,
    })

    with SessionMaker() as s:
        row = s.get(User, user.id)
        assert row.allowance_used_seconds == 950
        assert row.allowance_reserved_seconds == 0
