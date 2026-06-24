"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalContext } from "@/lib/ai-terminal-prompts";
import { ContextSwitcher } from "./ContextSwitcher";
import { CostMeter, recordCost } from "./CostMeter";

// AI Terminal — read-only investigative chat surface.
//
// Sends every prompt to /api/admin/ai/run (server-side proxy → Anthropic).
// The server returns { message, tokens_in, tokens_out, cost_usd } OR
// { error: "exceeds cost ceiling", ... }. Either way we surface the
// outcome to Daniel verbatim; we never re-prompt automatically.
//
// READ-ONLY: there are NO action buttons rendered on the assistant
// messages. The assistant phrases suggestions like "Suggested action:
// open Mutations → Refunds and refund <real_email>"; Daniel clicks
// through manually in MutationsTab (Agent 3).

type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  // Per-turn metadata for the cost line under each assistant bubble.
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  isError?: boolean;
};

type RunOk = {
  message: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
};

type RunErr = {
  error: string;
  estimated_input_tokens?: number;
  estimated_cost_usd?: number;
};

function isRunOk(x: unknown): x is RunOk {
  return !!x && typeof x === "object" && typeof (x as RunOk).message === "string";
}

const SEED_MESSAGE: Record<TerminalContext, string> = {
  users:
    "Loaded the last 200 users (30d). Ask me to cluster, segment, or surface anomalies. Suggested actions only — Daniel runs the mutation.",
  inbox:
    "Loaded the last 100 inbox messages. Ask me to cluster by theme, find duplicates, or surface P0 items.",
  webhooks:
    "Loaded the last 200 webhook events. Ask me about failure rates, latency spikes, or specific event types.",
};

export function Terminal({
  adminEmail,
  hasKey,
}: {
  adminEmail: string;
  hasKey: boolean;
}) {
  const [context, setContext] = useState<TerminalContext>("users");
  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    { role: "system", content: SEED_MESSAGE.users },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [costBump, setCostBump] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Re-seed the conversation when Daniel flips contexts so the model
  // never gets confused about which snapshot it's reasoning over.
  const switchContext = useCallback((next: TerminalContext) => {
    setContext(next);
    setMessages([{ role: "system", content: SEED_MESSAGE[next] }]);
  }, []);

  // Auto-scroll to the latest message on append.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || loading || !hasKey) return;
    setInput("");

    // History sent to the server is the prior conversation, user+assistant
    // only (the seed "system" bubble is UI-only).
    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/ai/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context, prompt, history }),
      });
      const json = (await res.json()) as RunOk | RunErr;
      if (isRunOk(json)) {
        recordCost(json.cost_usd);
        setCostBump((n) => n + 1);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: json.message,
            tokensIn: json.tokens_in,
            tokensOut: json.tokens_out,
            costUsd: json.cost_usd,
          },
        ]);
      } else {
        const e = json as RunErr;
        const detail =
          e.estimated_cost_usd !== undefined
            ? ` (estimated ~$${e.estimated_cost_usd.toFixed(4)}, ~${e.estimated_input_tokens ?? 0} input tokens)`
            : "";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Request refused: ${e.error}${detail}`,
            isError: true,
          },
        ]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Network error: ${message}`, isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  }, [context, hasKey, input, loading, messages]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  const placeholder = useMemo(() => {
    switch (context) {
      case "users":
        return "e.g. Who churned in the last 7 days and how much did they pay?";
      case "inbox":
        return "e.g. Cluster the last 50 messages by theme — surface P0 first.";
      case "webhooks":
        return "e.g. Which source had the highest failure rate in the last hour?";
    }
  }, [context]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex h-screen max-w-5xl flex-col px-6 py-6">
        {/* Header */}
        <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display, var(--font-geist))" }}
            >
              AI Terminal
            </h1>
            <p className="text-sm text-text-secondary">
              Read-only investigation · {adminEmail}
            </p>
          </div>
          <ContextSwitcher
            value={context}
            onChange={switchContext}
            disabled={loading}
          />
        </header>

        {!hasKey ? (
          <div className="mb-4 rounded-lg border border-line bg-paper-warm px-4 py-3 text-sm text-text-secondary">
            <span className="font-medium text-ink">Terminal disabled.</span> Set{" "}
            <code className="rounded bg-paper-elev px-1.5 py-0.5 text-xs text-fuchsia-deep">
              CLAUDE_ADMIN_API_KEY
            </code>{" "}
            on the server to enable.
          </div>
        ) : null}

        {/* Message list */}
        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto rounded-2xl border border-line bg-paper-warm/40 p-5"
        >
          <ul className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <li key={i} className="flex">
                <Bubble msg={m} />
              </li>
            ))}
            {loading ? (
              <li className="flex">
                <Bubble
                  msg={{
                    role: "assistant",
                    content: "Thinking…",
                  }}
                  ghost
                />
              </li>
            ) : null}
          </ul>
        </div>

        {/* Composer */}
        <div className="mt-4 rounded-2xl border border-line bg-paper-warm/60 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading || !hasKey}
            placeholder={placeholder}
            rows={3}
            className="block w-full resize-none rounded-lg bg-transparent px-3 py-2 text-sm text-ink placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <CostMeter bumpSignal={costBump} />
            <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
              <span>cmd/ctrl + enter</span>
              <button
                type="button"
                onClick={() => void send()}
                disabled={loading || !hasKey || input.trim().length === 0}
                className="rounded-full bg-fuchsia px-4 py-1.5 text-sm font-medium text-ink shadow-[0_0_24px_-12px_var(--fuchsia)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-text-tertiary">
          Read-only: the assistant suggests actions, you execute them in
          Mutations. Every prompt + reply is audited.
        </p>
      </div>
    </main>
  );
}

function Bubble({ msg, ghost }: { msg: ChatMsg; ghost?: boolean }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const tone = msg.isError
    ? "border-red-500/40 bg-red-500/10 text-red-100"
    : isUser
      ? "border-fuchsia/40 bg-fuchsia-soft text-ink"
      : isSystem
        ? "border-line bg-paper-elev/60 text-text-secondary italic"
        : "border-line bg-paper-elev/80 text-ink";

  return (
    <div
      className={[
        "max-w-[88%] rounded-2xl border px-4 py-3 text-sm whitespace-pre-wrap",
        tone,
        isUser ? "ml-auto" : "",
        ghost ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-tertiary">
        <span>{msg.role}</span>
        {msg.tokensIn !== undefined && msg.tokensOut !== undefined ? (
          <span>
            · {msg.tokensIn} in / {msg.tokensOut} out
            {msg.costUsd !== undefined ? ` · $${msg.costUsd.toFixed(4)}` : ""}
          </span>
        ) : null}
      </div>
      <div className="font-normal leading-relaxed">{msg.content}</div>
    </div>
  );
}
