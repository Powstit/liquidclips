// ship-lens v0.7.8 L6: ProjectClipCard no longer shows an empty `bg-ink` plate when the clip has no `thumbnails[0].path`; falls back to the paused video preview-frame (same family as ClipWindowPoster's v0.7.7 fix #1).
import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Search, Upload, X, Play, Pause, Folder, Sparkles, ImagePlay,
  Film, Wand2,
} from "lucide-react";
import type { Clip, Project, ReactionSearchResult } from "../lib/sidecar";
import { humanError, sidecar } from "../lib/sidecar";

// Reaction Source Browser. Tabbed media browser with playable previews.
// Default tab = GIPHY (the meme-reaction lane). Project clips, Pexels, Pixabay,
// and Upload all sit alongside as peer tabs. Visible vocabulary is
// "reaction" — never "b-roll" or "overlay".

type PickerResult =
  | { kind: "project-clip"; path: string; sourceClipIdx: number }
  | { kind: "file"; path: string }
  | { kind: "cancel" };

type Tab = "giphy" | "pexels" | "pixabay" | "project" | "upload";

const TAB_DEFS: { key: Tab; label: string; icon: typeof Sparkles; credit?: string; href?: string }[] = [
  { key: "giphy",   label: "GIPHY",   icon: Sparkles, credit: "Powered by GIPHY",        href: "https://giphy.com" },
  { key: "pexels",  label: "Pexels",  icon: Film,     credit: "Videos provided by Pexels", href: "https://www.pexels.com" },
  { key: "pixabay", label: "Pixabay", icon: ImagePlay, credit: "Videos provided by Pixabay", href: "https://pixabay.com" },
  { key: "project", label: "This project", icon: Folder },
  { key: "upload",  label: "Upload",  icon: Upload },
];

const SUGGESTIONS = ["laugh", "shocked", "awkward", "applause", "confused", "celebration"];

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
  const [results, setResults] = useState<Record<Tab, ReactionSearchResult[]>>({
    giphy: [], pexels: [], pixabay: [], project: [], upload: [],
  });
  const [searching, setSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<Tab | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve({ kind: "cancel" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  // Auto-load first GIPHY page so the picker feels alive on open.
  const didInitial = useRef(false);
  useEffect(() => {
    if (didInitial.current) return;
    didInitial.current = true;
    void searchOnline(query, "giphy");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const projectClips = project.clips
    .map((clip, idx) => ({ clip, idx }))
    .filter(({ clip, idx }) => {
      if (excludeIdx !== undefined && idx === excludeIdx) return false;
      return !!(clip.vertical_path || clip.cut_path);
    });

  async function searchOnline(nextQuery: string, nextTab: Tab) {
    if (nextTab !== "giphy" && nextTab !== "pexels" && nextTab !== "pixabay") return;
    setSearching(true);
    setProviderError(null);
    setMissingKey(null);
    try {
      const res = await sidecar.reactionSearchProvider(nextQuery, nextTab, 18);
      setResults((prev) => ({ ...prev, [nextTab]: res.results }));
      if (res.results.length === 0) {
        setProviderError(`No ${nextTab} results for "${nextQuery}". Try a single emotion: laugh, shocked, applause.`);
      }
    } catch (e) {
      const msg = humanError(e);
      if (/not connected|api key/i.test(msg)) {
        setMissingKey(nextTab);
      } else {
        setProviderError(msg);
      }
      setResults((prev) => ({ ...prev, [nextTab]: [] }));
    } finally {
      setSearching(false);
    }
  }

  async function chooseOnline(item: ReactionSearchResult) {
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
    setMissingKey(null);
    if ((next === "giphy" || next === "pexels" || next === "pixabay") && results[next].length === 0) {
      void searchOnline(query, next);
    }
  }

  const provider = TAB_DEFS.find((t) => t.key === tab)!;
  const isProviderTab = tab === "giphy" || tab === "pexels" || tab === "pixabay";
  const currentResults = results[tab];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 sm:p-6"
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
                Pick a reaction clip
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper/55">
                {isProviderTab ? provider.credit : tab === "project" ? "From this project" : "Upload from disk"}
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
                  placeholder={`Search ${provider.label}…`}
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
          {missingKey && <MissingKeyBanner tab={missingKey} />}
          {providerError && !missingKey && (
            <p className="mb-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 font-sans text-[12px] text-[#FCA5A5]">
              {providerError}
            </p>
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

          {isProviderTab && !missingKey && (
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

function MissingKeyBanner({ tab }: { tab: Tab }) {
  const name = tab.toUpperCase();
  return (
    <div className="mb-4 rounded-xl border border-fuchsia-soft bg-fuchsia-soft/10 px-4 py-3">
      <p className="font-display text-[13px] font-semibold text-white">
        {name} isn't connected.
      </p>
      <p className="mt-1 font-sans text-[12px] text-paper/70">
        Add your {name} API key in Settings → API keys to search this provider.
      </p>
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
  tab: Tab;
  results: ReactionSearchResult[];
  loading: boolean;
  downloadingId: string | null;
  onPick: (item: ReactionSearchResult) => void;
}) {
  if (loading && results.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-video animate-pulse rounded-lg bg-paper/5" />
        ))}
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.1em] text-paper/45">
        Search to load {tab} results
      </p>
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

// ── Reset (kept for Settings) ──────────────────────────────────────────

export function resetOverlayPickerMemory() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("junior:overlay-source-last-choice");
  window.localStorage.removeItem("junior:overlay-source-skip-modal");
}
