"""Hidden publisher — wraps the Postiz public API.

Architecture decision 2026-05-22: Junior uses Postiz as a hidden multi-tenant
publishing engine. Self-hosted on Railway behind a white-labelled domain
(connect.jnremployee.com) so customers never see the word "Postiz." Each
Junior user gets their own `pos_*` OAuth token; every publish call is made
under that user's identity so per-platform integrations and rate limits
isolate cleanly per tenant.

Env vars (set on Railway when deploying):
  POSTIZ_BACKEND_URL    Postiz backend (where we POST /public/v1 endpoints)
  POSTIZ_FRONTEND_URL   Where users go for the OAuth consent screen
  POSTIZ_CLIENT_ID      OAuth app client id (pca_...)
  POSTIZ_CLIENT_SECRET  OAuth app client secret (pcs_...)
  POSTIZ_REDIRECT_URL   Where Postiz sends users after consent — must match
                        the OAuth app registration.

In stub mode (no env vars set) every call returns synthetic data so the rest
of the codebase compiles and tests pass. The shape matches the real API
exactly — the rest of the codebase doesn't know whether it's hitting a real
Postiz instance or a stub.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger("junior.postiz")


def is_live() -> bool:
    return bool(os.environ.get("POSTIZ_CLIENT_ID") and os.environ.get("POSTIZ_CLIENT_SECRET"))


def _frontend_url() -> str:
    return os.environ.get("POSTIZ_FRONTEND_URL", "https://platform.postiz.com").rstrip("/")


def _backend_url() -> str:
    return os.environ.get("POSTIZ_BACKEND_URL", "https://api.postiz.com").rstrip("/")


def _client_id() -> str:
    return os.environ.get("POSTIZ_CLIENT_ID", "pca_stub")


def _client_secret() -> str:
    return os.environ.get("POSTIZ_CLIENT_SECRET", "pcs_stub")


def _redirect_url() -> str:
    return os.environ.get(
        "POSTIZ_REDIRECT_URL",
        "https://api.jnremployee.com/oauth/postiz/callback",
    )


# --- OAuth handshake ----------------------------------------------------

def authorize_url(state: str) -> str:
    """Where to redirect the user to start consent. Customer-facing UI never
    mentions Postiz — the page itself is white-labelled with the OAuth app's
    name + logo we registered ('Junior')."""
    return (
        f"{_frontend_url()}/oauth/authorize"
        f"?client_id={_client_id()}"
        f"&response_type=code"
        f"&state={state}"
    )


async def exchange_code(code: str) -> dict[str, Any]:
    """Exchange the one-shot ?code= for a pos_* access token (lasts forever
    until the user revokes from Postiz settings). Returns the full response:
        { id (org_id), cus (stripe_customer_id), access_token, token_type }"""
    if not is_live():
        return {
            "id": f"org_stub_{uuid.uuid4().hex[:10]}",
            "cus": f"cus_stub_{uuid.uuid4().hex[:10]}",
            "access_token": f"pos_stub_{uuid.uuid4().hex}",
            "token_type": "bearer",
        }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{_backend_url()}/oauth/token",
            json={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
            },
        )
        resp.raise_for_status()
        return resp.json()


# --- per-user API calls (use the customer's pos_* token) ----------------

async def list_integrations(access_token: str) -> list[dict[str, Any]]:
    """Connected platforms (Postiz calls them 'integrations'). Returns the
    Postiz row shape; caller maps to Junior's connection shape."""
    if not is_live():
        return _STUB_INTEGRATIONS
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{_backend_url()}/public/v1/integrations",
            headers={"Authorization": access_token},
        )
        resp.raise_for_status()
        return resp.json()


async def upload_file(access_token: str, file_path: str, content_type: str = "video/mp4") -> dict[str, Any]:
    """Upload a clip → returns {id, path} that goes into the create-post call."""
    if not is_live():
        return {"id": f"img_stub_{uuid.uuid4().hex[:10]}", "path": "https://stub.example.com/clip.mp4"}
    async with httpx.AsyncClient(timeout=180.0) as client:
        with open(file_path, "rb") as f:
            resp = await client.post(
                f"{_backend_url()}/public/v1/upload",
                headers={"Authorization": access_token},
                files={"file": (os.path.basename(file_path), f, content_type)},
            )
            resp.raise_for_status()
            return resp.json()


async def create_post(
    *,
    access_token: str,
    posts: list[dict[str, Any]],
    when: str = "now",
    scheduled_for_iso: str | None = None,
) -> dict[str, Any]:
    """Create one or many posts under the customer's identity.

    `posts` is the Postiz-shaped array — each item has {integration, value,
    settings}. Caller builds it; we just authenticate and POST. Multiple
    posts in a single call is the docs-recommended way to dodge the per-hour
    rate limit on batched drip schedules.

    `when` is 'now' or 'schedule'. For 'schedule', `scheduled_for_iso` must
    be set; for 'now' it's ignored.
    """
    if when not in ("now", "schedule"):
        raise ValueError("when must be 'now' or 'schedule'")
    body = {
        "type": when,
        "date": scheduled_for_iso or datetime.now(timezone.utc).isoformat(),
        "shortLink": False,
        "tags": [],
        "posts": posts,
    }
    if not is_live():
        log.info("[postiz stub] create_post %s posts (when=%s)", len(posts), when)
        return {
            "ok": True,
            "post_ids": [f"pst_stub_{uuid.uuid4().hex[:10]}" for _ in posts],
            "post_urls": [f"https://stub.example.com/{i}" for i in range(len(posts))],
        }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{_backend_url()}/public/v1/posts",
            headers={"Authorization": access_token, "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


async def delete_integration(access_token: str, integration_id: str) -> None:
    """User disconnected a platform from Junior. We remove the integration on
    Postiz's side too so leftover tokens don't keep posting if they revoke
    later. 404 here means already gone — safe to swallow per Postiz docs."""
    if not is_live():
        log.info("[postiz stub] delete_integration %s", integration_id)
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.delete(
            f"{_backend_url()}/public/v1/integrations/{integration_id}",
            headers={"Authorization": access_token},
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()


# --- platform name mapping ---------------------------------------------

# Junior's customer-facing platform IDs → Postiz's `__type` strings.
# We keep our names short and stable; Postiz's evolve faster than ours.
JUNIOR_TO_POSTIZ_TYPE = {
    "youtube": "youtube",
    "tiktok": "tiktok",
    "instagram": "instagram-standalone",
    "x": "x",
    "linkedin": "linkedin",
    "threads": "threads",
    "facebook": "facebook",
}


def build_post(
    *,
    integration_id: str,
    junior_platform: str,
    title: str,
    description: str,
    media: list[dict[str, Any]] | None = None,
    extra_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compose one entry of the Postiz `posts` array. Junior never exposes
    Postiz settings to the UI — sensible defaults baked in here."""
    postiz_type = JUNIOR_TO_POSTIZ_TYPE.get(junior_platform, junior_platform)
    settings: dict[str, Any] = {"__type": postiz_type}
    if junior_platform == "youtube":
        settings["title"] = title[:100]
        settings["type"] = "short"  # 9:16 vertical → YouTube Short
    elif junior_platform == "tiktok":
        settings["privacy_level"] = "PUBLIC_TO_EVERYONE"
        settings["comment"] = True
    elif junior_platform == "instagram":
        settings["post_type"] = "reel"
    elif junior_platform == "x":
        settings["who_can_reply_post"] = "everyone"
    if extra_settings:
        settings.update(extra_settings)
    return {
        "integration": {"id": integration_id},
        "value": [{"content": description or title, "image": media or []}],
        "settings": settings,
    }


# --- stub fixtures ------------------------------------------------------
# Realistic-shaped responses so local dev + tests can run without a Postiz
# instance behind them. Match the docs' integration shape exactly.

_STUB_INTEGRATIONS: list[dict[str, Any]] = [
    {"id": "int_stub_yt", "name": "@youraccount", "providerIdentifier": "youtube", "picture": None, "disabled": False},
    {"id": "int_stub_tt", "name": "@youraccount", "providerIdentifier": "tiktok", "picture": None, "disabled": False},
]
