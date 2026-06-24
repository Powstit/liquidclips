import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { AdminHQ } from "@/components/admin/AdminHQ";
import { isAdmin } from "@/lib/admin-allowlist";

// Read-only Admin HQ v0 — server component gate.
//
// Auth (enforced here AND on the backend):
//   1. not signed in            → redirect to /sign-in
//   2. signed in but not admin  → redirect to / (do NOT render admin)
//   3. admin                    → fetch backend /admin/overview server-side
//      (x-internal-secret + ?clerk_user_id), then render the client UI.
//
// The admin allow-list mirrors junior-backend/app/features.py. The internal
// secret + admin list live only on the server; neither reaches the browser.
// The backend re-checks admin on every /admin/* call (frontend gating alone
// is not trusted).

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const primaryEmail = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!isAdmin(primaryEmail)) {
    redirect("/"); // not an admin — never render the admin surface
  }

  // Pre-fetch the overview server-side so the first paint has real data.
  // Same pattern as dashboard/page.tsx → /affiliate/me: pass the verified
  // clerk_user_id and the internal secret (server-only).
  let initialOverview = null;
  try {
    const res = await fetch(
      `${BACKEND_URL}/admin/overview?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (res.ok) initialOverview = await res.json();
  } catch {
    /* backend unreachable — the client tab will surface a refresh prompt */
  }

  const agentKeyConfig = {
    auth: !!process.env.KIMI_AUTH_AGENT_API_KEY,
    projects: !!process.env.KIMI_PROJECTS_AGENT_API_KEY,
    earn: !!process.env.KIMI_EARN_AGENT_API_KEY,
    ui: !!process.env.KIMI_UI_AGENT_API_KEY,
    codex: !!process.env.OPENAI_CODEX_AGENT_API_KEY,
    claude: !!process.env.CLAUDE_AGENT_API_KEY,
    hqInternal: !!process.env.HQ_INTERNAL_SECRET,
  };

  const serviceConfig = {
    openai: !!process.env.OPENAI_API_KEY,
    kimi: !!(process.env.KIMI_API_KEY || process.env.KIMI_AUTH_AGENT_API_KEY),
    claude: !!(process.env.CLAUDE_API_KEY || process.env.CLAUDE_AGENT_API_KEY),
    whop: !!process.env.WHOP_API_KEY,
    clerk: !!process.env.CLERK_SECRET_KEY,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    railway: !!process.env.RAILWAY_TOKEN,
    vercel: !!process.env.VERCEL_TOKEN,
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    resend: !!process.env.RESEND_API_KEY,
    ayrshare: !!process.env.AYRSHARE_API_KEY,
    postiz: !!process.env.POSTIZ_API_KEY,
    storage: !!(process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID),
    sentry: !!process.env.SENTRY_AUTH_TOKEN,
  };

  return <AdminHQ adminEmail={primaryEmail} initialOverview={initialOverview} agentKeyConfig={agentKeyConfig} serviceConfig={serviceConfig} />;
}
