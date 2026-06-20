import { PageShell } from "@/components/Chrome";
import { HeroStage } from "@/components/funnel/HeroStage";
import { LaunchRewardBanner } from "@/components/funnel/LaunchRewardBanner";
import { KadeScansWindow } from "@/components/funnel/KadeScansWindow";
import { ClipVaultWindow } from "@/components/funnel/ClipVaultWindow";
import { WorkbenchWindow } from "@/components/funnel/WorkbenchWindow";
import { FinalCta } from "@/components/funnel/FinalCta";
import { InformationConsole } from "@/components/funnel/InformationConsole";
import { RightRailTab } from "@/components/funnel/RightRailTab";
import { DownloadFab } from "@/components/funnel/DownloadFab";
import { ClerkDevCleanup } from "@/components/funnel/ClerkDevCleanup";

// InformationConsole stays as a regular import so the consoleBus listener
// mounts on first paint. Its 7 panels are lazy-loaded inside it, so the
// heavy bits don't ship until a visitor actually opens that panel.

/**
 * Liquid Clips · landing page · one continuous Kade workstation.
 *
 * Approved clipper journey (do not redesign) ·
 *   1 · HeroStage          · Window 1 · Drop the Tape
 *   2 · LaunchRewardBanner · reserved event slot
 *   3 · KadeScansWindow    · Window 2 · Kade scans
 *   4 · ClipVaultWindow    · Window 3 · clips unlock
 *   5 · WorkbenchWindow    · Window 4 · the workbench
 *   6 · FinalCta           · mirrored hero pill
 *
 * Proof / testimonials live in the InformationConsole panel
 * (rail tab → Testimonials), not the page flow, so visitors meet
 * the workbench before the wall of quotes.
 *
 * Persistent right edge / floating UI ·
 *   · RightRailTab        · vertical fuchsia "THERE'S MORE" · opens Console
 *   · DownloadFab         · floating "Open your clips" download CTA
 *   · InformationConsole  · fullscreen overlay, opened by RightRailTab
 */
export default function Home() {
  return (
    <PageShell hideChrome>
      <main className="lc-w1-shell">
        <HeroStage />
        <LaunchRewardBanner />
        <KadeScansWindow />
        <ClipVaultWindow />
        <WorkbenchWindow />
        <FinalCta />
      </main>

      {/* persistent overlays · always reachable */}
      <RightRailTab />
      <DownloadFab />
      <InformationConsole />
      <ClerkDevCleanup />
    </PageShell>
  );
}
