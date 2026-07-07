"""Model recommendations for HQ + our admin panels.

When HQ (or Daniel) opens the "assign LLM" modal on a node, this
module tells the UI which model to pre-select and which cluster fits
best. The panel should render these as top-of-list options with a
"recommended" badge so Daniel + HQ don't have to think about which
model to hire per node.

Daniel's guidance (2026-07-06):
  * Kimi K2 = recommended default for bug-fix agents
  * OpenAI gpt-4o = second choice (strongest tool-use)
  * Anthropic claude-opus-4-7 = third + fallback rail

The fallback (my Anthropic key) always covers un-hired nodes · these
suggestions only apply when HQ actively hires a per-node LLM.
"""

from __future__ import annotations

from typing import Any


# Model catalog · what the UI dropdown renders. Priority order = list
# order. First entry = default selection.
MODEL_CATALOG: list[dict[str, Any]] = [
    {
        "provider": "moonshot",
        "model": "kimi-k2",
        "label": "Kimi K2 (Moonshot)",
        "recommended": True,
        "recommended_reason": "Daniel's pick · strong at surgical bug fixes with low cost per fix. Best default for cohort-0.",
        "default_budget_cents": 50000,
        "context_window_hint": "200k",
        "strengths": [
            "long-context code understanding",
            "cheap per token",
            "consistent diff-shaped output",
        ],
    },
    {
        "provider": "openai",
        "model": "gpt-4o",
        "label": "GPT-4o (OpenAI)",
        "recommended": False,
        "recommended_reason": "Strong tool-use + JSON mode reliability. Pick when Kimi struggles with a specific node.",
        "default_budget_cents": 75000,
        "context_window_hint": "128k",
        "strengths": [
            "structured JSON output enforcement",
            "strong TypeScript idiom recall",
        ],
    },
    {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "label": "GPT-4o-mini (OpenAI · budget)",
        "recommended": False,
        "recommended_reason": "Cheapest option · use for high-volume low-risk nodes (analytics tiles, static banners).",
        "default_budget_cents": 20000,
        "context_window_hint": "128k",
        "strengths": ["cheap", "fast"],
    },
    {
        "provider": "anthropic",
        "model": "claude-opus-4-7",
        "label": "Claude Opus 4.7 (Anthropic)",
        "recommended": False,
        "recommended_reason": "Highest reasoning tier · reserve for money-critical nodes where a wrong fix is expensive.",
        "default_budget_cents": 200000,
        "context_window_hint": "200k",
        "strengths": [
            "deepest reasoning",
            "best at multi-file causal debugging",
        ],
    },
    {
        "provider": "anthropic",
        "model": "claude-haiku-4-5-20251001",
        "label": "Claude Haiku 4.5 (Anthropic · fast)",
        "recommended": False,
        "recommended_reason": "Fast + cheap Anthropic option. Similar cost tier to Kimi K2 with different failure modes.",
        "default_budget_cents": 30000,
        "context_window_hint": "200k",
        "strengths": ["low latency", "cheap"],
    },
]


# Per-cluster recommendation · which model gets suggested first when
# hiring for a node in that cluster. Overrides the flat "Kimi K2 default"
# only when a cluster has domain-specific characteristics (e.g. money
# cluster wants the strongest reasoner because the blast radius of a
# wrong fix is $$$).
CLUSTER_RECOMMENDATIONS: dict[str, dict[str, str]] = {
    "identity": {
        "provider": "moonshot",
        "model": "kimi-k2",
        "reason": "Identity nodes are UI-guard heavy · Kimi's cheap diffs suit high-volume low-blast surfaces.",
    },
    "pipeline": {
        "provider": "moonshot",
        "model": "kimi-k2",
        "reason": "Pipeline nodes touch clip rendering + browser overlay · Kimi handles the TypeScript surface well.",
    },
    "money": {
        "provider": "anthropic",
        "model": "claude-opus-4-7",
        "reason": "Money nodes touch payments · reserve the deepest reasoner because a wrong fix is expensive.",
    },
    "agency": {
        "provider": "moonshot",
        "model": "kimi-k2",
        "reason": "Agency nodes are settings + roster CRUD · Kimi is well-matched.",
    },
    "system": {
        "provider": "moonshot",
        "model": "kimi-k2",
        "reason": "System nodes are cross-cutting · Kimi default holds.",
    },
}


def get_recommendations_payload() -> dict[str, Any]:
    """Payload the admin panels bind against for the assign-LLM modal."""
    return {
        "default_pick": {
            "provider": "moonshot",
            "model": "kimi-k2",
        },
        "catalog": MODEL_CATALOG,
        "cluster_recommendations": CLUSTER_RECOMMENDATIONS,
        "notes": (
            "Kimi K2 is Daniel's default choice for bug-fix agents. HQ enters "
            "the Kimi API key when opening the assign-LLM modal. Cluster "
            "recommendations override the flat default (e.g. money cluster "
            "prefers Claude Opus 4.7 for blast-radius safety)."
        ),
    }
