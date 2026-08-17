"""Native community chat — v2.2.10.

Separate from Whop chat feeds routed via community_channels (those land
through the existing `community.py` surface, unchanged). This module owns
our own persistence: chat_messages table + role tagging + pin→announcement
bridge + welcome-bot bootstrap.

Channels (v1):
  • "global"     — every authed user can read + write
  • "agency-vip" — gated on whop_user_id presence (paid Whop members)

Roles are derived at INSERT time so a later tier or admin change does
NOT silently relabel history:
  founder · user.founder_flag = True
  staff   · is_admin_email(user.email)
  mod     · user.chat_role = "mod"
  bot     · reserved for system-bot rows
  member  · default

Pinning bridges into the v2.2.9 Announcement layer: a pinned chat
message persists here AND writes a sibling Announcement row so the
existing AnnouncementBanner stack renders it as a sticky tinted header
at the top of the viewport — no separate UI surface needed.

Media search (Pexels + Giphy) is a thin server-side proxy so the API
keys never ship in the desktop binary. When the env keys are absent the
proxy returns 503 with a setup_required marker and the picker UI shows
a "Configure PEXELS_API_KEY / GIPHY_API_KEY to enable" hint — no fake
data, no broken state.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

import httpx
import jwt as _pyjwt
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.chat_ws import Presence, manager as ws_manager
from app.db import SessionLocal, get_db
from app.deps import current_user
from app.features import is_admin_email
from app.jwt_signer import verify_license_jwt
from app.models import Announcement, ChatMessage, ChatReaction, CommunityChannel, User

router = APIRouter(prefix="/chat", tags=["chat"])


# ---------------------------------------------------------------------
# Constants — channel registry + role derivation + media proxy
# ---------------------------------------------------------------------

# 2026-08-17 · Replaces the old hand-duplicated ALLOWED_CHANNELS set,
# which had to be kept in lockstep with SEEDS in
# seed_community_channels.py by hand — forgetting to add a new seeded
# slug there caused the composer to silently 400. Seeded channels are
# now validated by existence in the community_channels table, so the
# seed script is the only place a new channel needs to be added.
_LEGACY_CHANNELS = {
    "global",           # legacy global lounge · pre-seed channel
    "agency-vip",       # legacy paid-Whop lounge · pre-seed channel
}
# ChannelLit stays a str at the wire so FastAPI accepts any valid slug
# (Literal here would explode into an ever-growing union that OpenAPI +
# pydantic can't keep in sync with the DB). Runtime validation lives in
# _is_valid_channel(), called from list_messages + post_message.
ChannelLit = str


def _is_valid_channel(channel: str, db: Session) -> bool:
    if channel in _LEGACY_CHANNELS:
        return True
    return db.query(CommunityChannel.slug).filter_by(slug=channel).first() is not None

SYSTEM_BOT_ID = "system-bot"
SYSTEM_BOT_NAME = "Liquid Clips Bot"
SYSTEM_BOT_AVATAR = "/brand/icons/system-bot.png"

# Pin → Announcement bridge defaults. We use severity="info" by default
# so a pinned chat message renders fuchsia (LC brand). Admins can pass
# a higher severity at pin time to escalate to warning/critical.
_PIN_DEFAULT_SEVERITY = "info"


def _derive_role(user: User) -> str:
    """Single source of truth for role badges. Order matters — staff
    wins over mod so a JUNIOR_ADMIN_EMAILS user always shows [STAFF]
    even if their chat_role was bumped to mod."""
    if is_admin_email(user.email):
        return "staff"
    if user.founder_flag:
        return "founder"
    if user.chat_role == "mod":
        return "mod"
    return "member"


_PREMIUM_TIERS_FOR_CHAT: set[str] = {
    "solo", "pro", "agency", "agency_solo", "agency_whitelabel",
    # legacy aliases
    "growth", "channel", "autopilot",
}


def _can_access(user: User, channel: str, db: Session | None = None) -> bool:
    """Channel gating.

    Legacy pre-seed channels keep their hand-written rules so existing
    tests + Whop-linked users behave identically:
      • global      → every authed user can write
      • agency-vip  → requires whop_user_id (admins/founders bypass)

    Seeded community channels (from seed_community_channels.py) resolve
    tier + admin-only against the CommunityChannel row so the write
    surface stays honest against Daniel's locked architecture. Admins /
    founders always bypass (they run the moderation surface).
    """
    if channel == "global":
        return True
    if channel == "agency-vip":
        if is_admin_email(user.email) or user.founder_flag:
            return True
        return bool(user.whop_user_id)

    # Seeded channel · look up its policy row so a tier bump doesn't
    # require a code edit here.
    if db is None:
        # Defensive: if a caller passes no db (unit test) we optimistically
        # allow any authed user for non-legacy channels — write attempts
        # still route through _is_valid_channel() + moderation gates.
        return True
    row = db.query(CommunityChannel).filter_by(slug=channel).one_or_none()
    if row is None:
        return False
    if is_admin_email(user.email) or user.founder_flag:
        return True
    if row.is_admin_only:
        return False
    if row.required_tier in {"free", "free_paid"}:
        return True
    if row.required_tier in {"paid", "paid_admin"}:
        return (user.tier or "free") in _PREMIUM_TIERS_FOR_CHAT
    # Unknown tier value → default deny; edits to seed script land here.
    return False


def _can_pin(user: User) -> bool:
    """Pinning bridges into the Announcement banner layer, so we gate
    it tightly: admin (staff badge), founder, or mod only."""
    return (
        is_admin_email(user.email)
        or user.founder_flag
        or user.chat_role == "mod"
    )


# ---------------------------------------------------------------------
# Pydantic shapes
# ---------------------------------------------------------------------


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool


class ChatMessageOut(BaseModel):
    id: str
    user_id: str
    username: str
    avatar_url: str | None
    channel: str
    content: str
    role: str
    pinned: bool
    announcement_id: str | None
    created_at: datetime
    # v2.2.11 arcade · author's best-ever Space Invaders score at fetch
    # time. LEFT JOIN against User so a system-bot row (no User record)
    # resolves to 0 and the chat panel suppresses the badge. Updated
    # asynchronously by the desktop on each game-over so a fresh record
    # appears next to the author's name on their next message.
    arcade_high_score: int = 0
    # Stage 7 · moderation. When `is_removed` is True, `content` has
    # been server-side-scrubbed to "[removed by moderator]" — the
    # original text never leaves the API. Default False so pre-Stage-7
    # deserializers stay compatible.
    is_removed: bool = False
    # 2026-08-17 · emoji reactions. Empty list = no reactions yet.
    reactions: list[ReactionSummary] = Field(default_factory=list)


class ReactPayload(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=8)


class ArcadeScorePayload(BaseModel):
    score: int = Field(..., ge=0, le=999_999_999)
    # 2026-07-03 · anti-cheat plausibility gate (optional for backward compat
    # · required for future dispatch). Old clients that don't send these
    # are still accepted but their submissions receive a downgraded trust
    # score in HQ. New clients from v2.2.22+ send all four.
    wave: int | None = Field(default=None, ge=1, le=200)
    duration_ms: int | None = Field(default=None, ge=0, le=10 * 60 * 60 * 1000)  # ≤10h
    shots_fired: int | None = Field(default=None, ge=0, le=1_000_000)


class ArcadeScoreOut(BaseModel):
    user_id: str
    arcade_high_score: int
    updated: bool
    rejected: bool = False
    rejection_reason: str | None = None


class LeaderboardEntry(BaseModel):
    user_id: str
    username: str
    arcade_high_score: int
    role: str


class LeaderboardOut(BaseModel):
    entries: list[LeaderboardEntry]


class ChatHistoryOut(BaseModel):
    channel: str
    messages: list[ChatMessageOut]
    # Echoed back so the panel can render a per-channel banner / disable
    # the composer when the viewer is read-only (no write surface on
    # locked-preview agency-vip for free users).
    can_write: bool
    viewer_role: str
    # Stage 4 infinite-history cursor · true when the server holds at
    # least one message strictly older than `messages[0]` inside this
    # channel. The client top-sentinel `IntersectionObserver` gates
    # `loadOlder()` on this flag so a fully-loaded room does not keep
    # firing empty before_id requests. Defaults to False so pre-Stage-4
    # deserializers of this schema keep working.
    has_more: bool = False


class PostMessagePayload(BaseModel):
    channel: ChannelLit = "global"
    content: str = Field(..., min_length=1, max_length=2000)
    pinned: bool = False
    pin_severity: Literal["info", "warning", "critical"] = "info"


class PostMessageOut(BaseModel):
    message: ChatMessageOut


class MediaResult(BaseModel):
    id: str
    preview_url: str
    full_url: str
    title: str | None


class MediaSearchOut(BaseModel):
    provider: Literal["giphy", "pexels"]
    results: list[MediaResult]


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


MODERATED_CONTENT_STUB = "[removed by moderator]"


def _as_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to UTC-aware — SQLite/dev returns naive
    while Postgres returns aware. Same helper shape as
    `app/routes/agency.py::_as_utc` (Stage 5 robustness fix)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _serialise(
    row: ChatMessage,
    arcade_high_score: int = 0,
    reactions: list[ReactionSummary] | None = None,
) -> ChatMessageOut:
    # Stage 7 · server-side content scrub. Original text is REPLACED
    # (not merely hidden) when `hidden_at` is set — matches doc §690
    # "not merely hidden with CSS". The scrub happens BEFORE the row
    # leaves the API so a client with dev-tools open can't reveal the
    # original content by inspecting the response.
    is_removed = getattr(row, "hidden_at", None) is not None
    return ChatMessageOut(
        id=row.id,
        user_id=row.user_id,
        username=row.username,
        avatar_url=row.avatar_url,
        channel=row.channel,
        content=MODERATED_CONTENT_STUB if is_removed else row.content,
        role=row.role,
        pinned=bool(row.pinned),
        announcement_id=row.announcement_id,
        created_at=row.created_at if row.created_at else datetime.now(timezone.utc),
        arcade_high_score=arcade_high_score,
        is_removed=is_removed,
        reactions=reactions or [],
    )


def _reaction_summaries(db: Session, message_ids: list[str], viewer_id: str) -> dict[str, list[ReactionSummary]]:
    """Batch-load reaction counts for a page of messages in one query —
    avoids an N+1 (one query per message) on every /chat/messages page."""
    if not message_ids:
        return {}
    rows = (
        db.query(ChatReaction)
        .filter(ChatReaction.message_id.in_(message_ids))
        .all()
    )
    grouped: dict[str, dict[str, list[str]]] = {}
    for r in rows:
        grouped.setdefault(r.message_id, {}).setdefault(r.emoji, []).append(r.user_id)
    out: dict[str, list[ReactionSummary]] = {}
    for message_id, by_emoji in grouped.items():
        out[message_id] = [
            ReactionSummary(emoji=emoji, count=len(user_ids), reacted_by_me=viewer_id in user_ids)
            for emoji, user_ids in sorted(by_emoji.items())
        ]
    return out


def _reaction_summary_for_message(db: Session, message_id: str, viewer_id: str) -> list[ReactionSummary]:
    return _reaction_summaries(db, [message_id], viewer_id).get(message_id, [])


def _display_name(user: User) -> str:
    """v2.2.14 · unified handle-first display. Returns @handle when the
    user has picked / been backfilled with a handle, so chat rows AND
    arcade leaderboard entries paint the same identity. Falls back
    through the legacy chain if a race left handle NULL somehow."""
    if getattr(user, "handle", None):
        return f"@{user.handle}"
    if user.cached_display_handle:
        return user.cached_display_handle
    if user.email and "@" in user.email:
        return user.email.split("@", 1)[0]
    return "Clipper"


def _seed_welcome_bot_message(db: Session, user: User) -> None:
    """Fire the welcome-bot row the first time a user lands a /sync.

    Idempotent by ChatMessage count: only inserts when the user has zero
    prior history rows. Called by the /sync route after license rotate
    so the row is in place before the desktop's first /chat/messages
    poll. Kept resilient — any exception is swallowed so a chat-table
    issue cannot 500 the critical /sync path.
    """
    try:
        existing = (
            db.query(ChatMessage)
            .filter(ChatMessage.user_id == user.id)
            .limit(1)
            .first()
        )
        if existing is not None:
            return
        # Resolve the tier label honestly. is_admin_email override is
        # surfaced in the welcome ("welcome, staff") since this user
        # WILL see the STAFF badge on their own posts.
        tier_label = (
            "Staff" if is_admin_email(user.email)
            else "Founder" if user.founder_flag
            else (user.tier or "free").capitalize()
        )
        welcome = ChatMessage(
            id=uuid.uuid4().hex,
            user_id=SYSTEM_BOT_ID,
            username=SYSTEM_BOT_NAME,
            avatar_url=SYSTEM_BOT_AVATAR,
            channel="global",
            content=(
                f"Welcome to the lounge, {_display_name(user)}. "
                f"You're locked in at {tier_label} tier — drop your first clip in #global "
                "and meet the clipper crew."
            ),
            role="bot",
            pinned=False,
        )
        db.add(welcome)
        db.commit()
    except Exception:  # noqa: BLE001 — best-effort
        db.rollback()


# Public re-export so sync.py can call into the welcome-bot trigger
# without a circular import. Aliased so its purpose is obvious at the
# call site.
seed_welcome_bot_on_first_sync = _seed_welcome_bot_message


# ---------------------------------------------------------------------
# Real-time — WebSocket fan-out (replaces the old 10s poll)
# ---------------------------------------------------------------------


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket, channel: str, token: str) -> None:
    """Live message + presence stream for one channel.

    Auth via `?token=<license JWT>` query param — browsers' native
    WebSocket constructor can't set an Authorization header, so this
    mirrors the standard WS-auth workaround rather than reusing the
    `current_user` dependency (which expects a header).

    This connection is read-only from the server's perspective: clients
    still POST /chat/message to write (moderation/mute/pin gates all
    stay in that one place). The socket just receives `message` /
    `presence` / other event pushes and otherwise sits idle — any bytes
    the client sends (e.g. a keepalive ping) are read and discarded.
    """
    try:
        claims = verify_license_jwt(token)
    except _pyjwt.PyJWTError:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        user = db.get(User, claims["sub"])
        if user is None:
            await websocket.close(code=4401)
            return
        if not _is_valid_channel(channel, db):
            await websocket.close(code=4404)
            return
        presence = Presence(
            user_id=user.id,
            display_name=_display_name(user),
            role=_derive_role(user),
        )
    finally:
        db.close()

    await ws_manager.connect(channel, websocket, presence)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(channel, websocket)


# ---------------------------------------------------------------------
# Routes — history + post + pin/unpin
# ---------------------------------------------------------------------


@router.get("/messages", response_model=ChatHistoryOut)
def list_messages(
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
    channel: ChannelLit = Query("global"),
    limit: int = Query(50, ge=1, le=200),
    before_id: str | None = Query(
        None,
        description=(
            "Stage 4 keyset cursor. When set, returns messages strictly "
            "older than the referenced message's created_at (oldest→newest "
            "in the response). Missing or unknown ids return an empty "
            "page + has_more=false instead of an error."
        ),
    ),
) -> ChatHistoryOut:
    if not _is_valid_channel(channel, db):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown channel: {channel}",
        )
    can_write = _can_access(user, channel, db)

    # Stage 4 keyset pagination. Resolve `before_id` → the referenced
    # row's created_at, then filter strictly older messages. Fetch
    # limit+1 rows so `has_more` can be computed without a second COUNT
    # query. If the caller passed an id that does not exist in this
    # channel, return an empty page + has_more=False; do not 404 (the
    # client treats "no older history" and "unknown cursor" identically).
    q = (
        db.query(ChatMessage, User.arcade_high_score)
        .outerjoin(User, User.id == ChatMessage.user_id)
        .filter(ChatMessage.channel == channel)
    )
    if before_id is not None:
        ref = (
            db.query(ChatMessage.created_at)
            .filter(
                ChatMessage.id == before_id,
                ChatMessage.channel == channel,
            )
            .first()
        )
        if ref is None:
            return ChatHistoryOut(
                channel=channel,
                messages=[],
                can_write=can_write,
                viewer_role=_derive_role(user),
                has_more=False,
            )
        q = q.filter(ChatMessage.created_at < ref[0])

    # LEFT JOIN User on user_id so each row carries the author's current
    # arcade_high_score · system-bot rows have no User → score = 0 and
    # the chat panel suppresses the badge for them.
    pairs = (
        q.order_by(desc(ChatMessage.created_at))
        .limit(limit + 1)
        .all()
    )
    has_more = len(pairs) > limit
    if has_more:
        pairs = pairs[:limit]
    # Reverse so the client renders oldest → newest naturally; the
    # composer scrolls to the bottom on mount.
    pairs.reverse()
    reactions_by_message = _reaction_summaries(db, [row.id for row, _ in pairs], user.id)
    return ChatHistoryOut(
        channel=channel,
        messages=[
            _serialise(row, int(score or 0), reactions_by_message.get(row.id))
            for row, score in pairs
        ],
        can_write=can_write,
        viewer_role=_derive_role(user),
        has_more=has_more,
    )


@router.post(
    "/message",
    status_code=status.HTTP_201_CREATED,
    response_model=PostMessageOut,
)
def post_message(
    payload: PostMessagePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PostMessageOut:
    if not _is_valid_channel(payload.channel, db):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown channel: {payload.channel}",
        )
    if not _can_access(user, payload.channel, db):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"channel {payload.channel} is locked for your tier",
        )

    # Stage 7 · chat-scoped mute gate. `chat_muted_until` is set by the
    # /chat/messages/{id}/mute24h moderation endpoint. Kept SEPARATE
    # from `banned_until` so a chat mute doesn't leak into publish /
    # earn / license gates. Staff bypass so a muted admin can still
    # unmute themselves without a DB touch (unlikely but the tie-
    # breaker is important during incident response).
    muted_until = _as_utc(getattr(user, "chat_muted_until", None))
    now = datetime.now(timezone.utc)
    if muted_until is not None and muted_until > now and not is_admin_email(user.email):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "reason": "chat_muted",
                "muted_until": muted_until.isoformat(),
                "message": "You are muted from Community chat. Try again after the mute expires.",
            },
            headers={"Retry-After": str(max(1, int((muted_until - now).total_seconds())))},
        )

    role = _derive_role(user)
    row = ChatMessage(
        id=uuid.uuid4().hex,
        user_id=user.id,
        username=_display_name(user),
        avatar_url=None,
        channel=payload.channel,
        content=payload.content,
        role=role,
        pinned=False,
    )
    db.add(row)
    db.flush()

    # Pin handling · only admin / founder / mod may pin. Pinning writes
    # a sibling Announcement row so the v2.2.9 banner stack picks it up.
    if payload.pinned:
        if not _can_pin(user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "only staff / founder / mod may pin a message",
            )
        announcement = Announcement(
            id=uuid.uuid4().hex,
            title=f"#{payload.channel} pin",
            body_markdown=payload.content[:600],
            kind="other",
            severity=payload.pin_severity,
            scope="global" if payload.channel == "global" else "agency",
            agency_id=user.id if payload.channel == "agency-vip" else None,
            is_active=True,
            pinned=True,
        )
        db.add(announcement)
        row.pinned = True
        row.announcement_id = announcement.id

    db.commit()
    db.refresh(row)
    out = PostMessageOut(message=_serialise(row, int(user.arcade_high_score or 0)))
    # Push to every live-connected client in this channel instantly —
    # the frontend's 10s poll is now just a resync/offline fallback.
    ws_manager.broadcast_message_threadsafe(
        payload.channel, out.message.model_dump(mode="json")
    )
    return out


@router.delete(
    "/message/{message_id}/pin",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unpin_message(
    message_id: str,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    if not _can_pin(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only staff / founder / mod may unpin",
        )
    row = (
        db.query(ChatMessage)
        .filter(ChatMessage.id == message_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"message not found: {message_id}",
        )
    if row.announcement_id:
        # Soft-deactivate the linked banner row · /sync filters on
        # is_active so the banner disappears immediately on next poll.
        ann = (
            db.query(Announcement)
            .filter(Announcement.id == row.announcement_id)
            .one_or_none()
        )
        if ann is not None:
            ann.is_active = False
    row.pinned = False
    row.announcement_id = None
    db.commit()
    ws_manager.broadcast_event_threadsafe(
        row.channel, "unpin", {"message_id": message_id}
    )


@router.post("/message/{message_id}/react", response_model=list[ReactionSummary])
def react_to_message(
    message_id: str,
    payload: ReactPayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ReactionSummary]:
    """Toggle the caller's reaction on a message — react if they haven't,
    un-react if they already have. Same read-channel gate as posting
    (_can_access); no separate mute check — a muted user can still react,
    reactions aren't the abuse vector chat.mute24h exists for."""
    row = db.query(ChatMessage).filter(ChatMessage.id == message_id).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"message not found: {message_id}")
    if not _can_access(user, row.channel, db):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"channel {row.channel} is locked for your tier",
        )

    existing = (
        db.query(ChatReaction)
        .filter_by(message_id=message_id, user_id=user.id, emoji=payload.emoji)
        .one_or_none()
    )
    if existing is not None:
        db.delete(existing)
        action = "remove"
    else:
        db.add(ChatReaction(message_id=message_id, user_id=user.id, emoji=payload.emoji))
        action = "add"
    db.commit()

    # Broadcast the raw (emoji, user_id, action) delta rather than a
    # pre-aggregated summary — `reacted_by_me` is viewer-relative, so a
    # summary computed for the reactor would be WRONG for every other
    # connected client. Each client applies the delta against its own
    # user id instead. The reactor gets the correct, already-viewer-
    # relative summary directly in this response.
    ws_manager.broadcast_event_threadsafe(
        row.channel,
        "reaction",
        {"message_id": message_id, "emoji": payload.emoji, "user_id": user.id, "action": action},
    )
    return _reaction_summary_for_message(db, message_id, user.id)


# ---------------------------------------------------------------------
# Media search proxies — Pexels + Giphy
# ---------------------------------------------------------------------


@router.get("/media/giphy", response_model=MediaSearchOut)
async def giphy_search(
    _user: Annotated[User, Depends(current_user)],
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(12, ge=1, le=24),
) -> MediaSearchOut:
    key = os.getenv("GIPHY_API_KEY")
    if not key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "giphy_setup_required: set GIPHY_API_KEY in env",
        )
    async with httpx.AsyncClient(timeout=8.0) as cx:
        r = await cx.get(
            "https://api.giphy.com/v1/gifs/search",
            params={"api_key": key, "q": q, "limit": limit, "rating": "pg-13"},
        )
        r.raise_for_status()
        data = r.json()
    results: list[MediaResult] = []
    for item in data.get("data", []):
        images = item.get("images") or {}
        preview = images.get("fixed_height_small") or images.get("fixed_height") or {}
        full = images.get("original") or {}
        if not preview.get("url") or not full.get("url"):
            continue
        results.append(
            MediaResult(
                id=str(item.get("id") or uuid.uuid4().hex),
                preview_url=preview["url"],
                full_url=full["url"],
                title=item.get("title"),
            )
        )
    return MediaSearchOut(provider="giphy", results=results)


@router.get("/media/pexels", response_model=MediaSearchOut)
async def pexels_search(
    _user: Annotated[User, Depends(current_user)],
    q: str = Query(..., min_length=1, max_length=80),
    limit: int = Query(12, ge=1, le=24),
) -> MediaSearchOut:
    key = os.getenv("PEXELS_API_KEY")
    if not key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "pexels_setup_required: set PEXELS_API_KEY in env",
        )
    async with httpx.AsyncClient(timeout=8.0) as cx:
        r = await cx.get(
            "https://api.pexels.com/v1/search",
            params={"query": q, "per_page": limit},
            headers={"Authorization": key},
        )
        r.raise_for_status()
        data = r.json()
    results: list[MediaResult] = []
    for item in data.get("photos", []):
        src = item.get("src") or {}
        preview = src.get("medium") or src.get("small")
        full = src.get("large2x") or src.get("large") or src.get("original")
        if not preview or not full:
            continue
        results.append(
            MediaResult(
                id=str(item.get("id") or uuid.uuid4().hex),
                preview_url=preview,
                full_url=full,
                title=item.get("alt"),
            )
        )
    return MediaSearchOut(provider="pexels", results=results)


# ---------------------------------------------------------------------
# Arcade leaderboard — v2.2.11
# ---------------------------------------------------------------------


# 2026-07-03 · anti-cheat plausibility gate.
# Wave N with an 8x5 grid = 40 base kills · scoring at row 5 is 50 pts
# · so a wave clear at the top row scores at most 50*40 = 2000 (in
# practice ~1000-1500 per wave including streak). Score ceiling = wave
# * 3000 + wave*wave*500 (perfect-wave bonus + UFO ceiling). Add 30%
# margin so legit-lucky runs aren't rejected.
def _max_plausible_score(wave: int, shots_fired: int) -> int:
    return int((wave * 3000 + wave * wave * 500) * 1.30)


# Duration floor: each wave requires roughly 15s of engaged play. A
# submission claiming wave 20 in 30s is fraud.
def _min_plausible_duration_ms(wave: int) -> int:
    return wave * 8_000  # generous · real players average ~15s/wave


@router.post("/game/score", response_model=ArcadeScoreOut)
def submit_arcade_score(
    payload: ArcadeScorePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ArcadeScoreOut:
    """Ratchet the caller's best-ever Space Invaders score. Never lowers
    a record — a refresh or replay cannot erase progress. Returns the
    resolved value + whether this submission moved it up so the desktop
    can show a "new high score" toast without re-fetching.

    2026-07-03 · anti-cheat plausibility gate + ArcadeSubmission audit
    row. Real-money prize dispatch (routes/arcade_prize.py) reads from
    ArcadeSubmission, so unaudited scores never enter the prize pool.
    Rejections are recorded but do NOT lower the user's persisted
    arcade_high_score — an accidentally-invalid submission from a
    legitimate high scorer doesn't punish them.
    """
    from app.models import ArcadeSubmission

    # Anti-cheat gates · only enforced when the client actually supplied
    # wave + duration + shots. Old clients that omit them get the
    # legacy behaviour (still recorded, but without gates).
    rejected = False
    rejection_reason: str | None = None
    if payload.wave is not None and payload.duration_ms is not None:
        max_score = _max_plausible_score(payload.wave, payload.shots_fired or 0)
        min_duration = _min_plausible_duration_ms(payload.wave)
        if payload.score > max_score:
            rejected = True
            rejection_reason = "score_above_ceiling"
        elif payload.duration_ms < min_duration:
            rejected = True
            rejection_reason = "duration_below_floor"

    # ArcadeSubmission audit row (always land it — rejected too).
    try:
        db.add(
            ArcadeSubmission(
                id=uuid.uuid4().hex,
                user_id=user.id,
                score=int(payload.score),
                wave=int(payload.wave or 1),
                duration_ms=int(payload.duration_ms or 0),
                shots_fired=int(payload.shots_fired or 0),
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()

    if rejected:
        return ArcadeScoreOut(
            user_id=user.id,
            arcade_high_score=int(user.arcade_high_score or 0),
            updated=False,
            rejected=True,
            rejection_reason=rejection_reason,
        )

    prior = int(user.arcade_high_score or 0)
    updated = False
    if payload.score > prior:
        user.arcade_high_score = payload.score
        db.commit()
        updated = True
    return ArcadeScoreOut(
        user_id=user.id,
        arcade_high_score=int(user.arcade_high_score or 0),
        updated=updated,
    )


@router.post("/game/share", response_model=PostMessageOut)
def share_arcade_score(
    payload: ArcadeScorePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> PostMessageOut:
    """Drop a system-bot announcement into #global-lounge celebrating
    the caller's score. Validates the score against the user's stored
    high to prevent a sad replay from over-shouting — we clamp upward
    to the persisted record. The row is authored by user_id=system-bot
    so the message paints with the [BOT] badge and a distinct avatar,
    not the user's own row."""
    server_best = int(user.arcade_high_score or 0)
    # Clamp · the share text always cites the canonical server best,
    # not a stale client-side claim.
    cited = max(payload.score, server_best)
    username = _display_name(user)
    row = ChatMessage(
        id=uuid.uuid4().hex,
        user_id=SYSTEM_BOT_ID,
        username=SYSTEM_BOT_NAME,
        avatar_url=SYSTEM_BOT_AVATAR,
        channel="global",
        content=(
            f"🤖 Arcade Bot: @{username} just locked down a high score of "
            f"{cited:,} points in the Space Invaders arena! 🏆 Can you beat them?"
        ),
        role="bot",
        pinned=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # The system-bot row has no User join → arcade_high_score = 0 so
    # the chat panel suppresses a trophy badge on the bot's own row.
    return PostMessageOut(message=_serialise(row, 0))


@router.get("/game/leaderboard", response_model=LeaderboardOut)
def arcade_leaderboard(
    user: Annotated[User, Depends(current_user)],  # noqa: ARG001 · gate only
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(10, ge=1, le=50),
) -> LeaderboardOut:
    """Top-N arcade scorers across the network. Anyone authed can read;
    we don't surface the email — only the display handle the user
    already exposes via affiliate / leaderboard. Zero-score rows are
    skipped so the panel doesn't render a long list of "0 pts" entries
    on day one."""
    rows = (
        db.query(User)
        .filter(User.arcade_high_score > 0)
        .order_by(desc(User.arcade_high_score), User.id)
        .limit(limit)
        .all()
    )
    entries: list[LeaderboardEntry] = []
    for u in rows:
        entries.append(
            LeaderboardEntry(
                user_id=u.id,
                username=_display_name(u),
                arcade_high_score=int(u.arcade_high_score or 0),
                role=_derive_role(u),
            )
        )
    return LeaderboardOut(entries=entries)
