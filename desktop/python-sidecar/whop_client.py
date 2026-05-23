"""Whop GraphQL client for the Earn tab integration.

Reads public Content Rewards data — bounties and submission statuses. No
mutations (Whop hasn't opened submission-create publicly yet). Auth flow:

  1. Iframe context (Junior running inside whop.com community iframe):
     Whop's parent frame postMessage's the user's id_token. The token is
     passed in via WHOP_USER_TOKEN env var by the iframe shim → no separate
     OAuth flow.
  2. Desktop binary: falls back to the seller-side API key from
     ~/.claude-credentials/whop.env so Daniel can browse bounties from his
     own machine for testing.

Both paths return data in the same shape, so the rest of the codebase doesn't
have to branch on auth source.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

log = logging.getLogger("junior.whop")

WHOP_GRAPHQL_URL = "https://api.whop.com/public-graphql"


# In-memory session token captured from the Whop iframe at runtime. NEVER
# written to disk — the iframe auth bridge in src/lib/whop-iframe.ts captures
# it from the parent Whop window and pushes it here via whop_set_session_token.
# Cleared on logout or when the iframe unmounts. This is the production auth
# path for clippers using Junior inside Whop's community iframe.
_SESSION_TOKEN: str | None = None


def set_session_token(token: str | None) -> None:
    """Stash the Whop iframe session token in memory. Frontend calls this
    via the whop_set_session_token RPC whenever the iframe captures or
    refreshes a token. Pass None / empty string to clear."""
    global _SESSION_TOKEN
    _SESSION_TOKEN = token.strip() if token else None


def has_session_token() -> bool:
    return bool(_SESSION_TOKEN)


def _whop_token() -> str | None:
    """Resolution order — highest priority first.

    Production (Whop iframe): the session token captured from the Whop
    parent window is checked first. Standalone desktop falls back to the
    user's pasted keychain entry; dev environments use env / file.

       1. In-memory session token (Whop iframe captured via postMessage)
       2. WHOP_USER_TOKEN env (alt iframe shim path)
       3. OS keychain JUNIOR_WHOP_TOKEN (standalone desktop, user-pasted)
       4. WHOP_API_KEY env (CI / dev override)
       5. ~/.claude-credentials/whop.env (Daniel's seller key — dev only)
    """
    if _SESSION_TOKEN:
        return _SESSION_TOKEN

    tok = os.environ.get("WHOP_USER_TOKEN")
    if tok:
        return tok

    try:
        from secrets_store import get_secret
        keychain_tok = get_secret("JUNIOR_WHOP_TOKEN")
        if keychain_tok:
            return keychain_tok
    except Exception:
        # Keyring can fail (locked keychain, headless macOS) — fall through.
        pass

    # Seller-key fallback (Daniel's developer key + the ~/.claude-credentials
    # file) is DEV-ONLY. Gated behind explicit JUNIOR_DEV=1 so a production
    # build can never silently fall back to a seller's own key.
    if os.environ.get("JUNIOR_DEV") == "1":
        tok = os.environ.get("WHOP_API_KEY")
        if tok:
            return tok

        creds_path = Path.home() / ".claude-credentials" / "whop.env"
        if creds_path.exists():
            try:
                for line in creds_path.read_text().splitlines():
                    if line.startswith("WHOP_API_KEY="):
                        return line.split("=", 1)[1].strip()
            except OSError:
                pass
    return None


def token_source() -> str:
    """Return where the active token came from, for the UI badge and audit
    logs. One of: 'iframe' | 'env_user' | 'keychain' | 'seller_key' | 'none'.
    Mirrors the priority order in _whop_token()."""
    if _SESSION_TOKEN:
        return "iframe"

    if os.environ.get("WHOP_USER_TOKEN"):
        return "env_user"

    try:
        from secrets_store import get_secret
        if get_secret("JUNIOR_WHOP_TOKEN"):
            return "keychain"
    except Exception:
        pass

    if os.environ.get("JUNIOR_DEV") == "1":
        if os.environ.get("WHOP_API_KEY"):
            return "seller_key"
        creds_path = Path.home() / ".claude-credentials" / "whop.env"
        if creds_path.exists():
            try:
                for line in creds_path.read_text().splitlines():
                    if line.startswith("WHOP_API_KEY=") and line.split("=", 1)[1].strip():
                        return "seller_key"
            except OSError:
                pass
    return "none"


async def _gql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute a GraphQL query against Whop. Raises on HTTP error or graphql
    errors so callers can surface the failure cleanly."""
    token = _whop_token()
    if not token:
        raise RuntimeError("No Whop token available — not in iframe context and no seller key")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            WHOP_GRAPHQL_URL,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"query": query, "variables": variables or {}},
        )
        resp.raise_for_status()
        body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"Whop GraphQL error: {body['errors'][:2]}")
        return body.get("data", {})


# --- queries ----------------------------------------------------------

_LIST_BOUNTIES = """
query JuniorListBounties($first: Int) {
  publicBounties(first: $first) {
    edges {
      node {
        id
        title
        description
        baseUnitAmount
        rewardPerUnitAmount
        currency
        allowYoutube
        allowTiktok
        allowInstagram
        allowX
        acceptedSubmissionsLimit
        acceptedSubmissionsCount
        spotsRemaining
        bountyType
        status
        viewCount
        totalPaid
        budgetAmount
        createdAt
        updatedAt
        user {
          username
          name
          image
        }
      }
    }
  }
}
"""

_BOUNTY_DETAIL = """
query JuniorBounty($id: ID!) {
  publicBounty(id: $id) {
    id
    title
    description
    baseUnitAmount
    rewardPerUnitAmount
    currency
    allowYoutube
    allowTiktok
    allowInstagram
    allowX
    acceptedSubmissionsLimit
    acceptedSubmissionsCount
    spotsRemaining
    bountyType
    status
    viewCount
    totalPaid
    budgetAmount
    user {
      username
      name
      image
    }
    experience {
      id
    }
  }
}
"""

_SUBMISSION = """
query JuniorSubmission($id: ID!) {
  publicBountySubmission(id: $id) {
    id
    status
    submittedAt
    claimedAt
    expiresAt
    formattedPayoutAmount
    denialReason
    verifiedVotesCount
    rejectedVotesCount
    bounty {
      id
      title
      rewardPerUnitAmount
      currency
    }
  }
}
"""


async def list_bounties(*, first: int = 30) -> list[dict[str, Any]]:
    data = await _gql(_LIST_BOUNTIES, {"first": first})
    edges = (data.get("publicBounties") or {}).get("edges") or []
    return [e["node"] for e in edges if e.get("node")]


async def get_bounty(bounty_id: str) -> dict[str, Any] | None:
    data = await _gql(_BOUNTY_DETAIL, {"id": bounty_id})
    return data.get("publicBounty")


async def get_submission(submission_id: str) -> dict[str, Any] | None:
    data = await _gql(_SUBMISSION, {"id": submission_id})
    return data.get("publicBountySubmission")


def has_token() -> bool:
    """Quick check used by the desktop to render the right Earn state without
    making a network call up front. Returns True if we have ANY Whop token."""
    return bool(_whop_token())


# --- OAuth (PKCE) for desktop -------------------------------------------------
#
# Whop's OAuth 2.1 + PKCE flow. Desktop / native apps don't carry a client
# secret — PKCE proves the same client started + finished the flow without
# needing one. Endpoints (per docs.whop.com/developer/guides/oauth):
#   - https://api.whop.com/oauth/authorize   (user-facing redirect)
#   - https://api.whop.com/oauth/token       (code → access_token exchange)
#
# Flow:
#   1. UI calls oauth_start() → we generate verifier/state, spin up a local
#      HTTP listener on REDIRECT_PORT, return the authorize_url.
#   2. UI opens the URL in the user's default browser (Tauri shell plugin).
#   3. User signs in on whop.com, Whop redirects to localhost:PORT/whop/callback
#      with ?code=…&state=…
#   4. The listener thread receives it, the awaiting oauth_complete() coroutine
#      exchanges the code, persists the token, returns.
#
# Why a fixed port (8765) and not random:
#   - Whop validates the redirect_uri against the app's allowlist. A random
#     port would force the dashboard to whitelist a wildcard, which Whop
#     doesn't allow. One fixed loopback URI = one allowlist entry.

WHOP_OAUTH_AUTHORIZE_URL = "https://api.whop.com/oauth/authorize"
WHOP_OAUTH_TOKEN_URL = "https://api.whop.com/oauth/token"
REDIRECT_PORT = 8765
REDIRECT_PATH = "/auth/whop/callback"
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}{REDIRECT_PATH}"

_OAUTH_VERIFIER: str | None = None
_OAUTH_STATE: str | None = None
_OAUTH_RESULT: dict[str, Any] | None = None  # {"status": "pending"|"success"|"error", "error"?, ...}
_OAUTH_SERVER: HTTPServer | None = None


class _ReusableHTTPServer(HTTPServer):
    """HTTPServer with SO_REUSEADDR so a fresh `Sign in` doesn't fail with
    `Address already in use` if a previous listener went down uncleanly."""
    allow_reuse_address = True


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _new_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


# Whop OAuth client_id. Public value — appears in the authorize URL and is
# safe to embed in the desktop binary. PKCE provides the security (no
# client_secret is sent from the desktop), so a leaked app ID alone can't be
# used to mint tokens for our users. The redirect-URI allowlist on Whop's
# side guarantees that even a malicious actor running their own listener
# would have to use one of OUR allowlisted hosts.
WHOP_APP_ID_DEFAULT = "app_hLphExdFzjEQsM"


def _app_id() -> str | None:
    """Whop OAuth client_id. Env / credentials store override the bundled
    default so a dev can point at a staging app ID without rebuilding."""
    for key in ("WHOP_APP_ID", "NEXT_PUBLIC_WHOP_APP_ID"):
        if v := os.environ.get(key):
            return v
    creds_path = Path.home() / ".claude-credentials" / "whop.env"
    if creds_path.exists():
        try:
            for line in creds_path.read_text().splitlines():
                for key in ("WHOP_APP_ID", "NEXT_PUBLIC_WHOP_APP_ID"):
                    if line.startswith(f"{key}="):
                        return line.split("=", 1)[1].strip()
        except OSError:
            pass
    return WHOP_APP_ID_DEFAULT


def _render_browser_response(*, ok: bool, error: str | None = None) -> bytes:
    """The HTML the user sees the moment Whop redirects back. Mirrored brand
    chrome — fuchsia mark, paper card, ink type."""
    if ok:
        title = "Whop connected."
        body_copy = "Return to Junior — your bounties are loading."
        tone = "#FF1A8C"
    else:
        title = "Whop sign-in failed."
        body_copy = error or "Try again from Junior's Earn tab."
        tone = "#DC2626"
    return (
        "<!doctype html><meta charset=utf-8>"
        f"<title>Junior — Whop</title>"
        "<style>"
        "body{font:14px/1.5 -apple-system,system-ui,sans-serif;"
        "background:#FAF7F2;color:#0A0A0A;display:grid;place-items:center;"
        "height:100vh;margin:0;text-align:center;padding:0 24px}"
        ".card{max-width:420px;padding:28px 32px;border:1px solid #E6E1D8;"
        "border-radius:18px;background:#fff}"
        "h1{font-size:18px;margin:0 0 8px}"
        "p{margin:0;color:#52525B}"
        f".mark{{display:inline-grid;place-items:center;width:32px;height:32px;"
        f"background:{tone};color:#fff;border-radius:8px;font-weight:700;"
        "margin-bottom:12px;font-family:ui-monospace,monospace}"
        "</style>"
        "<div class=card>"
        "<div class=mark>/</div>"
        f"<h1>{title}</h1>"
        f"<p>{body_copy}</p>"
        "</div>"
    ).encode()


def _exchange_code_sync(code: str) -> dict[str, Any]:
    """Synchronous token exchange. Runs inside the HTTP handler thread so the
    moment Whop hits the callback, we trade code → token before responding to
    the browser. No race with UI timers, no asyncio cross-thread weirdness."""
    app_id = _app_id()
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            WHOP_OAUTH_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": app_id,
                "code_verifier": _OAUTH_VERIFIER,
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Token exchange failed: HTTP {resp.status_code} · {resp.text[:200]}"
        )
    payload = resp.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Whop did not return an access_token")
    return payload


class _CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Silence the default stderr access log so it doesn't pollute stdio.
        return

    def do_GET(self) -> None:  # noqa: N802
        global _OAUTH_RESULT
        parsed = urlparse(self.path)
        if parsed.path != REDIRECT_PATH:
            self.send_response(404)
            self.end_headers()
            return
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}

        # Validate + exchange synchronously so the listener guarantees a
        # finished result before the browser tab reloads to anything else.
        try:
            if params.get("error"):
                raise RuntimeError(
                    f"{params.get('error')}: {params.get('error_description','')}".strip(": ")
                )
            if params.get("state") != _OAUTH_STATE:
                raise RuntimeError("state mismatch — possible CSRF; aborted")
            code = params.get("code")
            if not code:
                raise RuntimeError("Whop didn't return an authorization code")
            payload = _exchange_code_sync(code)
            access_token = payload["access_token"]

            # Push to memory + keychain right here. Sidecar's `whop_session_status`
            # will already report authenticated on the very next call.
            set_session_token(access_token)
            try:
                from secrets_store import set_secret
                set_secret("JUNIOR_WHOP_TOKEN", access_token)
            except Exception as e:  # noqa: BLE001
                log.warning("[whop] couldn't persist token to keychain: %s", e)

            _OAUTH_RESULT = {"status": "success"}
            log.info("[whop] OAuth success — token captured")
            body = _render_browser_response(ok=True)
            self.send_response(200)
        except Exception as e:  # noqa: BLE001
            err = str(e)
            log.warning("[whop] OAuth callback failed: %s", err)
            _OAUTH_RESULT = {"status": "error", "error": err}
            body = _render_browser_response(ok=False, error=err)
            self.send_response(400)

        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def oauth_start() -> dict[str, Any]:
    """Begin a Whop OAuth flow. Returns the authorize URL the UI must open in
    the user's default browser. Spins up the loopback listener. Caller must
    follow up with oauth_complete() (awaitable) to receive the access token."""
    global _OAUTH_VERIFIER, _OAUTH_STATE, _OAUTH_RESULT, _OAUTH_SERVER

    app_id = _app_id()
    if not app_id:
        raise RuntimeError(
            "Whop app ID missing. Set WHOP_APP_ID or NEXT_PUBLIC_WHOP_APP_ID."
        )

    # Tear down any previous listener — user may have hit "Sign in" twice.
    if _OAUTH_SERVER is not None:
        try:
            _OAUTH_SERVER.shutdown()
            _OAUTH_SERVER.server_close()
        except Exception:
            pass
        _OAUTH_SERVER = None

    _OAUTH_VERIFIER, challenge = _new_pkce()
    _OAUTH_STATE = _b64url(secrets.token_bytes(24))
    _OAUTH_RESULT = None

    _OAUTH_SERVER = _ReusableHTTPServer(("127.0.0.1", REDIRECT_PORT), _CallbackHandler)
    Thread(target=_OAUTH_SERVER.serve_forever, daemon=True).start()
    log.info("[whop] OAuth listener armed on %s", REDIRECT_URI)

    params = {
        "response_type": "code",
        "client_id": app_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid profile email",
        "state": _OAUTH_STATE,
        "nonce": _b64url(secrets.token_bytes(16)),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return {
        "authorize_url": f"{WHOP_OAUTH_AUTHORIZE_URL}?{urlencode(params)}",
        "redirect_uri": REDIRECT_URI,
    }


async def oauth_complete(timeout: float = 600.0) -> dict[str, Any]:
    """Wait for the loopback listener to record a finished result. The actual
    code → token exchange happens inside the HTTP handler the moment Whop
    calls back, so by the time this returns the token is already in the
    keychain + in-memory session.

    Returns:
      - {"ok": True}                    on success
      - {"ok": False, "error": "..."}   on failure (handler caught it)
    Raises TimeoutError after `timeout` seconds with no callback at all.

    Default timeout is 10 min (was 3 min) — users authorize Whop on their
    phone or get pulled into other tabs and shouldn't lose the session for
    being slow.
    """
    global _OAUTH_RESULT

    if _OAUTH_VERIFIER is None:
        raise RuntimeError("oauth_start() was not called first")

    deadline = asyncio.get_event_loop().time() + timeout
    while _OAUTH_RESULT is None:
        if asyncio.get_event_loop().time() > deadline:
            # IMPORTANT: do NOT tear down the listener here. Whop may still
            # redirect after we time out; let it land. The user can re-await
            # by calling oauth_complete() again from the UI.
            raise TimeoutError("Whop OAuth callback timed out — listener still armed")
        await asyncio.sleep(0.5)

    result = _OAUTH_RESULT
    _shutdown_oauth_server()
    _reset_oauth_state()

    if result.get("status") == "error":
        return {"ok": False, "error": result.get("error", "unknown")}
    return {"ok": True}


def oauth_status() -> dict[str, Any]:
    """Non-blocking poll for the UI. Lets the EarnTab spinner update without
    parking an RPC for 10 minutes (which would block the sidecar).

    Side-effect: when status hits success/error, the listener is torn down
    and module state is reset on the FIRST poll that observes a finished
    result. Subsequent polls return `idle`. This keeps the listener present
    long enough for the UI to see the result, but doesn't leak the bound
    port if the user navigates away."""
    if _OAUTH_RESULT is None:
        return {"status": "pending" if _OAUTH_SERVER else "idle"}

    final = _OAUTH_RESULT
    # Cache the response then reset, so we report the same result exactly
    # once before going back to idle.
    if final.get("status") == "success":
        response: dict[str, Any] = {"status": "success"}
    else:
        response = {"status": "error", "error": final.get("error", "unknown")}
    _shutdown_oauth_server()
    _reset_oauth_state()
    return response


def _reset_oauth_state() -> None:
    global _OAUTH_VERIFIER, _OAUTH_STATE, _OAUTH_RESULT
    _OAUTH_VERIFIER = None
    _OAUTH_STATE = None
    _OAUTH_RESULT = None


def _shutdown_oauth_server() -> None:
    global _OAUTH_SERVER
    if _OAUTH_SERVER is not None:
        try:
            _OAUTH_SERVER.shutdown()
            _OAUTH_SERVER.server_close()
        except Exception:
            pass
        _OAUTH_SERVER = None


def oauth_cancel() -> None:
    """User dismissed the sign-in flow before completing it."""
    _shutdown_oauth_server()
    _reset_oauth_state()
