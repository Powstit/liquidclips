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
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
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
    """
    user = node.get("user")
    if isinstance(user, dict):
        pic = user.pop("profilePicture", None)
        user["image"] = pic.get("sourceUrl") if isinstance(pic, dict) else None
    # Whop has no thumbnail on the bounty itself — the campaign image lives on
    # the linked experience (experience.logo, an AttachmentInterface). Flatten
    # it to a top-level `thumbnail` string and keep experience as {id, name}.
    exp = node.get("experience")
    if isinstance(exp, dict):
        logo = exp.pop("logo", None)
        node["thumbnail"] = logo.get("sourceUrl") if isinstance(logo, dict) else None
    else:
        node["thumbnail"] = None
    return node


# --- endpoints -----------------------------------------------------------


@router.get("/bounties")
async def list_bounties(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    first: int = 30,
) -> dict[str, Any]:
    """Return public Content Rewards bounties. License-JWT-gated so a leaked
    desktop key can only browse what the App API Key can already see."""
    _ = db  # current_user already opened the session
    cache_key = f"bounties:{first}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"bounties": cached, "source": "cache"}

    data = await _whop_gql(_LIST_BOUNTIES, {"first": first})
    edges = (data.get("publicBounties") or {}).get("edges") or []
    bounties = [_normalize_bounty(edge["node"]) for edge in edges if edge and edge.get("node")]
    _cache_put(cache_key, bounties, _BOUNTY_LIST_TTL)
    log.info(
        "[whop_proxy] list_bounties for user=%s count=%d", user.id, len(bounties)
    )
    return {"bounties": bounties, "source": "live"}


@router.get("/bounties/{bounty_id}")
async def get_bounty(
    bounty_id: str,
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    cache_key = f"bounty:{bounty_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"bounty": cached, "source": "cache"}
    data = await _whop_gql(_BOUNTY_DETAIL, {"id": bounty_id})
    bounty = data.get("publicBounty")
    if not bounty:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bounty not found")
    bounty = _normalize_bounty(bounty)
    _cache_put(cache_key, bounty, _BOUNTY_DETAIL_TTL)
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
