/**
 * UpdateKadeComposition · Remotion composition for the mandatory
 * update gate.
 *
 * Kade drifts + pulses under a fuchsia halo bloom while the update
 * downloads/installs. Pose swaps with the gate state so the animation
 * reads honestly:
 *   checking / available → kade-reading-brief (patient)
 *   downloading          → kade-cutting-clips (working)
 *   installing           → kade-generating-captions (finalising)
 *   error                → kade-error
 *
 * Rendered inside @remotion/player Player · loops indefinitely at 30fps.
 */

import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

export type UpdateKadeState =
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error";

type KadeCompositionProps = {
  state: UpdateKadeState;
};

const KADE_BY_STATE: Record<UpdateKadeState, string> = {
  checking: "/brand/kade/kade-reading-brief.webp",
  available: "/brand/kade/kade-reading-brief.webp",
  downloading: "/brand/kade/kade-cutting-clips.webp",
  installing: "/brand/kade/kade-generating-captions.webp",
  error: "/brand/kade/kade-error.webp",
};

export function UpdateKadeComposition({ state }: KadeCompositionProps): React.ReactElement {
  const frame = useCurrentFrame();

  // Drift · vertical float over 90 frames (3s at 30fps)
  const driftY = interpolate(frame % 90, [0, 45, 90], [0, -10, 0], {
    extrapolateLeft: "extend",
    extrapolateRight: "extend",
  });

  // Halo pulse · scale + opacity over 60 frames (2s)
  const haloScale = interpolate(frame % 60, [0, 30, 60], [1, 1.12, 1], {
    extrapolateLeft: "extend",
    extrapolateRight: "extend",
  });
  const haloOpacity = interpolate(frame % 60, [0, 30, 60], [0.55, 0.85, 0.55], {
    extrapolateLeft: "extend",
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill
      style={{
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Fuchsia halo bloom · behind Kade */}
      <div
        style={{
          position: "absolute",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at center, rgba(255, 26, 140, 0.85) 0%, rgba(255, 26, 140, 0.32) 45%, transparent 72%)",
          filter: "blur(24px)",
          transform: `scale(${haloScale})`,
          opacity: haloOpacity,
        }}
      />

      {/* Kade himself · drift on Y */}
      <Img
        src={KADE_BY_STATE[state]}
        style={{
          position: "relative",
          width: 260,
          height: "auto",
          transform: `translateY(${driftY}px)`,
          filter: "drop-shadow(0 20px 40px rgba(0, 0, 0, 0.55))",
        }}
      />
    </AbsoluteFill>
  );
}
