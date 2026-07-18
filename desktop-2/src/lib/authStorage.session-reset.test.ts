/**
 * IG-014-B regression guard · locks the session-reset contract so the
 * "stuck keychain" bug from 2026-07-18 can never come back.
 *
 * Every test in this file MUST stay green forever. Any edit that:
 *   - reverts `clearJwtKeychainForAuthAction` to return void,
 *   - swallows the Tauri IPC error without emitting a diagnostic,
 *   - or removes the SessionResetButton import from SimpleLoginPanel
 * will fail here and block the commit.
 *
 * Runs under vitest (`npm run test:invariant` picks it up).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearJwtKeychainForAuthAction,
  reconcileKeychainOnBoot,
} from "./authStorage";

const REPO_SRC = resolve(__dirname, "..");

function readSrc(relative: string): string {
  return readFileSync(resolve(REPO_SRC, relative), "utf-8");
}

describe("IG-014-B · session-reset regression guard", () => {
  it("clearJwtKeychainForAuthAction returns Promise<boolean>", async () => {
    // Not running under Tauri → returns false (correct short-circuit).
    // The essential contract: return type is boolean, not void.
    const result = await clearJwtKeychainForAuthAction();
    expect(typeof result).toBe("boolean");
  });

  it("authStorage.ts declares clearJwtKeychainForAuthAction as Promise<boolean>", () => {
    const src = readSrc("lib/authStorage.ts");
    expect(src).toMatch(
      /export async function clearJwtKeychainForAuthAction\(\): Promise<boolean>/,
    );
  });

  it("authStorage.ts emits lcDiag on keychain purge failure", () => {
    const src = readSrc("lib/authStorage.ts");
    // The catch block must call the diagnostic logger. Any refactor
    // that removes this line reintroduces the silent-swallow bug.
    expect(src).toMatch(/lcDiag\(\s*"auth\.keychain_purge_failed"/);
  });

  it("authStorage.ts contains the IG-014-B iron gate sentinel", () => {
    const src = readSrc("lib/authStorage.ts");
    expect(src).toMatch(/IRON GATE IG-014-B/);
  });

  it("SimpleLoginPanel.tsx mounts SessionResetButton", () => {
    const src = readSrc("components/auth/SimpleLoginPanel.tsx");
    expect(src).toContain("SessionResetButton");
    expect(src).toMatch(/import\s*\{\s*SessionResetButton\s*\}\s*from\s*["']\.\/SessionResetButton["']/);
    expect(src).toMatch(/<SessionResetButton[\s\S]*?\/>/);
  });

  it("SessionResetButton component file exists at the expected path", () => {
    const src = readSrc("components/auth/SessionResetButton.tsx");
    // Renders when stuck-keychain detected.
    expect(src).toContain("stuck-detected");
    // Falls back to terminal command on Tauri purge failure.
    expect(src).toContain("security delete-generic-password");
    // Uses `clearJwtKeychainForAuthAction` (not a bespoke duplicate purge path).
    expect(src).toContain("clearJwtKeychainForAuthAction");
  });

  it("no file re-introduces a void-return signature for the purge helper", () => {
    const src = readSrc("lib/authStorage.ts");
    // The exact old shape that hid the bug:
    // `export async function clearJwtKeychainForAuthAction(): Promise<void>`
    expect(src).not.toMatch(
      /export async function clearJwtKeychainForAuthAction\(\)\s*:\s*Promise<void>/,
    );
  });

  it("reconcileKeychainOnBoot is exported and returns a Promise<void>", async () => {
    // Non-Tauri runtime → returns undefined (Promise<void> resolves clean).
    // Essential contract: it's exported, awaitable, and resolves without
    // throwing so the boot path can wrap it in a plain try/catch.
    const result = await reconcileKeychainOnBoot();
    expect(result).toBeUndefined();
    // The source declaration also asserts the type signature so any
    // refactor that drops the Promise<void> return breaks the guard.
    const src = readSrc("lib/authStorage.ts");
    expect(src).toMatch(
      /export async function reconcileKeychainOnBoot\(\): Promise<void>/,
    );
  });

  it("setJwtKeychainForAuthAction includes the belt-and-braces delete-before-set pattern", () => {
    const src = readSrc("lib/authStorage.ts");
    // Belt-and-braces (2026-07-18): purge any existing entry before
    // writing the new one. This eliminates the "silent no-op overwrite"
    // failure mode where macOS keeps the stale entry.
    expect(src).toMatch(/setJwtKeychainForAuthAction/);
    expect(src).toMatch(/Idempotent purge first/);
    // Order matters — the delete call must appear inside the function,
    // before the set call. Enforce by scanning the function body slice.
    const fnStart = src.indexOf("export async function setJwtKeychainForAuthAction");
    const fnEnd = src.indexOf("\n}\n", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = src.slice(fnStart, fnEnd);
    const deleteIdx = body.indexOf('invoke("secret_delete_jwt")');
    const setIdx = body.indexOf('invoke("secret_set_jwt"');
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeLessThan(setIdx);
  });
});
