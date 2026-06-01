import type { Metadata } from "next";
import { HelpArticle } from "../shared";

export const metadata: Metadata = {
  title: "Troubleshooting",
  description: "Fix common Liquid Clips setup, transcription, publishing, and update issues.",
};

export default function TroubleshootingPage() {
  return (
    <HelpArticle
      title="Troubleshooting"
      lede="Most failures are recoverable from Settings, a fresh sign-in, or a public source link."
      sections={[
        {
          heading: "A video link will not import",
          body: [
            "Check that the post is public and not login-walled. Private videos, paid posts, and some age-gated pages cannot be fetched.",
            "Try a direct YouTube, TikTok, Instagram, or X URL rather than a shortened redirect link.",
          ],
        },
        {
          heading: "Transcription is slow",
          body: [
            "Long videos can take time, especially on Intel Macs. Apple Silicon builds use mlx-whisper when available and fall back safely to faster-whisper.",
            "Quit other heavy apps, try a shorter source, or use Script mode first to confirm the source is downloadable.",
          ],
        },
        {
          heading: "The app says an OpenAI key is missing",
          body: [
            "Open Settings and save a key that starts with sk-. Liquid Clips stores it in macOS Keychain.",
            "If you recently upgraded to hosted AI, sign out and sign in again so the desktop app receives the updated entitlement.",
          ],
        },
        {
          heading: "Publishing fails",
          body: [
            "Reconnect Ayrshare in Settings and confirm the target platform is connected inside the Ayrshare profile.",
            "If one platform rejects a post, export the clip locally and post manually while you fix that platform connection.",
          ],
        },
        {
          heading: "Updates do not appear",
          body: [
            "Relaunch Liquid Clips and wait for the update banner. The updater checks the signed release manifest on launch.",
            "If the installed build is very old, install the latest DMG manually, then future signed updates should resume.",
          ],
        },
      ]}
    />
  );
}
