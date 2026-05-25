import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { AdminHQ } from "@/components/admin/AdminHQ";

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

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const primaryEmail = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!primaryEmail || !adminList().includes(primaryEmail)) {
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

  return <AdminHQ adminEmail={primaryEmail} initialOverview={initialOverview} />;
}
