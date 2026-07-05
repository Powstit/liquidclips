import { Composition } from "remotion";
import { Preview } from "./Preview";
import { DEFAULT_PROPS } from "./lib/types";
import { AgencyOverlay } from "./AgencyOverlay";
import { AGENCY_OVERLAY_DEFAULT_PROPS } from "./lib/agencyTypes";

export const RemotionRoot = () => {
  return (
    <>
      {/* HQ's cold-email preview composition · full-frame marketing MP4. */}
      <Composition
        id="Preview"
        component={Preview}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_PROPS}
      />
      {/* 2026-07-05 · CM lane · AgencyOverlay alpha overlay composition.
       *  Renders ONLY the agency logo (+ optional handle text) on a
       *  transparent background. Vertical 1080x1920 to match the desktop
       *  app's default clip output format (9:16 · TikTok/Reels/Shorts).
       *  ffmpeg composites this WebM over the user's real clip MP4. */}
      <Composition
        id="AgencyOverlay"
        component={AgencyOverlay}
        durationInFrames={AGENCY_OVERLAY_DEFAULT_PROPS.durationInFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={AGENCY_OVERLAY_DEFAULT_PROPS}
        // Alpha-aware composition · durationInFrames param wins over
        // the constant so the caller can pass a real clip's frame count.
        calculateMetadata={({ props }) => ({
          durationInFrames: props.durationInFrames,
        })}
      />
    </>
  );
};
