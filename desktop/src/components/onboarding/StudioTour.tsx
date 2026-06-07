// ship-lens v0.7.14: K-γ — StudioTour
// SURFACE: Onboarding Interactive Studio Tour
// CONTRACT: useOnboardingStep.ts (Claude C4)
// Guided walkthrough of the app: Workstation → Clips → Select → Schedule → Publish → Earn.
// Uses CoachMark components for contextual highlighting. 6-step sequence.

import { useState, useEffect, useCallback } from "react";
import { CoachMark } from "./CoachMark";

export type TourStep =
  | "workstation"
  | "clips"
  | "select"
  | "schedule"
  | "publish"
  | "earn";

interface StudioTourProps {
  onComplete: () => void;
  onSkip: () => void;
}

const STEP_SEQUENCE: TourStep[] = [
  "workstation",
  "clips",
  "select",
  "schedule",
  "publish",
  "earn",
];

const STEP_CONFIG: Record<
  TourStep,
  {
    title: string;
    body: string;
    target: string;
    position: "top" | "bottom" | "left" | "right";
  }
> = {
  workstation: {
    title: "Welcome to your studio",
    body: "This is your cockpit. Create clips from URLs, import files, or pick up where you left off.",
    target: "[data-tour='workstation']",
    position: "bottom",
  },
  clips: {
    title: "Your clips live here",
    body: "Every clip you generate shows up in this grid. Hover to preview, click to edit, select many to act on them all.",
    target: "[data-tour='clips-grid']",
    position: "top",
  },
  select: {
    title: "Select and compare",
    body: "Shift-click or Cmd-click to select multiple clips. Open the workbench to compare them side by side.",
    target: "[data-tour='workbench']",
    position: "left",
  },
  schedule: {
    title: "Queue your posts",
    body: "Drag clips to the calendar to schedule them. The auto-drip button finds the best times for you.",
    target: "[data-tour='schedule']",
    position: "bottom",
  },
  publish: {
    title: "Publish everywhere",
    body: "One click publishes to every platform. The app writes platform-specific copy so you don't have to.",
    target: "[data-tour='publish']",
    position: "right",
  },
  earn: {
    title: "Get paid",
    body: "Browse brand bounties that match your style. Swipe right to start clipping for cash.",
    target: "[data-tour='earn']",
    position: "bottom",
  },
};

export function StudioTour({ onComplete, onSkip }: StudioTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEP_SEQUENCE[stepIndex];
  const config = STEP_CONFIG[step];

  const advance = useCallback(() => {
    if (stepIndex >= STEP_SEQUENCE.length - 1) {
      onComplete();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, onComplete]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      if (e.key === "Enter" || e.key === "ArrowRight") advance();
    },
    [advance, onSkip]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div className="fixed inset-0 z-[60]" aria-label="Studio tour">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50" />

      <CoachMark
        target={config.target}
        title={config.title}
        body={config.body}
        position={config.position}
        step={stepIndex + 1}
        total={STEP_SEQUENCE.length}
        onNext={advance}
        onSkip={onSkip}
      />
    </div>
  );
}
