"""Constellation Engine — self-healing node runtime.

Every user-reachable surface in desktop-2 is wrapped in a Watchdog that
POSTs failures to /hq/nodes/intercession. This module owns:

  * Coordinator — threshold detection, LLM dispatch, patch storage
  * Pool        — Railway-pool health-check + failover selector
  * Crypto      — encrypt LLM API keys + pool member keys at rest
  * Dispatcher  — per-provider LLM adapters (Anthropic, OpenAI, Moonshot)

Design decisions:
  - Everything server-side. Client (desktop) is a reporter only.
  - HQ hires/fires per-node LLMs via the admin panel. Fallback = Anthropic
    key ("Claude 1") when no LLM assigned to a node.
  - Pool inserts: HQ pastes URL + key per slot; loads live via DB row
    updates. Zero redeploys.
  - Approved patches land on constellation/patch_<id> branch. Human
    merges to master. No auto-merge in v1 for blast-radius safety.

See docs/PROTOCOL_SELF_HEALING_NODES.md for the wider architecture doc,
HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md for the HQ handoff contract.
"""

from __future__ import annotations

from app.constellation.crypto import (
    encrypt_secret,
    decrypt_secret,
    is_encryption_configured,
)

__all__ = [
    "encrypt_secret",
    "decrypt_secret",
    "is_encryption_configured",
]
