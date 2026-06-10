// ship-lens v0.7.8 P3 — Stop silently dropping non-active channels.
//
// Previously `channelRows.filter((c) => c.status === "active")` collapsed
// error / paused / pending_link / unlinked channels into a phantom "no
// channels" empty state, so a user whose TikTok session had expired saw
// "No platforms connected yet — pick one to start scheduling clips" with
// fresh dashed connect chips — as if the system had forgotten they ever
// linked TikTok. Same family of bug as v0.7.7 #7 (ChannelPicker).
//
// Fix: render ALL non-deleted channels. Active ones stay clickable +
// selectable. Non-active ones render as disabled chips with a status-aware
// hint and resume-the-flow click target where applicable.
//
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
import { openSmart as openExternal } from "../../lib/openSmart";
import {
  backend,
  createChannel,
  diagnoseChannel,
  listChannels,
  refreshChannel,
  relinkChannel,
  socialGetConnectionStrict,
  type Channel,
  type ConnectionPlatform,
  type SocialConnectionState,
} from "../../lib/backend";
import { sidecar, humanError, type Clip } from "../../lib/sidecar";
import { CheckCircle2, ChevronDown, Loader2, Send, Clock, ExternalLink, RefreshCw, Stethoscope } from "lucide-react";
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
  | { kind: "scheduled"; at: string; count: number; total: number; targetKind: "channel" | "account" }
  | { kind: "error"; message: string };

// Explicit four-way load state for the connection fetch. The implicit
// `conn === null` sentinel collapsed "drawer never opened", "fetch in-flight",
// "user has no row (empty-state)", and "transport failed" into one branch,
// which is how the master account got stuck on a permanent "reading channels…"
// loader when they had zero channels connected.
type ConnLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; conn: SocialConnectionState | null }
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
  const [connLoadState, setConnLoadState] = useState<ConnLoadState>({ kind: "idle" });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Derived: the legacy SocialConnectionState (or null), so the rest of the
  // component can keep reading `conn` without rewiring every consumer.
  const conn: SocialConnectionState | null =
    connLoadState.kind === "loaded" ? connLoadState.conn : null;
  const [picked, setPicked] = useState<Set<ConnectionPlatform>>(new Set());
  const [pickedChannelIds, setPickedChannelIds] = useState<Set<string>>(new Set());
  const [caption, setCaption] = useState(clip.description || clip.title || projectTitle || "");
  const [when, setWhen] = useState<"now" | "1h" | "24h">("now");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [connectingPlatform, setConnectingPlatform] = useState<ConnectionPlatform | null>(null);
  // Diagnose affordance — fires diagnoseChannel(id) against the pending_link
  // channel sitting in status.kind === "linking" and shows the backend's
  // recommended_action inline. ENABLES the user to see WHY the OAuth dance
  // hasn't completed instead of clicking "Refresh accounts" in a loop.
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);

  async function runDiagnose(channelId: string) {
    setDiagnosing(true);
    setDiagnoseError(null);
    try {
      const result = await diagnoseChannel(channelId);
      setDiagnosis(result.recommended_action);
    } catch (e) {
      setDiagnoseError(humanError(e));
      setDiagnosis(null);
    } finally {
      setDiagnosing(false);
    }
  }

  // Lazy-load connection state only when the scheduler opens — saves a
  // network round-trip per clip card on Workspace. Re-fetches on every
  // re-open so the chip list reflects connections added in Settings while
  // the drawer was closed (previously the `conn` dep made stale caches stick).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setConnLoadState({ kind: "loading" });
    void (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (cancelled) return;
        if (!jwt) {
          setAuthed(false);
          // Treat "no JWT" as a cleanly-loaded empty state — the auth gate
          // below renders the sign-in copy and the connect chips stay
          // suppressed because authed === false.
          setConnLoadState({ kind: "loaded", conn: null });
          return;
        }
        setAuthed(true);
        // socialGetConnectionStrict distinguishes "no row" from "backend
        // down" so the empty-state path and the retry path no longer share
        // the same `conn === null` sentinel.
        const [strict, channelRows] = await Promise.all([
          socialGetConnectionStrict(),
          listChannels(),
        ]);
        if (cancelled) return;
        // ship-lens v0.7.8 P3 — Keep every non-deleted channel so the chip
        // row truthfully shows the user's accounts; only "active" channels
        // get the default-on selection so we don't silently try to schedule
        // to a TikTok with a revoked token.
        const visibleChannels = channelRows.filter((c) => c.status !== "deleted");
        const activeChannels = visibleChannels.filter((c) => c.status === "active");
        const state: SocialConnectionState | null =
          strict === "no-connection" ? null : strict;
        setChannels(visibleChannels);
        setConnLoadState({ kind: "loaded", conn: state });
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
      } catch (e) {
        if (!cancelled) {
          setConnLoadState({
            kind: "error",
            message: humanError(e) || "Couldn't read your connections — try again.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function reloadConnections() {
    try {
      const [strict, channelRows] = await Promise.all([
        socialGetConnectionStrict(),
        listChannels(),
      ]);
      // ship-lens v0.7.8 P3 — Same fix as the initial-load path: surface
      // non-active channels (pending_link / error / paused / unlinked) with
      // a recovery hint instead of dropping them from the chip row.
      const visibleChannels = channelRows.filter((c) => c.status !== "deleted");
      const activeChannels = visibleChannels.filter((c) => c.status === "active");
      const state: SocialConnectionState | null =
        strict === "no-connection" ? null : strict;
      setConnLoadState({ kind: "loaded", conn: state });
      setChannels(visibleChannels);
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
    } catch (e) {
      setConnLoadState({
        kind: "error",
        message: humanError(e) || "Couldn't read your connections — try again.",
      });
    }
  }

  /** Retry button handler for the empty/error branch — re-runs the same
   * fetch path that the open-effect uses. Keeps a single source of truth
   * for the loading transition by flipping back to `loading` first. */
  async function refreshConnections() {
    setConnLoadState({ kind: "loading" });
    await reloadConnections();
  }

  async function connectPlatform(platform: ConnectionPlatform) {
    if (connectingPlatform) return;
    setConnectingPlatform(platform);
    setStatus({ kind: "idle" });
    try {
      // Reuse an existing non-deleted channel for this platform if one is
      // already provisioned. The previous version called createChannel
      // unconditionally and spawned a fresh Ayrshare sub-profile on every
      // click — Daniel's actual TikTok handle was bound to the FIRST
      // sub-profile but every subsequent click made a new empty one, so
      // the OAuth never reattached anything and "TikTok link" appeared
      // broken. The backend now upserts too, but the desktop short-cut
      // saves a round-trip + makes the rescue UI work.
      const existing = channels.find(
        (c) => c.platform === platform && c.status !== "deleted",
      );
      let channelId: string;
      let linkUrl: string;
      if (existing) {
        const r = await relinkChannel(existing.id);
        channelId = r.channel.id;
        linkUrl = r.link_url;
      } else {
        const r = await createChannel({
          platform,
          label: `${PLATFORM_LABELS[platform]} #1`,
        });
        channelId = r.channel.id;
        linkUrl = r.link_url;
      }
      await openExternal(linkUrl);
      setStatus({ kind: "linking", platform, channelId, linkUrl });

      let latest = await refreshChannel(channelId);
      for (const delay of [3_000, 7_000, 12_000, 20_000]) {
        if (latest.status === "active") break;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        latest = await refreshChannel(channelId);
      }
      await reloadConnections();
      if (latest.status === "active") {
        setPickedChannelIds((cur) => new Set(cur).add(latest.id));
        setStatus({ kind: "idle" });
      } else {
        // Stay in the linking state — the rescue UI below (Open link again /
        // I finished — recheck) takes over so the user has a clear next
        // action instead of staring at a stuck spinner.
        setStatus({ kind: "linking", platform, channelId, linkUrl });
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
      const label =
        when === "now" ? "live now" : when === "1h" ? "in 1 hour" : "in 24 hours";
      const targetKind: "channel" | "account" = hasChannels ? "channel" : "account";

      if (hasChannels) {
        // Per-channel publishNow calls are independent — one platform's API
        // failure (e.g. TikTok rate-limit) used to abort Promise.all and
        // swallow N-1 successes that DID land on the server. allSettled lets
        // us surface "scheduled K of N" instead of lying that everything
        // failed.
        // ship-lens v0.7.8 P3 — Filter the selection to currently-active
        // channels at submit time. A channel that flipped to unlinked / error
        // / pending_link between the user's pick and the submit must NOT be
        // pushed to Ayrshare; the backend would just reject it with a
        // confusing per-platform error.
        const activeIds = new Set(
          channels.filter((c) => c.status === "active").map((c) => c.id),
        );
        const ids = Array.from(pickedChannelIds).filter((id) => activeIds.has(id));
        if (ids.length === 0) {
          setStatus({
            kind: "error",
            message: "None of the selected channels are active — reconnect at least one before scheduling.",
          });
          return;
        }
        const settled = await Promise.allSettled(
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
        const okCalls = settled.filter((r) => r.status === "fulfilled").length;
        const failedCalls = settled.length - okCalls;
        // Sum of PublishedTarget rows across fulfilled calls — backend
        // returns one row per posted platform, but for channels that's
        // always 1, so this matches okCalls in practice. Keep the reduce
        // so behaviour matches if backend ever returns multiple targets.
        const okTargets = settled.reduce(
          (sum, r) =>
            r.status === "fulfilled" ? sum + (r.value?.length ?? 0) : sum,
          0,
        );
        if (failedCalls === 0) {
          setStatus({ kind: "scheduled", at: label, count: okTargets, total: ids.length, targetKind });
          setOpen(false);
        } else if (okCalls === 0) {
          // Pull the first rejection's message so the user gets something
          // concrete instead of a generic failure copy.
          const firstError = settled.find((r) => r.status === "rejected") as
            | PromiseRejectedResult
            | undefined;
          const msg = firstError ? humanError(firstError.reason) : "";
          setStatus({
            kind: "error",
            message: msg
              ? `Couldn't schedule any of ${ids.length} channels — ${msg}`
              : `Couldn't schedule any of ${ids.length} channels — try again.`,
          });
        } else {
          // Partial success — stay open so the user can SEE the X-of-Y
          // count and retry the failed ones without re-picking everything.
          setStatus({ kind: "scheduled", at: label, count: okCalls, total: ids.length, targetKind });
        }
      } else {
        const targets = await backend.publishNow(jwt, {
          filePath: videoPath,
          title: clip.title,
          description: caption,
          platforms: Array.from(picked),
          scheduledAt,
        });
        const ok = targets.length;
        setStatus({ kind: "scheduled", at: label, count: ok, total: picked.size, targetKind });
        setOpen(false);
      }
    } catch (e) {
      setStatus({ kind: "error", message: humanError(e) });
    }
  }

  // Collapsed status — once a clip has been scheduled, the card stays
  // in the success state until the user expands the scheduler again.
  if (status.kind === "scheduled" && !open) {
    const partial = status.total > 0 && status.count < status.total;
    return (
      <div className="flex items-center gap-2 rounded-full border border-fuchsia/40 bg-fuchsia/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        <CheckCircle2 className="h-3 w-3" />
        scheduled · {partial
          ? `${status.count} of ${status.total} ${status.targetKind}${status.total === 1 ? "" : "s"}`
          : `${status.count} ${status.targetKind}${status.count === 1 ? "" : "s"}`} · {status.at}
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
  // v0.7.16 — surface WHY the schedule button is disabled when the only
  // channels we have are non-active (pending_link / unlinked / error). The
  // raw "Schedule to 0 channels" copy made Daniel think the picker had a
  // bug; really he needed to finish OAuth on the IG channel before it
  // could count.
  const anyActiveChannel = hasChannels && channels.some((c) => c.status === "active");
  const allChannelsNeedLinking = hasChannels && !anyActiveChannel;
  // Distinguish "user is signed in but has zero connections of any kind"
  // (the master-account-stuck-on-loader bug) from the legacy single-profile
  // fallback where the user HAS a SocialConnection row with platforms but no
  // v2 channels yet. The latter should keep showing the legacy connect/toggle
  // chips; only the former gets the new empty-state copy.
  const isLoadedEmpty =
    connLoadState.kind === "loaded" &&
    !hasChannels &&
    (connLoadState.conn?.platforms?.length ?? 0) === 0;

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
        ) : connLoadState.kind === "idle" || connLoadState.kind === "loading" ? (
          <div className="flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
            <Loader2 className="h-3 w-3 animate-spin" />
            reading channels…
          </div>
        ) : connLoadState.kind === "error" ? (
          // PREVENTS the infinite "reading channels…" stuck-loader when the
          // strict fetch rejects — gives the user a visible retry path
          // instead of a permanent spinner.
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2"
          >
            <p className="font-sans text-[12px] text-[var(--color-danger)]">
              {connLoadState.message || "Couldn't read your connections — try again."}
            </p>
            <button
              type="button"
              onClick={() => void refreshConnections()}
              className="inline-flex w-fit items-center gap-1 rounded-full border border-[var(--color-danger)]/40 bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        ) : isLoadedEmpty ? (
          // ENABLES a master account (or any first-time user) with zero
          // channels AND zero legacy platforms to start a connect flow
          // directly from the scheduler — previously they hit a permanent
          // "reading channels…" loader because `conn === null` was the
          // sentinel for "still loading" AND "loaded but empty".
          <div className="flex flex-col gap-2">
            <p className="font-sans text-[12px] text-text-secondary">
              No platforms connected yet — pick one to start scheduling clips.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["tiktok", "instagram", "youtube", "x"] as ConnectionPlatform[]).map((p) => {
                const isConnecting = connectingPlatform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void connectPlatform(p)}
                    disabled={!!connectingPlatform && !isConnecting}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-fuchsia/35 bg-fuchsia/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:border-fuchsia hover:bg-fuchsia/15 disabled:opacity-50"
                    title={`Connect ${PLATFORM_LABELS[p]} now`}
                  >
                    <PlatformIcon id={p} className="h-3 w-3" />
                    Connect {PLATFORM_LABELS[p]}
                    {isConnecting ? " · opening…" : ""}
                  </button>
                );
              })}
            </div>
            <p className="font-mono text-[11px] text-text-tertiary">
              Or open Settings → Connections for the full list.
            </p>
          </div>
        ) : hasChannels ? (
          // ship-lens v0.7.8 P3 — Render EVERY non-deleted channel so the
          // user can see (and act on) error / paused / pending_link /
          // unlinked rows instead of seeing the chip silently disappear.
          // Active rows toggle on click. Non-active rows resume their flow
          // (pending_link / unlinked → re-open OAuth; error → relink;
          // paused → instruct user to Settings, since pause is owned
          // there). The hint is the title attribute so a hover surfaces
          // WHY the row is unselectable.
          <div className="flex flex-wrap gap-2">
            {channels.map((channel) => {
              const id = channel.platform as PlatformId;
              const known = ["youtube", "tiktok", "instagram", "x"].includes(id);
              const selected = pickedChannelIds.has(channel.id);
              const platform = channel.platform;
              const platformPretty = prettyPlatform(platform);
              const view = chipViewFor(channel.status);
              const isActive = view.kind === "active";
              const canResume =
                (view.kind === "pending" || view.kind === "unlinked" || view.kind === "error")
                && platform in PLATFORM_LABELS;
              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      toggleChannel(channel.id);
                    } else if (canResume) {
                      // Resume the OAuth dance on the existing channel.
                      // Same path as connectPlatform → prefers relink so the
                      // backend doesn't spawn a fresh sub-profile that would
                      // strand the real handle on the OLD one.
                      void connectPlatform(platform as ConnectionPlatform);
                    }
                    // paused rows are intentionally inert here — pause is
                    // a Settings-owned action; clicking should not flip it
                    // from this surface.
                  }}
                  // pickedChannelIds only gets seeded from active rows, so
                  // disabling here is purely visual; even without disabled
                  // a non-active row's onClick path does the right thing.
                  disabled={!isActive && !canResume}
                  className={
                    isActive
                      ? selected
                        ? "inline-flex items-center gap-2 rounded-full border-2 border-fuchsia bg-fuchsia/15 px-3 py-1.5 font-sans text-[12px] font-semibold text-fuchsia"
                        : "inline-flex items-center gap-2 rounded-full border border-line bg-paper-elev px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia"
                      : view.kind === "paused"
                      ? "inline-flex items-center gap-2 rounded-full border border-text-tertiary/40 bg-text-tertiary/5 px-3 py-1.5 font-sans text-[12px] font-medium text-text-tertiary opacity-80"
                      : view.kind === "unlinked" || view.kind === "error"
                      ? "inline-flex items-center gap-2 rounded-full border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-1.5 font-sans text-[12px] font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
                      : // pending_link
                        "inline-flex items-center gap-2 rounded-full border border-fuchsia-deep/40 bg-fuchsia-deep/10 px-3 py-1.5 font-sans text-[12px] font-medium text-fuchsia-deep hover:bg-fuchsia-deep/15"
                  }
                  title={
                    isActive
                      ? `${platformPretty} ${channel.handle ?? channel.label}`
                      : `${platformPretty} ${channel.label} — ${view.hint}`
                  }
                >
                  <span
                    className={
                      isActive
                        ? selected
                          ? "grid h-5 w-5 place-items-center rounded-full bg-fuchsia text-paper"
                          : "grid h-5 w-5 place-items-center rounded-full bg-ink text-paper"
                        : view.kind === "paused"
                        ? "grid h-5 w-5 place-items-center rounded-full bg-text-tertiary text-paper"
                        : view.kind === "unlinked" || view.kind === "error"
                        ? "grid h-5 w-5 place-items-center rounded-full bg-[var(--color-danger)] text-paper"
                        : "grid h-5 w-5 place-items-center rounded-full bg-fuchsia-deep text-paper"
                    }
                  >
                    {known ? (
                      <PlatformIcon id={id} className="h-2.5 w-2.5" />
                    ) : (
                      <span className="font-mono text-[9px]">{channel.platform[0]?.toUpperCase()}</span>
                    )}
                  </span>
                  <span className="max-w-[180px] truncate">
                    {isActive ? channel.label : `${channel.label} · ${view.badge}`}
                  </span>
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
                  className={over ? "text-[var(--color-danger)]" : "text-text-tertiary"}
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
        ) : allChannelsNeedLinking && selectedCount === 0 ? (
          <>
            <Send className="h-3 w-3" />
            Finish linking a channel first
          </>
        ) : (
          <>
            <Send className="h-3 w-3" />
            Schedule to {selectedCount} {hasChannels ? "channel" : "account"}{selectedCount === 1 ? "" : "s"}
          </>
        )}
      </button>

      {status.kind === "error" ? (
        <p className="font-mono text-[11px] text-[var(--color-danger)]">{status.message}</p>
      ) : null}

      {status.kind === "scheduled" && status.total > status.count ? (
        <p className="font-mono text-[11px] text-[var(--color-danger)]">
          Scheduled {status.count} of {status.total} {status.targetKind}
          {status.total === 1 ? "" : "s"} — the rest failed. Try again to retry the failures.
        </p>
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
                <button
                  type="button"
                  onClick={() => void runDiagnose(status.channelId)}
                  disabled={diagnosing}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-secondary hover:text-fuchsia-deep disabled:opacity-50"
                  title="Probe this channel's live link state"
                >
                  {diagnosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Stethoscope className="h-3 w-3" />}
                  Diagnose this link
                </button>
              </div>
              {(diagnosis !== null || diagnoseError !== null) ? (
                <div className="mt-2 rounded-lg border border-fuchsia/20 bg-paper px-2.5 py-2">
                  {diagnoseError ? (
                    <p className="font-sans text-[11px] text-[var(--color-danger)]">{diagnoseError}</p>
                  ) : (
                    <p className="font-sans text-[11px] text-ink">{diagnosis}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setDiagnosis(null); setDiagnoseError(null); }}
                    className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary hover:text-ink"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ship-lens v0.7.8 P3 — Status-aware view model for a non-active channel
// chip. The badge is the short label rendered next to the channel name; the
// hint is the tooltip / accessible description that tells the user what's
// wrong and what to do about it. Mirrors the per-status copy in ChannelPicker
// (v0.7.7 #7) so the language stays consistent across surfaces.
type ChipView =
  | { kind: "active" }
  | { kind: "pending"; badge: string; hint: string }
  | { kind: "unlinked"; badge: string; hint: string }
  | { kind: "error"; badge: string; hint: string }
  | { kind: "paused"; badge: string; hint: string }
  | { kind: "unknown"; badge: string; hint: string };

function chipViewFor(status: Channel["status"]): ChipView {
  switch (status) {
    case "active":
      return { kind: "active" };
    case "pending_link":
      return {
        kind: "pending",
        badge: "finish linking",
        hint: "Finish linking — click to resume",
      };
    case "unlinked":
      // ship-lens v0.7.8 P1 — Distinct from pending_link. The user finished
      // OAuth at least once; the platform has since revoked our session.
      return {
        kind: "unlinked",
        badge: "disconnected — reconnect",
        hint: "Disconnected — click to reconnect",
      };
    case "error":
      return {
        kind: "error",
        badge: "reconnect",
        hint: "Reconnect — open Settings → Connections if this persists",
      };
    case "paused":
      return {
        kind: "paused",
        badge: "paused",
        hint: "Paused — resume in Settings before publishing",
      };
    default:
      return { kind: "unknown", badge: status, hint: `Status: ${status}` };
  }
}
