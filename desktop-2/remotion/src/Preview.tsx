import { AbsoluteFill, staticFile, Img } from "remotion";
import { PreviewProps } from "./lib/types";
import { colors } from "./lib/tokens";
import { WindowChrome } from "./components/WindowChrome";
import { InputPanel } from "./components/InputPanel";
import { ProgressBar } from "./components/ProgressBar";
import { ClipGrid } from "./components/ClipGrid";
import { CtaCard } from "./components/CtaCard";

export const Preview: React.FC<PreviewProps> = (props) => {
  return (
    <AbsoluteFill style={{ background: colors.paper }}>
      {/* Atmosphere backdrop - Liquid Clips workspace glow */}
      <AbsoluteFill style={{ opacity: 0.45 }}>
        <Img src={staticFile("brand/atmosphere-workspace.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>

      {/* Liquid Clips window chrome + sidebar */}
      <WindowChrome handle={props.handle} avatarUrl={props.avatarUrl} />

      {/* Input panel with their video thumbnail */}
      <InputPanel thumbnailUrl={props.thumbnailUrl} videoTitle={props.videoTitle} channelName={props.channelName} />

      {/* Fake progress bar - "Analysing... clipping..." */}
      <ProgressBar />

      {/* 8 real clip tiles pop into the grid */}
      <ClipGrid frameUrls={props.frameUrls} clipTitles={props.clipTitles} totalClips={props.totalClips} />

      {/* Final CTA - "Claim your clips" */}
      <CtaCard handle={props.handle} claimUrl={props.claimUrl} totalClips={props.totalClips} />
    </AbsoluteFill>
  );
};
