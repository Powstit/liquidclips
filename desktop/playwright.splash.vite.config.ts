import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const webShim = (name: string) => resolve(__dirname, `src/tauri-web-shims/${name}.ts`);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@tauri-apps/api/app": webShim("app"),
      "@tauri-apps/api/core": webShim("core"),
      "@tauri-apps/api/event": webShim("event"),
      "@tauri-apps/plugin-clipboard-manager": webShim("plugin-clipboard-manager"),
      "@tauri-apps/plugin-dialog": webShim("plugin-dialog"),
      "@tauri-apps/plugin-fs": resolve(__dirname, "tests/tauri-fs-shim.ts"),
      "@tauri-apps/plugin-process": webShim("plugin-process"),
      "@tauri-apps/plugin-shell": webShim("plugin-shell"),
      "@tauri-apps/plugin-updater": webShim("plugin-updater"),
    },
  },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "test") },
  server: {
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/python-sidecar/**"] },
  },
});
