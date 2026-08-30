"""Whop bounty proxy.

Whop's public-graphql endpoint rejects user OAuth tokens for the
publicBounties* queries:

    "You must provide a valid App API Key, or an app's user token..."

The App API key has to stay server-side. So the desktop authenticates to
the backend with its license JWT, the backend calls Whop with the app key,
and we cache short-lived results in memory. Same response shapes the
desktop already understands — the desktop sidecar just stops talking
directly to Whop and points at us instead.

Endpoints:
  GET /whop/bounties              → list public bounties
  GET /whop/bounties/{id}         → single bounty detail
  GET /whop/submissions/{id}      → submission status

Auth:
  License JWT in Authorization: Bearer header (same as every other
  desktop-facing route — `current_user` dep verifies it).
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import current_user
from app.models import User

log = logging.getLogger("junior.whop_proxy")
router = APIRouter(prefix="/whop", tags=["whop"])

WHOP_GRAPHQL_URL = "https://api.whop.com/public-graphql"

# Small in-process cache so a dashboard refresh doesn't hammer Whop. Beta
# scale only — Redis goes in later when we have multi-instance backend.
_CACHE: dict[str, tuple[float, Any]] = {}
_BOUNTY_LIST_TTL = 60.0      # 1 min — clippers want fresh listings
_BOUNTY_DETAIL_TTL = 120.0
_SUBMISSION_TTL = 30.0       # tight — used for status polling
_MAX_BOUNTY_LIST_FIRST = 25  # keep Whop GraphQL complexity safely < 1000


def _cache_get(key: str) -> Any | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, val = hit
    if time.time() > ts:
        _CACHE.pop(key, None)
        return None
    return val


def _cache_put(key: str, val: Any, ttl: float) -> None:
    _CACHE[key] = (time.time() + ttl, val)


def _clamp_bounty_list_first(first: int) -> int:
    """Whop rejects queries above complexity 1000.

    The list query includes enough card fields (description + campaign logo) that
    asking for 60 rewards hits ~1862 complexity. Clamp server-side so stale or
    future desktop builds cannot take Earn down with an oversized request.
    """
    return max(1, min(int(first or 30), _MAX_BOUNTY_LIST_FIRST))


async def _whop_gql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call Whop's public-graphql with the server-side App API Key.

    Raises HTTPException(502) on transport errors and HTTPException(503)
    when WHOP_API_KEY isn't configured — the desktop interprets 503 as
    "fall back to manual paste".
    """
    settings = get_settings()
    if not settings.whop_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Whop API key not configured on the backend",
        )
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                WHOP_GRAPHQL_URL,
                headers={
                    "Authorization": f"Bearer {settings.whop_api_key}",
                    "Content-Type": "application/json",
                },
                json={"query": query, "variables": variables or {}},
            )
        except httpx.HTTPError as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Whop unreachable: {e}") from e
    if resp.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Whop returned {resp.status_code}: {resp.text[:200]}",
        )
    body = resp.json()
    if body.get("errors"):
        # Surface the first error message verbatim — the desktop renders it
        # in the visible error card so we don't have to guess.
        first = body["errors"][0] if body["errors"] else {}
        msg = first.get("message", "Whop GraphQL error")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Whop: {msg}")
    return body.get("data", {})


# --- queries (mirror what whop_client.py used to call directly) ---------

# Note (Whop API limits, verified 2026-05-26 via live introspection):
# - publicBounties returns `PublicBounty` (clipper-facing); the richer `Bounty`
#   type (and its `discussionPost { markdownContent muxAssets ... }`) requires
#   user-OAuth scope our App API Key doesn't carry. Trying it returns
#   "User does not have access to this feed".
# - PublicBounty does expose direct `attachments` (rare in practice — most
#   creators paste source URLs into the description instead).
# So the practical source-extraction path is: query `attachments` here, parse
# URLs out of `description` text in the desktop client (regex for YouTube /
# Drive / Vimeo / Dropbox / *.mp4). Adding hosted-discussion-post reading is
# a future user-OAuth project, not a public-API tweak.
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
        user { username name profilePicture { sourceUrl } }
        experience { id name logo { sourceUrl } }
        attachments { __typename id sourceUrl contentType filename }
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
    user { username name profilePicture { sourceUrl } }
    experience { id name logo { sourceUrl } }
    attachments {
      __typename
      id
      filename
      sourceUrl
      contentType
      optimizedUrl
      byteSizeV2
      ... on VideoAttachment { aspectRatio duration width height blurhash }
      ... on ImageAttachment { aspectRatio width height blurhash }
      ... on AudioAttachment { duration waveformUrl }
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
    bounty { id title rewardPerUnitAmount currency }
  }
}
"""


# --- normalization -------------------------------------------------------


def _normalize_bounty(node: dict[str, Any]) -> dict[str, Any]:
    """Flatten Whop's nested `user.profilePicture.sourceUrl` back to the flat
    `user.image` string the desktop's WhopBounty type expects. Whop has no
    scalar avatar field — `profilePicture` is an AttachmentInterface — so we
    query the sub-field and collapse it here, keeping the wire contract stable.

    Also derives a real video thumbnail from the bounty's discussion post Mux
    asset when one exists (free + public via image.mux.com), falling back to
    the experience logo. Closes the "no thumbnail on the bounty" gap noted in
    the prior version of this comment.
    """
    user = node.get("user")
    if isinstance(user, dict):
        pic = user.pop("profilePicture", None)
        user["image"] = pic.get("sourceUrl") if isinstance(pic, dict) else None

    # Prefer a real video thumbnail from a Mux source in the discussion post.
    # image.mux.com/{playbackId}/thumbnail.jpg is the public Mux pattern — no
    # auth, no signing required for public playback assets. Falls back to the
    # experience logo (the old behaviour) when no Mux source is attached.
    thumb: str | None = None
    disc = node.get("discussionPost")
    if isinstance(disc, dict):
        mux_list = disc.get("muxAssets") or []
        for mux in mux_list:
            pb = (mux or {}).get("playbackId")
            if pb:
                thumb = f"https://image.mux.com/{pb}/thumbnail.jpg?time=2"
                break

    exp = node.get("experience")
    if isinstance(exp, dict):
        logo = exp.pop("logo", None)
        if thumb is None:
            thumb = logo.get("sourceUrl") if isinstance(logo, dict) else None
    node["thumbnail"] = thumb
    return node


# --- endpoints -----------------------------------------------------------


# v0.7.68 — public bounty discovery. The desktop's Earn Available tab loads
# this unauthenticated so a cold-launched user sees bounties without going
# through the connect-desktop unlock. Three protections keep this safe:
#   1. Shared cache key (`bounties:public:{first}`) — at most one Whop GQL
#      call per `_BOUNTY_LIST_TTL` globally, regardless of caller count.
#   2. IP rate-limit (sliding window in-process; sized so a noisy client
#      can't drown the proxy but a real user opening Earn 30x/min is fine).
#   3. Public view = non-Partner Campaign A only. Campaign B (Partner-only)
#      stays gated behind the authenticated endpoint.
#
# 2026-07-05 · Wave 4 polish · bug-hunt-lens BE1 memory-leak closed.
# `_PUBLIC_RATE_BUCKETS` previously grew unbounded across distinct IPs
# (a 1-replica Railway process would OOM under any real cold-email
# traffic). Now bounded via `_PUBLIC_RATE_BUCKETS_MAX_KEYS` with simple
# LRU eviction on the last-access timestamp. Combined with the
# existing sliding-window prune (expired timestamps pop off the deque
# on every check), this is stable across long uptimes even under
# 100k+ distinct-IP bursts.
_PUBLIC_RATE_WINDOW_SEC = 60.0
_PUBLIC_RATE_MAX_REQUESTS = 30
_PUBLIC_RATE_BUCKETS: dict[str, deque[float]] = {}
_PUBLIC_RATE_BUCKETS_MAX_KEYS = 4096
_PUBLIC_RATE_LAST_ACCESS: dict[str, float] = {}


def _evict_rate_buckets_if_full() -> None:
    """LRU eviction · runs before inserting a new bucket. Drops 10% of
    the oldest keys at once so we don't re-evict on every subsequent
    insert. O(N log N) in the eviction path, O(1) in the common case."""
    if len(_PUBLIC_RATE_BUCKETS) < _PUBLIC_RATE_BUCKETS_MAX_KEYS:
        return
    drop_count = max(1, _PUBLIC_RATE_BUCKETS_MAX_KEYS // 10)
    stale = sorted(_PUBLIC_RATE_LAST_ACCESS.items(), key=lambda x: x[1])[:drop_count]
    for key, _ in stale:
        _PUBLIC_RATE_BUCKETS.pop(key, None)
        _PUBLIC_RATE_LAST_ACCESS.pop(key, None)


def _client_ip_for_rate_limit(request: Request) -> str:
    """v0.7.69 — honor `X-Forwarded-For` so Railway/Cloudflare proxy traffic
    is bucketed by actual client IP, not the single proxy hop (bug-hunt BE3).
    Falls back to `request.client.host` when no proxy header is present
    (local dev, direct hits).
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # First entry is the original client; the rest are proxy chain.
        return fwd.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _public_rate_limit_check(client_ip: str) -> None:
    now = time.time()
    # 2026-07-05 · Wave 4 polish · evict oldest keys before inserting a
    # NEW IP so the dict stays bounded. Existing IP hits skip eviction
    # via the `in _PUBLIC_RATE_BUCKETS` shortcut (fast path).
    if client_ip not in _PUBLIC_RATE_BUCKETS:
        _evict_rate_buckets_if_full()
    bucket = _PUBLIC_RATE_BUCKETS.setdefault(client_ip, deque())
    _PUBLIC_RATE_LAST_ACCESS[client_ip] = now
    cutoff = now - _PUBLIC_RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _PUBLIC_RATE_MAX_REQUESTS:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Slow down — too many public bounty requests from this IP.",
        )
    bucket.append(now)


def _filter_public_only(bounties: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Public bounty view — mirrors `_filter_partner_only` for a non-Partner.

    Whop's `publicBounties` query already returns Whop's publicly-discoverable
    surface, so the default is pass-through. When `WHOP_CAMPAIGN_B_ID` is set
    on Railway, the Partner-only Campaign B is stripped by experience.id so
    it does not leak through the anonymous public route. If the env is unset
    (the pre-Step-8 state — Campaign B doesn't exist on Whop yet), there's
    nothing to filter and the unmodified Whop list is returned.
    """
    settings = get_settings()
    campaign_b = (settings.whop_campaign_b_id or "").strip()
    if not campaign_b:
        return bounties
    return [
        b for b in bounties
        if not (isinstance(b.get("experience"), dict) and b["experience"].get("id") == campaign_b)
    ]


def _filter_partner_only(bounties: list[dict[str, Any]], user: User) -> list[dict[str, Any]]:
    """Partner Engine — hide the dedicated-channel ($10 RPM) campaign from
    non-Partners. Partner status is local (user.partner_unlocked_at set by
    services/partner_unlock.py). If WHOP_CAMPAIGN_B_ID env var isn't set
    yet (pre-Step 8), this is a no-op — Whop dashboard config hasn't
    happened, so Campaign B doesn't exist to filter.

    Match is against `experience.id` on each bounty node. Whop's "campaign"
    is an experience under the hood.
    """
    settings = get_settings()
    campaign_b = (settings.whop_campaign_b_id or "").strip()
    if not campaign_b:
        return bounties
    if user.partner_unlocked_at is not None:
        return bounties
    return [
        b for b in bounties
        if not (isinstance(b.get("experience"), dict) and b["experience"].get("id") == campaign_b)
    ]


@router.get("/bounties/public")
async def list_public_bounties(
    request: Request,
    first: int = 30,
) -> dict[str, Any]:
    """v0.7.68 — public bounty discovery for the desktop Earn Available tab.

    No LICENSE_JWT, no Whop OAuth, no Keychain. Returns the non-Partner
    Campaign A view via the server-side App API Key. Cached for
    `_BOUNTY_LIST_TTL` under a single shared key so concurrent callers
    don't fan out to Whop. Per-IP sliding-window rate limit prevents one
    client from drowning the proxy.

    The desktop layers the authenticated `/whop/bounties` response on top
    of this when a cached JWT is available, so Partners still see their
    full list after explicit unlock.
    """
    client_ip = _client_ip_for_rate_limit(request)
    _public_rate_limit_check(client_ip)
    first = _clamp_bounty_list_first(first)
    cache_key = f"bounties:public:{first}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"bounties": cached, "source": "cache"}

    data = await _whop_gql(_LIST_BOUNTIES, {"first": first})
    edges = (data.get("publicBounties") or {}).get("edges") or []
    bounties = [_normalize_bounty(edge["node"]) for edge in edges if edge and edge.get("node")]
    filtered = _filter_public_only(bounties)
    _cache_put(cache_key, filtered, _BOUNTY_LIST_TTL)
    log.info(
        "[whop_proxy] list_public_bounties ip=%s count=%d",
        client_ip, len(filtered),
    )
    return {"bounties": filtered, "source": "live"}


@router.get("/bounties")
async def list_bounties(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    first: int = 30,
) -> dict[str, Any]:
    """Return public Content Rewards bounties. License-JWT-gated so a leaked
    desktop key can only browse what the App API Key can already see.

    Partner Engine: non-Partners see only Campaign A ($5 RPM). The $10
    RPM dedicated-channel Campaign B is filtered out by experience.id
    against WHOP_CAMPAIGN_B_ID. The cache key includes the partner flag
    so a Partner unlock doesn't get masked by a stale prospect cache."""
    _ = db  # current_user already opened the session
    first = _clamp_bounty_list_first(first)
    is_partner = user.partner_unlocked_at is not None
    cache_key = f"bounties:{first}:partner={int(is_partner)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"bounties": cached, "source": "cache"}

    data = await _whop_gql(_LIST_BOUNTIES, {"first": first})
    edges = (data.get("publicBounties") or {}).get("edges") or []
    bounties = [_normalize_bounty(edge["node"]) for edge in edges if edge and edge.get("node")]
    bounties = _filter_partner_only(bounties, user)
    _cache_put(cache_key, bounties, _BOUNTY_LIST_TTL)
    log.info(
        "[whop_proxy] list_bounties user=%s partner=%s count=%d",
        user.id, is_partner, len(bounties),
    )
    return {"bounties": bounties, "source": "live"}


@router.get("/bounties/{bounty_id}")
async def get_bounty(
    bounty_id: str,
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    """Single-bounty detail. Same Partner Engine gate as the list endpoint
    — a non-Partner who deep-links to a Campaign B bounty (e.g. shared
    URL) gets a 404 instead of the brief. Returning 404 (vs 403) keeps
    the existence of Campaign B opaque to non-Partners."""
    cache_key = f"bounty:{bounty_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        # Cache stores the raw bounty; gate runs on every read so an unlock
        # mid-TTL takes effect immediately.
        if not _filter_partner_only([cached], user):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Bounty not found")
        return {"bounty": cached, "source": "cache"}
    data = await _whop_gql(_BOUNTY_DETAIL, {"id": bounty_id})
    bounty = data.get("publicBounty")
    if not bounty:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bounty not found")
    bounty = _normalize_bounty(bounty)
    _cache_put(cache_key, bounty, _BOUNTY_DETAIL_TTL)
    if not _filter_partner_only([bounty], user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bounty not found")
    log.info("[whop_proxy] get_bounty %s for user=%s", bounty_id, user.id)
    return {"bounty": bounty, "source": "live"}


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    cache_key = f"submission:{submission_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"submission": cached, "source": "cache"}
    data = await _whop_gql(_SUBMISSION, {"id": submission_id})
    submission = data.get("publicBountySubmission")
    if not submission:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    _cache_put(cache_key, submission, _SUBMISSION_TTL)
    log.info("[whop_proxy] get_submission %s for user=%s", submission_id, user.id)
    return {"submission": submission, "source": "live"}


# =====================================================================
# 2026-08-30 · Webhook-drop resilience.
#
# Whop's payment.success webhook is over the internet — sometimes it
# arrives in 6 seconds, sometimes 6 minutes, sometimes it never fires.
# When it drops, the user has PAID on Whop's side but our DB still
# shows them as free-tier / not-upgraded. They rage on X, they demand
# refunds, they screenshot Whop's success page. All preventable if we
# just ASK Whop directly when the user hits a paywall.
#
# `POST /whop/verify-my-subscription` is the polling endpoint the
# desktop hits from any paywall surface every 60s. It:
#   1. Requires an authed license JWT (current_user).
#   2. If the user has a whop_user_id, calls Whop's `/memberships`
#      REST API filtered by that id.
#   3. If Whop returns an active membership → syncs subscription_status
#      + paid_until into our DB row + commits.
#   4. Returns the fresh state so the client can dismiss the paywall
#      the moment the flip lands.
#
# In-memory cache (15s TTL, keyed on user.id) prevents runaway rate-
# limit spend when 275 users are all polling at once — the worst case
# is one Whop API call per user per 15 seconds, not one per poll.
# =====================================================================


class VerifySubscriptionOut(BaseModel):
    verified: bool
    subscription_status: str | None = None
    paid_until_iso: str | None = None
    changed: bool = False
    reason: str | None = None
    checked_at_iso: str


# Cheap in-process cache. Not shared across replicas but Railway is
# pinned to numReplicas: 1 (per railway.json — required for
# APScheduler) so this is authoritative for our topology. Key is
# user.id (string), value is (VerifySubscriptionOut-shaped dict,
# expires_at unix seconds).
_VERIFY_TTL_SECONDS = 15
_verify_cache: dict[str, tuple[dict[str, Any], float]] = {}


def _verify_cache_get(user_id: str) -> dict[str, Any] | None:
    row = _verify_cache.get(user_id)
    if not row:
        return None
    payload, expires_at = row
    if time.time() >= expires_at:
        _verify_cache.pop(user_id, None)
        return None
    return payload


def _verify_cache_put(user_id: str, payload: dict[str, Any]) -> None:
    _verify_cache[user_id] = (payload, time.time() + _VERIFY_TTL_SECONDS)


@router.post("/verify-my-subscription", response_model=VerifySubscriptionOut)
def verify_my_subscription(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> VerifySubscriptionOut:
    """Poll Whop's live membership list for this user + sync our DB.

    Called from the desktop paywall every 60s while the user is
    watching for their subscription to activate. Belt-and-suspenders
    against a dropped or delayed payment.success webhook.
    """
    from datetime import datetime, timezone
    from app import whop_payments

    checked_at = datetime.now(timezone.utc).isoformat()

    # Cache hit → return the last known-verified state without hitting
    # Whop. Caps our outbound rate at ~4 requests/min/user under
    # sustained polling.
    cached = _verify_cache_get(user.id)
    if cached is not None:
        return VerifySubscriptionOut(**cached)

    if not user.whop_user_id:
        payload = {
            "verified": False,
            "reason": "no_whop_user_id",
            "checked_at_iso": checked_at,
        }
        _verify_cache_put(user.id, payload)
        return VerifySubscriptionOut(**payload)

    if not whop_payments.wallet_reads_live():
        payload = {
            "verified": False,
            "reason": "whop_api_not_configured",
            "checked_at_iso": checked_at,
        }
        _verify_cache_put(user.id, payload)
        return VerifySubscriptionOut(**payload)

    # Call Whop's /memberships REST endpoint filtered to this user.
    # Same client + auth as the nightly reconciler (see cron.py
    # _whop_reconcile_tick). 8s timeout keeps the polling budget
    # tight — a slow Whop call must not block the paywall UX.
    try:
        with whop_payments._client() as client:  # noqa: SLF001
            resp = client.get(
                "/memberships",
                params={"user_id": user.whop_user_id, "valid": "true", "per": 5},
                timeout=8.0,
            )
            resp.raise_for_status()
            body = resp.json() or {}
        memberships = body.get("data") or body.get("memberships") or []
    except Exception as exc:  # noqa: BLE001
        log.warning("[whop verify] user=%s failed: %s", user.id, exc)
        payload = {
            "verified": False,
            "reason": "whop_api_error",
            "checked_at_iso": checked_at,
        }
        _verify_cache_put(user.id, payload)
        return VerifySubscriptionOut(**payload)

    if not memberships:
        # Whop reports NO active membership. Don't downgrade the DB
        # from this signal — a subscription can look inactive during
        # a card-retry window; the nightly reconciler + webhook is
        # authoritative for downgrades. Just tell the client that
        # nothing changed.
        payload = {
            "verified": True,
            "subscription_status": user.subscription_status,
            "paid_until_iso": user.paid_until.isoformat() if user.paid_until else None,
            "changed": False,
            "reason": "no_active_membership_on_whop",
            "checked_at_iso": checked_at,
        }
        _verify_cache_put(user.id, payload)
        return VerifySubscriptionOut(**payload)

    # Whop says active. If our DB disagrees, sync forward. UPGRADE
    # direction only (see comment above about downgrades).
    m = memberships[0]
    whop_valid_until = m.get("valid_until") or m.get("renewal_period_end")
    new_paid_until: datetime | None = None
    if whop_valid_until:
        try:
            new_paid_until = datetime.fromtimestamp(int(whop_valid_until), tz=timezone.utc)
        except (TypeError, ValueError):
            new_paid_until = None

    was_active = (user.subscription_status or "").lower() in ("active", "trialing")
    changed = False
    if not was_active:
        user.subscription_status = "active"
        changed = True
    if new_paid_until and (user.paid_until is None or user.paid_until < new_paid_until):
        user.paid_until = new_paid_until
        changed = True
    if changed:
        db.commit()
        # Invalidate the cache so the very next poll returns the
        # fresh state without waiting for the TTL — the client will
        # see the flip on its next 60s tick or its manual refresh.
        _verify_cache.pop(user.id, None)
        log.info(
            "[whop verify] user=%s synced from webhook-drop · status=%s paid_until=%s",
            user.id,
            user.subscription_status,
            user.paid_until,
        )

    payload = {
        "verified": True,
        "subscription_status": user.subscription_status,
        "paid_until_iso": user.paid_until.isoformat() if user.paid_until else None,
        "changed": changed,
        "reason": "synced_from_whop" if changed else "already_in_sync",
        "checked_at_iso": checked_at,
    }
    if not changed:
        # Only cache the "no change" branch — the "changed" branch
        # already invalidated the cache so a following poll picks up
        # the DB state directly.
        _verify_cache_put(user.id, payload)
    return VerifySubscriptionOut(**payload)
