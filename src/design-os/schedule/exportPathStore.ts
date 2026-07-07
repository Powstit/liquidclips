const KEY = "lc.export-paths.v1";

type ExportPathMap = Record<string, string>;

function storageKey(slug: string, clipIdx: number): string {
  return `${slug}:${clipIdx}`;
}

function latestClipKey(clipIdx: number): string {
  return `latest:${clipIdx}`;
}

function readAll(): ExportPathMap {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as ExportPathMap : {};
  } catch {
    return {};
  }
}

export function rememberExportPath(slug: string, clipIdx: number, path: string): void {
  if (typeof window === "undefined" || !slug || !path) return;
  const next = readAll();
  next[storageKey(slug, clipIdx)] = path;
  next[latestClipKey(clipIdx)] = path;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function readExportPath(slug: string | null | undefined, clipIdx: number): string | null {
  const paths = readAll();
  if (slug && paths[storageKey(slug, clipIdx)]) {
    return paths[storageKey(slug, clipIdx)];
  }
  return paths[latestClipKey(clipIdx)] ?? null;
}
