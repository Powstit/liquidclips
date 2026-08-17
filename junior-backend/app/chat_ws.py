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
        if conns and ws in conns:
            del conns[ws]
            if not conns:
                self._channels.pop(channel, None)
        await self._broadcast_presence(channel)

    def online_count(self, channel: str) -> int:
        return len(self._channels.get(channel, {}))

    def online_users(self, channel: str) -> list[dict[str, Any]]:
        return [
            {"user_id": p.user_id, "display_name": p.display_name, "role": p.role}
            for p in self._channels.get(channel, {}).values()
        ]

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
