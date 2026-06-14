// v0.7.72 — Project Memberships local store.
//
// Lightweight metadata-only layer that lets users attach any clip / render /
// source / external asset to one or more Projects WITHOUT moving files on
// disk or mutating project.json. Library stays the global archive; Projects
// becomes the workspace organiser; memberships are pure references.
//
// Storage: $APPDATA/project_memberships.json (same dir as briefs.json,
// submissions.json — local-first, no backend).
//
// Multi-attach: a single asset_path MAY appear in multiple memberships
// (one per project_slug). Move = remove + add; pure delete = remove only.
//
// Do not put secrets here. Do not put server-truth state here.

import { useCallback, useEffect, useState } from "react";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export type MembershipAssetType = "clip" | "render" | "source" | "external";

export type ProjectMembership = {
  /** Stable id — `${project_slug}:${asset_path}`. Lets de-dupe + Set ops
   *  stay deterministic without an extra random uuid lookup. */
  id: string;
  project_slug: string;
  asset_type: MembershipAssetType;
  asset_path: string;
  /** Optional clip id from the source project's clips array, when known. */
  clip_id?: string;
  /** Slug of the project this asset originated in. Same as project_slug
   *  for "Created in this project" rows; differs for "Added from Library". */
  source_project_slug?: string;
  /** ms-epoch timestamps. */
  created_at: number;
  updated_at: number;
};

type MembershipsFile = {
  version: number;
  memberships: ProjectMembership[];
};

const FILE_VERSION = 1;
const REL_FILE = "project_memberships.json";

// ---------- file IO --------------------------------------------------------

async function ensureAppDataDir(): Promise<void> {
  try {
    await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    /* mkdir is idempotent — see submissions.ts ensureAppDataDir for rationale */
  }
}

async function readFile(): Promise<MembershipsFile> {
  try {
    const present = await exists(REL_FILE, { baseDir: BaseDirectory.AppData });
    if (!present) return { version: FILE_VERSION, memberships: [] };
    const raw = await readTextFile(REL_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<MembershipsFile>;
    return {
      version: parsed.version ?? FILE_VERSION,
      memberships: Array.isArray(parsed.memberships) ? parsed.memberships : [],
    };
  } catch (e) {
    console.error("[project-memberships] read failed, treating as empty", e);
    return { version: FILE_VERSION, memberships: [] };
  }
}

async function writeFile(state: MembershipsFile): Promise<void> {
  await ensureAppDataDir();
  await writeTextFile(REL_FILE, JSON.stringify(state, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
  // Broadcast so any mounted Projects/Detail surfaces re-fetch.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("lc:memberships-changed"));
    } catch {
      /* best-effort */
    }
  }
}

function makeId(project_slug: string, asset_path: string): string {
  return `${project_slug}::${asset_path}`;
}

// ---------- public API ----------------------------------------------------

export async function listMemberships(): Promise<ProjectMembership[]> {
  const file = await readFile();
  return [...file.memberships].sort(
    (a, b) => (b.updated_at || 0) - (a.updated_at || 0),
  );
}

export async function listMembershipsForProject(
  projectSlug: string,
): Promise<ProjectMembership[]> {
  const all = await listMemberships();
  return all.filter((m) => m.project_slug === projectSlug);
}

export async function listMembershipsForAsset(
  assetPath: string,
): Promise<ProjectMembership[]> {
  const all = await listMemberships();
  return all.filter((m) => m.asset_path === assetPath);
}

export type AddMembershipInput = {
  project_slug: string;
  asset_type: MembershipAssetType;
  asset_path: string;
  clip_id?: string;
  source_project_slug?: string;
};

/** Idempotent — re-attaching the same asset to the same project bumps
 *  updated_at but never creates a duplicate row. */
export async function addMembership(
  input: AddMembershipInput,
): Promise<ProjectMembership> {
  const file = await readFile();
  const id = makeId(input.project_slug, input.asset_path);
  const now = Date.now();
  const existing = file.memberships.find((m) => m.id === id);
  if (existing) {
    existing.updated_at = now;
    if (input.clip_id && !existing.clip_id) existing.clip_id = input.clip_id;
    if (input.source_project_slug && !existing.source_project_slug) {
      existing.source_project_slug = input.source_project_slug;
    }
    existing.asset_type = input.asset_type;
    await writeFile(file);
    return existing;
  }
  const fresh: ProjectMembership = {
    id,
    project_slug: input.project_slug,
    asset_type: input.asset_type,
    asset_path: input.asset_path,
    clip_id: input.clip_id,
    source_project_slug: input.source_project_slug,
    created_at: now,
    updated_at: now,
  };
  file.memberships.push(fresh);
  await writeFile(file);
  return fresh;
}

export async function removeMembership(
  projectSlug: string,
  assetPath: string,
): Promise<void> {
  const file = await readFile();
  const id = makeId(projectSlug, assetPath);
  const next = file.memberships.filter((m) => m.id !== id);
  if (next.length === file.memberships.length) return; // no-op
  await writeFile({ version: file.version, memberships: next });
}

/** Move an asset's membership from one project to another. Pure metadata —
 *  the file stays on disk. If `fromSlug` had no membership for the asset,
 *  this still creates the `toSlug` membership. */
export async function moveMembership(
  fromSlug: string,
  toSlug: string,
  assetPath: string,
  assetType: MembershipAssetType,
  clipId?: string,
): Promise<void> {
  const file = await readFile();
  const fromId = makeId(fromSlug, assetPath);
  const toId = makeId(toSlug, assetPath);
  const now = Date.now();
  const next: ProjectMembership[] = [];
  let placedTo = false;
  for (const m of file.memberships) {
    if (m.id === fromId) continue;
    if (m.id === toId) {
      next.push({ ...m, updated_at: now });
      placedTo = true;
      continue;
    }
    next.push(m);
  }
  if (!placedTo) {
    next.push({
      id: toId,
      project_slug: toSlug,
      asset_type: assetType,
      asset_path: assetPath,
      clip_id: clipId,
      source_project_slug: fromSlug,
      created_at: now,
      updated_at: now,
    });
  }
  await writeFile({ version: file.version, memberships: next });
}

// ---------- React hook ----------------------------------------------------

/** Subscribe to all memberships, optionally scoped to a single project.
 *  Auto-refreshes on `lc:memberships-changed`. */
export function useMemberships(projectSlug?: string): {
  memberships: ProjectMembership[];
  loading: boolean;
  refresh: () => void;
} {
  const [memberships, setMemberships] = useState<ProjectMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = projectSlug
        ? await listMembershipsForProject(projectSlug)
        : await listMemberships();
      setMemberships(all);
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  useEffect(() => {
    void load();
    const onChanged = (): void => void load();
    window.addEventListener("lc:memberships-changed", onChanged);
    return () => window.removeEventListener("lc:memberships-changed", onChanged);
  }, [load]);

  return { memberships, loading, refresh: () => void load() };
}
