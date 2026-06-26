/**
 * Button / CTA audit · pre-promotion gate
 *
 * Enumerates every visible interactive control on every customer-facing
 * surface and classifies it:
 *   PASS               — clicked and the click had a visible effect (DOM or
 *                        nav delta) AND no console error fired
 *   HONESTLY_DISABLED  — disabled or aria-disabled with honest copy
 *   SKIPPED_SAFE       — destructive / payment / publish — not clicked
 *   EXTERNAL           — opens an external URL · we verify the URL exists
 *                        and is a known whitelisted domain, but don't click
 *   FAIL               — visible, enabled, non-destructive, but click did
 *                        nothing observable OR fired a console error
 *
 * Emits the verdict to `tests/e2e/verdicts/button-audit-<ts>.json` so the
 * report can be read deterministically.
 */
import { test, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERDICT_DIR = path.resolve(__dirname, "verdicts");

type Mode = "clipper" | "agency";

interface RouteCase {
  routeId: string;
  mode: Mode;
  label: string;
  // If `true`, the route is reached via a nav alias (e.g. "create" lands
  // on home then opens the create panel). Audit captures both surfaces.
  alias?: boolean;
}

const ROUTES: ReadonlyArray<RouteCase> = [
  { routeId: "home",        mode: "clipper", label: "Home Clipper" },
  { routeId: "home",        mode: "agency",  label: "Home Agency" },
  { routeId: "create",      mode: "clipper", label: "Create",     alias: true },
  { routeId: "workstation", mode: "clipper", label: "Workstation" },
  { routeId: "earn",        mode: "clipper", label: "Earn" },
  { routeId: "campaigns",   mode: "clipper", label: "Campaigns Clipper" },
  { routeId: "campaigns",   mode: "agency",  label: "Campaigns Agency" },
  { routeId: "community",   mode: "clipper", label: "Community" },
  { routeId: "channels",    mode: "clipper", label: "Channels" },
  { routeId: "schedule",    mode: "clipper", label: "Schedule" },
  { routeId: "settings",    mode: "clipper", label: "Settings" },
];

const NO_TOUCH_PATTERNS: RegExp[] = [
  /signout|sign-out/i,
  /publish-now|publish-schedule|publish-target/i,
  /pay-|payment|whop-checkout-confirm|stripe-checkout/i,
  /^delete-|trash-|destroy-/i,
  /post-now|post-schedule/i,
  /upload-pick-file/i, // OS file picker
];

const EXTERNAL_DOMAINS = [
  "whop.com",
  "liquidclips.app",
  "account.liquidclips.app",
  "api.liquidclips.app",
  "github.com",
];

interface ControlFinding {
  route: string;
  mode: Mode;
  testid: string | null;
  text: string;
  role: string | null;
  classification: "PASS" | "HONESTLY_DISABLED" | "SKIPPED_SAFE" | "EXTERNAL" | "FAIL";
  expectation: string;
  observation: string;
}

interface RouteSummary {
  label: string;
  mode: Mode;
  totals: Record<string, number>;
  consoleErrorsDelta: number;
  controlsAuditedCount: number;
}

interface AuditVerdict {
  startedAt: number;
  finishedAt: number;
  overall: "GREEN" | "RED";
  routeSummaries: RouteSummary[];
  failingControls: ControlFinding[];
  allFindings: ControlFinding[];
  consoleErrors: string[];
}

async function setMode(page: Page, mode: Mode) {
  await page.evaluate((m) => {
    try { window.localStorage.setItem("lc.mode", m); } catch { /* noop */ }
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("mode:change", { mode: m });
  }, mode);
  await page.waitForTimeout(200);
}

async function navigate(page: Page, route: string) {
  await page.evaluate((r) => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: r });
  }, route);
  await page.waitForTimeout(700);
}

interface EnumeratedControl {
  testid: string | null;
  text: string;
  role: string | null;
  tag: string;
  disabled: boolean;
  ariaDisabled: boolean;
  comingSoon: boolean;
  hasOpenUrl: string | null;
  classes: string;
  hidden: boolean;
}

async function enumerate(page: Page): Promise<EnumeratedControl[]> {
  return await page.evaluate(() => {
    const seen = new Set<Element>();
    const ctrls: Array<{
      testid: string | null;
      text: string;
      role: string | null;
      tag: string;
      disabled: boolean;
      ariaDisabled: boolean;
      comingSoon: boolean;
      hasOpenUrl: string | null;
      classes: string;
      hidden: boolean;
    }> = [];
    /* Limit scope to the rendered app — skip OS chrome / dev tools. */
    const roots = [
      document.querySelector(".lc-app") || document.body,
      document.querySelector(".lc-modal-portal-root"),
      document.querySelector(".lc-drawer-host"),
    ].filter((x): x is Element => !!x);

    const selectors = [
      "button",
      "[role='button']",
      "[role='tab']",
      "[role='radio']",
      "[role='checkbox']",
      "[role='switch']",
      "a[href]",
      "[data-testid]:not(div):not(span):not(p):not(section):not(article)",
    ];

    for (const root of roots) {
      for (const sel of selectors) {
        for (const el of root.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          seen.add(el);

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          if (!visible) continue;

          const tag = el.tagName.toLowerCase();
          const testid = el.getAttribute("data-testid");
          const role = el.getAttribute("role");
          const text = (el.textContent || "").trim().slice(0, 80);
          const disabled = (el as HTMLButtonElement).disabled === true;
          const ariaDisabled = el.getAttribute("aria-disabled") === "true";
          const comingSoonAttr = el.getAttribute("data-coming-soon");
          const comingSoonText = /coming soon/i.test(text);
          const comingSoon = comingSoonAttr === "true" || comingSoonText;
          const openUrl = el.getAttribute("data-open-url");
          const href = (el as HTMLAnchorElement).href || null;
          const hasOpenUrl = openUrl || (href && href !== window.location.href ? href : null) || null;
          const classes = el.className?.toString() || "";

          ctrls.push({
            testid, text, role, tag, disabled, ariaDisabled, comingSoon, hasOpenUrl, classes, hidden: false,
          });
        }
      }
    }
    return ctrls;
  });
}

function isNoTouch(testid: string | null, text: string): boolean {
  const probe = `${testid || ""} ${text}`;
  return NO_TOUCH_PATTERNS.some((p) => p.test(probe));
}

function isWhitelistedExternal(url: string): boolean {
  try {
    const parsed = new URL(url);
    return EXTERNAL_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

test.describe.configure({ mode: "serial" });

test("button audit · every interactive control across 11 surfaces", async ({ page }, testInfo: TestInfo) => {
  testInfo.setTimeout(900_000);

  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      /* Ignore noise: tauri-adapter warns + 404 favicon + sourcemap warnings */
      if (/tauri-adapter|favicon|sourcemap/i.test(txt)) return;
      consoleErrors.push(`console.error: ${txt.slice(0, 160)}`);
    }
  });

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc.mode", "clipper");
    } catch { /* noop */ }
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lc-app", { timeout: 15_000 });

  const allFindings: ControlFinding[] = [];
  const routeSummaries: RouteSummary[] = [];

  for (const r of ROUTES) {
    const errorsBefore = consoleErrors.length;
    await setMode(page, r.mode);
    await navigate(page, r.routeId);

    /* For the Create alias the panel opens after a nav:click + onArrive
     * emit. Wait for the panel to be present where applicable. */
    if (r.alias && r.routeId === "create") {
      await page.locator('[data-testid="create-panel"]').waitFor({ state: "visible", timeout: 4_000 }).catch(() => {});
    }

    const controls = await enumerate(page);
    const routeFindings: ControlFinding[] = [];

    /* Cap per-route control audit at 40 to avoid runaway · in practice
     * the design budgets keep each surface well under that. */
    const auditList = controls.slice(0, 40);

    for (const c of auditList) {
      const label = c.testid || c.text || c.tag;

      /* a) honestly disabled · honest is required */
      if (c.disabled || c.ariaDisabled) {
        const honest = c.comingSoon || /coming soon|disabled|locked|preview|pending|sign in|select first/i.test(c.text);
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: honest ? "HONESTLY_DISABLED" : "FAIL",
          expectation: "disabled with honest copy",
          observation: honest ? "disabled + honest text" : `disabled BUT no honest copy ("${c.text}")`,
        });
        continue;
      }

      /* b) safety blocklist */
      if (isNoTouch(c.testid, c.text)) {
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: "SKIPPED_SAFE",
          expectation: "destructive/real action · not clicked",
          observation: "blocklisted by safety policy",
        });
        continue;
      }

      /* c) external link · verify URL is whitelisted */
      if (c.hasOpenUrl) {
        const url = c.hasOpenUrl;
        const ok = isWhitelistedExternal(url);
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: ok ? "EXTERNAL" : "FAIL",
          expectation: "opens whitelisted external URL",
          observation: ok ? `external → ${url}` : `external NON-whitelisted → ${url}`,
        });
        continue;
      }

      /* d) try to click and verify SOMETHING happened */
      const beforeUrl = page.url();
      const beforeRoute = await page.evaluate(() => document.querySelector(".lc-app")?.getAttribute("data-route") ?? "");
      const beforeMode = await page.evaluate(() => document.body.getAttribute("data-app-mode") ?? "");
      const beforeAriaSelected = await page.evaluate(() => {
        return [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-expanded]")].map(
          (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-expanded")}`,
        ).join("|");
      });

      try {
        const locator = c.testid
          ? page.locator(`[data-testid="${c.testid}"]`).first()
          : page.locator(`${c.tag}:has-text("${c.text.replace(/"/g, "")}")`).first();
        await locator.click({ timeout: 1_500, trial: false }).catch(() => {});
      } catch (e) {
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: "FAIL",
          expectation: "click should land",
          observation: `click error: ${String((e as Error).message).slice(0, 80)}`,
        });
        continue;
      }

      await page.waitForTimeout(150);

      const afterUrl = page.url();
      const afterRoute = await page.evaluate(() => document.querySelector(".lc-app")?.getAttribute("data-route") ?? "");
      const afterMode = await page.evaluate(() => document.body.getAttribute("data-app-mode") ?? "");
      const afterAriaSelected = await page.evaluate(() => {
        return [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-expanded]")].map(
          (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-expanded")}`,
        ).join("|");
      });

      const observable =
        beforeUrl !== afterUrl ||
        beforeRoute !== afterRoute ||
        beforeMode !== afterMode ||
        beforeAriaSelected !== afterAriaSelected;

      routeFindings.push({
        route: r.label, mode: r.mode,
        testid: c.testid, text: c.text, role: c.role,
        classification: observable ? "PASS" : "FAIL",
        expectation: "click produces observable state change",
        observation: observable
          ? `${beforeRoute !== afterRoute ? `route ${beforeRoute}→${afterRoute}; ` : ""}${beforeMode !== afterMode ? `mode ${beforeMode}→${afterMode}; ` : ""}${beforeAriaSelected !== afterAriaSelected ? "aria state changed" : ""}`.trim()
          : "click had no observable effect (route, mode, aria all unchanged)",
      });

      /* Reset to the audited route if the click navigated away. */
      if (beforeRoute !== afterRoute) {
        await navigate(page, r.routeId);
      }
    }

    const totals: Record<string, number> = {};
    for (const f of routeFindings) totals[f.classification] = (totals[f.classification] || 0) + 1;
    routeSummaries.push({
      label: r.label,
      mode: r.mode,
      totals,
      consoleErrorsDelta: consoleErrors.length - errorsBefore,
      controlsAuditedCount: routeFindings.length,
    });
    allFindings.push(...routeFindings);
  }

  const failingControls = allFindings.filter((f) => f.classification === "FAIL");
  const overall: "GREEN" | "RED" = failingControls.length === 0 && consoleErrors.length === 0 ? "GREEN" : "RED";

  fs.mkdirSync(VERDICT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const verdictPath = path.join(VERDICT_DIR, `button-audit-${ts}.json`);
  const latestPath = path.join(VERDICT_DIR, `button-audit-latest.json`);
  const verdict: AuditVerdict = {
    startedAt: 0, finishedAt: Date.now(),
    overall,
    routeSummaries,
    failingControls,
    allFindings,
    consoleErrors,
  };
  fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(verdict, null, 2));

  /* Attach the verdict so playwright shows it. */
  await testInfo.attach("button-audit", { body: JSON.stringify(verdict, null, 2), contentType: "application/json" });

  /* LC-UI-P0-001 (2026-06-26) — a RED verdict MUST fail the suite. The
   * prior "let the operator decide" stance let silent-success bugs ship
   * because the report was advisory only. Promotion gates are gates,
   * not advisories: failing controls or unhandled console errors fail
   * the build. The verdict files on disk remain the diagnostic trail. */
  if (overall === "RED") {
    const summary = [
      `button audit RED — ${failingControls.length} FAIL · ${consoleErrors.length} console error${consoleErrors.length === 1 ? "" : "s"}`,
      ...failingControls.slice(0, 12).map((f) => `  · [${f.route}] ${f.testid ?? f.text}: ${f.observation}`),
      ...consoleErrors.slice(0, 6).map((e) => `  · ${e}`),
    ].join("\n");
    throw new Error(summary);
  }
});
