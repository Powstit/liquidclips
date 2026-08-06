var _a, _b;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
var DEV_PORT = Number((_a = process.env.VITE_DEV_PORT) !== null && _a !== void 0 ? _a : 1420);
export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: {
        port: DEV_PORT,
        strictPort: true,
        host: false,
        hmr: { port: DEV_PORT + 1 },
        // Cargo writes thousands of build artifacts under src-tauri/target
        // during compilation; without this, chokidar watches them too and
        // the dev server crashes mid-build ("beforeDevCommand terminated
        // with a non-zero status code").
        watch: { ignored: ["**/src-tauri/**"] },
    },
    envPrefix: ["VITE_", "TAURI_"],
    define: {
        __APP_VERSION__: JSON.stringify((_b = process.env.npm_package_version) !== null && _b !== void 0 ? _b : "0.8.0-shell"),
    },
    build: {
        target: "es2022",
        minify: "esbuild",
        sourcemap: false,
    },
});
