/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? 1420);

export default defineConfig({
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
});
