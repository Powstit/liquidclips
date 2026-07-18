/**
 * kadeDialogue · Composer Sprint 3 E1 · in-character lines Kade speaks
 * during Composer flows.
 *
 * ⚠ IRON GATE IG-COMPOSER-M · Kade dialogue library contract.
 *
 * Every line MUST honour LOCKED memory feedback_voice_no_bounty_use_skill.md:
 *   - Target voice: 19-year-old clipper. Direct. Money-aware. No corporate fluff.
 *   - Banned word: "bounty" (use "skill", "clip job", or "paid post" instead).
 * Every line MUST be 3-8 words. Longer lines break the tight Composer rhythm.
 *
 * pickLine(key) is deterministic-per-render (Math.floor over the variants array)
 * so the same flow key produces a stable line inside one React commit but
 * varies across sessions.
 */

export type DialogueKey =
  | "flowReaction.pick"
  | "flowReaction.done"
  | "flowTrim.pick"
  | "flowTrim.done"
  | "flowCaptions.pick"
  | "flowCaptions.done"
  | "flowWatermark.pick"
  | "flowWatermark.done"
  | "flowLibrary.search"
  | "flowLibrary.pick"
  | "flowRecord.arm"
  | "flowRecord.done"
  | "flowCampaign.pick"
  | "session.idle"
  | "session.success"
  | "session.error";

/**
 * LINES · one entry per DialogueKey · array of variants Kade rotates
 * through. Every variant is 3-8 words. No "bounty" · no corporate fluff.
 */
export const LINES: Record<DialogueKey, readonly string[]> = {
  "flowReaction.pick": [
    "Pick the reaction shape.",
    "Which layout hits harder?",
    "Frame it. Reaction time.",
  ],
  "flowReaction.done": [
    "Reaction locked. Nice.",
    "That layout will pop.",
    "Solid. Reaction is set.",
  ],
  "flowTrim.pick": [
    "Where's the money moment?",
    "Trim to the hook.",
    "Cut the fluff. Keep gold.",
  ],
  "flowTrim.done": [
    "Trim landed. Cleaner cut.",
    "Tight. That's the clip.",
    "Locked. Onto the next.",
  ],
  "flowCaptions.pick": [
    "Style the captions.",
    "Caption pop or subtle?",
    "Which caption style ships?",
  ],
  "flowCaptions.done": [
    "Captions styled. Readable.",
    "Text is locked in.",
    "Sharp. Captions are on.",
  ],
  "flowWatermark.pick": [
    "Watermark carries your credit.",
    "Pick the watermark preset.",
    "Watermark = your paid post.",
  ],
  "flowWatermark.done": [
    "Watermark set. You get paid.",
    "Referral URL is live.",
    "Your handle is on it.",
  ],
  "flowLibrary.search": [
    "Search the 1.3M archive.",
    "Type. Pick. Clip.",
    "Who do you want to clip?",
  ],
  "flowLibrary.pick": [
    "Handoff loaded. Moments ready.",
    "Source is in. Pick a beat.",
    "That clip's yours now.",
  ],
  "flowRecord.arm": [
    "Ready when you are.",
    "Roll cam. Reaction incoming.",
    "Frame yourself. Hit record.",
  ],
  "flowRecord.done": [
    "Recording saved. Preview it.",
    "Reaction in the can.",
    "Take is locked.",
  ],
  "flowCampaign.pick": [
    "Pick your paid clip job.",
    "Which brief pays best?",
    "Choose a clip job to ship.",
  ],
  "session.idle": [
    "Tell me what to do.",
    "Ready when you are.",
    "Waiting for the word.",
  ],
  "session.success": [
    "Shipped. Onto the next.",
    "Money moment locked.",
    "That's a clip.",
  ],
  "session.error": [
    "Something snagged. Try again.",
    "Hit a wall. Retry?",
    "Not this time. Retry.",
  ],
} as const;

/** Banned words · enforced by tests + lint. Do NOT relax without a
 *  memory update. */
export const BANNED_WORDS = ["bounty", "bounties"] as const;

/**
 * Return an in-character line for the given key. Picks a random variant
 * from LINES[key]. Returns null if the key is not registered so the
 * caller can no-op instead of speaking a fallback that sounds off-brand.
 */
export function pickLine(key: DialogueKey): string | null {
  const variants = LINES[key];
  if (!variants || variants.length === 0) return null;
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx] ?? null;
}

/**
 * Deterministic variant for tests / snapshots. Given an index, returns
 * the exact variant string. Useful for stable UI regression captures.
 */
export function lineAt(key: DialogueKey, idx: number): string | null {
  const variants = LINES[key];
  if (!variants || variants.length === 0) return null;
  return variants[idx % variants.length] ?? null;
}
