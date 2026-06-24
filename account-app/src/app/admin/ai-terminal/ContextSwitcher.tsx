"use client";

import type { TerminalContext } from "@/lib/ai-terminal-prompts";

// 3-button pill switcher. Pure presentational — state lives in the parent
// Terminal. We deliberately render 3 labels (no overflow / hidden menu)
// because Daniel's mental model maps each one to a column of the HQ.

const OPTIONS: { id: TerminalContext; label: string; hint: string }[] = [
  { id: "users", label: "Users", hint: "last 200, 30d" },
  { id: "inbox", label: "Inbox", hint: "last 100 messages" },
  { id: "webhooks", label: "Webhooks", hint: "last 200 events" },
];

export function ContextSwitcher({
  value,
  onChange,
  disabled,
}: {
  value: TerminalContext;
  onChange: (next: TerminalContext) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Investigation context"
      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper-warm/60 p-1 backdrop-blur"
    >
      {OPTIONS.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={[
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "bg-fuchsia text-ink shadow-[0_0_24px_-12px_var(--fuchsia)]"
                : "text-text-secondary hover:bg-paper-elev hover:text-ink",
            ].join(" ")}
            title={opt.hint}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="ml-2 text-[10px] uppercase tracking-wider opacity-70">
              {opt.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
