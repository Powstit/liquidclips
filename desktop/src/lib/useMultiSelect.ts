// ship-lens v0.7.13: Grid + multi-select COMBINED. Selection state for the
// ResultsGrid cards lives here so ResultsGrid stays a thin shell and the
// selection chord (meta/shift/plain click + select-all + clear) is testable
// in isolation. Mirrors the workbench store's selection contract but for the
// grid surface — Set<number> of clip indices, not Set<WindowId>.
//
// USER JOURNEY · useMultiSelect
//   ENABLES — clipper picks 5 clips with shift-range or meta-toggle, then
//             fans out a single caption/ratio/publish action via the
//             floating GridMasterToolbar. No drag, no mode switch.
//   PREVENTS — accidental whole-grid wipes: plain click REPLACES the
//             selection, so a stray click while reviewing doesn't strand
//             the previous selection silently.
//   BREAKS — none — additive hook, ResultsGrid owns the instance and the
//            keyboard handler.
//   STRANDS — shift-click with no `lastClickedIdx` falls back to plain
//             click (single-set) so the very first click never silently
//             no-ops.

import { useCallback, useRef, useState } from "react";

export type MultiSelectClickMods = {
  meta?: boolean;
  shift?: boolean;
};

export type MultiSelect = {
  selected: Set<number>;
  isSelected(idx: number): boolean;
  toggle(idx: number, e: MultiSelectClickMods): void;
  selectAll(maxIdx: number): void;
  clear(): void;
  lastClickedIdx: number | null;
};

export function useMultiSelect(): MultiSelect {
  const [selected, setSelected] = useState<Set<number>>(() => new Set<number>());
  // Last meta/plain click anchor — shift-click extends from this index.
  // Held in a ref so a shift-range click does NOT need a re-render of the
  // anchor first; the chord lands on a single state update.
  const lastClickedRef = useRef<number | null>(null);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  const isSelected = useCallback(
    (idx: number) => selected.has(idx),
    [selected],
  );

  const toggle = useCallback(
    (idx: number, e: MultiSelectClickMods) => {
      // Shift-range: extend from the anchor to idx (inclusive). Falls back
      // to plain single-set when there is no anchor — never silently no-ops.
      if (e.shift && lastClickedRef.current !== null) {
        const anchor = lastClickedRef.current;
        const lo = Math.min(anchor, idx);
        const hi = Math.max(anchor, idx);
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(i);
          return next;
        });
        // Note: shift-click does NOT move the anchor — repeated shift-clicks
        // grow/shrink the range from the original meta/plain anchor.
        return;
      }
      if (e.meta) {
        // Meta-toggle: in/out of the set for this idx only.
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
          return next;
        });
        lastClickedRef.current = idx;
        setLastClickedIdx(idx);
        return;
      }
      // Plain click: clear + set to just this idx. Replaces the selection
      // so a stray click during review doesn't strand the previous picks.
      setSelected(new Set<number>([idx]));
      lastClickedRef.current = idx;
      setLastClickedIdx(idx);
    },
    [],
  );

  const selectAll = useCallback((maxIdx: number) => {
    // Fills 0..maxIdx inclusive. Caller passes (project.clips.length - 1)
    // so an empty grid (maxIdx < 0) results in an empty set, not a throw.
    if (maxIdx < 0) {
      setSelected(new Set<number>());
      return;
    }
    const next = new Set<number>();
    for (let i = 0; i <= maxIdx; i++) next.add(i);
    setSelected(next);
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set<number>());
    lastClickedRef.current = null;
    setLastClickedIdx(null);
  }, []);

  return {
    selected,
    isSelected,
    toggle,
    selectAll,
    clear,
    lastClickedIdx,
  };
}
