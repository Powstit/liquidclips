/**
 * IG-SERVER-HEALTH-DOT · Reliability Sprint L3 (H0-03) · 2026-07-22
 * Source-invariant test (matches LC test style) locking the code
 * paths so a future refactor cannot silently remove the health check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "ServerHealthDot.tsx"), "utf-8");
const HUD = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");

describe("IG-SERVER-HEALTH-DOT · backend visibility contract", () => {
  it("component source carries the IG sentinel", () => {
    expect(SRC).toMatch(/IG-SERVER-HEALTH-DOT/);
  });

  it("polls /healthcheck (not a fake / hardcoded status)", () => {
    expect(SRC).toMatch(/\/healthcheck/);
  });

  it("defines all 4 states: grey · green · amber · red", () => {
    expect(SRC).toMatch(/"grey"/);
    expect(SRC).toMatch(/"green"/);
    expect(SRC).toMatch(/"amber"/);
    expect(SRC).toMatch(/"red"/);
  });

  it("red or amber state routes the user to Diagnostic Center on click", () => {
    expect(SRC).toMatch(/window\.location\.hash = "#\/diagnostics"/);
  });

  it("consecutive failures escalate amber → red at threshold 3", () => {
    expect(SRC).toMatch(/failures >= 3/);
  });

  it("60s poll interval matches the SystemMap probe cadence", () => {
    expect(SRC).toMatch(/60_000|60000/);
  });

  it("has a 5s probe timeout so a hung Railway can't stall the dot", () => {
    expect(SRC).toMatch(/AbortController|abort\(\)/);
    expect(SRC).toMatch(/5_000|5000/);
  });

  it("emits data-testid=server-health-dot for e2e discovery", () => {
    expect(SRC).toMatch(/data-testid="server-health-dot"/);
  });

  it("TopHud mounts the ServerHealthDot alongside WhopStatusChip", () => {
    expect(HUD).toMatch(/import\s*\{\s*ServerHealthDot\s*\}/);
    expect(HUD).toMatch(/<ServerHealthDot\s*\/>/);
  });

  it("component reads VITE_BACKEND_URL so dev + prod both work", () => {
    expect(SRC).toMatch(/VITE_BACKEND_URL/);
  });
});
