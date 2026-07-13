"""Google OAuth callback for the Crew onboarding flow (F5 scanner).

The desktop app opens Google's OAuth consent screen in the OS browser
via `openSmart()` with a URL of the form:

    https://accounts.google.com/o/oauth2/v2/auth
      ?client_id=<GOOGLE_CLIENT_ID>
      &scope=<gmail.readonly + contacts.readonly>
      &redirect_uri=https://api.liquidclips.app/auth/google/callback
      &response_type=code
      &state=<nonce>
      &access_type=offline
      &prompt=consent

Google redirects the browser back to *this* endpoint with `code` + `state`.
We exchange the code for tokens against `https://oauth2.googleapis.com/token`
and then serve a tiny HTML page that fires

    location.href = 'liquidclips://google-oauth?token=...&refresh=...
                     &expires_at=<unix-ms>&state=<nonce>'

The desktop deep-link plugin picks up the URL, resolves the pending
promise, and the F5 scanner proceeds with the access token in memory.

Tokens are NEVER persisted server-side. This handler is deliberately
stateless — the challenge/state is verified by the frontend (which
generated the nonce in memory). Frontend + backend never share a
database record for the OAuth flow.

Log hygiene:
  * Never log the `code`, `access`, or `refresh` values.
  * Log at INFO the state (short-tag) + duration; failures at WARN.
"""

from __future__ import annotations

import html
import logging
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse

from app.config import get_settings

log = logging.getLogger("crew.google_oauth")

router = APIRouter(prefix="/auth/google", tags=["auth-google"])


GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _short_state(state: str) -> str:
    """Return an 8-char prefix for log lines. Never log the full state
    (it's the anti-CSRF nonce)."""
    return (state or "")[:8]


def _misconfigured_html(reason: str) -> HTMLResponse:
    body = f"""
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>Liquid Clips · setup incomplete</title>
    <style>
      body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              background: #0b0b10; color: #f4f1ea; padding: 40px;
              max-width: 620px; margin: 0 auto; }}
      h1 {{ font-weight: 700; letter-spacing: -0.02em; }}
      .card {{ background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.10);
               border-radius: 16px; padding: 24px; }}
      .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
               font-size: 12px; color: rgba(244,241,234,0.62); }}
      a.btn {{ display: inline-block; margin-top: 16px; padding: 12px 20px;
               background: #ff1a8c; color: white; border-radius: 999px;
               text-decoration: none; font-weight: 600; }}
    </style></head><body>
    <h1>Google connection isn&rsquo;t configured yet.</h1>
    <div class="card">
      <p>Liquid Clips is still finalising the Google setup on our side.
         Return to the app &mdash; you can keep going without connecting Google.</p>
      <p class="mono">reason: {html.escape(reason)}</p>
      <a class="btn" href="liquidclips://google-oauth?error=MISCONFIGURED">Return to Liquid Clips</a>
    </div>
    </body></html>
    """
    return HTMLResponse(body, status_code=200)


def _error_html(error_code: str, note: str, state: str) -> HTMLResponse:
    """Render a page that deep-links back with an `error=` query."""
    deep = (
        f"liquidclips://google-oauth"
        f"?error={html.escape(error_code)}"
        f"&state={html.escape(state or '')}"
    )
    safe_note = html.escape(note[:200])
    body = f"""
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>Liquid Clips · connection failed</title>
    <script>
      // Fire the deep-link back to the desktop app so the F5 state
      // machine can surface a friendly error state instead of hanging.
      setTimeout(function() {{ window.location.href = {deep!r}; }}, 200);
    </script>
    <style>
      body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              background: #0b0b10; color: #f4f1ea; padding: 40px;
              max-width: 620px; margin: 0 auto; }}
      a.btn {{ display: inline-block; margin-top: 16px; padding: 12px 20px;
               background: #ff1a8c; color: white; border-radius: 999px;
               text-decoration: none; font-weight: 600; }}
    </style></head><body>
    <h1>Google connection didn&rsquo;t finish.</h1>
    <p class="mono">{safe_note}</p>
    <p>Return to Liquid Clips and try again.</p>
    <a class="btn" href="{deep}">Return to Liquid Clips</a>
    </body></html>
    """
    return HTMLResponse(body, status_code=200)


def _success_html(access: str, refresh: str, expires_at_ms: int, state: str) -> HTMLResponse:
    """Render the deep-link auto-open page. Tokens travel through the
    OS URL handler → tauri-plugin-deep-link → deepLinkBoot subscriber.
    Query-string encoding is safe on macOS/Windows OS handlers because
    the URL is delivered to the app, not stored in the browser tab.
    """
    # URL-encode is not needed because we only carry base64url-safe
    # access/refresh strings from Google · they never contain `&` or `#`.
    # We still escape via html.escape for the fallback anchor.
    deep = (
        f"liquidclips://google-oauth"
        f"?token={html.escape(access)}"
        f"&refresh={html.escape(refresh)}"
        f"&expires_at={expires_at_ms}"
        f"&state={html.escape(state)}"
    )
    body = f"""
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>Liquid Clips · connected</title>
    <script>
      // Auto-fire the deep-link back to the desktop app.
      window.location.href = {deep!r};
    </script>
    <style>
      body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              background: #0b0b10; color: #f4f1ea; padding: 40px;
              max-width: 620px; margin: 0 auto; text-align: center; }}
      h1 {{ font-weight: 700; letter-spacing: -0.02em; }}
      a.btn {{ display: inline-block; margin-top: 24px; padding: 14px 22px;
               background: #ff1a8c; color: white; border-radius: 999px;
               text-decoration: none; font-weight: 600; }}
      .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
               font-size: 12px; color: rgba(244,241,234,0.62); }}
    </style></head><body>
    <h1>Connected. Returning to Liquid Clips&hellip;</h1>
    <p class="mono">If the app doesn&rsquo;t open automatically, tap the button below.</p>
    <a class="btn" href="{deep}">Return to Liquid Clips</a>
    </body></html>
    """
    return HTMLResponse(body, status_code=200)


@router.get("/callback")
async def google_oauth_callback(
    request: Request,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
) -> HTMLResponse:
    """Exchange the authorization code for an access + refresh token
    and hand them back to the desktop app via a `liquidclips://` deep-link.

    Query parameters:
      * `code`  · the one-time code Google issues (10-min TTL)
      * `state` · anti-CSRF nonce the frontend minted
      * `error` · Google-side error (e.g. `access_denied` when the user
                  clicks Deny on the consent screen)

    Never persists tokens. Never logs raw credentials.
    """
    settings = get_settings()
    state_val = state or ""

    if error:
        # User denied consent or Google surfaced a well-formed error.
        # `access_denied` = user clicked Deny · the app surfaces DENIED.
        code_map = {"access_denied": "DENIED"}
        mapped = code_map.get(error, "DENIED")
        log.info("google_oauth denied state=%s error=%s", _short_state(state_val), error)
        return _error_html(mapped, f"google returned error={error}", state_val)

    if not code or not state_val:
        log.warning("google_oauth missing code/state")
        return _error_html("MALFORMED", "missing code or state param", state_val)

    if not settings.google_client_id or not settings.google_client_secret:
        log.warning(
            "google_oauth MISCONFIGURED state=%s (client_id/secret absent)",
            _short_state(state_val),
        )
        return _misconfigured_html(
            "GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not provisioned"
        )

    redirect_uri = settings.google_redirect_uri or (
        f"{settings.api_site_url.rstrip('/')}/auth/google/callback"
    )

    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_res = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"accept": "application/json"},
            )
    except httpx.HTTPError as e:  # noqa: BLE001
        log.warning(
            "google_oauth token-exchange network state=%s type=%s",
            _short_state(state_val), type(e).__name__,
        )
        return _error_html("NETWORK", "token exchange network error", state_val)

    if token_res.status_code >= 400:
        # Never log the raw response body — it can contain redirect
        # info + client-id echo. Log status + duration only.
        log.warning(
            "google_oauth token-exchange status=%d dur=%.3f state=%s",
            token_res.status_code, time.time() - started, _short_state(state_val),
        )
        return _error_html(
            "TOKEN_EXCHANGE_FAILED",
            f"google token endpoint returned {token_res.status_code}",
            state_val,
        )

    try:
        payload = token_res.json()
    except Exception:  # noqa: BLE001
        log.warning("google_oauth malformed json state=%s", _short_state(state_val))
        return _error_html("MALFORMED", "google returned non-json", state_val)

    access = str(payload.get("access_token") or "")
    refresh = str(payload.get("refresh_token") or "")
    expires_in = int(payload.get("expires_in") or 0)

    if not access:
        log.warning("google_oauth missing access_token state=%s", _short_state(state_val))
        return _error_html("MALFORMED", "no access_token in response", state_val)

    expires_at_ms = int((time.time() + max(expires_in, 60)) * 1000)
    log.info(
        "google_oauth ok state=%s expires_in=%ds dur=%.3f",
        _short_state(state_val), expires_in, time.time() - started,
    )
    return _success_html(access=access, refresh=refresh, expires_at_ms=expires_at_ms, state=state_val)
