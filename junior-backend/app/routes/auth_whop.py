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
from fastapi.responses import HTMLResponse, RedirectResponse
from html import escape as _html_escape
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


# v2.2.11 · brand-clean activation-fallback HTML. Matches the dark
# mailer shell (PAPER #0F0F14, INK #F5EFE7, FUCHSIA #FF1A8C) so the
# user experiences zero brand drift between the Whop OAuth page and
# the Liquid Clips chrome. Inlined CSS only — this page must render
# even if the static asset path is firewalled by an aggressive proxy.
def _render_activation_fallback(deep_link: str, token: str) -> str:
    """Render the activation handoff page · auto-fires deep link, falls
    back to copy-token card if the browser blocks the custom scheme.

    HTML is hand-rolled with inline styles — no template engine dep, no
    framework. The token is HTML-escaped so an upstream JWT change can
    never inject markup. Deep link is rendered into a JS string + meta
    refresh; both paths use the same value.
    """
    safe_deep_link = _html_escape(deep_link, quote=True)
    safe_token = _html_escape(token, quote=True)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1;url={safe_deep_link}">
<title>Activate Liquid Clips</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 48px 24px;
    min-height: 100vh;
    background: #050507;
    color: #F5EFE7;
    font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .lc-card {{
    width: 100%;
    max-width: 520px;
    background: #0F0F14;
    border: 1px solid #231423;
    border-radius: 18px;
    padding: 36px 32px;
    box-shadow: 0 32px 90px -32px rgba(255, 26, 140, 0.18);
  }}
  .lc-eyebrow {{
    font-family: 'Geist Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #FF1A8C;
    margin: 0 0 12px;
  }}
  h1 {{
    font-family: 'Fraunces', Georgia, serif;
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.15;
    color: #F5EFE7;
    margin: 0 0 14px;
  }}
  p {{
    font-size: 15px;
    line-height: 1.6;
    color: #B5AFA8;
    margin: 0 0 16px;
  }}
  .lc-status {{
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 26, 140, 0.06);
    border: 1px solid rgba(255, 26, 140, 0.22);
    border-radius: 10px;
    padding: 12px 14px;
    margin: 0 0 22px;
    font-size: 13px;
    color: #F5EFE7;
  }}
  .lc-status .dot {{
    width: 8px; height: 8px; border-radius: 999px;
    background: #FF1A8C;
    box-shadow: 0 0 12px rgba(255, 26, 140, 0.65);
    animation: pulse 1.2s ease-in-out infinite;
  }}
  @keyframes pulse {{
    0%, 100% {{ opacity: 1; transform: scale(1); }}
    50% {{ opacity: 0.55; transform: scale(0.85); }}
  }}
  .lc-divider {{
    height: 1px;
    background: #231423;
    margin: 24px 0;
  }}
  .lc-label {{
    display: block;
    font-family: 'Geist Mono', ui-monospace, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #7A7672;
    margin: 0 0 8px;
  }}
  .lc-token-row {{
    display: flex;
    gap: 8px;
    margin: 0 0 16px;
  }}
  .lc-token-input {{
    flex: 1;
    background: #050507;
    border: 1px solid #231423;
    border-radius: 10px;
    padding: 12px 14px;
    color: #F5EFE7;
    font-family: 'Geist Mono', ui-monospace, Menlo, monospace;
    font-size: 12px;
    line-height: 1.4;
    word-break: break-all;
    overflow-x: auto;
    white-space: nowrap;
  }}
  .lc-copy-btn {{
    background: linear-gradient(135deg, #FF1A8C, #FF5FBB);
    border: 0;
    border-radius: 10px;
    color: #FFFFFF;
    padding: 0 18px;
    font-family: inherit;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: transform 120ms ease, box-shadow 120ms ease;
    box-shadow: 0 12px 28px -14px rgba(255, 26, 140, 0.6);
  }}
  .lc-copy-btn:hover {{ transform: translateY(-1px); box-shadow: 0 16px 36px -16px rgba(255, 26, 140, 0.8); }}
  .lc-copy-btn[data-copied="true"] {{
    background: linear-gradient(135deg, #4ade80, #22c55e);
  }}
  .lc-retry {{
    display: inline-block;
    margin-top: 10px;
    color: #FF66B8;
    font-size: 13px;
    text-decoration: none;
    border-bottom: 1px solid rgba(255, 102, 184, 0.4);
    padding-bottom: 1px;
  }}
  .lc-retry:hover {{ color: #FF1A8C; border-color: #FF1A8C; }}
  .lc-foot {{
    margin-top: 26px;
    font-family: 'Geist Mono', ui-monospace, Menlo, monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    color: #7A7672;
    text-align: center;
  }}
</style>
</head>
<body>
  <main class="lc-card">
    <p class="lc-eyebrow">Whop login confirmed</p>
    <h1>Returning you to Liquid Clips&hellip;</h1>

    <div class="lc-status">
      <span class="dot" aria-hidden="true"></span>
      <span>Launching the desktop app. This window will close on its own.</span>
    </div>

    <p>
      Mac blocked the automatic handoff? Copy this code and paste it
      right into your running Liquid Clips application login pane to
      activate your workspace instantly.
    </p>

    <span class="lc-label">Activation code</span>
    <div class="lc-token-row">
      <input
        class="lc-token-input"
        id="lc-token"
        type="text"
        value="{safe_token}"
        readonly
        aria-label="Activation code"
        onclick="this.select()"
      />
      <button
        type="button"
        class="lc-copy-btn"
        id="lc-copy"
        aria-label="Copy activation code"
      >Copy</button>
    </div>

    <a href="{safe_deep_link}" class="lc-retry">Open Liquid Clips again →</a>

    <div class="lc-foot">Liquid Clips · activation bridge</div>
  </main>

  <script>
    (function() {{
      var deepLink = {repr(safe_deep_link)};
      // Fire the deep link via a hidden iframe so a pop-up blocker
      // hitting top-level navigation still has a fallback path. Also
      // schedule a direct location.href = deepLink in case the iframe
      // route is the one that's blocked.
      try {{
        var f = document.createElement("iframe");
        f.style.display = "none";
        f.src = deepLink;
        document.body.appendChild(f);
      }} catch (e) {{ /* no-op */ }}
      try {{ window.setTimeout(function() {{ window.location.href = deepLink; }}, 350); }} catch (e) {{}}

      var btn = document.getElementById("lc-copy");
      var input = document.getElementById("lc-token");
      btn.addEventListener("click", function() {{
        var ok = false;
        try {{
          if (navigator.clipboard && navigator.clipboard.writeText) {{
            navigator.clipboard.writeText(input.value);
            ok = true;
          }}
        }} catch (e) {{ ok = false; }}
        if (!ok) {{
          try {{ input.select(); document.execCommand("copy"); ok = true; }} catch (e) {{}}
        }}
        if (ok) {{
          btn.textContent = "Copied ✓";
          btn.dataset.copied = "true";
          window.setTimeout(function() {{
            btn.textContent = "Copy";
            btn.dataset.copied = "false";
          }}, 2400);
        }}
      }});
    }})();
  </script>
</body>
</html>"""


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

    # v2.2.11 · browser-to-desktop fallback wrapper. Instead of a raw
    # 302 to liquidclips://… (which Safari and some Chrome configs
    # silently swallow when pop-up blockers fire), serve an HTML page
    # that (a) auto-fires the deep link via JS so the happy path is
    # one-tick, and (b) falls back to a brand-clean copy-token card so
    # the user can paste the activation code into the desktop's
    # "Enter Manual Activation Code" input if the auto-fire is blocked.
    deep_link = f"liquidclips://activate?token={jwt_str}&challenge={state}&source=whop"
    return HTMLResponse(_render_activation_fallback(deep_link, jwt_str))
