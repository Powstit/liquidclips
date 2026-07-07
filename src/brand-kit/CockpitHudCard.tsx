import type { ReactNode } from "react";

interface CockpitHudCardProps {
  clipNo?: string;
  title: string;
  meta?: string;
  thumbLabel?: string;
  strip?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}

export function CockpitHudCard({
  clipNo,
  title,
  meta,
  thumbLabel,
  strip,
  children,
  onClick,
}: CockpitHudCardProps) {
  return (
    <div className="cockpit-tile" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      {clipNo && <div className="cockpit-tile-clipno">{clipNo}</div>}
      <div className="cockpit-tile-title">{title}</div>
      {meta && <div className="cockpit-tile-meta">{meta}</div>}
      <div className="cockpit-tile-thumb">
        {thumbLabel && <div className="cockpit-tile-thumb-label">{thumbLabel}</div>}
      </div>
      {strip && strip}
      <span className="cockpit-tile-corner-bl" />
      <span className="cockpit-tile-corner-br" />
      {children}
    </div>
  );
}
