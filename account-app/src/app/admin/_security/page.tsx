import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin, getMasterEmailCount } from "@/lib/admin-allowlist";
import { PinSetup } from "./PinSetup";
import { AuthCodeSetup } from "./AuthCodeSetup";

// HQ Security Gate landing — "you're in" status board.
//
// By the time a request reaches this server component, the middleware
// (IRON GATE IG-HQ-001) has already confirmed the request IP is on
// ADMIN_ALLOWED_IPS. This page enforces the remaining two gates:
//   - email is on ADMIN_MASTER_EMAILS (5-of-5 master list)
//   - the Clerk session carries an MFA claim (Clerk dashboard toggle)
//
// Failure modes:
//   - no userId           → /sign-in
//   - email not in master → /  (do NOT reveal the surface exists)
//   - MFA not enrolled    → /account/security  (enrollment surface)
//
// All four pills are rendered side-by-side as plain Tailwind. Agent 2
// will brand this in a later pass — do not bake custom CSS here.

export const dynamic = "force-dynamic";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

type RecoveryStatus = {
  pin_set: boolean;
  auth_code_set: boolean;
} | null;

async function fetchRecoveryStatus(clerkUserId: string): Promise<{
  status: RecoveryStatus;
  endpointExists: boolean;
}> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/admin/recovery/status?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
      {
        headers: {
          "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        },
        cache: "no-store",
      },
    );
    if (res.status === 404) return { status: null, endpointExists: false };
    if (!res.ok) return { status: null, endpointExists: true };
    const body = (await res.json()) as RecoveryStatus;
    return { status: body, endpointExists: true };
  } catch {
    return { status: null, endpointExists: false };
  }
}

function Pill({
  label,
  ok,
  pending,
}: {
  label: string;
  ok: boolean;
  pending?: boolean;
}) {
  const tone = pending
    ? "bg-yellow-100 text-yellow-900 border-yellow-300"
    : ok
      ? "bg-green-100 text-green-900 border-green-300"
      : "bg-red-100 text-red-900 border-red-300";
  const mark = pending ? "…" : ok ? "✓" : "✗";
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-4 py-3 ${tone}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="font-mono text-base">{mark}</span>
    </div>
  );
}

export default async function HQSecurityPage() {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const primaryEmail = (
    user.primaryEmailAddress?.emailAddress ?? ""
  )
    .trim()
    .toLowerCase();

  if (!isAdmin(primaryEmail)) {
    redirect("/"); // silent — never confirm the surface to non-admins
  }

  // sessionClaims may carry `mfa: true` when the Clerk session was minted
  // after an MFA challenge. The exact claim shape depends on the Clerk
  // session-token JWT template — fall back to any of the common keys.
  const claims = (sessionClaims ?? {}) as Record<string, unknown>;
  const mfaPassed =
    claims.mfa === true ||
    (typeof claims.amr === "object" &&
      Array.isArray(claims.amr) &&
      (claims.amr as unknown[]).includes("mfa")) ||
    user.twoFactorEnabled === true;

  if (!mfaPassed) {
    redirect("/account/security");
  }

  const { status: recoveryStatus, endpointExists } =
    await fetchRecoveryStatus(userId);

  const ipPass = true; // by definition — middleware would have 404'd otherwise
  const emailPass = true; // by definition — isAdmin() returned true above
  const mfaPass = true; // by definition — redirect would have fired otherwise
  const recoveryPass =
    !!recoveryStatus &&
    recoveryStatus.pin_set === true &&
    recoveryStatus.auth_code_set === true;

  const masterCount = getMasterEmailCount();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-neutral-500">
          HQ — Security Gate
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">
          You&apos;re in.
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Signed in as <span className="font-mono">{primaryEmail}</span>. Master
          list size: {masterCount}.
        </p>
      </header>

      <section className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Pill label="IP allowlist" ok={ipPass} />
        <Pill label="Email allowlist" ok={emailPass} />
        <Pill label="2FA enrolled" ok={mfaPass} />
        <Pill
          label="Recovery setup"
          ok={recoveryPass}
          pending={!endpointExists}
        />
      </section>

      {!endpointExists && (
        <p className="mb-8 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          Recovery endpoint not live yet — pending Agent 5
          (<code>/admin/recovery/status</code> on junior-backend).
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">
          Recovery setup
        </h2>
        <p className="mb-4 text-sm text-neutral-600">
          Recovery setup handled by{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">
            /admin/recovery
          </code>{" "}
          (Agent 5). The forms below post directly to the junior-backend
          endpoints that Agent 5 owns; they are gated by the IP + email + 2FA
          checks above.
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <PinSetup
            alreadySet={recoveryStatus?.pin_set === true}
            backendBase={BACKEND_URL}
            clerkUserId={userId}
          />
          <AuthCodeSetup
            alreadySet={recoveryStatus?.auth_code_set === true}
            backendBase={BACKEND_URL}
            clerkUserId={userId}
          />
        </div>
      </section>
    </main>
  );
}
