/**
 * Verdict reporter · USER-LENS AUTOMATION GATE
 *
 * Emits a single JSON verdict per spec run, persisted to
 * `tests/e2e/verdicts/<journey>-<timestamp>.json`. The shape mirrors the
 * skill spec at ~/.claude/skills/user-journey-automation-gate/SKILL.md:
 *
 *   { journey, started_at, result: "PASS"|"FAIL", failed_step,
 *     step_log[], screenshots[], console_errors[], dom_assertions{} }
 *
 * The journey name is read from the spec's `testInfo.title` (first word).
 * Per-step status is appended by the spec itself via `testInfo.attach`
 * (key prefix: `lc:step:`). Console errors collected by the spec are
 * attached under `lc:console-errors`. DOM assertions under `lc:assertions`.
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface StepRecord {
  step: number;
  name: string;
  status: "PASS" | "FAIL";
  screenshot?: string;
}

interface Verdict {
  journey: string;
  started_at: string;
  result: "PASS" | "FAIL";
  failed_step: { step: number; name: string } | null;
  step_log: StepRecord[];
  screenshots: string[];
  console_errors: string[];
  dom_assertions: Record<string, unknown>;
  test_title: string;
  duration_ms: number;
  notes?: string;
}

function decodeBody(body: Buffer | undefined): string | null {
  if (!body) return null;
  try {
    return body.toString("utf8");
  } catch {
    return null;
  }
}

function parseJSON<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

class VerdictReporter implements Reporter {
  private startedAt = new Date().toISOString();
  private results: Verdict[] = [];

  onBegin(_: FullConfig, _suite: Suite) {
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const stepLog: StepRecord[] = [];
    const screenshots: string[] = [];
    const consoleErrors: string[] = [];
    let domAssertions: Record<string, unknown> = {};
    let journey = test.title.split(/\s+/)[0] || test.title;
    let notes: string | undefined;

    for (const a of result.attachments) {
      if (!a.name) continue;
      if (a.name.startsWith("lc:step:")) {
        const parsed = parseJSON<StepRecord>(decodeBody(a.body));
        if (parsed) stepLog.push(parsed);
      } else if (a.name === "lc:console-errors") {
        const parsed = parseJSON<string[]>(decodeBody(a.body));
        if (parsed) consoleErrors.push(...parsed);
      } else if (a.name === "lc:assertions") {
        const parsed = parseJSON<Record<string, unknown>>(decodeBody(a.body));
        if (parsed) domAssertions = { ...domAssertions, ...parsed };
      } else if (a.name === "lc:journey") {
        const v = decodeBody(a.body);
        if (v) journey = v.trim();
      } else if (a.name === "lc:notes") {
        notes = decodeBody(a.body) ?? undefined;
      } else if (a.contentType === "image/png" && a.path) {
        screenshots.push(a.path);
      }
    }

    stepLog.sort((a, b) => a.step - b.step);
    const firstFail = stepLog.find((s) => s.status === "FAIL");
    const passed = result.status === "passed" && !firstFail;

    const verdict: Verdict = {
      journey,
      started_at: this.startedAt,
      result: passed ? "PASS" : "FAIL",
      failed_step: passed
        ? null
        : firstFail
          ? { step: firstFail.step, name: firstFail.name }
          : { step: -1, name: "playwright-runtime-error" },
      step_log: stepLog,
      screenshots,
      console_errors: consoleErrors,
      dom_assertions: domAssertions,
      test_title: test.title,
      duration_ms: result.duration,
      notes,
    };

    this.results.push(verdict);
  }

  onEnd(_result: FullResult) {
    if (this.results.length === 0) return;
    const outDir = path.resolve(__dirname, "verdicts");
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    for (const v of this.results) {
      const slug = v.journey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const file = path.join(outDir, `${slug || "journey"}-${ts}.json`);
      fs.writeFileSync(file, JSON.stringify(v, null, 2));
      // Mirror to a stable "latest" filename for quick inspection.
      const latest = path.join(outDir, `${slug || "journey"}-latest.json`);
      fs.writeFileSync(latest, JSON.stringify(v, null, 2));
    }
  }
}

export default VerdictReporter;
