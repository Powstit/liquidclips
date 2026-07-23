/**
 * IG-KADE-BUBBLE-ACTIONABLE · Reliability Sprint L3 (2026-07-22 · H0-01)
 *
 * Source-code invariant test (matches LC's Composer.mount.test.ts style)
 * — the runtime jsdom stack for KadeSpeechBubble is heavy (bus + kade
 * pose registry + design-os wrapper); this suite locks the code paths
 * without spinning up React so the fence stays fast + deterministic.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "KadeSpeechBubble.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "KadeSpeechBubble.css"), "utf-8");

describe("IG-KADE-BUBBLE-ACTIONABLE · action button contract", () => {
  it("bubble source carries the IG sentinel", () => {
    expect(SRC).toMatch(/IG-KADE-BUBBLE-ACTIONABLE/);
  });

  it("bubble accepts an optional action on the speech shape", () => {
    expect(SRC).toMatch(/action\?:\s*\{\s*label:\s*string;\s*kind:\s*ActionKind/);
  });

  it("bubble handles diagnostics, retry, settings, signin, browse-supported action kinds", () => {
    expect(SRC).toMatch(/kind === "diagnostics"/);
    expect(SRC).toMatch(/kind === "retry"/);
    expect(SRC).toMatch(/kind === "settings"/);
    expect(SRC).toMatch(/kind === "signin"/);
    expect(SRC).toMatch(/kind === "browse-supported"/);
  });

  it("diagnostics kind navigates to #/diagnostics + copies to clipboard", () => {
    expect(SRC).toMatch(/window\.location\.hash = "#\/diagnostics"/);
    expect(SRC).toMatch(/navigator\.clipboard\??\.writeText/);
  });

  it("retry kind emits kade:retry on the bus", () => {
    expect(SRC).toMatch(/bus\.emit\("kade:retry"/);
  });

  it("settings/signin kind navigates to #/settings", () => {
    expect(SRC).toMatch(/window\.location\.hash = "#\/settings"/);
  });

  it("bubble renders BOTH action + dismiss buttons with testids", () => {
    expect(SRC).toMatch(/data-testid="kade-speech-bubble-action"/);
    expect(SRC).toMatch(/data-testid="kade-speech-bubble-dismiss"/);
  });

  it("action button has real click handler that runs doAction", () => {
    expect(SRC).toMatch(/onClick=\{doAction\}/);
  });

  it("CSS defines primary + quiet action styles + focus-visible outline", () => {
    expect(CSS).toMatch(/lc-kade-bubble-action--primary/);
    expect(CSS).toMatch(/lc-kade-bubble-action--quiet/);
    expect(CSS).toMatch(/lc-kade-bubble-action:focus-visible/);
  });
});
