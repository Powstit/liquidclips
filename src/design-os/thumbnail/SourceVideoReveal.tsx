/**
 * SourceVideoReveal · Phase 6F pivot
 *
 * Top-of-route reveal panel:
 *   - project name (read-only)
 *   - source URL (read-only)
 *   - duration (read-only)
 *   - clip count (read-only)
 *   - EPISODE TITLE input (editable) — drives the thumbnail prompt in
 *     episode mode. Defaults to project.name on first read.
 *
 * Visible in both modes — context for the active project.
 */

import { useEffect, useState } from "react";
import { GlassCard } from "../components";
import { setEpisodeTitle } from "../state/engineSessionPersistence";
import "./SourceVideoReveal.css";

export interface SourceVideoRevealProps {
  projectName: string;
  sourceUrl?: string;
  sourcePath?: string;
  durationS?: number;
  clipCount: number;
  /** Initial episode title — usually project.name unless user has edited. */
  initialEpisodeTitle: string;
  /** Fires when the user types into the episode title input. */
  onEpisodeTitleChange?: (title: string) => void;
}

export function SourceVideoReveal({
  projectName, sourceUrl, sourcePath, durationS, clipCount,
  initialEpisodeTitle, onEpisodeTitleChange,
}: SourceVideoRevealProps) {
  const [title, setTitle] = useState(initialEpisodeTitle);

  useEffect(() => { setTitle(initialEpisodeTitle); }, [initialEpisodeTitle]);

  const source = sourceUrl ?? sourcePath ?? "—";

  const onTitleChange = (v: string) => {
    setTitle(v);
    setEpisodeTitle(v);
    onEpisodeTitleChange?.(v);
  };

  return (
    <GlassCard density="quiet" className="lc-svr">
      <div className="lc-svr-head">
        <span className="lc-svr-eb">Source video</span>
        <span className="lc-svr-meta">
          {durationS != null && <span>{fmtDuration(durationS)}</span>}
          <span>·</span>
          <span>{clipCount} clip{clipCount === 1 ? "" : "s"}</span>
        </span>
      </div>

      <div className="lc-svr-name">{projectName}</div>
      <div className="lc-svr-source" title={source}>{source}</div>

      <label className="lc-svr-title-field">
        <span className="lc-svr-title-eb">Episode title · used by gpt-image-1</span>
        <input
          className="lc-svr-title-input"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="The cold-open that actually works"
          maxLength={120}
        />
      </label>
    </GlassCard>
  );
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}
