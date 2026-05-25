"""Write billing state back to Clerk publicMetadata.

The DB is the source of truth, but several account-app surfaces still read
Clerk `publicMetadata` (upgrade page, PostHogBoot analytics, the dashboard's
offline fallback). Clerk metadata is NOT updated by Whop webhooks or the
onboarding backfill, so without this a linked trial/paid/founder reads "free"
in those places (the split-brain in docs/customer-journey.md).

This helper PATCHes Clerk's Backend API after every billing transition. It is
best-effort and non-blocking: a missing/stale key or a network error is logged
and swallowed — the DB + the backend-truth reads remain correct regardless.
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings

log = logging.getLogger("junior.clerk_sync")

CLERK_API = "https://api.clerk.com/v1"


def sync_clerk_metadata(
    clerk_id: str | None,
    *,
    tier: str | None = None,
    subscription_status: str | None = None,
    founder: bool | None = None,
    whop_user_id: str | None = None,
) -> None:
    """Merge the given keys into the user's Clerk publicMetadata. No-op without
    a clerk_id or configured key. Only non-None keys are written (Clerk merges
    top-level public_metadata keys, so partial updates are safe)."""
    settings = get_settings()
    if not clerk_id or not settings.clerk_secret_key:
        return

    public_metadata: dict[str, object] = {}
    if tier is not None:
        public_metadata["tier"] = tier
    if subscription_status is not None:
        public_metadata["subscription_status"] = subscription_status
    if founder is not None:
        public_metadata["founder"] = bool(founder)
    if whop_user_id is not None:
        public_metadata["whop_user_id"] = whop_user_id
    if not public_metadata:
        return

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.patch(
                f"{CLERK_API}/users/{clerk_id}/metadata",
                headers={
                    "Authorization": f"Bearer {settings.clerk_secret_key}",
                    "Content-Type": "application/json",
                },
                json={"public_metadata": public_metadata},
            )
        if resp.status_code >= 400:
            log.warning("clerk metadata sync failed for %s: %s", clerk_id, resp.status_code)
    except httpx.HTTPError as e:
        log.warning("clerk metadata sync error for %s: %s", clerk_id, e)
