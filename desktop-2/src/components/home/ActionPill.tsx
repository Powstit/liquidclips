import type { ReactNode } from "react";
import { Lock } from "../icons/BrandGlyphs";

interface ActionPillProps {
  label: string;
  helper?: string;
  icon?: ReactNode;
  locked?: boolean;
  primary?: boolean;
  onClick?: () => void;
}

export function ActionPill({
  label,
  helper,
  icon,
  locked = false,
  primary = false,
  onClick,
}: ActionPillProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
        primary
          ? "border-fuchsia/40 bg-fuchsia/10 text-fuchsia hover:bg-fuchsia/20"
          : "border-line bg-paper-elev/60 text-ink hover:border-fuchsia/40 hover:bg-paper-elev",
        locked ? "opacity-80" : "",
      ].join(" ")}
    >
      {icon && (
        <span
          className={[
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            primary ? "bg-fuchsia/20 text-fuchsia" : "bg-line/50 text-text-secondary",
          ].join(" ")}
        >
          {locked ? <Lock size={14} /> : icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium leading-tight">{label}</span>
        {helper && (
          <span className="truncate text-[11px] leading-tight text-text-tertiary">{helper}</span>
        )}
      </span>
    </button>
  );
}
