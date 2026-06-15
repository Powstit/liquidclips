// v0.7.77 — Library clip strip inside Projects tab.
//
// Daniel's diagnosis after the v0.7.77 polish landed:
//   "drag and drop isn't wired."
// The honest reason is cross-tab HTML5 drag is impossible — a user can't
// hold mouse-down on a LibraryCard in the Library tab and switch to the
// Projects tab mid-drag. So this strip puts a small Library presence
// INSIDE the Projects tab itself — source + target visible together.
//
// Each tile is `draggable` with the same custom MIME LibraryCard /
// ProjectCard already speak (`application/x-liquidclips-asset`), but
// adds a `kind: "library-clip"` discriminator so the target drop
// handler can attach JUST this clip instead of every clip from the
// source project (the existing whole-project drag fallback path).
//
// No new sidecar RPC. No App.tsx change. No LibraryCard change.
// No index.css change. Existing `addMembership` is the write path.

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileVideo } from "lucide-react";
import {
  humanError,
  sidecar,
  type Clip,
  type ProjectLibrarySummary,
} from "../../lib/sidecar";

type ClipEntry = {
  clip: Clip;
  source: ProjectLibrarySummary;
};

function clipDisplayPath(clip: Clip): string {
  return (
    clip.vertical_path ||
    clip.cut_path ||
    clip.square_path ||
    clip.portrait_path ||
    ""
  );
}

function clipThumbPath(clip: Clip): string | null {
  if (clip.thumbnails && clip.thumbnails.length > 0) {
    return clip.thumbnails[0].path;
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function LibraryClipStrip({
  excludeProjectSlug,
  limit = 12,
  hasProjects = true,
}: {
  /** Exclude clips from this project (e.g. the current Project Detail) so
   *  the strip doesn't show items that would be self-drops. Optional. */
  excludeProjectSlug?: string;
  /** Cap how many tiles to render. Default 12. */
  limit?: number;
  /** v0.7.78 — When false, the subtitle drops the "drag onto any project"
   *  hint (which is misleading with zero project tiles) and tells the user
   *  to create a project first. Default true preserves existing copy. */
  hasProjects?: boolean;
}) {
  const [entries, setEntries] = useState<ClipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { projects } = await sidecar.listProjects(200, false);
      const candidates = projects.filter(
        (p) => p.slug !== excludeProjectSlug && p.clips_count > 0,
      );
      // Newest sources first
      candidates.sort(
        (a, b) =>
          (b.updated_at || b.created_at || 0) -
          (a.updated_at || a.created_at || 0),
      );
      // Fetch top N projects' clips in parallel; flatten + cap to `limit`.
      const topProjects = candidates.slice(0, Math.max(limit, 8));
      const results = await Promise.all(
        topProjects.map(async (p) => {
          try {
            const { project } = await sidecar.getProject(p.slug);
            return { summary: p, clips: project.clips || [] };
          } catch {
            return { summary: p, clips: [] as Clip[] };
          }
        }),
      );
      const flat: ClipEntry[] = [];
      for (const { summary, clips } of results) {
        for (const clip of clips) {
          flat.push({ clip, source: summary });
          if (flat.length >= limit) break;
        }
        if (flat.length >= limit) break;
      }
      setEntries(flat);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, [excludeProjectSlug, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh when library changes (new clip rendered, archive, etc.)
  useEffect(() => {
    function onRefresh(): void {
      void load();
    }
    window.addEventListener("lc:library-refresh", onRefresh);
    return () => window.removeEventListener("lc:library-refresh", onRefresh);
  }, [load]);

  // Don't render anything if there's literally nothing to drag — keeps the
  // Projects tab empty state clean for a brand-new install.
  if (!loading && !error && entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-fuchsia">
            from library
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {hasProjects
              ? "drag onto any project to attach"
              : "create a project to attach clips here"}
          </span>
        </div>
        {!loading && !error && entries.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            {entries.length} clip{entries.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error ? (
        <div role="alert" className="error-banner">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-[var(--color-danger)]/50 bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/15"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="skeleton aspect-[16/10] w-[160px] shrink-0 rounded-2xl"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {entries.map((entry) => (
            <LibraryClipTile key={`${entry.source.slug}::${entry.clip.slug}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryClipTile({ entry }: { entry: ClipEntry }) {
  const [thumbError, setThumbError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const thumbRaw = clipThumbPath(entry.clip);
  const thumbSrc = thumbRaw && !thumbError ? convertFileSrc(thumbRaw) : null;
  const title =
    entry.clip.title ||
    basename(clipDisplayPath(entry.clip)) ||
    entry.clip.slug;
  const sourceTitle =
    entry.source.whop_bounty_title ||
    entry.source.source_filename ||
    entry.source.slug;
  const path = clipDisplayPath(entry.clip);

  return (
    <div
      draggable={!!path}
      // v0.7.77 — Capture-phase drag-start mirrors LibraryCard's pattern
      // so motion/Framer-style drag overrides don't shadow dataTransfer.
      onDragStartCapture={(e) => {
        if (!path) return;
        const payload = {
          kind: "library-clip" as const,
          project_slug: entry.source.slug,
          asset_path: path,
          asset_type: "clip" as const,
          source_project_slug: entry.source.slug,
          clip_id: entry.clip.slug,
        };
        try {
          e.dataTransfer.setData(
            "application/x-liquidclips-asset",
            JSON.stringify(payload),
          );
          e.dataTransfer.effectAllowed = "copyMove";
        } catch {
          /* dataTransfer can throw in rare browser states */
        }
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={`library-card group relative flex w-[160px] shrink-0 flex-col gap-1.5 rounded-2xl bg-paper-warm p-2 transition-all hover:shadow-[var(--glow-sm)] ${
        dragging ? "opacity-50" : ""
      }`}
      title={`${title}\nfrom ${sourceTitle}`}
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-paper-deep">
        {thumbSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-tertiary">
            <FileVideo className="h-5 w-5" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <p className="line-clamp-1 font-sans text-[11px] font-medium text-ink">
          {title}
        </p>
        <p className="line-clamp-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
          {sourceTitle}
        </p>
      </div>
    </div>
  );
}
