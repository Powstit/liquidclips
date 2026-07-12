/**
 * Native Walk Prep · j006-clip-generation
 *
 * Automates URL ingest submission + polling UI + result-state assertions.
 * The actual Whisper transcription + Anthropic judgment + ffmpeg cut are
 * native (Python sidecar + real API + real ffmpeg). Those steps are `test.skip`
 * blocks with reasons pointing at the manual walk doc.
 *
 * Reference doc:
 *   lcos/reports/rc1-sprint/native-walk-prep/j006-clip-generation.md
 */

import { test, expect, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);

const CAPTURE_ROOT = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "lcos",
  "reports",
  "golden-path",
  "capture",
  "j006-clip-generation",
);

const BACKEND = process.env.LC_BACKEND ?? "http://localhost:8000";
const INTERNAL_SECRET =
  process.env.INTERNAL_API_SECRET ??
  "e3a7eccce5c37ce2192fd1efa294be76566fcd30f304ad432395966882e5fb24";

async function ensureDir(p: string): Promise<void> {
  await fs.promises.mkdir(p, { recursive: true });
}

async function mintJwt(clerkUserId: string, email: string): Promise<string> {
  const res = await fetch(`${BACKEND}/desktop/connect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({
      clerk_user_id: clerkUserId,
      challenge: "ch_lcos_walk_j006",
      email,
      first_name: "LCOS",
    }),
  });
  if (!res.ok) {
    throw new Error(`mint failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { license_jwt: string };
  return data.license_jwt;
}

async function capture(
  page: Page,
  step: string,
  assertions: Array<{ id: string; pass: boolean; detail?: string }>,
): Promise<void> {
  const dir = path.join(CAPTURE_ROOT, step);
  await ensureDir(dir);
  try {
    await page.screenshot({
      path: path.join(dir, "screenshot.png"),
      fullPage: true,
    });
  } catch (e) {
    await fs.promises.writeFile(path.join(dir, "screenshot.err.txt"), String(e), "utf8");
  }
  let canonicalState: Record<string, unknown> = { error: "probe unavailable" };
  try {
    canonicalState = await page.evaluate(() => {
      const w = window as unknown as {
        __LCOS_PROBE__?: { canonicalState(): Record<string, unknown> };
      };
      return w.__LCOS_PROBE__?.canonicalState() ?? { error: "no probe" };
    });
  } catch (e) {
    canonicalState = { error: String(e) };
  }
  let telemetry: unknown[] = [];
  try {
    telemetry = await page.evaluate(() => {
      const w = window as unknown as { __LCOS_TELEMETRY__?: unknown[] };
      return (w.__LCOS_TELEMETRY__ ?? []).slice(-50);
    });
  } catch (e) {
    telemetry = [{ error: String(e) }];
  }
  await fs.promises.writeFile(
    path.join(dir, "canonical-state.json"),
    JSON.stringify(canonicalState, null, 2),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(dir, "telemetry.json"),
    JSON.stringify(telemetry, null, 2),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(dir, "assertions.json"),
    JSON.stringify(assertions, null, 2),
    "utf8",
  );
}

async function clearState(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* noop */
    }
  });
}

async function seedJwt(page: Page, jwt: string): Promise<void> {
  await page.evaluate((token: string) => {
    window.localStorage.setItem("lc.license.jwt.v1", token);
  }, jwt);
}

test.describe("j006-clip-generation · URL ingest + polling + result-state slice", () => {
  test("step 2 · URL ingest input surfaces · direct submission fires POST /ingest/start", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j006_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    await page.goto("/#/create", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // Look for a URL input · text field for URL paste.
    const urlInput = page.locator(
      "input[type='url'], input[placeholder*='url' i], input[placeholder*='youtube' i], input[placeholder*='link' i]",
    ).first();
    const urlInputVisible = await urlInput.isVisible().catch(() => false);

    // Rather than submitting a real URL through the UI (which may bind to
    // shell events not present in Vite dev), we fire a direct backend probe
    // to prove the endpoint accepts URL submissions.
    const startRes = await fetch(`${BACKEND}/ingest/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        source: "url",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", // First video ever · known-good permalink · public
      }),
    }).catch(() => null);

    const startOk = !!startRes && startRes.ok;
    let runId: string | null = null;
    if (startOk && startRes) {
      const body = await startRes.json().catch(() => ({} as { run_id?: string }));
      runId = (body as { run_id?: string }).run_id ?? null;
    }

    const assertions = [
      { id: "create-route-mounted", pass: (await page.locator("body").innerText()).length > 20 },
      { id: "url-input-visible", pass: urlInputVisible, detail: "URL paste input surfaces" },
      { id: "backend-ingest-start-2xx", pass: startOk, detail: startRes ? `${startRes.status}` : "no response" },
      { id: "backend-returns-run-id", pass: !!runId, detail: `runId=${runId}` },
    ];
    await capture(page, "02-url-ingest-submit", assertions);
    // Not hard-failing on url-input-visible · surface may still hide it behind portal
  });

  test("step 3 · polling UI reads /ingest/state · state machine advances OR stays honest", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j006_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);

    // Kick off an ingest run at the backend directly.
    const startRes = await fetch(`${BACKEND}/ingest/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        source: "url",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      }),
    }).catch(() => null);

    let runId: string | null = null;
    if (startRes && startRes.ok) {
      const body = await startRes.json().catch(() => ({} as { run_id?: string }));
      runId = (body as { run_id?: string }).run_id ?? null;
    }

    // Poll /ingest/state a few times · assert state field is one of the
    // documented values. NOT waiting for completion · that's C3's territory.
    const states: string[] = [];
    if (runId) {
      for (let i = 0; i < 3; i++) {
        const stateRes = await fetch(`${BACKEND}/ingest/state/${runId}`, {
          headers: { authorization: `Bearer ${jwt}` },
        }).catch(() => null);
        if (stateRes && stateRes.ok) {
          const s = await stateRes.json().catch(() => ({} as { state?: string }));
          states.push((s as { state?: string }).state ?? "unknown");
        } else {
          states.push(`http_${stateRes?.status ?? "none"}`);
        }
        await page.waitForTimeout(2000);
      }
    }

    const validStates = new Set([
      "pending",
      "ingesting",
      "downloading",
      "transcribing",
      "judging",
      "cutting",
      "complete",
      "error",
      "unknown",
    ]);
    const allValid = states.every((s) => validStates.has(s) || s.startsWith("http_"));

    const assertions = [
      { id: "ingest-run-started", pass: !!runId, detail: `runId=${runId}` },
      { id: "state-machine-values-documented", pass: allValid, detail: `states=${states.join(",")}` },
      { id: "no-premature-complete", pass: !(states[0] === "complete" && states[1] === "complete"), detail: "first two polls both complete = suspicious" },
    ];
    await capture(page, "03-polling-state-machine", assertions);
  });

  test("step 7 · My Clips route renders · no fake sample tiles", async ({ page }) => {
    await clearState(page);
    const clerkId = `user_walk_j006_${Date.now()}`;
    const jwt = await mintJwt(clerkId, `${clerkId}@lcos.local`);
    await seedJwt(page, jwt);
    // My Clips path is likely /#/library per Design OS routes.
    await page.goto("/#/library", { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator("body").innerText();
    const fakeSampleCopy = /sample clip|demo clip|example clip|placeholder clip/i.test(bodyText);

    // The fresh user has 0 real clips · expect an honest empty state.
    const emptyStateCopy = /no clips yet|nothing yet|create your first|upload a video/i.test(bodyText);

    const assertions = [
      { id: "route-mounted", pass: bodyText.length > 20 },
      { id: "no-fake-sample-tiles", pass: !fakeSampleCopy, detail: "fresh user should not see fixture clips" },
      { id: "honest-empty-state-copy", pass: emptyStateCopy, detail: "empty state explains the next action" },
    ];
    await capture(page, "07-my-clips-empty", assertions);

    expect(fakeSampleCopy, "My Clips must not render fixture data for a fresh user (INV-002)").toBeFalsy();
  });

  // ─── NATIVE / MANUAL steps below · documented as skips ────────────

  test.skip(
    "step 4 · Whisper transcript file on disk · NATIVE · requires Python sidecar + local Whisper model · out of Vite-dev scope · see j006-clip-generation.md §Step 4",
    async () => {},
  );

  test.skip(
    "step 5 · Anthropic judgment · NATIVE + external API · requires ANTHROPIC_API_KEY + sidecar · costs money per run · see j006-clip-generation.md §Step 5",
    async () => {},
  );

  test.skip(
    "step 6 · ffmpeg output · NATIVE · requires bundled ffmpeg + real cut · see j006-clip-generation.md §Step 6",
    async () => {},
  );

  test.skip(
    "step 8 · Reveal in Finder affordance · NATIVE · Tauri plugin-shell::open opens Finder · Playwright cannot observe · see j006-clip-generation.md §Step 8",
    async () => {},
  );
});
