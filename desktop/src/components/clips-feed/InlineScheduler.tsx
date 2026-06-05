// v0.6.4 — Inline scheduler. Lives ON the clip card; no modal.
//
// Daniel's locked direction (no drawer, no modal): every clip should
// show its publish state on the card itself. Click `▸ Schedule` → the
// card expands an inline section with channel chips + caption + time presets
// + one submit button. Submit fires backend.publishNow and the section
// collapses into a status row.
//
// Channel-first path: Schedule v2 channels post via their own Ayrshare
// profiles. Legacy platform chips remain only as a fallback for users who
// have not migrated from the single SocialConnection profile yet.
//
// Failure modes: tier gate (free can't multi-publish), no connection,
// no rendered vertical_path, backend down. Each surfaces inline; the
// scheduler never throws unhandled.

import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  backend,
  createChannel,
  listChannels,
  refreshChannel,
  socialGetConnection,
  type Channel,
  type ConnectionPlatform,
  type SocialConnectionState,
} from "../../lib/backend";
import { sidecar, humanError, type Clip } from "../../lib/sidecar";
import { CheckCircle2, ChevronDown, Loader2, Send, Clock, ExternalLink, RefreshCw } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import { prettyPlatform } from "../schedule/types";

const PLATFORM_LABELS: Record<ConnectionPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
};

const PLATFORM_LIMITS: Record<ConnectionPlatform, number> = {
  youtube: 5000,
  tiktok: 2200,
  instagram: 2200,
  x: 280,
};

const CHANNEL_CAPTION_LIMITS: Record<string, number> = {
  youtube: 5000,
  tiktok: 2200,
  instagram: 2200,
  x: 280,
  linkedin: 3000,
  facebook: 63206,
  threads: 500,
};

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "linking"; platform: ConnectionPlatform; channelId: string; linkUrl: string }
  | { kind: "scheduled"; at: string; count: number; targetKind: "channel" | "account" }
  | { kind: "error"; message: string };

type Props = {
  clip: Clip;
  /** Used to mint the title + description fallback. */
  projectTitle?: string;
  /** Compact display: when true, the toggle button uses smaller chrome
   *  to fit the existing inline-actions row. */
  compact?: boolean;
};

export function InlineScheduler({ clip, projectTitle, compact: _compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [conn, setConn] = useState<SocialConnectionState | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Set<ConnectionPlatform>>(new Set());
  const [pickedChannelIds, setPickedChannelIds] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState(clip.description || clip.title || projectTitle || "");
  const [when, setWhen] = useState<"now" | "1h" | "24h">("now");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [connectingPlatform, setConnectingPlatform] = useState<ConnectionPlatform | null>(null);

  // Lazy-load connection state only when the scheduler opens — saves a
  // network round-trip per clip card on Workspace.
  useEffect(() => {
    if (!open || conn !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (cancelled) return;
        if (!jwt) {
          setAuthed(false);
          return;
        }
        setAuthed(true);
        const [state, channelRows] = await Promise.all([
          socialGetConnection(),
          listChannels(),
        ]);
        if (cancelled) return;
        const activeChannels = channelRows.filter((c) => c.status === "active");
        setChannels(activeChannels);
        setConn(state);
        setPickedChannelIds(new Set(activeChannels.map((c) => c.id)));
        // Default-check every connected platform — Daniel's locked
        // direction: "schedule to all attached accounts by default". This
        // legacy fallback is used only when the user has not migrated to
        // Schedule v2 channels yet.
        const all = new Set(
          (state?.platforms ?? [])
            .map((p) => p.toLowerCase() as ConnectionPlatform)
            .filter((p): p is ConnectionPlatform => p in PLATFORM_LABELS),
        );
        setPicked(all);
      } catch {
        if (!cancelled) setStatus({ kind: "error", message: "Couldn't load your connections — try again in a moment." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conn]);

  async function reloadConnections() {
    const [state, channelRows] = await Promise.all([
      socialGetConnection(),
      listChannels(),
    ]);
    const activeChannels = channelRows.filter((c) => c.status === "active");
    setConn(state);
    setChannels(activeChannels);
    setPickedChannelIds((cur) => {
      const next = new Set(cur);
      for (const c of activeChannels) next.add(c.id);
      return next;
    });
    setPicked(
      new Set(
        (state?.platforms ?? [])
          .map((p) => p.toLowerCase() as ConnectionPlatform)
          .filter((p): p is ConnectionPlatform => p in PLATFORM_LABELS),
      ),
    );
  }

  async function connectPlatform(platform: ConnectionPlatform) {
    if (connectingPlatform) return;
    setConnectingPlatform(platform);
    setStatus({ kind: "idle" });
    try {
      const { channel, link_url } = await createChannel({
        platform,
        label: `${PLATFORM_LABELS[platform]} #1`,
      });
      await openExternal(link_url);
      setStatus({ kind: "linking", platform, channelId: channel.id, linkUrl: link_url });

      let latest = channel;
      for (const delay of [3_000, 7_000, 12_000, 20_000]) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        latest = await refreshChannel(channel.id);
        if (latest.status === "active") break;
      }
      await reloadConnections();
      if (latest.status === "active") {
        setPickedChannelIds((cur) => new Set(cur).add(latest.id));
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "linking", platform, channelId: channel.id, linkUrl: link_url });
      }
    } catch (e) {
      setStatus({ kind: "error", message: humanError(e) });
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function refreshPendingConnection() {
    if (status.kind !== "linking") return;
    setConnectingPlatform(status.platform);
    try {
      const refreshed = await refreshChannel(status.channelId);
      await reloadConnections();
      if (refreshed.status === "active") {
        setPickedChannelIds((cur) => new Set(cur).add(refreshed.id));
        setStatus({ kind: "idle" });
      }
    } catch (e) {
      setStatus({ kind: "error", message: humanError(e) });
    } finally {
      setConnectingPlatform(null);
    }
  }

  function toggle(p: ConnectionPlatform) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function toggleChannel(id: string) {
    setPickedChannelIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function scheduledAtIso(): string | null {
    if (when === "now") return null;
    const d = new Date();
    if (when === "1h") d.setHours(d.getHours() + 1);
    else if (when === "24h") d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  async function submit() {
    const videoPath =
      clip.remix?.active_path?.vertical ||
      clip.overlay?.applied_paths?.vertical ||
      clip.vertical_path;
    if (!videoPath) {
      setStatus({ kind: "error", message: "This clip has no rendered file yet. Cut from the editor first." });
      return;
    }
    const hasChannels = channels.length > 0;
    if (hasChannels && pickedChannelIds.size === 0) {
      setStatus({ kind: "error", message: "Pick at least one channel." });
      return;
    }
    if (!hasChannels && picked.size === 0) {
      setStatus({ kind: "error", message: "Pick at least one account." });
      return;
    }
    setStatus({ kind: "busy" });
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setStatus({ kind: "error", message: "Sign in to Liquid Clips first." });
        return;
      }
      const scheduledAt = scheduledAtIso();
      let ok = 0;
      if (hasChannels) {
        const ids = Array.from(pickedChannelIds);
        const results = await Promise.all(
          ids.map((channelId) =>
            backend.publishNow(jwt, {
              filePath: videoPath,
              title: clip.title,
              description: caption,
              platforms: [],
              channelId,
              scheduledAt,
            }),
          ),
        );
        ok = results.reduce((sum, targets) => sum + targets.length, 0);
      } else {
        const targets = await backend.publishNow(jwt, {
          filePath: videoPath,
          title: clip.title,
          description: caption,
          platforms: Array.from(picked),
          scheduledAt,
        });
        ok = targets.length;
      }
      const label =
        when === "now" ? "live now" : when === "1h" ? "in 1 hour" : "in 24 hours";
      setStatus({ kind: "scheduled", at: label, count: ok, targetKind: hasChannels ? "channel" : "account" });
      setOpen(false);
    } catch (e) {
      setStatus({ kind: "error", message: humanError(e) });
    }
  }

  // Collapsed status — once a clip has been scheduled, the card stays
  // in the success state until the user expands the scheduler again.
  if (status.kind === "scheduled" && !open) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-fuchsia/40 bg-fuchsia/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        <CheckCircle2 className="h-3 w-3" />
        scheduled · {status.count} {status.targetKind}{status.count === 1 ? "" : "s"} · {status.at}
        <button
          onClick={() => {
            setStatus({ kind: "idle" });
            setOpen(true);
          }}
          className="ml-1 underline-offset-2 hover:underline"
        >
          edit
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-semibold text-white shadow-[0_0_14px_rgba(255,26,140,0.4)] transition-all hover:bg-fuchsia-bright"
      >
        <Send className="h-3 w-3" />
        Schedule
      </button>
    );
  }

  // Expanded inline scheduler — channel chips first, legacy platform chips as
  // fallback for existing single-profile users.
  const connected = conn?.platforms ?? [];
  const allPlatforms: ConnectionPlatform[] = ["youtube", "tiktok", "instagram", "x"];
  const hasChannels = channels.length > 0;
  const selectedCount = hasChannels ? pickedChannelIds.size : picked.size;

  return (
    <section className="flex w-full flex-col gap-3 rounded-2xl border border-fuchsia/35 bg-paper-warm/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
          <Send className="h-3 w-3" />
          schedule this clip
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-full p-1 text-text-tertiary hover:text-ink"
          aria-label="Collapse scheduler"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Account chips */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
          {hasChannels ? "channels" : "accounts"}
        </span>
        {authed === false ? (
          <p className="font-sans text-[12px] text-text-secondary">
            Sign in to Liquid Clips first to schedule clips.
          </p>
        ) : conn === null ? (
          <div className="flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" />
            reading channels…
          </div>
        ) : hasChannels ? (
          <div className="flex flex-wrap gap-2">
            {channels.map((channel) => {
              const selected = pickedChannelIds.has(channel.id);
              const id = channel.platform as PlatformId;
              const known = ["youtube", "tiktok", "instagram", "x"].includes(id);
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => toggleChannel(channel.id)}
                  className={
                    selected
                      ? "inline-flex items-center gap-2 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-3 py-1.5 font-sans text-[12px] font-semibold text-fuchsia"
                      : "inline-flex items-center gap-2 rounded-full border border-line bg-paper-elev px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                  }
                  title={`${prettyPlatform(channel.platform)} ${channel.handle ?? channel.label}`}
                >
                  <span className={selected ? "grid h-5 w-5 place-items-center rounded-full bg-fuchsia text-paper" : "grid h-5 w-5 place-items-center rounded-full bg-ink text-paper"}>
                    {known ? <PlatformIcon id={id} className="h-2.5 w-2.5" /> : (
                      <span className="font-mono text-[9px]">{channel.platform[0]?.toUpperCase()}</span>
                    )}
                  </span>
                  <span className="max-w-[150px] truncate">{channel.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allPlatforms.map((p) => {
              const isConnected = connected.includes(p);
              const isPicked = picked.has(p);
              const isConnecting = connectingPlatform === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => isConnected ? toggle(p) : void connectPlatform(p)}
                  disabled={!!connectingPlatform && !isConnecting}
                  className={
                    isPicked
                      ? "rounded-full border-2 border-fuchsia bg-fuchsia/15 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia"
                      : isConnected
                      ? "rounded-full border border-line bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                      : "rounded-full border border-dashed border-fuchsia/35 bg-fuchsia/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:border-fuchsia hover:bg-fuchsia/15 disabled:opacity-50"
                  }
                  title={isConnected ? `${PLATFORM_LABELS[p]} — toggle to fire` : `Connect ${PLATFORM_LABELS[p]} now`}
                >
                  {PLATFORM_LABELS[p]}{isConnected ? "" : isConnecting ? " · opening…" : " · connect"}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Caption — single box for v0.6.4; per-platform editing in v0.6.5 */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
          caption
        </span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          className="resize-none rounded-xl border border-line bg-ink/40 px-3 py-2 font-sans text-[13px] text-ink focus:border-fuchsia focus:outline-none"
        />
        {selectedCount > 0 ? (
          <div className="flex flex-wrap gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
            {(hasChannels ? channels.filter((c) => pickedChannelIds.has(c.id)) : Array.from(picked)).map((item) => {
              const p = typeof item === "string" ? item : item.platform;
              const limit = hasChannels
                ? CHANNEL_CAPTION_LIMITS[p] ?? 2200
                : PLATFORM_LIMITS[p as ConnectionPlatform];
              const over = caption.length > limit;
              return (
                <span
                  key={typeof item === "string" ? item : item.id}
                  className={over ? "text-[#DC2626]" : "text-text-tertiary"}
                >
                  {prettyPlatform(p).toUpperCase()} {caption.length}/{limit}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* When */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
          when
        </span>
        <div className="flex flex-wrap gap-2">
          {(["now", "1h", "24h"] as const).map((k) => {
            const active = when === k;
            const label = k === "now" ? "▸ now" : k === "1h" ? "+ 1 hour" : "+ 24 hours";
            return (
              <button
                key={k}
                type="button"
                onClick={() => setWhen(k)}
                className={
                  active
                    ? "inline-flex items-center gap-1 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-3 py-1 font-sans text-[12px] font-medium text-fuchsia"
                    : "inline-flex items-center gap-1 rounded-full border border-line bg-paper-elev px-3 py-1 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                }
              >
                {k !== "now" && <Clock className="h-3 w-3" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={status.kind === "busy" || selectedCount === 0 || authed === false}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-fuchsia px-5 py-2 font-sans text-[13px] font-semibold text-white shadow-[0_0_22px_rgba(255,26,140,0.5)] transition-all hover:bg-fuchsia-bright disabled:opacity-40"
      >
        {status.kind === "busy" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> scheduling…
          </>
        ) : (
          <>
            <Send className="h-3 w-3" />
            Schedule to {selectedCount} {hasChannels ? "channel" : "account"}{selectedCount === 1 ? "" : "s"}
          </>
        )}
      </button>

      {status.kind === "error" ? (
        <p className="font-mono text-[11px] text-[#DC2626]">{status.message}</p>
      ) : null}

      {status.kind === "linking" ? (
        <div className="rounded-xl border border-fuchsia/30 bg-fuchsia/10 px-3 py-3">
          <div className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-fuchsia" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-[12px] font-medium text-fuchsia">
                Finish {PLATFORM_LABELS[status.platform]} in your browser
              </p>
              <p className="mt-0.5 font-sans text-[11px] leading-relaxed text-text-secondary">
                Once the browser says connected, come back here. Liquid Clips will pick it up and select it for this clip.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void refreshPendingConnection()}
                  disabled={!!connectingPlatform}
                  className="inline-flex items-center gap-1 rounded-full border border-fuchsia/40 bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fuchsia hover:bg-fuchsia/10 disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh accounts
                </button>
                <button
                  type="button"
                  onClick={() => void openExternal(status.linkUrl)}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open browser again
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
