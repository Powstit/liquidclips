import { neon } from "@neondatabase/serverless";

/**
 * Neon HTTP driver — no pool, no long-lived connection, works in every
 * Vercel runtime (Fluid Compute, Edge, Node). Reads DATABASE_URL from
 * the env vars Vercel injects when you connect a Neon database via
 * Storage in the dashboard.
 *
 * `sql` is a tagged template:
 *   const rows = await sql`SELECT * FROM waitlist WHERE email = ${email}`;
 *
 * It auto-parameterises — interpolations are safe. Do not concatenate
 * user input into the template string itself.
 */

const url = process.env.DATABASE_URL;

if (!url && process.env.NODE_ENV === "production") {
  // Fail loud in production so a missing DATABASE_URL doesn't silently
  // drop waitlist signups. In dev / build we allow the missing-URL
  // path so a local build without a DB still completes.
  console.error(
    "[db] DATABASE_URL is not set. Waitlist + referral writes will throw.",
  );
}

export const sql = url ? neon(url) : null;

export function requireSql() {
  if (!sql) {
    throw new Error(
      "DATABASE_URL is not set. Provision Neon in Vercel Storage and pull env with `vercel env pull`.",
    );
  }
  return sql;
}
