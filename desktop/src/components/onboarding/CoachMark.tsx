// ship-lens v0.7.14: K-γ — CoachMark
// Individual contextual highlight with tooltip. Used by StudioTour.
// Shows a spotlight cutout over the target element + a tooltip card.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";

interface CoachMarkProps {
  target: string;
  title: string;
  body: string;
  position: "top" | "bottom" | "left" | "right";
  step: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}

export function CoachMark({
  target,
  title,
  body,
  position,
  step,
  total,
  onNext,
  onSkip,
}: CoachMarkProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Query the target element and observe its position
  useEffect(() => {
    const el = document.querySelector(target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    }
  }, [target]);

  // Calculate tooltip position based on target rect and desired position
  useEffect(() => {
    if (!targetRect || !tooltipRef.current) return;
    const tt = tooltipRef.current.getBoundingClientRect();
    let top = 0;
    let left = 0;
    const GAP = 16;

    switch (position) {
      case "top":
        top = targetRect.top - tt.height - GAP;
        left = targetRect.left + targetRect.width / 2 - tt.width / 2;
        break;
      case "bottom":
        top = targetRect.bottom + GAP;
        left = targetRect.left + targetRect.width / 2 - tt.width / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tt.height / 2;
        left = targetRect.left - tt.width - GAP;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tt.height / 2;
        left = targetRect.right + GAP;
        break;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - tt.height - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tt.width - 8));

    setTooltipPos({ top, left });
  }, [targetRect, position]);

  if (!targetRect) return null;

  const isLast = step === total;

  return (
    <>
      {/* Spotlight — cutout over the target element */}
      <div
        className="absolute rounded-xl border-2 border-fuchsia shadow-[0_0_24px_rgba(255,26,140,0.25)] transition-all duration-300"
        style={{
          top: targetRect.top - 4,
          left: targetRect.left - 4,
          width: targetRect.width + 8,
          height: targetRect.height + 8,
          pointerEvents: "none",
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute z-10 w-[300px] rounded-xl border border-line bg-paper p-5 shadow-xl"
        style={tooltipPos ? { top: tooltipPos.top, left: tooltipPos.left } : { visibility: "hidden" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
            Step {step} of {total}
          </span>
          <button
            onClick={onSkip}
            className="grid h-6 w-6 place-items-center rounded-full text-text-tertiary transition-colors hover:text-ink"
            aria-label="Skip tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Title */}
        <h4 className="mt-2 font-display text-[15px] font-semibold text-ink">
          {title}
        </h4>

        {/* Body */}
        <p className="mt-1 font-sans text-[13px] leading-relaxed text-text-secondary">
          {body}
        </p>

        {/* CTA */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onSkip}
            className="rounded-full px-3 py-1.5 font-sans text-[12px] text-text-tertiary transition-colors hover:text-ink"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[12px] font-semibold text-white transition-colors hover:bg-fuchsia-deep"
          >
            {isLast ? "Finish" : "Got it"}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
