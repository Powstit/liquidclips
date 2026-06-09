"""Whop OAuth desktop activation bridge.

Adds "Continue with Whop" as a co-equal door beside the Clerk-based
/desktop/connect flow. Scope: desktop/docs/WHOP_TRUE_LOGIN_SCOPE.md.

Flow:
  1. Desktop opens account.jnremployee.com/connect-desktop with ?challenge=<x>.
  2. User clicks "Continue with Whop" → GET /auth/whop/start?challenge=<x>.
  3. We 302 to whop.com/oauth with state=<challenge>.
  4. User authorizes on Whop.
  5. Whop 302s to /auth/whop/callback?code=<c>&state=<challenge>.
  6. We exchange code for access token, fetch the Whop user.
  7. We look up User by whop_user_id (then email fallback).
     - If no Liquid Clips account: 302 to connect-desktop?whop_nomembership=1.
  8. Else mint a license JWT and 302 to liquidclips://activate?token=<jwt>&challenge=<x>.

Iron Gate IG-004 — ADDITIVE sibling to /desktop/connect. Re-uses jwt_signer,
the User table, and the existing liquidclips:// deep-link scheme; does not
mutate any locked surface.
"""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.features import is_admin_email
from app.jwt_signer import issue_license_jwt
from app.models import License, User

router = APIRouter(prefix="/auth/whop", tags=["auth-whop"])

# Canonical Whop OAuth endpoints — confirmed against the existing PKCE flow in
# desktop/python-sidecar/whop_client.py (lines 250-251) which is in production.
WHOP_OAUTH_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize"
WHOP_OAUTH_TOKEN_URL = "https://api.whop.com/oauth/token"
WHOP_OAUTH_ME_URL = "https://api.whop.com/api/v5/me"


def _back_to_account(suffix: str) -> RedirectResponse:
    settings = get_settings()
    base = settings.account_site_url.rstrip("/")
    return RedirectResponse(f"{base}{suffix}", status_code=302)


@router.get("/start")
def whop_oauth_start(challenge: str = Query(..., min_length=8, max_length=128)) -> RedirectResponse:
    """Kick off Whop OAuth. Echoes the desktop's one-time challenge back as
    `state` so the callback can mint a JWT bound to the correct activation."""
    settings = get_settings()
    # Client ID falls back to the already-registered Whop app (config.whop_app_id)
    # so we don't need a separate env var unless Daniel wants to point this surface
    # at a different OAuth app than the rest of the Whop integration.
    client_id = settings.whop_oauth_client_id or settings.whop_app_id
    if not client_id or not settings.whop_oauth_redirect_uri:
        # Feature flag effectively off (env vars missing). Bounce the user back
        # to the connect-desktop page with a clear marker so the UI can hide
        # the Whop button next time / show "temporarily unavailable" once.
        return _back_to_account("/connect-desktop?whop_disabled=1")

    params = {
        "client_id": client_id,
        "redirect_uri": settings.whop_oauth_redirect_uri,
        "response_type": "code",
        # Minimum scope to identify the user. Membership lookup happens
        # server-to-server via the App API Key, not the user token.
        "scope": "read_user",
        "state": challenge,
    }
    return RedirectResponse(f"{WHOP_OAUTH_AUTHORIZE_URL}?{urlencode(params)}", status_code=302)


@router.get("/callback")
def whop_oauth_callback(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    """Whop OAuth redirect URI. Exchanges the code, looks up the Liquid Clips
    user, mints a license JWT, and deep-links the desktop back into active state."""
    settings = get_settings()

    # User cancelled the Whop consent screen, or Whop returned an error.
    if error or not code or not state:
        return _back_to_account("/connect-desktop?whop_cancelled=1")

    client_id = settings.whop_oauth_client_id or settings.whop_app_id
    if (
        not client_id
        or not settings.whop_oauth_client_secret
        or not settings.whop_oauth_redirect_uri
    ):
        return _back_to_account("/connect-desktop?whop_disabled=1")

    try:
        with httpx.Client(timeout=10.0) as client:
            tok_resp = client.post(
                WHOP_OAUTH_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.whop_oauth_redirect_uri,
                    "client_id": client_id,
                    "client_secret": settings.whop_oauth_client_secret,
                },
                headers={"Accept": "application/json"},
            )
            if tok_resp.status_code >= 400:
                return _back_to_account("/connect-desktop?whop_error=token")
            access_token = tok_resp.json().get("access_token")
            if not access_token:
                return _back_to_account("/connect-desktop?whop_error=token")

            me_resp = client.get(
                WHOP_OAUTH_ME_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
            )
            if me_resp.status_code >= 400:
                return _back_to_account("/connect-desktop?whop_error=me")
            me = me_resp.json()
    except httpx.RequestError:
        return _back_to_account("/connect-desktop?whop_error=network")

    # Whop's /me payload normally has `id` + `email`. Different SDK versions
    # have used `user_id` — accept either so a Whop API rev doesn't break us.
    whop_user_id = (me.get("id") or me.get("user_id") or "").strip()
    whop_email = (me.get("email") or "").strip().lower()
    if not whop_user_id and not whop_email:
        return _back_to_account("/connect-desktop?whop_error=me")

    user = None
    if whop_user_id:
        user = db.query(User).filter_by(whop_user_id=whop_user_id).one_or_none()
    if not user and whop_email:
        user = db.query(User).filter(User.email == whop_email).one_or_none()
        # Backfill so subsequent OAuth sign-ins skip the email join — keeps
        # the User.whop_user_id unique-index populated as a side benefit.
        if user and whop_user_id and not user.whop_user_id:
            user.whop_user_id = whop_user_id

    # No local account = user authenticated with Whop but has never bought
    # Liquid Clips. Send them to the connect-desktop empty state so the page
    # can render an affiliate-aware "Get a membership" CTA.
    if not user:
        return _back_to_account("/connect-desktop?whop_nomembership=1")

    # Mirror the /desktop/connect tier-resolution exactly. Admin emails get
    # autopilot; everyone else gets their stored tier. Whop webhooks keep
    # user.tier + subscription_status fresh, so this read is authoritative.
    is_admin = is_admin_email(user.email)
    effective_tier = "autopilot" if is_admin else user.tier
    effective_founder = True if is_admin else user.founder_flag

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=effective_tier,
        founder=effective_founder,
        quota_videos_per_month=None,
    )
    db.add(License(user_id=user.id, jwt=jwt_str, tier_at_issue=effective_tier, expires_at=expires_at))
    db.commit()

    # Deep-link back into the desktop. The OS will show "Open Liquid Clips?";
    # the desktop verifies the challenge matches what it generated, stores the
    # JWT in the keychain, and flips signed-in. Matches the Clerk-path scheme
    # set on the page (see account-app/src/app/connect-desktop/page.tsx).
    deep_link = f"liquidclips://activate?token={jwt_str}&challenge={state}"
    return RedirectResponse(deep_link, status_code=302)
