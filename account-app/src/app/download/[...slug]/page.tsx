import { redirect } from "next/navigation";

// v0.7.56 — every /download/* path lands on liquidclips.app/download,
// the single source of truth for installer URLs (notarised DMGs via
// getLatestRelease() against the GitHub release API). Async + no
// force-static for the same reason as /download — layout reads
// headers() so the route is dynamic.
export default async function DownloadCatchAll() {
  redirect("https://liquidclips.app/download");
}
