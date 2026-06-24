import { cn } from "../../lib/utils";
import type { ChannelStatus } from "../../lib/backend";

type DotStatus = ChannelStatus | "stale" | "no-channel" | "loading";

// Brand-consistency-audit P0 #5 (2026-06-25):
// Brand kit explicitly bans green / amber / red accents — success state is
// fuchsia-deep (not green), warning is fuchsia-deep (not amber), error is
// the --color-danger token. Active state earns the bright fuchsia accent so
// "connected" reads as the same single accent everywhere else on the surface.
const DOT_STYLES: Record<DotStatus, string> = {
  active: "bg-fuchsia-deep",
  pending_link: "bg-fuchsia-deep animate-pulse",
  unlinked: "bg-fuchsia-deep animate-pulse",
  error: "bg-[var(--color-danger)]",
  paused: "bg-[var(--color-danger)]",
  deleted: "bg-text-tertiary",
  stale: "bg-fuchsia-deep animate-pulse",
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
