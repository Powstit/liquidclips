"""2026-07-29 · caught live testing BYOK Anthropic end-to-end.

llm.py's Anthropic BYOK key caches after boot warmup so a clip-run never
hits a mid-run keychain prompt. But the cache used to short-circuit on
ANY warmed state — including a negative one. Boot warmup runs once,
before the sidecar ever serves a request; a key pasted into Settings
AFTER boot (the exact flow Settings.tsx's AnthropicKeyCard offers) left
the cache permanently `None` for the rest of the process's life, even
though the keychain now has a real key.

These tests pin: a negative cache never blocks a later positive read: a
positive cache DOES short-circuit (preserving the original
prompt-avoidance intent for the common case).
"""
from __future__ import annotations

from unittest.mock import patch

import llm


def _reset_cache():
    llm._ANTHROPIC_KEY_CACHE["key"] = None
    llm._ANTHROPIC_KEY_CACHE["warmed"] = False


def test_negative_boot_cache_does_not_block_a_key_added_later():
    _reset_cache()
    # Simulate warmup_anthropic_key()'s boot-time behavior: it sets
    # warmed=True unconditionally, even when no key was found yet.
    llm._ANTHROPIC_KEY_CACHE["warmed"] = True
    llm._ANTHROPIC_KEY_CACHE["key"] = None

    with patch.object(llm, "_read_keychain_anthropic_key", return_value=None):
        assert llm.resolve_anthropic_key() is None

    # User pastes a key into Settings mid-session. Same process, no
    # restart — must be picked up on the very next resolve call, even
    # though `warmed` is still True from boot.
    with patch.object(llm, "_read_keychain_anthropic_key", return_value="sk-ant-fresh"):
        assert llm.resolve_anthropic_key() == "sk-ant-fresh"


def test_positive_cache_short_circuits_without_a_live_read():
    _reset_cache()
    llm._ANTHROPIC_KEY_CACHE["key"] = "sk-ant-cached"
    llm._ANTHROPIC_KEY_CACHE["warmed"] = True

    with patch.object(llm, "_read_keychain_anthropic_key") as mock_read:
        result = llm.resolve_anthropic_key()

    assert result == "sk-ant-cached"
    mock_read.assert_not_called()


def test_env_var_wins_over_everything():
    _reset_cache()
    with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "sk-ant-env"}), \
         patch.object(llm, "_read_keychain_anthropic_key") as mock_read:
        assert llm.resolve_anthropic_key() == "sk-ant-env"
    mock_read.assert_not_called()
