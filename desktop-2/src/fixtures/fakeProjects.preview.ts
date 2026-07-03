export interface FakeProject {
  id: string;
  name: string;
  clipCount: number;
  exportCount: number;
  updatedAt: string;
}

export const fakeProjects: FakeProject[] = [
  { id: "proj_fx_001", name: "Founder diaries · week 3", clipCount: 12, exportCount: 4, updatedAt: "2026-06-16T11:02:00Z" },
  { id: "proj_fx_002", name: "Product demos · v0.8",      clipCount: 8,  exportCount: 2, updatedAt: "2026-06-15T19:48:00Z" },
  { id: "proj_fx_003", name: "Studio sessions · spring",  clipCount: 27, exportCount: 11, updatedAt: "2026-06-14T07:30:00Z" },
];

export interface FakeExport {
  id: string;
  projectId: string;
  clipId: string;
  watermarked: boolean;
  bytes: number;
  finishedAt: string;
}

export const fakeExports: FakeExport[] = [
  { id: "exp_fx_001", projectId: "proj_fx_001", clipId: "clip_fx_001", watermarked: true,  bytes: 18_400_000, finishedAt: "2026-06-16T11:14:00Z" },
  { id: "exp_fx_002", projectId: "proj_fx_001", clipId: "clip_fx_002", watermarked: false, bytes: 22_900_000, finishedAt: "2026-06-16T11:18:00Z" },
];
