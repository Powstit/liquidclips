import type { JSX } from "react";

export type PlatformKey = "tiktok" | "reels" | "shorts" | "x" | "facebook";

export interface PlatformDef {
  key: PlatformKey;
  name: string;
  handle: string;
  renderIcon: (props?: { className?: string; size?: number }) => JSX.Element;
}

export interface Clip {
  id: number;
  hl: string;
  rest: string;
  score: number;
  dur: number;
  start: number;
  moment: string;
  reaction: boolean;
  plats: Set<PlatformKey>;
  fresh?: boolean;
}

export const MOMENTS = [
  "Strong hook",
  "Emotional peak",
  "Hot take",
  "Story beat",
  "Q&A moment",
  "Data drop",
  "Punchline",
  "Callout",
];

export const HOOKS: [string, string][] = [
  ["Nobody tells you", "this about your first 1,000 followers"],
  ["I wasted 3 years", "doing this completely wrong"],
  ["The one habit", "that doubled my reach"],
  ["Stop posting daily", "do this instead"],
  ["This is why", "your videos get ignored"],
  ["Going viral", "is simpler than you think"],
  ["The algorithm", "rewards exactly this"],
  ["How I got", "my first 100k views"],
  ["Most creators", "quit right before this works"],
  ["You only need", "one good clip a week"],
  ["The hook", "is the whole game"],
  ["Why retention", "beats follower count"],
];

function IconSvg({
  children,
  className,
  size = 16,
  fill = "none",
  stroke = "currentColor",
  strokeWidth = 2,
}: {
  children: React.ReactNode;
  className?: string;
  size?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const TikTokIcon = (props?: { className?: string; size?: number }) => (
  <IconSvg {...props} fill="currentColor" stroke="none">
    <path d="M16 3v4.5a4.5 4.5 0 0 0 4 4.46V15a7.5 7.5 0 0 1-4-1.2V16a6 6 0 1 1-6-6v3.2A3 3 0 1 0 13 16V3z" />
  </IconSvg>
);

const ReelsIcon = (props?: { className?: string; size?: number }) => (
  <IconSvg {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </IconSvg>
);

const ShortsIcon = (props?: { className?: string; size?: number }) => (
  <IconSvg {...props}>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </IconSvg>
);

const XIcon = (props?: { className?: string; size?: number }) => (
  <IconSvg {...props}>
    <path d="M3 3l18 18M21 3L3 21" />
  </IconSvg>
);

const FacebookIcon = (props?: { className?: string; size?: number }) => (
  <IconSvg {...props} fill="currentColor" stroke="none">
    <path d="M15 3h-3a4 4 0 0 0-4 4v3H5v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </IconSvg>
);

export const PLATFORMS: Record<PlatformKey, PlatformDef> = {
  tiktok: { key: "tiktok", name: "TikTok", handle: "@alexclips", renderIcon: TikTokIcon },
  reels: { key: "reels", name: "Reels", handle: "@alex.edits", renderIcon: ReelsIcon },
  shorts: { key: "shorts", name: "Shorts", handle: "@alexshorts", renderIcon: ShortsIcon },
  x: { key: "x", name: "X", handle: "@alexc", renderIcon: XIcon },
  facebook: { key: "facebook", name: "Facebook", handle: "Alex C", renderIcon: FacebookIcon },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS) as PlatformKey[];

let seq = 0;

export function resetClipSequence(): void {
  seq = 0;
}

export function makeClip(index: number): Clip {
  const score = Math.max(60, Math.min(97, Math.round(95 - index * 1.5 + (Math.random() * 8 - 4))));
  return {
    id: seq++,
    hl: HOOKS[index % HOOKS.length][0],
    rest: HOOKS[index % HOOKS.length][1],
    score,
    dur: Math.round(14 + Math.random() * 44),
    start: Math.round(Math.random() * 3500),
    moment: MOMENTS[index % MOMENTS.length],
    reaction: Math.random() > 0.6,
    plats: new Set(index % 3 === 0 ? ["tiktok"] : []),
  };
}

export function generateClips(count: number, startIndex: number): Clip[] {
  return Array.from({ length: count }, (_, i) => makeClip(startIndex + i));
}

export function regenerateClip(clip: Clip): Clip {
  const next = makeClip(clip.id);
  return {
    ...next,
    id: clip.id,
    plats: new Set(clip.plats),
    fresh: true,
  };
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function posterGradient(id: number): [string, string] {
  const l = 10 + ((id * 37) % 40);
  return [`hsl(315 32% ${8 + l / 4}%)`, "hsl(320 20% 6%)"];
}

export type CaptionStyle = "pop" | "clean" | "karaoke" | "min";
export type CaptionPosition = "bottom" | "mid";
export type ReactionSource = "off" | "cam" | "giphy" | "upload";
export type ReactionCorner = "tl" | "tr" | "bl" | "br";
export type FrameLayout = "single" | "split" | "reaction";
export type CanvasRatio = "9" | "45" | "1" | "16";

export interface BRollBlock {
  id: string;
  left: number;
  width: number;
  label: string;
}

export interface EditState {
  ratio: CanvasRatio;
  captionStyle: CaptionStyle;
  captionPosition: CaptionPosition;
  captionHighlight: string;
  captionSize: number;
  reactionSource: ReactionSource;
  reactionCorner: ReactionCorner;
  reactionSize: number;
  layout: FrameLayout;
  reframeTrack: boolean;
  reframeActiveSpeaker: boolean;
  reframeSmooth: boolean;
  manualFrame: "fill" | "fit" | "free";
  reframeZoom: number;
  clipVolume: number;
  cleanSpeech: boolean;
  backgroundMusic: boolean;
  musicLevel: number;
  burnCaptions: boolean;
  postWhen: "now" | "drip";
  playing: boolean;
  playhead: number;
  splits: number[];
  bRolls: BRollBlock[];
}

export function createEditState(): EditState {
  return {
    ratio: "9",
    captionStyle: "pop",
    captionPosition: "bottom",
    captionHighlight: "#FF3DA5",
    captionSize: 100,
    reactionSource: "cam",
    reactionCorner: "tr",
    reactionSize: 30,
    layout: "single",
    reframeTrack: true,
    reframeActiveSpeaker: false,
    reframeSmooth: true,
    manualFrame: "fill",
    reframeZoom: 112,
    clipVolume: 100,
    cleanSpeech: true,
    backgroundMusic: false,
    musicLevel: 22,
    burnCaptions: true,
    postWhen: "now",
    playing: false,
    playhead: 38,
    splits: [],
    bRolls: [],
  };
}
