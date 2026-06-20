import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { PageShell } from "@/components/Chrome";
import { buildSession, isValidId } from "@/lib/sessionStore";
import { getLatestRelease } from "@/lib/latest-release";
import { Reveal } from "./Reveal";

export default async function ClipsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const cookieStore = await cookies();
  const url = cookieStore.get("lc_funnel_url")?.value ?? null;
  const session = buildSession(id, url);

  const latest = await getLatestRelease();
  const downloadHref =
    latest?.macUniversal ?? latest?.macArm ?? latest?.macIntel ?? "/download";

  return (
    <PageShell hideChrome>
      <main className="lc-reveal-shell">
        <Reveal
          sessionId={session.id}
          sourceTitle={session.sourceTitle}
          sourceDuration={session.sourceDuration}
          clips={session.clips}
          downloadHref={downloadHref}
          version={latest?.version ?? null}
        />
      </main>
    </PageShell>
  );
}
