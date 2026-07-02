import { defineConfig } from "vite";
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
});
