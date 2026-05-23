import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch (e) {
          console.warn("copy failed:", e);
        }
      }}
      className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
