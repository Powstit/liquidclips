/**
 * MasterComposerPreview · Sprint 1 Tier 1 · 2026-07-21
 *
 * Renders the approved kade-composer-simulator.html mockup inside a
 * sandboxed iframe so Daniel can SEE the full composer suite UI running
 * inside the shipping app. This is a VISUAL PROOF surface, not the
 * production composer. SimpleComposer remains the default.
 *
 * Route: #/composer-preview (staff-flag gated · same escape hatch as
 * DiagnosticCenter — `localStorage["lc.staff.flag"] = "1"` or append
 * `?staff=1` to the hash).
 *
 * Bridge (parent ↔ iframe via postMessage):
 *   parent → iframe   { type: "lc.state", tier, sessionCtx, kadeMood }
 *   iframe → parent   { type: "lc.command", utterance }
 *                     { type: "lc.pickFile" }
 *                     { type: "lc.pasteUrl", url }
 *                     { type: "lc.recordScreen" }
 *
 * Iron Gates: this route intentionally sits OUTSIDE the composer's
 * production gate (IG-COMPOSER-HOSTED-INTENT, IG-COMPOSER-NO-STATIC-
 * VISIBLE, IG-COMPOSER-VISUAL) because it hosts raw HTML. Production
 * gates re-engage once the Tier 2 React port lands.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { bus } from "../bridge";
import { lcDiag } from "../../lib/diagnosticLogger";
import "./MasterComposerPreview.css";

const STAFF_FLAG_KEY = "lc.staff.flag";
const MOCKUP_URL = "/mockup-composer.html";

interface IframeMessage {
  type: string;
  [k: string]: unknown;
}

function isStaff(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash || "";
    if (hash.includes("staff=1")) {
      try {
        window.localStorage.setItem(STAFF_FLAG_KEY, "1");
        const clean = hash.split("?")[0];
        window.history.replaceState(null, "", clean);
      } catch { /* private mode */ }
      return true;
    }
    return window.localStorage.getItem(STAFF_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function MasterComposerPreviewRoute(): ReactElement {
  const [staff] = useState<boolean>(() => isStaff());
  const [ready, setReady] = useState<boolean>(false);
  const [messageCount, setMessageCount] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen for postMessage from the iframe · surfaces user interactions
  // back into the real app so we can start bridging state in Tier 2.
  useEffect(() => {
    if (!staff) return;
    const onMessage = (evt: MessageEvent<IframeMessage>) => {
      const data = evt.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (!data.type.startsWith("lc.")) return;
      setMessageCount((c) => c + 1);
      void lcDiag("composer_preview_iframe_message", {
        type: data.type,
        payload_size: JSON.stringify(data).length,
      });
      // Basic pass-through: surface commands as Kade speech so parent app
      // hears the interaction. Tier 2 will replace this with real routing.
      if (data.type === "lc.command" && typeof data.utterance === "string") {
        bus.emit("kade:speak", {
          title: "Preview",
          body: `Received: "${data.utterance.slice(0, 60)}"`,
          severity: "info",
        });
      }
      if (data.type === "lc.pickFile") {
        bus.emit("kade:speak", {
          title: "File picker (Tier 2)",
          body: "Native picker wires in the React port · currently browser input only.",
          severity: "info",
        });
      }
      if (data.type === "lc.recordScreen") {
        bus.emit("kade:speak", {
          title: "Screen record (Tier 2)",
          body: "Real screen_capture_list_targets fires from React port.",
          severity: "info",
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [staff]);

  // Post a hello handshake to the iframe once it loads so it knows the
  // parent is listening. The mockup's existing JS doesn't require this,
  // but leaves the door open for a Tier 2 handshake protocol.
  const onIframeLoad = useCallback(() => {
    setReady(true);
    void lcDiag("composer_preview_iframe_loaded", { url: MOCKUP_URL });
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "lc.hello", host: "MasterComposerPreview", ready: true },
        window.location.origin,
      );
    } catch { /* silent */ }
  }, []);

  const goHome = useCallback(() => {
    bus.emit("nav:click", { route: "home" });
  }, []);

  const goDiagnostic = useCallback(() => {
    window.location.hash = "#/diagnostics?staff=1";
  }, []);

  if (!staff) {
    return (
      <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
        <div className="lc-mcp-block">
          <h1>Master Composer Preview · staff only</h1>
          <p>
            This is a preview of the approved <code>kade-composer-simulator.html</code>{" "}
            mockup rendering inside the shipping app · Sprint 1 Tier 1.
          </p>
          <p>
            To enable, run in the JS console:{" "}
            <code>localStorage.setItem("lc.staff.flag", "1")</code>
          </p>
          <p>Then reload and revisit this route.</p>
        </div>
      </DesignOSAppShell>
    );
  }

  return (
    <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
      <div className="lc-mcp" data-testid="master-composer-preview">
        <header className="lc-mcp-head">
          <div className="lc-mcp-head-title">
            <span className="lc-mcp-eyebrow">SPRINT 1 · TIER 1</span>
            <h1>Master Composer · Preview</h1>
            <span className="lc-mcp-sub">
              Approved mockup running inside the shipping app · SimpleComposer remains the default composer.
            </span>
          </div>
          <div className="lc-mcp-head-meta">
            <span className="lc-mcp-pill" data-tone={ready ? "ok" : "warn"}>
              iframe: {ready ? "loaded" : "loading…"}
            </span>
            <span className="lc-mcp-pill">
              messages: {messageCount}
            </span>
            <button className="lc-mcp-btn" onClick={goDiagnostic} title="Diagnostic Center">
              Diagnostics
            </button>
            <button className="lc-mcp-btn lc-mcp-btn-primary" onClick={goHome}>
              ← Back to Home
            </button>
          </div>
        </header>

        <iframe
          ref={iframeRef}
          className="lc-mcp-frame"
          src={MOCKUP_URL}
          title="Kade Composer Simulator · approved mockup"
          onLoad={onIframeLoad}
          allow="microphone; camera; autoplay"
          data-testid="master-composer-preview-frame"
        />

        <footer className="lc-mcp-foot">
          <span className="lc-mcp-foot-eyebrow">TIER 1 · VISUAL PROOF ONLY</span>
          <span className="lc-mcp-foot-body">
            Source: <code>public/mockup-composer.html</code> · reference:{" "}
            <code>docs/mockups/proposed/kade-composer-simulator.html</code>.
            The full React port with real sidecar wiring lands in Sprint 2 Tier 2.
            Feature-1..5 overlays land Sprints 3-6.
          </span>
        </footer>
      </div>
    </DesignOSAppShell>
  );
}

export default MasterComposerPreviewRoute;
