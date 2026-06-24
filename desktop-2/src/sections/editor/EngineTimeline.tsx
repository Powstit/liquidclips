import { useEffect, useRef } from "react";
import type { Clip, EditState } from "../../fixtures/fakeEditor";
import { formatTime } from "../../fixtures/fakeEditor";

interface EngineTimelineProps {
  clip: Clip;
  edit: EditState;
  setEdit: (patch: Partial<EditState>) => void;
}

export function EngineTimeline({ clip, edit, setEdit }: EngineTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const words = `${clip.hl} ${clip.rest}`.split(" ");
  const captionChunks: string[] = [];
  for (let i = 0; i < words.length; i += 2) {
    captionChunks.push(words.slice(i, i + 2).join(" "));
  }

  useEffect(() => {
    if (edit.playing) {
      const start = Date.now();
      const startPlayhead = edit.playhead;
      intervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const progress = (elapsed / clip.dur) * 84;
        const next = Math.min(92, startPlayhead + progress);
        if (next >= 92) {
          setEdit({ playing: false, playhead: 92 });
        } else {
          setEdit({ playhead: next });
        }
      }, 50);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [edit.playing, edit.playhead, clip.dur, setEdit]);

  const togglePlay = () => {
    if (edit.playing) {
      setEdit({ playing: false });
    } else {
      if (edit.playhead >= 92) setEdit({ playing: true, playhead: 8 });
      else setEdit({ playing: true });
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(8, Math.min(92, pct));
    setEdit({ playhead: clamped });
  };

  const splitAtPlayhead = () => {
    setEdit({ splits: [...edit.splits, edit.playhead] });
  };

  const addBRoll = () => {
    const id = `broll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setEdit({
      bRolls: [
        ...edit.bRolls,
        { id, left: edit.playhead, width: 12, label: "b-roll" },
      ],
    });
  };

  return (
    <div className="lc2-engine-timeline">
      <div className="lc2-engine-tl-head">
        <span className="lc2-engine-eyebrow">Timeline</span>
        <div className="lc2-engine-tl-tools">
          <button type="button" className="lc2-engine-tlbtn" onClick={splitAtPlayhead}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5" />
            </svg>
            Split
          </button>
          <button type="button" className="lc2-engine-tlbtn" onClick={addBRoll}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add b-roll
          </button>
          <input
            type="range"
            className="lc2-engine-slider"
            style={{ width: 80 }}
            min={1}
            max={4}
            defaultValue={2}
            aria-label="zoom"
          />
        </div>
      </div>

      <div className="lc2-engine-ruler">
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} className="lc2-engine-tick" style={{ left: `${i * 10}%` }}>
            {formatTime(Math.round((clip.dur * i) / 10))}
          </div>
        ))}
      </div>

      <div className="lc2-engine-track lc2-engine-track-video" ref={trackRef} onClick={handleTrackClick}>
        <div className="lc2-engine-tl-wave">
          {Array.from({ length: 90 }, (_, i) => (
            <span key={i} style={{ height: `${20 + ((i * 37) % 70)}%` }} />
          ))}
        </div>
        <div className="lc2-engine-trim l" />
        <div className="lc2-engine-trim r" />
        {edit.splits.map((left, idx) => (
          <div key={idx} className="lc2-engine-split-mark" style={{ left: `${left}%` }} />
        ))}
      </div>

      <div className="lc2-engine-track" style={{ padding: "0 4px", gap: 4 }}>
        {captionChunks.map((chunk, idx) => (
          <div key={idx} className="lc2-engine-capblock" style={{ flex: Math.max(1, chunk.length) }}>
            {chunk}
          </div>
        ))}
      </div>

      <div className="lc2-engine-track" style={{ opacity: clip.reaction ? 1 : 0.4 }}>
        <div className="lc2-engine-reactblock" style={{ marginLeft: "30%" }}>
          Reaction cam
        </div>
      </div>

      <div className="lc2-engine-track" style={{ color: "var(--color-text-tertiary)" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        B-roll / overlay track
        {edit.bRolls.map((b) => (
          <div
            key={b.id}
            className="lc2-engine-broll-block"
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
          >
            {b.label}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="lc2-engine-playhead"
        style={{ left: `${edit.playhead}%` }}
        onClick={togglePlay}
        aria-label={edit.playing ? "pause" : "play"}
      />

      <div className="lc2-engine-tl-playbar">
        <button
          type="button"
          className={`lc2-engine-pp${edit.playing ? " playing" : ""}`}
          onClick={togglePlay}
          aria-label={edit.playing ? "pause" : "play"}
        />
        <span className="lc2-engine-ptime">
          {formatTime(Math.round(((edit.playhead - 8) / 84) * clip.dur))} / {formatTime(clip.dur)}
        </span>
      </div>
    </div>
  );
}
