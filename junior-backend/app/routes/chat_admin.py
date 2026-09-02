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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import uuid

from app.db import get_db
from app.kill_switches import raise_if_killed
from app.models import ChatMessage, CommunityChannel, User, utcnow
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


# ======================================================================
# Admin → user contact (2026-09-02 · User 360)
#
# NOT a new messaging system. Every Liquid Clips user already has (or
# gets idempotently provisioned, on first use) a private 1:1 "Message
# the Team" channel — `community.py::_get_or_create_support_channel`,
# slug `support-<user_id>`, `CommunityChannel.owner_user_id` set so
# chat.py's `_can_read`/`_can_access` already restrict it to that user
# + admins. The desktop app's own community screen already renders this
# channel for the user. This section only adds what was missing: an
# admin-authenticated (x-internal-secret + clerk_user_id, same as every
# other /admin/* route) way to read and POST into that SAME channel —
# reusing the ChatMessage/CommunityChannel tables directly rather than
# proxying through /chat/message's `Depends(current_user)` (a different,
# incompatible auth path for this server-to-server context).
# ======================================================================


def _get_or_create_support_channel_for_admin(db: Session, user: User) -> CommunityChannel:
    """Same provisioning as community.py's _get_or_create_support_channel
    — duplicated (not imported) because that function lives in a route
    module organised around the end-user request context, and importing
    across route modules for a 6-line idempotent upsert isn't worth the
    coupling. Keep both in sync if the schema changes."""
    slug = f"support-{user.id}"
    row = db.query(CommunityChannel).filter_by(slug=slug).one_or_none()
    if row is not None:
        return row
    row = CommunityChannel(
        slug=slug,
        name="Message the Team",
        purpose="Private line to Liquid Clips support — only you and the team can see this.",
        required_tier="free_paid",
        is_admin_only=False,
        is_locked_preview_enabled=True,
        section="announcements",
        sort_order=-1,
        owner_user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class SendAdminMessagePayload(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


@router.get("/users/{user_id}/messages", response_model=AdminChatMessagesOut)
def get_user_support_thread(
    user_id: str,
    _admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=300)] = 100,
) -> AdminChatMessagesOut:
    """The user's private support-channel thread, oldest-context-first
    read via the existing cross-channel admin view (list_messages_admin)
    scoped to their support-<id> channel. 404s if the user doesn't
    exist; an existing-but-silent user just gets an empty thread (the
    channel auto-provisions on first send, matching the user-side flow)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return list_messages_admin(
        _admin, db, channel=f"support-{user_id}", q=None, include_hidden=True, limit=limit
    )


@router.post("/users/{user_id}/messages", response_model=AdminChatMessageOut, status_code=201)
def send_admin_message(
    user_id: str,
    payload: SendAdminMessagePayload,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> AdminChatMessageOut:
    """Admin sends a message into this user's private support channel —
    the SAME channel their own desktop app's community screen shows as
    'Message the Team'. This is a real, live message the user will see
    and can reply to from their own client; it is not a separate admin-
    only mailbox. Respects the same community-chat kill switch as every
    other chat write so an incident freeze also freezes this path."""
    raise_if_killed("community_chat", feature_label="community chat")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    channel = _get_or_create_support_channel_for_admin(db, user)
    row = ChatMessage(
        id=uuid.uuid4().hex,
        user_id=admin.id,
        username=admin.handle or admin.email or "Liquid Clips Team",
        channel=channel.slug,
        content=payload.content,
        role="staff",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AdminChatMessageOut(
        id=row.id,
        user_id=row.user_id,
        username=row.username,
        channel=row.channel,
        content=row.content,
        role=row.role,
        pinned=row.pinned,
        hidden_at=None,
        hidden_by_user_id=None,
        hide_reason=None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )
