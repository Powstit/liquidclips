import { redirect } from "next/navigation";

// Legacy referral entry point. Keep it working while public links migrate to
// the explicit /affiliates route.
export default function ReferRedirect() {
  redirect("/affiliates");
}
