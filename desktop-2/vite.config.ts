/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? 1420);

// IG-VITE-PROD-URL-GUARD · Fence #3 (2026-07-21)
//
// Prevents the localhost URL bake-in that shipped in 2.2.61-2.2.63.
// If `npm run build` runs with mode=production AND the resolved
// VITE_BACKEND_URL still points at localhost (from a stale .env.local
// / no .env.production.local override), fail LOUD before dist/ is
// written. Real end-user bundles must always target api.liquidclips.app.
function assertProductionBackendUrl(mode: string): void {
  if (mode !== "production") return;
  let backend = process.env.VITE_BACKEND_URL ?? "";
  if (!backend) {
    // Vite's .env cascade for mode=production reads (in precedence):
    //   .env.production.local > .env.local > .env.production > .env
    for (const p of [".env.production.local", ".env.local", ".env.production", ".env"]) {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      const m = raw.match(/^VITE_BACKEND_URL=(.+)$/m);
      if (m) { backend = m[1].trim(); break; }
    }
  }
  if (backend.includes("localhost") || backend.includes("127.0.0.1")) {
    const msg =
      `\n❌ IG-VITE-PROD-URL-GUARD\n` +
      `Production build with local backend URL detected: ${backend}\n\n` +
      `Fix: create desktop-2/.env.production.local with:\n` +
      `       VITE_BACKEND_URL=https://api.liquidclips.app\n` +
      `(Vite gives .env.production.local higher precedence for mode=production\n` +
      ` so local dev via .env.local keeps its localhost:8000.)\n`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error("IG-VITE-PROD-URL-GUARD failed · refusing to build");
  }
}

export default defineConfig(({ mode }) => {
  assertProductionBackendUrl(mode);
  return {
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: false,
    hmr: { port: DEV_PORT + 1 },
  },
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.8.0-shell"),
  },
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
  // 2026-07-18 · vitest config. Prior to this block, vitest picked up
  // stale `.claude/worktrees/agent-*` snapshot test files from earlier
  // agent sessions — those directories have source but no node_modules,
  // so every worktree spec crashed with "Cannot find package
  // 'react-dom/client'". Confusing pre-existing "failures" that weren't
  // actual regressions. Excluding the worktree tree keeps the suite
  // focused on the live src/. Default environment stays `node` because
  // most invariant/lint tests only need file IO; specific behaviour
  // tests opt into jsdom via `// @vitest-environment jsdom` at the top
  // of the file (see `TopHud.version.test.ts`).
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/.cache/**",
      "**/.claude/worktrees/**",
      "**/tests/e2e/**",
    ],
  },
  };
});
