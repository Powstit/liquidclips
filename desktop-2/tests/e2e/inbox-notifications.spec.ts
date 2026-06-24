/**
 * Inbox + Notifications Journey · USER-LENS AUTOMATION GATE · FEATURE-001
 *
 * Asserts the canonical inbox is the source of truth and that the Resend
 * email adapter is honest about its delivery state.
 *
 * Coverage:
 *   1. Trigger a notification via window.__lcInbox.notify()
 *   2. TopHud badge increments to 1
 *   3. Open the avatar menu → click Notifications → InboxSheet shows the
 *      record (title + body + kind)
 *   4. Mark all read → badge disappears
 *   5. Email-worthy event ("export-complete") creates an EmailDelivery
 *      sub-object. With no Resend backend configured, status MUST be
 *      "not_configured" — NEVER fake "sent".
 *   6. Non-email-worthy event ("reaction-bake-complete") creates a
 *      record with NO email metadata at all.
 *   7. With a deliberately-broken backend base, an email-worthy event
 *      transitions sending → failed (real fetch fails). Status is NOT
 *      faked sent.
 *   8. retryEmail("failed" record) re-attempts and lands honestly back
 *      on "failed" (still bad backend).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Inbox Notifications";

interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; }

class JourneyRecorder {
  private consoleErrors: string[] = [];
  private domAssertions: Record<string, unknown> = {};
  private currentStep = 0;
  constructor(private page: Page, private info: TestInfo) {
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    this.currentStep += 1;
    const n = this.currentStep;
    const label = `inb-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "PASS" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      return result;
    } catch (e) {
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "FAIL" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      throw e;
    }
  }
  assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  async finalize() {
    await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
    await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  }
}

async function interceptBackend(page: Page) {
  const me = {
    user: { id: "harness", email: "harness@test", tier: "solo" },
    tier: "solo", effective_tier: "solo", raw_tier: "solo",
  };
  const sync = { tier: "solo", caps: { watermarkLocked: false } };
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

/** Helper · poll a probe until it satisfies a condition or times out. */
async function waitFor<T>(probe: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 4_000, intervalMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await probe();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last!;
}

test.describe("Inbox Notifications Journey", () => {
  test(`${JOURNEY} · canonical store · honest Resend lifecycle · retry policy`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch app · seed JWT · clear inbox", async () => {
        await interceptBackend(page);
        await page.addInitScript(() => {
          try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
          // Pre-clear inbox storage so each run is deterministic.
          try { window.localStorage.removeItem("lc.inbox.messages.v1"); } catch {}
        });
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
        // Confirm the test seam is exposed.
        const hasSeam = await page.evaluate(() => {
          return typeof (window as unknown as { __lcInbox?: unknown }).__lcInbox === "object";
        });
        rec.assert("has_inbox_seam", hasSeam);
        expect(hasSeam).toBe(true);
      });

      await rec.step("Badge starts at 0 · no fake unread", async () => {
        await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toHaveCount(0);
        const unread = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { unreadCount: () => number } };
          return w.__lcInbox!.unreadCount();
        });
        rec.assert("initial_unread", unread);
        expect(unread).toBe(0);
      });

      await rec.step("Trigger 1 in-app event · badge increments to 1", async () => {
        await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { notify: (a: unknown) => unknown } };
          w.__lcInbox!.notify({
            kind: "reaction-bake-complete",
            title: "Reaction baked",
            body: "Harness-driven reaction event for the inbox journey.",
          });
        });
        // Badge becomes visible (count=1).
        await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toBeVisible({ timeout: 2_000 });
        const txt = await page.locator('[data-testid="avatar-orbit-badge"]').textContent();
        rec.assert("badge_after_one", txt);
        expect(txt).toBe("1");
      });

      await rec.step("Open avatar menu · Notifications · record renders", async () => {
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        await expect(page.locator('[data-testid="avatar-orbit-menu"]')).toBeVisible({ timeout: 2_000 });
        await page.locator('[data-testid="avatar-orbit-notifications"]').click();
        const overlay = page.locator('[data-testid="inbox-overlay"]');
        await expect(overlay).toBeVisible({ timeout: 2_000 });
        await expect(overlay).toHaveAttribute("data-inbox-message-count", "1");
        await expect(overlay).toHaveAttribute("data-inbox-unread-count", "1");
        // List must show the real record · NOT the legacy fixture titles.
        await expect(page.locator('[data-testid="inbox-list"]')).toBeVisible();
        await expect(page.locator('text=/Harness-driven reaction event/i').first()).toBeVisible();
        // No legacy 5-message seed leak.
        await expect(page.locator('text=/Uncle Daniel Audience Zero/i')).toHaveCount(0);
      });

      await rec.step("Mark all read · badge disappears · DOM reflects 0 unread", async () => {
        await page.locator('[data-testid="inbox-mark-all-read"]').click();
        const overlay = page.locator('[data-testid="inbox-overlay"]');
        await expect(overlay).toHaveAttribute("data-inbox-unread-count", "0");
        await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toHaveCount(0);
        // Close sheet.
        await page.locator('.lc-inbox-close').click();
        await expect(overlay).toHaveCount(0);
      });

      await rec.step("Email-worthy event with no Resend base → status MUST be 'not_configured'", async () => {
        // No window.__lcEmailBase set + no VITE_NOTIFICATIONS_API_BASE in
        // the test env. Adapter must report "not_configured", NEVER fake "sent".
        const id = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { notify: (a: unknown) => { id: string } } };
          return w.__lcInbox!.notify({
            kind: "export-complete",
            title: "Export complete (harness)",
            body: "Email-worthy event without a backend configured.",
          }).id;
        });
        rec.assert("export_record_id", id);

        // Poll until the adapter terminal state lands.
        const final = await waitFor(
          () => page.evaluate((eid) => {
            const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string } }> } };
            const r = w.__lcInbox!.getAll().find((x) => x.id === eid);
            return r?.email?.status ?? null;
          }, id),
          (v) => v === "not_configured" || v === "failed" || v === "sent",
          4_000,
        );
        rec.assert("export_email_status", final);
        expect(final).toBe("not_configured");
      });

      await rec.step("Non-email-worthy event has NO email metadata", async () => {
        const rec1 = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { notify: (a: unknown) => { id: string }; getAll: () => Array<{ id: string; email?: unknown }> } };
          const r = w.__lcInbox!.notify({
            kind: "caption-apply-complete",
            title: "Captions ready (harness)",
            body: "Should NOT have email metadata.",
          });
          const full = w.__lcInbox!.getAll().find((x) => x.id === r.id);
          return { id: r.id, hasEmail: full?.email != null };
        });
        rec.assert("caption_no_email", rec1);
        expect(rec1.hasEmail).toBe(false);
      });

      await rec.step("Broken backend → sending → failed (no fake sent)", async () => {
        // Point the adapter at a deliberately-unroutable host so the
        // browser's fetch resolves to an error. The harness can't easily
        // make the dev server return 500 for an arbitrary path · but a
        // host that refuses connections gives us a real "failed" state.
        await page.evaluate(() => {
          (window as unknown as { __lcEmailBase: string }).__lcEmailBase = "http://127.0.0.1:1"; // closed port
        });
        const id = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { notify: (a: unknown) => { id: string } } };
          return w.__lcInbox!.notify({
            kind: "export-failed",
            title: "Export failed (harness)",
            body: "Email-worthy + bad backend → must land on 'failed'.",
          }).id;
        });
        const status = await waitFor(
          () => page.evaluate((eid) => {
            const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string; attempts: number } }> } };
            const r = w.__lcInbox!.getAll().find((x) => x.id === eid);
            return r?.email ?? null;
          }, id),
          (v) => v != null && (v.status === "failed" || v.status === "sent" || v.status === "not_configured"),
          6_000,
        );
        rec.assert("broken_backend_email", status);
        expect(status?.status).toBe("failed");
        expect(status?.attempts).toBeGreaterThanOrEqual(1);
        // Persist the id for the next step.
        await page.evaluate((eid) => { (window as unknown as { __lcFailedId: string }).__lcFailedId = eid; }, id);
      });

      await rec.step("Retry failed email → re-attempts honestly · still 'failed' (backend still broken)", async () => {
        const attemptsBefore = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string; attempts: number } }> }; __lcFailedId: string };
          const r = w.__lcInbox!.getAll().find((x) => x.id === w.__lcFailedId);
          return r?.email?.attempts ?? 0;
        });
        await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { retryEmail: (id: string) => Promise<void> }; __lcFailedId: string };
          void w.__lcInbox!.retryEmail(w.__lcFailedId);
        });
        const after = await waitFor(
          () => page.evaluate(() => {
            const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string; attempts: number } }> }; __lcFailedId: string };
            const r = w.__lcInbox!.getAll().find((x) => x.id === w.__lcFailedId);
            return r?.email ?? null;
          }),
          (v) => v != null && v.attempts > attemptsBefore && (v.status === "failed" || v.status === "sent"),
          6_000,
        );
        rec.assert("retry_email", { before: attemptsBefore, after });
        expect(after?.attempts).toBeGreaterThan(attemptsBefore);
        expect(after?.status).toBe("failed");
      });

      await rec.step("Retry policy · calling retryEmail on a 'not_configured' record is a no-op", async () => {
        // Clear seam first so adapter returns to "not_configured" mode.
        await page.evaluate(() => {
          delete (window as unknown as { __lcEmailBase?: string }).__lcEmailBase;
        });
        const id = await page.evaluate(() => {
          const w = window as unknown as { __lcInbox?: { notify: (a: unknown) => { id: string } } };
          return w.__lcInbox!.notify({
            kind: "tier-warning",
            title: "Tier warning (harness)",
            body: "Email-worthy · no backend · should land on not_configured.",
          }).id;
        });
        const initial = await waitFor(
          () => page.evaluate((eid) => {
            const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string; attempts: number } }> } };
            const r = w.__lcInbox!.getAll().find((x) => x.id === eid);
            return r?.email ?? null;
          }, id),
          (v) => v != null && v.status === "not_configured",
          4_000,
        );
        expect(initial?.status).toBe("not_configured");
        const initialAttempts = initial!.attempts;

        // Call retry · spec says retry is only for "failed", so this should
        // be a no-op (no extra attempt).
        await page.evaluate((eid) => {
          const w = window as unknown as { __lcInbox?: { retryEmail: (id: string) => Promise<void> } };
          void w.__lcInbox!.retryEmail(eid);
        }, id);
        // Wait long enough to confirm no transition fires.
        await page.waitForTimeout(500);
        const after = await page.evaluate((eid) => {
          const w = window as unknown as { __lcInbox?: { getAll: () => Array<{ id: string; email?: { status: string; attempts: number } }> } };
          const r = w.__lcInbox!.getAll().find((x) => x.id === eid);
          return r?.email ?? null;
        }, id);
        rec.assert("retry_noop_on_not_configured", { before: initialAttempts, after });
        expect(after?.status).toBe("not_configured");
        expect(after?.attempts).toBe(initialAttempts);
      });
    } finally {
      await rec.finalize();
    }
  });
});
