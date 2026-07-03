"""Step 7.5 · agent substrate — 5 named assertions.

Named assertions (informal; ships without formal SO-GATE receipt since
the master doc gate script covers 2-9 only):

* ``agent_registry_closed``  — provider set + action_type set are frozen
* ``agent_action_audited``   — every dispatch (success or denial) writes
                                one AgentAction row
* ``agent_credit_capped``    — daily cap enforced server-side
* ``agent_kill_switch_works`` — 3 layers (global env · per-agent flag ·
                                 circuit breaker) all block dispatch
* ``agent_capability_scoped`` — agent can't invoke tools its role lacks
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agents_substrate import (
    CIRCUIT_OPEN_THRESHOLD,
    CLOSED_ACTION_TYPES,
    CLOSED_PROVIDERS,
    Provider,
    ROLE_CAPABILITIES,
    dispatch,
    is_known_action_type,
    is_known_provider,
    role_has_capability,
)
from app.db import Base
from app.models import Agent, AgentAction


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with Session() as s:
        yield s


def _mkagent(session, *, provider: str = "mock", role: str = "user_replier", enabled: bool = True, daily_cap_cents: int = 1000):
    row = Agent(
        id=uuid.uuid4().hex,
        agent_id=f"agent_{uuid.uuid4().hex[:8]}",
        name="Test Agent",
        provider=provider,
        role=role,
        credential_id="cred_test",
        enabled=enabled,
        daily_credit_cap_cents=daily_cap_cents,
        owner="daniel@liquidclips.app",
    )
    session.add(row)
    session.commit()
    return row


# ---------------------------------------------------------------------
# agent_registry_closed
# ---------------------------------------------------------------------


def test_agent_registry_closed_provider_set_is_frozen():
    assert isinstance(CLOSED_PROVIDERS, frozenset)
    assert Provider.ANTHROPIC.value in CLOSED_PROVIDERS
    assert Provider.CODEX.value in CLOSED_PROVIDERS
    assert Provider.OPENAI.value in CLOSED_PROVIDERS
    assert Provider.MOCK.value in CLOSED_PROVIDERS


def test_agent_registry_closed_action_types_are_frozen():
    assert isinstance(CLOSED_ACTION_TYPES, frozenset)
    assert is_known_action_type("bug_fix.propose_patch")
    assert is_known_action_type("user_reply.answer_question")
    assert not is_known_action_type("random.unlisted_action")


def test_agent_registry_closed_role_caps_enforced():
    """Every listed role has an explicit capability bundle. Adding a
    role = editing this dict."""
    assert role_has_capability("bug_fixer", "agent.pr.create")
    assert not role_has_capability("bug_fixer", "agent.user.reply")
    assert role_has_capability("user_replier", "agent.user.reply")
    assert not role_has_capability("user_replier", "agent.pr.create")


# ---------------------------------------------------------------------
# agent_action_audited
# ---------------------------------------------------------------------


def test_agent_action_audited_success_writes_row(session):
    agent = _mkagent(session)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
        tools=[],
    )
    assert row.success is True
    all_actions = session.query(AgentAction).all()
    assert len(all_actions) == 1
    assert all_actions[0].agent_id == agent.agent_id
    assert all_actions[0].decision_trace_id


def test_agent_action_audited_denial_still_writes_row(session):
    agent = _mkagent(session, enabled=False)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.disabled"
    # Even denied dispatches audit
    assert session.query(AgentAction).count() == 1


def test_agent_action_audits_unknown_agent(session):
    """A dispatch to a nonexistent agent_id must still leave a trail so
    HQ can catch rogue callers."""
    row = dispatch(
        session,
        agent_id="agent_ghost",
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.not_found"


def test_agent_action_prompts_and_responses_are_redacted(session):
    agent = _mkagent(session)
    dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[
            {
                "role": "user",
                "content": "please email me at daniel@example.com with my JWT eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.zzz",
            }
        ],
    )
    row = session.query(AgentAction).one()
    prompt = row.prompt_redacted or ""
    assert "daniel@example.com" not in prompt
    assert "[email]" in prompt
    assert "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop" not in prompt


# ---------------------------------------------------------------------
# agent_credit_capped
# ---------------------------------------------------------------------


def test_agent_credit_capped_blocks_when_daily_cap_reached(session):
    agent = _mkagent(session, daily_cap_cents=5)
    # Spend 5 cents worth of mock calls (each is 1 cent).
    for _ in range(5):
        row = dispatch(
            session,
            agent_id=agent.agent_id,
            action_type="user_reply.answer_question",
            messages=[{"role": "user", "content": "one"}],
        )
        assert row.success is True
    # 6th call is denied
    denied = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "no more"}],
    )
    assert denied.success is False
    assert denied.stable_error_code == "agent.budget_exhausted"


# ---------------------------------------------------------------------
# agent_kill_switch_works — 3 layers
# ---------------------------------------------------------------------


def test_agent_kill_switch_global_env(session, monkeypatch):
    """Layer 1 · global LC_AGENTS_ENABLED=false freezes every agent."""
    monkeypatch.setenv("LC_AGENTS_ENABLED", "false")
    agent = _mkagent(session)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.global_kill_switch"


def test_agent_kill_switch_per_agent_flag(session):
    """Layer 2 · Agent.enabled=False stops just that agent."""
    agent = _mkagent(session, enabled=False)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.disabled"


def test_agent_kill_switch_circuit_breaker(session):
    """Layer 3 · circuit_breaker_state='open' stops dispatch."""
    agent = _mkagent(session)
    # Manually flip the breaker (in production this happens after N
    # consecutive failures via _record_breaker_failure).
    agent.circuit_breaker_state = "open"
    session.commit()
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.circuit_open"


def test_circuit_breaker_opens_after_threshold_failures(session):
    """When the provider raises N times in a row the breaker opens
    automatically · subsequent dispatches short-circuit."""
    # Provider that always throws
    from app.agents_substrate import PROVIDER_FACTORY

    class ThrowingProvider:
        def chat(self, **kw):
            raise RuntimeError("boom")

    PROVIDER_FACTORY["throwing"] = ThrowingProvider
    try:
        agent = _mkagent(session, provider="throwing")
        # provider isn't in CLOSED_PROVIDERS — patch that too for this test
        import app.agents_substrate as sub
        original_providers = sub.CLOSED_PROVIDERS
        sub.CLOSED_PROVIDERS = frozenset(list(original_providers) + ["throwing"])
        try:
            for _ in range(CIRCUIT_OPEN_THRESHOLD):
                row = dispatch(
                    session,
                    agent_id=agent.agent_id,
                    action_type="user_reply.answer_question",
                    messages=[{"role": "user", "content": "boom"}],
                )
                assert row.success is False
            session.refresh(agent)
            assert agent.circuit_breaker_state == "open"
        finally:
            sub.CLOSED_PROVIDERS = original_providers
    finally:
        PROVIDER_FACTORY.pop("throwing", None)


# ---------------------------------------------------------------------
# agent_capability_scoped
# ---------------------------------------------------------------------


def test_agent_capability_scoped_denies_tool_outside_role(session):
    """user_replier role has no `agent.pr.create` capability — a
    dispatch that requests that tool must be denied and audited."""
    agent = _mkagent(session, role="user_replier")
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
        tools=["agent.pr.create"],  # this tool isn't in user_replier's bundle
    )
    assert row.success is False
    assert row.stable_error_code == "agent.capability_denied"


def test_agent_capability_scoped_allows_tools_in_role(session):
    agent = _mkagent(session, role="bug_fixer")
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="bug_fix.propose_patch",
        messages=[{"role": "user", "content": "fix the login bug"}],
        tools=["agent.pr.create", "agent.tests.run"],  # both in bug_fixer's bundle
    )
    assert row.success is True


# ---------------------------------------------------------------------
# Additional safety
# ---------------------------------------------------------------------


def test_unknown_provider_rejected(session):
    """A row inserted with a provider not in CLOSED_PROVIDERS is denied
    at dispatch time (no matter what got past DB constraints)."""
    agent = _mkagent(session, provider="mock")
    agent.provider = "someone_forgot_to_register_me"
    session.commit()
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="user_reply.answer_question",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.provider_unknown"


def test_unknown_action_type_rejected(session):
    agent = _mkagent(session)
    row = dispatch(
        session,
        agent_id=agent.agent_id,
        action_type="delete_all_users",  # not in CLOSED_ACTION_TYPES
        messages=[{"role": "user", "content": "hi"}],
    )
    assert row.success is False
    assert row.stable_error_code == "agent.action_type_unknown"
