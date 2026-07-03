// Email allowlist for the HQ command-center surface.
//
// 2026-07-03 · DEPRECATED for new gates by Step 2 batch 2e. New gates MUST
// use `hasCapability(snapshot, CAP.HQ_READ)` from
// `lib/server-capabilities.ts`, which reads the server-authoritative
// `platform_role` + `capabilities` projection from the backend
// `/authz/whoami` endpoint. This file remains wired only as a fallback for
// one compat release so an unreachable backend still lets the founders into
// HQ; delete once the whoami endpoint has been stable in prod for a full
// release cycle.
//
// Legacy notes — every HQ route (/admin/*, /api/admin/*) imported `isAdmin`
// from this file. Driven by the `JUNIOR_ADMIN_EMAILS` env var
// (comma-separated). If the env var is absent or empty, falls back to the
// hardcoded 4-email list below so the surface never silently locks out the
// founders. Do not re-roll local fallback arrays in individual routes —
// that drift was the P0-001 bug (HQ_SESSION_RESUME.md).
//
// Format of JUNIOR_ADMIN_EMAILS: comma-separated, no spaces required, e.g.
//   JUNIOR_ADMIN_EMAILS=a@x.com,b@x.com,c@x.com,d@x.com

const HARDCODED_FALLBACK = [
  "danieldiyepriye@gmail.com",
  "mrddokubo@gmail.com",
  "crazycatjackkids@gmail.com",
  "thedoks2019@gmail.com",
];

function parseList(): string[] {
  const raw = process.env.JUNIOR_ADMIN_EMAILS ?? "";
  const fromEnv = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return HARDCODED_FALLBACK.map((e) => e.toLowerCase());
}

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return parseList().includes(normalized);
}
