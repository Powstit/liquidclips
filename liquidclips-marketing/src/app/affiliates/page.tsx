import type { Metadata } from "next";
import { PageShell } from "@/components/Chrome";
import { AffiliatesPanel } from "@/components/funnel/panels/AffiliatesPanel";

export const metadata: Metadata = {
  title: "Liquid Clips Affiliates",
  description:
    "Share Liquid Clips, earn 30% of eligible first payments, and qualify for 50% recurring commission.",
};

export default function AffiliatesPage() {
  return (
    <PageShell>
      <main className="mx-auto w-full max-w-[1120px] px-5 py-12 sm:px-8 sm:py-16">
        <AffiliatesPanel />
      </main>
    </PageShell>
  );
}
