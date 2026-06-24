var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: false,
        hmr: { port: 1421 },
    },
    envPrefix: ["VITE_", "TAURI_"],
    define: {
        __APP_VERSION__: JSON.stringify((_a = process.env.npm_package_version) !== null && _a !== void 0 ? _a : "0.8.0-shell"),
    },
    build: {
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
    },
});
