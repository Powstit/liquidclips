// db-migrate · runs every .sql file in db/migrations/ in lexical order
// against DATABASE_URL using Neon's HTTP driver. Idempotent because each
// migration uses CREATE … IF NOT EXISTS.
//
// Usage:
//   pnpm run db:migrate                   # uses .env.local DATABASE_URL
//   DATABASE_URL=postgres://… pnpm db:migrate
//
// We track applied migrations in a `_migrations` table so future
// incremental migrations only run once each.

import { neon } from "@neondatabase/serverless";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const MIGRATIONS_DIR = resolve(process.cwd(), "db/migrations");

async function loadEnvLocal() {
  // Best-effort .env.local loader so `pnpm db:migrate` works without
  // wrapping in `vercel env pull` every time.
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

await loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Pull from Vercel:");
  console.error("  vercel env pull .env.local");
  process.exit(1);
}

const sql = neon(url);

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

async function applied() {
  const rows = await sql`SELECT name FROM _migrations`;
  return new Set(rows.map((r) => r.name));
}

await ensureMigrationsTable();
const done = await applied();

const files = (await readdir(MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("no migrations found in", MIGRATIONS_DIR);
  process.exit(0);
}

let ran = 0;
for (const file of files) {
  if (done.has(file)) {
    console.log("skip ·", file, "(already applied)");
    continue;
  }
  const path = resolve(MIGRATIONS_DIR, file);
  const sqlText = await readFile(path, "utf8");
  console.log("running ·", file);
  // sqlText may contain multiple statements; split on `;` followed by a
  // newline so we don't break inside a quoted string. Migration files
  // here keep one statement per `;\n` so this is safe.
  const statements = sqlText
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  await sql`INSERT INTO _migrations (name) VALUES (${file})`;
  ran += 1;
}

console.log(`done · ${ran} migration${ran === 1 ? "" : "s"} applied`);
