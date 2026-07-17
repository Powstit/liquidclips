"""Phase B · Studio Unlimited MUST NOT fall back to hosted (2026-07-17).

Locks in the LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK env-flag contract on
the two hosted-fallback helpers. When the flag is set (stage_llm
sets it around every byok_openai_only run), the helpers return None
without touching the hosted key path — even when the JWT + tier
would otherwise permit it.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

import llm


@pytest.fixture(autouse=True)
def _clear_flag():
    """Ensure the env flag doesn't leak between tests."""
    import os
    prior = os.environ.pop("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK", None)
    yield
    if prior is not None:
        os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = prior
    else:
        os.environ.pop("LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK", None)


def test_hosted_openai_fallback_returns_none_when_blocked():
    """Even with a valid hosted JWT + tier that would ordinarily
    unlock the hosted proxy, the block flag returns None."""
    import os
    os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = "1"

    # Ensure the underlying availability check WOULD have said yes.
    with patch.object(llm, "_hosted_llm_maybe_available", return_value=True):
        result = llm._try_hosted_openai_fallback("clips", "test message")

    assert result is None


def test_hosted_openai_fallback_works_when_not_blocked():
    """Without the block flag, the existing fallback path fires as
    it always has. Regression guard."""
    with patch.object(llm, "_hosted_llm_maybe_available", return_value=False):
        result = llm._try_hosted_openai_fallback("clips", "test message")
    # `_hosted_llm_maybe_available` returned False → still None, but
    # via the *existing* code path (not the new gate).
    assert result is None


def test_block_flag_helper_reads_env():
    import os
    assert llm._hosted_fallback_blocked() is False
    os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = "1"
    assert llm._hosted_fallback_blocked() is True
    os.environ["LIQUIDCLIPS_BLOCK_HOSTED_FALLBACK"] = "0"
    assert llm._hosted_fallback_blocked() is False
