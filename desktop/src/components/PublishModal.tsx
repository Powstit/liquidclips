import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  backend,
  QuotaExceededError,
  type ConnectionPlatform,
  type PlatformConnection,
  type PublishedTarget,
} from "../lib/backend";
import { sidecar, type Clip } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";
import { InfoTip } from "./InfoTip";
import { useTier, TIER_COPY, type PublishCapability } from "../lib/useTier";

// Customer-facing publish surface. The word "Postiz" appears nowhere — to the
// customer, Liquid Clips owns the entire publishing path. Underneath, every action
// routes through Liquid Clips Backend which talks to a hidden self-hosted Postiz.
//
// Three modes:
//   publish-now: post immediately to N platforms (multi-platform = Growth+)
//   schedule-one: pick one platform + a date/time (Growth+)
// Drip-across lives in DripCalendar; both gate on the same connection store.

export type PublishModalMode = "publish-now" | "schedule-one";

const ALL_PLATFORMS: { id: ConnectionPlatform; label: string; oneLine: string }[] = [
  { id: "youtube",   label: "YouTube",   oneLine: "Vertical Shorts under 60s." },
  { id: "tiktok",    label: "TikTok",    oneLine: "Up to 3min vertical." },
  { id: "instagram", label: "Instagram", oneLine: "Reels + Feed posts." },
  { id: "x",         label: "X",         oneLine: "Vertical or square under 2:20." },
];

export function PublishModal({
  clip,
  clipIdx,
  projectSlug,
  mode,
  onClose,
  onDone,
}: {
  clip: Clip;
  clipIdx: number;
  projectSlug: string;
  mode: PublishModalMode;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const tier = useTier();
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectingPlatform, setConnectingPlatform] = useState<ConnectionPlatform | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // integration_ids
  const [scheduleAt, setScheduleAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return toLocalDatetimeInput(d);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes only when nothing else is in flight — preserves the loader
  // feeling like a real OAuth handoff that you can't interrupt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !connectingPlatform && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, connectingPlatform, busy]);

  // Load connections once tier is known. Free-tier never even queries — the
  // upgrade wall takes over the whole modal.
  const cap: PublishCapability = mode === "publish-now" ? "publish_now_single" : "schedule_one";
  const hasCapability = tier.can(cap);

  useEffect(() => {
    if (!hasCapability) {
      setConnectionsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { value: jwt } = await sidecar.licenseJwtRead();
        if (!jwt) {
          setConnections([]);
          return;
        }
        const list = await backend.connections.list(jwt);
        if (!cancelled) setConnections(list.connections);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasCapability]);

  // Vertical (reframed) is required — every platform expects 9:16.
  const videoPath = clip.vertical_path;

  async function connect(platform: ConnectionPlatform) {
    setConnectingPlatform(platform);
    setError(null);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) throw new Error("Sign in to Liquid Clips first — use the Sign in button in the top bar.");
      const { redirect_url } = await backend.connections.startConnect(jwt, platform);
      // In production this opens an external browser tab for the OAuth
      // consent. The preview shim returns a dummy URL and the platform is
      // already optimistically added to the connections list.
      if (redirect_url.startsWith("http")) {
        await openExternal(redirect_url).catch(() => undefined);
      }
      // Refresh the live list — in production the desktop polls after the
      // deep-link callback; in preview the list updates instantly.
      const list = await backend.connections.list(jwt);
      setConnections(list.connections);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        setError(e.message);
      } else {
        setError(String(e));
      }
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function disconnect(integration_id: string) {
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    if (!confirm("Disconnect this account?")) return;
    await backend.connections.disconnect(jwt, integration_id);
    setConnections((cur) => cur.filter((c) => c.integration_id !== integration_id));
    setPicked((cur) => {
      const next = new Set(cur);
      next.delete(integration_id);
      return next;
    });
  }

  function togglePick(integration_id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (mode === "schedule-one") return new Set([integration_id]);
      if (next.has(integration_id)) next.delete(integration_id);
      else if (!tier.can("publish_now_multi") && next.size >= 1) {
        // Solo single-platform cap — replace selection rather than add.
        return new Set([integration_id]);
      }
      else next.add(integration_id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        throw new Error("Sign in to Liquid Clips first — use the Sign in button in the top bar.");
      }
      if (!videoPath) {
        throw new Error("This clip has no rendered file yet. Re-cut from the editor first.");
      }
      if (picked.size === 0) {
        throw new Error("Pick at least one account.");
      }
      const picks = connections.filter((c) => picked.has(c.integration_id));
      const platforms = picks.map((p) => p.platform);

      if (mode === "publish-now") {
        const results = await backend.publishNow(jwt, {
          filePath: videoPath,
          title: clip.title,
          description: clip.description,
          platforms: platforms.filter((p): p is "youtube" | "tiktok" | "x" => p !== "instagram"),
        });
        const igPicked = picks.filter((p) => p.platform === "instagram");
        if (igPicked.length > 0) {
          onDone(
            `${summarisePublish(results)} · Instagram queued for next sprint.`,
          );
        } else {
          onDone(summarisePublish(results));
        }
      } else {
        const platform = picks[0].platform;
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
        onDone(`Scheduled for ${new Date(scheduleAt).toLocaleString()} on ${platform}.`);
      }
    } catch (e) {
      if (e instanceof QuotaExceededError) setError(e.message);
      else setError(String(e));
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

  const headline = mode === "publish-now" ? "Send it." : "Send it later.";
  const eyebrow = mode === "publish-now" ? "publish now" : "schedule one";
  const cta = mode === "publish-now"
    ? `Publish to ${picked.size} account${picked.size === 1 ? "" : "s"} →`
    : "Schedule →";

  // Group connections by platform so multi-account picking lives inline.
  const byPlatform = new Map<ConnectionPlatform, PlatformConnection[]>();
  for (const c of connections) {
    const arr = byPlatform.get(c.platform) ?? [];
    arr.push(c);
    byPlatform.set(c.platform, arr);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 p-6"
      onClick={connectingPlatform || busy ? undefined : onClose}
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
                {mode === "publish-now" ? "where" : "which account"}
              </span>
              <InfoTip text={
                tier.can("publish_now_multi")
                  ? "Click an account to select it. Pick multiple to fan out across platforms in one shot. Right-click an account to disconnect."
                  : "Solo posts to one platform at a time. Upgrade to Growth for multi-platform publishing."
              } />
            </div>
            {tier.maxConnections !== null && (
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                {connections.length}/{tier.maxConnections} connected
              </span>
            )}
          </div>

          {connectionsLoading ? (
            <p className="font-mono text-[12px] text-text-tertiary">
              Reading your connections<span className="blink">_</span>
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ALL_PLATFORMS.map((p) => {
                const accounts = byPlatform.get(p.id) ?? [];
                const isConnecting = connectingPlatform === p.id;
                return (
                  <PlatformTile
                    key={p.id}
                    platform={p}
                    accounts={accounts}
                    pickedIds={picked}
                    isConnecting={isConnecting}
                    canConnect={tier.maxConnections === null || connections.length < tier.maxConnections}
                    onConnect={() => void connect(p.id)}
                    onPick={togglePick}
                    onDisconnect={(id) => void disconnect(id)}
                  />
                );
              })}
            </div>
          )}

          {tier.maxConnections !== null && connections.length >= tier.maxConnections && (
            <p className="mt-3 font-mono text-[11px] text-text-tertiary">
              You've used all {tier.maxConnections} connection slots for {TIER_COPY[tier.tier].name}.
              Upgrade to {TIER_COPY[tier.requiredTierFor("any_connection")].name} for more.
            </p>
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
            disabled={!!connectingPlatform || busy}
            className="rounded-full border border-line bg-paper px-5 py-2.5 font-sans text-[14px] font-medium text-ink hover:border-fuchsia disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || picked.size === 0 || !videoPath || !!connectingPlatform}
            className="rounded-full bg-fuchsia px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)] disabled:opacity-50"
          >
            {busy ? (mode === "publish-now" ? "Publishing…" : "Scheduling…") : cta}
          </button>
        </div>

        {connectingPlatform && <ConnectingOverlay platform={connectingPlatform} />}
      </div>
    </div>
  );
}

// ── platform tile (with multi-account dropdown when relevant) ───────────

function PlatformTile({
  platform,
  accounts,
  pickedIds,
  isConnecting,
  canConnect,
  onConnect,
  onPick,
  onDisconnect,
}: {
  platform: { id: ConnectionPlatform; label: string; oneLine: string };
  accounts: PlatformConnection[];
  pickedIds: Set<string>;
  isConnecting: boolean;
  canConnect: boolean;
  onConnect: () => void;
  onPick: (integration_id: string) => void;
  onDisconnect: (integration_id: string) => void;
}) {
  const connected = accounts.length > 0;
  const anyPicked = accounts.some((a) => pickedIds.has(a.integration_id));

  if (!connected) {
    return (
      <button
        onClick={onConnect}
        disabled={isConnecting || !canConnect}
        title={canConnect ? `Connect ${platform.label} — ${platform.oneLine}` : "Connection cap reached for your tier"}
        className={`group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-paper-warm/30 px-3 py-4 transition-all ${
          canConnect
            ? "border-line text-text-tertiary hover:border-fuchsia hover:text-ink"
            : "border-line text-text-tertiary opacity-50"
        } disabled:opacity-50`}
      >
        <PlatformIcon id={platform.id} className="h-7 w-7" />
        <span className="font-sans text-[12px] font-medium leading-none">{platform.label}</span>
        <span className="font-mono text-[10px] uppercase leading-none tracking-[0.08em]">
          {canConnect ? "Connect" : "Locked"}
        </span>
      </button>
    );
  }

  // One account: simple toggle tile.
  if (accounts.length === 1) {
    const account = accounts[0];
    const picked = pickedIds.has(account.integration_id);
    return (
      <button
        onClick={() => onPick(account.integration_id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onDisconnect(account.integration_id);
        }}
        title={`Posting as ${account.account_handle}. Right-click to disconnect.`}
        aria-pressed={picked}
        className={`group flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-4 transition-all ${
          picked
            ? "border-fuchsia bg-fuchsia text-white shadow-[0_8px_24px_rgba(255,26,140,0.25)]"
            : "border-line bg-paper text-ink hover:border-fuchsia"
        }`}
      >
        <PlatformIcon id={platform.id} className="h-7 w-7" />
        <span className="font-sans text-[12px] font-medium leading-none">{platform.label}</span>
        <span className={`font-mono text-[10px] uppercase leading-none tracking-[0.08em] ${picked ? "text-white/80" : "text-text-secondary"}`}>
          {account.account_handle}
        </span>
      </button>
    );
  }

  // Multi-account: dropdown inline. Tile shows the picked account if any.
  const pickedAccount = accounts.find((a) => pickedIds.has(a.integration_id));
  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border px-3 py-3 transition-all ${
      anyPicked
        ? "border-fuchsia bg-fuchsia-soft/40"
        : "border-line bg-paper"
    }`}>
      <PlatformIcon id={platform.id} className="h-6 w-6 text-ink" />
      <span className="font-sans text-[11px] font-medium leading-none text-ink">{platform.label}</span>
      <select
        value={pickedAccount?.integration_id ?? ""}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
        className="w-full rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary focus:border-fuchsia focus:outline-none"
      >
        <option value="" disabled>pick an account</option>
        {accounts.map((a) => (
          <option key={a.integration_id} value={a.integration_id}>
            {a.account_handle}
          </option>
        ))}
      </select>
    </div>
  );
}

function ConnectingOverlay({ platform }: { platform: PlatformId }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-paper/95 backdrop-blur-sm">
      <PlatformIcon id={platform} className="h-12 w-12 text-ink" />
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
        connecting {platform}
      </div>
      <p className="max-w-[300px] text-center font-sans text-[13px] text-text-secondary">
        Opening the {platform} sign-in. Liquid Clips reads your handle back when you finish — your password never touches Liquid Clips.
      </p>
    </div>
  );
}

// ── upgrade wall ───────────────────────────────────────────────────────

function UpgradeWall({
  onClose,
  mode,
  currentTier,
  requiredTier,
}: {
  onClose: () => void;
  mode: PublishModalMode;
  currentTier: "free" | "solo" | "growth" | "autopilot";
  requiredTier: "free" | "solo" | "growth" | "autopilot";
}) {
  const cur = TIER_COPY[currentTier];
  const req = TIER_COPY[requiredTier];
  const headline =
    mode === "publish-now"
      ? requiredTier === "solo"
        ? "Publishing is a Solo+ feature."
        : "Multi-platform is on Growth+."
      : "Scheduling is on Growth+.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 p-6" onClick={onClose}>
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
            onClick={() => void openExternal("https://account.jnremployee.com/upgrade")}
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
