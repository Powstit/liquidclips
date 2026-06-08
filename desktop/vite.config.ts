import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri hosts the dev server on a fixed port and watches for changes.
const host = process.env.TAURI_DEV_HOST;

// When VITE_TARGET=web is set, alias every Tauri-specific import to a browser-
// safe shim in src/tauri-web-shims/. Produces a static SPA that can deploy to
// app.jnremployee.com as a UX preview without any local processing capability.
const isWeb = process.env.VITE_TARGET === "web";

const webShims: Record<string, string> = isWeb
  ? {
      "@tauri-apps/api/core": resolve(__dirname, "src/tauri-web-shims/core.ts"),
      "@tauri-apps/api/event": resolve(__dirname, "src/tauri-web-shims/event.ts"),
      "@tauri-apps/api/app": resolve(__dirname, "src/tauri-web-shims/app.ts"),
      "@tauri-apps/plugin-dialog": resolve(__dirname, "src/tauri-web-shims/plugin-dialog.ts"),
      "@tauri-apps/plugin-shell": resolve(__dirname, "src/tauri-web-shims/plugin-shell.ts"),
      "@tauri-apps/plugin-fs": resolve(__dirname, "src/tauri-web-shims/plugin-fs.ts"),
      "@tauri-apps/plugin-clipboard-manager": resolve(__dirname, "src/tauri-web-shims/plugin-clipboard-manager.ts"),
      // Updater + process are only invoked from desktop-only code paths but
      // alias them anyway so an accidental import doesn't break the web build.
      "@tauri-apps/plugin-updater": resolve(__dirname, "src/tauri-web-shims/plugin-updater.ts"),
      "@tauri-apps/plugin-process": resolve(__dirname, "src/tauri-web-shims/plugin-process.ts"),
    }
  : {};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      // shadcn standard alias — `import { cn } from "@/lib/utils"` etc.
      // Paired with tsconfig.json "paths": { "@/*": ["src/*"] }.
      "@": resolve(__dirname, "src"),
      ...webShims,
    },
  },
  define: isWeb ? { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") } : {},
  build: isWeb ? { outDir: "dist-web" } : undefined,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/python-sidecar/**"] },
  },
});
