import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { PageShell } from "@/components/Chrome";
import { buildSession, isValidId } from "@/lib/sessionStore";
import { FIXTURE_TRANSCRIPT_DRIP } from "@/lib/fixtureClips";
import { AnalysisTheatre } from "./AnalysisTheatre";

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const cookieStore = await cookies();
  const url = cookieStore.get("lc_funnel_url")?.value ?? null;
  const session = buildSession(id, url);

  return (
    <PageShell hideChrome>
      <main className="lc-stage-shell">
        <AnalysisTheatre
          sessionId={session.id}
          sourceTitle={session.sourceTitle}
          sourceDuration={session.sourceDuration}
          transcriptLines={FIXTURE_TRANSCRIPT_DRIP}
        />
      </main>
    </PageShell>
  );
}
