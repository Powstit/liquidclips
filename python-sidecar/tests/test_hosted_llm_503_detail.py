"""2026-07-29 · caught live on api.jnremployee.com: a free-bundle user's
hosted LLM call now reaches the backend (Phase 1.6 fix), but the backend's
OpenAI key hit `insufficient_quota` (RateLimitError). The backend maps that
to a 503 with an honest `detail` message — but the sidecar used to hardcode
ONE "Hosted AI is not configured yet" string for every 503, regardless of
what the backend actually said (three different real situations collapse
onto the same status code: never configured · feature not built · provider
transiently out of capacity). This pins that the sidecar now surfaces the
backend's real message instead of guessing.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

import llm


class _FakeResp:
    def __init__(self, status: int, body: dict):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False

    def post(self, url, headers=None, json=None):
        return self._resp


def _call(resp):
    with patch.object(llm, "_license_jwt", return_value="jwt-x"), \
         patch.object(llm, "_backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(resp)):
        llm._call_hosted_with_retry("gpt-4o-mini", "u" * 100, "clips")


def test_503_with_capacity_detail_surfaces_that_exact_message():
    resp = _FakeResp(503, {
        "detail": "Hosted AI is temporarily unavailable — our provider is at "
                  "capacity. Add your own OpenAI key in Settings, or try again shortly.",
    })
    with pytest.raises(RuntimeError) as exc:
        _call(resp)
    assert "temporarily unavailable" in str(exc.value)
    assert "capacity" in str(exc.value)


def test_503_with_never_configured_detail_still_says_that():
    resp = _FakeResp(503, {"detail": "Hosted LLM is not configured yet."})
    with pytest.raises(RuntimeError) as exc:
        _call(resp)
    assert "not configured yet" in str(exc.value)


def test_503_with_unparseable_body_falls_back_to_generic_message():
    """No `detail` key (or non-JSON body) — must not crash, must fall
    back to the old generic message rather than raising a KeyError."""
    resp = _FakeResp(503, {"unexpected": "shape"})
    with pytest.raises(RuntimeError) as exc:
        _call(resp)
    assert "not configured yet" in str(exc.value)


def test_generic_5xx_uses_backend_detail_over_raw_json_dump():
    """A 500 (unhandled exception) still gets FastAPI's {"detail": "..."}
    shape from the exception handler — surface that cleanly instead of
    dumping the raw JSON text into the error message."""
    resp = _FakeResp(500, {"detail": "Internal Server Error"})
    with pytest.raises(RuntimeError) as exc:
        _call(resp)
    msg = str(exc.value)
    assert "HTTP 500" in msg
    assert "Internal Server Error" in msg
    assert '{"detail"' not in msg
