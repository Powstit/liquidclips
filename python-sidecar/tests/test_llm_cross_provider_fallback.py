"""Contract tests for v2.2.37 · cross-provider fallback.

Anthropic returning "Your credit balance is too low" mid-run used to
hard-fail the pipeline (Daniel's incident 2026-07-17, log entry:
`RuntimeError: Anthropic rejected clip bundle request: Error code:
400 - {'type': 'error', ... 'message': 'Your credit balance is too
low to access the Anthropic API. Please go to Plans & Billing to
upgrade or purchase credits.'}`).

These tests lock in that a credit / quota exhaustion falls through to
the next provider in the ladder instead of raising.

Nothing here talks to a real Anthropic or OpenAI endpoint — every LLM
call is monkeypatched at the module boundary.
"""
from __future__ import annotations

import types
from typing import Any

import pytest

import llm


class _StubBundle:
    """Duck-typed ClipBundle stand-in for tests that don't care about
    the JSON schema. The outer normalisation loop needs `.clips` to be
    iterable with `.start`, `.end`, `.title`, `.hook_line`, `.viral_score`
    for the pass-through to succeed."""

    def __init__(self, clips: list[Any] | None = None) -> None:
        self.clips = clips or []
        self.chapters = []
        self.description = ""
        self.video_title_variants = []
        self.scored_titles = []
        self.tags = []
        self.hashtags = []
        self.pinned_video_comment = ""
        self.end_screen_ctas = []
        self.tweet_thread = []
        self.linkedin_post = ""


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    # Force explicit provider + guarantee no hosted path leaks in.
    monkeypatch.setenv("JUNIOR_CLIP_JUDGE_PROVIDER", "auto")
    # Clean any leaked JWT/tier hints from prior tests so
    # `_hosted_llm_maybe_available()` deterministically returns False
    # unless the specific test overrides it.
    monkeypatch.setattr(llm, "_hosted_llm_maybe_available", lambda: False)
    monkeypatch.setattr(llm, "_hosted_anthropic_maybe_available", lambda: False)


def _minimal_transcript() -> dict[str, Any]:
    return {
        "duration": 60.0,
        "segments": [
            {"start": 0.0, "end": 30.0, "text": "hello world"},
            {"start": 30.0, "end": 60.0, "text": "goodbye world"},
        ],
    }


def test_is_provider_exhausted_matches_todays_error():
    """The exact string Anthropic returned in Daniel's 2026-07-17
    log must trigger fallback. Any minor wording drift on either side
    (`credit balance` / `Credit Balance` / `credit_balance`) also
    triggers."""
    exc = RuntimeError(
        "Anthropic rejected clip bundle request: Error code: 400 - "
        "{'type': 'error', 'error': {'type': 'invalid_request_error', "
        "'message': 'Your credit balance is too low to access the "
        "Anthropic API. Please go to Plans & Billing to upgrade or "
        "purchase credits.'}}"
    )
    assert llm._is_provider_exhausted(exc, llm._ANTHROPIC_EXHAUSTED_MARKERS)


def test_is_provider_exhausted_ignores_unrelated_errors():
    """Ordinary 5xx / timeout / schema failures must NOT fall through
    — the request may just need a retry with the same provider."""
    exc = RuntimeError("Anthropic call failed (HTTP 503): overloaded")
    assert not llm._is_provider_exhausted(exc, llm._ANTHROPIC_EXHAUSTED_MARKERS)


def test_anthropic_credit_exhaustion_falls_through_to_openai(monkeypatch):
    """Full-flow test — provider picker chooses `anthropic` (BYOK),
    Anthropic raises the credit-balance error, `_try_openai_fallback`
    returns a valid bundle, and `pick_clips_from_transcript` succeeds."""

    monkeypatch.setattr(llm, "resolve_anthropic_key", lambda: "sk-ant-fake")
    monkeypatch.setattr(llm, "resolve_openai_key", lambda: "sk-openai-fake")

    # Stub the Anthropic SDK: import + client() succeed; the retry
    # helper raises with the exact production error.
    class _FakeAnthropicClient:
        def __init__(self, **_kw): pass

    fake_anthropic = types.SimpleNamespace(Anthropic=_FakeAnthropicClient)
    monkeypatch.setitem(__import__("sys").modules, "anthropic", fake_anthropic)

    def _raise_credit_error(*_args, **_kw):
        raise RuntimeError(
            "Anthropic rejected clip bundle request: Error code: 400 - "
            "{'type': 'error', 'error': {'type': 'invalid_request_error', "
            "'message': 'Your credit balance is too low to access the "
            "Anthropic API. Please go to Plans & Billing to upgrade or "
            "purchase credits.'}}"
        )
    monkeypatch.setattr(llm, "_call_anthropic_with_retry", _raise_credit_error)
    monkeypatch.setattr(llm, "_call_anthropic_split", _raise_credit_error)

    # Real Clip instance keeps the normalisation loop happy across
    # schema drift. Duration 40s hits the 30-75s window so it isn't
    # trimmed / rejected downstream.
    real_clip = llm.Clip(
        start=0.0,
        end=40.0,
        title="test clip",
        description="short test description",
        theme="test",
        virality=80,
        slug="test-clip",
        title_variants=["alt 1"],
        pinned_comment="pin",
    )

    def _openai_bundle(*_args, **_kw):
        return llm.ClipBundle(clips=[real_clip])

    class _FakeOpenAI:
        def __init__(self, **_kw): pass
    monkeypatch.setitem(
        __import__("sys").modules,
        "openai",
        types.SimpleNamespace(OpenAI=_FakeOpenAI),
    )
    monkeypatch.setattr(llm, "_call_with_retry", _openai_bundle)
    monkeypatch.setattr(llm, "_call_split", _openai_bundle)

    # Capture fallback events so the test asserts the ladder actually
    # emitted a diagnostic — silent fallback would be worse than
    # hard-failing (operators can't see it happening).
    events: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(llm, "_emit_event", lambda name, data: events.append((name, data)))

    # Force provider to "anthropic" (BYOK path) so we cover the
    # non-hosted branch.
    monkeypatch.setenv("JUNIOR_CLIP_JUDGE_PROVIDER", "anthropic")

    result = llm.pick_clips_from_transcript(
        _minimal_transcript(), brief=None, intent="clips", target_count=5
    )

    assert result["clip_judge_provider"] == "openai_fallback"
    fallback_events = [e for e in events if e[0] == "clip_judge_fallback_fired"]
    assert fallback_events, "no fallback event emitted"
    assert fallback_events[0][1]["from"] == "anthropic"
    assert fallback_events[0][1]["reason"] == "anthropic_exhausted"


def test_non_credit_anthropic_error_does_not_trigger_fallback(monkeypatch):
    """A vanilla 503 / timeout / schema error must NOT trigger the
    OpenAI fallback — same provider should just fail the run so the
    operator can see the real cause."""
    monkeypatch.setattr(llm, "resolve_anthropic_key", lambda: "sk-ant-fake")
    monkeypatch.setattr(llm, "resolve_openai_key", lambda: "sk-openai-fake")

    class _FakeAnthropicClient:
        def __init__(self, **_kw): pass
    monkeypatch.setitem(
        __import__("sys").modules,
        "anthropic",
        types.SimpleNamespace(Anthropic=_FakeAnthropicClient),
    )

    def _raise_503(*_args, **_kw):
        raise RuntimeError("Anthropic call failed (HTTP 503): overloaded")
    monkeypatch.setattr(llm, "_call_anthropic_with_retry", _raise_503)

    # OpenAI stub — must NOT be reached.
    openai_called = {"n": 0}
    def _openai_called(*_args, **_kw):
        openai_called["n"] += 1
        return _StubBundle()
    monkeypatch.setattr(llm, "_call_with_retry", _openai_called)

    monkeypatch.setenv("JUNIOR_CLIP_JUDGE_PROVIDER", "anthropic")

    with pytest.raises(RuntimeError, match="503"):
        llm.pick_clips_from_transcript(
            _minimal_transcript(), brief=None, intent="clips", target_count=5
        )
    assert openai_called["n"] == 0, "OpenAI should not be called for a 503"


def test_anthropic_exhausted_with_no_openai_key_raises_original_error(monkeypatch):
    """If neither OpenAI BYOK nor hosted OpenAI is available, the
    fallback returns None and the ORIGINAL Anthropic error is
    surfaced verbatim so the operator sees the real cause."""
    monkeypatch.setattr(llm, "resolve_anthropic_key", lambda: "sk-ant-fake")
    monkeypatch.setattr(llm, "resolve_openai_key", lambda: None)

    class _FakeAnthropicClient:
        def __init__(self, **_kw): pass
    monkeypatch.setitem(
        __import__("sys").modules,
        "anthropic",
        types.SimpleNamespace(Anthropic=_FakeAnthropicClient),
    )

    def _raise_credit(*_args, **_kw):
        raise RuntimeError(
            "Anthropic rejected clip bundle request: credit balance too low"
        )
    monkeypatch.setattr(llm, "_call_anthropic_with_retry", _raise_credit)

    monkeypatch.setenv("JUNIOR_CLIP_JUDGE_PROVIDER", "anthropic")

    with pytest.raises(RuntimeError, match="credit balance"):
        llm.pick_clips_from_transcript(
            _minimal_transcript(), brief=None, intent="clips", target_count=5
        )
