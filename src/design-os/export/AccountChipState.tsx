/**
 * AccountChipState · Phase 6H · §12.3 canonical 11-state renderer
 *
 * Single source of state→visual mapping for every account chip in the app:
 *   ClipCard · ExportPanel target row · Schedule rows · Channels tiles ·
 *   Campaign template editor.
 *
 * NO surface re-implements the state→visual mapping. They all use this one.
 *
 * Variants:
 *   - "row"   — full-width row (Schedule + Channels tile usage)
 *   - "chip"  — compact (TargetAccountsRow inside ExportPanel)
 *   - "tile"  — square (Channels grid · Campaign template)
 */

import type { TargetAccount, AccountState } from "./types";
import "./AccountChipState.css";

export type AccountChipVariant = "row" | "chip" | "tile";

export interface AccountChipStateProps {
  account: TargetAccount;
  variant?: AccountChipVariant;
  /** When true, render an "x" remove button. */
  removable?: boolean;
  onRemove?: () => void;
  /** Click handler for the chip body. */
  onClick?: () => void;
  /** When true, suppress brand badge (Clipper UI hides brand). */
  hideBrand?: boolean;
}

interface StateMeta {
  ringClass: string;
  glyph: string;        // unicode glyph or short text
  copyLine?: (a: TargetAccount) => string;
  ariaSuffix: (a: TargetAccount) => string;
}

const META: Record<AccountState, StateMeta> = {
  "no-accounts": {
    ringClass: "is-empty",
    glyph: "+",
    copyLine: () => "Add account",
    ariaSuffix: () => "no accounts connected",
  },
  "connected": {
    ringClass: "is-connected",
    glyph: "",
    copyLine: (a) => a.handle,
    ariaSuffix: () => "connected · click to target",
  },
  "active-target": {
    ringClass: "is-target",
    glyph: "★",
    copyLine: (a) => `Targeted · ${a.handle}`,
    ariaSuffix: () => "will publish here · click to remove",
  },
  "scheduled": {
    ringClass: "is-scheduled",
    glyph: "⏱",
    copyLine: (a) => a.scheduledFor ? `Sched · ${shortTime(a.scheduledFor)}` : "Scheduled",
    ariaSuffix: (a) => a.scheduledFor ? `scheduled for ${a.scheduledFor}` : "scheduled",
  },
  "uploading": {
    ringClass: "is-uploading",
    glyph: "↑",
    copyLine: () => "Uploading…",
    ariaSuffix: () => "uploading",
  },
  "posted": {
    ringClass: "is-posted",
    glyph: "✓",
    copyLine: (a) => a.postUrl ? "Posted · view" : "Posted",
    ariaSuffix: () => "posted · click to view",
  },
  "failed": {
    ringClass: "is-failed",
    glyph: "!",
    copyLine: (a) => `Failed${a.retryCount != null ? ` · ${a.retryCount}/3 tries` : ""}`,
    ariaSuffix: () => "failed · click to retry",
  },
  "retrying": {
    ringClass: "is-retrying",
    glyph: "↻",
    copyLine: (a) => a.retryEta ? `Retry · ${shortDuration(a.retryEta)}` : "Retrying…",
    ariaSuffix: (a) => `retrying${a.retryEta ? `, next attempt at ${a.retryEta}` : ""}`,
  },
  "account-expired": {
    ringClass: "is-expired",
    glyph: "⚠",
    copyLine: () => "Reconnect",
    ariaSuffix: () => "token expired · click to relink",
  },
  "plan-limit-reached": {
    ringClass: "is-locked",
    glyph: "🔒",
    copyLine: () => "Upgrade",
    ariaSuffix: () => "plan limit · upgrade to add more",
  },
  "campaign-account-locked": {
    ringClass: "is-campaign-locked",
    glyph: "◆",
    copyLine: () => "Campaign locked",
    ariaSuffix: () => "locked by campaign template",
  },
  "pending-link": {
    ringClass: "is-pending-link",
    glyph: "…",
    copyLine: () => "Linking",
    ariaSuffix: () => "OAuth in flight · waiting for webhook confirmation",
  },
};

const PLATFORM_GLYPH: Record<string, string> = {
  tiktok: "T",
  instagram: "I",
  youtube: "Y",
  x: "X",
  linkedin: "L",
  facebook: "F",
};

export function AccountChipState({
  account, variant = "chip", removable = false, onRemove, onClick, hideBrand = false,
}: AccountChipStateProps) {
  const meta = META[account.state];
  const platformGlyph = PLATFORM_GLYPH[account.platform] ?? "?";
  const cls = [
    "lc-acs",
    `lc-acs-${variant}`,
    meta.ringClass,
  ].join(" ");

  const ariaLabel = `${account.platform} · ${account.handle} · ${meta.ariaSuffix(account)}`;

  return (
    <div className={cls} role={onClick ? "button" : undefined} aria-label={ariaLabel}>
      <button
        type="button"
        className="lc-acs-shell"
        onClick={onClick}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className={`lc-acs-avatar lc-acs-platform-${account.platform}`}>
          {account.avatar ? (
            <img src={account.avatar} alt="" draggable={false} />
          ) : (
            <span className="lc-acs-avatar-initial">{account.handle.replace("@", "").slice(0, 1).toUpperCase()}</span>
          )}
          <span className="lc-acs-platform-glyph">{platformGlyph}</span>
          {meta.glyph && (
            <span className="lc-acs-state-glyph" aria-hidden="true">{meta.glyph}</span>
          )}
        </span>

        {/* CHIP VARIANT · icon-only badge per UX rule.
            - No long text. Only show the scheduled time when state === "scheduled".
            - Hover/title surfaces the full handle + state copy. */}
        {variant === "chip" && account.state === "scheduled" && account.scheduledFor && (
          <span className="lc-acs-time">
            <span className="lc-acs-time-glyph" aria-hidden="true">⏱</span>
            {shortTime(account.scheduledFor)}
          </span>
        )}

        {/* ROW + TILE VARIANTS · detail copy goes here. */}
        {variant !== "chip" && (
          <span className="lc-acs-body">
            <span className="lc-acs-handle">{account.handle}</span>
            <span className="lc-acs-status">{meta.copyLine?.(account)}</span>
            {!hideBrand && account.brandLabel && (
              <span className="lc-acs-brand">{account.brandLabel}</span>
            )}
          </span>
        )}
      </button>
      {removable && (
        <button
          type="button"
          className="lc-acs-remove"
          onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
          aria-label={`Remove ${account.handle} from this clip`}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ---- Small helpers ---- */

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(11, 16); }
}

function shortDuration(eta: string): string {
  try {
    const ms = new Date(eta).getTime() - Date.now();
    if (ms < 0) return "soon";
    const min = Math.floor(ms / 60_000);
    if (min < 1) return "<1m";
    return `${min}m`;
  } catch { return "soon"; }
}
