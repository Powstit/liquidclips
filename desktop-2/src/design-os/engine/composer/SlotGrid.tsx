/**
 * SlotGrid · Composer Sprint 3 E7 · A/B/C region selection overlay.
 *
 * ⚠ IRON GATE IG-COMPOSER-U · Slot A/B/C system contract.
 *
 * Renders 3 overlay tiles labeled A / B / C. Clicking a tile selects
 * it as the active region for the current flow (e.g. "add reaction to
 * slot B"). Also listens for "composer:slot-select" bus events so a
 * voice/text command router can select a slot without a click.
 *
 * The component is presentational + selection state only. Downstream
 * panels (Reaction, Trim, Watermark) can consume the selected slot via
 * the useComposerSlot() hook (exported below) so their write path
 * scopes to the right region.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E7.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { bus } from "../../bridge";
import { useEvent } from "../../bridge/useEvent";
import "./SlotGrid.css";

export type SlotLetter = "A" | "B" | "C";
export const SLOT_LETTERS: readonly SlotLetter[] = ["A", "B", "C"] as const;

/** Track the currently-selected slot at module scope so a non-mounted
 *  consumer can also read it via useComposerSlot() without prop-drilling.
 *  Listeners re-render on every emit. */
let _currentSlot: SlotLetter = "A";
const _listeners = new Set<(slot: SlotLetter) => void>();

function _setCurrentSlot(next: SlotLetter): void {
  if (_currentSlot === next) return;
  _currentSlot = next;
  for (const fn of _listeners) fn(next);
}

/** Read the currently-selected slot. */
export function getComposerSlot(): SlotLetter {
  return _currentSlot;
}

/** React hook · re-renders on slot change. Returns the current slot. */
export function useComposerSlot(): SlotLetter {
  const [slot, setSlot] = useState<SlotLetter>(_currentSlot);
  useEffect(() => {
    _listeners.add(setSlot);
    return () => {
      _listeners.delete(setSlot);
    };
  }, []);
  return slot;
}

/** Fire the "composer:slot-select" bus event and update the module-
 *  scope current slot. Any listener (SlotGrid render state,
 *  useComposerSlot subscribers) picks up the new value synchronously
 *  through the module-scope broadcast so a caller can read
 *  getComposerSlot() immediately after calling selectSlot(). */
export function selectSlot(slot: SlotLetter): void {
  _setCurrentSlot(slot);
  bus.emit("composer:slot-select", { slot });
}

export function SlotGrid(): ReactElement {
  const [active, setActive] = useState<SlotLetter>(_currentSlot);

  const onPick = useCallback((slot: SlotLetter) => {
    setActive(slot);
    _setCurrentSlot(slot);
    bus.emit("composer:slot-select", { slot });
  }, []);

  // Router / voice command entry: another surface calls selectSlot() or
  // emits composer:slot-select directly. Sync the local render state.
  useEvent("composer:slot-select", (payload) => {
    setActive(payload.slot);
    _setCurrentSlot(payload.slot);
  });

  return (
    <div className="lc-slotgrid" data-testid="composer-slotgrid" role="tablist" aria-label="Slot region">
      {SLOT_LETTERS.map((slot) => (
        <button
          key={slot}
          type="button"
          role="tab"
          className="lc-slotgrid-tile"
          data-slot={slot}
          data-active={active === slot ? "true" : "false"}
          aria-selected={active === slot}
          data-testid={`composer-slot-${slot}`}
          onClick={() => onPick(slot)}
        >
          <span className="lc-slotgrid-letter">{slot}</span>
        </button>
      ))}
    </div>
  );
}

export default SlotGrid;
