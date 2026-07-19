/**
 * IG-OTP-C regression guard · SimpleLoginPanel honours sent:false (2026-07-19)
 *
 * Locks the "honest OTP" contract in SimpleLoginPanel.tsx:
 *
 *   1. IRON GATE IG-OTP-C sentinel remains in the file.
 *   2. handleStart reads body.resend_error + body.reason from the /start
 *      response · not just body.sent.
 *   3. Silent-advance branch — `setPhase("code")` unconditional after a
 *      response — is gone.
 *   4. On resend_error, the panel stays on the email screen and calls
 *      setErr with a real error string.
 *   5. On reason=rate_limited, the panel advances to code but surfaces
 *      the retry countdown as a soft banner (setErr non-null).
 *
 * Vitest / textual guard · runs against the source, no React render dep.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PANEL_SRC = readFileSync(
  resolve(__dirname, "SimpleLoginPanel.tsx"),
  "utf-8",
);

describe("IG-OTP-C · SimpleLoginPanel honest sent:false contract", () => {
  it("carries the IG-OTP-C sentinel comment", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-OTP-C/);
  });

  it("declares resend_error + reason + resend_id + send_ms in the /start response type", () => {
    expect(PANEL_SRC).toMatch(/resend_error\?:\s*string/);
    expect(PANEL_SRC).toMatch(/reason\?:\s*string/);
    expect(PANEL_SRC).toMatch(/resend_id\?:\s*string/);
    expect(PANEL_SRC).toMatch(/send_ms\?:\s*number/);
  });

  it("logs the new fields via lcDiag auth_start_response", () => {
    const startIdx = PANEL_SRC.indexOf('lcDiag("auth_start_response"');
    expect(startIdx).toBeGreaterThan(-1);
    const block = PANEL_SRC.slice(startIdx, startIdx + 800);
    expect(block).toMatch(/reason:\s*body\.reason/);
    expect(block).toMatch(/resend_error:\s*body\.resend_error/);
    expect(block).toMatch(/send_ms:\s*body\.send_ms/);
  });

  it("branches on body.sent === false && body.resend_error · stays on email screen", () => {
    expect(PANEL_SRC).toMatch(
      /if \(body\.sent === false && body\.resend_error\) \{/,
    );
    // The early `return` inside the branch means the panel does NOT
    // advance to the code entry screen · the whole point of the fix.
    const branchIdx = PANEL_SRC.indexOf("if (body.sent === false && body.resend_error)");
    const branchBody = PANEL_SRC.slice(branchIdx, branchIdx + 800);
    expect(branchBody).toMatch(/setErr\(/);
    expect(branchBody).toMatch(/return;/);
  });

  it("recognises the rate_limited reason and surfaces a countdown banner", () => {
    expect(PANEL_SRC).toMatch(/body\.reason === "rate_limited"/);
    // The rate-limited branch DOES setPhase("code") (user might already
    // have a code in inbox) but sets a non-null setErr banner so the
    // silent-advance regression can't reintroduce itself.
    const rlIdx = PANEL_SRC.indexOf("rateLimited");
    expect(rlIdx).toBeGreaterThan(-1);
    const rlBlock = PANEL_SRC.slice(rlIdx, rlIdx + 800);
    expect(rlBlock).toMatch(/setPhase\("code"\)/);
    expect(rlBlock).toMatch(/setErr\(/);
  });

  it("humanises the three known resend_error slugs", () => {
    expect(PANEL_SRC).toMatch(/resend_error === "timeout"/);
    expect(PANEL_SRC).toMatch(/resend_error === "no_api_key"/);
    // The default fallback lists the raw slug so unknown values still
    // surface to the user.
    expect(PANEL_SRC).toMatch(/Couldn't send the code \(\$\{body\.resend_error\}\)/);
  });

  it("does NOT contain the old silent-advance comment", () => {
    // The comment "Still advance to code entry — user might already have
    // a code in inbox." lived above the unconditional setPhase("code")
    // block that shipped the 5-minute bug. If it comes back, the branch
    // below has probably been reverted too.
    expect(PANEL_SRC).not.toMatch(
      /\/\/ Server may respond \{"sent": false, "retry_after_sec": N\} on rate limit\.\s*\n\s*\/\/ Still advance to code entry — user might already have a code in inbox\./,
    );
  });
});
