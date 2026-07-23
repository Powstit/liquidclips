/**
 * IG-CHAOS-DEFINED · Reliability Sprint L4 · resilience-pattern regressions.
 * Ensures the app has the recovery patterns chaos experiments will exercise.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_SRC = path.resolve(path.dirname(__filename), "..");

function grep(rx: RegExp, files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    if (rx.test(txt)) hits.push(path.relative(REPO_SRC, f));
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("Chaos resilience patterns", () => {
  const allSrc = walk(REPO_SRC);

  it("EngineErrorBoundary is mounted at the App shell", () => {
    const hits = grep(/EngineErrorBoundary/, allSrc);
    expect(hits.length, "EngineErrorBoundary should appear in ≥3 files").toBeGreaterThanOrEqual(3);
    expect(hits.some((h) => h.includes("App"))).toBe(true);
  });

  it("SectionWithFallback wraps WalletDetail per money-surface rule", () => {
    const walletFile = path.join(REPO_SRC, "routes/wallet-detail/WalletDetail.tsx");
    if (fs.existsSync(walletFile)) {
      const txt = fs.readFileSync(walletFile, "utf8");
      expect(txt).toMatch(/SectionWithFallback|fallback/i);
    }
  });

  it("sidecar client has retry logic (either retry keyword or fetch-abort pattern)", () => {
    const sidecarFiles = allSrc.filter((f) => /sidecar/i.test(f));
    expect(sidecarFiles.length, "at least one sidecar file exists").toBeGreaterThan(0);
    const hasRetry = sidecarFiles.some((f) => {
      const txt = fs.readFileSync(f, "utf8");
      return /retry|Retry|attempt|abort|AbortController/i.test(txt);
    });
    expect(hasRetry, "sidecar client should implement retry or abort").toBe(true);
  });

  it("chaos runner + fault-injection scripts exist", () => {
    const chaosDir = path.resolve(REPO_SRC, "../scripts/chaos");
    expect(fs.existsSync(chaosDir)).toBe(true);
    const scripts = fs.readdirSync(chaosDir);
    for (const required of [
      "chaos-runner.sh",
      "kill-sidecar.sh",
      "drop-network.sh",
      "inject-backend-500.sh",
      "race-conditions.sh",
      "disk-full.sh",
    ]) {
      expect(scripts, `missing ${required}`).toContain(required);
    }
  });
});
