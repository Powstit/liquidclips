from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import whop_payments
from app.db import Base
from app.models import User
from app.routes import carrot


class _Response:
    def __init__(self, body: dict):
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._body


class _Client:
    def __init__(self, *, get_body: dict | None = None):
        self.get_body = get_body or {}
        self.last_method = ""
        self.last_path = ""
        self.last_json: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, path: str, *, json: dict):
        self.last_method = "POST"
        self.last_path = path
        self.last_json = json
        return _Response({"id": "ctt_test"})

    def get(self, path: str):
        self.last_method = "GET"
        self.last_path = path
        return _Response(self.get_body)


def test_transfer_uses_current_whop_ledger_payload(monkeypatch):
    client = _Client()
    monkeypatch.setattr(whop_payments, "is_live", lambda: True)
    monkeypatch.setattr(whop_payments, "_client", lambda: client)

    result = whop_payments.create_transfer(
        origin_id="biz_parent",
        destination_id="biz_clipper",
        amount_usd=47.5,
        notes="Liquid Clips sponsored reward",
        idempotence_key="carrot-user_1",
        metadata={"reward_kind": "activation_bonus"},
    )

    assert result["id"] == "ctt_test"
    assert client.last_path == "/transfers"
    assert client.last_json == {
        "origin_id": "biz_parent",
        "destination_id": "biz_clipper",
        "amount": 47.5,
        "currency": "usd",
        "idempotence_key": "carrot-user_1",
        "notes": "Liquid Clips sponsored reward",
        "metadata": {"reward_kind": "activation_bonus"},
    }


def test_connected_company_read_uses_ledger_account(monkeypatch):
    client = _Client(
        get_body={
            "id": "ldgr_test",
            "balances": [{"currency": "usd", "balance": 12.5}],
            "payout_account_details": {"status": "connected"},
        }
    )
    monkeypatch.setattr(whop_payments, "is_live", lambda: True)
    monkeypatch.setattr(whop_payments, "_client", lambda: client)

    result = whop_payments.retrieve_account("biz_clipper")

    assert client.last_path == "/ledger_accounts/biz_clipper"
    assert result["status"] == "connected"
    assert result["capabilities"]["standard_payout"] == "active"


def test_sponsored_reward_can_only_be_claimed_once(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    db = Session()
    user = User(
        id=uuid.uuid4().hex,
        clerk_id="user_test",
        email="clipper@test.invalid",
        tier="solo",
        subscription_status="active",
        cached_paid_referrals=5,
        whop_sub_merchant_id="biz_clipper",
        whop_sub_merchant_status="onboarded",
    )
    db.add(user)
    db.commit()

    calls: list[dict] = []
    monkeypatch.setattr(whop_payments, "is_live", lambda: True)
    monkeypatch.setattr(whop_payments, "_parent_company_id", lambda: "biz_parent")
    monkeypatch.setattr(
        whop_payments,
        "create_transfer",
        lambda **kwargs: calls.append(kwargs) or {"id": "ctt_once", "live": True},
    )

    first = carrot.claim_carrot(user=user, db=db)
    assert first.transfer_id == "ctt_once"
    assert calls[0]["idempotence_key"] == f"carrot-{user.id}"
    assert user.carrot_last_claim_at is not None

    with pytest.raises(HTTPException) as exc:
        carrot.claim_carrot(user=user, db=db)
    assert exc.value.status_code == 409
    assert len(calls) == 1

    db.close()
    engine.dispose()
