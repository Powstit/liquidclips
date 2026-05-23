import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// Shared failure UI for the two pipeline-style errors (lift-failed + pipeline
// failed). Beta-gate dignity: every error screen offers Retry, Copy error,
// Email support, and surfaces where the logs live so a clipper has somewhere
// to go besides quitting.

const SUPPORT_EMAIL = "support@jnremployee.com";

export function FailureCard({
  eyebrow,
  heading,
  url,
  error,
  note,
  logHint,
  onRetry,
  retryLabel = "Try again",
  onDismiss,
  dismissLabel = "Back",
  subject,
}: {
  eyebrow: string;
  heading: string;
  url?: string;
  error: string;
  note?: string;
  logHint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss: () => void;
  dismissLabel?: string;
  subject: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopyError() {
    const payload = [
      heading,
      url ? `URL: ${url}` : "",
      logHint || "",
      "",
      error,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* silent */
    }
  }

  function onEmailSupport() {
    const body = encodeURIComponent(
      "What were you doing when this happened?\n\n\n" +
        "--- error (please keep) ---\n" +
        (url ? `URL: ${url}\n` : "") +
        (logHint ? `${logHint}\n` : "") +
        `\n${error}\n`,
    );
    const url2 = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${body}`;
    void openExternal(url2).catch(() => undefined);
  }

  return (
    <div className="w-full max-w-[720px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#DC2626]">
        {eyebrow}
      </div>
      <h2 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {heading}
      </h2>
      {url && (
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{url}</p>
      )}

      <pre className="mt-4 max-h-[260px] overflow-auto rounded-xl border border-line bg-paper-warm/40 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
        {error}
      </pre>

      {logHint && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          {logHint}
        </p>
      )}

      {note && (
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">
          {note}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-paper hover:bg-ink"
          >
            {retryLabel}
          </button>
        )}
        <button
          onClick={() => void onCopyError()}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          {copied ? "Copied ✓" : "Copy error"}
        </button>
        <button
          onClick={onEmailSupport}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Email support →
        </button>
        <button
          onClick={onDismiss}
          className="rounded-full border border-line bg-paper px-4 py-2 font-sans text-[13px] font-medium text-text-secondary hover:border-line hover:text-ink"
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
