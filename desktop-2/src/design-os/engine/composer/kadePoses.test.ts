/**
 * IG-COMPOSER-N regression guard · Kade pose registry contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E2.
 *
 * Enforces:
 *   1. The IG-COMPOSER-N sentinel stays in place.
 *   2. Every pose in POSES resolves to a real file in public/brand/kade/.
 *   3. setPose(pose, text) fires the "kade:pose" bus event.
 *   4. Unknown poses coerce to "idle" (never return a broken URL).
 *   5. The bus event schema includes "kade:pose".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { POSES, posePath, setPose } from "./kadePoses";
import { bus } from "../../bridge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "kadePoses.ts"), "utf-8");
const EVENTS_SRC = readFileSync(
  resolve(__dirname, "..", "..", "bridge", "events.ts"),
  "utf-8",
);
const PUBLIC_DIR = resolve(__dirname, "..", "..", "..", "..", "public");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IG-COMPOSER-N · Kade pose registry contract", () => {
  it("kadePoses.ts contains the IG-COMPOSER-N sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-N/);
  });

  it("events.ts declares the kade:pose bus event schema", () => {
    expect(EVENTS_SRC).toMatch(/"kade:pose":\s*\{\s*pose:\s*string;\s*statusText\?:\s*string\s*\}/);
  });

  it("every pose in POSES resolves to a real asset on disk", () => {
    for (const [id, path] of Object.entries(POSES)) {
      // path is "/brand/kade/kade-idle.webp" — strip leading slash for fs
      const onDisk = resolve(PUBLIC_DIR, path.replace(/^\//, ""));
      expect(existsSync(onDisk), `pose "${id}" points at missing asset ${path}`).toBe(true);
    }
  });

  it("posePath returns the mapped path for known poses", () => {
    expect(posePath("idle")).toBe(POSES.idle);
    expect(posePath("success")).toBe(POSES.success);
  });

  it("posePath falls back to idle for unknown poses", () => {
    expect(posePath("this-pose-does-not-exist")).toBe(POSES.idle);
  });

  it("setPose fires the kade:pose bus event", () => {
    const spy = vi.spyOn(bus, "emit");
    setPose("success", "Shipped");
    expect(spy).toHaveBeenCalledWith("kade:pose", { pose: "success", statusText: "Shipped" });
  });

  it("setPose coerces unknown poses to idle when emitting", () => {
    const spy = vi.spyOn(bus, "emit");
    setPose("this-pose-does-not-exist");
    expect(spy).toHaveBeenCalledWith("kade:pose", { pose: "idle", statusText: undefined });
  });
});
