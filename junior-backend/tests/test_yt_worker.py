"""F7 · Layer 4 · YouTube batch-lookup worker tests.

Verifies the cache · rate-limit · quota · scraper-fallback contract of
``app.yt_worker`` end-to-end. Every YouTube call is mocked via a
monkeypatched ``_http_client`` factory that returns a fake
``httpx.Client`` — the live API is NEVER hit here (real-YT smoke test
lives in a separate task per spec).

Auth path: the endpoint depends on ``current_user`` which resolves the
license JWT. Route-level tests inject a bearer-token header derived
from ``jwt_signer.issue_license_jwt``.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import yt_worker
from app.db import Base, get_db
from app.jwt_signer import issue_license_jwt
from app.main import app
from app.models import User


API_KEY_FIXTURE = "test-yt-api-key-fixture"


# ─────────────────────────────────────────────────────────────
# Fixtures · in-memory sqlite + authed user
# ─────────────────────────────────────────────────────────────


@pytest.fixture()
def _engine_and_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    session = Session()
    try:
        yield engine, Session, session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(monkeypatch, _engine_and_session):
    engine, Session, session = _engine_and_session

    def _get_db_override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db_override

    # Seed a user so current_user resolves.
    user = User(
        id="user_yt_fixture",
        clerk_id="clerk_yt_fixture",
        email="yt-fixture@example.com",
        tier="solo",
    )
    session.add(user)
    session.commit()

    monkeypatch.setenv("YOUTUBE_API_KEY", API_KEY_FIXTURE)
    from app.config import get_settings

    get_settings.cache_clear()

    yt_worker._reset_state()

    tc = TestClient(app)
    try:
        yield tc, user
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


def _auth_headers(user: User) -> dict[str, str]:
    token, _expires = issue_license_jwt(
        user_id=user.id,
        tier=user.tier,
    )
    return {"authorization": f"Bearer {token}"}


# ─────────────────────────────────────────────────────────────
# Mock HTTP client helpers
# ─────────────────────────────────────────────────────────────


def _mk_client(*, videos_items: list[dict] | None = None,
               channels_items: list[dict] | None = None,
               videos_status: int = 200,
               channels_status: int = 200,
               videos_body: str | None = None,
               channels_body: str | None = None,
               ) -> Any:
    """Return a callable that, when invoked with no args, produces a
    context-manager fake httpx client with a ``get`` method that
    dispatches based on the URL to canned payloads."""

    def _fake_get(url: str, params: dict[str, Any]) -> httpx.Response:
        if "/videos" in url:
            if videos_body is not None:
                return httpx.Response(
                    videos_status,
                    text=videos_body,
                    request=httpx.Request("GET", url),
                )
            return httpx.Response(
                videos_status,
                json={"items": videos_items or []},
                request=httpx.Request("GET", url),
            )
        if "/channels" in url:
            if channels_body is not None:
                return httpx.Response(
                    channels_status,
                    text=channels_body,
                    request=httpx.Request("GET", url),
                )
            return httpx.Response(
                channels_status,
                json={"items": channels_items or []},
                request=httpx.Request("GET", url),
            )
        return httpx.Response(
            404, json={}, request=httpx.Request("GET", url),
        )

    client_mock = MagicMock()
    client_mock.get.side_effect = _fake_get
    client_mock.__enter__.return_value = client_mock
    client_mock.__exit__.return_value = False
    return lambda: client_mock


# ─────────────────────────────────────────────────────────────
# Unit tests · cache
# ─────────────────────────────────────────────────────────────


def test_cache_miss_returns_none():
    yt_worker._reset_state()
    assert yt_worker._cache_get("UCabc") is None


def test_cache_put_then_hit_within_ttl():
    yt_worker._reset_state()
    yt_worker._cache_put("UCabc", "@handle", 12345)
    row = yt_worker._cache_get("UCabc")
    assert row is not None
    (chid, handle, subs, epoch) = row
    assert chid == "UCabc"
    assert handle == "@handle"
    assert subs == 12345
    assert time.time() - epoch < 5  # freshly set


def test_cache_evicts_after_ttl(monkeypatch):
    yt_worker._reset_state()
    yt_worker._cache_put("UCstale", "@stale", 1)
    # Simulate cache row past TTL.
    yt_worker._cache["UCstale"] = ("UCstale", "@stale", 1, time.time() - 90_000)
    assert yt_worker._cache_get("UCstale") is None


# ─────────────────────────────────────────────────────────────
# Unit tests · rate limit + daily quota
# ─────────────────────────────────────────────────────────────


def test_quota_available_true_on_empty_state():
    yt_worker._reset_state()
    assert yt_worker._quota_available(1) is True
    assert yt_worker._quota_available(yt_worker.MAX_PER_MINUTE) is True


def test_quota_available_false_when_minute_window_full():
    yt_worker._reset_state()
    yt_worker._record_lookups(yt_worker.MAX_PER_MINUTE)
    assert yt_worker._quota_available(1) is False


def test_quota_available_false_when_day_budget_full():
    yt_worker._reset_state()
    yt_worker._day_quota_used = yt_worker.MAX_PER_DAY
    assert yt_worker._quota_available(1) is False


def test_minute_window_prunes_stale_entries():
    yt_worker._reset_state()
    # Backdate every entry beyond the 60s window.
    now = time.time()
    yt_worker._minute_window.extend([now - 61] * 10)
    yt_worker._prune_minute_window()
    assert yt_worker._minute_window == []


def test_day_quota_resets_after_window():
    yt_worker._reset_state()
    yt_worker._day_quota_used = yt_worker.MAX_PER_DAY
    yt_worker._day_quota_reset_at = time.time() - 1
    yt_worker._reset_day_if_expired()
    assert yt_worker._day_quota_used == 0


# ─────────────────────────────────────────────────────────────
# Unit tests · YouTube API adapters
# ─────────────────────────────────────────────────────────────


def test_fetch_videos_returns_video_to_channel(monkeypatch):
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            videos_items=[
                {"id": "vid1", "snippet": {"channelId": "UCabc"}},
                {"id": "vid2", "snippet": {"channelId": "UCxyz"}},
            ],
        ),
    )
    result = yt_worker.fetch_videos(["vid1", "vid2"], API_KEY_FIXTURE)
    assert result == {"vid1": "UCabc", "vid2": "UCxyz"}


def test_fetch_videos_batches_over_50(monkeypatch):
    fake_get = MagicMock()
    fake_get.side_effect = lambda url, params: httpx.Response(
        200,
        json={
            "items": [
                {"id": v, "snippet": {"channelId": f"UC_{v}"}}
                for v in params["id"].split(",")
            ],
        },
        request=httpx.Request("GET", url),
    )
    client_mock = MagicMock()
    client_mock.get = fake_get
    client_mock.__enter__.return_value = client_mock
    client_mock.__exit__.return_value = False
    monkeypatch.setattr(yt_worker, "_http_client", lambda: client_mock)
    ids = [f"vid{i}" for i in range(75)]
    result = yt_worker.fetch_videos(ids, API_KEY_FIXTURE)
    assert len(result) == 75
    # Two batches expected: 50 + 25.
    assert fake_get.call_count == 2


def test_fetch_videos_raises_quota_error_on_403(monkeypatch):
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            videos_status=403,
            videos_body=json.dumps(
                {"error": {"errors": [{"reason": "quotaExceeded"}]}},
            ),
        ),
    )
    with pytest.raises(yt_worker.YtQuotaError):
        yt_worker.fetch_videos(["vidQ"], API_KEY_FIXTURE)


def test_fetch_videos_raises_api_error_on_500(monkeypatch):
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(videos_status=500, videos_body="boom"),
    )
    with pytest.raises(yt_worker.YtApiError):
        yt_worker.fetch_videos(["vidX"], API_KEY_FIXTURE)


def test_fetch_channels_returns_handle_and_subs(monkeypatch):
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_items=[
                {
                    "id": "UCabc",
                    "snippet": {
                        "customUrl": "@fictional_channel",
                        "title": "Fictional Channel",
                    },
                    "statistics": {"subscriberCount": "25000"},
                },
            ],
        ),
    )
    result = yt_worker.fetch_channels(["UCabc"], API_KEY_FIXTURE)
    assert result == {"UCabc": ("@fictional_channel", 25_000)}


def test_fetch_channels_falls_back_to_title_when_no_custom_url(monkeypatch):
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_items=[
                {
                    "id": "UCdef",
                    "snippet": {"title": "Just A Title"},
                    "statistics": {"subscriberCount": "12"},
                },
            ],
        ),
    )
    result = yt_worker.fetch_channels(["UCdef"], API_KEY_FIXTURE)
    assert result["UCdef"] == ("Just A Title", 12)


def test_scraper_fallback_returns_partial_rows():
    partial = yt_worker.scraper_fallback(["UCq1", "UCq2"])
    assert partial == {"UCq1": ("", -1), "UCq2": ("", -1)}


# ─────────────────────────────────────────────────────────────
# Route tests · POST /yt/batch-lookup
# ─────────────────────────────────────────────────────────────


def test_route_anon_returns_401(client):
    tc, _user = client
    r = tc.post("/yt/batch-lookup", json={"video_ids": ["v1"]})
    assert r.status_code == 401


def test_route_missing_api_key_returns_500(client, monkeypatch):
    tc, user = client
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    from app.config import get_settings

    get_settings.cache_clear()
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": ["v1"]},
        headers=_auth_headers(user),
    )
    assert r.status_code == 500
    assert "YOUTUBE_API_KEY" in r.json().get("detail", "")


def test_route_empty_request_returns_empty_matches(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(),
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": []},
        headers=_auth_headers(user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body == {"matches": [], "partial": False}


def test_route_resolves_video_ids_to_channels(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            videos_items=[
                {"id": "vidA", "snippet": {"channelId": "UCa"}},
            ],
            channels_items=[
                {
                    "id": "UCa",
                    "snippet": {"customUrl": "@peer_alpha"},
                    "statistics": {"subscriberCount": "1000"},
                },
            ],
        ),
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": ["vidA"], "channel_ids": []},
        headers=_auth_headers(user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["partial"] is False
    assert len(body["matches"]) == 1
    m = body["matches"][0]
    assert m["video_id"] == "vidA"
    assert m["channel_id"] == "UCa"
    assert m["channel_handle"] == "@peer_alpha"
    assert m["subs"] == 1000
    # verified_at is a valid ISO-8601 UTC string.
    parsed = datetime.fromisoformat(m["verified_at"])
    assert parsed.tzinfo is not None
    assert parsed.tzinfo.utcoffset(parsed) == timezone.utc.utcoffset(parsed)


def test_route_channel_ids_alone_resolve(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_items=[
                {
                    "id": "UCsolo",
                    "snippet": {"customUrl": "@solo_peer"},
                    "statistics": {"subscriberCount": "42"},
                },
            ],
        ),
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCsolo"]},
        headers=_auth_headers(user),
    )
    body = r.json()
    assert body["matches"] == [
        {
            "video_id": None,
            "channel_id": "UCsolo",
            "channel_handle": "@solo_peer",
            "subs": 42,
            "verified_at": body["matches"][0]["verified_at"],
        },
    ]


def test_route_cache_hit_skips_fetch(client, monkeypatch):
    tc, user = client
    # Prime the cache directly.
    yt_worker._cache_put("UCcached", "@cached_peer", 999)
    call_counter = MagicMock()
    call_counter.get = MagicMock()

    def _fail_if_called(*_args, **_kwargs):
        raise AssertionError(
            "cache hit should not hit the http client",
        )

    call_counter.get.side_effect = _fail_if_called
    call_counter.__enter__.return_value = call_counter
    call_counter.__exit__.return_value = False
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        lambda: call_counter,
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCcached"]},
        headers=_auth_headers(user),
    )
    body = r.json()
    assert body["partial"] is False
    assert body["matches"][0]["channel_handle"] == "@cached_peer"
    assert body["matches"][0]["subs"] == 999


def test_route_quota_exceeded_triggers_fallback(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_status=403,
            channels_body=json.dumps(
                {"error": {"errors": [{"reason": "quotaExceeded"}]}},
            ),
        ),
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCquota"]},
        headers=_auth_headers(user),
    )
    body = r.json()
    assert body["partial"] is True
    assert body["matches"][0]["channel_handle"] == ""
    assert body["matches"][0]["subs"] == -1


def test_route_api_error_returns_502(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_status=500,
            channels_body="{}",
        ),
    )
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCoops"]},
        headers=_auth_headers(user),
    )
    assert r.status_code == 502
    assert "channels.list" in r.json()["detail"]


def test_route_partial_when_minute_budget_saturated(client, monkeypatch):
    tc, user = client
    # Fill the minute window so the next request cannot fit.
    yt_worker._reset_state()
    yt_worker._record_lookups(yt_worker.MAX_PER_MINUTE)
    # If the fetch was ever attempted, the mock would raise KeyError
    # because the video branch's items list is default-empty. We wire
    # a no-op mock so any accidental call surfaces via the assertion.
    monkeypatch.setattr(yt_worker, "_http_client", _mk_client())
    r = tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCblock"]},
        headers=_auth_headers(user),
    )
    body = r.json()
    assert body["partial"] is True
    assert body["matches"][0]["channel_handle"] == ""
    assert body["matches"][0]["subs"] == -1


def test_route_populates_cache_after_fetch(client, monkeypatch):
    tc, user = client
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_items=[
                {
                    "id": "UCwarm",
                    "snippet": {"customUrl": "@warm_peer"},
                    "statistics": {"subscriberCount": "3200"},
                },
            ],
        ),
    )
    assert yt_worker._cache_get("UCwarm") is None
    tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCwarm"]},
        headers=_auth_headers(user),
    )
    cached = yt_worker._cache_get("UCwarm")
    assert cached is not None
    (_, handle, subs, _) = cached
    assert handle == "@warm_peer"
    assert subs == 3200


def test_route_records_lookups_against_quota(client, monkeypatch):
    tc, user = client
    yt_worker._reset_state()
    monkeypatch.setattr(
        yt_worker,
        "_http_client",
        _mk_client(
            channels_items=[
                {
                    "id": "UCq",
                    "snippet": {"customUrl": "@q"},
                    "statistics": {"subscriberCount": "7"},
                },
            ],
        ),
    )
    tc.post(
        "/yt/batch-lookup",
        json={"video_ids": [], "channel_ids": ["UCq"]},
        headers=_auth_headers(user),
    )
    assert yt_worker._day_quota_used == 1
    assert len(yt_worker._minute_window) == 1
