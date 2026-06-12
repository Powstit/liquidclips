import { useState } from "react";
import { openSmart as openExternal } from "../lib/openSmart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// Shared failure UI for the two pipeline-style errors (lift-failed + pipeline
// failed). Beta-gate dignity: every error screen offers Retry, Copy error,
// Email support, and surfaces where the logs live so a clipper has somewhere
// to go besides quitting.

// v0.7.54 — canonical Liquid Clips support inbox (mirrors marketing site
// `liquidclips-marketing/src/lib/site.ts:supportEmail`).
const SUPPORT_EMAIL = "hello@liquidclips.app";

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
    <div className="library-card relative w-full max-w-[720px] bg-transparent p-6">
      <span className="library-card-corner-tl" aria-hidden="true" />
      <span className="library-card-corner-tr" aria-hidden="true" />
      <span className="library-card-corner-bl" aria-hidden="true" />
      <span className="library-card-corner-br" aria-hidden="true" />
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-danger)]">
        {eyebrow}
      </div>
      <h2 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {heading}
      </h2>
      {url && (
        <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{url}</p>
      )}

      <div className="cockpit-frame relative mt-4 rounded-xl bg-transparent">
        <span className="cockpit-tile-corner-tl" aria-hidden="true" />
        <span className="cockpit-tile-corner-tr" aria-hidden="true" />
        <span className="cockpit-tile-corner-bl" aria-hidden="true" />
        <span className="cockpit-tile-corner-br" aria-hidden="true" />
        <pre className="max-h-[260px] overflow-auto rounded-xl bg-transparent p-3 font-mono text-[11px] leading-relaxed text-text-secondary">{error}</pre>
      </div>

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
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white hover:bg-fuchsia-bright"
          >
            {retryLabel}
          </button>
        )}
        <button
          onClick={() => void onCopyError()}
          className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          {copied ? "Copied ✓" : "Copy error"}
        </button>
        <button
          onClick={onEmailSupport}
          className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-ink hover:border-fuchsia hover:text-fuchsia-deep"
        >
          Email support →
        </button>
        <button
          onClick={onDismiss}
          className="rounded-full border border-line bg-transparent px-4 py-2 font-sans text-[13px] font-medium text-text-secondary hover:border-line hover:text-ink"
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
