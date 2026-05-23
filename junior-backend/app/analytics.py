"""PostHog event emitter for the backend.

Privacy posture (reviewer spec):
  - Identify with internal IDs only: user.id (our UUID), clerk_id,
    whop_user_id, affiliate_id.
  - NEVER send: raw email, JWTs, access tokens, license tokens, Whop
    access tokens, local paths, video filenames, transcripts.
  - PostHog is observability only — the DB is the source of truth for
    affiliate attribution and payouts.

We construct the client lazily so missing config never breaks an import,
and we use the project key (POSTHOG_KEY) — there's no need for a
personal API key for event capture.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from app.config import get_settings

log = logging.getLogger("junior.analytics")

_client = None
_inited = False

BackendEvent = Literal[
    # Webhook lifecycle
    "signup_completed",                 # user.created handled
    "affiliate_attribution_locked",     # affiliate_id baked at signup
    "whop_membership_valid",            # paid subscription went live
    "subscription_activated",           # Clerk subscription_active
    "subscription_canceled",
    # Desktop activation
    "desktop_activated",                # /desktop/connect first license issued
]


def _ensure_client() -> Any:
    global _client, _inited
    if _inited:
        return _client
    s = get_settings()
    if not s.posthog_key:
        _inited = True
        return None
    try:
        import posthog as ph
        ph.api_key = s.posthog_key
        ph.host = s.posthog_host
        _client = ph
    except Exception as e:  # noqa: BLE001
        log.warning("[analytics] PostHog client init failed: %s", e)
        _client = None
    _inited = True
    return _client


# Property keys we always strip before sending. Defence-in-depth for the
# call sites that should already follow the rules.
_FORBIDDEN_KEYS = frozenset(
    {
        "email", "user_email", "primary_email",
        "token", "access_token", "id_token", "jwt", "license_jwt",
        "api_key", "secret", "password",
        "path", "filename", "source_path", "source_filename",
        "transcript",
    }
)


def _sanitize(props: dict[str, Any] | None) -> dict[str, Any]:
    if not props:
        return {}
    out: dict[str, Any] = {}
    for k, v in props.items():
        if k.lower() in _FORBIDDEN_KEYS:
            continue
        out[k] = v
    return out


def capture(
    *,
    user_id: str,
    event: BackendEvent,
    properties: dict[str, Any] | None = None,
) -> None:
    """Emit a backend event. `user_id` is whatever string the frontend used
    to identify the user — for us that's the Clerk user id (`user.clerk_id`).
    Keeps frontend and backend events on the same person without mixing in
    our internal UUID."""
    client = _ensure_client()
    if not client:
        return
    try:
        client.capture(
            distinct_id=user_id,
            event=event,
            properties=_sanitize(properties),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("[analytics] capture failed event=%s err=%s", event, e)


def identify(
    *,
    user_id: str,
    clerk_id: str | None = None,
    affiliate_id: str | None = None,
    whop_user_id: str | None = None,
    tier: str | None = None,
) -> None:
    """Set person properties so funnel dashboards can group by tier /
    affiliate without us shipping the email."""
    client = _ensure_client()
    if not client:
        return
    try:
        client.set(
            distinct_id=user_id,
            properties={
                k: v
                for k, v in {
                    "clerk_id": clerk_id,
                    "affiliate_id": affiliate_id,
                    "whop_user_id": whop_user_id,
                    "tier": tier,
                }.items()
                if v is not None
            },
        )
    except Exception as e:  # noqa: BLE001
        log.warning("[analytics] identify failed user=%s err=%s", user_id, e)
