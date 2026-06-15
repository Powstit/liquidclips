import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy as CopyIcon, Check } from "lucide-react";

export function CopyButton({
  text,
  label = "Copy",
  icon = false,
}: {
  text: string;
  label?: string;
  /** v0.7.78 — Icon-only variant for inline copy affordances next to
   *  generated text blocks (titles, transcripts, pinned comments).
   *  Renders a small 28px square button with a Copy glyph + tooltip.
   *  Same writeText path. Default false preserves the existing pill chrome. */
  icon?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("copy failed:", e);
    }
  }

  if (icon) {
    return (
      <button
        type="button"
        onClick={() => void handleCopy()}
        title={copied ? "Copied" : label}
        aria-label={copied ? "Copied" : label}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border bg-paper transition-colors ${
          copied
            ? "border-fuchsia text-fuchsia-deep"
            : "border-line text-text-tertiary hover:border-fuchsia hover:text-fuchsia-deep"
        }`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        ) : (
          <CopyIcon className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
