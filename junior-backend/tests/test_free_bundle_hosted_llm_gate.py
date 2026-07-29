"""2026-07-29 · Phase 1.6 gap fix.

analysis.py's `_gate_free_reserve` atomically reserves a free-tier user's
ONE-TIME free bundle (`plan_tier == "free"`, `free_bundle_state == "reserved"`)
before the sidecar ever calls the hosted LLM proxy. But `proxy_llm.py`'s
`hosted_clip_bundle` gated purely on the OLDER `user.tier` feature matrix,
which free users never pass — so a free user with a perfectly valid,
just-reserved bundle got 403 "Hosted LLM requires Pro or Agency." This
silently broke the "one free clip run" promise for every free-tier account.

These tests pin the fix: a reserved free bundle lets the ONE call through
(and skips quota accounting, since free has none); a free user with no
reservation (or an already-settled bundle) still gets the honest 403/409.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.deps import current_user
from app.models import User
from app.routes import proxy_llm as proxy_llm_route
from app.routes.proxy_llm import ClipBundle


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def SessionMaker(db_engine):
    return sessionmaker(bind=db_engine, expire_on_commit=False)


@pytest.fixture()
def app_and_client(SessionMaker):
    app = FastAPI()
    app.include_router(proxy_llm_route.router)

    holder: dict[str, str | None] = {"user_id": None}
    session_holder: dict[str, object] = {"s": None}

    def _sess():
        if session_holder["s"] is None:
            session_holder["s"] = SessionMaker()
        try:
            yield session_holder["s"]
        finally:
            s = session_holder["s"]
            if s is not None:
                s.close()
                session_holder["s"] = None

    def _cur_user():
        if session_holder["s"] is None:
            session_holder["s"] = SessionMaker()
        return session_holder["s"].get(User, holder["user_id"])

    app.dependency_overrides[get_db] = _sess
    app.dependency_overrides[current_user] = _cur_user

    client = TestClient(app)
    client.set_user = lambda u: holder.__setitem__("user_id", u.id)  # type: ignore[attr-defined]
    yield app, client
    app.dependency_overrides.clear()


@pytest.fixture()
def make_user(SessionMaker):
    def _make(**overrides):
        with SessionMaker() as s:
            u = User(
                id=uuid.uuid4().hex,
                clerk_id=f"u_{uuid.uuid4().hex[:12]}",
                email="t@t.co",
                tier="free",
                plan_tier="free",
                free_bundle_state="available",
                subscription_status="active",
            )
            for k, v in overrides.items():
                setattr(u, k, v)
            s.add(u)
            s.commit()
            s.refresh(u)
            return u
    return _make


_PAYLOAD = {
    "system_prompt": "x" * 100,
    "user_message": "y" * 100,
    "model": "gpt-4o-mini",
}

_EMPTY_BUNDLE = ClipBundle(
    clips=[],
    chapters=[],
    description="",
    video_title_variants=[],
    scored_titles=[],
    tags=[],
    hashtags=[],
    pinned_video_comment="",
    end_screen_ctas=[],
    tweet_thread=[],
    linkedin_post="",
)


def _mock_completion():
    completion = MagicMock()
    completion.choices = [MagicMock()]
    completion.choices[0].message.parsed = _EMPTY_BUNDLE
    completion.choices[0].message.refusal = None
    completion.usage.total_tokens = 500
    completion.usage.prompt_tokens = 400
    completion.usage.completion_tokens = 100
    return completion


def _patched_settings():
    settings = MagicMock()
    settings.openai_api_key = "test-key"
    return settings


def test_free_user_with_reserved_bundle_gets_real_call_not_403(
    app_and_client, make_user,
):
    """The core fix: reserved free bundle -> hosted call succeeds."""
    _, client = app_and_client
    u = make_user(free_bundle_state="reserved")
    client.set_user(u)

    with patch("app.routes.proxy_llm.get_settings", _patched_settings), \
         patch("openai.OpenAI") as mock_openai_cls:
        mock_openai_cls.return_value.beta.chat.completions.parse.return_value = _mock_completion()
        resp = client.post("/proxy/llm/clip-bundle", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    assert resp.json()["quota_remaining"] is None


def test_openai_rate_limit_becomes_honest_503_not_raw_500(
    app_and_client, make_user,
):
    """2026-07-29 · caught live: an OpenAI insufficient_quota RateLimitError
    used to fall through to `except Exception: raise`, crashing the request
    into an unhandled 500 with a full traceback. The sidecar had no mapping
    for 500, so it leaked as a raw "RuntimeError: Hosted AI failed: HTTP 500
    — Internal Server Error" straight into the Workstation UI. Must now be
    a clean 503 with an honest, actionable message."""
    import httpx
    from openai import RateLimitError

    _, client = app_and_client
    u = make_user(free_bundle_state="reserved")
    client.set_user(u)

    fake_response = httpx.Response(
        status_code=429,
        request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
        json={"error": {"message": "insufficient_quota", "code": "insufficient_quota"}},
    )
    rate_limit_error = RateLimitError(
        "insufficient_quota", response=fake_response, body=None,
    )

    with patch("app.routes.proxy_llm.get_settings", _patched_settings), \
         patch("openai.OpenAI") as mock_openai_cls:
        mock_openai_cls.return_value.beta.chat.completions.parse.side_effect = rate_limit_error
        resp = client.post("/proxy/llm/clip-bundle", json=_PAYLOAD)

    assert resp.status_code == 503, resp.text
    detail = resp.json()["detail"]
    assert "RuntimeError" not in detail
    assert "Traceback" not in detail
    assert "temporarily unavailable" in detail.lower()


def test_free_user_without_reservation_still_gets_honest_403(
    app_and_client, make_user,
):
    """free_bundle_state == "available" (never reserved) must NOT bypass
    the gate — only an actively reserved bundle does."""
    _, client = app_and_client
    u = make_user(free_bundle_state="available")
    client.set_user(u)

    with patch("app.routes.proxy_llm.get_settings", _patched_settings):
        resp = client.post("/proxy/llm/clip-bundle", json=_PAYLOAD)

    assert resp.status_code == 403
    assert "Pro or Agency" in resp.text


def test_free_user_with_settled_bundle_still_gets_honest_403(
    app_and_client, make_user,
):
    """Already-used-up free bundle must NOT re-open hosted access."""
    _, client = app_and_client
    u = make_user(free_bundle_state="settled")
    client.set_user(u)

    with patch("app.routes.proxy_llm.get_settings", _patched_settings):
        resp = client.post("/proxy/llm/clip-bundle", json=_PAYLOAD)

    assert resp.status_code == 403


def test_pro_user_unaffected_by_free_bundle_branch(app_and_client, make_user):
    """Sanity check: paying tiers still work exactly as before, independent
    of plan_tier/free_bundle_state. `is_feature_built("hosted_llm")` is
    driven by an env-var live-flag (app.features._HOSTED_LLM_LIVE) baked in
    at import time from OPENAI_API_KEY/ANTHROPIC_API_KEY — true in prod,
    false in this test process, so it's patched directly here rather than
    asserted as a side effect of my free-bundle change."""
    _, client = app_and_client
    u = make_user(tier="pro", plan_tier="studio", free_bundle_state="settled")
    client.set_user(u)

    with patch("app.routes.proxy_llm.get_settings", _patched_settings), \
         patch("app.routes.proxy_llm.is_feature_built", return_value=True), \
         patch("openai.OpenAI") as mock_openai_cls:
        mock_openai_cls.return_value.beta.chat.completions.parse.return_value = _mock_completion()
        resp = client.post("/proxy/llm/clip-bundle", json=_PAYLOAD)

    assert resp.status_code == 200, resp.text
    assert resp.json()["quota_remaining"] is not None
