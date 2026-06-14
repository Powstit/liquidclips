import { useState } from "react";
import { MailIcon, Copy } from "lucide-react";
import { openSmart as openExternal } from "../lib/openSmart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// Shared failure UI for the two pipeline-style errors (lift-failed + pipeline
// failed). Beta-gate dignity: every error screen offers Retry, Copy error,
// Copy support email, Email support, and surfaces where the logs live so a
// clipper has somewhere to go besides quitting.

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
  const [copiedSupport, setCopiedSupport] = useState(false);
  const [emailFallback, setEmailFallback] = useState(false);

  function buildErrorPayload() {
    return [heading, url ? `URL: ${url}` : "", logHint || "", "", error]
      .filter(Boolean)
      .join("\n");
  }

  function buildSupportPayload() {
    return [
      SUPPORT_EMAIL,
      `Subject: ${subject}`,
      "",
      "What were you doing when this happened?",
      "",
      "--- error (please keep) ---",
      url ? `URL: ${url}` : "",
      logHint || "",
      error,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function onCopyError() {
    try {
      await writeText(buildErrorPayload());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* silent */
    }
  }

  async function onCopySupportEmail() {
    try {
      await writeText(buildSupportPayload());
      setCopiedSupport(true);
      window.setTimeout(() => setCopiedSupport(false), 1800);
    } catch {
      /* silent */
    }
  }

  async function onEmailSupport() {
    const body = encodeURIComponent(
      "What were you doing when this happened?\n\n\n" +
        "--- error (please keep) ---\n" +
        (url ? `URL: ${url}\n` : "") +
        (logHint ? `${logHint}\n` : "") +
        `\n${error}\n`,
    );
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${body}`;

    try {
      await openExternal(mailtoUrl);
    } catch {
      // No mail client available — copy the support email + prefilled subject
      // / body to the clipboard and surface inline microcopy.
      try {
        await writeText(buildSupportPayload());
        setEmailFallback(true);
        window.setTimeout(() => setEmailFallback(false), 4000);
      } catch {
        /* silent */
      }
    }
  }

  return (
    <div className="w-full max-w-[720px] space-y-4">
      {/* Danger header */}
      <div className="error-banner">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {eyebrow}
          </div>
          <h2 className="mt-0.5 font-display text-[20px] font-semibold leading-tight tracking-[-0.02em]">
            {heading}
          </h2>
          {url && (
            <p className="mt-0.5 truncate font-mono text-[11px] opacity-80">
              {url}
            </p>
          )}
        </div>
      </div>

      {/* Error detail block */}
      <div className="empty-state space-y-3">
        <pre className="max-h-[260px] overflow-auto rounded-xl bg-paper/60 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
          {error}
        </pre>

        {logHint && (
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            {logHint}
          </p>
        )}

        {note && (
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            {note}
          </p>
        )}

        {emailFallback && (
          <p className="font-sans text-[13px] text-fuchsia-deep">
            Couldn&apos;t open your mail app. Support email copied to clipboard.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onRetry && (
            <button onClick={onRetry} className="btn-primary">
              {retryLabel}
            </button>
          )}
          <button
            onClick={() => void onCopyError()}
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied ✓" : "Copy error"}
          </button>
          <button
            onClick={() => void onCopySupportEmail()}
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            <MailIcon className="h-3.5 w-3.5" />
            {copiedSupport ? "Copied ✓" : "Copy support email"}
          </button>
          <button
            onClick={onEmailSupport}
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            <MailIcon className="h-3.5 w-3.5" />
            Email support →
          </button>
          <button onClick={onDismiss} className="btn-secondary">
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
