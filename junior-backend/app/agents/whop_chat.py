"""WhopChatAgent · single-key persona that lives in a Whop community room.

Each agent runs as one asyncio.Task. The fleet is launched at app startup
(via start_agent_fleet) when WHOP_AGENT_ENABLED=true and WHOP_AGENT_KEYS
is populated. Agents tick on a configurable interval, polling assigned
rooms for new messages, replying to mentions, and occasionally posting
proactive welcome / activity messages.

Daniel's brief 2026-06-24:
  "100 whop agents that manage chat room conversations and simulate the
  load on the system its needed. I will give you agent keys when we get
  into whop but wire it up so you have it deploy."

This module is the wire. Real keys + real persona definitions land later.
The agent shape is generic enough that swapping personas is one config
change, not a code rewrite.

⚠ DEFAULTS TO DISABLED. WHOP_AGENT_ENABLED env var must be "true" to start.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

_log = logging.getLogger("junior.agents.whop_chat")


# ──────── Config (env-driven) ──────────────────────────────────────────


def _bool_env(name: str, default: bool = False) -> bool:
    v = os.environ.get(name, "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off", ""):
        return default
    return default


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _load_agent_keys() -> list[str]:
    """Parse WHOP_AGENT_KEYS env var. Supports JSON array OR
    newline-separated. Empty / missing → empty list (fleet doesn't start)."""
    raw = os.environ.get("WHOP_AGENT_KEYS", "").strip()
    if not raw:
        return []
    # JSON array form
    if raw.startswith("["):
        import json
        try:
            parsed = json.loads(raw)
            return [str(k).strip() for k in parsed if str(k).strip()]
        except (json.JSONDecodeError, TypeError):
            _log.warning("WHOP_AGENT_KEYS looked like JSON but failed to parse · falling back to newline-split")
    # Newline / comma form
    keys = [k.strip() for k in raw.replace(",", "\n").splitlines() if k.strip()]
    return keys


# Public config snapshot · read once at startup
AGENT_ENABLED = _bool_env("WHOP_AGENT_ENABLED", default=False)
AGENT_TICK_SECONDS = _int_env("WHOP_AGENT_TICK_SECONDS", 30)
AGENT_REPLY_DELAY_MIN_MS = _int_env("WHOP_AGENT_REPLY_DELAY_MS_MIN", 1_500)
AGENT_REPLY_DELAY_MAX_MS = _int_env("WHOP_AGENT_REPLY_DELAY_MS_MAX", 4_500)

# Whop REST chat endpoints (placeholders · confirm exact paths once Whop
# documentation is paired with the real API keys). Kept as constants so a
# single edit retargets the entire fleet.
WHOP_API_BASE = "https://api.whop.com"
WHOP_CHAT_LIST_MESSAGES = "/api/v1/channels/{channel_id}/messages"
WHOP_CHAT_POST_MESSAGE = "/api/v1/channels/{channel_id}/messages"
WHOP_CHAT_LIST_CHANNELS = "/api/v1/channels"


# ──────── Per-agent runtime state ──────────────────────────────────────


@dataclass
class WhopChatAgent:
    """One agent · one key · one live asyncio.Task.

    Holds its own httpx session for connection pooling. Tracks last-seen
    message timestamps per channel so polling is incremental. Honors a
    stop_event so the lifespan shutdown can cleanly cancel."""

    agent_id: str
    api_key: str
    persona_label: str = "Liquid Clips assistant"
    tick_seconds: int = AGENT_TICK_SECONDS
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    # last seen message ts (epoch ms) per channel
    last_seen: dict[str, int] = field(default_factory=dict)
    # in-memory metrics for observability
    polls_run: int = 0
    messages_posted: int = 0
    errors_seen: int = 0
    last_error: str | None = None
    _session: httpx.AsyncClient | None = None

    async def _client(self) -> httpx.AsyncClient:
        if self._session is None or self._session.is_closed:
            self._session = httpx.AsyncClient(
                base_url=WHOP_API_BASE,
                timeout=httpx.Timeout(10.0, connect=5.0),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "User-Agent": f"liquidclips-agent/{self.agent_id}",
                },
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.is_closed:
            await self._session.aclose()

    async def list_channels(self) -> list[dict[str, Any]]:
        """Fetch the channels this agent's key has membership in."""
        client = await self._client()
        try:
            r = await client.get(WHOP_CHAT_LIST_CHANNELS)
            if r.status_code == 200:
                data = r.json()
                # Whop returns either a bare array or {channels: []}
                return data if isinstance(data, list) else (data.get("channels") or [])
        except httpx.HTTPError as e:
            self.errors_seen += 1
            self.last_error = f"list_channels · {e!s}"
        return []

    async def poll_room(self, channel_id: str) -> list[dict[str, Any]]:
        """Pull messages newer than our last-seen timestamp."""
        client = await self._client()
        try:
            since = self.last_seen.get(channel_id, 0)
            path = WHOP_CHAT_LIST_MESSAGES.format(channel_id=channel_id)
            r = await client.get(path, params={"since_ms": since} if since else None)
            if r.status_code == 200:
                data = r.json()
                messages = data if isinstance(data, list) else (data.get("messages") or [])
                if messages:
                    newest = max(
                        (int(m.get("created_at_ms") or m.get("timestamp_ms") or 0))
                        for m in messages
                    )
                    if newest > since:
                        self.last_seen[channel_id] = newest
                return list(messages)
        except httpx.HTTPError as e:
            self.errors_seen += 1
            self.last_error = f"poll_room · {e!s}"
        return []

    async def post_reply(self, channel_id: str, body: str, in_reply_to: str | None = None) -> bool:
        """Post a message · returns True on success."""
        # Jitter so 100 agents don't post in the same millisecond.
        jitter_ms = random.randint(AGENT_REPLY_DELAY_MIN_MS, AGENT_REPLY_DELAY_MAX_MS)
        await asyncio.sleep(jitter_ms / 1000.0)
        client = await self._client()
        try:
            path = WHOP_CHAT_POST_MESSAGE.format(channel_id=channel_id)
            payload: dict[str, Any] = {"body": body}
            if in_reply_to:
                payload["in_reply_to"] = in_reply_to
            r = await client.post(path, json=payload)
            if r.status_code in (200, 201):
                self.messages_posted += 1
                return True
            self.errors_seen += 1
            self.last_error = f"post_reply · HTTP {r.status_code}"
        except httpx.HTTPError as e:
            self.errors_seen += 1
            self.last_error = f"post_reply · {e!s}"
        return False

    def stats(self) -> dict[str, Any]:
        """Snapshot of this agent's behavior · used by the admin dashboard."""
        return {
            "agent_id": self.agent_id,
            "persona": self.persona_label,
            "polls_run": self.polls_run,
            "messages_posted": self.messages_posted,
            "errors_seen": self.errors_seen,
            "last_error": self.last_error,
            "tracked_channels": len(self.last_seen),
        }

    async def tick_loop(self) -> None:
        """Long-lived async loop · polls every tick_seconds until stop_event.

        Per-tick logic:
          1. Refresh channel membership (every 10 ticks)
          2. For each tracked channel, poll for new messages
          3. For each new message: if it mentions the agent's persona, post
             a reply (with jitter)
          4. Increment polls_run; sleep until next tick or stop_event
        """
        _log.info("[agent:%s] start · persona=%s · tick=%ds", self.agent_id, self.persona_label, self.tick_seconds)
        channel_refresh_counter = 0
        tracked_channels: list[str] = []
        try:
            while not self.stop_event.is_set():
                if channel_refresh_counter == 0:
                    channels = await self.list_channels()
                    tracked_channels = [str(c.get("id")) for c in channels if c.get("id")]
                channel_refresh_counter = (channel_refresh_counter + 1) % 10

                for channel_id in tracked_channels:
                    if self.stop_event.is_set():
                        break
                    messages = await self.poll_room(channel_id)
                    for msg in messages:
                        body = str(msg.get("body") or msg.get("text") or "")
                        if self.persona_label.lower() in body.lower() or "@" in body:
                            # Stub reply · real persona logic lands when Daniel
                            # gives us the keys + persona spec.
                            await self.post_reply(
                                channel_id,
                                body=f"👋 Heard you · {self.persona_label} replying soon.",
                                in_reply_to=str(msg.get("id") or ""),
                            )

                self.polls_run += 1
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=self.tick_seconds)
                except asyncio.TimeoutError:
                    pass
        except asyncio.CancelledError:
            _log.info("[agent:%s] cancelled", self.agent_id)
            raise
        except Exception as e:  # noqa: BLE001
            _log.exception("[agent:%s] crashed · %s", self.agent_id, e)
            self.errors_seen += 1
            self.last_error = f"tick_loop crash · {e!s}"
        finally:
            await self.close()
            _log.info(
                "[agent:%s] stopped · polls=%d messages=%d errors=%d",
                self.agent_id, self.polls_run, self.messages_posted, self.errors_seen,
            )


# ──────── Fleet orchestration ──────────────────────────────────────────


@dataclass
class WhopChatFleet:
    """Manages N WhopChatAgent tasks · lifespan-bound singleton."""

    agents: list[WhopChatAgent] = field(default_factory=list)
    tasks: list[asyncio.Task] = field(default_factory=list)
    started_at: float | None = None

    def stats(self) -> dict[str, Any]:
        return {
            "fleet_size": len(self.agents),
            "agents_running": sum(1 for t in self.tasks if not t.done()),
            "uptime_seconds": int(time.time() - self.started_at) if self.started_at else 0,
            "totals": {
                "polls_run": sum(a.polls_run for a in self.agents),
                "messages_posted": sum(a.messages_posted for a in self.agents),
                "errors_seen": sum(a.errors_seen for a in self.agents),
            },
            "agents": [a.stats() for a in self.agents],
        }


_FLEET: WhopChatFleet | None = None


async def start_agent_fleet() -> WhopChatFleet | None:
    """Boot the agent fleet · idempotent · no-op if disabled or no keys.

    Called from FastAPI lifespan startup. Returns the fleet handle (or
    None if the fleet didn't start)."""
    global _FLEET

    if _FLEET is not None:
        return _FLEET

    if not AGENT_ENABLED:
        _log.info("WhopChatFleet · WHOP_AGENT_ENABLED=false · skipping fleet startup")
        return None

    keys = _load_agent_keys()
    if not keys:
        _log.info("WhopChatFleet · WHOP_AGENT_KEYS empty · skipping fleet startup")
        return None

    fleet = WhopChatFleet(started_at=time.time())
    for i, key in enumerate(keys, start=1):
        agent = WhopChatAgent(
            agent_id=f"a{i:03d}",
            api_key=key,
            persona_label=os.environ.get(
                f"WHOP_AGENT_{i:03d}_PERSONA",
                f"Liquid Clips agent {i:03d}",
            ),
        )
        fleet.agents.append(agent)
        # Stagger startup so we don't slam Whop with 100 concurrent
        # list_channels requests in the same second.
        startup_delay = (i - 1) * 0.5
        fleet.tasks.append(
            asyncio.create_task(_delayed_start(agent, startup_delay), name=f"whop-agent-{i:03d}")
        )

    _FLEET = fleet
    _log.info("WhopChatFleet · started %d agents · tick=%ds", len(keys), AGENT_TICK_SECONDS)
    return fleet


async def _delayed_start(agent: WhopChatAgent, delay_seconds: float) -> None:
    if delay_seconds > 0:
        await asyncio.sleep(delay_seconds)
    await agent.tick_loop()


async def stop_agent_fleet() -> None:
    """Graceful shutdown · sets stop_event for every agent + waits for tasks."""
    global _FLEET
    if _FLEET is None:
        return
    _log.info("WhopChatFleet · stopping %d agents", len(_FLEET.agents))
    for agent in _FLEET.agents:
        agent.stop_event.set()
    # Give each agent up to 10s to drain before cancelling.
    try:
        await asyncio.wait_for(
            asyncio.gather(*_FLEET.tasks, return_exceptions=True),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        _log.warning("WhopChatFleet · stop timeout · cancelling remaining tasks")
        for task in _FLEET.tasks:
            if not task.done():
                task.cancel()
    _FLEET = None


def get_fleet() -> WhopChatFleet | None:
    """Read-only handle for the admin observability endpoint."""
    return _FLEET
