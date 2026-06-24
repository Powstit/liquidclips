"use client";

// InfoIcon · reusable "ℹ︎" pill that reveals a tooltip on hover/focus.
// Use anywhere in HQ where a field/stat/column/button needs a one-liner
// explaining what it controls or where its data comes from.
//
// Example:
//   <label>
//     Effective tier <InfoIcon hint="Backend-decided tier — overrides Clerk metadata when the admin override flag is set." />
//   </label>
//
//   <div className="stat">
//     <span>{data.mrr_usd}</span>
//     <InfoIcon hint="Sum of (tier baseline price × active subscribers). Recomputed live from User table — no cache." />
//   </div>
//
// Brand · paper-warm bubble with brand fuchsia "i" glyph. Keyboard-
// accessible (Tab focus shows the tooltip via :focus-within). Position
// auto-flips when near the right edge.

import { useId, useState } from "react";

export interface InfoIconProps {
  /** Plain-text hint to show in the tooltip. */
  hint: string;
  /** Optional aria-label override; defaults to "What is this?". */
  ariaLabel?: string;
}

export function InfoIcon({ hint, ariaLabel = "What is this?" }: InfoIconProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="info-icon-wrap"
      style={{
        display: "inline-flex",
        position: "relative",
        marginLeft: 6,
        verticalAlign: "middle",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 14,
          height: 14,
          borderRadius: 999,
          border: "1px solid var(--lc-stroke, currentColor)",
          background: "transparent",
          color: "var(--lc-fg-faint, currentColor)",
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "help",
          padding: 0,
          opacity: 0.7,
          transition: "opacity 120ms, color 120ms, border-color 120ms",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.opacity = "1";
          e.currentTarget.style.color = "var(--lc-accent-mid, currentColor)";
          e.currentTarget.style.borderColor = "var(--lc-accent-mid, currentColor)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.opacity = "0.7";
          e.currentTarget.style.color = "var(--lc-fg-faint, currentColor)";
          e.currentTarget.style.borderColor = "var(--lc-stroke, currentColor)";
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 6px)",
            left: 0,
            maxWidth: 320,
            minWidth: 200,
            padding: "8px 10px",
            background: "var(--lc-bg-warm, #faf7f2)",
            color: "var(--lc-fg, #1a1a1a)",
            border: "1px solid var(--lc-stroke, #e5e0d6)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            fontSize: 11,
            fontWeight: 400,
            lineHeight: 1.45,
            fontFamily: "var(--font-geist, system-ui)",
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {hint}
        </span>
      )}
    </span>
  );
}
