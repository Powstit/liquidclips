// Per-window account-binding chip.
//
// Renders a tiny clickable chip on each workbench window header that shows
// which channels that window will fan out to when scheduled. Click → popover
// with a checklist of every channel from the user's account.
//
// VISUAL VOCABULARY — matches the existing cockpit/scheduler language:
//   • fuchsia border, transparent fill
//   • font-mono [10px] uppercase tracking-[0.16em] labels
//   • cockpit-tile-corner brackets on the popover
//   • PlatformIcon for known platforms, mono fallback glyph for new ones
//
// EMPTY-STATE: when no channels exist at all, we don't dead-end the user
// inside the popover. We point them at Settings → Connections (the same
// destination InlineScheduler uses for its empty branch) so the journey
// continues out of the chip rather than terminating in it.
//
// PERSISTENCE: store.bindChannels writes through to localStorage via the
// existing persistedSession debounce (Agent 1) — bindings survive reboot.

import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { listChannels, type Channel } from "../../lib/backend";
import type { WindowId } from "./types";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import windowEmptyBindUrl from "../../assets/workbench/window-empty-bind.png";

// The four platforms PlatformIcon ships glyphs for. Anything else falls
// back to a mono first-letter pill (same pattern as InlineScheduler line
// ~567 — `known` check).
const KNOWN_PLATFORM_IDS: ReadonlySet<string> = new Set<PlatformId>([
  "youtube",
  "tiktok",
  "instagram",
  "x",
]);

function isKnownPlatform(p: string): p is PlatformId {
  return KNOWN_PLATFORM_IDS.has(p);
}

/** Small avatar glyph for a single channel — used in the stack AND the
 *  popover row. Mono fallback when PlatformIcon doesn't ship the glyph. */
function ChannelAvatar({
  channel,
  size = "h-5 w-5",
  iconSize = "h-2.5 w-2.5",
}: {
  channel: Channel;
  size?: string;
  iconSize?: string;
}) {
  const platform = channel.platform;
  return (
    <span
      className={`grid place-items-center rounded-full bg-ink text-paper ${size}`}
      aria-label={`${platform} ${channel.label}`}
    >
      {isKnownPlatform(platform) ? (
        <PlatformIcon id={platform} className={iconSize} />
      ) : (
        <span className="font-mono text-[8px] uppercase">
          {platform[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </span>
  );
}

export function AccountBindingChip({ windowId }: { windowId: WindowId }) {
  // Per-window selector keeps re-renders tight: only this chip re-runs when
  // its own boundChannelIds change. Falls back to [] so a transient missing
  // window (e.g. mid-remove) doesn't crash the chrome bar.
  const boundChannelIds = useWorkbenchStore(
    (s) => s.windows.get(windowId)?.boundChannelIds ?? [],
  );
  const bindChannels = useWorkbenchStore((s) => s.bindChannels);

  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Channel lookup map — selecting from boundChannelIds without scanning the
  // whole list every render.
  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const c of channels ?? []) m.set(c.id, c);
    return m;
  }, [channels]);

  const boundChannels = useMemo(() => {
    const out: Channel[] = [];
    for (const id of boundChannelIds) {
      const c = channelsById.get(id);
      if (c) out.push(c);
    }
    return out;
  }, [boundChannelIds, channelsById]);

  // Fetch only when the popover opens. PREVENTS an N-windows = N parallel
  // /channels fetches stampede on workbench mount. Re-fetch on every open
  // so a user who connects a channel in Settings sees it without restarting.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadState("loading");
    setErrorMsg(null);
    (async () => {
      try {
        const list = await listChannels();
        if (cancelled) return;
        setChannels(list);
        setLoadState("loaded");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Couldn't load channels.");
        setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Dismiss the popover on outside click / Esc. PREVENTS keyboard trap and
  // the "click another window's chip, both popovers open" race.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggleChannel(id: string) {
    const next = boundChannelIds.includes(id)
      ? boundChannelIds.filter((x) => x !== id)
      : [...boundChannelIds, id];
    bindChannels(windowId, next);
  }

  const hasBindings = boundChannelIds.length > 0;
  const visible = boundChannels.slice(0, 3);
  const overflow = boundChannels.length - visible.length;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          hasBindings
            ? `Bound to ${boundChannelIds.length} channel${boundChannelIds.length === 1 ? "" : "s"} — tap to edit`
            : "Tap to bind channels"
        }
        title={
          hasBindings
            ? `${boundChannelIds.length} channel${boundChannelIds.length === 1 ? "" : "s"} bound`
            : "Tap to bind channels"
        }
        className={
          hasBindings
            ? "inline-flex items-center gap-1 rounded-full border border-fuchsia/60 bg-paper-elev/60 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia transition-colors hover:border-fuchsia hover:bg-fuchsia/10"
            : "inline-flex items-center gap-1.5 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-fuchsia shadow-[0_0_10px_rgba(255,26,140,0.45)] transition-all hover:bg-fuchsia/25"
        }
      >
        {hasBindings ? (
          <>
            <span className="flex -space-x-1.5">
              {boundChannels.length === 0
                ? // Bindings exist by id but channel list hasn't loaded yet —
                  // show a neutral count so we don't render an empty stack
                  // that looks like "tap to bind" again.
                  null
                : visible.map((c) => (
                    <ChannelAvatar key={c.id} channel={c} />
                  ))}
            </span>
            {overflow > 0 && <span className="ml-0.5">+{overflow}</span>}
            {boundChannels.length === 0 && (
              <span>{boundChannelIds.length} bound</span>
            )}
          </>
        ) : (
          <>
            <img
              src={windowEmptyBindUrl}
              alt=""
              aria-hidden
              className="h-3.5 w-3.5"
            />
            <span>tap to bind</span>
          </>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Bind channels to this window"
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-72 rounded-xl border border-fuchsia/40 bg-paper p-3 shadow-[0_12px_36px_rgba(0,0,0,0.45)]"
        >
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
              bind channels
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary hover:text-ink"
            >
              close
            </button>
          </div>

          {loadState === "loading" || loadState === "idle" ? (
            <p className="font-mono text-[11px] text-text-tertiary">
              reading channels…
            </p>
          ) : loadState === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="font-sans text-[12px] text-[#DC2626]">
                {errorMsg ?? "Couldn't read your channels."}
              </p>
              <button
                type="button"
                onClick={() => {
                  // Re-trigger the fetch effect by toggling the open flag.
                  setLoadState("idle");
                  setOpen(false);
                  // Re-open on the next tick so the effect re-runs.
                  setTimeout(() => setOpen(true), 0);
                }}
                className="inline-flex w-fit items-center rounded-full border border-fuchsia/40 bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia hover:bg-fuchsia/10"
              >
                retry
              </button>
            </div>
          ) : channels && channels.length === 0 ? (
            // STRANDS guard: a user with zero channels would otherwise see
            // an empty popover with no way forward. Mirror InlineScheduler's
            // "open Settings → Connections" CTA so the journey continues.
            <div className="flex flex-col gap-2">
              <p className="font-sans text-[12px] text-text-secondary">
                No channels yet — connect one to start scheduling clips.
              </p>
              <p className="font-mono text-[11px] text-text-tertiary">
                Open Settings → Connections to add a platform.
              </p>
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
              {channels!.map((channel) => {
                const selected = boundChannelIds.includes(channel.id);
                const pendingLink = channel.status === "pending_link";
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => toggleChannel(channel.id)}
                    disabled={pendingLink}
                    aria-pressed={selected}
                    title={
                      pendingLink
                        ? "Finish linking this channel in Settings before binding."
                        : `${channel.platform} · ${channel.handle ?? channel.label}`
                    }
                    className={
                      selected
                        ? "flex items-center gap-2 rounded-lg border border-fuchsia bg-fuchsia/15 px-2 py-1.5 text-left font-sans text-[12px] text-fuchsia"
                        : "flex items-center gap-2 rounded-lg border border-line bg-paper-elev px-2 py-1.5 text-left font-sans text-[12px] text-text-secondary hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
                    }
                  >
                    <ChannelAvatar channel={channel} />
                    <span className="min-w-0 flex-1 truncate">{channel.label}</span>
                    <span
                      aria-hidden
                      className={
                        selected
                          ? "font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia"
                          : "font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary"
                      }
                    >
                      {pendingLink ? "pending" : selected ? "on" : "off"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
