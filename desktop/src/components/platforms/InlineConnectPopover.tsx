import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ExternalLink, X } from "lucide-react";
import { humanError } from "../../lib/sidecar";
import { createChannel, refreshChannel } from "../../lib/backend";
import { openSmart } from "../../lib/openSmart";
import type { ChannelPlatform } from "../../lib/backend";
import { PlatformGlyph } from "../PlatformBadge";
import { prettyPlatform } from "../schedule/types";

type PopoverState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "polling"; channelId: string; linkUrl: string }
  | { kind: "success" }
  | { kind: "error"; message: string };

export function InlineConnectPopover({
  platform,
  onConnected,
  onCancel,
}: {
  platform: ChannelPlatform;
  onConnected: () => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<PopoverState>({ kind: "idle" });
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [clearTimer]);

  const start = useCallback(async () => {
    setState({ kind: "creating" });
    try {
      const resp = await createChannel({ platform, label: prettyPlatform(platform) });
      if (cancelledRef.current) return;
      if (resp.link_url) {
        setState({ kind: "polling", channelId: resp.channel.id, linkUrl: resp.link_url });
        await openSmart(resp.link_url);
        // Poll for 90s
        let attempts = 0;
        timerRef.current = setInterval(async () => {
          attempts++;
          if (cancelledRef.current || attempts > 60) {
            clearTimer();
            if (!cancelledRef.current) {
              setState({ kind: "error", message: "Timed out — try again or finish in Settings → Channels." });
            }
            return;
          }
          try {
            const refreshed = await refreshChannel(resp.channel.id);
            if (cancelledRef.current) return;
            if (refreshed.status === "active") {
              clearTimer();
              setState({ kind: "success" });
              onConnected();
            }
          } catch {
            // ignore polling errors, keep trying
          }
        }, 1500);
      } else {
        setState({ kind: "error", message: "No link returned — try Settings → Channels." });
      }
    } catch (e) {
      if (!cancelledRef.current) {
        setState({ kind: "error", message: humanError(e) });
      }
    }
  }, [platform, onConnected, clearTimer]);

  if (state.kind === "success") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-fuchsia/30 bg-fuchsia/10 px-6 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-fuchsia text-white">
          <PlatformGlyph id={platform} className="h-5 w-5" />
        </div>
        <p className="font-sans text-[13px] font-medium text-fuchsia">
          {prettyPlatform(platform)} connected!
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-6 py-5">
        <p className="font-sans text-[12px] text-[var(--color-danger)]">{humanError(state.message)}</p>
        <div className="flex gap-2">
          <button
            onClick={start}
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
          >
            Retry
          </button>
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 font-sans text-[12px] text-text-secondary hover:text-ink"
          >
            <X className="h-3 w-3" /> Not now
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "polling") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-fuchsia/30 bg-fuchsia/10 px-6 py-5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-fuchsia" />
          <p className="font-sans text-[12px] font-medium text-fuchsia">
            Waiting for {prettyPlatform(platform)}…
          </p>
        </div>
        <p className="font-sans text-[11px] text-text-secondary">
          Finish the auth in your browser, then come back here.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => void openSmart(state.linkUrl)}
            className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia hover:bg-fuchsia/10"
          >
            <ExternalLink className="h-3 w-3" /> Open browser again
          </button>
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-fuchsia/30 bg-fuchsia/10 px-6 py-5">
      <div className="flex items-center gap-2">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{ backgroundColor: "#000", color: "white" }}
        >
          <PlatformGlyph id={platform} className="h-4 w-4" />
        </div>
        <div>
          <p className="font-sans text-[13px] font-medium text-ink">
            Connect {prettyPlatform(platform)}
          </p>
          <p className="font-sans text-[11px] text-text-secondary">
            Post this clip directly to your {prettyPlatform(platform)} feed.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => void start()}
          disabled={state.kind === "creating"}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
        >
          {state.kind === "creating" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Starting…
            </>
          ) : (
            <>
              <ExternalLink className="h-3 w-3" /> Authorize with Ayrshare
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 font-sans text-[12px] text-text-secondary hover:text-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
