/**
 * LC-UI-P0-BOOT · baseline measurement.
 *
 * Captures fresh cold-load timing on localhost:1420 (vite dev server),
 * which is the surface Daniel observed at 17–23s first paint.
 *
 * Runs three cold loads (each with a fresh browser context so vite/HTTP
 * cache is empty) and averages. The result file lives at
 * `tests/perf/boot-baseline-<ts>.json`. NOT committed.
 *
 * Metrics captured per run:
 *   - navigationStart (anchor)
 *   - DOMContentLoaded
 *   - load event
 *   - first-paint (paint timing API)
 *   - first-contentful-paint (FCP)
 *   - largest-contentful-paint (LCP) — observed for 5s after load
 *   - react_mount: time the .lc-app root first appears in DOM
 *   - interactive_visible: time a real interactive element renders
 *   - js_transferred_bytes: total JS bytes via PerformanceResourceTiming
 *   - resource_count: number of fetched resources
 */
import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = __dirname;

interface RunMetrics {
  runIdx: number;
  dom_content_loaded_ms: number | null;
  load_event_ms: number | null;
  first_paint_ms: number | null;
  first_contentful_paint_ms: number | null;
  largest_contentful_paint_ms: number | null;
  react_mount_ms: number | null;
  interactive_visible_ms: number | null;
  total_js_bytes: number;
  total_resource_count: number;
  resource_breakdown: Record<string, { count: number; bytes: number }>;
  url: string;
  ts: string;
}

async function captureOne(page: Page, runIdx: number, url: string): Promise<RunMetrics> {
  // Fresh navigation · waitUntil "load" so we know full document is parsed,
  // then wait an extra 5s for LCP to settle.
  const navStart = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });

  // Pre-poll react_mount + interactive_visible markers using polling.
  // The page may not have mounted React yet at `load`.
  const reactMountStart = Date.now();
  await page.waitForSelector(".lc-app", { timeout: 60_000 }).catch(() => undefined);
  const reactMountElapsed = Date.now() - reactMountStart;

  const interactiveStart = Date.now();
  await page
    .waitForSelector("button:not([disabled]), [role='button']:not([aria-disabled='true']), [data-testid]", {
      timeout: 60_000,
    })
    .catch(() => undefined);
  const interactiveElapsed = Date.now() - interactiveStart;

  // Give LCP observer time to land.
  await page.waitForTimeout(5_000);

  const metrics = await page.evaluate(() => {
    const perf = window.performance;
    const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paints = perf.getEntriesByType("paint") as PerformancePaintTiming[];

    const fp = paints.find((p) => p.name === "first-paint")?.startTime ?? null;
    const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;

    /* LCP – read the last entry from the buffered observer. */
    let lcp: number | null = null;
    try {
      const lcpEntries = perf.getEntriesByType("largest-contentful-paint") as (PerformanceEntry & {
        startTime: number;
      })[];
      if (lcpEntries.length) {
        lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }
    } catch {
      /* noop */
    }

    const dcl = nav?.domContentLoadedEventEnd ?? null;
    const load = nav?.loadEventEnd ?? null;

    const resources = perf.getEntriesByType("resource") as PerformanceResourceTiming[];
    let totalJsBytes = 0;
    const breakdown: Record<string, { count: number; bytes: number }> = {};
    for (const r of resources) {
      const url = r.name;
      const isJs = url.endsWith(".js") || url.endsWith(".mjs") || url.includes(".js?");
      const isCss = url.endsWith(".css") || url.includes(".css?");
      const isImg = /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(url);
      const isFont = /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url);
      const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
      const type = isJs
        ? "js"
        : isCss
          ? "css"
          : isImg
            ? "img"
            : isFont
              ? "font"
              : isVideo
                ? "video"
                : "other";
      const bytes = r.transferSize ?? r.encodedBodySize ?? 0;
      const entry = breakdown[type] ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += bytes;
      breakdown[type] = entry;
      if (isJs) totalJsBytes += bytes;
    }

    return {
      dcl,
      load,
      fp,
      fcp,
      lcp,
      totalJsBytes,
      resourceCount: resources.length,
      breakdown,
    };
  });

  return {
    runIdx,
    dom_content_loaded_ms: metrics.dcl,
    load_event_ms: metrics.load,
    first_paint_ms: metrics.fp,
    first_contentful_paint_ms: metrics.fcp,
    largest_contentful_paint_ms: metrics.lcp,
    react_mount_ms: (metrics.fp ?? 0) + reactMountElapsed,
    interactive_visible_ms: (metrics.fp ?? 0) + reactMountElapsed + interactiveElapsed,
    total_js_bytes: metrics.totalJsBytes,
    total_resource_count: metrics.resourceCount,
    resource_breakdown: metrics.breakdown,
    url,
    ts: new Date(navStart).toISOString(),
  };
}

test.describe.configure({ mode: "serial" });

test("boot baseline · 3 cold loads on localhost dev", async ({ browser }, testInfo) => {
  testInfo.setTimeout(300_000);
  const runs: RunMetrics[] = [];
  const port = process.env.PW_PORT ?? "1420";
  const targetUrl = `http://localhost:${port}/?skipIntro=1`;

  for (let i = 0; i < 3; i++) {
    /* Fresh context per run · no cache reuse. */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const m = await captureOne(page, i + 1, targetUrl);
    runs.push(m);
    await page.close();
    await ctx.close();
  }

  /* Average. */
  function avg(key: keyof RunMetrics): number | null {
    const vals = runs.map((r) => r[key]).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  const summary = {
    capturedAt: new Date().toISOString(),
    url: targetUrl,
    runs,
    averages: {
      dom_content_loaded_ms: avg("dom_content_loaded_ms"),
      load_event_ms: avg("load_event_ms"),
      first_paint_ms: avg("first_paint_ms"),
      first_contentful_paint_ms: avg("first_contentful_paint_ms"),
      largest_contentful_paint_ms: avg("largest_contentful_paint_ms"),
      react_mount_ms: avg("react_mount_ms"),
      interactive_visible_ms: avg("interactive_visible_ms"),
      total_js_bytes: avg("total_js_bytes"),
      total_resource_count: avg("total_resource_count"),
    },
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(OUT_DIR, `boot-baseline-${ts}.json`);
  const latestPath = path.join(OUT_DIR, `boot-baseline-latest.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  await testInfo.attach("boot-baseline", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
});
