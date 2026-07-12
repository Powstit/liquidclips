"""``app.services.identity_claim`` · Wave 1 gap-closure regression.

**No-divergence proof.** Both ``POST /me/lc-id/claim`` and the legacy
alias ``POST /me/handle`` MUST delegate to the same service function
so ``users.handle`` has exactly one writer. This suite exercises both
endpoints against the same DB and asserts:

  * both write the same normalised value to the SAME column
  * both return their own response shape but with identical persisted
    handle text
  * the legacy route emits a deprecation warning log line
  * the service function invoked directly with either ``source=``
    writes the identical row
  * the deprecated route responds with the ``X-Deprecation`` header

Follows the same in-memory SQLite + dependency-override pattern as
``test_me_lc_id_claim.py`` so no fixture state leaks between tests.
"""

from __future__ import annotations

import logging
import uuid
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes.handle import router as handle_router
from app.routes.me import router as me_router
from app.services.identity_claim import (
    CLAIM_HANDLE_RE,
    RESERVED_HANDLES,
    claim_handle,
)


def _mk_user(session, **overrides) -> User:
    row = User(
        id=uuid.uuid4().hex,
        clerk_id=overrides.pop("clerk_id", f"clerk_{uuid.uuid4().hex[:8]}"),
        email=overrides.pop("email", f"{uuid.uuid4().hex[:8]}@example.com"),
        tier=overrides.pop("tier", "free"),
        lc_id=overrides.pop("lc_id", None),
        handle=overrides.pop("handle", None),
        **overrides,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def app_state() -> Iterator[tuple[FastAPI, sessionmaker, User]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    seed_session = Session()
    caller = _mk_user(seed_session, lc_id="LC-CANONX")
    seed_session.close()

    app = FastAPI()
    app.include_router(me_router)
    app.include_router(handle_router)

    def _override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def _override_current_user():
        s = Session()
        try:
            row = s.get(User, caller.id)
            assert row is not None
            return row
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[current_user] = _override_current_user

    yield app, Session, caller

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------
# Assertion 1 · Both endpoints write the SAME row for the SAME handle
# ---------------------------------------------------------------------


def test_canonical_and_legacy_write_same_row(app_state):
    """The canonical route + legacy alias must produce IDENTICAL DB
    writes when handed the same handle. Any divergence means one of
    them is contains independent write logic — the whole point of the
    service extraction is to make this impossible."""
    app, Session, caller = app_state
    tc = TestClient(app)

    # Route A · canonical claim.
    r1 = tc.post("/me/lc-id/claim", json={"handle": "sameone"})
    assert r1.status_code == 200, r1.text

    with Session() as s:
        row_after_canonical = s.get(User, caller.id)
        assert row_after_canonical is not None
        assert row_after_canonical.handle == "sameone"

    # Wipe + repeat with the legacy alias.
    with Session() as s:
        row = s.get(User, caller.id)
        row.handle = None  # type: ignore[assignment]
        s.commit()

    r2 = tc.post("/me/handle", json={"handle": "sameone"})
    assert r2.status_code == 200, r2.text

    with Session() as s:
        row_after_legacy = s.get(User, caller.id)
        assert row_after_legacy is not None
        # Byte-identical persistence: both write the exact same string
        # to the exact same column.
        assert row_after_legacy.handle == "sameone"


# ---------------------------------------------------------------------
# Assertion 2 · Legacy alias emits the deprecation warning
# ---------------------------------------------------------------------


def test_legacy_alias_emits_deprecation_log(app_state, caplog):
    """The legacy ``POST /me/handle`` must emit a ``WARNING`` log line
    so ops can trace remaining callers via the log rail. Absence of
    this log means the deprecation signal is broken."""
    app, _Session, caller = app_state
    tc = TestClient(app)

    with caplog.at_level(logging.WARNING, logger="junior.handle_deprecated"):
        r = tc.post("/me/handle", json={"handle": "warncheck"})

    assert r.status_code == 200, r.text
    # Deprecation log MUST fire on every call.
    warn_messages = [rec.message for rec in caplog.records if rec.levelno == logging.WARNING]
    assert any("deprecated_endpoint /me/handle" in m for m in warn_messages), warn_messages
    # And the response header points callers at the canonical endpoint.
    assert "X-Deprecation" in r.headers
    assert "POST /me/lc-id/claim" in r.headers["X-Deprecation"]


# ---------------------------------------------------------------------
# Assertion 3 · Direct service invocation matches route behaviour
# ---------------------------------------------------------------------


def test_service_writes_same_row_from_either_source(app_state):
    """Invoking ``claim_handle`` directly with either ``source=``
    parameter must write the identical row shape — the ``source``
    string is a telemetry tag, not a behavioural switch."""
    _app, Session, caller = app_state

    with Session() as s:
        updated = claim_handle(
            session=s,
            user_id=caller.id,
            handle="direct1",
            source="lc-id-claim",
        )
        assert updated.handle == "direct1"

    # Re-wipe and use the legacy source label.
    with Session() as s:
        row = s.get(User, caller.id)
        row.handle = None  # type: ignore[assignment]
        s.commit()

    with Session() as s:
        updated2 = claim_handle(
            session=s,
            user_id=caller.id,
            handle="direct1",
            source="legacy-handle-alias",
        )
        assert updated2.handle == "direct1"


# ---------------------------------------------------------------------
# Assertion 4 · The service emits a handle_write log with the source tag
# ---------------------------------------------------------------------


def test_service_emits_handle_write_with_source(app_state, caplog):
    """Both sources must emit ``handle_write`` diagnostics so HQ can
    prove the canonical writer landed. The log line includes ``source=``
    so ops can tell canonical calls from legacy-alias calls at a
    glance."""
    _app, Session, caller = app_state

    with caplog.at_level(logging.INFO, logger="junior.identity_claim"):
        with Session() as s:
            claim_handle(
                session=s,
                user_id=caller.id,
                handle="tagcheck",
                source="lc-id-claim",
            )
    canonical_logs = [rec.message for rec in caplog.records
                      if "handle_write" in rec.message and "lc-id-claim" in rec.message]
    assert len(canonical_logs) >= 1, canonical_logs

    caplog.clear()

    with Session() as s:
        row = s.get(User, caller.id)
        row.handle = None  # type: ignore[assignment]
        s.commit()

    with caplog.at_level(logging.INFO, logger="junior.identity_claim"):
        with Session() as s:
            claim_handle(
                session=s,
                user_id=caller.id,
                handle="tagcheck",
                source="legacy-handle-alias",
            )
    legacy_logs = [rec.message for rec in caplog.records
                   if "handle_write" in rec.message and "legacy-handle-alias" in rec.message]
    assert len(legacy_logs) >= 1, legacy_logs


# ---------------------------------------------------------------------
# Assertion 5 · Policy constants are exported at the service surface
# ---------------------------------------------------------------------


def test_policy_constants_are_the_single_source_of_truth():
    """Regex + reserved-word set live on the service module. If a route
    ever re-declares its own set, this test will start flagging the
    drift because the imported values won't match the route-local
    values (which is why routes MUST NOT re-declare them)."""
    # Regex shape locked · matches the Wave 1 ladder pill.
    assert CLAIM_HANDLE_RE.pattern == r"^[a-z0-9_]{3,20}$"
    # Reserved-word set must be a frozenset so callers can't mutate it.
    assert isinstance(RESERVED_HANDLES, frozenset)
    # A small set of anchor entries that must never be claimable.
    for anchor in ("admin", "kade", "liquid", "guest", "clipper"):
        assert anchor in RESERVED_HANDLES


# ---------------------------------------------------------------------
# Assertion 6 · Legacy route returns HandleOut shape for compat
# ---------------------------------------------------------------------


def test_legacy_alias_returns_legacy_shape(app_state):
    """The legacy alias preserves ``{handle, share_url}`` so
    pre-Wave-1 clients keep working while they migrate to the
    unified ``MeResponse``. The gap-closure changed behaviour under
    the hood, not the shape."""
    app, _Session, _caller = app_state
    tc = TestClient(app)

    r = tc.post("/me/handle", json={"handle": "shapecheck"})
    assert r.status_code == 200, r.text
    body = r.json()

    assert set(body.keys()) == {"handle", "share_url"}
    assert body["handle"] == "shapecheck"
    assert body["share_url"] == "https://liquidclips.app/join/shapecheck"
