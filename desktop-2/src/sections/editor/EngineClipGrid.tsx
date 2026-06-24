import type { Clip, PlatformKey } from "../../fixtures/fakeEditor";

import { PLATFORMS, PLATFORM_KEYS, formatTime, posterGradient } from "../../fixtures/fakeEditor";
import { fakeAccount } from "../../fixtures/fakeAccount";
import { bus } from "../../design-os/bridge";

interface EngineClipGridProps {
  clips: Clip[];
  selectedIds: Set<number>;
  toggleSelected: (id: number) => void;
  selectAll: () => void;
  clearSelected: () => void;
  filter: "all" | "hi" | "short" | "react";
  setFilter: (f: "all" | "hi" | "short" | "react") => void;
  sortKey: "score" | "dur" | "time";
  setSortKey: (k: "score" | "dur" | "time") => void;
  query: string;
  setQuery: (q: string) => void;
  onEdit: (clip: Clip) => void;
  onRegenerate: (id: number) => void;
  onOpenConnect: (id: number) => void;
  onGenerateMore: () => void;
  generating: boolean;
  onAyrsharePublish: () => void;
  stamp: string;
}

export function EngineClipGrid({
  clips,
  selectedIds,
  toggleSelected,
  selectAll,
  clearSelected,
  filter,
  setFilter,
  sortKey,
  setSortKey,
  query,
  setQuery,
  onEdit,
  onRegenerate,
  onOpenConnect,
  onGenerateMore,
  generating,
  onAyrsharePublish,
  stamp,
}: EngineClipGridProps) {
  const filtered = clips
    .filter((c) => {
      if (filter === "hi") return c.score >= 80;
      if (filter === "short") return c.dur < 30;
      if (filter === "react") return c.reaction;
      return true;
    })
    .filter((c) => {
      if (!query.trim()) return true;
      return (`${c.hl} ${c.rest}`).toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => {
      if (sortKey === "score") return b.score - a.score;
      if (sortKey === "dur") return a.dur - b.dur;
      return a.start - b.start;
    });

  const filterCounts = {
    all: clips.length,
    hi: clips.filter((c) => c.score >= 80).length,
    short: clips.filter((c) => c.dur < 30).length,
    react: clips.filter((c) => c.reaction).length,
  };

  return (
    <>
      <div className="lc2-engine-toolbar">
        <div className="lc2-engine-chips">
          {([
            { key: "all", label: "All" },
            { key: "hi", label: "Score 80+" },
            { key: "short", label: "Under 30s" },
            { key: "react", label: "Has reaction" },
          ] as const).map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`lc2-engine-chip${filter === chip.key ? " on" : ""}`}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label} <span className="lc2-engine-chip-ct">{filterCounts[chip.key]}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div className="lc2-engine-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hooks…"
          />
        </div>
        <select
          className="lc2-engine-select"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as "score" | "dur" | "time")}
        >
          <option value="score">Sort: Score</option>
          <option value="dur">Sort: Shortest</option>
          <option value="time">Sort: Chronological</option>
        </select>
      </div>

      <div className="lc2-engine-master">
        <span className="lc2-engine-master-lbl">Selected:</span>
        <button type="button" className="lc2-engine-mbtn" onClick={() => bus.emit("nav:click", { route: "schedule" })}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
          Schedule
        </button>
        <button type="button" className="lc2-engine-mbtn" onClick={onAyrsharePublish}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          Publish
        </button>
        <button type="button" className="lc2-engine-mbtn" onClick={() => {}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16" />
          </svg>
          Caption
        </button>
        <button type="button" className="lc2-engine-mbtn" onClick={() => {}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="3" width="12" height="18" rx="2" />
          </svg>
          Ratio
        </button>
        <button type="button" className="lc2-engine-mbtn" onClick={() => {}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="8" height="18" rx="1" />
            <rect x="13" y="3" width="8" height="8" rx="1" />
            <rect x="13" y="13" width="8" height="8" rx="1" />
          </svg>
          Layout
        </button>
        <button type="button" className="lc2-engine-mbtn" onClick={selectAll}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Select all
        </button>
        {selectedIds.size > 0 && (
          <button type="button" className="lc2-engine-mbtn" onClick={clearSelected}>
            Clear
          </button>
        )}
      </div>

      <div className="lc2-engine-counts">
        <b>{filtered.length}</b> clips · stamped {stamp} · click + on any clip to connect accounts ·{" "}
        <b>{fakeAccount.clipsRemaining}</b> / {fakeAccount.clipsCap} clips remaining
      </div>

      <div className="lc2-engine-grid">
        {filtered.map((clip) => {
          const [p1, p2] = posterGradient(clip.id);
          const selected = selectedIds.has(clip.id);
          return (
            <article
              key={clip.id}
              className={`lc2-engine-card${selected ? " sel" : ""}${clip.fresh ? " fresh" : ""}`}
              onClick={() => toggleSelected(clip.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEdit(clip);
              }}
            >
              <div className="lc2-engine-poster" style={{ background: `linear-gradient(160deg, ${p1}, ${p2})` }}>
                <div className="lc2-engine-pg" />
                <div className="lc2-engine-subj" />
                <div className="lc2-engine-score">
                  <i />
                  {clip.score}
                </div>
                <div className="lc2-engine-socials">
                  {[...clip.plats].slice(0, 3).map((k) => (
                    <div key={k} className="lc2-engine-sico">
                      {PLATFORMS[k].renderIcon({ size: 13 })}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="lc2-engine-addplat"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenConnect(clip.id);
                    }}
                    aria-label="connect accounts"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
                <div className="lc2-engine-moment">{clip.moment}</div>
                {clip.reaction && (
                  <div className="lc2-engine-moment lc2-engine-moment-react">Reaction</div>
                )}
                <div className="lc2-engine-check">
                  {selected && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </div>
                <div className="lc2-engine-cwm">
                  <i />
                  <span>{stamp}</span>
                </div>
                <div className="lc2-engine-dur-pill">{formatTime(clip.dur)}</div>
              </div>
              <div className="lc2-engine-meta">
                <div className="lc2-engine-hook">
                  {clip.hl} {clip.rest}
                </div>
                <div className="lc2-engine-submeta">
                  <span>{formatTime(clip.dur)}</span>
                  <span className="lc2-engine-dot" />
                  <span>from {formatTime(clip.start)}</span>
                </div>
                <div className="lc2-engine-acts">
                  <button
                    type="button"
                    className="lc2-engine-mini solid"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(clip);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="lc2-engine-mini sq"
                    title="Regenerate this clip"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegenerate(clip.id);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="lc2-engine-mini sq"
                    title="Connect accounts"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenConnect(clip.id);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
                    </svg>
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        <button type="button" className="lc2-engine-addwin" onClick={onGenerateMore} disabled={generating}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {generating ? "Generating…" : "+ window"}
        </button>
      </div>
    </>
  );
}

interface ConnectModalProps {
  clip: Clip | null;
  onClose: () => void;
  togglePlatform: (key: PlatformKey) => void;
}

export function ConnectModal({ clip, onClose, togglePlatform }: ConnectModalProps) {
  if (!clip) return null;
  return (
    <div className="lc2-engine-scrim open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lc2-engine-modal">
        <h3>Connect this clip</h3>
        <p className="lc2-engine-modal-sub">Pick the accounts this clip posts to. Each clip can have its own.</p>
        {PLATFORM_KEYS.map((key) => {
          const on = clip.plats.has(key);
          const P = PLATFORMS[key];
          return (
            <button
              key={key}
              type="button"
              className={`lc2-engine-platrow${on ? " on" : ""}`}
              onClick={() => togglePlatform(key)}
            >
              <div className="lc2-engine-platrow-pi">{P.renderIcon({ size: 18 })}</div>
              <div className="lc2-engine-platrow-pn">
                {P.name}
                <div className="lc2-engine-platrow-ph">{P.handle}</div>
              </div>
              <div className="lc2-engine-platrow-tk">
                {on && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
        <button type="button" className="lc2-engine-btn-primary" style={{ width: "100%", height: 44, marginTop: 6 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
