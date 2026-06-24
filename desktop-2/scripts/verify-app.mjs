#!/usr/bin/env node
/**
 * verify-app · USER-LENS AUTOMATION GATE master aggregator.
 *
 * Reads every `<journey>-latest.json` verdict under tests/e2e/verdicts/ and
 * emits one rolled-up `overall` JSON the user can read at a glance. Exit
 * code 0 when every journey is PASS and `overall: "GREEN"`, else exit 1.
 *
 * Per the skills `user-lens-fix-protocol`, `user-journey-automation-gate`,
 * and `causal-proof-gate`: the clipping suite is production-complete when
 * this aggregator reports `"overall": "GREEN"`.
 *
 *   { "reaction_overlay": "PASS",
 *     "<future-journey>": "PASS",
 *     "overall": "GREEN" }
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERDICT_DIR = path.resolve(__dirname, "..", "tests", "e2e", "verdicts");

function slugFromName(file) {
  const m = file.match(/^(.*)-latest\.json$/);
  return m ? m[1] : null;
}

function main() {
  if (!fs.existsSync(VERDICT_DIR)) {
    console.error(`[verify-app] no verdicts dir at ${VERDICT_DIR} · run \`npm run test:user-lens\` first.`);
    process.exit(1);
  }
  const files = fs.readdirSync(VERDICT_DIR).filter((f) => f.endsWith("-latest.json"));
  if (files.length === 0) {
    console.error("[verify-app] no journey verdicts found · run `npm run test:user-lens` first.");
    process.exit(1);
  }
  const summary = {};
  let anyFail = false;
  for (const f of files.sort()) {
    const slug = slugFromName(f);
    if (!slug) continue;
    try {
      const v = JSON.parse(fs.readFileSync(path.join(VERDICT_DIR, f), "utf8"));
      summary[slug.replace(/-/g, "_")] = v.result;
      if (v.result !== "PASS") anyFail = true;
    } catch (e) {
      summary[slug.replace(/-/g, "_")] = "ERROR";
      anyFail = true;
    }
  }
  summary.overall = anyFail ? "RED" : "GREEN";
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(anyFail ? 1 : 0);
}

main();
