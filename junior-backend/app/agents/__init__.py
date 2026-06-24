"""Whop chat-agent fleet · 2026-06-24.

100 async coroutines (one per agent key) co-hosted in the same junior-backend
Railway service. Each agent owns a long-lived httpx.AsyncClient session and
polls Whop community chat channels for mentions, replies on a schedule, and
posts proactive welcome / activity messages.

Doubles as a live load-simulator for the FastAPI backend (real traffic
against /me, /campaigns, /submissions, /community endpoints).

Architecture (per the scoping report 2026-06-24):
  - Option B: single container, N async coroutines
  - Reuses APScheduler from app/cron.py for tick orchestration
  - Reuses Whop API patterns from app/routes/whop.py (httpx, in-memory rate
    buckets, error handling)
  - Env vars (NOT YET PROVIDED · Daniel will supply when we get into Whop):
      WHOP_AGENT_KEYS               · JSON array of agent API keys
      WHOP_AGENT_TICK_SECONDS       · default 30 · poll interval per agent
      WHOP_AGENT_REPLY_DELAY_MS_MIN · default 1500 · jitter floor
      WHOP_AGENT_REPLY_DELAY_MS_MAX · default 4500 · jitter ceiling
      WHOP_AGENT_LOG_LEVEL          · default INFO
      WHOP_AGENT_ENABLED            · default false · MUST be true to start

Safety:
  - WHOP_AGENT_ENABLED defaults to FALSE — the fleet does NOT start unless
    explicitly enabled via env var. Prevents accidental spam if keys land
    in a config file before Daniel is ready.
  - Rate-limit guard per-agent (exponential backoff + jitter)
  - Graceful shutdown via lifespan stop_event
  - All actions log to function_heatmap so Daniel can audit per-key behavior
"""

from .whop_chat import WhopChatAgent, start_agent_fleet, stop_agent_fleet

__all__ = ["WhopChatAgent", "start_agent_fleet", "stop_agent_fleet"]
