/**
 * PublishModule · C1-T4 wire tests
 *
 * MASTER_AUDIT_2026-07-05 P0 finding #5: Publish button doesn't
 * mint a reward clip — the whole earn loop is dead on the primary
 * CTA. C1-T4 fixes that: after a successful exportApi.exportClip,
 * the module now looks up the active campaign, extracts its
 * whopRewardId, and POSTs /me/reward-clips through bridgeToBackend
 * inside a useAuditableAction("publish.multi-platform", …) wrap.
 *
 * §8 product-lock preservation: LC still does NOT mint reward-clips
 * from CampaignPageShell.tsx — that path continues to open the Whop
 * reward URL in the in-app browser. C1-T4 adds an ADDITIONAL mint
 * path from the Publish CTA on the exported clip, alongside §8.
 * The CampaignPageShell §8 comment stays intact.
 *
 * Source-file assertion pattern per Phase 8 / C1-T5 precedent —
 * PublishModule pulls too much cockpit context to unit-mount safely
 * in vitest + jsdom for a lens verdict.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PM_SRC = readFileSync(
  resolve(__dirname, "PublishModule.tsx"),
  "utf-8",
);
const CPS_SRC = readFileSync(
  resolve(__dirname, "../../campaigns/CampaignPageShell.tsx"),
  "utf-8",
);

describe("PublishModule · C1-T4 real reward-clip mint wire", () => {
  it("imports useAuditableAction + bridgeToBackend + campaignsApi + getModeState", () => {
    expect(PM_SRC).toMatch(
      /import\s*{\s*useAuditableAction\s*}\s*from\s*["'][^"']*useAuditableAction["']/,
    );
    expect(PM_SRC).toMatch(
      /import\s*{\s*bridgeToBackend\s*}\s*from\s*["'][^"']*bridgeToBackend["']/,
    );
    expect(PM_SRC).toMatch(
      /import\s*{\s*getModeState\s*}\s*from\s*["'][^"']*modeStore["']/,
    );
    expect(PM_SRC).toMatch(
      /import\s*{[^}]*campaigns\s+as\s+campaignsApi[^}]*}\s*from\s*["'][^"']*sidecar-stub["']/,
    );
  });

  it("wraps the export+mint runner in useAuditableAction('publish.multi-platform', …)", () => {
    expect(PM_SRC).toMatch(
      /useAuditableAction\(\s*\n?\s*["']publish\.multi-platform["']/,
    );
    expect(PM_SRC).toMatch(/surface:\s*["']PublishModule["']/);
  });

  it("looks up the active campaign via campaignsApi.getBySlug + reads its whopRewardId", () => {
    expect(PM_SRC).toMatch(/getModeState\(\)\.activeCampaignId/);
    expect(PM_SRC).toMatch(/campaignsApi\.getBySlug\(\s*activeCampaignId\s*\)/);
    expect(PM_SRC).toMatch(/campaign\.whopRewardId/);
  });

  it("refuses to fabricate a whop_reward_id — halts with toast when unresolvable", () => {
    // Absent campaign
    expect(PM_SRC).toMatch(/campaign_not_found/);
    // Campaign lacks whopRewardId
    expect(PM_SRC).toMatch(/campaign_no_whop_reward_id/);
    // Both branches emit a warning toast
    expect(PM_SRC).toMatch(/Publish tracked \(partial\)/);
  });

  it("POSTs /me/reward-clips via bridgeToBackend with the resolved reward id + clip idx", () => {
    expect(PM_SRC).toMatch(
      /bridgeToBackend<[^>]*>\(\s*\n?\s*["']POST["']\s*,\s*\n?\s*["']\/me\/reward-clips["']/,
    );
    expect(PM_SRC).toMatch(/whop_reward_id:\s*whopRewardId/);
    expect(PM_SRC).toMatch(/clip_idx:\s*focusedClip\.idx/);
    expect(PM_SRC).toMatch(/campaign_id:\s*activeCampaignId/);
  });

  it("emits the success toast the plan mandates on mint success", () => {
    expect(PM_SRC).toMatch(/title:\s*["']Publish tracked["']/);
    expect(PM_SRC).toMatch(/body:\s*["']Earning listed in Earn tab\.["']/);
  });

  it("does NOT wire a real call to POST /publish-now (multipart · deferred to C1-T3)", () => {
    // Docstring MAY mention "/publish-now" as the thing we're
    // deliberately not wiring. Real call sites must not exist.
    expect(PM_SRC).not.toMatch(
      /bridgeToBackend[\s\S]{0,80}["']\/publish-now/,
    );
    expect(PM_SRC).not.toMatch(/fetch\(\s*[^)]*\/publish-now/);
  });

  it("does NOT reverse the §8 product-lock in CampaignPageShell.tsx", () => {
    // The §8 comment stays intact and the CampaignPageShell body
    // continues to open Whop rather than POST /me/reward-clips.
    expect(CPS_SRC).toMatch(/§8 product-lock/);
    // The `LC does NOT mint a /me/reward-clips write path` line spans
    // two comment lines in the source · assert on the load-bearing
    // phrase without the slash-forward-tokenised path.
    expect(CPS_SRC).toMatch(/LC does NOT mint a/);
    expect(CPS_SRC).not.toMatch(
      /bridgeToBackend\(\s*["']POST["']\s*,\s*["']\/me\/reward-clips/,
    );
  });

  it("legacy inline try/catch in publishNow is fully replaced (no double toast on failure)", () => {
    // The old body defined `const publishNow = async () => {` with a
    // top-level try/catch. C1-T4 splits export from a
    // useCallback-scoped runner + a public publishNow that fires the
    // action. The old pattern should be gone.
    expect(PM_SRC).not.toMatch(/const publishNow = async \(\) => {\s*\n\s*if \(exportState/);
    expect(PM_SRC).toMatch(/const runExportAndMint = useCallback\(async/);
  });
});
