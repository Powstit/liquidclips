"""Login-flow step telemetry · POST /telemetry/login-step.

Ships 2026-07-06. The desktop LoginScreen + activation.ts fire this on
every strategic step so we can measure funnel drop-off:

  login_screen_shown
    → clipper_clicked  → (guest mode · no further steps needed)
    → agency_clicked   → deep_link_arrived → activation_succeeded
                                          → activation_failed
    → paste_code_attempted → paste_code_succeeded
                          → paste_code_failed

Rows persist to ``login_step_events`` for cohort funnel analysis. The
endpoint is anonymous (no license bearer required) so the guest and
recovery paths are still captured.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/telemetry", tags=["telemetry-login"])
log = logging.getLogger(__name__)


class LoginStepIn(BaseModel):
    step: str = Field(..., min_length=1, max_length=60)
    session_id: str = Field(..., min_length=1, max_length=80)
    ts: str | None = Field(None, max_length=40)
    app_version: str | None = Field(None, max_length=40)
    ctx: dict[str, Any] | None = None


@router.post("/login-step")
def log_login_step(
    body: LoginStepIn,
    db: Annotated[Session, Depends(get_db)],
    x_forwarded_for: Annotated[str | None, Header(alias="x-forwarded-for")] = None,
) -> dict[str, Any]:
    """Append a single login-step row. Fire-and-forget from the client;
    we return 200 unconditionally so a broken row never blocks the user.
    """
    ip = None
    if x_forwarded_for:
        # First IP in the list is the origin client (Railway sits behind Cloudflare).
        ip = x_forwarded_for.split(",")[0].strip()[:80]

    try:
        db.execute(
            text(
                """
                INSERT INTO login_step_events
                    (session_id, step, app_version, ctx, ip_address)
                VALUES
                    (:sid, :step, :ver, CAST(:ctx AS jsonb), :ip)
                """
            ),
            {
                "sid": body.session_id,
                "step": body.step[:60],
                "ver": body.app_version,
                "ctx": _dumps(body.ctx),
                "ip": ip,
            },
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        # Never surface a 500 to the client · a stuck event is a stat
        # not a UX blocker. Log so the schema issue is visible.
        log.warning("[login_telemetry] insert failed: %s", exc)
    return {"ok": True}


def _dumps(v: Any) -> str:
    import json
    return json.dumps(v if v is not None else {})
