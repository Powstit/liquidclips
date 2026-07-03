// Liquid Clips 2.0 — Browse / Source fixture data.
// No real YouTube, no real Google Drive, no OAuth, no backend.
// Used by BrowseSection placeholder only.

export interface FakeSourceLink {
  id: string;
  platform: "youtube" | "drive" | "url";
  title: string;
  url: string;
  thumbnail: string;
  importedAt: string;
}

export const fakeRecentSources: FakeSourceLink[] = [
  {
    id: "src_yt_001",
    platform: "youtube",
    title: "The art of the cold open",
    url: "https://youtube.com/watch?v=fake001",
    thumbnail: "",
    importedAt: "2026-06-16T09:12:00Z",
  },
  {
    id: "src_yt_002",
    platform: "youtube",
    title: "Why short-form hooks work",
    url: "https://youtube.com/watch?v=fake002",
    thumbnail: "",
    importedAt: "2026-06-15T16:45:00Z",
  },
  {
    id: "src_drv_001",
    platform: "drive",
    title: "Raw interview footage.mp4",
    url: "https://drive.google.com/file/d/fake003",
    thumbnail: "",
    importedAt: "2026-06-14T11:20:00Z",
  },
  {
    id: "src_url_001",
    platform: "url",
    title: "-podcast-episode-42.mp3",
    url: "https://example.com/podcast-episode-42.mp3",
    thumbnail: "",
    importedAt: "2026-06-13T14:05:00Z",
  },
];

export const fakeBrowseSearchResult = {
  query: "hook technique",
  platform: "youtube" as const,
  results: [
    { id: "br_yt_001", title: "Hook technique #1 — pattern interrupt", durationSec: 84, channel: "Fake Creator" },
    { id: "br_yt_002", title: "Hook technique #2 — open loop", durationSec: 92, channel: "Fake Creator" },
    { id: "br_yt_003", title: "Hook technique #3 — visual contradiction", durationSec: 76, channel: "Fake Creator" },
  ],
};

export const fakeDriveFiles = [
  { id: "drv_001", name: "B-roll beach.mp4", sizeMb: 12.4, modifiedAt: "2026-06-10" },
  { id: "drv_002", name: "Logo animation.mov", sizeMb: 4.1, modifiedAt: "2026-06-09" },
  { id: "drv_003", name: "Voiceover v3.wav", sizeMb: 8.7, modifiedAt: "2026-06-08" },
];
