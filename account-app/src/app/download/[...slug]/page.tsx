import { redirect } from "next/navigation";

// Until signed installers exist (Sprint 9), any /download/* path lands on
// the main download page. Sprint 9 swaps this for routes that 302 to the
// CDN-hosted installer artifacts (e.g. /download/mac → DMG URL).
export default async function DownloadCatchAll() {
  redirect("/download");
}
