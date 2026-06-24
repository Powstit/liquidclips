import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Terminal } from "./Terminal";
import { isAdmin } from "@/lib/admin-allowlist";

// Admin HQ — AI Terminal page (read-only investigative chat).
//
// Mirrors the auth gate on `app/admin/page.tsx`: anonymous → /sign-in;
// non-admin → /; admin → render the Terminal client component. The
// Anthropic key NEVER touches this server component or the browser —
// it lives only inside `/api/admin/ai/run`.

export const dynamic = "force-dynamic";

export default async function AITerminalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const primaryEmail = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();
  if (!isAdmin(primaryEmail)) {
    redirect("/");
  }

  const hasKey = !!process.env.CLAUDE_ADMIN_API_KEY;

  return <Terminal adminEmail={primaryEmail} hasKey={hasKey} />;
}
