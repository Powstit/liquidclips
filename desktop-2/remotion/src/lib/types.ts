export type PreviewProps = {
  handle: string;
  channelName: string;
  videoTitle: string;
  avatarUrl: string;
  thumbnailUrl: string;
  frameUrls: string[];
  clipTitles: string[];
  claimUrl: string;
  totalClips: number;
};

export const DEFAULT_PROPS: PreviewProps = {
  handle: "@samplecreator",
  channelName: "Sample Creator",
  videoTitle: "This is the sample long-form title",
  avatarUrl: "https://picsum.photos/seed/av/240/240",
  thumbnailUrl: "https://picsum.photos/seed/thumb/640/360",
  frameUrls: Array.from({ length: 8 }).map(
    (_, i) => `https://picsum.photos/seed/f${i}/640/360`,
  ),
  clipTitles: [
    "Fastest 30 seconds in this video",
    "The moment he snaps",
    "Nobody expected this",
    "Try not to react",
    "This is where it gets wild",
    "You'll rewatch this",
    "The best cut of the video",
    "Save this before it disappears",
  ],
  claimUrl: "liquidclips.app/claim/DEMO",
  totalClips: 100,
};
