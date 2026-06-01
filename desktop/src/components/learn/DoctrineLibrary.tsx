// Uncle Daniel doctrine library (sprint #14c).
//
// Surfaces the 365-episode YouTube library inside Liquid Lift. The library
// is the post-conversion retention moat — clippers stay because the
// doctrine episodes keep coming. New clippers find Daniel via Minecraft
// videos; the doctrine library is what makes them stay.
//
// Pulls from /doctrine/episodes (which fronts Daniel's Notion DB). Until
// the Notion env vars are set on the backend, returns the curated mock
// list so the UI is fully testable end-to-end.

import { useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, Loader2, PlayCircle } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  listDoctrineEpisodes,
  listDoctrineCategories,
  type DoctrineEpisode,
} from "../../lib/backend";
import { track } from "../../lib/analytics";

export function DoctrineLibrary() {
  const [episodes, setEpisodes] = useState<DoctrineEpisode[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track("doctrine_library_opened");
    let cancelled = false;
    void (async () => {
      const [eps, cats] = await Promise.all([
        listDoctrineEpisodes(),
        listDoctrineCategories(),
      ]);
      if (cancelled) return;
      setEpisodes(eps);
      setCategories(cats);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function handleCategoryChange(c: string | null) {
    setSelectedCategory(c);
    track("doctrine_category_filtered", { category: c ?? "all" });
  }

  const filteredEpisodes = useMemo(() => {
    if (!selectedCategory) return episodes;
    return episodes.filter((e) => (e.category ?? "").toLowerCase() === selectedCategory.toLowerCase());
  }, [episodes, selectedCategory]);

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="animate-spin text-fuchsia" size={32} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          uncle daniel · doctrine library
        </p>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          The laws of internet money, attention, and leverage
        </h1>
        <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
          {episodes.length} episodes on what actually works. Watch one before your next clip.
        </p>
      </header>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <CategoryChip
            label="All"
            active={selectedCategory === null}
            onClick={() => handleCategoryChange(null)}
          />
          {categories.map((c) => (
            <CategoryChip
              key={c}
              label={c}
              active={selectedCategory === c}
              onClick={() => handleCategoryChange(c)}
            />
          ))}
        </div>
      )}

      {/* Episodes grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredEpisodes.map((ep) => (
          <EpisodeCard key={ep.id} episode={ep} />
        ))}
      </div>

      {filteredEpisodes.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-paper p-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            no episodes in this category yet
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
        active
          ? "border-fuchsia bg-fuchsia-soft text-fuchsia-deep"
          : "border-line bg-paper text-text-secondary hover:border-fuchsia/50 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function EpisodeCard({ episode }: { episode: DoctrineEpisode }) {
  const canOpen = !!episode.youtube_url;
  return (
    <button
      type="button"
      onClick={() => {
        if (canOpen) {
          track("doctrine_episode_clicked", {
            episode_number: episode.episode_number ?? undefined,
            category: episode.category ?? undefined,
          });
          void openExternal(episode.youtube_url!);
        }
      }}
      disabled={!canOpen}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-paper p-4 text-left transition-all hover:border-fuchsia/60 hover:shadow-[var(--glow-sm)] disabled:cursor-default disabled:hover:border-line disabled:hover:shadow-none"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink">
        {episode.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={episode.thumbnail_url}
            alt=""
            className="h-full w-full object-cover opacity-95 transition-opacity group-hover:opacity-100"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-soft/30 via-paper-elev to-ink">
            <span className="font-display text-[24px] font-bold tracking-[-0.02em] text-fuchsia-deep/70">
              {episode.episode_number ? `Ep ${String(episode.episode_number).padStart(3, "0")}` : "Ep —"}
            </span>
          </div>
        )}
        {canOpen && (
          <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-paper/90 text-fuchsia-deep opacity-0 transition-opacity group-hover:opacity-100">
            <ExternalLink size={14} strokeWidth={2.5} />
          </span>
        )}
        {!episode.published && (
          <span className="absolute left-2 top-2 inline-flex items-center rounded-full bg-paper/90 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-tertiary">
            coming soon
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          {episode.episode_number !== null && (
            <span>Ep {String(episode.episode_number).padStart(3, "0")}</span>
          )}
          {episode.category && (
            <>
              <span>·</span>
              <span className="text-fuchsia-deep">{episode.category}</span>
            </>
          )}
          {episode.duration_min !== null && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5"><Clock size={10} /> {episode.duration_min}m</span>
            </>
          )}
        </div>
        <h3 className="font-display text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
          {episode.title}
        </h3>
        {episode.description && (
          <p className="line-clamp-2 font-sans text-[12px] leading-relaxed text-text-secondary">
            {episode.description}
          </p>
        )}
      </div>

      {canOpen && (
        <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fuchsia-deep">
          <PlayCircle size={12} /> watch on youtube
        </p>
      )}
    </button>
  );
}
