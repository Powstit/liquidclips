/**
 * brandPresetStore · Composer F5 · brand preset persistence.
 *
 * ⚠ IRON GATE IG-COMPOSER-AA · Brand preset store contract.
 *
 * Users save their current CockpitSettings as a named brand preset
 * (Growth · Personal · Client), then apply it back to the current
 * session with one tap. localStorage-backed under a versioned key
 * so a future schema change can migrate safely. A preset carries a
 * partial CockpitSettings snapshot · applying overwrites the four
 * sections the picker owns (style · reaction · caption · watermark).
 *
 * The full BrandPresetsPanel UI + editor are on top of this store;
 * this module is the write/read primitive so a test can pin the
 * contract without a component render.
 */

import type { CockpitSettings } from "../cockpit/CockpitContext";

export const BRAND_PRESET_STORAGE_KEY = "lc.composer.brand-presets.v1";
export const BRAND_PRESET_CAP = 12;

/** Named subset of CockpitSettings that a brand preset can carry. */
export interface BrandPresetSnapshot {
  style?: CockpitSettings["style"];
  reaction?: Partial<CockpitSettings["reaction"]>;
  caption?: Partial<CockpitSettings["caption"]>;
  baseWindow?: CockpitSettings["baseWindow"];
}

export interface BrandPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  snapshot: BrandPresetSnapshot;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Return every stored preset in insertion order. */
export function listBrandPresets(): BrandPreset[] {
  const ls = safeLocalStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(BRAND_PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is BrandPreset => {
      return (
        !!p &&
        typeof p === "object" &&
        typeof (p as BrandPreset).id === "string" &&
        typeof (p as BrandPreset).name === "string" &&
        typeof (p as BrandPreset).snapshot === "object"
      );
    });
  } catch {
    return [];
  }
}

/** Persist the full list. FIFO evict when over BRAND_PRESET_CAP. */
function writeBrandPresets(presets: BrandPreset[]): BrandPreset[] {
  const trimmed = presets.slice(-BRAND_PRESET_CAP);
  const ls = safeLocalStorage();
  if (!ls) return trimmed;
  try {
    ls.setItem(BRAND_PRESET_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage disabled or full · degrade quietly */
  }
  return trimmed;
}

function genId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `bp_${Date.now().toString(36)}_${rand}`;
}

/** Create a new preset with the current snapshot. Returns the created
 *  preset. Trims to BRAND_PRESET_CAP if over. */
export function createBrandPreset(name: string, snapshot: BrandPresetSnapshot): BrandPreset {
  const now = Date.now();
  const preset: BrandPreset = {
    id: genId(),
    name: name.trim() || "Untitled",
    createdAt: now,
    updatedAt: now,
    snapshot,
  };
  const next = [...listBrandPresets(), preset];
  writeBrandPresets(next);
  return preset;
}

/** Update an existing preset. No-op if id is unknown. Returns the
 *  updated preset or null. */
export function updateBrandPreset(
  id: string,
  update: { name?: string; snapshot?: BrandPresetSnapshot },
): BrandPreset | null {
  const all = listBrandPresets();
  let hit: BrandPreset | null = null;
  const next = all.map((p) => {
    if (p.id !== id) return p;
    hit = {
      ...p,
      name: update.name?.trim() || p.name,
      snapshot: update.snapshot ?? p.snapshot,
      updatedAt: Date.now(),
    };
    return hit;
  });
  if (!hit) return null;
  writeBrandPresets(next);
  return hit;
}

/** Duplicate a preset with " (copy)" appended to the name. Returns null
 *  if id is unknown. */
export function duplicateBrandPreset(id: string): BrandPreset | null {
  const source = listBrandPresets().find((p) => p.id === id);
  if (!source) return null;
  return createBrandPreset(`${source.name} (copy)`, source.snapshot);
}

/** Remove a preset by id. Returns true if a preset was removed. */
export function deleteBrandPreset(id: string): boolean {
  const all = listBrandPresets();
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  writeBrandPresets(filtered);
  return true;
}

/** Test seam · wipe the storage. */
export function _resetBrandPresetsForTests(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(BRAND_PRESET_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
