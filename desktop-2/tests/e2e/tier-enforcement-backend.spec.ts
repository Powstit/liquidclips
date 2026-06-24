/**
 * Tier Enforcement (Backend) Journey · USER-LENS AUTOMATION GATE · TASK 3
 *
 * Wraps the FastAPI pytest suite in `junior-backend/tests/
 * test_tier_enforcement.py` so the 5 server-side tier limits enforce-
 * ment lives in the same `verify-app overall GREEN` gate as every
 * other journey.
 *
 * The pytest suite proves (in-memory SQLite + TestClient · no network):
 *   1. channels-per-platform   · POST /channels
 *   2. monthly-posts           · POST /schedules + POST /publish-now
 *   3. campaigns-per-brand     · POST /agency/campaigns
 *   4. clips-per-campaign      · POST /submissions
 *   5. bulk-scheduling-rows    · POST /schedules/drip-batch
 *
 * Plus a contract test that locks the `app/features.py:TIER_LIMITS`
 * matrix to the numbers the client advertises in
 * `desktop-2/src/design-os/state/useTierCaps.ts`.
 *
 * The journey passes when pytest exits 0; fails otherwise. The pytest
 * stdout / exit code lands in the journey verdict json so a regression
 * surfaces with the actual failure list, not just a status flip.
 */
import { test, expect, type TestInfo } from "@playwright/test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JOURNEY = "Tier Enforcement Backend";
const BACKEND_ROOT = path.resolve(__dirname, "..", "..", "..", "junior-backend");
const VENV_PY = path.join(BACKEND_ROOT, ".venv", "bin", "python");
const TEST_PATH = "tests/test_tier_enforcement.py";

test.describe("Tier Enforcement Backend Journey", () => {
  test(`${JOURNEY} · 5 server-side tier limits + matrix contract`, async ({}, testInfo: TestInfo) => {
    /* Sanity: pytest + the backend venv must exist. If either is
     * missing the journey fails noisily — we never want to skip-pass. */
    expect(fs.existsSync(VENV_PY), `backend venv missing: ${VENV_PY}`).toBe(true);
    expect(fs.existsSync(path.join(BACKEND_ROOT, TEST_PATH)), `pytest file missing: ${TEST_PATH}`).toBe(true);

    const result = spawnSync(VENV_PY, ["-m", "pytest", TEST_PATH, "-v", "--tb=short"], {
      cwd: BACKEND_ROOT,
      encoding: "utf8",
      env: { ...process.env, JUNIOR_ADMIN_EMAILS: "nobody-real@test.invalid" },
      timeout: 180_000,
    });

    const stdoutTail = (result.stdout ?? "").split("\n").slice(-30).join("\n");
    const stderrTail = (result.stderr ?? "").split("\n").slice(-30).join("\n");

    await testInfo.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await testInfo.attach("pytest-stdout-tail", { body: Buffer.from(stdoutTail), contentType: "text/plain" });
    await testInfo.attach("pytest-stderr-tail", { body: Buffer.from(stderrTail), contentType: "text/plain" });
    await testInfo.attach("lc:assertions", { body: Buffer.from(JSON.stringify({
      pytest_exit_code: result.status,
      pytest_signal: result.signal,
      stdout_lines: (result.stdout ?? "").split("\n").length,
    }, null, 2)), contentType: "application/json" });

    /* Aggregate verdict. pytest exits 0 when every test passes.
     * Anything non-zero is a hard fail — relay the tail so the failure
     * is debuggable from the verdict json alone. */
    expect(
      result.status,
      `pytest exited ${result.status}\n--- stdout tail ---\n${stdoutTail}\n--- stderr tail ---\n${stderrTail}`,
    ).toBe(0);
  });
});
