"""Phase 1.5 · Hosted OpenAI proxy propagates cost/tokens through to
settle · Studio Unlimited BYOK records ZERO Liquid Clips hosted cost.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

import llm


def _fake_bundle_json():
    return {
        "clips": [{"start": 5, "end": 30, "title": "clip 1",
                   "description": "d", "theme": "hook", "virality": 88,
                   "slug": "clip-1", "title_variants": ["t"], "pinned_comment": ""}],
        "chapters": [], "description": "", "video_title_variants": [],
        "scored_titles": [], "tags": [], "hashtags": [],
        "pinned_video_comment": "", "end_screen_ctas": [],
        "tweet_thread": [], "linkedin_post": "",
    }


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


def test_call_hosted_with_retry_returns_tuple_including_cost_tokens():
    """The new /proxy/llm/clip-bundle response shape includes
    input_tokens, output_tokens, cost_usd. Sidecar must return them
    as (bundle, cost_usd, input_tokens, output_tokens)."""
    resp = _FakeResp(200, {
        "bundle": _fake_bundle_json(),
        "model": "gpt-4o-mini",
        "usage_tokens": 6200,
        "quota_remaining": 1_993_800,
        "input_tokens": 5000,
        "output_tokens": 1200,
        "cost_usd": 0.00147,     # 5000×0.15/M + 1200×0.60/M
    })
    with patch.object(llm, "_license_jwt", return_value="jwt-x"), \
         patch.object(llm, "_backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(resp)):
        bundle, cost, in_tok, out_tok = llm._call_hosted_with_retry(
            "gpt-4o-mini", "user message ≥80 chars — this is padding to satisfy min_length constraints" * 2, "clips",
        )
    assert cost == pytest.approx(0.00147)
    assert in_tok == 5000
    assert out_tok == 1200


def test_call_hosted_split_sums_cost_across_two_calls():
    """`_call_hosted_split` fires two parallel calls (clips + youtube).
    Cost + tokens must sum both."""
    resp = _FakeResp(200, {
        "bundle": _fake_bundle_json(),
        "model": "gpt-4o-mini",
        "usage_tokens": 3000,
        "quota_remaining": 100,
        "input_tokens": 2000,
        "output_tokens": 1000,
        "cost_usd": 0.0009,
    })
    with patch.object(llm, "_license_jwt", return_value="jwt-x"), \
         patch.object(llm, "_backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(resp)):
        _bundle, cost, in_tok, out_tok = llm._call_hosted_split(
            "gpt-4o-mini", "user message ≥80 chars long padding " * 4,
        )
    # Both parallel calls hit the same mock → each returns cost=0.0009.
    assert cost == pytest.approx(0.0009 * 2)
    assert in_tok == 4000
    assert out_tok == 2000


def test_zero_cost_hosted_response_still_valid():
    """Backwards-compat: an older backend that hasn't been redeployed
    yet returns only `bundle + usage_tokens`. Sidecar must not crash."""
    resp = _FakeResp(200, {
        "bundle": _fake_bundle_json(),
        "model": "gpt-4o-mini",
        "usage_tokens": 3000,
        "quota_remaining": 100,
        # No input_tokens / output_tokens / cost_usd — legacy shape.
    })
    with patch.object(llm, "_license_jwt", return_value="jwt-x"), \
         patch.object(llm, "_backend_url", return_value="http://backend.test"), \
         patch("httpx.Client", return_value=_FakeClient(resp)):
        _bundle, cost, in_tok, out_tok = llm._call_hosted_with_retry(
            "gpt-4o-mini", "u" * 100, "clips",
        )
    assert cost == 0.0
    assert in_tok == 0
    assert out_tok == 0
