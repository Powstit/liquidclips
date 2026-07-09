"""Regression guard · 2026-07-09 (RPC JWT injection · Daniel's approved fix)

Rule: hosted-mode sidecar MUST NOT touch the macOS Keychain on the
clip-run hot path. All BYOK-style keychain reads (ANTHROPIC_API_KEY,
OPENAI_API_KEY) AND the LICENSE_JWT read are gated via
`secrets_store.assert_hosted_may_read()`.

This test monkey-patches `keyring.get_password` to raise so a bug
would trip immediately, then exercises:

1. `set_license_jwt(jwt)` populates the in-process cache with zero
   keychain reads.
2. `get_license_jwt_cached()` returns the RPC-injected value without
   touching keychain.
3. In hosted mode, `assert_hosted_may_read("ANTHROPIC_API_KEY")`
   raises `HostedKeychainViolation` in dev.
4. In hosted mode, `assert_hosted_may_read("LICENSE_JWT")` raises
   `HostedKeychainViolation` in dev — the sidecar must rely on the
   RPC-injected cache, never the keychain.
5. `keychain_read_attempted_count` bumps on every gate call so the
   HQ regression alert can fire.
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_state():
    """Fresh cache + gate + counter for every test."""
    from secrets_store import (
        invalidate_jwt_cache,
        set_clip_judge_mode,
        reset_keychain_attempt_count,
    )
    invalidate_jwt_cache()
    set_clip_judge_mode("auto")
    reset_keychain_attempt_count()
    yield
    invalidate_jwt_cache()
    set_clip_judge_mode("auto")
    reset_keychain_attempt_count()


@pytest.fixture
def keychain_raises(monkeypatch):
    """Patch keyring.get_password to raise so any keychain read is loud."""
    import keyring

    def _boom(*a, **kw):
        raise AssertionError("keychain read is forbidden in hosted-mode tests")

    monkeypatch.setattr(keyring, "get_password", _boom)
    yield


def test_rpc_injection_populates_cache_without_keychain(keychain_raises):
    from secrets_store import set_license_jwt, get_license_jwt_cached, set_clip_judge_mode

    set_clip_judge_mode("hosted")
    set_license_jwt("test-jwt-abc123")

    # get_license_jwt_cached must return the injected value with zero keychain reads.
    # keychain_raises would raise AssertionError if a read fired.
    assert get_license_jwt_cached() == "test-jwt-abc123"


def test_hosted_mode_blocks_anthropic_key_read():
    from secrets_store import set_clip_judge_mode, assert_hosted_may_read, HostedKeychainViolation

    set_clip_judge_mode("hosted")
    with pytest.raises(HostedKeychainViolation):
        assert_hosted_may_read("ANTHROPIC_API_KEY")


def test_hosted_mode_blocks_openai_key_read():
    from secrets_store import set_clip_judge_mode, assert_hosted_may_read, HostedKeychainViolation

    set_clip_judge_mode("hosted")
    with pytest.raises(HostedKeychainViolation):
        assert_hosted_may_read("OPENAI_API_KEY")


def test_hosted_mode_blocks_license_jwt_keychain_read():
    """The keychain path for LICENSE_JWT must not run in hosted mode —
    the frontend RPC-injects the JWT instead."""
    from secrets_store import set_clip_judge_mode, assert_hosted_may_read, HostedKeychainViolation

    set_clip_judge_mode("hosted")
    with pytest.raises(HostedKeychainViolation):
        assert_hosted_may_read("LICENSE_JWT")


def test_auto_mode_allows_reads():
    from secrets_store import set_clip_judge_mode, assert_hosted_may_read

    set_clip_judge_mode("auto")
    # Should NOT raise in auto mode.
    assert_hosted_may_read("ANTHROPIC_API_KEY")
    assert_hosted_may_read("LICENSE_JWT")


def test_read_jwt_with_gate_bails_in_hosted_mode(keychain_raises):
    """The internal `_read_jwt_with_gate` must not touch keychain in hosted
    mode — even without a prior `set_license_jwt` call. First call returns
    None; second call (cache warmed) still None; keychain never fires."""
    from secrets_store import set_clip_judge_mode, get_license_jwt_cached

    set_clip_judge_mode("hosted")
    # In prod (packaged sidecar) hosted-mode LICENSE_JWT read warn-logs and
    # returns None. In dev the assertion raises so the caller crashes loud.
    # Tests run in dev mode (sys.frozen is False), so we expect the raise.
    from secrets_store import HostedKeychainViolation
    with pytest.raises(HostedKeychainViolation):
        get_license_jwt_cached()


def test_keychain_attempt_counter_increments():
    """Every gate call — allowed OR blocked — bumps the counter so HQ can
    see the regression the second it lands in prod telemetry."""
    from secrets_store import (
        set_clip_judge_mode,
        assert_hosted_may_read,
        get_keychain_attempt_count,
    )

    set_clip_judge_mode("auto")
    assert get_keychain_attempt_count() == 0
    assert_hosted_may_read("ANTHROPIC_API_KEY")
    assert get_keychain_attempt_count() == 1
    assert_hosted_may_read("LICENSE_JWT")
    assert get_keychain_attempt_count() == 2
