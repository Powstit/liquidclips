/**
 * DiagnosticCenter · staff-only in-app inspection surface
 *
 * 2026-07-21 · Substitute for WebInspector on Tauri release builds
 * (which is disabled by default per `#[cfg(debug_assertions)]` in
 * src-tauri/src/lib.rs). Any Mac with the staff flag set at
 * `localStorage["lc.staff.flag"] = "1"` sees the route. Everyone
 * else gets a hard 404-style block.
 *
 * What it shows:
 *   - Runtime bundle version + backend URL sanity
 *   - Last 50 bus events (live)
 *   - Last 20 fetch results (URL · method · status · latency)
 *   - Last 20 console errors + unhandled rejections
 *   - localStorage snapshot for lc.* keys
 *   - "Force refetch runtime manifest" button (triggers KadeBootSplash reload)
 *
 * Route ID: "diagnostics"
 * Add to SURFACE_FOR in SimulatorRouter.tsx to expose.
 *
 * Turn on: from any surface, run in the JS console (via Web Inspector
 * during dev, or seed via a debug URL in prod):
 *   localStorage.setItem("lc.staff.flag", "1")
 * Then hash-navigate: window.location.hash = "#/diagnostics"
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import "./DiagnosticCenter.css";

const STAFF_FLAG_KEY = "lc.staff.flag";

interface BusEvent {
  ts: number;
  channel: string;
  payload: unknown;
}

interface FetchEntry {
  ts: number;
  method: string;
  url: string;
  status: number | "throw";
  ms: number;
  err?: string;
}

interface ErrorEntry {
  ts: number;
  kind: "error" | "reject";
  msg: string;
}

function isStaff(): boolean {
  try {
    if (typeof window === "undefined") return false;
    // URL escape hatch · #/diagnostics?staff=1 sets the flag +
    // strips the param so the URL stays clean. Lets a maintainer
    // enable the surface without needing WebInspector to console-
    // set localStorage (which is disabled on Tauri release builds).
    const hash = window.location.hash || "";
    if (hash.includes("staff=1")) {
      try {
        window.localStorage.setItem(STAFF_FLAG_KEY, "1");
        const clean = hash.split("?")[0];
        window.history.replaceState(null, "", clean);
      } catch { /* private mode · flag won't persist */ }
      return true;
    }
    return window.localStorage.getItem(STAFF_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.pathname + (url.search ? "?…" : "");
  } catch {
    return u.slice(0, 80);
  }
}

function shortWhen(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function DiagnosticCenterRoute(): ReactElement {
  const [staff] = useState<boolean>(() => isStaff());
  const [busEvents, setBusEvents] = useState<BusEvent[]>([]);
  const [fetchEntries, setFetchEntries] = useState<FetchEntry[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [tick, setTick] = useState(0);
  const busRef = useRef<BusEvent[]>([]);
  const fetchRef = useRef<FetchEntry[]>([]);
  const errRef = useRef<ErrorEntry[]>([]);

  // Install probes ONCE per mount (safe · never buffers · silent on failure)
  useEffect(() => {
    if (!staff) return;
    const w = window as unknown as { __LC_DIAG_INSTALLED?: boolean };
    if (w.__LC_DIAG_INSTALLED) {
      // Already installed by a prior mount · just start reading refs
      return;
    }
    w.__LC_DIAG_INSTALLED = true;

    // Fetch wrap · log every URL
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = async function diagFetch(...args) {
        let url = "?";
        let method = "GET";
        try {
          const req = args[0];
          url = typeof req === "string" ? req : (req as Request).url;
          const init = args[1] as RequestInit | undefined;
          method = (init?.method ?? (typeof req !== "string" ? (req as Request).method : "GET")).toUpperCase();
        } catch { /* silent */ }
        const t0 = Date.now();
        try {
          const res = await origFetch.apply(window, args);
          fetchRef.current = [
            { ts: Date.now(), method, url, status: res.status, ms: Date.now() - t0 },
            ...fetchRef.current.slice(0, 39),
          ];
          return res;
        } catch (err) {
          fetchRef.current = [
            { ts: Date.now(), method, url, status: "throw", ms: Date.now() - t0, err: String((err as Error)?.message ?? err).slice(0, 120) },
            ...fetchRef.current.slice(0, 39),
          ];
          throw err;
        }
      };
    }

    // Error probes
    window.addEventListener("error", (evt) => {
      errRef.current = [
        { ts: Date.now(), kind: "error", msg: (evt.message ?? "").slice(0, 200) },
        ...errRef.current.slice(0, 39),
      ];
    });
    window.addEventListener("unhandledrejection", (evt) => {
      errRef.current = [
        { ts: Date.now(), kind: "reject", msg: String(evt.reason ?? "").slice(0, 200) },
        ...errRef.current.slice(0, 39),
      ];
    });

    // Bus probe · monkey-patch bus.emit (lazy import so probe stays optional)
    void (async () => {
      try {
        const { bus } = await import("../bridge");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = bus as unknown as { emit: (...a: any[]) => any };
        const origEmit = b.emit.bind(bus);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        b.emit = (channel: any, payload?: any) => {
          busRef.current = [
            { ts: Date.now(), channel: String(channel), payload },
            ...busRef.current.slice(0, 49),
          ];
          return origEmit(channel, payload);
        };
      } catch { /* bridge unavailable · silent */ }
    })();
  }, [staff]);

  // Poll refs into state · cheap · updates the visible panels
  useEffect(() => {
    if (!staff) return;
    const id = window.setInterval(() => {
      setBusEvents([...busRef.current]);
      setFetchEntries([...fetchRef.current]);
      setErrors([...errRef.current]);
      setTick((t) => t + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [staff]);

  const clearAll = useCallback(() => {
    busRef.current = [];
    fetchRef.current = [];
    errRef.current = [];
    setBusEvents([]);
    setFetchEntries([]);
    setErrors([]);
  }, []);

  const forceRuntimeRefetch = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("runtime_check_now");
      alert("runtime_check_now dispatched · reload to activate a new bundle if staged");
    } catch (err) {
      alert(`Not in Tauri context · cannot force refetch. (${String(err).slice(0, 100)})`);
    }
  }, []);

  if (!staff) {
    return (
      <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
        <div className="lc-diag-block">
          <h1>Diagnostic Center · staff only</h1>
          <p>
            To enable, run in the JS console:{" "}
            <code>localStorage.setItem("lc.staff.flag", "1")</code>
          </p>
          <p>Then reload the app.</p>
        </div>
      </DesignOSAppShell>
    );
  }

  // Runtime bundle version + backend URL sanity
  const backendUrl =
    (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL ?? "(unset)";
  const bundleVersion =
    (import.meta as { env?: { __APP_VERSION__?: string } }).env?.__APP_VERSION__ ??
    (window as unknown as { __LC_BUNDLE_VERSION__?: string }).__LC_BUNDLE_VERSION__ ??
    "(unknown)";

  const isProdBackend = backendUrl.includes("api.liquidclips.app");
  const localStorageSnapshot = ((): Array<[string, string]> => {
    try {
      const out: Array<[string, string]> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("lc")) {
          const v = localStorage.getItem(k) ?? "";
          out.push([k, v.length > 60 ? v.slice(0, 57) + "…" : v]);
        }
      }
      return out.sort();
    } catch {
      return [];
    }
  })();

  return (
    <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
      <div className="lc-diag" data-testid="diagnostic-center">
        <header className="lc-diag-head">
          <h1>Diagnostic Center</h1>
          <div className="lc-diag-head-meta">
            <span className="lc-diag-pill" data-tone={isProdBackend ? "ok" : "warn"}>
              backend: {backendUrl}
            </span>
            <span className="lc-diag-pill">bundle: {bundleVersion}</span>
            <span className="lc-diag-pill">tick: {tick}</span>
            <button onClick={clearAll} className="lc-diag-btn">Clear</button>
            <button onClick={forceRuntimeRefetch} className="lc-diag-btn lc-diag-btn-primary">
              Force runtime refetch
            </button>
            <a
              href="#/composer-preview?staff=1"
              className="lc-diag-btn"
              title="Sprint 1 Tier 1 · approved mockup rendered in-app"
            >
              Composer preview (iframe) →
            </a>
            <a
              href="#/composer-master?staff=1"
              className="lc-diag-btn lc-diag-btn-primary"
              title="Sprint 2 Tier 2 · React port with real state wiring"
            >
              Master Composer (React) →
            </a>
          </div>
        </header>

        <div className="lc-diag-grid">
          <section className="lc-diag-panel">
            <h2>Bus events · last {busEvents.length}</h2>
            <div className="lc-diag-list">
              {busEvents.map((e, i) => (
                <div key={i} className="lc-diag-row">
                  <span className="lc-diag-when">{shortWhen(e.ts)}</span>
                  <span className="lc-diag-channel">{e.channel}</span>
                  <span className="lc-diag-payload">{JSON.stringify(e.payload ?? {}).slice(0, 120)}</span>
                </div>
              ))}
              {busEvents.length === 0 && <div className="lc-diag-empty">No bus events captured yet.</div>}
            </div>
          </section>

          <section className="lc-diag-panel">
            <h2>Fetch log · last {fetchEntries.length}</h2>
            <div className="lc-diag-list">
              {fetchEntries.map((f, i) => (
                <div key={i} className="lc-diag-row" data-status={typeof f.status === "number" && f.status >= 400 ? "fail" : f.status === "throw" ? "throw" : "ok"}>
                  <span className="lc-diag-when">{shortWhen(f.ts)}</span>
                  <span className="lc-diag-method">{f.method}</span>
                  <span className="lc-diag-status">{f.status}</span>
                  <span className="lc-diag-ms">{f.ms}ms</span>
                  <span className="lc-diag-url" title={f.url}>{shortUrl(f.url)}</span>
                  {f.err && <span className="lc-diag-err">{f.err}</span>}
                </div>
              ))}
              {fetchEntries.length === 0 && <div className="lc-diag-empty">No fetches captured yet.</div>}
            </div>
          </section>

          <section className="lc-diag-panel">
            <h2>Errors · last {errors.length}</h2>
            <div className="lc-diag-list">
              {errors.map((e, i) => (
                <div key={i} className="lc-diag-row" data-status="fail">
                  <span className="lc-diag-when">{shortWhen(e.ts)}</span>
                  <span className="lc-diag-channel">[{e.kind}]</span>
                  <span className="lc-diag-payload">{e.msg}</span>
                </div>
              ))}
              {errors.length === 0 && <div className="lc-diag-empty">Zero errors captured. 🎉</div>}
            </div>
          </section>

          <section className="lc-diag-panel">
            <h2>localStorage · lc.* keys</h2>
            <div className="lc-diag-list">
              {localStorageSnapshot.map(([k, v]) => (
                <div key={k} className="lc-diag-row">
                  <span className="lc-diag-channel">{k}</span>
                  <span className="lc-diag-payload">{v || "(empty)"}</span>
                </div>
              ))}
              {localStorageSnapshot.length === 0 && <div className="lc-diag-empty">No lc.* keys.</div>}
            </div>
          </section>
        </div>
      </div>
    </DesignOSAppShell>
  );
}

export default DiagnosticCenterRoute;
