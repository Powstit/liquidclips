"""Chat moderation · AdminHQ read + moderate surface.

AdminHQ audit (2026-08-26) · real message-level moderation already
existed (`moderation.py`: hide / warn / mute24h) and a real message
model already existed (`ChatMessage`), but neither was reachable from
the web admin — `moderation.py`'s routes correctly gate on
`Depends(current_user)` (Bearer-JWT — the desktop chat panel's own
mod-in-chat context menu, `_require_moderator` = staff/founder/mod),
which is the right auth for that surface but not what AdminHQ's proxy
sends (x-internal-secret + clerk_user_id). There was also no cross-
channel read at all — `GET /chat/messages` in chat.py is single-channel
only.

This file adds the admin-side surface without touching `moderation.py`:
  - GET  /admin/chat/messages       — cross-channel read, optional
                                       channel/search filters.
  - GET  /admin/chat/muted-users    — who's currently muted.
  - POST /admin/chat/messages/{id}/hide
  - POST /admin/chat/messages/{id}/warn
  - POST /admin/chat/messages/{id}/mute24h

The three POST actions call moderation.py's own route functions
directly (plain Python calls, not a second HTTP hop) — same audit
trail, same idempotency guards, same self-mute guard, zero duplicated
security logic. An AdminUser is always `is_admin_email(...) == True`,
which already satisfies moderation.py's own `_require_moderator` gate,
so passing the resolved admin straight through is correct.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChatMessage, User, utcnow
from app.routes.admin import AdminUser
from app.routes.moderation import (
    HidePayload,
    Mute24hOut,
    Mute24hPayload,
    ModeratedMessageOut,
    WarnOut,
    WarnPayload,
    hide_message,
    mute_message_author_24h,
    warn_message_author,
)

router = APIRouter(prefix="/admin/chat", tags=["chat-admin"])


class AdminChatMessageOut(BaseModel):
    id: str
    user_id: str
    username: str
    channel: str
    content: str
    role: str
    pinned: bool
    hidden_at: str | None
    hidden_by_user_id: str | None
    hide_reason: str | None
    created_at: str


class AdminChatMessagesOut(BaseModel):
    messages: list[AdminChatMessageOut]
    total_returned: int


@router.get("/messages", response_model=AdminChatMessagesOut)
def list_messages_admin(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    channel: str | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    include_hidden: bool = True,
    limit: Annotated[int, Query(ge=1, le=300)] = 100,
) -> AdminChatMessagesOut:
    """Cross-channel read — the gap the web admin had no answer for at
    all. Admin sees the real `content` even on hidden rows (unlike the
    customer-facing `/chat/messages` scrub in chat.py) — that's the
    point of a moderation view."""
    query = db.query(ChatMessage)
    if channel:
        query = query.filter(ChatMessage.channel == channel)
    if q:
        needle = f"%{q}%"
        query = query.filter(
            (ChatMessage.content.ilike(needle)) | (ChatMessage.username.ilike(needle))
        )
    if not include_hidden:
        query = query.filter(ChatMessage.hidden_at.is_(None))
    rows = query.order_by(ChatMessage.created_at.desc()).limit(limit).all()
    return AdminChatMessagesOut(
        messages=[
            AdminChatMessageOut(
                id=r.id,
                user_id=r.user_id,
                username=r.username,
                channel=r.channel,
                content=r.content,
                role=r.role,
                pinned=r.pinned,
                hidden_at=r.hidden_at.isoformat() if r.hidden_at else None,
                hidden_by_user_id=r.hidden_by_user_id,
                hide_reason=r.hide_reason,
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
            for r in rows
        ],
        total_returned=len(rows),
    )


class MutedUserOut(BaseModel):
    id: str
    email: str | None
    muted_until: str


class MutedUsersOut(BaseModel):
    users: list[MutedUserOut]


@router.get("/muted-users", response_model=MutedUsersOut)
def list_muted_users(
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> MutedUsersOut:
    now = utcnow()
    rows = (
        db.query(User)
        .filter(User.chat_muted_until.is_not(None))
        .filter(User.chat_muted_until > now)
        .order_by(User.chat_muted_until.desc())
        .all()
    )
    return MutedUsersOut(
        users=[
            MutedUserOut(id=u.id, email=u.email, muted_until=u.chat_muted_until.isoformat())
            for u in rows
        ]
    )


@router.post("/messages/{message_id}/hide", response_model=ModeratedMessageOut)
def hide_message_admin(
    message_id: str,
    payload: HidePayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> ModeratedMessageOut:
    return hide_message(message_id, payload, admin, db)


@router.post("/messages/{message_id}/warn", response_model=WarnOut)
def warn_message_author_admin(
    message_id: str,
    payload: WarnPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> WarnOut:
    return warn_message_author(message_id, payload, admin, db)


@router.post("/messages/{message_id}/mute24h", response_model=Mute24hOut)
def mute_message_author_24h_admin(
    message_id: str,
    payload: Mute24hPayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> Mute24hOut:
    return mute_message_author_24h(message_id, payload, admin, db)
