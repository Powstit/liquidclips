/**
 * PlatformPickerPopover · UI-3
 *
 * Tiny popover anchored to the ClipCard's platform-badges button. Lets the
 * user toggle which platforms the clip targets. Mock-only — mutations stay
 * in component state until Batch D wires `sidecar.setClipPlatforms`.
 */

import { useEffect, useRef } from "react";
import type { Platform } from "./types";
import { useRegisterModal } from "../components/ModalPortal";
import "./PlatformPickerPopover.css";

const OPTIONS: ReadonlyArray<{ id: Platform; label: string; glyph: string }> = [
  { id: "tiktok",    label: "TikTok",    glyph: "T" },
  { id: "youtube",   label: "YT Shorts", glyph: "Y" },
  { id: "instagram", label: "IG Reels",  glyph: "I" },
  { id: "x",         label: "X",         glyph: "X" },
];

export interface PlatformPickerPopoverProps {
  value: Platform[];
  onChange: (next: Platform[]) => void;
  onClose: () => void;
}

export function PlatformPickerPopover({
  value, onChange, onClose,
}: PlatformPickerPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · Esc via
  // ModalPortal LIFO stack. role="dialog" (line 54) makes this a modal
  // per ARIA regardless of visual popover framing · use the same
  // dismissal contract as every other modal.
  useRegisterModal({ id: "platform-picker-popover", open: true, onEscape: onClose });

  // Outside-click dismissal · kept as its own effect (not modeled by
  // useRegisterModal). Defer the listener so the click that opened the
  // popover doesn't immediately close it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener("mousedown", onDown), 50);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const toggle = (id: Platform) => {
    onChange(value.includes(id) ? value.filter((p) => p !== id) : [...value, id]);
  };

  return (
    <div ref={ref} className="lc-pp-popover" role="dialog" aria-label="Target platforms">
      <span className="lc-pp-eb">Target platforms</span>
      <div className="lc-pp-row">
        {OPTIONS.map((opt) => {
          const on = value.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={on}
              className={`lc-pp-chip ${on ? "on" : ""}`}
              onClick={(e) => { e.stopPropagation(); toggle(opt.id); }}
            >
              <span className={`lc-pp-dot lc-pp-dot-${opt.id}`}>{opt.glyph}</span>
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
