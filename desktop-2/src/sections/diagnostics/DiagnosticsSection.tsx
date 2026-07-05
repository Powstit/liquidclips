import { useState, useEffect, useMemo } from "react";
import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { getRecentEvents, subscribeFlowTrace } from "../../lib/flowTrace";
import { runHealthCheck, rollUp } from "../../lib/healthCheck";
import {
  fakeDiagnosticsEvents,
  fakeBackendStatus,
  fakeSidecarStatus,
  fakePassiveKeychainStatus,
} from "../../fixtures/fakeDiagnostics.preview";
import { useHashRoute } from "../../shell/routes";

// P1 bug #8 fix · 2026-07-05 · read the real build values instead of
// hardcoded shell placeholders so the diagnostics panel actually helps
// during incident triage. `__APP_VERSION__` is injected by Vite from
// `package.json` (see vite.config.ts:18). `VITE_GIT_SHA` is set by CI —
// falls back to "local" for `tauri dev` where CI didn't stamp it.
declare const __APP_VERSION__: string | undefined;
const VERSION_PLACEHOLDER =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : "unknown";
const COMMIT_PLACEHOLDER =
  (import.meta as { env?: { VITE_GIT_SHA?: string } }).env?.VITE_GIT_SHA ?? "local";

export function DiagnosticsSection() {
  const activeSection = useHashRoute();
  const [, setTick] = useState(0);

  useEffect(() => {
    return subscribeFlowTrace(() => setTick((t) => t + 1));
  }, []);

  const recent = getRecentEvents(20);
  const events = recent.length > 0 ? recent : fakeDiagnosticsEvents.slice().reverse();
  const rows = useMemo(() => runHealthCheck(), []);
  const overall = rollUp(rows);

  const healthTone = (status: string) => {
    if (status === "ok") return "ok";
    return "warn";
  };

  const report = useMemo(
    () =>
      buildReport({
        version: VERSION_PLACEHOLDER,
        commit: COMMIT_PLACEHOLDER,
        activeSection,
        overall,
        rows,
        events,
      }),
    [activeSection, overall, rows, events]
  );

  return (
    <div>
      <div className="lc-hud-card">
        <span className="lc-section-eyebrow">
          <span className="lc-section-eyebrow-dot" /> flow trace · health · status
        </span>
        <h1 className="lc-section-title">Diagnostics</h1>
        <p className="lc-section-subtitle">
          Live flow-trace, health probes, and app state. Copy the full report to share with support.
        </p>
        <div className="lc-section-pills">
          <span className="lc-id-pill">{SECTION_IDS.SECTION_DIAGNOSTICS}</span>
          <span className="lc-id-pill">{FLOW_IDS.FLOW_014_DIAGNOSTICS_HEALTH_REPORT}</span>
        </div>
      </div>

      <div className="lc-grid lc-grid-3 lc-mt-16">
        <Stat label="App version" value={VERSION_PLACEHOLDER} />
        <Stat label="Commit" value={COMMIT_PLACEHOLDER} />
        <Stat label="Active section" value={activeSection.replace("SECTION_", "")} />
        <Stat label="Sidecar" value={(rows.find((r) => r.id.includes("sidecar"))?.status ?? "checking").toUpperCase()} />
        <Stat label="Backend" value={(rows.find((r) => r.id.includes("backend"))?.status ?? "checking").toUpperCase()} />
        <Stat label="Keychain reads" value={`${fakePassiveKeychainStatus.passiveReadsAtBoot} at boot`} />
      </div>

      <div className="lc-hud-card lc-mt-16">
        <div className="lc-row" style={{ justifyContent: "space-between" }}>
          <h3 className="lc-hud-title" style={{ margin: 0 }}>Health</h3>
          <span className="lc-pill" data-tone={healthTone(overall)}>
            <span className="lc-pill-dot" /> {overall.toUpperCase()}
          </span>
        </div>
        <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 6px" }}>Probe</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}>Detail</th>
              <th style={{ padding: "8px 6px" }}>Real?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--color-line)" }}>
                <td style={{ padding: "10px 6px", fontFamily: "var(--font-mono)", fontSize: 11 }}>{r.label}</td>
                <td style={{ padding: "10px 6px" }}>
                  <span className="lc-pill" data-tone={healthTone(r.status)}>
                    <span className="lc-pill-dot" /> {r.status}
                  </span>
                </td>
                <td style={{ padding: "10px 6px" }}>{r.detail}</td>
                <td style={{ padding: "10px 6px" }}>{r.realProbe ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lc-hud-card lc-mt-16">
        <h3 className="lc-hud-title">Recent flow trace</h3>
        <p className="lc-hud-body" style={{ fontSize: 12 }}>
          {recent.length > 0 ? `Live buffer (last ${recent.length}).` : "Buffer empty in this view — showing fixture."}
        </p>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <span style={{ color: "var(--color-text-tertiary)", width: 80 }}>{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="lc-pill" data-tone={healthTone(e.status)}>{e.status}</span>
              <span style={{ color: "var(--color-fuchsia-deep)" }}>{e.flowId.replace("FLOW_", "F")}</span>
              <span style={{ color: "var(--color-ink-soft)" }}>{e.actionId}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="lc-hud-card lc-mt-16">
        <h3 className="lc-hud-title">Backend / sidecar / social skeleton</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <li className="lc-hud-body">backend → {fakeBackendStatus.url} · {fakeBackendStatus.note}</li>
          <li className="lc-hud-body">sidecar → {fakeSidecarStatus.note}</li>
          <li className="lc-hud-body">social → Ayrshare key not wired in shell.</li>
        </ul>
      </div>

      <div className="lc-mt-16">
        <button type="button" className="lc-btn" data-variant="secondary" onClick={() => copyReport(report)}>
          Copy diagnostics report
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lc-hud-card">
      <span className="lc-hud-eyebrow">{label}</span>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, marginTop: 8 }}>{value}</div>
    </div>
  );
}

function buildReport(input: {
  version: string;
  commit: string;
  activeSection: string;
  overall: string;
  rows: ReturnType<typeof runHealthCheck>;
  events: ReturnType<typeof getRecentEvents>;
}): string {
  const lines: string[] = [
    "Liquid Clips 2.0 — diagnostics report (shell build)",
    `Version:        ${input.version}`,
    `Commit:         ${input.commit}`,
    `Active section: ${input.activeSection}`,
    `Overall health: ${input.overall}`,
    "",
    "Health rows:",
    ...input.rows.map((r) => `  [${r.status}] ${r.label} · ${r.detail} (real: ${r.realProbe})`),
    "",
    "Recent flow events:",
    ...input.events.map((e) => `  ${new Date(e.ts).toISOString()} ${e.flowId} ${e.actionId} [${e.status}]`),
  ];
  return lines.join("\n");
}

function copyReport(report: string) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(report).catch(() => undefined);
  }
}
