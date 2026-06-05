import { useEffect, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  backend,
  QuotaExceededError,
  socialGetConnection,
  listChannels,
  type Channel,
  type ConnectionPlatform,
  type PublishedTarget,
  type SocialConnectionState,
} from "../lib/backend";
import { sidecar, humanError, type Clip } from "../lib/sidecar";
import { PlatformIcon } from "./PlatformIcon";
import { InfoTip } from "./InfoTip";
import { useTier, TIER_COPY, type PublishCapability } from "../lib/useTier";
import type { Tier } from "../lib/backend";
import { ChannelPicker } from "./schedule/ChannelPicker";
import { ConnectFirstPrompt } from "./upload/ConnectFirstPrompt";

/*
 * Sprint #3 — Ayrshare-native PublishModal.
 *
 * Previously this modal drove the LEGACY Postiz per-account OAuth integration
 * model: pick `Set<integration_id>` from `backend.connections.list(jwt)`,
 * each platform had its own OAuth connect flow, multi-account dropdowns,
 * etc.
 *
 * Today's backend (/publish-now) is Ayrshare-only. One Profile Key per user,
 * a set of `platforms[]` to fan out to in a single backend call. The OAuth
 * to each platform happens on Ayrshare's hosted linking page — not in our
 * app. So the modal collapses to:
 *
 *   1. Fetch the user's social connection state (GET /social/connections)
 *   2. If not connected → show a "Connect first" card with deep link to
 *      Settings → Connections
 *   3. If connected → render platform checkboxes from `state.platforms`
 *   4. Submit calls backend.publishNow which posts to /publish-now with the
 *      platform array. Backend returns per-platform PublishedTarget[].
 *
 * Three modes:
 *   publish-now : post immediately
 *   schedule-one: pick one platform/channel + a datetime. Channel mode hits
 *                 /publish-now with `scheduledAt` so Ayrshare's native
 *                 scheduler queues the post; legacy mode hits /schedules
 *                 (cron worker fires at scheduled_for). Both persist a
 *                 schedules row that the ScheduleQueue renders.
 */

export type PublishModalMode = "publish-now" | "schedule-one";

const ALL_PLATFORM_LABELS: Record<ConnectionPlatform, { label: string; oneLine: string }> = {
  youtube:   { label: "YouTube",   oneLine: "Vertical Shorts under 60s." },
  tiktok:    { label: "TikTok",    oneLine: "Up to 3min vertical." },
  instagram: { label: "Instagram", oneLine: "Reels + Feed posts." },
  x:         { label: "X",         oneLine: "Vertical or square under 2:20." },
};

// Ayrshare may report platforms we don't render an icon for (LinkedIn, FB,
// Threads, etc). Stay forward-compatible: any platform string we don't
// recognise still gets a generic tile.
function platformLabel(p: string): string {
  const key = p.toLowerCase() as ConnectionPlatform;
  return ALL_PLATFORM_LABELS[key]?.label ?? (p[0]?.toUpperCase() + p.slice(1));
}

export function PublishModal({
  clip,
  clipIdx,
  projectSlug,
  mode,
  prefillAll = false,
  initialPlatforms,
  initialScheduledAt,
  onClose,
  onDone,
  onOpenSettings,
  onOpenSchedule,
}: {
  clip: Clip;
  clipIdx: number;
  projectSlug: string;
  mode: PublishModalMode;
  /** v0.6.3 — "Schedule everywhere" entrypoint. When true, every platform
   *  reported by the user's Ayrshare connection is pre-checked the moment
   *  the connection fetch returns. Solves Daniel's "cross-account
   *  publishing is not clear" gripe with one toggle. */
  prefillAll?: boolean;
  /** Pre-select specific platforms when opening the composer. After the
   *  channels list loads, any active channel whose `platform` is in this
   *  list is treated as the initial selection. Undefined = leave existing
   *  behavior; empty array = explicitly select nothing (no fallback).
   *  Platform-id vocabulary matches `ChannelPlatform` / `SocialConnectionState.platforms`
   *  ("tiktok", "instagram", "youtube", "x", "linkedin", "facebook", "threads"). */
  initialPlatforms?: string[];
  /** Pre-fill the schedule datetime picker with this ISO 8601 string. Lets the
   *  caller drop in a preset ("In 1 hour", "Tomorrow 9am") without forcing the
   *  user to step through the picker. Undefined = default (tomorrow 6pm). */
  initialScheduledAt?: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  // Wired by App.tsx — Settings is now only used for non-connection settings
  // (API keys etc.); connection management lives under Schedule → Channels.
  onOpenSettings?: () => void;
  /** Routes the "Connect a channel first" empty-state to Schedule → Channels,
   *  the canonical surface for linked accounts since the Settings →
   *  Connections collapse in Phase 1. */
  onOpenSchedule?: () => void;
}) {
  const tier = useTier();
  const [connection, setConnection] = useState<SocialConnectionState | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Schedule v2 — channel-aware publish. If user has any active channel, the
  // modal switches from the legacy platform-multiselect to a ChannelPicker.
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pickedChannelId, setPickedChannelId] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState(() => {
    if (initialScheduledAt) {
      const parsed = new Date(initialScheduledAt);
      if (!Number.isNaN(parsed.getTime())) return toLocalDatetimeInput(parsed);
    }
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return toLocalDatetimeInput(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards `initialPlatforms` pre-selection so it runs once on the initial
  // channel load and never clobbers a subsequent user toggle.
  const didApplyInitialPlatformsRef = useRef(false);

  // Esc closes unless we're mid-publish — preserves the "this is real, don't
  // bail" feeling once a network call is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const cap: PublishCapability = mode === "publish-now" ? "publish_now_single" : "schedule_one";
  const hasCapability = tier.can(cap);

  // Load the user's social connection state once per mount when the tier
  // entitles publishing. Free-tier renders the upgrade wall first and never
  // hits the network.
  useEffect(() => {
    if (!hasCapability) {
      setConnectionLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [state, chs] = await Promise.all([
          socialGetConnection(),
          listChannels(),
        ]);
        if (cancelled) return;
        setConnection(state);
        const activeChannels = chs.filter((c: Channel) => c.status === "active");
        setChannels(activeChannels);
        // v0.6.3 — "Schedule everywhere": tick every connected platform the
        // instant the connection state lands, so the user lands in the
        // modal with the broadcast already configured. Multi-platform
        // gating still applies — if the tier disallows multi, we leave
        // the first platform selected and let the existing togglePick
        // logic enforce the rest.
        if (prefillAll && mode === "publish-now" && state && state.platforms.length > 0) {
          setPicked(new Set(state.platforms));
        }
        // Caller-driven pre-selection. Runs once per mount, after channels
        // load. `undefined` = caller opted out → leave existing behavior.
        // `[]` = explicit "select nothing" (don't fall back to all). Any
        // platform with no matching active channel is silently ignored.
        // Channel-path state is a single `pickedChannelId`, so we pick the
        // first matching active channel.
        if (initialPlatforms !== undefined && !didApplyInitialPlatformsRef.current) {
          didApplyInitialPlatformsRef.current = true;
          if (initialPlatforms.length === 0) {
            setPickedChannelId(null);
          } else {
            const wanted = new Set(initialPlatforms);
            const match = activeChannels.find((c) => wanted.has(c.platform));
            setPickedChannelId(match ? match.id : null);
          }
        } else if (
          !didApplyInitialPlatformsRef.current &&
          activeChannels.length > 0
        ) {
          // No explicit caller pre-selection — auto-pick the first active
          // channel so the modal opens "ready to submit" rather than empty.
          // Removes a click for both "Publish now" and "Schedule ▾ → preset"
          // flows. didApply guard prevents this from re-firing after a user
          // deliberately deselects.
          didApplyInitialPlatformsRef.current = true;
          setPickedChannelId(activeChannels[0].id);
        }
      } catch (e) {
        if (!cancelled) setError(humanError(e));
      } finally {
        if (!cancelled) setConnectionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasCapability, prefillAll, mode, initialPlatforms]);

  const videoPath =
    clip.remix?.active_path?.vertical ||
    clip.overlay?.applied_paths?.vertical ||
    clip.vertical_path;
  const platforms = connection?.platforms ?? [];
  const hasChannelSelection = channels.length > 0;
  const hasTargetSelection = hasChannelSelection ? Boolean(pickedChannelId) : picked.size > 0;

  function togglePick(platform: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (mode === "schedule-one") return new Set([platform]);
      if (next.has(platform)) {
        next.delete(platform);
      } else if (!tier.can("publish_now_multi") && next.size >= 1) {
        // Solo tier — single platform at a time. Replace selection rather
        // than reject so the click still "does something."
        return new Set([platform]);
      } else {
        next.add(platform);
      }
      return next;
    });
  }

  async function submit() {
    if (!videoPath) {
      setError("This clip has no rendered file yet. Re-cut from the editor first.");
      return;
    }
    if (picked.size === 0 && !pickedChannelId) {
      setError(channels.length > 0 ? "Pick a channel." : "Pick at least one platform.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        throw new Error("Sign in to Liquid Clips first — use the Sign in button in the top bar.");
      }

      if (mode === "publish-now") {
        // Schedule v2 channel path: pickedChannelId → backend infers platform
        // + uses the channel's own Ayrshare profile_key. One call = one post
        // on one handle. To post to multiple handles, the user picks each
        // channel separately.
        if (pickedChannelId) {
          const results = await backend.publishNow(jwt, {
            filePath: videoPath,
            title: clip.title,
            description: clip.description,
            platforms: [],          // ignored when channelId set
            channelId: pickedChannelId,
          });
          onDone(summarisePublish(results));
        } else {
          // Legacy path — single SocialConnection profile, comma-separated platforms.
          const results = await backend.publishNow(jwt, {
            filePath: videoPath,
            title: clip.title,
            description: clip.description,
            platforms: Array.from(picked).filter((p): p is ConnectionPlatform =>
              p === "youtube" || p === "tiktok" || p === "x" || p === "instagram",
            ),
          });
          onDone(summarisePublish(results));
        }
      } else {
        if (pickedChannelId) {
          const scheduledFor = new Date(scheduleAt).toISOString();
          const results = await backend.publishNow(jwt, {
            filePath: videoPath,
            title: clip.title,
            description: clip.description,
            platforms: [],
            channelId: pickedChannelId,
            scheduledAt: scheduledFor,
          });
          onDone(`${summarisePublish(results)} · Scheduled for ${new Date(scheduleAt).toLocaleString()}.`);
          return;
        }
        const platform = Array.from(picked)[0];
        if (platform === "instagram") {
          throw new Error("Scheduling to Instagram is coming next sprint.");
        }
        const scheduledFor = new Date(scheduleAt).toISOString();
        await backend.scheduleOne(jwt, {
          projectSlug,
          clipIdx,
          clipTitle: clip.title,
          verticalPath: videoPath,
          platform: platform as "youtube" | "tiktok" | "x",
          scheduledFor,
        });
        onDone(`Scheduled for ${new Date(scheduleAt).toLocaleString()} on ${platformLabel(platform)}.`);
      }
    } catch (e) {
      if (e instanceof QuotaExceededError) setError(e.message);
      else setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Render branches ──────────────────────────────────────────────────

  if (!hasCapability) {
    return (
      <UpgradeWall
        onClose={onClose}
        mode={mode}
        currentTier={tier.tier}
        requiredTier={tier.requiredTierFor(cap)}
      />
    );
  }

  // No social profile connected — render the shared ConnectFirstPrompt
  // INSIDE the publish modal shell (variant="inline") so the user sees one
  // recognisable on-ramp: "You need a channel first → Open Schedule →
  // Connect → return here, channel auto-selected → publish." No
  // modal-on-top-of-modal: the existing modal wrapper here IS the surface.
  // Backend 412s any /publish-now call without a connection, so we still
  // catch it proactively in the UI.
  const hasNoChannels = channels.length === 0;
  const hasNoLegacyProfile = !connection?.profile_key_set || platforms.length === 0;
  if (!connectionLoading && hasNoChannels && hasNoLegacyProfile) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          className="flex w-full max-w-[520px] flex-col gap-5 rounded-2xl bg-paper p-7 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <ConnectFirstPrompt
            variant="inline"
            onOpenSchedule={() => {
              onClose();
              (onOpenSchedule ?? onOpenSettings)?.();
            }}
          />
        </div>
      </div>
    );
  }

  const headline = mode === "publish-now" ? "Send it." : "Send it later.";
  const eyebrow = mode === "publish-now" ? "publish now" : "schedule one";
  const cta = mode === "publish-now"
    ? pickedChannelId
      ? "Publish to channel →"
      : `Publish to ${picked.size} platform${picked.size === 1 ? "" : "s"} →`
    : pickedChannelId
    ? "Schedule channel →"
    : "Schedule →";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="relative flex w-full max-w-[640px] flex-col gap-5 rounded-2xl bg-paper p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          {eyebrow}
        </div>

        <h2 className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          {headline}
        </h2>

        <div className="rounded-xl border border-line bg-paper-warm/40 p-4">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">clip</span>
            <InfoTip text="Liquid Clips sends the vertical 9:16 render of this clip. If no vertical render exists, re-cut from the editor first." />
          </div>
          <h3 className="mt-1 font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {clip.title}
          </h3>
          {!videoPath && (
            <p className="mt-1 font-mono text-[11px] text-[#DC2626]">
              No 9:16 render yet. Open the clip → Re-cut to produce a vertical file.
            </p>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
                {mode === "publish-now" ? "where" : "which platform"}
              </span>
              <InfoTip text={
                tier.can("publish_now_multi")
                  ? "Pick one or more platforms. Liquid Clips fans out to each via Ayrshare in one shot."
                  : "Solo posts to one platform at a time. Upgrade to Pro for multi-platform publishing."
              } />
            </div>
            {connectionLoading ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                checking…
              </span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                {platforms.length} linked
              </span>
            )}
          </div>

          {connectionLoading ? (
            <p className="font-mono text-[12px] text-text-tertiary">
              Reading your social profile<span className="blink">_</span>
            </p>
          ) : channels.length > 0 ? (
            // Schedule v2 — channel picker (preferred). One click = one
            // channel. Each channel posts via its own Ayrshare profile.
            // onAddChannel surfaces a "+ Add channel" affordance at the
            // bottom of the picker so the user can link a new account
            // without abandoning the publish flow.
            <ChannelPicker
              value={pickedChannelId}
              onChange={setPickedChannelId}
              onAddChannel={onOpenSettings ? () => {
                onClose();
                onOpenSettings();
              } : undefined}
            />
          ) : (
            // Legacy path — single Ayrshare profile via SocialConnection,
            // multiselect platforms. Kept for users who haven't added a
            // channel yet.
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {platforms.map((p) => (
                <PlatformTile
                  key={p}
                  platform={p}
                  picked={picked.has(p)}
                  onPick={() => togglePick(p)}
                />
              ))}
            </div>
          )}
        </div>

        {mode === "schedule-one" && (
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">when</div>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full rounded-lg border border-line bg-paper-warm/40 px-4 py-2.5 font-mono text-[13px] text-ink focus:border-fuchsia focus:outline-none"
            />
          </div>
        )}

        {error && <p className="font-mono text-[12px] text-[#DC2626]">{error}</p>}

        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !hasTargetSelection || !videoPath}
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50"
          >
            {busy ? (mode === "publish-now" ? "Publishing…" : "Scheduling…") : cta}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── platform tile (simple — just shows platform name + checkbox) ───────

function PlatformTile({
  platform,
  picked,
  onPick,
}: {
  platform: string;
  picked: boolean;
  onPick: () => void;
}) {
  const known = platform as ConnectionPlatform;
  const label = ALL_PLATFORM_LABELS[known]?.label ?? platformLabel(platform);
  const oneLine = ALL_PLATFORM_LABELS[known]?.oneLine ?? "Connected via Ayrshare.";
  const iconId = (platform === "x" || platform === "youtube" || platform === "tiktok" || platform === "instagram")
    ? platform : "instagram"; // fallback icon for unknown platforms
  return (
    <button
      onClick={onPick}
      title={`Picked = ${picked ? "yes" : "no"}. ${oneLine}`}
      aria-pressed={picked}
      className={`group flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-4 transition-all ${
        picked
          ? "border-fuchsia bg-fuchsia text-white shadow-[0_8px_24px_rgba(255,26,140,0.25)]"
          : "border-line bg-paper text-ink hover:border-fuchsia"
      }`}
    >
      <PlatformIcon id={iconId as "youtube" | "tiktok" | "instagram" | "x"} className="h-7 w-7" />
      <span className="font-sans text-[12px] font-medium leading-none">{label}</span>
      <span className={`font-mono text-[10px] uppercase leading-none tracking-[0.08em] ${picked ? "text-white/80" : "text-text-secondary"}`}>
        {picked ? "selected" : "tap to pick"}
      </span>
    </button>
  );
}

// ── upgrade wall — unchanged from prior version ────────────────────────

function UpgradeWall({
  onClose,
  mode,
  currentTier,
  requiredTier,
}: {
  onClose: () => void;
  mode: PublishModalMode;
  currentTier: Tier;
  requiredTier: Tier;
}) {
  const cur = TIER_COPY[currentTier];
  const req = TIER_COPY[requiredTier];
  const headline =
    mode === "publish-now"
      ? requiredTier === "solo"
        ? "Publishing is a Solo+ feature."
        : "Multi-platform is on Pro+."
      : "Scheduling is on Pro+.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 p-6 backdrop-blur-md" onClick={onClose}>
      <div
        className="flex w-full max-w-[480px] flex-col gap-5 rounded-2xl bg-paper p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
          {cur.name.toLowerCase()} · locked
        </div>

        <h2 className="font-display text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink">
          {headline}
        </h2>

        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          {req.pitch}
        </p>

        <div className="rounded-xl border border-fuchsia-soft bg-fuchsia-soft/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
                upgrade to
              </div>
              <h3 className="mt-1 font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
                {req.name}
              </h3>
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary">
              {req.price}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia"
          >
            Maybe later
          </button>
          <button
            onClick={() => void openExternal("https://account.liquidclips.app/upgrade")}
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
          >
            Upgrade to {req.name} →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

function summarisePublish(results: PublishedTarget[]): string {
  if (results.length === 0) return "No targets confirmed.";
  return results.map((r) => `${r.platform}: ${r.post_url}`).join(" · ");
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
