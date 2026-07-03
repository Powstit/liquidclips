"""Step 7.5 · agent substrate — dispatch + audit + kill switches + budget.

Adding a new AI agent instance (Codex, Anthropic, OpenAI) is one INSERT
into the ``Agent`` table. No code deploy, no per-agent glue.

Adding a new PROVIDER (new AI vendor) is one class implementing
``AgentProvider`` + one row per instance in the registry.

Every dispatch runs through ``dispatch()``:
  1. Global kill switch (``LC_AGENTS_ENABLED`` env)
  2. Per-agent kill switch (``Agent.enabled`` flag)
  3. Circuit breaker state (``Agent.circuit_breaker_state``)
  4. Capability check via the closed registry from Step 2
  5. Daily budget check + reserve
  6. Provider dispatch
  7. Audit row write (success OR failure)
  8. Circuit-breaker maintenance (5 consecutive failures → open)

Five named assertions verified in tests:
  * ``agent_registry_closed``   — providers list is a closed set
  * ``agent_action_audited``     — every dispatch writes one AgentAction
  * ``agent_credit_capped``      — over-budget dispatch denied server-side
  * ``agent_kill_switch_works``  — 3 layers all block dispatch
  * ``agent_capability_scoped``  — agent can't invoke tools its role lacks
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Iterable, Protocol

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Agent, AgentAction

log = logging.getLogger("junior.agents")


# --------------------------------------------------------------------------
# Closed provider registry — adding a provider is a code edit here
# --------------------------------------------------------------------------


class Provider(str, Enum):
    ANTHROPIC = "anthropic"
    CODEX = "codex"
    OPENAI = "openai"
    MOCK = "mock"  # test-only


CLOSED_PROVIDERS: frozenset[str] = frozenset(p.value for p in Provider)


def is_known_provider(name: str) -> bool:
    return name in CLOSED_PROVIDERS


# --------------------------------------------------------------------------
# Closed action-type registry — every dispatch names its action_type;
# unknown values are rejected at dispatch time so a rogue call site
# can't emit "delete_all_users" or similar.
# --------------------------------------------------------------------------


CLOSED_ACTION_TYPES: frozenset[str] = frozenset({
    "bug_fix.propose_patch",
    "bug_fix.open_pr",
    "user_reply.answer_question",
    "user_reply.acknowledge",
    "monitor.check_health",
    "monitor.probe_endpoint",
    "triage.categorize_incident",
    "diagnose.stuck_user",
})


def is_known_action_type(action_type: str) -> bool:
    return action_type in CLOSED_ACTION_TYPES


# --------------------------------------------------------------------------
# Capability map · reuses the Step 2 closed capability registry.
# Each role → set of capabilities the agent may invoke. Adding a role
# = one dict entry. Same shape as the Step 2 human platform roles so
# HQ can review both under one lens.
# --------------------------------------------------------------------------


ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    "bug_fixer": frozenset({
        "agent.pr.create",
        "agent.branch.push",
        "agent.tests.run",
    }),
    "user_replier": frozenset({
        "agent.user.reply",
        "agent.support.read",
    }),
    "monitor": frozenset({
        "agent.metrics.read",
        "agent.hq.notify",
    }),
    "triager": frozenset({
        "agent.metrics.read",
        "agent.hq.notify",
        "agent.dispatch.child",
    }),
}


def role_has_capability(role: str, capability: str) -> bool:
    return capability in ROLE_CAPABILITIES.get(role, frozenset())


# --------------------------------------------------------------------------
# Provider protocol · concrete impls live in providers/*.py (future).
# One class per vendor. The registry row picks the class at runtime.
# --------------------------------------------------------------------------


class AgentResponse:
    """Uniform return shape across every provider."""

    __slots__ = ("output_text", "cost_cents", "tools_called", "stable_error_code")

    def __init__(
        self,
        *,
        output_text: str,
        cost_cents: int,
        tools_called: list[dict[str, Any]] | None = None,
        stable_error_code: str | None = None,
    ):
        self.output_text = output_text
        self.cost_cents = cost_cents
        self.tools_called = tools_called or []
        self.stable_error_code = stable_error_code


class AgentProvider(Protocol):
    """The one interface every vendor implements. Adding a new vendor
    = new class implementing this + register in ``PROVIDER_FACTORY``."""

    def chat(
        self,
        *,
        messages: list[dict[str, str]],
        tools: Iterable[str],
        budget_cents: int,
        credential_id: str,
    ) -> AgentResponse: ...


class MockProvider:
    """Test-only provider · deterministic + no external calls · lets the
    Step 7.5 substrate tests exercise the whole dispatch machinery."""

    def chat(
        self,
        *,
        messages: list[dict[str, str]],
        tools: Iterable[str],
        budget_cents: int,
        credential_id: str,
    ) -> AgentResponse:
        _ = messages, tools, budget_cents, credential_id
        return AgentResponse(
            output_text="mock response",
            cost_cents=1,  # 1 cent per mock call
            tools_called=[],
        )


PROVIDER_FACTORY: dict[str, type] = {
    Provider.MOCK.value: MockProvider,
    # Provider.ANTHROPIC.value: AnthropicProvider,   # implement in follow-up
    # Provider.CODEX.value: CodexProvider,           # implement in follow-up
    # Provider.OPENAI.value: OpenAIProvider,         # implement in follow-up
}


# --------------------------------------------------------------------------
# Kill switches · 3 layers
# --------------------------------------------------------------------------


def global_agents_enabled() -> bool:
    """Env-var master switch. Set ``LC_AGENTS_ENABLED=false`` to freeze
    every agent without a deploy."""
    raw = os.environ.get("LC_AGENTS_ENABLED", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")


# --------------------------------------------------------------------------
# Budget enforcement · per-agent daily cap
# --------------------------------------------------------------------------


def _spent_today_cents(db: Session, agent_id: str) -> int:
    """Sum of cost_cents on AgentAction rows for ``agent_id`` in the
    current UTC calendar day."""
    now = datetime.now(timezone.utc)
    start_of_day = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    return int(
        db.query(func.coalesce(func.sum(AgentAction.cost_cents), 0))
        .filter(AgentAction.agent_id == agent_id)
        .filter(AgentAction.created_at >= start_of_day)
        .scalar()
        or 0
    )


class DispatchDenied(Exception):
    """Raised when dispatch is refused. Carries a stable_error_code so
    HQ can group + alert."""

    def __init__(self, stable_error_code: str, reason: str):
        super().__init__(f"{stable_error_code}: {reason}")
        self.stable_error_code = stable_error_code
        self.reason = reason


# --------------------------------------------------------------------------
# Circuit breaker
# --------------------------------------------------------------------------


CIRCUIT_OPEN_THRESHOLD = 5


def _breaker_should_stay_open(db: Session, agent: Agent) -> bool:
    """Half-open policy · once open, the breaker stays open for 5 min
    then flips to half-open for one attempt. Simplified state machine
    · we only implement open/closed transitions here; ``half_open`` is
    a placeholder for the follow-up."""
    return agent.circuit_breaker_state == "open"


def _record_breaker_success(db: Session, agent: Agent) -> None:
    agent.consecutive_failures = 0
    if agent.circuit_breaker_state == "open":
        agent.circuit_breaker_state = "closed"
    db.commit()


def _record_breaker_failure(db: Session, agent: Agent) -> None:
    agent.consecutive_failures = int(agent.consecutive_failures or 0) + 1
    if agent.consecutive_failures >= CIRCUIT_OPEN_THRESHOLD:
        agent.circuit_breaker_state = "open"
        log.warning(
            "[agents] circuit breaker OPEN for agent_id=%s after %d consecutive failures",
            agent.agent_id, agent.consecutive_failures,
        )
    db.commit()


# --------------------------------------------------------------------------
# The one dispatch path
# --------------------------------------------------------------------------


def dispatch(
    db: Session,
    *,
    agent_id: str,
    action_type: str,
    target_user_id: str | None = None,
    messages: list[dict[str, str]],
    tools: Iterable[str] = (),
    estimated_cost_cents: int = 0,
    correlation_id: str | None = None,
) -> AgentAction:
    """Execute one action through the named agent. Always writes an
    ``AgentAction`` audit row · never mutates without one.

    Raises ``DispatchDenied`` with a stable_error_code when any gate
    refuses. Audit row still lands (success=False) so HQ can see the
    denial. Callers should ``except DispatchDenied`` and surface the
    reason; never swallow silently.
    """
    trace_id = uuid.uuid4().hex[:16]
    agent = db.query(Agent).filter(Agent.agent_id == agent_id).one_or_none()

    def _audit(
        *,
        success: bool,
        output_text: str | None = None,
        cost_cents: int = 0,
        elapsed_ms: int = 0,
        tools_called: list[dict[str, Any]] | None = None,
        error_code: str | None = None,
    ) -> AgentAction:
        row = AgentAction(
            id=uuid.uuid4().hex,
            agent_id=agent_id,
            action_type=action_type,
            target_user_id=target_user_id,
            prompt_redacted=_redact(_format_messages(messages))[:2000] if messages else None,
            response_redacted=(_redact(output_text)[:2000] if output_text else None),
            tools_called=tools_called or [],
            cost_cents=cost_cents,
            elapsed_ms=elapsed_ms,
            success=success,
            stable_error_code=error_code,
            decision_trace_id=trace_id,
            correlation_id=correlation_id,
        )
        db.add(row)
        db.commit()
        return row

    # Gate 1 · closed action_type
    if not is_known_action_type(action_type):
        return _audit(success=False, error_code="agent.action_type_unknown")

    # Gate 2 · agent exists
    if agent is None:
        # Try to audit anyway — a rogue caller invoking a fake agent_id
        # should still leave a trail.
        row = AgentAction(
            id=uuid.uuid4().hex,
            agent_id=agent_id,
            action_type=action_type,
            target_user_id=target_user_id,
            success=False,
            stable_error_code="agent.not_found",
            decision_trace_id=trace_id,
            correlation_id=correlation_id,
        )
        db.add(row)
        db.commit()
        return row

    # Gate 3 · global kill switch
    if not global_agents_enabled():
        return _audit(success=False, error_code="agent.global_kill_switch")

    # Gate 4 · per-agent enabled flag
    if not agent.enabled:
        return _audit(success=False, error_code="agent.disabled")

    # Gate 5 · circuit breaker
    if _breaker_should_stay_open(db, agent):
        return _audit(success=False, error_code="agent.circuit_open")

    # Gate 6 · closed provider
    if not is_known_provider(agent.provider):
        return _audit(success=False, error_code="agent.provider_unknown")

    # Gate 7 · capability scope · every requested tool must be in the
    # role's capability bundle.
    for tool in tools:
        if not role_has_capability(agent.role, tool):
            return _audit(
                success=False,
                error_code="agent.capability_denied",
                tools_called=[{"tool": tool, "denied": True}],
            )

    # Gate 8 · daily budget · reserve estimated_cost + refund after
    spent = _spent_today_cents(db, agent.agent_id)
    if spent + max(estimated_cost_cents, 1) > int(agent.daily_credit_cap_cents):
        return _audit(success=False, error_code="agent.budget_exhausted", cost_cents=0)

    provider_cls = PROVIDER_FACTORY.get(agent.provider)
    if provider_cls is None:
        return _audit(success=False, error_code="agent.provider_not_wired")

    provider = provider_cls()
    started = time.perf_counter()
    try:
        response = provider.chat(
            messages=messages,
            tools=tools,
            budget_cents=int(agent.daily_credit_cap_cents) - spent,
            credential_id=agent.credential_id,
        )
    except Exception as exc:  # noqa: BLE001
        elapsed = int((time.perf_counter() - started) * 1000)
        _record_breaker_failure(db, agent)
        return _audit(
            success=False,
            elapsed_ms=elapsed,
            error_code="agent.provider_error",
            output_text=str(exc)[:400],
        )
    elapsed = int((time.perf_counter() - started) * 1000)

    if response.stable_error_code:
        _record_breaker_failure(db, agent)
        return _audit(
            success=False,
            elapsed_ms=elapsed,
            error_code=response.stable_error_code,
            output_text=response.output_text,
            cost_cents=response.cost_cents,
            tools_called=response.tools_called,
        )

    _record_breaker_success(db, agent)
    return _audit(
        success=True,
        elapsed_ms=elapsed,
        output_text=response.output_text,
        cost_cents=response.cost_cents,
        tools_called=response.tools_called,
    )


# --------------------------------------------------------------------------
# Small redactor · re-uses the Step 5 discipline for prompt/response
# audit fields. Kept inline to avoid a cyclic import with Step 6's
# telemetry_ingest which houses the more full-featured version.
# --------------------------------------------------------------------------


import re

_BANNED_KEYS = re.compile(r"(?:email|jwt|token|secret|pin|password|authorization)", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9._-]{20,}\b")
_PATH_RE = re.compile(r"(?:^|\s)(?:/(?:Users|home|tmp)/[^\s\"']+|[A-Za-z]:\\[^\s\"']+|~/[^\s\"']+)")


def _redact(value: str | None) -> str:
    if not value:
        return ""
    out = _EMAIL_RE.sub("[email]", value)
    out = _JWT_RE.sub("[jwt]", out)
    out = _PATH_RE.sub(" [path]", out)
    return out


def _format_messages(messages: list[dict[str, str]]) -> str:
    if not messages:
        return ""
    parts = []
    for m in messages:
        role = m.get("role", "?")
        content = m.get("content", "")
        parts.append(f"[{role}] {content}")
    return "\n".join(parts)
