// Liquid Clips 2.0 — health check skeleton.
// Returns typed fake results so the Diagnostics section can render the shape
// of a real probe report. Real probes (sidecar handshake, backend ping,
// social ping) install behind contracts later.

export type HealthStatus = "ok" | "warning" | "critical";

export interface HealthRow {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
  /** True once the surface is wired to a real probe. False = skeleton. */
  realProbe: boolean;
}

export function runHealthCheck(): HealthRow[] {
  return [
    {
      id: "shell.boot",
      label: "Shell boot",
      status: "ok",
      detail: "App mounted without side effects.",
      realProbe: true,
    },
    {
      id: "sidecar.handshake",
      label: "Python sidecar",
      status: "warning",
      detail: "Skeleton — no probe wired yet.",
      realProbe: false,
    },
    {
      id: "backend.ping",
      label: "Backend reachability",
      status: "warning",
      detail: "Skeleton — no probe wired yet.",
      realProbe: false,
    },
    {
      id: "social.status",
      label: "Social publisher",
      status: "warning",
      detail: "Skeleton — Ayrshare not wired.",
      realProbe: false,
    },
    {
      id: "keychain.passive",
      label: "Keychain passive-read guard",
      status: "ok",
      detail: "No keychain reads on mount (shell contract).",
      realProbe: true,
    },
    {
      id: "panel.global",
      label: "Global right-side panel guard",
      status: "ok",
      detail: "Shell forbids a persistent global panel.",
      realProbe: true,
    },
  ];
}

export function rollUp(rows: HealthRow[]): HealthStatus {
  if (rows.some((r) => r.status === "critical")) return "critical";
  if (rows.some((r) => r.status === "warning")) return "warning";
  return "ok";
}
