// Honest capability lock / messaging.
// Use disabled buttons or lock badges to teach the Clipper vs Agency difference.

import { Lock } from "../icons/BrandGlyphs";

interface CapabilityLockProps {
  label: string;
  reason?: string;
  className?: string;
}

export function CapabilityLock({
  label,
  reason = "Locked in this mode",
  className = "",
}: CapabilityLockProps): JSX.Element {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border border-text-secondary/20 bg-paper px-2.5 py-1 text-xs text-text-secondary",
        className,
      ].join(" ")}
      title={reason}
    >
      <Lock size={12} />
      {label}
    </span>
  );
}
