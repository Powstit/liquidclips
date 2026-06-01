import { redirect } from "next/navigation";

// Legacy desktop deep-link target — AffiliateHero "Refer friends" button
// pointed at jnremployee.com/refer (which 308s here). Send to the Liquid
// Clips marketing landing for now; later this becomes the affiliate
// onboarding page with a sign-in CTA + commission breakdown.
export default function ReferRedirect() {
  redirect("/");
}
