// StatusChip — brand-aligned status pill for campaign rows.
// Tones map to the brand kit: live → ok (mint), draft/coming_soon →
// neutral, partially_funded/funded → accent, closed → danger.

type Tone = "ok" | "warn" | "accent" | "fail" | "neutral";

const TONE: Record<Tone, { color: string; bg: string; border: string }> = {
  ok: {
    color: "rgb(77 198 168)",
    bg: "rgba(77, 198, 168, 0.10)",
    border: "rgba(77, 198, 168, 0.42)",
  },
  warn: {
    color: "rgb(217 155 45)",
    bg: "rgba(217, 155, 45, 0.10)",
    border: "rgba(217, 155, 45, 0.42)",
  },
  accent: {
    color: "var(--fuchsia)",
    bg: "var(--fuchsia-soft)",
    border: "rgba(255, 26, 140, 0.40)",
  },
  fail: {
    color: "rgb(239 105 105)",
    bg: "rgba(220, 38, 38, 0.10)",
    border: "rgba(220, 38, 38, 0.40)",
  },
  neutral: {
    color: "var(--text-tertiary)",
    bg: "rgba(255, 255, 255, 0.04)",
    border: "var(--line)",
  },
};

const STATUS_TONE: Record<string, Tone> = {
  live: "ok",
  funded: "ok",
  partially_funded: "accent",
  coming_soon: "warn",
  pending_reward: "warn",
  draft: "neutral",
  closed: "fail",
  unlinked: "neutral",
  unreachable: "warn",
  not_visible: "warn",
};

export function StatusChip({
  status,
  size = "sm",
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const t = STATUS_TONE[status] ?? "neutral";
  const m = TONE[t];
  const px = size === "md" ? "px-3 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-full border font-mono uppercase tracking-[0.1em] ${px}`}
      style={{ color: m.color, background: m.bg, borderColor: m.border }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
