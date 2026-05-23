// Web-only shim for `@tauri-apps/api/core`. Vite aliases the real package
// to this file when VITE_TARGET=web (see vite.config.ts).
//
// All Tauri commands flow through invoke(); we route them into the mock
// sidecar so the preview can render real-looking pipeline output without
// any local processing.

import { mockSidecarCall } from "../lib/mock-sidecar";

// Inject a "PREVIEW MODE" banner once on first import — the user has to know
// they're poking the UI without real processing happening.
if (typeof document !== "undefined" && !document.getElementById("__preview-banner")) {
  const el = document.createElement("div");
  el.id = "__preview-banner";
  el.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:9999",
    "padding:6px 14px",
    "background:#FF1A8C",
    "color:#fff",
    "font:600 11px/1 ui-monospace,Menlo,monospace",
    "letter-spacing:0.12em",
    "text-transform:uppercase",
    "text-align:center",
    "box-shadow:0 2px 12px rgba(255,26,140,0.25)",
  ].join(";");
  el.textContent =
    "preview mode · ux only · drop a file → click around → download Junior for real processing";
  document.addEventListener("DOMContentLoaded", () => document.body.prepend(el), { once: true });
  if (document.body) document.body.prepend(el);
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (cmd === "sidecar_call" && args) {
    const method = args.method as string;
    const params = (args.params as Record<string, unknown>) ?? {};
    return mockSidecarCall<T>(method, params);
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn("[web-preview] unknown invoke:", cmd, args);
  }
  return null as unknown as T;
}

export function convertFileSrc(path: string, _protocol?: string): string {
  // Mock paths use a /sample/ prefix that points at bundled fixture assets.
  if (path.startsWith("/sample/")) return path;
  if (path.startsWith("http")) return path;
  return "/sample/placeholder.svg";
}
