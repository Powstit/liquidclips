// Channels sub-tab of the Schedule page (Schedule v2).
//
// Lists every channel the user has linked + "+ Add Channel" button. Channels
// are added one at a time — same flow, repeated. No bulk wizard.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Loader2 } from "lucide-react";
import * as backend from "../../lib/backend";
import type { Channel } from "./types";
import { ChannelCard } from "./ChannelCard";
import { AddChannelModal } from "./AddChannelModal";

export function ChannelsManager() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await backend.listChannels();
      setChannels(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleRename(id: string, label: string) {
    const updated = await backend.patchChannel(id, { label });
    setChannels((cur) => cur.map((c) => (c.id === id ? updated : c)));
  }

  async function handleRefresh(id: string) {
    const updated = await backend.refreshChannel(id);
    setChannels((cur) => cur.map((c) => (c.id === id ? updated : c)));
  }

  async function handleTogglePause(c: Channel) {
    const next = c.status === "paused" ? "active" : "paused";
    const updated = await backend.patchChannel(c.id, { status: next });
    setChannels((cur) => cur.map((x) => (x.id === c.id ? updated : x)));
  }

  async function handleDelete(id: string) {
    await backend.deleteChannel(id);
    setChannels((cur) => cur.filter((c) => c.id !== id));
  }

  async function handleLinkNow(c: Channel) {
    // Pending channels — re-open the link window using the relink endpoint
    // (mints a fresh URL — original might be stale).
    try {
      const { link_url } = await backend.relinkChannel(c.id);
      await invoke("open_social_link_window", { url: link_url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      {error && (
        <p className="rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/5 px-4 py-3 font-mono text-[12px] text-[#DC2626]">
          {error}
        </p>
      )}

      {channels.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-fuchsia/40 bg-fuchsia-soft/10 px-8 py-12 text-center">
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
