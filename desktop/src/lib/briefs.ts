// Campaign Brief v1 — local-first reward-campaign storage.
//
// Stored at $APPDATA/briefs.json — i.e.
// ~/Library/Application Support/app.liquidclips.desktop/briefs.json on macOS.
// The file holds: { version: number, briefs: CampaignBrief[] }.
//
// Why $APPDATA and not ~/LiquidClips: the sidecar's CLIPS_HOME at
// ~/LiquidClips/ is for clip output the user opens in Finder; brief state
// is internal app data and belongs in the OS-managed app-data dir. This
// also dodges the home-scope permissions the Tauri 2 fs plugin requires.
//
// Why not the sidecar at all? v1 is read/write from React only — Browse
// Rewards chrome saves a brief, EarnTab lists them, BriefDetail shows one.
// If a future feature needs the brief inside the clipping pipeline we move
// this to the sidecar without changing the public TS API.

import { useEffect, useState } from "react";
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir } from "@tauri-apps/api/path";

export type PayoutProvider =
  | "whop"
  | "external_platform"
  | "liquid_clips_stripe"
  | "unknown";

export type BriefPlatform = "whop" | "clipify" | "klipy" | "opus" | "manual" | "other";

export type AllowedPlatform = "tiktok" | "instagram" | "youtube_shorts" | "x";

export type CampaignBrief = {
  id: string;
  source_url: string;
  title: string;
  payout_label: string;
  payout_provider: PayoutProvider;
  allowed_platforms: AllowedPlatform[];
  rules: string[];
  required_assets_url: string;
  budget_status: string;
  waitlist_status: string;
  notes: string;
  platform: BriefPlatform;
  created_at: string;
  updated_at: string;
};

type BriefsFile = {
  version: number;
  briefs: CampaignBrief[];
  active_id: string | null;
};

const FILE_VERSION = 1;
const REL_FILE = "briefs.json";

// ---------- file IO --------------------------------------------------------

async function ensureAppDataDir(): Promise<void> {
  // $APPDATA (~/Library/Application Support/<bundle id>/ on macOS) may not
  // exist on first launch. mkdir with recursive:true is idempotent — if the
  // directory is already there, this is a no-op. Wrapped in try/catch
  // because some Tauri versions reject empty-path resolution; either way
  // writeTextFile will either succeed (dir exists) or fail loudly.
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    /* either the dir already exists or the empty-path call wasn't valid —
       the subsequent writeTextFile will tell us if it's a real problem. */
  }
}

async function readFile(): Promise<BriefsFile> {
  try {
    const present = await exists(REL_FILE, { baseDir: BaseDirectory.AppData });
    if (!present) return { version: FILE_VERSION, briefs: [], active_id: null };
    const raw = await readTextFile(REL_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<BriefsFile>;
    return {
      version: parsed.version ?? FILE_VERSION,
      briefs: Array.isArray(parsed.briefs) ? parsed.briefs : [],
      active_id: typeof parsed.active_id === "string" ? parsed.active_id : null,
    };
  } catch (e) {
    console.error("[briefs] read failed, treating as empty", e);
    return { version: FILE_VERSION, briefs: [], active_id: null };
  }
}

async function writeFile(state: BriefsFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(REL_FILE, JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

// ---------- public API ----------------------------------------------------

export async function listBriefs(): Promise<CampaignBrief[]> {
  const file = await readFile();
  // newest first
  return [...file.briefs].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function getBrief(id: string): Promise<CampaignBrief | null> {
  const file = await readFile();
  return file.briefs.find((b) => b.id === id) ?? null;
}

export type NewBriefInput = Omit<CampaignBrief, "id" | "created_at" | "updated_at">;

export async function createBrief(input: NewBriefInput): Promise<CampaignBrief> {
  const file = await readFile();
  const now = new Date().toISOString();
  const brief: CampaignBrief = {
    ...input,
    id: cryptoId(),
    created_at: now,
    updated_at: now,
  };
  file.briefs.push(brief);
  await writeFile(file);
  emit();
  return brief;
}

export async function updateBrief(
  id: string,
  patch: Partial<NewBriefInput>,
): Promise<CampaignBrief | null> {
  const file = await readFile();
  const idx = file.briefs.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const updated: CampaignBrief = {
    ...file.briefs[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  file.briefs[idx] = updated;
  await writeFile(file);
  emit();
  return updated;
}

export async function deleteBrief(id: string): Promise<void> {
  const file = await readFile();
  const next = file.briefs.filter((b) => b.id !== id);
  if (next.length === file.briefs.length) return;
  const active_id = file.active_id === id ? null : file.active_id;
  await writeFile({ ...file, briefs: next, active_id });
  emit();
}

// ---------- active brief --------------------------------------------------
// "Active brief" is the campaign the user is currently clipping for. The
// CampaignContextStrip in Upload + Results reads it; SavedBriefs lets the
// user set it. Persisted alongside the briefs list so it survives reload.

export async function getActiveBriefId(): Promise<string | null> {
  const file = await readFile();
  // Self-heal: if the active id points to a brief that no longer exists,
  // null it out at read time so consumers don't have to guard.
  if (!file.active_id) return null;
  return file.briefs.some((b) => b.id === file.active_id) ? file.active_id : null;
}

export async function setActiveBriefId(id: string | null): Promise<void> {
  const file = await readFile();
  await writeFile({ ...file, active_id: id });
  emit();
}

export function useActiveBrief(): {
  active: CampaignBrief | null;
  loading: boolean;
  setActive: (id: string | null) => Promise<void>;
} {
  const { briefs, loading } = useBriefs();
  const [activeId, setActiveId] = useState<string | null>(null);

  function refresh(): void {
    getActiveBriefId().then(setActiveId).catch(() => setActiveId(null));
  }

  useEffect(() => {
    refresh();
    return onBriefsChanged(refresh);
  }, []);

  const active = briefs.find((b) => b.id === activeId) ?? null;
  return {
    active,
    loading,
    setActive: setActiveBriefId,
  };
}

// ---------- subscriptions -------------------------------------------------
// Lightweight pub/sub so list views auto-refresh after create/update/delete
// without having to lift state up. Consumers subscribe via onBriefsChanged.

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export function onBriefsChanged(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// Live hook: returns the current brief list and refetches on every change
// emitted by create/update/delete. Use this in list views.
export function useBriefs(): {
  briefs: CampaignBrief[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [briefs, setBriefs] = useState<CampaignBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setLoading(true);
    listBriefs()
      .then((b) => {
        setBriefs(b);
        setError(null);
      })
      .catch((e) => {
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    return onBriefsChanged(load);
  }, []);

  return { briefs, loading, error, refresh: load };
}

// ---------- helpers -------------------------------------------------------

function cryptoId(): string {
  // crypto.randomUUID is available in the Tauri webview.
  return crypto.randomUUID();
}

// Best-effort guess at the source platform from a URL — used to prefill the
// brief form when the user clicks "Save brief" from the in-app browser.
export function guessPlatformFromUrl(url: string): BriefPlatform {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("whop.com")) return "whop";
    if (host.includes("clipping.net")) return "clipify";
    if (host.includes("klipy")) return "klipy";
    if (host.includes("opus")) return "opus";
    return "other";
  } catch {
    return "manual";
  }
}

// Resolve the human-readable absolute path of the briefs file (for error
// messages / debug surfaces). Falls back to the relative path if appDataDir
// fails — non-fatal.
export async function briefsFilePath(): Promise<string> {
  try {
    const base = await appDataDir();
    return `${base}/${REL_FILE}`;
  } catch {
    return `$APPDATA/${REL_FILE}`;
  }
}
