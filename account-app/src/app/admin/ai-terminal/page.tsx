import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Terminal } from "./Terminal";

// Admin HQ — AI Terminal page (read-only investigative chat).
//
// Mirrors the auth gate on `app/admin/page.tsx`: anonymous → /sign-in;
// non-admin → /; admin → render the Terminal client component. The
// Anthropic key NEVER touches this server component or the browser —
// it lives only inside `/api/admin/ai/run`.

export const dynamic = "force-dynamic";

const ADMIN_FALLBACK = [
  "danieldiyepriye@gmail.com",
  "mrddokubo@gmail.com",
  "crazycatjackkids@gmail.com",
  "thedoks2019@gmail.com",
];

function adminList(): string[] {
  const env = process.env.JUNIOR_ADMIN_EMAILS ?? "";
  const src = env ? env.split(",") : ADMIN_FALLBACK;
  return src.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export default async function AITerminalPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const primaryEmail = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();
  if (!primaryEmail || !adminList().includes(primaryEmail)) {
    redirect("/");
  }

  const hasKey = !!process.env.CLAUDE_ADMIN_API_KEY;

  return <Terminal adminEmail={primaryEmail} hasKey={hasKey} />;
}
