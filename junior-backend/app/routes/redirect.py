"""GET /r/{tracking_id} — public tracking-link resolver.

Resolves a Junior tracking link to its destination URL, sets first-touch
attribution cookies on `.jnremployee.com`, and best-effort logs a click row.

Privacy posture:
  - No raw IP is ever stored. We sha256 the client IP with a daily-rotating
    salt so a hash can't be reused across days.
  - No full user agent — only a short, sanitized family string (Mozilla / Chrome
    / Safari / TikTok-app / etc.), capped at 64 chars.
  - No full referer URL — host only.

Reliability posture:
  - Logging runs in its own DB session AFTER the response is constructed; a
    logging failure must never block the redirect.
  - Missing or disabled links redirect to `account_site_url` so the user lands
    somewhere on-brand instead of a bare 404.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db, SessionLocal
from app.models import LinkClick, TrackingLink

router = APIRouter(tags=["tracking"])
_log = logging.getLogger("junior.tracking")

COOKIE_REF = "jnr_ref"
COOKIE_LINK = "jnr_tracking_link"
COOKIE_MAX_AGE = 60 * 60 * 24 * 90  # 90 days — long enough to outlast the buyer-consideration window

_UA_FAMILY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-./ ]{0,63}")


def _safe_fallback_url() -> str:
    return get_settings().account_site_url or get_settings().public_site_url or "https://liquidclips.app"


def _daily_salt() -> str:
    # Salt rotates each UTC day so an ip_hash from yesterday can't be
    # correlated to one from today even if the underlying IP is the same.
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"junior.tracking.salt.v1.{today}"


def _hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    return hashlib.sha256((_daily_salt() + "|" + ip).encode("utf-8")).hexdigest()[:32]


def _client_ip(request: Request) -> str | None:
    # Honour X-Forwarded-For when Railway / proxy fronts us — take the leftmost
    # entry (the original client). Fall back to the immediate peer.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else None


def _sanitize_ua(ua: str | None) -> str | None:
    if not ua:
        return None
    m = _UA_FAMILY_RE.match(ua.strip())
    return m.group(0).rstrip() if m else None


def _referer_host(ref: str | None) -> str | None:
    if not ref:
        return None
    try:
        host = urlparse(ref).hostname
        return host[:128] if host else None
    except ValueError:
        return None


def _cookie_domain() -> str | None:
    # Set on the apex so account.jnremployee.com / partner.jnremployee.com /
    # jnremployee.com all see the same first-touch attribution cookies.
    # Local dev (settings default api host) gets None → cookie binds to the
    # current host, which is fine.
    site = get_settings().public_site_url
    host = urlparse(site).hostname if site else None
    if not host or host in ("localhost", "127.0.0.1"):
        return None
    # Strip leading subdomain — `api.jnremployee.com` → `.jnremployee.com`,
    # while a bare `jnremployee.com` becomes `.jnremployee.com`.
    parts = host.split(".")
    if len(parts) >= 2:
        return "." + ".".join(parts[-2:])
    return None


def _log_click_best_effort(
    tracking_link_id: str,
    destination_url: str,
    ip_hash: str | None,
    ua_family: str | None,
    ref_host: str | None,
) -> None:
    """Open a fresh session so this insert can't poison the request-scoped
    transaction. Swallow any error — analytics must never block the redirect."""
    try:
        with SessionLocal() as s:
            s.add(LinkClick(
                tracking_link_id=tracking_link_id,
                destination_url=destination_url,
                ip_hash=ip_hash,
                user_agent_family=ua_family,
                referer_host=ref_host,
            ))
            s.commit()
    except Exception as e:  # noqa: BLE001
        _log.warning("click log failed for %s: %s", tracking_link_id, e)


def _apply_first_touch_cookies(
    response: RedirectResponse,
    request: Request,
    link: TrackingLink,
) -> None:
    """Plant jnr_ref + jnr_tracking_link only when absent — first-touch wins,
    matching the locked-at-signup affiliate_id rule in oauth-billing.md §6."""
    domain = _cookie_domain()
    cookie_kwargs = {
        "max_age": COOKIE_MAX_AGE,
        "path": "/",
        "secure": True,
        "httponly": False,  # marketing/account-app analytics may read these
        "samesite": "lax",
    }
    if domain:
        cookie_kwargs["domain"] = domain

    existing_ref = request.cookies.get(COOKIE_REF)
    if not existing_ref and link.affiliate_id:
        response.set_cookie(COOKIE_REF, link.affiliate_id, **cookie_kwargs)

    existing_link = request.cookies.get(COOKIE_LINK)
    if not existing_link:
        response.set_cookie(COOKIE_LINK, link.id, **cookie_kwargs)


@router.get("/r/{tracking_id}", include_in_schema=False)
def resolve_tracking_link(
    tracking_id: str,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    """Resolve a tracking link → 302 to its destination_url, plant first-touch
    cookies, log the click best-effort."""
    fallback = _safe_fallback_url()

    link = db.get(TrackingLink, tracking_id)
    if not link or link.disabled_at is not None:
        # Don't leak whether the slug existed; same fallback either way.
        return RedirectResponse(url=fallback, status_code=302)

    destination = link.destination_url or fallback
    response = RedirectResponse(url=destination, status_code=302)

    _apply_first_touch_cookies(response, request, link)

    _log_click_best_effort(
        tracking_link_id=link.id,
        destination_url=destination,
        ip_hash=_hash_ip(_client_ip(request)),
        ua_family=_sanitize_ua(request.headers.get("user-agent")),
        ref_host=_referer_host(request.headers.get("referer")),
    )

    return response
