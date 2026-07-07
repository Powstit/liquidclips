"""LLM dispatcher · per-provider bug-fix agent adapter.

When a node crosses RED, the coordinator calls dispatch_fix() with the
failure context. This module knows how to talk to each provider (Anthropic
/ OpenAI / Moonshot Kimi) with the provider's API key.

Design:
  * Every provider gets the SAME prompt shape · we don't optimise per-model
    at v1. Same input → same expected output (unified diff + summary).
  * Fallback = Anthropic Claude 1 (my key) when no LLM is hired for a node.
    Uses the same code path as an assigned-Anthropic node.
  * Budget enforcement: caller checks used_cents ≥ budget_cents BEFORE
    calling dispatch_fix. This module doesn't gate on budget itself.
  * Idempotence: caller de-dups by node_id + failure batch — this module
    just fires the HTTP call.

Return shape:
  {
    "ok": bool,
    "summary": "short one-liner for HQ",
    "diff": "unified diff text",
    "touched_files": ["path/to/file.tsx"],
    "cost_cents": estimated cost cents,
    "error": "message if not ok"
  }
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Bug-fix system prompt template. Filled with node metadata before send.
_SYSTEM_PROMPT_TEMPLATE = """You are a surgical bug-fix agent for the Liquid Clips desktop app.

Node: {label}
Node id: {node_id}
Cluster: {cluster}
Source file: {source}
Owner: {owner}
Money-critical: {money_critical}

Your ONLY job is to propose a minimal patch that fixes the specific bug
described in the failure context. You do NOT:
  - refactor
  - add new features
  - add tests unless the bug is a broken test
  - restructure unrelated code

You DO:
  - read the failure stack trace
  - identify the smallest surgical change that fixes the crash
  - respect existing code style (TypeScript strict, no `any`)
  - return a valid unified diff that applies cleanly against master

Output format (JSON):
{{
  "summary": "one-line description of the fix",
  "diff": "unified diff text · MUST start with 'diff --git' lines",
  "touched_files": ["src/path/to/file.tsx"]
}}

If you cannot determine a fix from the given context, return:
{{"summary": "cannot fix without additional context", "diff": "", "touched_files": [], "need": "what you'd need to see"}}
"""


def _build_user_message(failures: list[dict[str, Any]]) -> str:
    """Build the user-side prompt with failure context."""
    lines = ["Recent failures on this node (most recent first):", ""]
    for i, f in enumerate(failures[:10]):
        lines.append(f"--- failure {i+1} · ts={f.get('ts')} weight={f.get('weight')} ---")
        lines.append(f"message: {f.get('message', '')}")
        if f.get("stack"):
            lines.append(f"stack:\n{f['stack']}")
        if f.get("context"):
            try:
                lines.append(f"context:\n{json.dumps(f['context'], indent=2)}")
            except Exception:
                pass
        lines.append("")
    lines.append("Propose the smallest surgical patch that fixes the crash.")
    return "\n".join(lines)


def _dispatch_anthropic(
    api_key: str,
    model: str,
    system_prompt: str,
    user_msg: str,
) -> dict[str, Any]:
    """Call Anthropic Messages API."""
    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_msg}],
                },
            )
        r.raise_for_status()
        data = r.json()
        text_blocks = [b for b in data.get("content", []) if b.get("type") == "text"]
        raw = text_blocks[0]["text"] if text_blocks else ""
        usage = data.get("usage", {})
        # ~$15/M input, ~$75/M output for opus; rough estimate
        cost_cents = int(
            (usage.get("input_tokens", 0) * 15 + usage.get("output_tokens", 0) * 75) / 10000
        )
        return _parse_llm_json(raw, cost_cents)
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"anthropic http {e.response.status_code}: {e.response.text[:200]}",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"anthropic error: {str(e)[:200]}",
        }


def _dispatch_openai(
    api_key: str,
    model: str,
    system_prompt: str,
    user_msg: str,
) -> dict[str, Any]:
    """Call OpenAI chat completions."""
    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                },
            )
        r.raise_for_status()
        data = r.json()
        raw = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        # Rough gpt-4o pricing
        cost_cents = int(
            (usage.get("prompt_tokens", 0) * 5 + usage.get("completion_tokens", 0) * 15) / 10000
        )
        return _parse_llm_json(raw, cost_cents)
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"openai http {e.response.status_code}: {e.response.text[:200]}",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"openai error: {str(e)[:200]}",
        }


def _dispatch_moonshot(
    api_key: str,
    model: str,
    system_prompt: str,
    user_msg: str,
) -> dict[str, Any]:
    """Call Moonshot (Kimi) chat completions."""
    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                "https://api.moonshot.cn/v1/chat/completions",
                headers={
                    "authorization": f"Bearer {api_key}",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.3,
                },
            )
        r.raise_for_status()
        data = r.json()
        raw = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        cost_cents = int((usage.get("total_tokens", 0) * 5) / 10000)
        return _parse_llm_json(raw, cost_cents)
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"moonshot http {e.response.status_code}: {e.response.text[:200]}",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"moonshot error: {str(e)[:200]}",
        }


def _parse_llm_json(raw: str, cost_cents: int) -> dict[str, Any]:
    """Extract JSON from LLM output. LLMs sometimes wrap in ```json blocks."""
    text = raw.strip()
    # Strip code fence if present
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
        text = text.strip()
    try:
        parsed = json.loads(text)
        summary = parsed.get("summary", "") or ""
        diff = parsed.get("diff", "") or ""
        touched = parsed.get("touched_files", []) or []
        return {
            "ok": bool(diff.strip()),  # empty diff = LLM bailed
            "summary": summary[:400],
            "diff": diff,
            "touched_files": touched if isinstance(touched, list) else [],
            "cost_cents": cost_cents,
            "error": None if diff.strip() else parsed.get("need", "empty diff"),
        }
    except json.JSONDecodeError as e:
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": cost_cents,
            "error": f"llm returned non-json: {str(e)[:120]} | raw[:200]={raw[:200]}",
        }


def dispatch_fix(
    provider: str,
    model: str,
    api_key: str,
    node_meta: dict[str, Any],
    failures: list[dict[str, Any]],
    system_prompt_override: str | None = None,
) -> dict[str, Any]:
    """Coordinator's entry point. Fires the LLM and returns the parsed result."""
    system_prompt = system_prompt_override or _SYSTEM_PROMPT_TEMPLATE.format(
        label=node_meta.get("label", "unknown"),
        node_id=node_meta.get("node_id", "unknown"),
        cluster=node_meta.get("cluster", "unknown"),
        source=node_meta.get("source", "unknown"),
        owner=node_meta.get("owner", "Claude 1"),
        money_critical="yes" if node_meta.get("money_critical") else "no",
    )
    user_msg = _build_user_message(failures)

    provider_l = provider.lower()
    if provider_l == "anthropic":
        return _dispatch_anthropic(api_key, model, system_prompt, user_msg)
    elif provider_l == "openai":
        return _dispatch_openai(api_key, model, system_prompt, user_msg)
    elif provider_l == "moonshot":
        return _dispatch_moonshot(api_key, model, system_prompt, user_msg)
    else:
        return {
            "ok": False,
            "summary": "",
            "diff": "",
            "touched_files": [],
            "cost_cents": 0,
            "error": f"unknown provider {provider!r}; supported: anthropic, openai, moonshot",
        }
