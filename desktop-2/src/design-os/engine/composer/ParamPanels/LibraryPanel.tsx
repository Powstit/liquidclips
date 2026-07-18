/**
 * LibraryPanel · Composer flowLibrary source picker.
 *
 * ⚠ IRON GATE IG-COMPOSER-L · Library source contract.
 * This panel is the ONE place Composer picks a clip source from HQ's
 * 1.3M-channel archive. It reads through src/lib/hqLibrary.ts (which
 * routes through junior-backend/library/*) — never through mock
 * fixtures and never against HQ's hostname directly.
 *
 * onPick contract:
 *   - "query"          → user typed a search string (debounced blur).
 *   - "niche"          → user picked a niche chip.
 *   - "librarySource"  → user clicked a tile · payload = the full
 *                        LibraryHandoffResponse from getLibraryHandoff().
 *
 * The hollow-theater fixture (a hardcoded result array with mock IDs
 * and creator-name filter chips) that used to live here was the exact
 * regression Sprint 2 called out. Reintroducing any hardcoded results
 * array breaks IG-COMPOSER-L and the desktop demo returns to theater.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import {
  searchLibrary,
  getLibraryHandoff,
  ytThumbnailUrl,
  type LibraryChannelHit,
  type LibraryHandoffResponse,
} from "../../../../lib/hqLibrary";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const NICHE_CHIPS = ["business", "tech", "health", "education", "motivation"] as const;
const SEARCH_DEBOUNCE_MS = 320;
const RESULT_LIMIT = 12;

export function LibraryPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const [query, setQuery] = useState("");
  const [niche, setNiche] = useState<string | null>(null);
  const [results, setResults] = useState<LibraryChannelHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [picked, setPicked] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (nextQuery: string, nextNiche: string | null) => {
    setState("loading");
    try {
      const resp = await searchLibrary({
        q: nextQuery,
        niche: nextNiche ?? undefined,
        has_video: 1,
        limit: RESULT_LIMIT,
      });
      const hits = resp.results ?? [];
      setResults(hits);
      setState(hits.length === 0 ? "empty" : "idle");
    } catch (_err) {
      setResults([]);
      setState("error");
    }
  }, []);

  // Fire an initial search when the panel first becomes visible.
  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Library",
      body: "Search 1.3M creators. Pick a source.",
      severity: "info",
    });
    if (results.length === 0 && state === "idle") {
      void runSearch("", null);
    }
  }, [visible, results.length, state, runSearch]);

  const onQueryChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      onPick("query", nextQuery);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        void runSearch(nextQuery, niche);
      }, SEARCH_DEBOUNCE_MS);
    },
    [niche, onPick, runSearch],
  );

  const onNichePick = useCallback(
    (chip: string) => {
      const next = niche === chip ? null : chip;
      setNiche(next);
      onPick("niche", next);
      void runSearch(query, next);
    },
    [niche, onPick, query, runSearch],
  );

  const onTilePick = useCallback(
    async (hit: LibraryChannelHit) => {
      setPicked(hit.video_id);
      try {
        const handoff: LibraryHandoffResponse = await getLibraryHandoff(hit.video_id);
        onPick("librarySource", handoff);
      } catch (_err) {
        // Handoff failure surfaces to Kade via bus so the user sees a
        // real recovery affordance, not a silent no-op tile.
        bus.emit("kade:speak", {
          title: "Library",
          body: "That video couldn't load. Try another.",
          severity: "warn",
        });
      }
    },
    [onPick],
  );

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
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search the library · handle · niche · topic"
        aria-label="Library search"
        data-testid="library-search-input"
      />

      <div className="param-section">
        <div className="param-section-label">Niche</div>
        <div className="param-chip-row">
          {NICHE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              className="param-chip"
              data-picked={niche === chip ? "true" : "false"}
              onClick={() => onNichePick(chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Results</div>
        <div className="param-grid" data-library-state={state}>
          {state === "loading" && <div className="param-empty">searching the 1.3M archive…</div>}
          {state === "empty" && <div className="param-empty">nothing here yet · try another search</div>}
          {state === "error" && <div className="param-empty">library unreachable · retry in a moment</div>}
          {state === "idle" &&
            results.map((hit) => (
              <button
                key={hit.video_id}
                type="button"
                className="param-tile"
                data-picked={picked === hit.video_id ? "true" : "false"}
                data-video-id={hit.video_id}
                onClick={() => void onTilePick(hit)}
                style={{ height: 96, position: "relative", overflow: "hidden" }}
              >
                <img
                  src={ytThumbnailUrl(hit.video_id)}
                  alt=""
                  loading="lazy"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "relative",
                    zIndex: 1,
                    background: "rgba(6,5,9,.72)",
                    padding: "3px 6px",
                    borderRadius: 4,
                    fontSize: 10,
                    alignSelf: "flex-end",
                  }}
                >
                  {hit.name || hit.handle}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export default LibraryPanel;
