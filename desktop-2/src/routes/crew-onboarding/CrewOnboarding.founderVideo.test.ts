/**
 * CrewOnboarding · founder-hook video · 2026-07-30.
 *
 * The 'hook' phase is the FIRST screen a real user reaches for this
 * pitch (reachable today via the post-verify handoff — see this file's
 * header comment). A near-identical 'hook' state exists in
 * sync-mail-money-drop.tsx with the same founder-hook.mp4 video, but
 * that whole screen is navVisible:false / router-only — no real user
 * lands there. This ports just the video widget into the live flow.
 *
 * Source-file grep pattern — desktop-2 has no @testing-library/react;
 * see CancellationIntercept / TopHud test files for the same
 * established convention.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "CrewOnboarding.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "CrewOnboarding.css"), "utf-8");

describe("CrewOnboarding · founder-hook video wiring", () => {
  it("renders the real founder-hook.mp4 source inside the 'hook' phase block, not some other phase", () => {
    const hookBlock = SRC.match(
      /\{phase === 'hook' && \([\s\S]*?\n {8}\)\}/,
    );
    expect(hookBlock).not.toBeNull();
    expect(hookBlock![0]).toContain('src="/brand/founder/founder-hook.mp4"');
  });

  it("video starts muted+autoplay (never forces sound on a user who hasn't opted in)", () => {
    const videoTag = SRC.match(/<video ref=\{videoRef\}[^>]*>/);
    expect(videoTag).not.toBeNull();
    expect(videoTag![0]).toContain("autoPlay");
    expect(videoTag![0]).toContain("muted");
  });

  it("clicking the thumb or the audio button toggles the SAME toggleVideoMute handler (one control, not two divergent ones)", () => {
    const onClickMatches = [...SRC.matchAll(/onClick=\{toggleVideoMute\}/g)];
    expect(onClickMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("fires founder_video_started (once) and founder_video_finished (once, on end or 75% threshold) tagged with surface: 'crew-onboarding'", () => {
    expect(SRC).toMatch(/lcDiag\('founder_video_started',\s*\{\s*\n\s*surface: 'crew-onboarding'/);
    expect(SRC).toMatch(/lcDiag\('founder_video_finished',\s*\{\s*\n\s*surface: 'crew-onboarding'/);
    // started must be gated so a re-click after unmute doesn't re-fire.
    expect(SRC).toContain("videoStartedRef.current = true;");
    // finished must be gated the same way (ended OR 75%, first wins).
    expect(SRC).toContain("videoFinishedRef.current = true;");
  });

  it("CSS defines every class the widget references", () => {
    for (const cls of [
      "crew-onboarding__coach",
      "crew-onboarding__coach-thumb",
      "crew-onboarding__coach-eyebrow",
      "crew-onboarding__coach-script",
      "crew-onboarding__coach-audio",
    ]) {
      expect(SRC).toContain(cls);
      expect(CSS).toContain(`.${cls}`);
    }
  });

  it("perf contract: no backdrop-filter, no infinite animation on the new widget", () => {
    const coachBlock = CSS.slice(CSS.indexOf(".crew-onboarding__coach"), CSS.indexOf(".crew-onboarding__permission-card"));
    expect(coachBlock).not.toMatch(/backdrop-filter/);
    expect(coachBlock).not.toMatch(/animation:/);
  });
});
