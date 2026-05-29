// Submission Tracker v1 — local-first tracking of posted clips and payouts.
//
// Stored at $APPDATA/submissions.json (same dir as briefs.json). Each
// ClipSubmission optionally references a CampaignBrief by id; deleting a
// brief does NOT cascade-delete submissions (the user may want history).
//
// v1 is fully manual: the user adds a submission with the platform + post
// URL + status + views + notes. No auto-detection from socials yet (that's
// RC-16 social view tracking).

import { useEffect, useState } from "react";
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AllowedPlatform } from "./briefs";

export type SubmissionStatus =
  | "draft"
  | "posted"
  | "submitted"
  | "approved"
  | "rejected"
  | "paid";

export type ClipSubmission = {
  id: string;
  brief_id: string | null;
  clip_path: string;
  platform: AllowedPlatform | "other";
  post_url: string;
  status: SubmissionStatus;
  views: number;
  estimated_payout: string;
  actual_payout: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type SubmissionsFile = {
  version: number;
  submissions: ClipSubmission[];
};

const FILE_VERSION = 1;
const REL_FILE = "submissions.json";

// ---------- file IO --------------------------------------------------------

async function ensureAppDataDir(): Promise<void> {
  const dirExists = await exists("", { baseDir: BaseDirectory.AppData });
  if (!dirExists) {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function readFile(): Promise<SubmissionsFile> {
  try {
    const present = await exists(REL_FILE, { baseDir: BaseDirectory.AppData });
    if (!present) return { version: FILE_VERSION, submissions: [] };
    const raw = await readTextFile(REL_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<SubmissionsFile>;
    return {
      version: parsed.version ?? FILE_VERSION,
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    };
  } catch (e) {
    console.error("[submissions] read failed, treating as empty", e);
    return { version: FILE_VERSION, submissions: [] };
  }
}

async function writeFile(state: SubmissionsFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(REL_FILE, JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

// ---------- public API ----------------------------------------------------

export async function listSubmissions(): Promise<ClipSubmission[]> {
  const file = await readFile();
  return [...file.submissions].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function listSubmissionsForBrief(briefId: string): Promise<ClipSubmission[]> {
  const all = await listSubmissions();
  return all.filter((s) => s.brief_id === briefId);
}

export type NewSubmissionInput = Omit<ClipSubmission, "id" | "created_at" | "updated_at">;

export async function createSubmission(input: NewSubmissionInput): Promise<ClipSubmission> {
  const file = await readFile();
  const now = new Date().toISOString();
  const sub: ClipSubmission = {
    ...input,
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
  };
  file.submissions.push(sub);
  await writeFile(file);
  emit();
  return sub;
}

export async function updateSubmission(
  id: string,
  patch: Partial<NewSubmissionInput>,
): Promise<ClipSubmission | null> {
  const file = await readFile();
  const idx = file.submissions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const updated: ClipSubmission = {
    ...file.submissions[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  file.submissions[idx] = updated;
  await writeFile(file);
  emit();
  return updated;
}

export async function deleteSubmission(id: string): Promise<void> {
  const file = await readFile();
  const next = file.submissions.filter((s) => s.id !== id);
  if (next.length === file.submissions.length) return;
  await writeFile({ ...file, submissions: next });
  emit();
}

// ---------- subscriptions -------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function onSubmissionsChanged(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSubmissions(briefId?: string): {
  submissions: ClipSubmission[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [submissions, setSubmissions] = useState<ClipSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setLoading(true);
    const p = briefId ? listSubmissionsForBrief(briefId) : listSubmissions();
    p.then((s) => {
      setSubmissions(s);
      setError(null);
    })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    return onSubmissionsChanged(load);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId]);

  return { submissions, loading, error, refresh: load };
}

// ---------- aggregation helpers ------------------------------------------

export function totalViews(submissions: ClipSubmission[]): number {
  return submissions.reduce((sum, s) => sum + (s.views || 0), 0);
}

export function totalActualPayout(submissions: ClipSubmission[]): number {
  return submissions.reduce((sum, s) => {
    const parsed = parseMoney(s.actual_payout);
    return sum + (parsed || 0);
  }, 0);
}

export function countByStatus(submissions: ClipSubmission[]): Record<SubmissionStatus, number> {
  const init: Record<SubmissionStatus, number> = {
    draft: 0,
    posted: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
    paid: 0,
  };
  for (const s of submissions) init[s.status]++;
  return init;
}

function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}
