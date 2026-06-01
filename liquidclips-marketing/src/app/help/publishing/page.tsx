import type { Metadata } from "next";
import { HelpArticle } from "../shared";

export const metadata: Metadata = {
  title: "Publishing",
  description: "Connect Ayrshare and publish Liquid Clips exports to social platforms.",
};

export default function PublishingPage() {
  return (
    <HelpArticle
      title="Publishing"
      lede="Liquid Clips prepares posts locally, then publishes through the Ayrshare profile you connect in Settings."
      sections={[
        {
          heading: "Connect Ayrshare",
          body: [
            "Open Settings, connect or paste your Ayrshare Profile Key, and confirm the platforms attached to that profile.",
            "Liquid Clips does not ask for individual social passwords. Platform permissions are managed inside Ayrshare.",
          ],
        },
        {
          heading: "Publish a clip",
          body: [
            "Open a generated project, choose a clip, then open Publish. Pick the platforms, review the caption, and send or schedule.",
            "A failed platform post does not delete your local export. You can retry after fixing the account connection.",
          ],
        },
        {
          heading: "Whop reward submissions",
          body: [
            "Liquid Clips helps keep reward briefs, source links, and generated clips together. Whop and the campaign brand still decide approval and payout.",
            "Before submitting, check the reward rules for allowed platforms, caption requirements, deadlines, and content restrictions.",
          ],
        },
      ]}
    />
  );
}
