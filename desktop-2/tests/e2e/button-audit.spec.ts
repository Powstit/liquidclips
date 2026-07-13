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
import { installBackendStubs } from "./fixtures/backendFixtures";
import { harnessAssertShell, seedAuthenticatedShell, simulateWalletOffline } from "./_auth-harness";

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
  { routeId: "earn",        mode: "clipper", label: "Wallet" },
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
  /** 2026-07-13 D1 residual · records how the audit reached this
   *  control. See `EnumeratedControl.revealMethod` for the value shape.
   *  Persisted on every finding so the verdict JSON tells the operator
   *  "yes this control was clicked directly" vs "we hovered the sticky
   *  Kade host first to raise its opacity". */
  revealMethod: string;
}

/**
 * 2026-07-13 D1 residual · per-surface manifest of every enumerated
 * control regardless of classification. Daniel's directive: coverage
 * isn't proved by "257 vs 262 findings"; it's proved by naming every
 * expected control on every surface. Manifest is a diff-friendly view
 * that surfaces silent drops (kade-minimize, HUD affordances, etc.)
 * across runs.
 */
interface ManifestControl {
  testid: string | null;
  label: string;
  role: string | null;
  tag: string;
  revealMethod: string;
}
type ControlManifest = Record<string, ManifestControl[]>;

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
  /** 2026-07-13 D1 residual · per-surface control manifest (see
   *  ControlManifest type). Diff two verdicts to catch silent control
   *  drops between runs (e.g. the 5 kade-minimize controls that
   *  vanished when the opacity filter tightened). */
  controlManifest: ControlManifest;
}

/**
 * evaluateResilient · retry `page.evaluate` once when a clicked control
 * navigates the SPA mid-eval and Playwright throws
 *   "Execution context was destroyed, most likely because of a navigation"
 * before the new context is ready. Waiting for `.lc-app` visible and
 * retrying once is enough for the design-OS bootstrap in every practical
 * case; if the second attempt still fails we surface the real error.
 */
async function evaluateResilient<T, A>(
  page: Page,
  fn: (arg: A) => T | Promise<T>,
  arg: A,
): Promise<T> {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    if (!/Execution context was destroyed/i.test(String((e as Error).message))) throw e;
    await page.waitForSelector(".lc-app", { timeout: 10_000 }).catch(() => {});
    return await page.evaluate(fn, arg);
  }
}

async function setMode(page: Page, mode: Mode) {
  await evaluateResilient(page, (m: string) => {
    try { window.localStorage.setItem("lc.mode", m); } catch { /* noop */ }
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("mode:change", { mode: m });
  }, mode);
  await page.waitForTimeout(200);
}

async function navigate(page: Page, route: string) {
  await evaluateResilient(page, (r: string) => {
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
  /** Gate 9 (2026-06-27) — title attribute. A disabled button with a
   *  title explains WHY it's disabled (e.g. "Enter your API key
   *  first"), which is honest copy by intent even if the button text
   *  itself ("Save key") doesn't match the legacy honest-copy regex. */
  title: string | null;
  classes: string;
  selected: boolean;
  hidden: boolean;
  /**
   * 2026-07-13 D1 residual · reveal method resolved by
   * `computeRevealMethod` during enumeration.
   *
   *   `"direct"`                — control is already interactable (opacity
   *                               > 0.05 · visible · hit-tested clean)
   *   `"hover:<stable-sel>"`    — control is hidden at rest but its
   *                               opacity rises above 0.05 when the
   *                               named ancestor is hovered. The click
   *                               path must fire a real pointer hover on
   *                               the selector before clicking the
   *                               control.
   *   `"hover:unresolved"`      — control is opacity-0 and no ancestor
   *                               (up to 4 levels) reveals it. This is
   *                               a hard FAIL — a hover-revealed control
   *                               with no visible reveal pathway is a
   *                               dead control by any user's lens.
   *
   * Reveal detection deliberately walks up to FOUR ancestors so nested
   * hover-hosted controls (e.g. `.parent:hover .mid .child`) are still
   * reachable. This matches the two common Kade patterns:
   *   `.lc-sticky-kade:hover .lc-sticky-kade-minimize` (1 hop)
   *   `.lc-hud:hover .lc-hud-affordance .lc-hud-affordance-btn` (2 hops)
   */
  revealMethod: string;
}

async function enumerate(page: Page): Promise<EnumeratedControl[]> {
  return await page.evaluate(() => {
    /**
     * 2026-07-13 D1 residual · Enumerate every interactive control on
     * the visible surface INCLUDING opacity-0 controls that reveal on
     * ancestor hover.
     *
     * Previously the enumerator excluded opacity-0 controls
     * (`opacity > 0.05` visibility check). That silently dropped
     * `.lc-sticky-kade-minimize` (Kade's hover-revealed minimize
     * chevron — 5 dropped across Home Clipper + Home Agency + Wallet
     * + Campaigns Clipper + Channels). Daniel's directive: "opacity 0
     * does not automatically mean non-interactive · the audit should
     * hover the parent, reveal the control, then test it."
     *
     * The new algorithm:
     *  1. Enumerate visibility ignoring opacity (still gates on width,
     *     height, visibility:hidden, display:none, viewport bounds).
     *  2. For every enumerated control, compute a `revealMethod`:
     *     - "direct" — the resting opacity is above 0.05 AND the point
     *       hit-test resolves to this element or a descendant.
     *     - "hover:<sel>" — the resting opacity is below 0.05 AND
     *       hovering one of the ancestors (walk up to 4 levels)
     *       raises this control's computed opacity above 0.05.
     *       The recorded selector is the closest revealing ancestor
     *       described by the most stable available handle:
     *         (a) `[data-testid="..."]` if present,
     *         (b) `.<primary-class>` if any class starts with `lc-`,
     *         (c) `nth-of-type` positional fallback rooted at the
     *             nearest ancestor with a stable handle.
     *     - "hover:unresolved" — opacity is below 0.05 and no ancestor
     *       hover changed that in the 4-level walk. This is the honest
     *       dead-control signature Daniel wants surfaced as a real FAIL.
     */
    const seen = new Set<Element>();
    const OPACITY_MIN = 0.05;

    function readOpacity(el: Element): number {
      const s = window.getComputedStyle(el);
      return Number.parseFloat(s.opacity || "1");
    }

    /**
     * Build a stable CSS selector for `el`. Prefer testid → semantic
     * class → generated positional fallback. Return null if none of
     * those exist (empty tag/no class/no testid — untargetable).
     */
    function stableSelector(el: Element): string | null {
      const testid = el.getAttribute("data-testid");
      if (testid) return `[data-testid="${testid}"]`;
      const classList = Array.from(el.classList);
      // Prefer brand-scoped classes (`lc-…`) which are namespaced +
      // stable across framer-motion re-renders (framer generates its
      // own transform inline · doesn't rename classes).
      const brandClass = classList.find((c) => c.startsWith("lc-") && !/is-(hover|open|active|selected|animating|entering|exiting)/.test(c));
      if (brandClass) return `.${brandClass}`;
      // Fallback: first stable class OR tag:nth-of-type indexed
      // against the parent.
      const anyClass = classList.find((c) => c.length > 2 && !/^\d/.test(c));
      if (anyClass) return `.${anyClass}`;
      const parent = el.parentElement;
      if (!parent) return el.tagName.toLowerCase();
      let idx = 1;
      for (const sib of Array.from(parent.children)) {
        if (sib === el) break;
        if (sib.tagName === el.tagName) idx += 1;
      }
      return `${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
    }

    /**
     * 2026-07-13 · Static CSS analysis.
     *
     * `dispatchEvent(new MouseEvent('mouseenter'))` does NOT trigger CSS
     * `:hover` — the pseudo-class is set by the browser's hit-testing
     * pipeline, not by synthetic events. That caused every kade-minimize
     * control to classify as `hover:unresolved` in the c487cfe3 audit.
     *
     * Instead: walk `document.styleSheets` and inspect every rule whose
     * selector contains `:hover`. For each such rule, extract the
     * pattern `<ancestorSel>:hover <descSel>` (or `<ancestorSel>:hover
     * <intermediates> <descSel>` for multi-hop), test whether:
     *   1. `child` matches the descSel branch
     *   2. `child.closest(ancestorSel)` yields a real ancestor
     *   3. the rule declares `opacity > OPACITY_MIN` OR removes
     *      `visibility: hidden` / `display: none`
     * If all three hold, `ancestorSel` is a genuine reveal parent.
     *
     * Reads across stylesheets are best-effort · cross-origin sheets
     * throw when their `cssRules` are accessed; we skip those silently.
     */
    function ancestorRevealsChild(ancestor: Element, child: Element): boolean {
      // Walk every rule that could match `child` when `ancestor` is
      // hovered. If found, we're done · return true.
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        let rules: CSSRuleList | null = null;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (let i = 0; i < rules.length; i += 1) {
          const rule = rules[i] as CSSStyleRule;
          const selectorText = rule.selectorText;
          if (!selectorText || !selectorText.includes(":hover")) continue;
          // A rule may group multiple selectors with commas.
          for (const rawSel of selectorText.split(",")) {
            const sel = rawSel.trim();
            // Split into "beforeHover:hover afterHover" — allow
            // whitespace or descendant combinator on either side.
            const m = sel.match(/^(.+?):hover(?:\s+(.+))?$/);
            if (!m) continue;
            const beforeHover = m[1].trim();
            const afterHover = (m[2] || "").trim();
            // The full "resting" selector · what the rule targets when
            // the ancestor is hovered · is `beforeHover + " " + afterHover`.
            // If afterHover is empty, the rule targets the ancestor itself
            // (self-hover reveal) · not interesting for child-reveal.
            if (!afterHover) continue;
            // Does `child` match the descendant part? Use `matches`
            // rather than `closest` so intermediate combinators must
            // resolve exactly.
            let childMatches = false;
            try { childMatches = child.matches(afterHover); } catch { childMatches = false; }
            if (!childMatches) continue;
            // Is `ancestor` (or an ancestor of `child` up the chain up
            // to `ancestor`) matching the `beforeHover` selector?
            let candidate: Element | null = ancestor;
            let matched: Element | null = null;
            while (candidate) {
              try {
                if (candidate.matches(beforeHover)) { matched = candidate; break; }
              } catch { /* invalid selector · skip */ }
              if (candidate === document.documentElement) break;
              candidate = candidate.parentElement;
            }
            if (!matched) continue;
            // Does the rule declare an opacity higher than the
            // resting threshold, OR override visibility/display back
            // to visible? Any of these means the child WILL be
            // revealed by the ancestor hover.
            const decl = rule.style;
            const opacityDecl = decl.opacity ? Number.parseFloat(decl.opacity) : NaN;
            const visibilityDecl = decl.visibility;
            const displayDecl = decl.display;
            if (!Number.isNaN(opacityDecl) && opacityDecl > OPACITY_MIN) return true;
            if (visibilityDecl === "visible" || visibilityDecl === "inherit") return true;
            if (displayDecl && displayDecl !== "none") return true;
          }
        }
      }
      return false;
    }

    function computeRevealMethod(el: Element): string {
      const restingOpacity = readOpacity(el);
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const inViewport = cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight;
      const hit = inViewport ? document.elementFromPoint(cx, cy) : null;
      const hitOwn = !hit || el.contains(hit) || hit === el;

      if (restingOpacity > OPACITY_MIN && hitOwn) return "direct";

      // Walk up to 4 ancestors. Each check pretends to hover the
      // ancestor and re-reads the child's opacity.
      let parent: Element | null = el.parentElement;
      let hops = 0;
      while (parent && hops < 4) {
        if (ancestorRevealsChild(parent, el)) {
          const sel = stableSelector(parent);
          if (sel) return `hover:${sel}`;
          break;
        }
        parent = parent.parentElement;
        hops += 1;
      }
      return "hover:unresolved";
    }

    const ctrls: Array<{
      testid: string | null;
      text: string;
      role: string | null;
      tag: string;
      disabled: boolean;
      ariaDisabled: boolean;
      comingSoon: boolean;
      hasOpenUrl: string | null;
      title: string | null;
      classes: string;
      selected: boolean;
      hidden: boolean;
      revealMethod: string;
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
          /* 2026-07-13 D1 residual · include opacity-0 controls in the
           * enumeration so hover-revealed affordances (Kade minimize,
           * HUD hover-only badges, etc.) can't disappear off the
           * audit's radar. The click loop resolves reveal via
           * `revealMethod` and hovers the ancestor first for
           * `hover:<sel>` entries. */
          const opacity = Number.parseFloat(style.opacity || "1");
          const structurallyVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none";
          if (!structurallyVisible) continue;

          // Hit-test only matters for opacity>0 controls · opacity-0
          // controls fail the hit test by design (their ancestor's
          // hover would raise them). We defer that check to
          // `computeRevealMethod` below.
          if (opacity > OPACITY_MIN) {
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            if (cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight) {
              const hit = document.elementFromPoint(cx, cy);
              if (hit && !el.contains(hit)) continue;
            }
          }

          const revealMethod = computeRevealMethod(el);
          // Discard controls that are opacity-0 AND provably not
          // hover-revealed (`hover:unresolved`) UNLESS they carry a
          // stable data-testid. A dead opacity-0 tile without any
          // reveal path AND without a testid can't be honestly clicked
          // from the audit — surface it via the manifest only, don't
          // pollute the click loop.
          if (revealMethod === "hover:unresolved" && !el.getAttribute("data-testid")) {
            continue;
          }

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
          const title = el.getAttribute("title");
          const classes = el.className?.toString() || "";
          const selected =
            el.getAttribute("aria-selected") === "true" ||
            el.getAttribute("aria-checked") === "true" ||
            el.getAttribute("aria-pressed") === "true" ||
            el.getAttribute("data-active") === "true" ||
            classes.split(/\s+/).includes("is-active");

          ctrls.push({
            testid, text, role, tag, disabled, ariaDisabled, comingSoon, hasOpenUrl, title, classes, selected, hidden: false,
            revealMethod,
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

/* Gate 9 (2026-06-26) — retries disabled for the audit. A retry-pass
 * was hiding the WalletPanel crash that the authenticated walk
 * surfaced. Daniel-locked: the audit must show every regression on
 * the first attempt or it's not an audit. */
test.describe.configure({ mode: "serial", retries: 0 });

test("button audit · every interactive control across 11 surfaces", async ({ page }, testInfo: TestInfo) => {
  // 2026-07-13 · Cluster B fix (commit 74a2cb9b) converted 108 ConsoleNav
  // rail rows from `<a href="#/route">` to `<button>` per the two-pipeline
  // rule. Those rows now flow through the audit's slow-path click+reload
  // classification (previously classified as external-NON-whitelisted in
  // a fast-fail branch — incorrect). Honest classification adds ~108
  // click cycles (~154 → ~262). Budget bumped from 15min to 30min to
  // cover the honest 11-surface × 262-control audit at ~4-8s per control
  // including reload + re-seed.
  testInfo.setTimeout(1_800_000);

  /* 2026-07-13 · Endpoint-specific 503 tracking.
   *
   * `installAuthRouteMocks` deliberately fulfills two endpoints with
   * HTTP 503 to force the "backend offline · mock source" branch of the
   * product code (see `channels-station.spec.ts` requiring
   * `data-channels-source === "mock"`, and `wallet-offline-retry`
   * enumeration requiring `data-ui-state === "error"`). Chrome logs
   * "Failed to load resource: the server responded with a status of 503"
   * for every such response — that's real product-side handling working
   * correctly, not an audit signal.
   *
   * We cross-reference `page.on("response")` (which HAS the URL) with the
   * console error stream so we ignore only the 503s that came from the
   * two known-mock endpoints. A 503 from any other URL (or any status
   * other than 503, or any `pageerror`, or any `console.error` with a
   * different message shape) still counts.
   */
  const KNOWN_HARNESS_503_ENDPOINTS = [
    /api\.liquidclips\.app\/channels(\/.*)?(\?.*)?$/,
    /api\.liquidclips\.app\/me\/wallet\/summary(\?.*)?$/,
  ];
  let harnessMock503Count = 0;
  page.on("response", (resp) => {
    if (resp.status() !== 503) return;
    const url = resp.url();
    if (KNOWN_HARNESS_503_ENDPOINTS.some((r) => r.test(url))) {
      harnessMock503Count += 1;
    }
  });

  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      /* Ignore noise: tauri-adapter warns + 404 favicon + sourcemap warnings */
      if (/tauri-adapter|favicon|sourcemap/i.test(txt)) return;
      /* Ignore the browser-level "Failed to load resource" 503 log ONLY
       * when the count matches a known harness-mocked 503 response we
       * just observed on the wire. Any other 503 (unknown URL or another
       * status) still counts.
       *
       * The counter approach avoids fragile URL-parsing of the Chrome
       * message string (which omits the URL). If a 503 arrives from an
       * unmocked URL, `harnessMock503Count` won't be incremented and the
       * error will fall through to the honest audit stream. */
      if (/Failed to load resource:.*status of 503/i.test(txt) && harnessMock503Count > 0) {
        harnessMock503Count -= 1;
        return;
      }
      consoleErrors.push(`console.error: ${txt.slice(0, 160)}`);
    }
  });

  /* D1 (2026-07-12) · JWT + /me + /sync + /me/money-rollup +
   * /affiliate/me now flow through the canonical `_auth-harness`. The
   * schema-valid /me/wallet/summary + agency-only mocks still come
   * from `installBackendStubs` (registered after the harness so its
   * routes win where they overlap). */
  await seedAuthenticatedShell(page, { tier: "pro" });
  await installBackendStubs(page, { tier: "pro" });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.mode", "clipper");
    } catch { /* noop */ }
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await harnessAssertShell(page);
  await page.waitForSelector(".lc-app", { timeout: 30_000 });

  const allFindings: ControlFinding[] = [];
  const routeSummaries: RouteSummary[] = [];
  /* 2026-07-13 D1 residual · per-surface control manifest. Every
   * enumerated control lands here even if the audit walk short-
   * circuits (skipped-safe, honestly-disabled, hover-unresolved). This
   * is the diff surface Daniel asked for — a run-over-run drop of any
   * expected control is a coverage gap. */
  const controlManifest: ControlManifest = {};

  for (const r of ROUTES) {
    const errorsBefore = consoleErrors.length;

    /* 2026-07-13 · Per-route setup hook. Some controls only render in a
     * specific data state — clicking them against the default happy-path
     * fixture is either impossible (they're not enumerated) or produces
     * no observable effect (retry against a populated wallet is a no-op).
     * Rather than special-case the click observation logic, install the
     * data state the control is designed to operate in BEFORE the route
     * walk. The wallet-offline-retry button is the canonical case; add
     * more here as they surface.
     *
     * The route override installed by `simulateWalletOffline` persists
     * across `page.goto()` resets, so one call before the walk covers
     * every subsequent per-control reset within this route. Cleared
     * after the walk so the next route sees the standard populated
     * fixture from `installBackendStubs`.
     */
    const shouldSimulateWalletOffline = r.routeId === "earn" && r.mode === "clipper";
    if (shouldSimulateWalletOffline) {
      await simulateWalletOffline(page);
      /* Force a hard reset so the earlier populated response isn't
       * still cached in useWalletLedger's summary state. */
      await page.goto("about:blank");
      await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
      await harnessAssertShell(page);
      await page.waitForSelector(".lc-app", { timeout: 30_000 });
    }

    await setMode(page, r.mode);
    await navigate(page, r.routeId);

    /* For the Create alias the panel opens after a nav:click + onArrive
     * emit. Wait for the panel to be present where applicable. */
    if (r.alias && r.routeId === "create") {
      await page.locator('[data-testid="create-panel"]').waitFor({ state: "visible", timeout: 4_000 }).catch(() => {});
    }

    const controls = await enumerate(page);

    /* 2026-07-13 D1 residual · manifest capture. Snapshot every
     * enumerated control (including opacity-0 + hover-revealed ones)
     * BEFORE the click-loop mutates state. Manifests aggregate under
     * `r.label` so multi-mode routes like Campaigns Clipper + Campaigns
     * Agency stay distinct — the mode is baked into the label. */
    controlManifest[r.label] = controls.map((c) => ({
      testid: c.testid,
      label: c.text || c.testid || c.role || c.tag,
      role: c.role,
      tag: c.tag,
      revealMethod: c.revealMethod,
    }));

    const routeFindings: ControlFinding[] = [];

    /* Cap per-route control audit at 40 to avoid runaway · in practice
     * the design budgets keep each surface well under that. */
    const auditList = controls.slice(0, 40);

    for (const c of auditList) {
      /* Controls earlier in this walk can legitimately change later
       * controls (for example, selecting an unavailable Community room
       * disables Refresh). Re-read live state for stable test-id controls
       * immediately before classification so the audit never clicks from a
       * stale enabled/selected snapshot. */
      if (c.testid) {
        const live = page.locator(`[data-testid="${c.testid}"]`).first();
        if (await live.count()) {
          const state = await live.evaluate((el) => ({
            disabled: (el as HTMLButtonElement).disabled === true,
            ariaDisabled: el.getAttribute("aria-disabled") === "true",
            title: el.getAttribute("title"),
            selected:
              el.getAttribute("aria-selected") === "true" ||
              el.getAttribute("aria-checked") === "true" ||
              el.getAttribute("aria-pressed") === "true" ||
              el.getAttribute("data-active") === "true" ||
              el.classList.contains("is-active"),
          }));
          c.disabled = state.disabled;
          c.ariaDisabled = state.ariaDisabled;
          c.title = state.title;
          c.selected = state.selected;
        }
      }
      const label = c.testid || c.text || c.tag;

      /* a) honestly disabled · honest is required.
       *
       * Gate 9 (2026-06-27) — also accept a non-empty `title` attribute
       * as honest copy. A disabled button with title="Enter your API
       * key first" tells the user WHY it's disabled, even if the
       * button text itself ("Save key") is the success-state label.
       * Source-side requirement: when a button is disabled for any
       * non-obvious reason, add a `title` that says why. */
      /* 2026-07-13 D1 residual · pre-classify controls whose enumerator
       * decided no ancestor could raise them above the opacity floor.
       * Daniel's directive · "controls whose opacity remains 0 after
       * hovering ALL ancestors → legitimate FAIL with signature
       * 'hover-revealed but no ancestor reveal detected'". */
      if (c.revealMethod === "hover:unresolved") {
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: "FAIL",
          expectation: "opacity-0 control must be revealable by ancestor hover",
          observation: "hover-revealed but no ancestor reveal detected (walked 4 levels)",
          revealMethod: c.revealMethod,
        });
        continue;
      }

      if (c.disabled || c.ariaDisabled) {
        const honestText = c.comingSoon || /coming soon|disabled|locked|preview|pending|sign in|select first/i.test(c.text);
        const honestTitle = !!c.title && c.title.trim().length > 0;
        const honest = honestText || honestTitle;
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: honest ? "HONESTLY_DISABLED" : "FAIL",
          expectation: "disabled with honest copy or title attribute",
          observation: honest
            ? honestTitle ? `disabled + title("${c.title}")` : "disabled + honest text"
            : `disabled BUT no honest copy or title ("${c.text}")`,
          revealMethod: c.revealMethod,
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
          revealMethod: c.revealMethod,
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
          revealMethod: c.revealMethod,
        });
        continue;
      }

      if (c.selected) {
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: "HONESTLY_DISABLED",
          expectation: "already-active control · click is intentionally a no-op",
          observation: "selected state is already active",
          revealMethod: c.revealMethod,
        });
        continue;
      }

      /* Gate 6 (2026-06-26) — pre-classify already-selected radios as
       * HONESTLY_DISABLED. Clicking a radio that is already aria-checked
       * is intentionally a no-op (the radio group's selected value
       * doesn't change), so the prior "no observable effect" FAIL was
       * audit-logic noise on the Clipper/Agency mode pills. We locate
       * the radio by visible text since most of these pills don't carry
       * a data-testid. */
      if (c.role === "radio") {
        const alreadyChecked = await page.evaluate((text) => {
          const radios = Array.from(document.querySelectorAll('[role="radio"]'));
          for (const el of radios) {
            const t = (el.textContent || "").trim();
            if (t === text && el.getAttribute("aria-checked") === "true") return true;
          }
          return false;
        }, c.text);
        if (alreadyChecked) {
          routeFindings.push({
            route: r.label, mode: r.mode,
            testid: c.testid, text: c.text, role: c.role,
            classification: "HONESTLY_DISABLED",
            expectation: "already-active radio · click is intentionally a no-op",
            observation: "aria-checked=true · re-click does not change selection",
            revealMethod: c.revealMethod,
          });
          continue;
        }
      }

      /* d) try to click and verify SOMETHING happened. Gate 6 adds a
       * toast-emit subscriber as an additional observable signal —
       * upgrade CTAs now emit a bus toast on the unauth/mock failure
       * path (Gate 3), which is the intended "observable effect" rather
       * than a route/aria delta. */
      await page.evaluate(() => {
        const w = window as unknown as {
          __lcAuditToastCount?: number;
          __lcAuditNavCount?: number;
          __lcAuditToastUnsubscribe?: () => void;
          __lcAuditNavUnsubscribe?: () => void;
          __lcBus?: { on: (e: string, h: (p: unknown) => void) => () => void };
        };
        w.__lcAuditToastUnsubscribe?.();
        w.__lcAuditNavUnsubscribe?.();
        w.__lcAuditToastCount = 0;
        w.__lcAuditNavCount = 0;
        w.__lcAuditToastUnsubscribe = w.__lcBus?.on?.(
          "toast",
          () => { w.__lcAuditToastCount = (w.__lcAuditToastCount ?? 0) + 1; },
        );
        w.__lcAuditNavUnsubscribe = w.__lcBus?.on?.(
          "nav:click",
          () => { w.__lcAuditNavCount = (w.__lcAuditNavCount ?? 0) + 1; },
        );
      });
      const beforeUrl = page.url();
      const beforeRoute = await page.evaluate(() => document.querySelector(".lc-app")?.getAttribute("data-route") ?? "");
      const beforeMode = await page.evaluate(() => document.body.getAttribute("data-app-mode") ?? "");
      const beforeAriaSelected = await page.evaluate(() => {
        return [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-pressed],[aria-expanded],[aria-busy]")].map(
          (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("aria-busy")}`,
        ).join("|");
      });
      /* Gate 6 (2026-06-26) — also count visible overlays/drawers/menus
       * before the click. Avatar orbit, Re-open browser, etc. mount new
       * portal-level surfaces that don't touch the existing route/aria
       * tree; counting them as observable removes the audit-logic noise
       * on these buttons without weakening the dead-control check. */
      const beforeOverlayCount = await page.evaluate(() => {
        const sel = '.lc-browse-overlay, .lc-drawer-host, [data-drawer-id], [role="menu"], [role="dialog"], [data-orbit-open="true"], [data-testid="avatar-orbit-menu"], [data-activation-status], [data-testid="create-panel"], [data-testid="home-create-panel"]';
        return document.querySelectorAll(sel).length;
      });

      try {
        const locator = c.testid
          ? page.locator(`[data-testid="${c.testid}"]`).first()
          : c.role
            ? page.locator(`[role="${c.role}"]`).filter({ hasText: c.text }).first()
            : page.locator(`${c.tag}:has-text("${c.text.replace(/"/g, "")}")`).first();

        /* 2026-07-13 D1 residual · hover-then-click for opacity-0
         * controls whose enumerator identified a revealing ancestor.
         *
         * Daniel's directive · "for controls with revealMethod ===
         * 'hover:<sel>': before clicking, page.hover(sel) or
         * page.mouse.move on the parent, wait 200-400ms for the opacity
         * transition, verify child is now interactable, then click."
         *
         * The reveal ancestor selector is precomputed in
         * `computeRevealMethod` above — most-stable available handle
         * (testid > brand class > positional). Playwright's page.hover
         * dispatches real pointer events which fire the CSS `:hover`
         * pseudo-class the same way the customer's cursor would. The
         * 300ms settle covers the .lc-sticky-kade transition (140ms
         * ease) plus a safety margin for compositor commit. */
        if (c.revealMethod.startsWith("hover:")) {
          const ancestorSel = c.revealMethod.slice("hover:".length);
          /* 2026-07-13 · Scope the hover to THE specific ancestor of
           * THIS control, not the first `.lc-sticky-kade-host` on the
           * page. On Create / Campaigns Clipper / Channels the DOM
           * hosts multiple Kade instances (compact + expanded) with
           * the same class; hovering `page.locator(ancestorSel).first()`
           * picks the wrong one and the target's opacity never rises.
           * Walk from the control DOM upward with `closest(ancestorSel)`
           * and hover THAT specific element by coordinate. */
          const parentBox = await locator.evaluate((el, sel) => {
            const parent = el.closest(sel as string);
            if (!parent) return null;
            const r = parent.getBoundingClientRect();
            if (!r.width || !r.height) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }, ancestorSel).catch(() => null);
          if (parentBox) {
            await page.mouse.move(parentBox.x, parentBox.y);
            await page.waitForTimeout(300);
          } else {
            await page.locator(ancestorSel).first().hover({ timeout: 4_000 }).catch(() => { /* silent · fall through · the click will re-check actionability */ });
            await page.waitForTimeout(300);
          }
        }

        await locator.click({ timeout: 4_000, trial: false });
      } catch (e) {
        routeFindings.push({
          route: r.label, mode: r.mode,
          testid: c.testid, text: c.text, role: c.role,
          classification: "FAIL",
          expectation: "click should land",
          observation: `click error: ${String((e as Error).message).slice(0, 80)}`,
          revealMethod: c.revealMethod,
        });
        /* D1 residual (2026-07-13) · re-seed harness after reset so the
         * JWT + route mocks + welcome-ack survive the fresh document.
         *
         * 2026-07-13 · Reset uses `page.goto("/?skipIntro=1#/home")` INSTEAD
         * of `page.reload()`. `page.reload()` preserves the URL after the
         * last click, so if the previous control was e.g. the "Create"
         * nav row (SimulatorRouter aliases `#/create` → `home` with an
         * `onArrive` that emits `home:open-panel`) the reload re-fires
         * the alias arrive hook and the InlineCreatePanel scrim mounts.
         * That scrim then intercepts pointer events for EVERY subsequent
         * control in the audit walk — reproducibly failing "My Clips" +
         * "kade-minimize" on Home + Campaigns + Channels. Navigating to
         * a fresh `#/home` URL kills that alias re-arrival path so each
         * control starts from a truly clean state. Same guarantee for
         * every route since the follow-up `navigate(page, r.routeId)`
         * moves the design-OS router into the target route via bus
         * emit, which does NOT re-fire alias onArrive hooks. */
        await seedAuthenticatedShell(page, { tier: "pro" });
        /* about:blank → target URL forces a hard cross-document navigation.
         * `page.goto(sameOrigin + newHash)` alone is treated as a same-
         * document hash change when the URL differs only by hash, so React
         * state / modal state / event listeners survive — defeating the
         * reset. The about:blank hop drops the document so React reboots
         * cleanly, which is the actual guarantee we need per-control. */
        await page.goto("about:blank");
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await harnessAssertShell(page);
        await page.waitForSelector(".lc-app", { timeout: 30_000 });
        await setMode(page, r.mode);
        await navigate(page, r.routeId);
        continue;
      }

      /* Gate 9 (2026-06-27) — wait up to 1500ms for an observable
       * delta. Gate 7's lazy SimulatorRouter routes mean a nav:click
       * triggers an async chunk fetch before the new surface mounts;
       * 150ms was too tight, causing audit to record "no observable
       * effect" for clicks that ARE swapping the route. Poll for a
       * route/aria/overlay/toast change every 80ms and exit early as
       * soon as one fires. If nothing in 1500ms, treat as FAIL — that's
       * the honest dead-control verdict. */
      const beforeForPoll = {
        url: beforeUrl,
        route: beforeRoute,
        mode: beforeMode,
        aria: beforeAriaSelected,
        overlayCount: beforeOverlayCount,
      };
      const overlaySelForPoll = '.lc-browse-overlay, .lc-drawer-host, [data-drawer-id], [role="menu"], [role="dialog"], [data-orbit-open="true"], [data-testid="avatar-orbit-menu"], [data-activation-status], [data-testid="create-panel"], [data-testid="home-create-panel"]';
      await page.waitForFunction(
        ({ before, sel }) => {
          const w = window as unknown as { __lcAuditToastCount?: number; __lcAuditNavCount?: number };
          const route = document.querySelector(".lc-app")?.getAttribute("data-route") ?? "";
          const mode = document.body.getAttribute("data-app-mode") ?? "";
          const aria = [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-pressed],[aria-expanded],[aria-busy]")].map(
            (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("aria-busy")}`,
          ).join("|");
          const overlayCount = document.querySelectorAll(sel).length;
          const toastCount = w.__lcAuditToastCount ?? 0;
          const navCount = w.__lcAuditNavCount ?? 0;
          return route !== before.route ||
            mode !== before.mode ||
            aria !== before.aria ||
            overlayCount !== before.overlayCount ||
            toastCount > 0 ||
            navCount > 0 ||
            window.location.href !== before.url;
        },
        { before: beforeForPoll, sel: overlaySelForPoll },
        { timeout: 1500, polling: 80 },
      ).catch(() => { /* timeout · the click was a true no-op · proceed with after-snapshot read */ });

      const afterUrl = page.url();
      const afterRoute = await page.evaluate(() => document.querySelector(".lc-app")?.getAttribute("data-route") ?? "");
      const afterMode = await page.evaluate(() => document.body.getAttribute("data-app-mode") ?? "");
      const afterAriaSelected = await page.evaluate(() => {
        return [...document.querySelectorAll("[aria-selected],[aria-checked],[aria-pressed],[aria-expanded],[aria-busy]")].map(
          (el) => `${el.tagName}:${el.getAttribute("aria-selected") || el.getAttribute("aria-checked") || el.getAttribute("aria-pressed") || el.getAttribute("aria-expanded") || el.getAttribute("aria-busy")}`,
        ).join("|");
      });

      const toastCount = await page.evaluate(() => {
        const w = window as unknown as { __lcAuditToastCount?: number };
        return w.__lcAuditToastCount ?? 0;
      });
      const navCount = await page.evaluate(() => {
        const w = window as unknown as { __lcAuditNavCount?: number };
        return w.__lcAuditNavCount ?? 0;
      });
      const afterOverlayCount = await page.evaluate(() => {
        const sel = '.lc-browse-overlay, .lc-drawer-host, [data-drawer-id], [role="menu"], [role="dialog"], [data-orbit-open="true"], [data-testid="avatar-orbit-menu"], [data-activation-status], [data-testid="create-panel"], [data-testid="home-create-panel"]';
        return document.querySelectorAll(sel).length;
      });

      const observable =
        beforeUrl !== afterUrl ||
        beforeRoute !== afterRoute ||
        beforeMode !== afterMode ||
        beforeAriaSelected !== afterAriaSelected ||
        toastCount > 0 ||
        navCount > 0 ||
        beforeOverlayCount !== afterOverlayCount;

      routeFindings.push({
        route: r.label, mode: r.mode,
        testid: c.testid, text: c.text, role: c.role,
        classification: observable ? "PASS" : "FAIL",
        expectation: "click produces observable state change",
        observation: observable
          ? `${beforeRoute !== afterRoute ? `route ${beforeRoute}→${afterRoute}; ` : ""}${beforeMode !== afterMode ? `mode ${beforeMode}→${afterMode}; ` : ""}${beforeAriaSelected !== afterAriaSelected ? "aria state changed; " : ""}${toastCount > 0 ? `toast(${toastCount}) emitted; ` : ""}${navCount > 0 ? `nav(${navCount}) emitted; ` : ""}${beforeOverlayCount !== afterOverlayCount ? `overlay/menu count ${beforeOverlayCount}→${afterOverlayCount}` : ""}`.trim()
          : "click had no observable effect (route, mode, aria, toast, overlays all unchanged)",
        revealMethod: c.revealMethod,
      });

      /* Every control gets a fresh authenticated baseline. Portal state,
       * mode radios, same-route create panels, and filter state otherwise
       * leak into the next control and turn valid clicks into stale-DOM
       * failures. Backend routes + init scripts survive navigation.
       *
       * D1 residual (2026-07-13) · re-seed harness before reset so any
       * page.route handlers dropped by Playwright's reload dedup are
       * re-registered. Cheap idempotent re-application.
       *
       * 2026-07-13 · Reset uses `page.goto("/?skipIntro=1#/home")` INSTEAD
       * of `page.reload()`. `page.reload()` preserves the last-clicked URL
       * so alias routes with `onArrive` hooks (`#/create` reopening the
       * InlineCreatePanel; `#/import` reopening the Upload panel) re-fire
       * the arrive hook on the next boot and leave a scrim covering the
       * subsequent controls in the walk. Fresh `#/home` boot avoids that
       * class of leak for every route in one line. See matching notes in
       * the failure branch above. */
      await seedAuthenticatedShell(page, { tier: "pro" });
      await page.goto("about:blank");
      await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
      await harnessAssertShell(page);
      await page.waitForSelector(".lc-app", { timeout: 30_000 });
      await setMode(page, r.mode);
      await navigate(page, r.routeId);
    }

    /* 2026-07-13 · Per-route teardown. Clear any per-route mock overrides
     * so subsequent routes see the default happy-path fixtures from
     * `installBackendStubs`. */
    if (shouldSimulateWalletOffline) {
      const { clearWalletOfflineSimulation } = await import("./_auth-harness");
      await clearWalletOfflineSimulation(page);
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
    controlManifest,
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
