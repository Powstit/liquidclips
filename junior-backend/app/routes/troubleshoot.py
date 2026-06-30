"""POST /me/troubleshoot · AI troubleshooting stub.

2026-06-30 · stub-only first pass.

The frontend (desktop-2 AppShell global error listener) emits
`kade:speak` payloads with a title + body when engine:error or an
unhandled fetch rejection fires. Today the bubble text is static · the
intent is to swap in an Anthropic-generated explanation once the
production env carries an ANTHROPIC_API_KEY and we install the Python
`anthropic` SDK.

This module ships the route SHAPE so the wire-up is one config-flip
away. While ANTHROPIC_API_KEY is unset (default in production
2026-06-30) the route returns 503 with `{ available: false, reason }`.
The frontend treats 503 as "leave the static bubble copy in place" and
never throws.

When ANTHROPIC_API_KEY lands and the `anthropic` package is installed:
  · uncomment the import block at the top
  · replace the TODO branch with the real `messages.create` call
  · add rate-limit (per-user, per-IP) middleware
  · add a daily cost cap
  · add a prompt template (NOT the raw payload — sanitise + bound)

Auth: license JWT bearer · same pattern as every other `/me/*` route.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.models import User

# When the Anthropic wire-up lands, uncomment:
#   from anthropic import Anthropic
# Until then we keep the import OUT so the route doesn't 500 at boot
# if the dep isn't installed.

log = logging.getLogger("junior.troubleshoot")

router = APIRouter(prefix="/me", tags=["troubleshoot"])


class TroubleshootRequest(BaseModel):
    """Payload from desktop-2 AppShell when kade:speak fires.

    Fields are bounded so a malicious / runaway frontend can't ship
    unlimited prompt context to the LLM once the wire-up is live.
    """

    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=2_000)
    severity: Literal["info", "warn", "error"] = "warn"
    # Optional route + tier context so the future prompt template can
    # reference "you were on My Clips on the Free tier when this fired".
    route: str | None = Field(None, max_length=64)
    tier: str | None = Field(None, max_length=32)


class TroubleshootResponse(BaseModel):
    available: bool
    # When `available=true` (future) · the human-readable Anthropic
    # explanation that should replace the static bubble body.
    explanation: str | None = None
    # When `available=false` (today) · why we're not serving an
    # explanation · the frontend logs this to the bubble's
    # `data-troubleshoot-status` attribute for diagnostics.
    reason: str | None = None


def _anthropic_key() -> str | None:
    """Read the API key from the standard env var. Returns None when
    unset · the caller is expected to 503 on None."""
    raw = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    return raw or None


@router.post("/troubleshoot", response_model=TroubleshootResponse)
async def troubleshoot(
    payload: TroubleshootRequest,
    user: Annotated[User, Depends(current_user)],
    _db: Annotated[Session, Depends(get_db)],
) -> TroubleshootResponse:
    """Translate a frontend error payload into a human Kade explanation.

    Stub behaviour (2026-06-30):
      - If ANTHROPIC_API_KEY is set on Railway, returns a placeholder
        explanation acknowledging the wire-up is pending the SDK
        install + prompt design.
      - If unset (default), returns 503 with `available=false`.

    Real behaviour (TODO when Anthropic SDK lands):
      client = Anthropic(api_key=key)
      response = client.messages.create(
          model="claude-haiku-4-5",
          max_tokens=200,
          system=TROUBLESHOOT_SYSTEM_PROMPT,
          messages=[
              {"role": "user", "content": build_user_prompt(payload, user)},
          ],
      )
      return TroubleshootResponse(
          available=True,
          explanation=response.content[0].text,
      )

    Per-user rate limit: 1 call per 10s, 30 calls per day. Cost cap:
    enforced at the gateway, not here.
    """
    key = _anthropic_key()

    if not key:
        # The 503 lets the frontend keep its static bubble · we never
        # silently fail by returning an empty string the UI then renders.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "available": False,
                "reason": "ANTHROPIC_API_KEY not configured · static bubble copy in use.",
            },
        )

    # TODO · Anthropic call · see docstring.
    log.info(
        "troubleshoot stub fired · user=%s severity=%s route=%s",
        user.id,
        payload.severity,
        payload.route,
    )
    return TroubleshootResponse(
        available=True,
        explanation=(
            "Kade troubleshooting is configured but the Anthropic SDK "
            "wire-up is pending the next backend deploy."
        ),
    )
