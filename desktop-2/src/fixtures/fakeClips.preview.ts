export interface FakeClip {
  id: string;
  title: string;
  durationSec: number;
  source: string;
  thumbnail: string;
  createdAt: string;
}

export const fakeClips: FakeClip[] = [
  { id: "clip_fx_001", title: "Hook · why most clippers stall", durationSec: 22, source: "youtube.com/…", thumbnail: "", createdAt: "2026-06-15T08:14:00Z" },
  { id: "clip_fx_002", title: "Beat 1 · the trap of perfectionism",  durationSec: 18, source: "youtube.com/…", thumbnail: "", createdAt: "2026-06-15T08:14:00Z" },
  { id: "clip_fx_003", title: "Beat 2 · post the rough cut",          durationSec: 27, source: "youtube.com/…", thumbnail: "", createdAt: "2026-06-15T08:14:00Z" },
  { id: "clip_fx_004", title: "Punchline · ship to learn",             durationSec: 14, source: "youtube.com/…", thumbnail: "", createdAt: "2026-06-15T08:14:00Z" },
];
