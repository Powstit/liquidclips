import { redirect } from "next/navigation";

// v0.7.56 — account-app no longer owns release detection or installer
// asset logic. liquidclips.app/download is the single source of truth:
// it calls getLatestRelease() against the GitHub release API and serves
// the notarised DMGs with per-arch detection. Any /download path on
// account.* permanently redirects there so signed-in users coming from
// /get or /checkout never land on the old "Coming end of week 9"
// waitlist copy.
//
// Async + no force-static because the layout reads headers() to detect
// the satellite host (account.liquidclips.app vs account.jnremployee.com),
// which flips the route dynamic. With force-static + an external redirect
// + Clerk's auth() being polled internally during SSR, Next 16 dev throws
// "auth() was called but Clerk can't detect usage of clerkMiddleware()".
// Letting the page render dynamic resolves it.
export default async function DownloadRedirect() {
  redirect("https://liquidclips.app/download");
}
