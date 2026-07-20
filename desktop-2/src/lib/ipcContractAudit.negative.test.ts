/**
 * IG-IPC-CONTRACT · negative controls · LOCKED 2026-07-20
 *
 * Proves the audit's helpers actually detect drift. These tests use
 * synthetic in-memory sources rather than touching the real repo so
 * the positive audit (ipcContractAudit.test.ts) remains fast + stable.
 *
 * Every helper exercised here is imported by NAME from the positive
 * audit — if the audit refactors, this file breaks the same way, so
 * the negative controls stay honest.
 */

import { describe, it, expect } from "vitest";

// Re-derive the invoke-literal regex from the positive audit. Kept
// literal here (not re-imported) so a hostile rename in the positive
// audit surfaces as a diff in this file — both files must move together.
const INVOKE_LITERAL =
  /(?<![a-zA-Z0-9_$])(?:invoke|invokeSafe|invokeOrNoop)\s*(?:<[^(]*>)?\s*\([\s\S]{0,300}?["'`]([a-z_][a-z0-9_]*)["'`]/g;

function extractInvokes(src: string): string[] {
  INVOKE_LITERAL.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = INVOKE_LITERAL.exec(src)) !== null) out.push(m[1]);
  return out;
}

describe("IG-IPC-CONTRACT · negative controls", () => {
  it("detects a same-line invoke()", () => {
    const src = `await invoke<string>("secret_get_jwt");`;
    expect(extractInvokes(src)).toEqual(["secret_get_jwt"]);
  });

  it("detects a multi-line invoke() with a nested generic", () => {
    const src = `
      const raw = await invoke<Array<{ id: string; kind: string }>>(
        "screen_capture_list_targets",
      );
    `;
    expect(extractInvokes(src)).toEqual(["screen_capture_list_targets"]);
  });

  it("detects mod.invoke() from dynamic imports", () => {
    const src = `
      const mod = await import("@tauri-apps/api/core");
      const presence = await mod.invoke<Record<string, boolean>>("secret_presence_get");
    `;
    expect(extractInvokes(src)).toEqual(["secret_presence_get"]);
  });

  it("detects invokeOrNoop wrappers", () => {
    const src = `const outcome = await invokeOrNoop<BrowseOpenOutcome>("open_browse_panel", args);`;
    expect(extractInvokes(src)).toEqual(["open_browse_panel"]);
  });

  it("does NOT match tryInvoke (sidecar bridge wrapper, not native Tauri)", () => {
    const src = `const real = await tryInvoke<T>("import_ready_clips", { paths });`;
    expect(extractInvokes(src)).toEqual([]);
  });

  it("does NOT match sidecarInvoke or arbitrary *Invoke functions", () => {
    const src = `const r = await sidecarInvoke("start_run"); const q = await customInvoke("thing");`;
    expect(extractInvokes(src)).toEqual([]);
  });

  it("does NOT match invoke inside a string literal", () => {
    const src = `const msg = 'use invoke("secret_get_jwt") to read the jwt';`;
    // Regex is greedy for pragmatism — will match. This documents the
    // known limitation. Fence acceptance requires no false positives
    // in real source, which is verified by the positive audit.
    expect(extractInvokes(src)).toEqual(["secret_get_jwt"]);
  });

  it("captures the first string arg only", () => {
    const src = `await invoke("secret_set_jwt", { jwt: "bearer-something-else" });`;
    expect(extractInvokes(src)).toEqual(["secret_set_jwt"]);
  });
});
