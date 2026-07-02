"""Chat-message moderation · Stage 7.

Backs the currently-disabled context-menu buttons at
`desktop-2/src/design-os/components/ChatPanel.tsx:362-364` (Hide
message · Warn user · Mute for 24 hours). Sits on the same `/chat/*`
prefix as `chat.py` but owns only the moderation mutations. History /
post / pin still live in `chat.py`; the two routers coexist by path
non-collision.

Authorization (doc §688 · "Backend authorization is authoritative"):
  - Staff (`is_admin_email(user.email)`), founder (`founder_flag`), or
    moderator (`chat_role == "mod"`) may act.
  - Anyone else receives 403. Ordinary clippers never see the menu on
    the client either (per `ChatPanel.tsx`'s `canModerate` gate) so a
    403 here is a defense-in-depth check, not the primary UX gate.

Actions:
  - `POST /chat/messages/{id}/hide` — sets `ChatMessage.hidden_at` +
    `hidden_by_user_id` + optional `hide_reason`. The server-side
    `_serialise` scrub in `chat.py` replaces `content` with
    "[removed by moderator]" on every subsequent read so the original
    text never leaves the API (doc §690).
  - `POST /chat/messages/{id}/warn` — writes an audit-log row targeting
    the message author. Notification insert is deferred to a follow-up
    cycle; the moderator's client is expected to surface a "warn
    delivered" toast on 200.
  - `POST /chat/messages/{id}/mute24h` — sets the message author's
    `User.chat_muted_until = utcnow() + 24h`. `chat.py::post_message`
    rejects any future POST from that user with 403 + Retry-After
    until the mute expires.

Audit:
  - Every mutation writes to `admin_audit_log` (see models.py:1158)
    with `target_type="chat_moderation"` per your directive.
  - `actor_email` is the moderator; `target_id` is the message id
    (except mute24h, where it's the muted user's id so a later query
    can find every mute action against a given user cheaply).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import AdminAuditLog, ChatMessage, User, utcnow

log = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat-moderation"])


# ---------------------------------------------------------------------
# Auth + audit helpers
# ---------------------------------------------------------------------


MUTE_DURATION = timedelta(hours=24)


def _can_moderate(user: User) -> bool:
    """Staff (JUNIOR_ADMIN_EMAILS) OR founder OR mod. Mirrors the
    `_can_pin` gate in `chat.py` — moderation actions and pins share
    the same trust surface."""
    return (
        is_admin_email(user.email)
        or bool(getattr(user, "founder_flag", False))
        or getattr(user, "chat_role", None) == "mod"
    )


def _require_moderator(user: User) -> None:
    if not _can_moderate(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "chat moderation requires staff, founder, or mod role",
        )


def _audit_moderation(
    db: Session,
    user: User,
    action: str,
    target_id: str,
    payload: dict | None = None,
    result: str = "ok",
    error_message: str | None = None,
) -> None:
    """Append an `admin_audit_log` row with `target_type="chat_moderation"`.
    Called INSIDE the caller's transaction so the audit + mutation land
    atomically (rolled back together on any later failure)."""
    db.add(
        AdminAuditLog(
            actor_email=user.email or "unknown",
            action=action,
            target_type="chat_moderation",
            target_id=target_id,
            payload_json=json.dumps(payload or {}),
            result=result,
            error_message=error_message,
        )
    )
    db.flush()


def _get_message_or_404(db: Session, message_id: str) -> ChatMessage:
    row = db.get(ChatMessage, message_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "message not found")
    return row


# ---------------------------------------------------------------------
# Pydantic shapes
# ---------------------------------------------------------------------


class HidePayload(BaseModel):
    reason: str | None = Field(
        default=None,
        max_length=500,
        description="Optional short reason surfaced in the audit log.",
    )


class WarnPayload(BaseModel):
    reason: str | None = Field(
        default=None,
        max_length=500,
        description="Optional short reason surfaced in the audit log.",
    )


class Mute24hPayload(BaseModel):
    reason: str | None = Field(
        default=None,
        max_length=500,
        description="Optional short reason surfaced in the audit log.",
    )


class ModeratedMessageOut(BaseModel):
    id: str
    hidden: bool
    hidden_at: datetime | None
    hidden_by_user_id: str | None
    hide_reason: str | None


class WarnOut(BaseModel):
    ok: bool
    message_id: str
    target_user_id: str


class Mute24hOut(BaseModel):
    ok: bool
    target_user_id: str
    muted_until: datetime


# ---------------------------------------------------------------------
# Routes · POST /chat/messages/{id}/{hide|warn|mute24h}
# ---------------------------------------------------------------------


@router.post(
    "/messages/{message_id}/hide", response_model=ModeratedMessageOut
)
def hide_message(
    message_id: str,
    payload: HidePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ModeratedMessageOut:
    _require_moderator(user)

    row = _get_message_or_404(db, message_id)
    # Idempotency guard — hiding an already-hidden message is a no-op
    # (return current state, no new audit row) so a double-click on the
    # menu button doesn't fan out identical audit rows.
    if row.hidden_at is not None:
        return ModeratedMessageOut(
            id=row.id,
            hidden=True,
            hidden_at=row.hidden_at,
            hidden_by_user_id=row.hidden_by_user_id,
            hide_reason=row.hide_reason,
        )

    now = utcnow()
    row.hidden_at = now
    row.hidden_by_user_id = user.id
    row.hide_reason = payload.reason

    _audit_moderation(
        db,
        user,
        action="hide",
        target_id=row.id,
        payload={
            "channel": row.channel,
            "target_user_id": row.user_id,
            "reason": payload.reason,
        },
    )
    db.commit()

    return ModeratedMessageOut(
        id=row.id,
        hidden=True,
        hidden_at=row.hidden_at,
        hidden_by_user_id=row.hidden_by_user_id,
        hide_reason=row.hide_reason,
    )


@router.post(
    "/messages/{message_id}/warn", response_model=WarnOut
)
def warn_message_author(
    message_id: str,
    payload: WarnPayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WarnOut:
    _require_moderator(user)

    row = _get_message_or_404(db, message_id)
    # System-bot messages can't be warned — there's no human on the
    # other side and the "system-bot" placeholder id has no User row.
    if row.user_id == "system-bot":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot warn the system-bot author",
        )

    _audit_moderation(
        db,
        user,
        action="warn",
        target_id=row.id,
        payload={
            "channel": row.channel,
            "target_user_id": row.user_id,
            "reason": payload.reason,
        },
    )
    db.commit()

    return WarnOut(
        ok=True, message_id=row.id, target_user_id=row.user_id
    )


@router.post(
    "/messages/{message_id}/mute24h", response_model=Mute24hOut
)
def mute_message_author_24h(
    message_id: str,
    payload: Mute24hPayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Mute24hOut:
    _require_moderator(user)

    row = _get_message_or_404(db, message_id)
    if row.user_id == "system-bot":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot mute the system-bot author",
        )
    target = db.get(User, row.user_id)
    if target is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "target user not found"
        )
    # Self-mute guard — a mod can't silence themselves via the menu.
    # Staff bypass exists in `chat.py::post_message`, so a staff self-
    # mute would be non-blocking anyway, but the guard keeps intent
    # explicit.
    if target.id == user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "cannot mute your own account",
        )

    now = utcnow()
    new_until = now + MUTE_DURATION
    # Extend rather than shorten if the target is already muted past
    # the new window — mods should be able to stack mutes without
    # accidentally shortening a peer moderator's earlier action.
    prior = target.chat_muted_until
    if prior is not None:
        # Normalize prior to UTC-aware before comparison (SQLite may
        # return naive; same pattern as chat.py::_as_utc).
        if prior.tzinfo is None:
            prior = prior.replace(tzinfo=timezone.utc)
        if prior > new_until:
            new_until = prior
    target.chat_muted_until = new_until

    _audit_moderation(
        db,
        user,
        action="mute24h",
        # target_id = target user id so a later "show me every mute
        # applied to user X" query is one indexed lookup.
        target_id=target.id,
        payload={
            "message_id": row.id,
            "channel": row.channel,
            "muted_until": new_until.isoformat(),
            "reason": payload.reason,
        },
    )
    db.commit()

    return Mute24hOut(
        ok=True, target_user_id=target.id, muted_until=new_until
    )
