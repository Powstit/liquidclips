/**
 * UpdateReadyPill · in-app "🔄 update ready" pill.
 *
 * Polls `/runtime/manifest.json?channel=stable&current_version=<current>`
 * every 60 seconds. When the manifest advertises a version newer than
 * what the shell currently reads (from the `runtime-version` <meta> tag),
 * a small pill appears in the top-right. Clicking it calls
 * `window.location.reload()`, which triggers the shell startup path —
 * runtime.rs picks up the newer bundle and swaps atomically before Vite
 * loads.
 *
 * Why this exists (2026-07-22): during rapid iteration Daniel had to
 * Cmd+Q + relaunch the .app to swap a promoted runtime bundle. The
 * pill kills that friction — active users see updates within a minute
 * of promote, one click to swap in.
 */

import { useEffect, useState, type ReactElement } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

const POLL_INTERVAL_MS = 60_000;
const CURRENT_VERSION_META = "runtime-version";
const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(/\/+$/, "") ??
  "https://api.liquidclips.app";
const CHANNEL = "stable";

function readCurrentVersion(): string | null {
  const el = document.querySelector(`meta[name="${CURRENT_VERSION_META}"]`);
  return el?.getAttribute("content") ?? null;
}

/** Read the version from the bundle's /VERSION file (written by runtime-ship.sh
 *  as `dist/VERSION`). This is the same file runtime.rs uses for its own
 *  version check, so the frontend and the shell agree on what's live. */
async function fetchCurrentVersion(): Promise<string | null> {
  try {
    const r = await fetch("/VERSION", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.text()).trim() || null;
  } catch {
    return null;
  }
}

interface Manifest {
  version?: string;
  ship_lens_verdict?: string;
}

async function fetchLatest(current: string | null): Promise<string | null> {
  try {
    const url = `${BACKEND_URL}/runtime/manifest.json?channel=${CHANNEL}&current_version=${encodeURIComponent(current ?? "0.0.0")}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const m = (await r.json()) as Manifest;
    if (m?.ship_lens_verdict !== "PASS") return null;
    return m?.version ?? null;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string | null): boolean {
  if (!current) return true;
  // Simple semver-ish compare (major.minor.patch), tail suffixes are
  // treated as pre-release and lose to the plain version.
  const a = latest.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  const b = current.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

export function UpdateReadyPill(): ReactElement | null {
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(() => readCurrentVersion());

  // Resolve current version async from /VERSION if the meta tag missed.
  useEffect(() => {
    if (current) return;
    let cancelled = false;
    void (async () => {
      const v = await fetchCurrentVersion();
      if (!cancelled && v) setCurrent(v);
    })();
    return () => { cancelled = true; };
  }, [current]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const latest = await fetchLatest(current);
      if (cancelled || !latest) return;
      if (isNewer(latest, current)) setNextVersion(latest);
    };
    // Immediate check on mount + interval poll thereafter.
    void tick();
    const id = window.setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [current]);

  if (!nextVersion) return null;

  return (
    <button
      type="button"
      className="lc-update-ready-pill"
      onClick={async () => {
        // ⛔ IRON GATE IG-UPDATE-PILL-RELAUNCH-NOT-RELOAD · 2026-07-22
        // CRITICAL — must use Tauri `relaunch()`, NOT
        // window.location.reload(). Webview reload keeps serving the
        // pre-swap bundle; only a shell restart lets runtime.rs
        // atomically swap the promoted bundle before Vite loads.
        // See memory: liquid_clips_update_pill_bug_reload_vs_relaunch.
        // Regression test: UpdateReadyPill.relaunch.test.ts asserts
        // that `relaunch()` is the primary path and `reload()` only
        // survives as the catch-block fallback below.
        try {
          await relaunch();
        } catch {
          // Fallback for non-Tauri contexts (browser dev preview).
          window.location.reload();
        }
      }}
      title={`Runtime ${nextVersion} is ready · click to relaunch + swap`}
      data-testid="update-ready-pill"
      // 2026-07-22 · 2.3.35 · moved top-right → top-left.
      // ConsoleNav rail is 68px wide; nudge 88px in to clear it.
      // Resolves collision with the REMOTE ACTIVE pill · matches
      // Daniel's earlier ask for pill placement.
      style={{
        position: "fixed",
        top: 10,
        left: 88,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: "linear-gradient(90deg, #ff1a8c, #ff66b8)",
        color: "#0b0b10",
        border: "none",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        cursor: "pointer",
        boxShadow: "0 6px 20px -6px rgba(255, 26, 140, 0.55)",
        animation: "lc-update-pill-in 300ms ease",
      }}
    >
      <span aria-hidden="true">🔄</span>
      <span>Update ready · v{nextVersion}</span>
    </button>
  );
}

export default UpdateReadyPill;
