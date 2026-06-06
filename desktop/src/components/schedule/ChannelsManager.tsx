// Channels sub-tab of the Schedule page (Schedule v2).
//
// Lists every channel the user has linked + "+ Add Channel" button. Channels
// are added one at a time — same flow, repeated. No bulk wizard.

import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Plus, Loader2, RefreshCw } from "lucide-react";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import type { Channel } from "./types";
import { ChannelCard } from "./ChannelCard";
import { AddChannelModal } from "./AddChannelModal";

export function ChannelsManager({
  onOpenAnalytics,
}: {
  /** Analytics Phase 1 — passed through to each ChannelCard so the
   *  "analytics →" link flips SchedulePage's sub-tab. Optional; cards hide
   *  the link when omitted. */
  onOpenAnalytics?: (channelId: string) => void;
} = {}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  // Action-level surface error (rename/refresh/pause/delete/relink).
  const [error, setError] = useState<string | null>(null);
  // Top-level load error — kept separate from action errors so we can render
  // a "couldn't load — retry" banner WITHOUT collapsing into the empty hero
  // (which would lie that the user has zero channels).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await backend.listChannels();
      setChannels(list);
    } catch (e) {
      setLoadError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Subscribe to the legacy social_link_closed event AND schedule a 2s
  // re-load after kicking off any OAuth, so the channels list reflects the
  // freshly active status without the user manually refreshing.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen("social_link_closed", () => { void load(); })
      .then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, [load]);

  async function handleRename(id: string, label: string) {
    try {
      const updated = await backend.patchChannel(id, { label });
      setChannels((cur) => cur.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      setError(humanError(e));
      throw e; // let ChannelCard's local busy-state unwind
    }
  }

  async function handleRefresh(id: string) {
    try {
      const updated = await backend.refreshChannel(id);
      setChannels((cur) => cur.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      setError(humanError(e));
      throw e;
    }
  }

  async function handleTogglePause(c: Channel) {
    try {
      const next = c.status === "paused" ? "active" : "paused";
      const updated = await backend.patchChannel(c.id, { status: next });
      setChannels((cur) => cur.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(humanError(e));
      throw e;
    }
  }

  async function handleDelete(id: string) {
    try {
      await backend.deleteChannel(id);
      setChannels((cur) => cur.filter((c) => c.id !== id));
    } catch (e) {
      setError(humanError(e));
      throw e;
    }
  }

  async function handleLinkNow(c: Channel) {
    // Pending channels — re-open the link window using the relink endpoint
    // (mints a fresh URL — original might be stale). Google + most OAuth
    // providers block embedded webviews, so launch the user's real browser
    // instead of `invoke("open_social_link_window", ...)`.
    try {
      const { link_url } = await backend.relinkChannel(c.id);
      await openExternal(link_url);
      // Optimistic refresh after a short delay so the channel card flips to
      // active without the user re-opening the tab. We still surface errors
      // from the relink mint above, but a soft post-OAuth refresh is best-
      // effort — swallow its errors.
      setTimeout(() => { void load(); }, 2000);
    } catch (e) {
      setError(humanError(e));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-fuchsia" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/5 px-4 py-3">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="font-display text-[14px] font-semibold text-[#DC2626]">
              Couldn't load channels
            </p>
            <p className="truncate font-mono text-[11px] text-[#DC2626]/80">
              {loadError}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DC2626]/50 bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-[#DC2626] hover:bg-[#DC2626]/10"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {error && !loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/5 px-4 py-3">
          <p className="min-w-0 truncate font-mono text-[12px] text-[#DC2626]">
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="rounded-full border border-[#DC2626]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-[#DC2626] hover:bg-[#DC2626]/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadError ? (
        // Don't render the "Add your first channel" hero on a load failure —
        // we don't know whether the user has channels or not.
        null
      ) : channels.length === 0 ? (
        <div className="relative flex flex-col items-center gap-4 bg-transparent px-8 py-12 text-center">
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
          <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
          <span className="grid h-14 w-14 place-items-center rounded-full bg-fuchsia text-paper">
            <Plus size={22} strokeWidth={2.5} />
          </span>
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
            Add your first channel
          </h2>
          <p className="max-w-md font-sans text-[14px] leading-relaxed text-text-secondary">
            Each channel is one social account on one platform (one TikTok handle, one Reels handle, etc.). You can add as many as you need — same flow, repeated. We'll OAuth each one inside the app.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-fuchsia px-6 py-3 font-sans text-[14px] font-medium text-paper hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
          >
            <Plus size={16} strokeWidth={2.5} /> Add channel
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
              {channels.length} channel{channels.length === 1 ? "" : "s"} · same flow to add another
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[13px] font-medium text-paper hover:bg-fuchsia-bright"
            >
              <Plus size={14} strokeWidth={2.5} /> Add channel
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                onRename={(label) => handleRename(c.id, label)}
                onRefresh={() => handleRefresh(c.id)}
                onTogglePause={() => handleTogglePause(c)}
                onDelete={() => handleDelete(c.id)}
                onLinkNow={() => void handleLinkNow(c)}
                onOpenAnalytics={onOpenAnalytics}
              />
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <AddChannelModal
          onClose={() => setAddOpen(false)}
          onCreated={() => void load()}
        />
      )}
    </div>
  );
}
