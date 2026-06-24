// Email allowlist for the HQ command-center surface.
//
// This is the *master* allowlist — only emails on this list are permitted to
// load any `/admin/*` route after the IP gate clears them. The existing
// `/admin/page.tsx` legacy fallback (`ADMIN_FALLBACK`) is kept untouched for
// backwards compatibility; the HQ Security Gate uses this stricter list of 5
// addresses driven entirely by `ADMIN_MASTER_EMAILS`.
//
// Read by:
//   - account-app/src/app/admin/_security/page.tsx (the gate landing)
//   - junior-backend recovery flow (Agent 5 will import via Python equivalent)
//
// Format of ADMIN_MASTER_EMAILS: comma-separated, no spaces required, e.g.
//   ADMIN_MASTER_EMAILS=a@x.com,b@x.com,c@x.com,d@x.com,e@x.com

function parseList(): string[] {
  const raw = process.env.ADMIN_MASTER_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseList().includes(normalized);
}

export function getMasterEmailCount(): number {
  return parseList().length;
}
