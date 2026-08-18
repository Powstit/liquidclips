"""In-process WebSocket fan-out for real-time chat + presence.

2026-08-17 — replaces 10-second polling as the live-update path for
Community chat. A plain in-memory manager is correct here (no Redis /
pub-sub needed) because `railway.json` pins `numReplicas: 1` for this
service — there is only ever one backend process, so every connected
client's socket lives in this same process's memory. If that ever
changes, this needs a shared broker instead.

Message *writes* still go through the existing sync REST endpoint
(`POST /chat/message`) so moderation, mute gates, and pin handling stay
in one place. That sync handler (running in FastAPI's threadpool)
schedules the fan-out onto the event loop that actually owns the open
WebSocket connections via `asyncio.run_coroutine_threadsafe` — the
`broadcast_message_threadsafe` / `broadcast_event_threadsafe` methods
below are the only thread-safe entry points; everything else assumes
it's already running on the event loop (true for the `/chat/ws` route
itself, which is async).
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


@dataclass
class Presence:
    user_id: str
    display_name: str
    role: str


class ChatConnectionManager:
    def __init__(self) -> None:
        self._channels: dict[str, dict[WebSocket, Presence]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        # 2026-08-17 · voice — who's in the mesh call per channel. Set of
        # user_ids, not connections: WebRTC signaling addresses peers by
        # user_id, and it keeps "am I in voice" a simple membership test.
        self._voice: dict[str, set[str]] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Called once from the FastAPI lifespan so sync request handlers
        (running in the threadpool, a different thread) can schedule a
        broadcast onto the actual event loop that owns the sockets."""
        self._loop = loop

    # ── connection lifecycle (must run on the event loop) ──────────────

    async def connect(self, channel: str, ws: WebSocket, presence: Presence) -> None:
        await ws.accept()
        self._channels.setdefault(channel, {})[ws] = presence
        await self._broadcast_presence(channel)

    async def disconnect(self, channel: str, ws: WebSocket) -> None:
        conns = self._channels.get(channel)
        presence = conns.get(ws) if conns else None
        if conns and ws in conns:
            del conns[ws]
            if not conns:
                self._channels.pop(channel, None)
        # A dropped socket while in voice must leave the call too — no
        # separate WS to catch this on otherwise (tab close, app crash,
        # network drop all land here).
        if presence is not None:
            await self._leave_voice_by_user(channel, presence.user_id)
        await self._broadcast_presence(channel)

    # ── voice — mesh call membership + signaling relay ─────────────────

    def voice_participants(self, channel: str) -> list[str]:
        return sorted(self._voice.get(channel, set()))

    async def _broadcast_voice_presence(self, channel: str) -> None:
        await self._broadcast(channel, {
            "type": "voice-presence",
            "channel": channel,
            "participants": self.voice_participants(channel),
        })

    async def join_voice(self, channel: str, user_id: str) -> None:
        self._voice.setdefault(channel, set()).add(user_id)
        await self._broadcast_voice_presence(channel)

    async def leave_voice(self, channel: str, user_id: str) -> None:
        await self._leave_voice_by_user(channel, user_id)
        await self._broadcast_voice_presence(channel)

    async def _leave_voice_by_user(self, channel: str, user_id: str) -> None:
        participants = self._voice.get(channel)
        if participants and user_id in participants:
            participants.discard(user_id)
            if not participants:
                self._voice.pop(channel, None)

    async def send_to_user(self, channel: str, target_user_id: str, payload: dict[str, Any]) -> bool:
        """Relay a signaling message to ONE specific peer (not a
        broadcast) — WebRTC offer/answer/ICE exchange is inherently
        peer-addressed. Returns False if that user isn't connected to
        this channel right now (caller can no-op; a stale target is not
        an error, just a peer who already left)."""
        conns = self._channels.get(channel, {})
        for ws, presence in conns.items():
            if presence.user_id == target_user_id:
                try:
                    await ws.send_text(json.dumps(payload, default=str))
                    return True
                except Exception:
                    return False
        return False

    def online_count(self, channel: str) -> int:
        return len(self._channels.get(channel, {}))

    def online_users(self, channel: str) -> list[dict[str, Any]]:
        return [
            {"user_id": p.user_id, "display_name": p.display_name, "role": p.role}
            for p in self._channels.get(channel, {}).values()
        ]

    async def broadcast_typing(
        self, channel: str, user_id: str, display_name: str, is_typing: bool
    ) -> None:
        """Ephemeral — no persistence, mirrors presence/voice. Broadcast to
        everyone in the channel including the sender; the client filters
        out its own user_id (same pattern as reaction/voice-presence)."""
        await self._broadcast(channel, {
            "type": "typing",
            "channel": channel,
            "user_id": user_id,
            "display_name": display_name,
            "is_typing": is_typing,
        })

    async def _broadcast_presence(self, channel: str) -> None:
        await self._broadcast(channel, {
            "type": "presence",
            "channel": channel,
            "online_count": self.online_count(channel),
            "online_users": self.online_users(channel),
        })

    async def _broadcast(self, channel: str, payload: dict[str, Any]) -> None:
        conns = list(self._channels.get(channel, {}).keys())
        if not conns:
            return
        text = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._channels.get(channel, {}).pop(ws, None)

    # ── thread-safe entry points (call from sync/threadpool code) ──────

    def broadcast_message_threadsafe(self, channel: str, message: dict[str, Any]) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._broadcast(channel, {"type": "message", "channel": channel, "data": message}),
            self._loop,
        )

    def broadcast_event_threadsafe(self, channel: str, event_type: str, data: dict[str, Any]) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._broadcast(channel, {"type": event_type, "channel": channel, "data": data}),
            self._loop,
        )


manager = ChatConnectionManager()
