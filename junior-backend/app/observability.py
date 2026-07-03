"""Step 7 · cross-tool correlation helpers.

The four systems (PostHog · Sentry · Railway · HQ) all share the same
identifier tuple ``(release, feature_id, journey_id, correlation_id)``.
This module builds the shared context payload that any sink can consume
so we never duplicate business logic per sink.

Public API:

* ``sentry_tags_for_event`` — returns the tag dict a Sentry sink would
  set on ``sentry_sdk.set_tags`` for a given telemetry envelope. NO PII.
* ``posthog_props_for_event`` — returns the props dict a PostHog sink
  would send on ``posthog.capture``.
* ``correlation_key`` — the string used to group across tools.
"""

from __future__ import annotations

from typing import Any


def correlation_key(*, release: str, feature_id: str, correlation_id: str) -> str:
    """Compose the cross-tool correlation string. Same shape everywhere
    so every dashboard can join on it."""
    return f"{release}:{feature_id}:{correlation_id}"


def sentry_tags_for_event(event: dict[str, Any]) -> dict[str, str]:
    """Compose Sentry tags from a telemetry envelope dict. All string-
    valued for Sentry's constraint. Sentry rejects PII by default; we
    also gate every field against the closed telemetry envelope so no
    email/JWT can slip in via a rogue caller."""
    tags: dict[str, str] = {
        "release": str(event.get("release", "unknown"))[:80],
        "environment": str(event.get("environment", "unknown"))[:20],
        "feature_id": str(event.get("feature_id", "unknown"))[:120],
        "journey_id": str(event.get("journey_id") or "none")[:20],
        "operating_mode": str(event.get("operating_mode", "self"))[:20],
        "entitlement_class": str(event.get("entitlement_class", "clipper"))[:20],
        "correlation_id": str(event.get("correlation_id", "none"))[:80],
        "session_id": str(event.get("session_id", "none"))[:80],
        "stable_error_code": str(event.get("stable_error_code") or "none")[:120],
    }
    # `event` field is the event name itself
    if event.get("event"):
        tags["event_name"] = str(event["event"])[:80]
    return tags


def posthog_props_for_event(event: dict[str, Any]) -> dict[str, Any]:
    """Compose PostHog properties from a telemetry envelope. Structured
    with the same shape as Sentry tags for cross-tool joinability, plus
    the sanitized payload dict (PostHog can accept object properties)."""
    payload = event.get("payload") or {}
    return {
        "release": event.get("release"),
        "environment": event.get("environment"),
        "feature_id": event.get("feature_id"),
        "journey_id": event.get("journey_id"),
        "operating_mode": event.get("operating_mode"),
        "entitlement_class": event.get("entitlement_class"),
        "onboarding_state": event.get("onboarding_state"),
        "correlation_id": event.get("correlation_id"),
        "session_id": event.get("session_id"),
        "attempt_id": event.get("attempt_id"),
        "success": event.get("success"),
        "duration_ms": event.get("duration_ms"),
        "stable_error_code": event.get("stable_error_code"),
        "$correlation_key": correlation_key(
            release=str(event.get("release", "unknown")),
            feature_id=str(event.get("feature_id", "unknown")),
            correlation_id=str(event.get("correlation_id", "unknown")),
        ),
        **{f"payload_{k}": v for k, v in payload.items()},
    }
