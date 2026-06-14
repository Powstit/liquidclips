// ship-lens v0.7.8 L6: ProjectClipCard no longer shows an empty `bg-ink` plate when the clip has no `thumbnails[0].path`; falls back to the paused video preview-frame (same family as ClipWindowPoster's v0.7.7 fix #1).
// SECTION E — v0.7.77: Reaction / Editing Suite API restore. Picker is now
// surfaced as a first-class Assets/Reactions browser. Provider tabs get calm
// missing-key states, a Local/Bundled preview lane, and free-tier preview
// gating so the feature is discoverable without breaking the Solo+ layout moat.
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Search, Upload, X, Play, Pause, Folder, Sparkles, ImagePlay,
  Film, Wand2, Smile, KeyRound, Star, Heart, MessageCircle, Share2,
} from "lucide-react";
import type { Clip, Project, ReactionSearchResult } from "../lib/sidecar";
import { humanError, sidecar } from "../lib/sidecar";
import { useTier } from "../lib/useTier";
import { openUpgradeWhenSignedIn } from "../lib/upgradeWithAuth";

// Reaction Source Browser. Tabbed media browser with playable previews.
// Visible vocabulary is "reaction" — never "b-roll" or "overlay".

type PickerResult =
  | { kind: "project-clip"; path: string; sourceClipIdx: number }
  | { kind: "file"; path: string }
  | { kind: "cancel" };

type ProviderTab = "giphy" | "pexels" | "pixabay";
type Tab = ProviderTab | "project" | "upload" | "local";

const TAB_DEFS: {
  key: Tab;
  label: string;
  icon: typeof Sparkles;
  credit?: string;
  href?: string;
  secret?: "GIPHY_API_KEY" | "PEXELS_API_KEY" | "PIXABAY_API_KEY";
}[] = [
  { key: "giphy", label: "GIPHY", icon: Sparkles, credit: "GIFs powered by GIPHY", href: "https://giphy.com", secret: "GIPHY_API_KEY" },
  { key: "pexels", label: "Pexels", icon: Film, credit: "Stock video by Pexels", href: "https://www.pexels.com", secret: "PEXELS_API_KEY" },
  { key: "pixabay", label: "Pixabay", icon: ImagePlay, credit: "Stock video by Pixabay", href: "https://pixabay.com", secret: "PIXABAY_API_KEY" },
  { key: "project", label: "This project", icon: Folder },
  { key: "upload", label: "Upload", icon: Upload },
  { key: "local", label: "Local", icon: Smile },
];

const SUGGESTIONS = ["laugh", "shocked", "awkward", "applause", "confused", "celebration"];

const PLACEHOLDERS: Record<ProviderTab, string> = {
  giphy: "Search GIPHY for reactions, memes, stickers…",
  pexels: "Search Pexels for stock video, b-roll, reactions…",
  pixabay: "Search Pixabay for stock video, clips, reactions…",
};

export async function pickOverlaySource(opts: {
  project: Project;
  excludeIdx?: number;
}): Promise<PickerResult> {
  return new Promise<PickerResult>((resolve) => {
    mountPicker({
      project: opts.project,
      excludeIdx: opts.excludeIdx,
      onResolve: (r) => resolve(r),
    });
  });
}

async function pickFileFromDisk(): Promise<string | null> {
  const picked = await openDialog({
    multiple: false,
    filters: [
      { name: "Videos", extensions: ["mp4", "MP4", "mov", "MOV", "mkv", "MKV", "webm", "m4v", "M4V", "avi", "AVI", "hevc"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!picked || Array.isArray(picked)) return null;
  return picked as string;
}

function mountPicker(opts: {
  project: Project;
  excludeIdx?: number;
  onResolve: (r: PickerResult) => void;
}): void {
  if (typeof window === "undefined") {
    opts.onResolve({ kind: "cancel" });
    return;
  }
  void import("react-dom/client").then(({ createRoot }) => {
    const host = document.createElement("div");
    host.id = "__reaction-source-picker";
    document.body.appendChild(host);
    const root = createRoot(host);

    const cleanup = () => {
      root.unmount();
      host.remove();
    };

    root.render(
      <ReactionSourcePicker
        project={opts.project}
        excludeIdx={opts.excludeIdx}
        onResolve={(r) => {
          cleanup();
          opts.onResolve(r);
        }}
      />,
    );
  });
}

export function ReactionSourcePicker({
  project,
  excludeIdx,
  onResolve,
}: {
  project: Project;
  excludeIdx?: number;
  onResolve: (r: PickerResult) => void;
}) {
  const [tab, setTab] = useState<Tab>("giphy");
  const [query, setQuery] = useState("funny reaction");
  const [results, setResults] = useState<Record<ProviderTab, ReactionSearchResult[]>>({
    giphy: [], pexels: [], pixabay: [],
  });
  const [searching, setSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerGate, setProviderGate] = useState<
    { kind: "upgrade"; tab: ProviderTab } | { kind: "missing-key"; tab: ProviderTab } | null
  >(null);

  const tier = useTier();
  const isFreeTier = tier.tier === "free";

  // Refresh tier on picker open — this is an explicit user action, so a
  // backend roundtrip is acceptable and prevents stale free flashes.
  useEffect(() => {
    void tier.refreshTier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve({ kind: "cancel" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  // Auto-load first GIPHY page so the picker feels alive on open for every
  // user. Free tier can browse/preview provider results; adding is gated.
  const didInitial = useRef(false);
  useEffect(() => {
    if (didInitial.current) return;
    didInitial.current = true;
    void searchOnline(query, "giphy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projectClips = project.clips
    .map((clip, idx) => ({ clip, idx }))
    .filter(({ clip, idx }) => {
      if (excludeIdx !== undefined && idx === excludeIdx) return false;
      return !!(clip.vertical_path || clip.cut_path);
    });

  async function searchOnline(nextQuery: string, nextTab: ProviderTab) {
    setTab(nextTab);
    setSearching(true);
    setProviderError(null);
    setProviderGate(null);

    try {
      const res = await sidecar.reactionSearchProvider(nextQuery, nextTab, 18);
      setResults((prev) => ({ ...prev, [nextTab]: res.results }));
      if (res.results.length === 0) {
        setProviderError(`No ${nextTab} results for "${nextQuery}".`);
      }
    } catch (e) {
      const msg = humanError(e);
      if (/not connected|api key/i.test(msg)) {
        setProviderGate({ kind: "missing-key", tab: nextTab });
      } else {
        setProviderError(msg);
      }
      setResults((prev) => ({ ...prev, [nextTab]: [] }));
      // Dev-only trace; never show raw sidecar output to users.
      // eslint-disable-next-line no-console
      console.warn(`[OverlaySourcePicker] ${nextTab} search failed`, e);
    } finally {
      setSearching(false);
    }
  }

  async function chooseOnline(item: ReactionSearchResult) {
    // Free tier can preview every provider; adding a premium reaction opens
    // the upgrade flow so the Solo+ layout moat stays intact.
    if (isFreeTier) {
      setProviderGate({ kind: "upgrade", tab: tab as ProviderTab });
      return;
    }

    setDownloadingId(item.id);
    setProviderError(null);
    try {
      const downloaded = await sidecar.reactionDownload(item, query);
      onResolve({ kind: "file", path: downloaded.path });
    } catch (e) {
      setProviderError(humanError(e));
      setDownloadingId(null);
    }
  }

  async function chooseFile() {
    const path = await pickFileFromDisk();
    if (path) onResolve({ kind: "file", path });
  }

  function switchTab(next: Tab) {
    setTab(next);
    setProviderError(null);
    setProviderGate(null);
    if ((next === "giphy" || next === "pexels" || next === "pixabay") && results[next].length === 0) {
      void searchOnline(query, next);
    }
  }

  function openSettingsKeys() {
    window.dispatchEvent(new CustomEvent("lc:settings-open-tab", { detail: { tab: "keys" } }));
    onResolve({ kind: "cancel" });
  }

  function closeAndUpgrade() {
    onResolve({ kind: "cancel" });
    openUpgradeWhenSignedIn();
  }

  const provider = TAB_DEFS.find((t) => t.key === tab)!;
  const isProviderTab = tab === "giphy" || tab === "pexels" || tab === "pixabay";
  const currentResults = isProviderTab ? results[tab] : [];

  return (
    <div
      // v0.7.50 — Brand-kit pass. Backdrop bg-black/65 (outside brand
      // palette) retired for bg-paper/85 backdrop-blur-md (canonical
      // per ConfirmDialog). Inner light-mode panel is a deliberate
      // inversion for this picker and stays.
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/85 backdrop-blur-md p-4 sm:p-6"
      onClick={() => onResolve({ kind: "cancel" })}
    >
      <div
        className="flex h-full max-h-[90vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-2xl bg-ink text-paper shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-paper/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-fuchsia text-white">
              <Wand2 size={14} strokeWidth={2.4} />
            </span>
            <div>
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-paper">
                Assets & reactions
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/55">
                {isProviderTab ? provider.credit : tab === "project" ? "From this project" : tab === "upload" ? "Upload from disk" : "Local overlays"}
              </p>
            </div>
          </div>
          <button
            onClick={() => onResolve({ kind: "cancel" })}
            title="Close (esc)"
            className="inline-flex items-center gap-1 rounded-full border border-paper/15 bg-paper/5 px-3 py-1.5 font-mono text-[11px] text-paper/70 hover:border-fuchsia hover:text-white"
          >
            <X size={12} strokeWidth={2.4} />
            close
          </button>
        </header>

        {/* Tab strip */}
        <div className="flex flex-wrap items-center gap-1 border-b border-paper/10 bg-ink/95 px-3 py-2">
          {TAB_DEFS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-fuchsia text-white shadow-[var(--glow-sm)]"
                    : "text-paper/65 hover:bg-paper/10 hover:text-white"
                }`}
              >
                <Icon size={13} strokeWidth={2.2} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search bar — only for provider tabs */}
        {isProviderTab && (
          <div className="border-b border-paper/10 bg-ink/95 px-5 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} strokeWidth={2.2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper/50" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchOnline(query, tab); }}
                  placeholder={PLACEHOLDERS[tab]}
                  className="w-full rounded-full border border-paper/15 bg-paper/5 px-9 py-2 font-sans text-[13px] text-white placeholder:text-paper/40 focus:border-fuchsia focus:bg-paper/10 focus:outline-none"
                />
              </div>
              <button
                onClick={() => void searchOnline(query, tab)}
                disabled={searching}
                className="rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-50"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((pill) => (
                <button
                  key={pill}
                  onClick={() => { setQuery(pill); void searchOnline(pill, tab); }}
                  className="rounded-full border border-paper/15 bg-paper/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-paper/65 hover:border-fuchsia hover:text-white"
                >
                  {pill}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {providerGate?.kind === "missing-key" && (
            <MissingKeyBanner tab={providerGate.tab} onOpenSettings={openSettingsKeys} />
          )}

          {providerGate?.kind === "upgrade" && (
            <ProviderPaywall tab={providerGate.tab} onClose={closeAndUpgrade} />
          )}

          {providerError && !providerGate && (
            <div className="mb-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2">
              <p className="font-sans text-[12px] text-[#FCA5A5]">{providerError}</p>
            </div>
          )}

          {tab === "project" && (
            <ProjectGrid
              clips={projectClips}
              onPick={(c) => {
                const path = c.clip.vertical_path || c.clip.cut_path;
                if (path) onResolve({ kind: "project-clip", path, sourceClipIdx: c.idx });
              }}
            />
          )}

          {tab === "upload" && <UploadPane onPick={() => void chooseFile()} />}

          {tab === "local" && <LocalOverlaysPane onUpload={() => switchTab("upload")} />}

          {isProviderTab && !providerGate && (
            <ProviderGrid
              tab={tab}
              results={currentResults}
              loading={searching}
              downloadingId={downloadingId}
              onPick={(item) => void chooseOnline(item)}
            />
          )}
        </div>

        {/* Attribution footer */}
        <footer className="flex items-center justify-between border-t border-paper/10 bg-ink/95 px-5 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-paper/50">
            {isProviderTab ? provider.credit : "Local sources"}
          </span>
          {isProviderTab && provider.href && (
            <a
              href={provider.href}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-paper/50 hover:text-fuchsia"
            >
              {provider.label} →
            </a>
          )}
        </footer>
      </div>
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────

function MissingKeyBanner({ tab, onOpenSettings }: { tab: ProviderTab; onOpenSettings: () => void }) {
  const def = TAB_DEFS.find((t) => t.key === tab)!;
  return (
    <div className="mb-4 rounded-xl border border-paper/15 bg-paper/5 px-4 py-4">
      <p className="font-display text-[13px] font-semibold text-white">
        {def.label} search is unavailable.
      </p>
      <p className="mt-1 font-sans text-[12px] text-paper/65">
        Add your {def.label} API key in Settings to search this provider, or switch to Local overlays.
      </p>
      <button
        onClick={onOpenSettings}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-white transition-colors hover:bg-fuchsia-bright"
      >
        <KeyRound size={12} strokeWidth={2.4} />
        Open Settings
      </button>
    </div>
  );
}

function ProviderPaywall({ tab, onClose }: { tab: ProviderTab; onClose: () => void }) {
  const def = TAB_DEFS.find((t) => t.key === tab)!;
  const Icon = def.icon;
  return (
    <div className="grid place-items-center py-10">
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-fuchsia/20 text-fuchsia">
          <Icon size={22} strokeWidth={2.2} />
        </div>
        <p className="font-display text-[14px] font-semibold text-white">Unlock {def.label}</p>
        <p className="mt-1 font-sans text-[12px] text-paper/60">
          Upgrade to Solo to search {def.label} and insert premium reactions, GIFs, and stock video.
        </p>
        <button
          onClick={onClose}
          className="mt-4 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white transition-colors hover:bg-fuchsia-bright"
        >
          See plans
        </button>
      </div>
    </div>
  );
}

function ProviderGrid({
  tab,
  results,
  loading,
  downloadingId,
  onPick,
}: {
  tab: ProviderTab;
  results: ReactionSearchResult[];
  loading: boolean;
  downloadingId: string | null;
  onPick: (item: ReactionSearchResult) => void;
}) {
  if (loading && results.length === 0) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-lg bg-paper/5" />
          ))}
        </div>
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-paper/40">Loading results…</p>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="font-sans text-[13px] text-paper/60">
          No {tab} results yet.
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-paper/40">
          Search for an emotion, meme, or reaction.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {results.map((item) => (
        <ResultCard
          key={item.id}
          item={item}
          isDownloading={downloadingId === item.id}
          onPick={() => onPick(item)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  item,
  isDownloading,
  onPick,
}: {
  item: ReactionSearchResult;
  isDownloading: boolean;
  onPick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState(false);
  const canVideo = !!item.download_url && (item.download_url.endsWith(".mp4") || item.download_url.endsWith(".webm"));

  function onEnter() {
    setHover(true);
    if (canVideo && videoRef.current) {
      void videoRef.current.play().catch(() => {});
    }
  }
  function onLeave() {
    setHover(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  return (
    <button
      onClick={onPick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      disabled={isDownloading}
      title={`${item.title} · ${item.author || item.provider}`}
      className="group relative overflow-hidden rounded-lg border border-paper/10 bg-paper/5 text-left transition-all hover:border-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.18)] disabled:opacity-60"
    >
      <div className="relative aspect-video bg-ink">
        {item.preview_url && !hover && (
          <img
            src={item.preview_url}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        {canVideo && (
          <video
            ref={videoRef}
            src={item.download_url}
            muted
            playsInline
            loop
            preload="none"
            onError={(e) => { e.currentTarget.style.opacity = "0"; }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
              hover ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        {/* provider badge */}
        <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-paper/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/80 backdrop-blur-sm">
          {item.provider}
        </span>
        {/* play affordance */}
        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-paper/90 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {hover ? <Pause size={11} strokeWidth={2.4} /> : <Play size={11} strokeWidth={2.4} />}
        </span>
        {/* use-reaction action */}
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-fuchsia px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {isDownloading ? "downloading…" : "use reaction →"}
        </span>
      </div>
      <div className="p-2">
        <p className="line-clamp-2 font-sans text-[11px] leading-tight text-white">{item.title}</p>
        {item.author && (
          <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-paper/55">
            {item.author}
          </p>
        )}
      </div>
    </button>
  );
}

function ProjectGrid({
  clips,
  onPick,
}: {
  clips: { clip: Clip; idx: number }[];
  onPick: (c: { clip: Clip; idx: number }) => void;
}) {
  if (clips.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.1em] text-paper/45">
        No other clips ready yet · wait for reframe to finish
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {clips.map(({ clip, idx }) => (
        <ProjectClipCard key={idx} clip={clip} idx={idx} onPick={() => onPick({ clip, idx })} />
      ))}
    </div>
  );
}

function ProjectClipCard({
  clip,
  idx,
  onPick,
}: {
  clip: Clip;
  idx: number;
  onPick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hover, setHover] = useState(false);
  const path = clip.vertical_path || clip.cut_path;
  const thumb = clip.thumbnails?.[0]?.path;
  const thumbSrc = thumb ? convertFileSrc(thumb) : null;
  const videoSrc = path ? convertFileSrc(path) : null;

  function onEnter() {
    setHover(true);
    if (videoRef.current) void videoRef.current.play().catch(() => {});
  }
  function onLeave() {
    setHover(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  return (
    <button
      onClick={onPick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={clip.title}
      className="group overflow-hidden rounded-lg border border-paper/10 bg-paper/5 text-left transition-all hover:border-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.18)]"
    >
      <div className="relative aspect-[9/16] bg-ink">
        {/* v0.7.8 L6 — Same family as the v0.7.7 ClipWindowPoster fix #1.
            Before: when `thumbnails[0]?.path` was missing AND the user
            wasn't hovering, this tile showed an empty `bg-ink` plate —
            indistinguishable from an outright broken clip. After: if a
            thumbnail exists we use it (cheap, no decode), otherwise we
            always-mount the video element with `preload="metadata"` so
            frame 0 paints at rest. Hover still swaps to the playing
            video via the existing opacity transition; we just stop
            hiding the video at rest when the only thing to show IS the
            video. */}
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={clip.title}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
              hover ? "opacity-0" : "opacity-100"
            }`}
          />
        ) : null}
        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            playsInline
            loop
            onError={(e) => { e.currentTarget.style.opacity = "0"; }}
            // v0.7.8 L6 — `metadata` (not `none`) so the browser fetches
            // enough to paint the poster frame at rest. Tiny cost compared
            // to an empty `bg-ink` plate; no audible / decode side effects
            // because the element stays paused + muted until hover.
            preload="metadata"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
              // v0.7.8 L6 — When there's no thumbnail, the video IS the
              // resting frame, so it should be visible at rest too.
              hover || !thumbSrc ? "opacity-100" : "opacity-0"
            }`}
          />
        )}
        <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-paper/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/85 backdrop-blur-sm">
          {(idx + 1).toString().padStart(2, "0")}
        </span>
        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-paper/90 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {hover ? <Pause size={11} strokeWidth={2.4} /> : <Play size={11} strokeWidth={2.4} />}
        </span>
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-fuchsia px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white opacity-0 transition-opacity group-hover:opacity-100">
          use reaction →
        </span>
      </div>
      <div className="p-2">
        <p className="line-clamp-2 font-sans text-[11px] leading-tight text-white">{clip.title}</p>
      </div>
    </button>
  );
}

function UploadPane({ onPick }: { onPick: () => void }) {
  return (
    <div className="grid place-items-center py-8">
      <button
        onClick={onPick}
        className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-paper/25 bg-paper/5 px-10 py-10 transition-colors hover:border-fuchsia hover:bg-fuchsia-soft/10"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-fuchsia text-white">
          <Upload size={18} strokeWidth={2.4} />
        </span>
        <p className="font-display text-[15px] font-semibold text-white">Choose reaction file</p>
        <p className="font-sans text-[12px] text-paper/65">mp4, mov, mkv, webm, m4v</p>
      </button>
    </div>
  );
}

function LocalOverlaysPane({ onUpload }: { onUpload: () => void }) {
  const STARTERS = [
    {
      id: "subscribe",
      label: "Subscribe bug",
      preview: (
        <div className="rounded-full bg-fuchsia px-3 py-1 font-display text-[10px] font-bold uppercase tracking-wide text-white shadow-[var(--glow-sm)]">
          Subscribe
        </div>
      ),
    },
    {
      id: "engagement",
      label: "Like · Comment · Share",
      preview: (
        <div className="flex items-center gap-2 text-fuchsia">
          <Heart size={16} strokeWidth={2.4} />
          <MessageCircle size={16} strokeWidth={2.4} />
          <Share2 size={16} strokeWidth={2.4} />
        </div>
      ),
    },
    {
      id: "stars",
      label: "Rating stars",
      preview: (
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} size={14} strokeWidth={2.4} className="fill-fuchsia text-fuchsia" />
          ))}
        </div>
      ),
    },
    {
      id: "lower-third",
      label: "Lower-third label",
      preview: (
        <div className="w-[80%] rounded-md bg-paper/90 px-3 py-1.5 text-center">
          <span className="font-sans text-[10px] font-medium text-white">Creator Name</span>
        </div>
      ),
    },
    {
      id: "reaction-frame",
      label: "Reaction frame",
      preview: (
        <div className="flex h-[70%] w-[70%] items-center justify-center rounded-lg border-2 border-dashed border-fuchsia/50 bg-fuchsia/10">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-fuchsia">Reaction</span>
        </div>
      ),
    },
    {
      id: "paid-badge",
      label: "Paid clip badge",
      preview: (
        <div className="rounded-md bg-fuchsia px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-white">
          Paid Clip
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-fuchsia/20 bg-fuchsia/5 px-4 py-3">
        <p className="font-display text-[13px] font-semibold text-white">Local overlays are coming soon.</p>
        <p className="mt-1 font-sans text-[12px] text-paper/65">
          Use your own file via Upload, or add a provider key to search millions of reactions today.
        </p>
        <button
          onClick={onUpload}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-fuchsia-soft/20 px-3 py-1.5 font-sans text-[12px] font-medium text-fuchsia transition-colors hover:bg-fuchsia-soft/30"
        >
          <Upload size={12} strokeWidth={2.4} />
          Upload your own
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {STARTERS.map((item) => (
          <div
            key={item.id}
            className="group overflow-hidden rounded-lg border border-paper/10 bg-paper/5 p-3 text-center transition-colors hover:border-fuchsia/40"
          >
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-ink/50">
              {item.preview}
            </div>
            <p className="mt-2 font-sans text-[11px] text-paper/80">{item.label}</p>
            <span className="mt-1 inline-block rounded-full bg-paper/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-paper/50">
              Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reset (kept for Settings) ──────────────────────────────────────────

export function resetOverlayPickerMemory() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("junior:overlay-source-last-choice");
  window.localStorage.removeItem("junior:overlay-source-skip-modal");
}
