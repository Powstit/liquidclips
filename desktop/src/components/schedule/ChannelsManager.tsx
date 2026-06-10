// ship-lens v0.7.8: S8 — the per-card "analytics →" chip used to receive
// onOpenAnalytics(channel.id) but AnalyticsView doesn't yet accept a
// channelFilter prop, so clicking it just flipped tabs with no filter
// applied. Shipping a lie. Until AnalyticsView gains the filter (parked
// for v0.7.9), the chip is hidden by NOT forwarding onOpenAnalytics from
// ChannelsManager into each ChannelCard. The Channels sub-tab still
// renders without the chip; the tab swap path in SchedulePage that fires
// onOpenAnalytics from ChannelsManager remains wired so a future
// re-enable is one-line. Pattern-grep result: ChannelCard's onOpenAnalytics
// is the only consumer of this prop, so cutting at the parent silences
// every dead-end click site.
//
// Channels sub-tab of the Schedule page (Schedule v2).
//
// Lists every channel the user has linked + "+ Add Channel" button. Channels
// are added one at a time — same flow, repeated. No bulk wizard.
//
// SERVES (per UI_MAP_workbench.md `## SURFACE: Connect-channel flow`):
//   • `(O #2)` "I want this clip on these platforms" — Connect / Finish
//     linking buttons get the user from "no channel" to "active channel".
//   • `(O #4)` "I want proof it shipped" — applied to the link itself:
//     subscribes to `junior:channel-linked`, refreshes the affected row,
//     and emits a global success or failure toast so the proof lands
//     within ~1s of OAuth completion (no manual refresh).
//   • `(O #4 — interim proof)` — inline "Waiting for browser…" state on
//     each platform's Connect button, with a 90s fallback that flips to
//     "Still waiting — try Reconnect" so a stuck OAuth is visible instead
//     of an infinite spinner.

import { useCallback, useEffect, useRef, useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Plus, Loader2, RefreshCw } from "lucide-react";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import type { Channel } from "./types";
import { ChannelRow } from "./ChannelRow";
import { AddChannelModal } from "./AddChannelModal";

// 90s matches the Connect-channel flow contract.
const CONNECT_TIMEOUT_MS = 90_000;

function platformLabel(p: Channel["platform"]): string {
  switch (p) {
    case "instagram": return "Instagram";
    case "tiktok":    return "TikTok";
    case "youtube":   return "YouTube";
    case "x":         return "X";
    case "linkedin":  return "LinkedIn";
    case "facebook":  return "Facebook";
    case "threads":   return "Threads";
  }
}

function emitToast(kind: "success" | "error" | "info", message: string): void {
  // Reuses the app-wide `lc:toast` bus mounted by GlobalToastHost.
  window.dispatchEvent(
    new CustomEvent("lc:toast", { detail: { kind, message } }),
  );
}

export function ChannelsManager({
  onOpenAnalytics: _onOpenAnalytics,
}: {
  /** v0.7.8 S8 — kept in the props contract (SchedulePage still passes it)
   *  but NOT forwarded into ChannelCard, because AnalyticsView can't yet
   *  apply a channelFilter — the chip just flipped tabs with no filter
   *  applied, shipping a lie. Underscore-prefix silences the unused-var
   *  lint; re-enable is a one-line restore once analytics gains the
   *  filter (parked: v0.7.9 punch-list item). */
  onOpenAnalytics?: (channelId: string) => void;
} = {}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  // v0.7.32 B2 — same defensive UI override as ConnectionsChannelsList. Pull
  // Ayrshare's profile-level link snapshot so ChannelRow can flip a stale
  // pending_link / unlinked / error row to ACTIVE when Ayrshare actually
  // reports the platform as linked. Silent on failure — the row falls back
  // to the raw DB status, which is what pre-v0.7.32 already shipped.
  const [ayrshareLinkedPlatforms, setAyrshareLinkedPlatforms] = useState<readonly string[]>([]);
  // Action-level surface error (rename/refresh/pause/delete/relink).
  const [error, setError] = useState<string | null>(null);
  // Top-level load error — kept separate from action errors so we can render
  // a "couldn't load — retry" banner WITHOUT collapsing into the empty hero
  // (which would lie that the user has zero channels).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Per-channel "Waiting for browser…" state. Keyed by channel id so a
  // multi-channel user can have several Connect flows queued without them
  // stomping on each other's spinners. `timedOut` flips when the 90s timer
  // fires so the row can switch copy to "Still waiting — try Reconnect"
  // without losing the connecting context.
  const [connecting, setConnecting] = useState<
    Map<string, { timedOut: boolean }>
  >(new Map());
  const connectTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const startConnectingTimer = useCallback((channelId: string) => {
    // Clear any prior timer for this channel — a re-click of "Finish
    // linking" should restart the 90s window rather than fire a stale
    // "stuck" flip a few seconds in.
    const prev = connectTimers.current.get(channelId);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
      setConnecting((cur) => {
        const next = new Map(cur);
        const entry = next.get(channelId);
        if (entry) next.set(channelId, { timedOut: true });
        return next;
      });
    }, CONNECT_TIMEOUT_MS);
    connectTimers.current.set(channelId, handle);
  }, []);

  const finishConnecting = useCallback((channelId: string) => {
    const t = connectTimers.current.get(channelId);
    if (t) clearTimeout(t);
    connectTimers.current.delete(channelId);
    setConnecting((cur) => {
      if (!cur.has(channelId)) return cur;
      const next = new Map(cur);
      next.delete(channelId);
      return next;
    });
  }, []);

  // Unmount safety — clear every live timer so a remount doesn't inherit
  // a stuck-state flip for a channel that's already long gone.
  useEffect(() => () => {
    for (const t of connectTimers.current.values()) clearTimeout(t);
    connectTimers.current.clear();
  }, []);

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

  // v0.7.45 — Refetch channels when the window regains focus so status
  // doesn't stay stale across long background sessions. The backend
  // reconcile loop runs every ~60s, but the user may switch back after
  // hours and deserve fresh data.
  useEffect(() => {
    function onFocus() { void load(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // v0.7.32 B2 — fetch Ayrshare profile snapshot for the stale-status
  // override. Mirrors Settings.tsx ConnectionsChannelsList so the two
  // surfaces render the same source of truth. socialGetConnectionStrict
  // distinguishes "no row" from "backend down" so a transport blip doesn't
  // silently disable the override — but for ChannelRow's purposes both
  // map to "no platforms known", which is the safe fallback.
  useEffect(() => {
    let cancelled = false;
    void backend
      .socialGetConnectionStrict()
      .then((state) => {
        if (cancelled) return;
        if (state !== "no-connection") setAyrshareLinkedPlatforms(state.platforms ?? []);
      })
      .catch(() => {
        // Transport error — defensive fallback, not a required input.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to the legacy social_link_closed event AND schedule a 2s
  // re-load after kicking off any OAuth, so the channels list reflects the
  // freshly active status without the user manually refreshing.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen("social_link_closed", () => { void load(); })
      .then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, [load]);

  // Subscribe to `junior:channel-linked` (dispatched by activation.ts when
  // the `liquidclips://channel-linked` deep link fires after Ayrshare's
  // OAuth completes). Refresh the affected row server-side, then re-fetch
  // listChannels so the UI catches anything Ayrshare patched server-side,
  // then emit the global success / failure toast per the contract.
  //
  // bug-hunt P2 fix (v0.7.32): the listener used to capture `finishConnecting`
  // through closure with `[finishConnecting]` as the only dep. That works while
  // finishConnecting's `useCallback` deps stay empty — but if a future edit
  // ever adds a dep (or someone forgets to memoise), the listener would
  // silently re-register on every render and orphan stale entries in the
  // `connecting` Map. The ref pattern below makes the listener identity
  // independent of any future memoisation drift.
  const finishConnectingRef = useRef(finishConnecting);
  useEffect(() => { finishConnectingRef.current = finishConnecting; }, [finishConnecting]);

  useEffect(() => {
    async function onLinked(ev: Event) {
      const detail = (ev as CustomEvent<{ channelId: string | null }>).detail ?? { channelId: null };
      const cid = detail.channelId;
      let refreshed: Channel | null = null;
      if (cid) {
        try {
          refreshed = await backend.refreshChannel(cid);
          setChannels((cur) => cur.map((c) => (c.id === cid ? refreshed! : c)));
        } catch {
          /* swallow — listChannels below still provides the latest snapshot. */
        }
      }
      try {
        const list = await backend.listChannels();
        setChannels(list);
        const target: Channel | null =
          refreshed
          ?? (cid ? list.find((c) => c.id === cid) ?? null : null);
        if (target) {
          if (target.status === "active") {
            const handle = target.handle ? `@${target.handle}` : target.label;
            emitToast(
              "success",
              `${platformLabel(target.platform)} connected as ${handle}`,
            );
          } else if (target.status === "pending_link") {
            emitToast(
              "error",
              `Couldn't confirm ${platformLabel(target.platform)} link — try Reconnect`,
            );
          }
        }
        if (cid) finishConnectingRef.current(cid);
      } catch {
        /* silent — surfacing a phantom toast on a refresh failure would
           lie about the OAuth's actual outcome. */
      }
    }
    window.addEventListener("junior:channel-linked", onLinked as EventListener);
    return () => {
      window.removeEventListener("junior:channel-linked", onLinked as EventListener);
    };
  }, []);

  // v0.7.32 — rename + refresh handlers removed in the ch-row swap. The
  // ch-row pattern exposes toggle / link / delete only. If a channel detail
  // surface lands in a future sprint, re-add patchChannel + refreshChannel
  // calls there — they're untouched in backend.ts.

  async function handleTogglePause(c: Channel) {
    try {
      const next = c.status === "paused" ? "active" : "paused";
      const updated = await backend.patchChannel(c.id, { status: next });
      setChannels((cur) => cur.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      // v0.7.32 — `humanError` already humanises the message into the parent
      // banner. The previous `throw e` was there to let ChannelCard unwind
      // its local busy state; ChannelRow swallows in its own try/catch, so
      // the throw became a no-op + bug-hunt P1.
      setError(humanError(e));
    }
  }

  async function handleDelete(id: string) {
    try {
      await backend.deleteChannel(id);
      setChannels((cur) => cur.filter((c) => c.id !== id));
    } catch (e) {
      setError(humanError(e));
    }
  }

  async function handleLinkNow(c: Channel) {
    // Pending channels — re-open the link window using the relink endpoint
    // (mints a fresh URL — original might be stale). Google + most OAuth
    // providers block embedded webviews, so launch the user's real browser
    // instead of `invoke("open_social_link_window", ...)`.
    setConnecting((cur) => {
      const next = new Map(cur);
      next.set(c.id, { timedOut: false });
      return next;
    });
    startConnectingTimer(c.id);
    try {
      const { link_url } = await backend.relinkChannel(c.id);
      await openExternal(link_url);
      // Optimistic refresh after a short delay so the channel card flips to
      // active without the user re-opening the tab. We still surface errors
      // from the relink mint above, but a soft post-OAuth refresh is best-
      // effort — swallow its errors. The deep-link listener is the primary
      // path; this is a fallback for the (rare) case where the bounce page
      // can't reach the desktop.
      setTimeout(() => { void load(); }, 2000);
    } catch (e) {
      finishConnecting(c.id);
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="font-display text-[14px] font-semibold text-[var(--color-danger)]">
              Couldn't load channels
            </p>
            <p className="truncate font-mono text-[11px] text-[var(--color-danger)]/80">
              {loadError}
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-danger)]/50 bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {error && !loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 px-4 py-3">
          <p className="min-w-0 truncate font-mono text-[12px] text-[var(--color-danger)]">
            {error}
          </p>
          <button
            onClick={() => setError(null)}
            className="rounded-full border border-[var(--color-danger)]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
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

          {/* v0.7.32 — ch-row pattern. Rows stack vertically (no grid). The
              per-channel "waiting for browser" microstrip becomes a row-level
              inline cue handled by ChannelRow's status microcopy when the
              channel transitions to pending_link / unlinked. */}
          <div className="flex flex-col gap-2">
            {channels.map((c) => {
              const conn = connecting.get(c.id);
              return (
                <div key={c.id} className="flex flex-col gap-1.5">
                  <ChannelRow
                    channel={c}
                    onTogglePause={() => handleTogglePause(c)}
                    onDelete={() => handleDelete(c.id)}
                    onLinkNow={() => void handleLinkNow(c)}
                    ayrshareLinkedPlatforms={ayrshareLinkedPlatforms}
                  />
                  {conn && (
                    // bug-hunt P2 alignment fix (v0.7.32):
                    //   was `ml-7` (28px) — landed in the dead zone between the
                    //   row's status-dot end (20px from outer) and the brand
                    //   glyph's left edge (~30px), so the strip looked floating
                    //   under nothing.
                    //   ChannelRow geometry: px-3 (12) → dot (8) → gap-3 (12)
                    //   → glyph @ marginLeft -2 → glyph left edge ≈ 30px.
                    //   Choosing ml-0: strip's outer left aligns flush with the
                    //   row's outer left, reading as a sibling "sub-row" of the
                    //   channel. The strip's own px-3 then aligns the spinner
                    //   at 12px — flush under the row's status dot. Semantically
                    //   correct (status under status), Tailwind-native, no magic
                    //   pixel value.
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex items-center justify-between gap-2 rounded-md border border-fuchsia/40 bg-fuchsia/8 px-3 py-1.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {!conn.timedOut && (
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 animate-spin rounded-full border border-fuchsia border-t-transparent"
                          />
                        )}
                        <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
                          {conn.timedOut ? "still waiting — retry" : "waiting for browser…"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (conn.timedOut) {
                            void handleLinkNow(c);
                          } else {
                            finishConnecting(c.id);
                          }
                        }}
                        className="rounded-full border border-fuchsia/40 bg-paper-elev px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia hover:bg-fuchsia/10"
                      >
                        {conn.timedOut ? "reconnect" : "cancel"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
