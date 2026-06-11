import { cn } from "../../lib/utils";
import type { ChannelStatus } from "../../lib/backend";

type DotStatus = ChannelStatus | "stale" | "no-channel" | "loading";

const DOT_STYLES: Record<DotStatus, string> = {
  active: "bg-green-500",
  pending_link: "bg-amber-400 animate-pulse",
  unlinked: "bg-amber-400 animate-pulse",
  error: "bg-red-500",
  paused: "bg-red-500",
  deleted: "bg-text-tertiary",
  stale: "bg-amber-400 animate-pulse",
  "no-channel": "hidden",
  loading: "bg-text-tertiary animate-pulse",
};

const TOOLTIPS: Record<DotStatus, string> = {
  active: "Connected and ready",
  pending_link: "Finish linking in your browser",
  unlinked: "Disconnected — click to reconnect",
  error: "Connection error — click to retry",
  paused: "Paused — resume in Settings",
  deleted: "Channel removed",
  stale: "Ayrshare says linked — verifying",
  "no-channel": "Not connected",
  loading: "Checking connection…",
};

export function ConnectionDot({
  status,
  className,
}: {
  status: DotStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        DOT_STYLES[status],
        className
      )}
      title={TOOLTIPS[status]}
      aria-label={TOOLTIPS[status]}
    />
  );
}
