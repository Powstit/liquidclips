/**
 * YouTubeCookiesCard · wire-contract regression · 2026-07-21.
 *
 * Settings.tsx is a large, full-app-shell-dependent route (same jsdom-mount
 * constraint as SimpleComposer.hosted.test.ts) — this asserts the source
 * contract directly rather than mounting: the card calls the Python
 * sidecar's secret_set / secret_delete / secrets_status RPC (NOT the Rust
 * Keychain commands OpenAIKeyCard uses), because method_secret_set is the
 * one that materialises the cookies.txt file yt-dlp's `cookiefile` option
 * needs — a Rust-only Keychain write would silently skip that step.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "Settings.tsx"), "utf-8");

function componentBody(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  expect(start, `could not find function ${name}`).toBeGreaterThan(-1);
  // Grab a generous slice — enough to cover the whole component body,
  // bounded by the next top-level `function ` declaration.
  const next = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, next === -1 ? undefined : next);
}

describe("YouTubeCookiesCard · wire contract", () => {
  const body = componentBody("YouTubeCookiesCard");

  it("checks connection status via secrets_status, keyed off YOUTUBE_COOKIES", () => {
    expect(body).toMatch(/sidecarCall[^(]*\(\s*"secrets_status"/);
    expect(body).toMatch(/secrets\?\.YOUTUBE_COOKIES/);
  });

  it("saves via secret_set with name: YOUTUBE_COOKIES (not a Rust invoke)", () => {
    expect(body).toMatch(/sidecarCall\(\s*"secret_set"/);
    expect(body).toMatch(/name:\s*"YOUTUBE_COOKIES"/);
    expect(body).not.toMatch(/invoke\(\s*"youtube_cookies_set"/);
  });

  it("deletes via secret_delete with name: YOUTUBE_COOKIES", () => {
    expect(body).toMatch(/sidecarCall\(\s*"secret_delete"/);
  });

  it("surfaces the backend's real validation message on save failure (not a generic one)", () => {
    // method_secret_set raises ValueError with a specific, actionable
    // message for a bad paste — the UI must show it verbatim, not swallow
    // it behind "Something went wrong".
    expect(body).toMatch(/e instanceof Error \? e\.message : String\(e\)/);
  });

  it("is mounted in the Settings tree", () => {
    expect(SRC).toMatch(/<YouTubeCookiesCard\s*\/>/);
  });
});
