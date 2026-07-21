"""YouTube cookie import · 2026-07-21.

Daniel asked for the real fix behind the "bot check" honest-error message
(test_classify_bot_check_error.py): let users bypass YouTube's automated-
download detection with their OWN account's cookies, instead of just
telling them why it failed.

Mirrors the existing OPENAI_API_KEY/ANTHROPIC_API_KEY BYOK pattern exactly
(same secrets_store.set_secret/delete_secret keychain calls, same
method_secret_set/method_secret_delete whitelist) — the only addition is
that a YOUTUBE_COOKIES write ALSO materialises a real cookies.txt file,
because yt-dlp's `cookiefile` option needs a file path, not a string.
"""
from __future__ import annotations

import os

import pytest

import sidecar


@pytest.fixture(autouse=True)
def _isolated_cookies_path(tmp_path, monkeypatch):
    """Redirect the module-level path constant into a scratch dir so tests
    never touch a real ~/LiquidClips directory, and clean up after."""
    fake_path = tmp_path / ".secrets" / "youtube_cookies.txt"
    monkeypatch.setattr(sidecar, "_USER_YOUTUBE_COOKIES_PATH", fake_path)
    yield fake_path


NETSCAPE_SAMPLE = (
    "# Netscape HTTP Cookie File\n"
    ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc123def456\n"
    ".youtube.com\tTRUE\t/\tFALSE\t1999999999\tHSID\tzz9988\n"
)


def test_valid_netscape_cookies_are_written_to_disk(_isolated_cookies_path):
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    assert _isolated_cookies_path.is_file()
    assert "SID" in _isolated_cookies_path.read_text()


def test_written_file_has_restrictive_permissions(_isolated_cookies_path):
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    mode = oct(os.stat(_isolated_cookies_path).st_mode)[-3:]
    assert mode == "600"


def test_header_less_but_well_formed_line_is_accepted(_isolated_cookies_path):
    """Some export tools skip the '# Netscape...' header comment — a real
    tab-separated 7-field cookie line alone must still be accepted."""
    line = ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc123\n"
    sidecar._write_user_youtube_cookies(line)
    assert _isolated_cookies_path.is_file()


def test_empty_paste_is_rejected(_isolated_cookies_path):
    with pytest.raises(ValueError, match="empty"):
        sidecar._write_user_youtube_cookies("   ")
    assert not _isolated_cookies_path.exists()


def test_garbage_paste_is_rejected_with_clear_message(_isolated_cookies_path):
    with pytest.raises(ValueError, match="doesn't look like a cookies.txt file"):
        sidecar._write_user_youtube_cookies("https://youtube.com/watch?v=abc123")
    assert not _isolated_cookies_path.exists()


def test_json_paste_is_rejected(_isolated_cookies_path):
    with pytest.raises(ValueError):
        sidecar._write_user_youtube_cookies('{"cookies": ["a", "b"]}')


def test_delete_removes_the_file(_isolated_cookies_path):
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    assert _isolated_cookies_path.is_file()
    sidecar._delete_user_youtube_cookies()
    assert not _isolated_cookies_path.exists()


def test_delete_is_a_safe_noop_when_no_file_exists(_isolated_cookies_path):
    sidecar._delete_user_youtube_cookies()  # must not raise


def test_yt_dlp_base_opts_uses_the_cookies_file_when_present(_isolated_cookies_path, monkeypatch):
    monkeypatch.delenv("JUNIOR_COOKIES_FILE", raising=False)
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    opts = sidecar._yt_dlp_base_opts()
    assert opts.get("cookiefile") == str(_isolated_cookies_path)


def test_yt_dlp_base_opts_has_no_cookiefile_when_nothing_configured(_isolated_cookies_path, monkeypatch):
    monkeypatch.delenv("JUNIOR_COOKIES_FILE", raising=False)
    opts = sidecar._yt_dlp_base_opts()
    assert "cookiefile" not in opts


def test_env_override_wins_over_user_cookies_file(_isolated_cookies_path, tmp_path, monkeypatch):
    """JUNIOR_COOKIES_FILE is the dev/ops override and must take priority."""
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    override = tmp_path / "ops-cookies.txt"
    override.write_text(NETSCAPE_SAMPLE)
    monkeypatch.setenv("JUNIOR_COOKIES_FILE", str(override))
    opts = sidecar._yt_dlp_base_opts()
    assert opts.get("cookiefile") == str(override)


def test_method_secret_set_accepts_youtube_cookies_and_writes_file(_isolated_cookies_path, monkeypatch):
    # Avoid touching the real macOS keychain in tests.
    monkeypatch.setattr("secrets_store.set_secret", lambda name, value: None)
    result = sidecar.method_secret_set({"name": "YOUTUBE_COOKIES", "value": NETSCAPE_SAMPLE})
    assert result == {"ok": True, "name": "YOUTUBE_COOKIES"}
    assert _isolated_cookies_path.is_file()


def test_method_secret_set_rejects_garbage_before_touching_keychain(_isolated_cookies_path, monkeypatch):
    calls = []
    monkeypatch.setattr("secrets_store.set_secret", lambda name, value: calls.append((name, value)))
    with pytest.raises(ValueError):
        sidecar.method_secret_set({"name": "YOUTUBE_COOKIES", "value": "not cookies at all"})
    # Keychain must never be written to with invalid content.
    assert calls == []


def test_method_secret_delete_accepts_youtube_cookies_and_removes_file(_isolated_cookies_path, monkeypatch):
    sidecar._write_user_youtube_cookies(NETSCAPE_SAMPLE)
    monkeypatch.setattr("secrets_store.delete_secret", lambda name: None)
    result = sidecar.method_secret_delete({"name": "YOUTUBE_COOKIES"})
    assert result == {"ok": True, "name": "YOUTUBE_COOKIES"}
    assert not _isolated_cookies_path.exists()


def test_method_secret_set_still_rejects_unknown_names():
    with pytest.raises(ValueError, match="unknown or unsupported"):
        sidecar.method_secret_set({"name": "SOME_RANDOM_SECRET", "value": "x"})
