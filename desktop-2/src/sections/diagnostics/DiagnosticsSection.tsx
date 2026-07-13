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
import { buildSafeErrorReport, readRecentSafeErrors } from "../../design-os/errors/customerSafeErrors";
// BUG-007 sweep · Wave B1 · runtime-truth (2026-07-12) — Diagnostics is
// the primary "tell us your version" surface. Previously read the
// build-time `__APP_VERSION__` constant, which stayed pinned to the
// shell version even after a runtime bundle hot-swap. Now reads the
// canonical `useRuntimeVersion()` hook so support tickets get the truth.
import { useRuntimeVersion } from "../../lib/useRuntimeVersion";

const COMMIT_PLACEHOLDER =
  (import.meta as { env?: { VITE_GIT_SHA?: string } }).env?.VITE_GIT_SHA ?? "local";

export function DiagnosticsSection() {
  const activeSection = useHashRoute();
  const [, setTick] = useState(0);
  // BUG-007 sweep · Wave B1 — runtime-bundle version (falls back to
  // shell when Tauri IPC is unavailable). Replaces the
  // `VERSION_PLACEHOLDER` constant that read the build-time global.
  const runtimeVersion = useRuntimeVersion();
  const VERSION_PLACEHOLDER = runtimeVersion.version;

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
    // BUG-007 sweep · include the runtime version in the memo key so a
    // mid-session `lc:runtime-staged` promotion re-generates the report
    // with the new active version.
    [VERSION_PLACEHOLDER, activeSection, overall, rows, events]
  );

  // 2026-07-09 · customer-safe error ring · last ≤32 classified errors
  //   the user actually saw. Rendered as its own panel + appended to
  //   the copy-report button so support gets both the technical logs
  //   AND what the user saw, in one paste.
  const safeErrors = useMemo(() => readRecentSafeErrors(), [events]);
  const safeErrorReport = useMemo(() => buildSafeErrorReport(), [events]);
  const combinedReport = useMemo(
    () => `${report}\n\n${safeErrorReport}`,
    [report, safeErrorReport],
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

      {/* 2026-07-09 · Recent customer-safe errors — same copy the user
          saw + short technical detail. Empty in healthy sessions;
          appears the moment any surface fires humanErrorToast(). */}
      {safeErrors.length > 0 && (
        <div className="lc-hud-card lc-mt-16">
          <h3 className="lc-hud-title">Recent errors (customer-safe view)</h3>
          <p className="lc-hud-body" style={{ fontSize: 12 }}>
            Last {safeErrors.length} classified user-facing errors — same copy the user saw.
          </p>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {safeErrors.map((e, i) => (
              <div key={i} className="lc-hud-body" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                <span style={{ color: "var(--color-text-tertiary)" }}>
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                {" · "}
                <span style={{ color: "var(--color-fuchsia-deep)" }}>{e.code}</span>
                {" · "}
                <span>{e.title}</span>
                {e.technical && (
                  <div style={{ color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    tech: {e.technical.slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="lc-mt-16">
        <button type="button" className="lc-btn" data-variant="secondary" onClick={() => copyReport(combinedReport)}>
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
