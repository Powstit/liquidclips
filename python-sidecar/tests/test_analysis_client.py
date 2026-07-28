"""Phase B · analysis_client contract tests (2026-07-17).

Mocks the backend HTTP layer at the httpx.Client boundary. No
real network calls.
"""
from __future__ import annotations

import time
from unittest.mock import patch, MagicMock

import httpx
import pytest

from analysis_client import (
    AnalysisClient,
    AnalysisContractError,
    HeartbeatTicker,
    ReserveResult,
)


# ─────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────

class _FakeResponse:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


class _FakeHttpxClient:
    """Drop-in for httpx.Client(). Records posts + returns queued responses."""
    def __init__(self, *responses):
        self._responses = list(responses)
        self.posts = []
        self.gets = []

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def post(self, url, headers=None, json=None):
        self.posts.append({"url": url, "headers": headers, "json": json})
        return self._responses.pop(0)

    def get(self, url, headers=None):
        self.gets.append({"url": url, "headers": headers})
        return self._responses.pop(0)


def _reserve_body(**overrides):
    body = {
        "reservation_id": "rsv_test_" + "a" * 24,
        "source_analysis_id": "src_test_" + "b" * 24,
        "plan_tier": "studio",
        "provider_route": "hosted_openai_mini",
        "standard_model": "gpt-4o-mini",
        "standard_fallback_model": None,
        "estimated_cost_cap_cents": 3,
        "lease_expires_at": "2026-07-17T12:00:00+00:00",
        "heartbeat_interval_seconds": 60,
        "resumed": False,
    }
    body.update(overrides)
    return body


# ─────────────────────────────────────────────────────────────────────
# reserve
# ─────────────────────────────────────────────────────────────────────

def test_reserve_returns_decoded_result():
    client = AnalysisClient("jwt-test-token", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(200, _reserve_body(resumed=True)))

    with patch("analysis_client.httpx.Client", return_value=fake):
        result = client.reserve(
            content_hash="a" * 64,
            transcript_hash="b" * 64,
            analysis_version="v1",
            speech_seconds=1800,
            run_id="run_abcdef123456",
        )

    assert isinstance(result, ReserveResult)
    assert result.provider_route == "hosted_openai_mini"
    assert result.resumed is True
    assert fake.posts[0]["url"].endswith("/analysis/reserve")
    assert fake.posts[0]["json"]["speech_seconds"] == 1800


def test_reserve_401_missing_jwt_raises_before_network():
    """No JWT · client refuses without hitting the backend."""
    client = AnalysisClient(license_jwt=None, base_url="http://backend.test")
    with pytest.raises(AnalysisContractError) as ei:
        client.reserve(
            content_hash="a" * 64, transcript_hash=None,
            analysis_version="v1", speech_seconds=100, run_id="run_test1234",
        )
    assert ei.value.code == "missing_license_jwt"


def test_reserve_402_allowance_exceeded_raises_structured():
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(402, {
        "detail": {
            "code": "allowance_exceeded",
            "message": "used this month's allowance",
            "remaining_seconds": 0,
        }
    }))
    with patch("analysis_client.httpx.Client", return_value=fake):
        with pytest.raises(AnalysisContractError) as ei:
            client.reserve(
                content_hash="a" * 64, transcript_hash=None,
                analysis_version="v1", speech_seconds=100, run_id="run_test1234",
            )
    assert ei.value.code == "allowance_exceeded"
    assert ei.value.http_status == 402


class _FlakyThenOkClient:
    """Simulates a transport that fails N times with a transient error,
    then succeeds — mirrors what a real dropped connection under load
    looks like from the caller's side."""
    def __init__(self, fail_times: int, final_response: _FakeResponse, exc=None):
        self._fail_times = fail_times
        self._final_response = final_response
        self._exc = exc or httpx.ConnectError("connection refused")
        self.call_count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def post(self, url, headers=None, json=None):
        self.call_count += 1
        if self.call_count <= self._fail_times:
            raise self._exc
        return self._final_response

    def get(self, url, headers=None):
        return self.post(url, headers=headers)


def test_reserve_retries_transient_connect_error_then_succeeds():
    """2026-07-28 · a single dropped connection must not kill an
    otherwise-successful reserve — this is the fix for a real run that
    crashed the whole clipping pipeline on one ECONNREFUSED blip."""
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FlakyThenOkClient(fail_times=1, final_response=_FakeResponse(200, _reserve_body()))
    with patch("analysis_client.httpx.Client", return_value=fake), \
         patch("analysis_client.time.sleep") as mock_sleep:
        result = client.reserve(
            content_hash="a" * 64, transcript_hash=None,
            analysis_version="v1", speech_seconds=100, run_id="run_test1234",
        )
    assert isinstance(result, ReserveResult)
    assert fake.call_count == 2  # one failure, one success
    assert mock_sleep.call_count == 1  # backed off exactly once


def test_reserve_gives_up_after_max_attempts_on_persistent_connect_error():
    """Not every connect error is transient — a genuinely dead backend
    must still surface as a real error, not retry forever."""
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FlakyThenOkClient(fail_times=99, final_response=_FakeResponse(200, _reserve_body()))
    with patch("analysis_client.httpx.Client", return_value=fake), \
         patch("analysis_client.time.sleep"):
        with pytest.raises(httpx.ConnectError):
            client.reserve(
                content_hash="a" * 64, transcript_hash=None,
                analysis_version="v1", speech_seconds=100, run_id="run_test1234",
            )
    assert fake.call_count == 3  # _MAX_ATTEMPTS, no more


def test_reserve_402_allowance_exceeded_does_not_retry():
    """A structured business-logic refusal (allowance exceeded, invalid
    license, already settled) is not a transport error — must raise
    immediately, never retried."""
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(402, {
        "detail": {"code": "allowance_exceeded", "message": "used this month's allowance"}
    }))
    with patch("analysis_client.httpx.Client", return_value=fake):
        with pytest.raises(AnalysisContractError):
            client.reserve(
                content_hash="a" * 64, transcript_hash=None,
                analysis_version="v1", speech_seconds=100, run_id="run_test1234",
            )
    assert len(fake.posts) == 1  # exactly one attempt, no retry


def test_reserve_409_free_bundle_used_raises_structured():
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(409, {
        "detail": {"code": "free_bundle_used", "message": "used"}
    }))
    with patch("analysis_client.httpx.Client", return_value=fake):
        with pytest.raises(AnalysisContractError) as ei:
            client.reserve(
                content_hash="a" * 64, transcript_hash=None,
                analysis_version="v1", speech_seconds=100, run_id="run_test1234",
            )
    assert ei.value.code == "free_bundle_used"


# ─────────────────────────────────────────────────────────────────────
# heartbeat + settle + release
# ─────────────────────────────────────────────────────────────────────

def test_heartbeat_carries_reservation_id():
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(200, {"reservation_id": "rsv_x", "state": "reserved", "lease_expires_at": "…"}))
    with patch("analysis_client.httpx.Client", return_value=fake):
        client.heartbeat("rsv_x")
    assert fake.posts[0]["json"] == {"reservation_id": "rsv_x"}


def test_settle_payload_shape():
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(200, {
        "reservation_id": "r", "source_analysis_id": "s", "state": "settled", "allowance_used_seconds": 900,
    }))
    with patch("analysis_client.httpx.Client", return_value=fake):
        client.settle(
            reservation_id="rsv_abc" + "a" * 15,
            actual_seconds=900,
            cost_usd_micros=3000,
            input_tokens=5000,
            output_tokens=1200,
            provider="hosted_openai",
            model="gpt-4o-mini",
            clips_generated=10,
        )
    body = fake.posts[0]["json"]
    assert body["cost_usd_micros"] == 3000
    assert body["input_tokens"] == 5000
    assert body["output_tokens"] == 1200
    assert body["clips_generated"] == 10


def test_release_carries_reason():
    client = AnalysisClient("jwt", base_url="http://backend.test")
    fake = _FakeHttpxClient(_FakeResponse(200, {"reservation_id": "r", "state": "released"}))
    with patch("analysis_client.httpx.Client", return_value=fake):
        client.release(reservation_id="rsv_abc" + "z" * 15, reason="provider_timeout")
    assert fake.posts[0]["json"]["reason"] == "provider_timeout"


# ─────────────────────────────────────────────────────────────────────
# HeartbeatTicker
# ─────────────────────────────────────────────────────────────────────

def test_heartbeat_ticker_fires_immediately_on_start():
    """Daniel's Phase B protection: FIRST heartbeat immediately, then
    every interval. Not the other way around."""
    mock_client = MagicMock()
    mock_client.heartbeat.return_value = {}
    ticker = HeartbeatTicker(client=mock_client, reservation_id="rsv_test", interval=60)
    ticker.start()
    try:
        # Immediately after start · at least one call already fired.
        assert mock_client.heartbeat.call_count >= 1
        mock_client.heartbeat.assert_called_with("rsv_test")
    finally:
        ticker.stop()


def test_heartbeat_ticker_stops_cleanly():
    mock_client = MagicMock()
    ticker = HeartbeatTicker(client=mock_client, reservation_id="rsv", interval=60)
    ticker.start()
    ticker.stop()
    # Second stop is a no-op.
    ticker.stop()


def test_heartbeat_ticker_absorbs_errors():
    """Heartbeat failures never leak out — a lease that expires
    because of network drops transitions to `abandoned` server-side
    and the settle/release attempts detect it."""
    errors = []
    mock_client = MagicMock()
    mock_client.heartbeat.side_effect = RuntimeError("boom")
    ticker = HeartbeatTicker(
        client=mock_client, reservation_id="rsv", interval=60,
        on_error=lambda e: errors.append(e),
    )
    ticker.start()
    ticker.stop()
    assert len(errors) >= 1
