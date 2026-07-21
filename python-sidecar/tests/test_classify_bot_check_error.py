"""YouTube bot-check misclassification · regression · 2026-07-21.

Second real bug found in the same smoke test as the live-stream guard:
YouTube's automated-download detection ("Sign in to confirm you're not a
bot", "The page needs to be reloaded") was falling through to the generic
private/unavailable bucket, telling the user "That link isn't public" —
actively wrong, since the video IS public and YouTube is blocking the
automated request, not gating the content. Reproduced against 3 unrelated,
definitely-public videos (including two globally famous ones) — all three
hit bot-check, confirming this is a systemic, current YouTube posture, not
a per-video issue.

_classify_yt_dlp_error must now recognise these messages and return an
honest, distinct error — checked BEFORE the private/unavailable bucket,
since bot-check text can itself contain "unavailable"-adjacent wording.
"""
from __future__ import annotations

import sidecar


def test_sign_in_confirm_not_a_bot_is_not_misclassified_as_private():
    exc = RuntimeError(
        "ERROR: [youtube] Y3VpOgCr7xw: Sign in to confirm you're not a bot. "
        "Use --cookies-from-browser or --cookies for the authentication."
    )
    blocked = sidecar._classify_yt_dlp_error(exc, "https://youtu.be/Y3VpOgCr7xw")
    assert blocked.error_code == "youtube_bot_check"
    # Must NOT say the video is private/not public — it demonstrably is public.
    assert "isn't public" not in blocked.customer_message
    assert "not public" not in blocked.customer_message.lower()


def test_page_needs_to_be_reloaded_is_classified_as_bot_check():
    exc = RuntimeError("ERROR: [youtube] 9bZkp7q19f0: The page needs to be reloaded.")
    blocked = sidecar._classify_yt_dlp_error(exc, "https://www.youtube.com/watch?v=9bZkp7q19f0")
    assert blocked.error_code == "youtube_bot_check"


def test_genuinely_private_video_is_still_classified_correctly():
    """Guard the OTHER direction — a real private-video error must still
    hit the private/unavailable bucket, not get swallowed by the new check."""
    exc = RuntimeError("ERROR: [youtube] abc123: Private video. Sign in if you've been granted access to this video.")
    blocked = sidecar._classify_yt_dlp_error(exc, "https://youtu.be/abc123")
    # Contains "sign in" too, but not the bot-check phrase — must NOT match
    # youtube_bot_check; falls through to the existing sign-in/private path.
    assert blocked.error_code != "youtube_bot_check"
