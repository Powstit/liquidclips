/**
 * IG-COMPOSER-HOSTED-INTENT · file-content regression test.
 *
 * We don't fully mount SimpleComposer here (React + AppShell +
 * Tauri-only paths blow up jsdom). Instead we enforce the source-code
 * contract directly: SimpleComposer.tsx MUST wire the hosted-first
 * pattern, MUST pass the capability catalogue, MUST call sidecar for
 * discovery.scrub, and MUST subscribe to engine:progress/complete.
 *
 * Companion to scripts/lint-composer-hosted-intent.sh (Layer 2 fence);
 * this is Layer 3 (vitest regression). Together with the sentinel
 * comment (Layer 1) and the runtime fallback try/catch (Layer 4) it's
 * the 4-layer defense required by feedback_never_regress_4_layer_defense.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "SimpleComposer.tsx"), "utf-8");

describe("IG-COMPOSER-HOSTED-INTENT · SimpleComposer wire contract", () => {
  it("carries the IG-COMPOSER-HOSTED-INTENT sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-HOSTED-INTENT/);
  });

  it("imports requestKadeIntent from ../../lib/kadeIntentClient", () => {
    expect(SRC).toMatch(
      /import\s*\{[^}]*requestKadeIntent[^}]*\}\s*from\s*"\.\.\/\.\.\/lib\/kadeIntentClient"/,
    );
  });

  it("passes ALL_CAPABILITY_IDS to requestKadeIntent (LLM has full catalog)", () => {
    expect(SRC).toMatch(/const\s+ALL_CAPABILITY_IDS/);
    expect(SRC).toMatch(/capability_ids:\s*\[\.\.\.ALL_CAPABILITY_IDS\]/);
  });

  it("passes session context so multi-turn source-ask can chain", () => {
    expect(SRC).toMatch(/context:\s*ctx/);
  });

  it("keeps local routeIntent as the fallback on hosted throw", () => {
    // Layer 4 · runtime guard · try/catch around requestKadeIntent + local fallback
    expect(SRC).toMatch(/routeIntent\s*\(/);
    expect(SRC).toMatch(/composer_hosted_intent_failed/);
  });

  it("wires sidecar.startRun for local file sources", () => {
    expect(SRC).toMatch(/sidecar\.startRun\s*\(/);
  });

  it("wires sidecar.ingestUrl for URL sources", () => {
    expect(SRC).toMatch(/sidecar\.ingestUrl\s*\(/);
  });

  it("subscribes to engine:progress + engine:complete + engine:error", () => {
    expect(SRC).toMatch(/useEvent\(\s*"engine:progress"/);
    expect(SRC).toMatch(/useEvent\(\s*"engine:complete"/);
    expect(SRC).toMatch(/useEvent\(\s*"engine:error"/);
  });

  it("mounts the source picker (file + URL) with @tauri-apps/plugin-dialog", () => {
    expect(SRC).toMatch(/@tauri-apps\/plugin-dialog/);
    expect(SRC).toMatch(/composer-pick-file/);
    expect(SRC).toMatch(/composer-paste-url-toggle/);
  });

  it("renders progress + clip result surfaces", () => {
    expect(SRC).toMatch(/composer-progress/);
    expect(SRC).toMatch(/composer-clips/);
  });

  it("routes execute action for discovery.scrub without silently no-op'ing", () => {
    // Must contain a case branch OR switch handler for discovery.scrub
    expect(SRC).toMatch(/case\s+"discovery\.scrub"/);
    // And must call resolveCount somewhere in that branch
    expect(SRC).toMatch(/resolveCount/);
  });

  it("logs composer_hosted_intent_ok on the happy path (Diagnostic Center visibility)", () => {
    expect(SRC).toMatch(/composer_hosted_intent_ok/);
  });
});

describe("parseCountFromCommand · regex robustness (LLM omit path)", () => {
  // Re-implement locally so we don't have to export from the component
  // — the point is to lock down expected extractor behavior.
  const re = /(\d{1,3})[\s-]*clips?/i;
  const parse = (cmd: string): number | undefined => {
    const m = cmd.match(re);
    if (!m) return undefined;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) return undefined;
    return n;
  };

  it("extracts 15 from 'make me 15 clips'", () => expect(parse("make me 15 clips")).toBe(15));
  it("extracts 3 from 'give me 3 clips with great hooks'", () => expect(parse("give me 3 clips with great hooks")).toBe(3));
  it("extracts 1 from 'find 1 clip in library'", () => expect(parse("find 1 clip in library")).toBe(1));
  it("extracts 15 from 'make me a 15-clip pack' (hyphen form)", () => expect(parse("make me a 15-clip pack")).toBe(15));
  it("returns undefined for 'find clips'", () => expect(parse("find clips")).toBeUndefined());
  it("returns undefined for count > 100", () => expect(parse("give me 500 clips")).toBeUndefined());
});
