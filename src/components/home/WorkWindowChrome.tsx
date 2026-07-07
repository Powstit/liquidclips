// WorkWindowChrome — shared inner layout for Import / Thumbnail / Script
// drawers. Sits inside the Sheet primitive (which owns the title bar + close)
// and gives each drawer the same lead-row · body · footer rhythm so they no
// longer feel like one-off modals.
//
// Slots:
//   icon      — lead icon (left of lead title)
//   title     — drawer title (next to icon)
//   subtitle  — drawer subtitle (under title)
//   badge     — optional SOON / BETA badge next to title
//   children  — body content (input, dropzone, etc.)
//   primary   — primary CTA (pinned bottom-right)
//   secondary — optional secondary action (left of primary)
//   handoff   — Engine handoff button (pinned bottom-left)
//
// Visual only — no behaviour change.

import type { ReactNode } from "react";

interface WorkWindowChromeProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  handoff?: ReactNode;
}

export function WorkWindowChrome({
  icon,
  title,
  subtitle,
  badge,
  children,
  primary,
  secondary,
  handoff,
}: WorkWindowChromeProps): JSX.Element {
  return (
    <div className="lc-workwindow" data-work-window="root">
      <div className="lc-workwindow-lead">
        <div className="lc-workwindow-lead-icon" aria-hidden="true">{icon}</div>
        <div className="lc-workwindow-lead-text">
          <div className="lc-workwindow-lead-title">
            <span>{title}</span>
            {badge}
          </div>
          {subtitle ? <div className="lc-workwindow-lead-sub">{subtitle}</div> : null}
        </div>
      </div>

      {children ? <div className="lc-workwindow-body">{children}</div> : null}

      <div className="lc-workwindow-footer">
        <div className="lc-workwindow-footer-left">
          {handoff}
        </div>
        <div className="lc-workwindow-footer-right">
          {secondary}
          {primary}
        </div>
      </div>
    </div>
  );
}
