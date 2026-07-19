/**
 * IG-COMPOSER-MISS-DIAG regression guard · Placeholder commands must resolve (2026-07-19)
 *
 * Locks the "every command the UI advertises MUST resolve" contract.
 *
 *   1. Every quick-action `qa.cmd` / tab `tab.cmd` string in Composer.tsx
 *      MUST resolve through routeIntent to either `execute` or `ask` —
 *      never `miss`. If the UI is telling the user "click this to run
 *      X" and clicking it produces `capability_route_miss`, that's a
 *      broken promise and a 22-events-in-a-morning bug.
 *
 *   2. The placeholder-suggested commands ("9:16", "16:9", "give me 3
 *      clips", "add my reaction") MUST resolve. Placeholder text is a
 *      user-facing contract — if we suggest a command in the input we
 *      have to route it.
 *
 *   3. "9:16" MUST resolve to canvas.set-aspect (not frame.hook). This
 *      is the second half of the bugfix — frame.hook used to steal the
 *      aspect intent because CAPABILITY_ORDER put it earlier in the
 *      declaration.
 *
 *   4. The miss-emit line in Composer.tsx MUST carry the IRON GATE
 *      IG-COMPOSER-MISS-DIAG sentinel + `metadata: { query_text: ... }`
 *      so future misses land in Railway with the user's text visible.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { routeIntent, type SessionState } from "./router";
import { CAPABILITIES } from "./capabilities";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(
  resolve(__dirname, "..", "..", "routes", "Composer.tsx"),
  "utf-8",
);

const SESSION: SessionState = {
  lastSource: null,
  baseWindow: { window: { layout: "solo" } },
};

/** The canonical suggestion strings baked into the input placeholder + the quick-action buttons. */
const PLACEHOLDER_COMMANDS = [
  "9:16",
  "16:9",
  "give me 3 clips",
  "add my reaction",
  // Extra common intents the UI advertises via chips / tabs / help
  "trim",
  "record",
  "watermark",
  "timeline",
  "captions bold",
  "make it 9:16",
  "make it 16:9",
];

describe("IG-COMPOSER-MISS-DIAG · placeholder commands resolve", () => {
  for (const cmd of PLACEHOLDER_COMMANDS) {
    it(`routes ${JSON.stringify(cmd)} → execute or ask (never miss)`, () => {
      const r = routeIntent(cmd, SESSION);
      expect(
        r.kind,
        `command ${JSON.stringify(cmd)} produced miss · UI advertises it but router can't route it`,
      ).not.toBe("miss");
    });
  }

  it("9:16 resolves to canvas.set-aspect (not frame.hook)", () => {
    const r = routeIntent("9:16", SESSION);
    expect(r.kind).not.toBe("miss");
    if (r.kind === "miss") return;
    expect(
      r.capability.id,
      "'9:16' must own canvas.set-aspect · frame.hook stole this intent pre-2026-07-19 fix",
    ).toBe("canvas.set-aspect");
  });

  it("16:9 resolves to canvas.set-aspect", () => {
    const r = routeIntent("16:9", SESSION);
    expect(r.kind).not.toBe("miss");
    if (r.kind === "miss") return;
    expect(r.capability.id).toBe("canvas.set-aspect");
  });
});

describe("IG-COMPOSER-MISS-DIAG · every declared quick-action + tab command resolves", () => {
  // Extract all { cmd: "..." } literals from Composer.tsx so this test
  // auto-scales with the button roster. If a new tab/QA button ships
  // whose text doesn't resolve, this test fails loudly.
  const cmdMatches = [...COMPOSER_SRC.matchAll(/\bcmd:\s*"([^"]+)"/g)];
  const cmds = Array.from(new Set(cmdMatches.map((m) => m[1])));

  it("finds cmd literals in Composer.tsx", () => {
    expect(cmds.length, "no cmd literals found · has the QA/tab pattern changed?").toBeGreaterThan(2);
  });

  for (const cmd of cmds) {
    it(`declared button cmd ${JSON.stringify(cmd)} resolves`, () => {
      const r = routeIntent(cmd, SESSION);
      expect(
        r.kind,
        `button cmd ${JSON.stringify(cmd)} routes to miss · either add an intent or remove the button`,
      ).not.toBe("miss");
    });
  }
});

describe("IG-COMPOSER-MISS-DIAG · miss telemetry carries query_text", () => {
  it("Composer.tsx carries the IG-COMPOSER-MISS-DIAG sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-MISS-DIAG/);
  });

  it("miss branch computes queryPreview from the trimmed text", () => {
    expect(COMPOSER_SRC).toMatch(/const queryPreview = text\.slice\(0,\s*60\)/);
  });

  it("miss branch passes metadata.query_text to telemetry.emit", () => {
    // Grab the miss branch body from the source and assert the
    // metadata field shape. If someone drops it, this fails.
    const missIdx = COMPOSER_SRC.indexOf('if (routed.kind === "miss")');
    expect(missIdx).toBeGreaterThan(-1);
    const missBlock = COMPOSER_SRC.slice(missIdx, missIdx + 2000);
    expect(missBlock).toMatch(/metadata:\s*\{\s*query_text:\s*queryPreview/);
  });

  it("miss branch keeps stable_error_code=capability_route_miss", () => {
    const missIdx = COMPOSER_SRC.indexOf('if (routed.kind === "miss")');
    const missBlock = COMPOSER_SRC.slice(missIdx, missIdx + 2000);
    expect(missBlock).toMatch(/stable_error_code:\s*"capability_route_miss"/);
  });
});

describe("IG-COMPOSER-MISS-DIAG · frame.hook no longer claims aspect intents", () => {
  it("frame.hook.intents does NOT include /\\b9:16\\b/", () => {
    const cap = CAPABILITIES["frame.hook"];
    expect(cap).toBeDefined();
    const patterns = cap.intents.map((rx) => rx.source);
    // Case-insensitive match on the pattern source · reject any 9:16 clause
    expect(
      patterns.some((p) => /9:16/.test(p)),
      "frame.hook.intents claims 9:16 · canvas.set-aspect must own that command",
    ).toBe(false);
  });
});
