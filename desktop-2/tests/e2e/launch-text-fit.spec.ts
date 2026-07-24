/**
 * Launch Text Fit · local visibility guard
 *
 * Scans the rendered launch routes at desktop + constrained desktop
 * widths for clipped/squashed text. This is intentionally visual-DOM
 * focused: if a user cannot read the label/copy, the route fails.
 */
import { test, expect, type Page } from "@playwright/test";

import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

type RouteId =
  | "home"
  | "composer"
  | "create"
  | "workstation"
  | "record"
  | "campaigns"
  | "clipper"
  | "learn"
  | "earn"
  | "community"
  | "channels"
  | "schedule"
  | "settings";

interface RouteVisit {
  route: RouteId;
  renderedRoute: RouteId;
}

const ROUTES: ReadonlyArray<RouteVisit> = [
  { route: "home", renderedRoute: "home" },
  { route: "create", renderedRoute: "home" },
  { route: "composer", renderedRoute: "composer" },
  { route: "workstation", renderedRoute: "workstation" },
  { route: "record", renderedRoute: "record" },
  { route: "campaigns", renderedRoute: "campaigns" },
  { route: "clipper", renderedRoute: "clipper" },
  { route: "learn", renderedRoute: "learn" },
  { route: "earn", renderedRoute: "earn" },
  { route: "community", renderedRoute: "community" },
  { route: "channels", renderedRoute: "channels" },
  { route: "schedule", renderedRoute: "schedule" },
  { route: "settings", renderedRoute: "settings" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow-desktop", width: 900, height: 760 },
] as const;

async function navigateTo(page: Page, visit: RouteVisit): Promise<void> {
  await page.evaluate((r) => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: r });
  }, visit.route);
  await page.locator(`.lc-app[data-route="${visit.renderedRoute}"]`).waitFor({ state: "visible", timeout: 20_000 });
}

interface TextFitIssue {
  tag: string;
  className: string;
  testId: string | null;
  text: string;
  clientWidth: number;
  scrollWidth: number;
  clientHeight: number;
  scrollHeight: number;
  overflowX: string;
  overflowY: string;
  whiteSpace: string;
}

async function findTextFitIssues(page: Page): Promise<TextFitIssue[]> {
  return page.evaluate(() => {
    const textTags = new Set(["A", "BUTTON", "LABEL", "SPAN", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH"]);
    const issues: TextFitIssue[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>("body *"));

    for (const el of els) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      if (el.closest("[aria-hidden='true'], .sr-only")) continue;
      if (["SCRIPT", "STYLE", "SVG", "PATH", "IMG", "CANVAS", "VIDEO", "INPUT", "TEXTAREA", "OPTION"].includes(el.tagName)) continue;

      const hasDirectText = Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim().length > 1,
      );
      const isTextControl = textTags.has(el.tagName) || el.getAttribute("role") === "button";
      if (!hasDirectText && !isTextControl) continue;

      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) continue;

      const xOverflow = el.scrollWidth - el.clientWidth;
      const yOverflow = el.scrollHeight - el.clientHeight;
      if (xOverflow <= 2 && yOverflow <= 2) continue;

      issues.push({
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
        testId: el.getAttribute("data-testid"),
        text: text.slice(0, 120),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        whiteSpace: style.whiteSpace,
      });
      if (issues.length >= 20) break;
    }

    return issues;
  });
}

test.describe("Launch Text Fit", () => {
  for (const viewport of VIEWPORTS) {
    test(`launch routes have readable unclipped text · ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await seedAuthenticatedShell(page, { tier: "pro", whop_connected: true });
      await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
      await harnessAssertShell(page);

      const failures: Record<string, TextFitIssue[]> = {};
      for (const visit of ROUTES) {
        await navigateTo(page, visit);
        const issues = await findTextFitIssues(page);
        if (issues.length > 0) failures[visit.route] = issues;
      }

      expect(failures).toEqual({});
    });
  }
});
