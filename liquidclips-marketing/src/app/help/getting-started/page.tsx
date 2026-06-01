import type { Metadata } from "next";
import { HelpArticle } from "../shared";

export const metadata: Metadata = {
  title: "Getting Started",
  description: "Install Liquid Clips and make your first short-form clip.",
};

export default function GettingStartedPage() {
  return (
    <HelpArticle
      title="Getting started"
      lede="Use this path for a first successful run: install, activate, add a key if your plan needs one, then generate a clip from a public video."
      sections={[
        {
          heading: "1. Install the Mac app",
          body: [
            "Download the latest DMG from the Liquid Clips site or GitHub release. Drag Liquid Clips into Applications, then launch it from Applications.",
            "The public launch build is signed and notarized. If macOS still warns, delete older copies from Downloads and Applications, then install the newest DMG again.",
          ],
        },
        {
          heading: "2. Sign in",
          body: [
            "Click Sign in in the desktop app. Your browser opens the account app, then returns to Liquid Clips with a license token stored in macOS Keychain.",
            "Signing in unlocks the 100 free clip starter pass and keeps export counts tied to your account.",
          ],
        },
        {
          heading: "3. Add your OpenAI key if prompted",
          body: [
            "Free and Solo plans use your own OpenAI key for clip selection. Open Settings, paste a key that starts with sk-, and save it.",
            "Pro and Agency plans are designed for hosted AI access when the backend gate is enabled for the account.",
          ],
        },
        {
          heading: "4. Generate your first clip",
          body: [
            "Drop a local video file or paste a public YouTube, TikTok, Instagram, or X link. Choose Clips to create short videos, or Script to lift a transcript.",
            "Review the generated clips, adjust anything that needs a human pass, then export or publish.",
          ],
        },
      ]}
    />
  );
}
