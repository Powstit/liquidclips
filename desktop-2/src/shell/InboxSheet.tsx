/**
 * InboxSheet · right-edge slide-in overlay opened from TopHud's avatar
 * menu. FEATURE-001 promoted this from a fixture-driven stub into a
 * real surface backed by `src/inbox/store.ts`.
 *
 * - Reads records via `inbox.getAll()`.
 * - Subscribes to `inbox:added` / `inbox:read` / `inbox:email-state`
 *   for live refresh (no polling).
 * - Mark-read writes back through `inbox.markRead` so the badge in
 *   TopHud and any other subscriber stays consistent.
 * - Shows an honest empty state ("Inbox · coming soon") when no
 *   records exist — same copy contract BUG-046 locked.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { bus } from "../design-os/bridge";
import {
  getAll, markRead as storeMarkRead, markAllRead as storeMarkAllRead,
  retryEmail,
} from "../inbox";
import type { InboxRecord } from "../inbox";
import { openInApp } from "../lib/openInApp";
import "./InboxSheet.css";

interface InboxSheetProps {
  open: boolean;
  onClose: () => void;
  onUnreadChange?: (n: number) => void;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.max(1, Math.floor((now - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const KIND_LABEL: Record<InboxRecord["kind"], string> = {
  "clip-generation-complete": "Clips ready",
  "export-complete":          "Export complete",
  "export-failed":            "Export failed",
  "reaction-bake-complete":   "Reaction baked",
  "trim-regenerate-complete": "Trim updated",
  "caption-apply-complete":   "Captions ready",
  "backend-offline-warning":  "Backend offline",
  "watermark-warning":        "Watermark",
  "tier-warning":             "Tier",
  "system":                   "System",
  "welcome":                  "Welcome",
  // 2026-06-23 monetisation kinds
  "billing.upgrade_required":      "Upgrade",
  "billing.checkout_started":      "Checkout",
  "billing.checkout_failed":       "Checkout failed",
  "billing.subscription_active":   "Plan active",
  "billing.subscription_past_due": "Payment due",
  "billing.subscription_cancelled":"Cancelled",
  "billing.cap_reached":           "Cap reached",
  "campaign.publish_blocked":      "Campaign",
  "bonus.milestone_reached":       "Bonus",
  "bonus.subscription_required":   "Bonus",
  "bonus.pending_clearance":       "Bonus",
  "bonus.approved":                "Bonus approved",
  "bonus.rejected":                "Bonus rejected",
  "bonus.paid":                    "Bonus paid",
};

const EMAIL_STATE_LABEL: Record<NonNullable<InboxRecord["email"]>["status"], string> = {
  not_sent:        "Email not sent",
  not_configured:  "Email not configured",
  sending:         "Email sending…",
  sent:            "Email sent",
  failed:          "Email failed",
};

export function InboxSheet({ open, onClose, onUnreadChange }: InboxSheetProps) {
  const [messages, setMessages] = useState<InboxRecord[]>(() => getAll());

  /* Subscribe to inbox bus events for live refresh — no polling. */
  useEffect(() => {
    const refresh = () => setMessages(getAll());
    const off1 = bus.on("inbox:added", refresh);
    const off2 = bus.on("inbox:read", refresh);
    const off3 = bus.on("inbox:email-state", refresh);
    return () => { off1(); off2(); off3(); };
  }, []);

  const unread = useMemo(
    () => messages.reduce((n, m) => n + (m.readAt ? 0 : 1), 0),
    [messages],
  );

  useEffect(() => {
    onUnreadChange?.(unread);
  }, [unread, onUnreadChange]);

  /* Escape closes. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onCtaClick = async (m: InboxRecord) => {
    storeMarkRead(m.id);
    if (!m.href) return;
    if (m.href.startsWith("#/")) {
      window.location.hash = m.href.slice(1);
      onClose();
      return;
    }
    try {
      await openInApp(m.href, { intent: "read-only" });
    } catch {
      /* The CTA stays read; the overlay/system fallback owns error feedback. */
    }
  };

  const onRetryEmail = (id: string) => {
    void retryEmail(id);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="lc-inbox-overlay"
      data-testid="inbox-overlay"
      data-inbox-state={messages.length === 0 ? "coming-soon" : "real"}
      data-inbox-message-count={String(messages.length)}
      data-inbox-unread-count={String(unread)}
      role="dialog"
      aria-label="Inbox"
      aria-modal="true"
    >
      <div className="lc-inbox-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="lc-inbox-sheet">
        <header className="lc-inbox-header">
          <div>
            <span className="lc-inbox-eb">Inbox</span>
            <h2 className="lc-inbox-title">Notifications</h2>
          </div>
          <div className="lc-inbox-header-actions">
            {unread > 0 && (
              <button
                type="button"
                className="lc-inbox-mark"
                data-testid="inbox-mark-all-read"
                onClick={() => storeMarkAllRead()}
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              className="lc-inbox-close"
              aria-label="Close inbox"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {messages.length === 0 ? (
          <div className="lc-inbox-empty" data-testid="inbox-coming-soon">
            <p className="lc-inbox-empty-title">Inbox · coming soon</p>
            <p className="lc-inbox-empty-sub" data-testid="inbox-coming-soon-copy">
              Notifications will land here as you generate, export, and
              ship clips. No fake messages are shown.
            </p>
          </div>
        ) : (
          <ul className="lc-inbox-list" data-testid="inbox-list">
            {messages.map((m) => (
              <li
                key={m.id}
                className="lc-inbox-item"
                data-testid={`inbox-item-${m.id}`}
                data-unread={m.readAt ? "false" : "true"}
                data-kind={m.kind}
                data-email-status={m.email?.status ?? "none"}
              >
                <div className="lc-inbox-row">
                  <span className="lc-inbox-kind">{KIND_LABEL[m.kind]}</span>
                  <span className="lc-inbox-time">{formatRelative(m.receivedAt)}</span>
                </div>
                <p className="lc-inbox-msg-title">{m.title}</p>
                <p className="lc-inbox-msg-body">{m.body}</p>
                {m.email && (
                  <div
                    className="lc-inbox-email-status"
                    data-testid={`inbox-email-status-${m.id}`}
                    data-email-status={m.email.status}
                  >
                    {EMAIL_STATE_LABEL[m.email.status]}
                    {m.email.status === "failed" && (
                      <button
                        type="button"
                        className="lc-inbox-email-retry"
                        data-testid={`inbox-email-retry-${m.id}`}
                        onClick={() => onRetryEmail(m.id)}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {m.href && m.ctaLabel && (
                  <button
                    type="button"
                    className="lc-inbox-cta"
                    onClick={() => void onCtaClick(m)}
                  >
                    {m.ctaLabel} →
                  </button>
                )}
                {!m.readAt && (
                  <button
                    type="button"
                    className="lc-inbox-cta lc-inbox-cta-ghost"
                    data-testid={`inbox-mark-read-${m.id}`}
                    onClick={() => storeMarkRead(m.id)}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <footer className="lc-inbox-footer">
          <span>Inbox is the source of truth · email is a delivery adapter.</span>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
