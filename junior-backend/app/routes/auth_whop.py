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

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
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
from app.models import License, User, WhopOAuthPkce

# PKCE state rows older than this are treated as expired even if never
# consumed — bounds how long an abandoned Whop tab can leave a verifier
# valid. A normal consent-screen round-trip completes in well under a minute.
_PKCE_TTL = timedelta(minutes=15)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _new_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge). S256 per Whop's OAuth 2.1
    requirement — matches the working reference implementation in
    desktop/python-sidecar/whop_client.py's local-listener OAuth path."""
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge

router = APIRouter(prefix="/auth/whop", tags=["auth-whop"])

# Canonical Whop OAuth endpoints — confirmed against the existing PKCE flow in
# desktop/python-sidecar/whop_client.py (lines 250-251) which is in production.
WHOP_OAUTH_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize"
WHOP_OAUTH_TOKEN_URL = "https://api.whop.com/oauth/token"
WHOP_OAUTH_ME_URL = "https://api.whop.com/api/v5/me"


def _back_to_account(suffix: str) -> RedirectResponse:
    settings = get_settings()
    base = settings.account_site_url.rstrip("/")
    # 2026-08-10 · temporary diagnostic — a real user hit "Missing activation
    # code" (the connect-desktop generic fallback) after a live Whop OAuth
    # attempt, but access logs only show the callback's status code, not
    # which failure branch redirected or where to. Remove once confirmed.
    print(f"[whop-callback-diag] redirecting to {base}{suffix}", flush=True)
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
def whop_oauth_start(
    db: Annotated[Session, Depends(get_db)],
    challenge: str = Query(..., min_length=8, max_length=128),
) -> RedirectResponse:
    """Kick off Whop OAuth. Echoes the desktop's one-time challenge back as
    `state` so the callback can mint a JWT bound to the correct activation.

    2026-08-04 — also mints a PKCE pair. Whop's authorize endpoint rejects
    requests without `code_challenge` (`invalid_request · code_challenge is
    required`) — this was previously missing entirely, so every "Connect
    Whop" attempt failed 100% of the time before it ever reached the user."""
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

    verifier, code_challenge = _new_pkce_pair()
    # Upsert on `state` — a retried /start for the same challenge (double
    # click, back-button) just refreshes the verifier rather than 500ing on
    # a primary-key collision.
    existing = db.get(WhopOAuthPkce, challenge)
    if existing is not None:
        existing.code_verifier = verifier
        existing.created_at = datetime.now(timezone.utc)
        existing.consumed_at = None
    else:
        db.add(WhopOAuthPkce(state=challenge, code_verifier=verifier))
    db.commit()

    params = {
        "client_id": client_id,
        "redirect_uri": settings.whop_oauth_redirect_uri,
        "response_type": "code",
        # 2026-08-04 · "read_user" is not a valid scope for this Whop app —
        # confirmed live (`error=invalid_scope`) once the PKCE fix above got
        # past the prior blocker. Matches the working reference OAuth flow
        # for the same app id (app_hLphExdFzjEQsM) in
        # desktop/python-sidecar/whop_client.py:528. Membership lookup still
        # happens server-to-server via the App API Key, not the user token —
        # this scope is only for identifying who signed in.
        "scope": "openid profile email",
        # 2026-08-04 · the "openid" scope requires a nonce per OIDC — confirmed
        # live (`error=invalid_request · nonce is required for openid scope`).
        # We don't parse/validate an id_token ourselves (the callback uses the
        # access_token against /api/v5/me instead), so this is generated and
        # sent but not persisted — it only needs to satisfy Whop's request-time
        # validation, matching whop_client.py:530's same pattern.
        "nonce": _b64url(secrets.token_bytes(16)),
        "state": challenge,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
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

    # 2026-08-04 — retrieve + consume the PKCE verifier minted in /start.
    # Missing/expired/already-consumed all fail the same way: bounce back
    # with a state-mismatch marker rather than attempting a token exchange
    # Whop will reject anyway. A row older than _PKCE_TTL is treated as
    # expired even if technically still unconsumed — bounds how long an
    # abandoned tab keeps a verifier usable.
    pkce_row = db.get(WhopOAuthPkce, state)
    now = datetime.now(timezone.utc)
    pkce_expired = (
        pkce_row is None
        or pkce_row.consumed_at is not None
        or (now - pkce_row.created_at.replace(tzinfo=timezone.utc)) > _PKCE_TTL
    )
    if pkce_expired:
        return _back_to_account("/connect-desktop?whop_error=state")
    code_verifier = pkce_row.code_verifier
    pkce_row.consumed_at = now
    db.commit()

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
                    "code_verifier": code_verifier,
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

    # 2026-07-05 · CM-T3 · mint parity fix. Was inline
    # `issue_license_jwt` + `License` insert which skipped
    # sync_clerk_metadata, paid_until maintenance, agency commission
    # override, and welcome-email / analytics side-effects that the
    # canonical `apply_membership_tier` runs. Same defect
    # integration-lens flagged and CM-Me + Claude 1 already closed in
    # `whop_checkout_success.py` and Wave 2. Route this OAuth-callback
    # path through the same helper so every mint path uses ONE code
    # path with ONE side-effect envelope.
    is_admin = is_admin_email(user.email)
    if is_admin:
        # Admin override preserves prior contract: autopilot + founder.
        effective_tier = "autopilot"
        effective_founder = True
    else:
        effective_tier = user.tier
        effective_founder = user.founder_flag

    from app.routes.webhooks_whop import apply_membership_tier
    jwt_str = apply_membership_tier(
        db,
        user,
        tier=effective_tier,
        founder=effective_founder,
        whop_user_id=whop_user_id or None,
        renewal_at=None,
        paid=False,
    )
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
