import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { PageShell } from "@/components/Chrome";
import { DownloadCTA } from "@/components/DownloadCTA";
import { getLatestRelease } from "@/lib/latest-release";
import { buildSession, isValidId } from "@/lib/sessionStore";
import { ClaimRoom } from "./ClaimRoom";

export const metadata: Metadata = {
  title: "Open your 10 clips · Liquid Clips",
  description:
    "Your 10 clips are locked to this session. Download Liquid Clips · they'll open automatically.",
};

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const sp = await searchParams;
  const sid = sp.session ?? null;
  const cookieStore = await cookies();
  const url = cookieStore.get("lc_funnel_url")?.value ?? null;
  const session = sid && isValidId(sid) ? buildSession(sid, url) : null;
  const latest = await getLatestRelease();
  const artifacts = latest
    ? {
        macArm: latest.macArm ?? undefined,
        macIntel: latest.macIntel ?? undefined,
        macUniversal: latest.macUniversal ?? undefined,
      }
    : undefined;

  // Funnel-aware download page · session present means user came from
  // the reveal flow · we own the entire viewport with a claim room.
  if (session) {
    return (
      <PageShell hideChrome>
        <main className="lc-claim-shell">
          <ClaimRoom
            sessionId={session.id}
            clipCount={session.clips.length}
            sourceTitle={session.sourceTitle}
            sourceDuration={session.sourceDuration}
            downloadHref={
              latest?.macUniversal ?? latest?.macArm ?? latest?.macIntel ?? null
            }
            version={latest?.version ?? null}
          />
        </main>
      </PageShell>
    );
  }

  // Anonymous download · the old chrome stays.
  return (
    <PageShell>
      <main>
        <section className="hero">
          <div className="container">
            <div className="eyebrow">Mac download</div>
            <h1>
              Get Liquid Clips. <em>Run it locally.</em>
            </h1>
            <p className="hero-copy">
              Apple Silicon macOS DMG, notarised by Apple. Files stay on your machine.
            </p>
            <div className="hero-actions">
              <DownloadCTA variant="primary" artifacts={artifacts} version={latest?.version} />
              <Link className="button-secondary" href="/">
                Find my clips first
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
