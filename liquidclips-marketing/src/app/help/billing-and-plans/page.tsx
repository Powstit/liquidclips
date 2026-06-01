import type { Metadata } from "next";
import { HelpArticle } from "../shared";

export const metadata: Metadata = {
  title: "Billing and Plans",
  description: "Understand Liquid Clips Free, Solo, Pro, and Agency plans.",
};

export default function BillingPage() {
  return (
    <HelpArticle
      title="Billing and plans"
      lede="Plans are built around how many clips you export, how many accounts you publish to, and whether hosted AI is included."
      sections={[
        {
          heading: "Free",
          body: [
            "Free includes 100 clip exports so you can test the workflow with your own OpenAI key.",
            "The app counts successful exported clips. A seven-clip project uses seven exports.",
          ],
        },
        {
          heading: "Solo",
          body: [
            "Solo is for one creator who wants unlimited local clip exports and connected publishing with a bring-your-own AI key setup.",
            "It is the right plan if you are comfortable keeping your own OpenAI billing separate.",
          ],
        },
        {
          heading: "Pro and Agency",
          body: [
            "Pro is designed for hosted AI, more publishing accounts, and creator workflows without key setup once the backend entitlement is active.",
            "Agency is for operators managing client accounts and higher-volume publishing. Some client-team features are staged for the launch roadmap.",
          ],
        },
        {
          heading: "Changing plans",
          body: [
            "Manage billing in the account app. Plan changes are tied to the same license token used by the desktop app.",
            "If the desktop app does not reflect a change, sign out and sign in again so the token refreshes.",
          ],
        },
      ]}
    />
  );
}
