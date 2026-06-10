// Always-latest GH release lookup. Called from server components on the
// home page + /download page so DownloadCTA receives current URLs without
// per-version env-var bumps. Replaces the static NEXT_PUBLIC_DOWNLOAD_*
// env-var pattern that left users on v0.6.44 for 4+ days while local
// versions ran ahead.
//
// ISR: 10-minute edge cache via Next.js `revalidate`. CI publishing a new
// release means worst-case new-version visibility = 10 min; in practice
// the first hit after a publish triggers re-fetch.
//
// Failure mode: returns null. Pages fall back to existing env-var URLs so
// the download surface NEVER goes dead — worst case it serves the last
// good static URL.

export type LatestRelease = {
  version: string;
  tagName: string;
  publishedAt: string;
  macArm: string | null;
  macIntel: string | null;
  macUniversal: string | null;
};

type GHAsset = { name: string; browser_download_url: string };
type GHRelease = {
  tag_name?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GHAsset[];
};

const RELEASES_URL =
  "https://api.github.com/repos/Powstit/liquidclips/releases/latest";

export async function getLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(RELEASES_URL, {
      next: { revalidate: 600 },
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GHRelease;
    if (data.draft) return null;

    const find = (pattern: RegExp): string | null => {
      const a = data.assets?.find((x) => pattern.test(x.name));
      return a?.browser_download_url ?? null;
    };

    return {
      version: (data.tag_name ?? "").replace(/^v/, ""),
      tagName: data.tag_name ?? "",
      publishedAt: data.published_at ?? "",
      macArm: find(/aarch64\.dmg$/i),
      macIntel: find(/x86_64\.dmg$/i),
      macUniversal: find(/universal\.dmg$/i),
    };
  } catch {
    return null;
  }
}
