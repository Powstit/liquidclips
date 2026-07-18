/**
 * LibraryPanel · Composer Phase 1b · F4 flowLibrary
 *
 * 4-cell thumbnail grid (mocked clips) + search box + Hormozi/Alex/Iman
 * filter chips.
 *
 * Cockpit hook: none (library search hits the sidecar / real store in
 * Phase 1c). onPick surfaces the resolved clip / query to Composer.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const CELLS = [
  { id: "clip-01", label: "Clip 01" },
  { id: "clip-02", label: "Clip 02" },
  { id: "clip-03", label: "Clip 03" },
  { id: "clip-04", label: "Clip 04" },
] as const;

const FILTERS = ["Hormozi", "Alex", "Iman"] as const;

export function LibraryPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Library",
      body: "Search · filter · pick a clip.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F4</span>
        <span className="param-panel-title">Library</span>
      </div>

      <input
        className="param-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => onPick("query", query)}
        placeholder="Find clip · title / keyword"
        aria-label="Library search"
      />

      <div className="param-section">
        <div className="param-section-label">Filter</div>
        <div className="param-chip-row">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="param-chip"
              data-picked={filter === f ? "true" : "false"}
              onClick={() => {
                const next = filter === f ? null : f;
                setFilter(next);
                onPick("filter", next);
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Results</div>
        <div className="param-grid">
          {CELLS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="param-tile"
              data-picked={picked === c.id ? "true" : "false"}
              onClick={() => {
                setPicked(c.id);
                onPick("clipId", c.id);
              }}
              style={{
                height: 56,
                background: "var(--paper-warm)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "flex-start",
                padding: 6,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default LibraryPanel;
