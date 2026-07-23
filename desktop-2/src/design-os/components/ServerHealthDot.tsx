/**
 * ServerHealthDot · Reliability Sprint L3 (H0-03) · 2026-07-22
 *
 * A tiny colored dot in the TopHud that reads real backend health.
 * Polls `/healthcheck` every 60s. States:
 *   - "green"  → last probe was 200 within the last 90s
 *   - "amber"  → last probe was ≥1 failure within 3 checks
 *   - "red"    → last 3 probes failed
 *   - "grey"   → still probing (cold boot)
 *
 * Nielsen H1 (Visibility of system status): user needs a persistent
 * signal that the backend is reachable. When Railway is down every
 * tile silently fails — this dot is the "canary in the coal mine."
 *
 * Non-intrusive · 8px dot with hover tooltip · click for details.
 *
 * IG-SERVER-HEALTH-DOT
 */

import { useEffect, useState, useCallback } from "react";

type Status = "grey" | "green" | "amber" | "red";

interface ProbeState {
  status: Status;
  lastOkAt: number | null;
  consecutiveFailures: number;
  lastLatencyMs: number | null;
}

const POLL_MS = 60_000;
const RECENT_MS = 90_000;
const TIMEOUT_MS = 5_000;

function backendBase(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    return env?.VITE_BACKEND_URL ?? "https://api.liquidclips.app";
  } catch {
    return "https://api.liquidclips.app";
  }
}

export function ServerHealthDot(): React.ReactElement {
  const [state, setState] = useState<ProbeState>({
    status: "grey",
    lastOkAt: null,
    consecutiveFailures: 0,
    lastLatencyMs: null,
  });

  const probe = useCallback(async () => {
    const base = backendBase();
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/healthcheck`, { signal: ctl.signal });
      const latency = Date.now() - started;
      if (res.ok) {
        setState({
          status: "green",
          lastOkAt: Date.now(),
          consecutiveFailures: 0,
          lastLatencyMs: latency,
        });
        return;
      }
      setState((prev) => {
        const failures = prev.consecutiveFailures + 1;
        return {
          ...prev,
          status: failures >= 3 ? "red" : "amber",
          consecutiveFailures: failures,
          lastLatencyMs: latency,
        };
      });
    } catch {
      setState((prev) => {
        const failures = prev.consecutiveFailures + 1;
        return {
          ...prev,
          status: failures >= 3 ? "red" : "amber",
          consecutiveFailures: failures,
        };
      });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    void probe();
    const id = window.setInterval(() => void probe(), POLL_MS);
    return () => window.clearInterval(id);
  }, [probe]);

  const label =
    state.status === "green"
      ? `Server healthy${state.lastLatencyMs ? ` · ${state.lastLatencyMs}ms` : ""}`
      : state.status === "amber"
        ? "Server responding slowly · will retry"
        : state.status === "red"
          ? "Server unreachable · check your connection"
          : "Checking server status...";

  const color =
    state.status === "green"
      ? "#20d17e"
      : state.status === "amber"
        ? "#f59e0b"
        : state.status === "red"
          ? "#ff5a5a"
          : "#7a7770";

  const onClick = () => {
    // Take the user somewhere useful when the dot is red — Diagnostic
    // Center exposes the raw probe log + last error message.
    if (state.status === "red" || state.status === "amber") {
      window.location.hash = "#/diagnostics";
    }
  };

  const isRecent =
    state.lastOkAt !== null && Date.now() - state.lastOkAt < RECENT_MS;

  return (
    <button
      type="button"
      className="lc-server-health-dot"
      data-testid="server-health-dot"
      data-status={state.status}
      data-recent={isRecent ? "1" : "0"}
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        padding: 0,
        border: 0,
        borderRadius: "50%",
        background: "transparent",
        cursor: state.status === "green" ? "default" : "pointer",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}55`,
        }}
      />
    </button>
  );
}
