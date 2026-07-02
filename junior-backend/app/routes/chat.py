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
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import current_user
from app.features import is_admin_email
from app.models import Announcement, ChatMessage, User

router = APIRouter(prefix="/chat", tags=["chat"])


# ---------------------------------------------------------------------
# Constants — channel registry + role derivation + media proxy
# ---------------------------------------------------------------------

ALLOWED_CHANNELS = {"global", "agency-vip"}
ChannelLit = Literal["global", "agency-vip"]

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


def _can_access(user: User, channel: str) -> bool:
    """Channel gating. global = every authed user. agency-vip requires
    a linked whop_user_id (i.e. the user signed in via Whop and their
    paid subscription is reflected on our side). Admins bypass."""
    if channel == "global":
        return True
    if channel == "agency-vip":
        if is_admin_email(user.email) or user.founder_flag:
            return True
        return bool(user.whop_user_id)
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


class ArcadeScorePayload(BaseModel):
    score: int = Field(..., ge=0, le=999_999_999)


class ArcadeScoreOut(BaseModel):
    user_id: str
    arcade_high_score: int
    updated: bool


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


def _serialise(row: ChatMessage, arcade_high_score: int = 0) -> ChatMessageOut:
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
    )


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
    if channel not in ALLOWED_CHANNELS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown channel: {channel}",
        )
    can_write = _can_access(user, channel)

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
    return ChatHistoryOut(
        channel=channel,
        messages=[_serialise(row, int(score or 0)) for row, score in pairs],
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
    if payload.channel not in ALLOWED_CHANNELS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"unknown channel: {payload.channel}",
        )
    if not _can_access(user, payload.channel):
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
    return PostMessageOut(message=_serialise(row, int(user.arcade_high_score or 0)))


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


@router.post("/game/score", response_model=ArcadeScoreOut)
def submit_arcade_score(
    payload: ArcadeScorePayload,
    user: Annotated[User, Depends(current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ArcadeScoreOut:
    """Ratchet the caller's best-ever Space Invaders score. Never lowers
    a record — a refresh or replay cannot erase progress. Returns the
    resolved value + whether this submission moved it up so the desktop
    can show a "new high score" toast without re-fetching."""
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
