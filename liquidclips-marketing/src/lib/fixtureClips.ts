// Demo fixture · 10 clip-evidence cards used by the acquisition funnel.
// The website never plays these — it only shows their titles, scores, hooks,
// and locked thumbnails. The unlocked clips live in the desktop app.

export type ClipEvidence = {
  id: string;
  index: number;
  title: string;
  viralScore: number;
  hookLine: string;
  estimatedReach: string;
  duration: string;
  /** transcript window around the moment · 1-line micro-quote */
  transcriptWindow: string;
  /** the world (used for the locked thumbnail gradient hue offset) */
  thumbHue: number;
};

export const FIXTURE_CLIPS: ClipEvidence[] = [
  {
    id: "c1",
    index: 1,
    title: "The 12-second hook nobody's using.",
    viralScore: 94,
    hookLine: "Most people don't even know they're doing this wrong.",
    estimatedReach: "est. 184k–420k views",
    duration: "00:38",
    transcriptWindow: "“…most people don't even know they're doing this wrong, and that's why…”",
    thumbHue: 320,
  },
  {
    id: "c2",
    index: 2,
    title: "Why your first 3 seconds always die.",
    viralScore: 91,
    hookLine: "Your opener is doing the opposite of what you think.",
    estimatedReach: "est. 96k–240k views",
    duration: "00:42",
    transcriptWindow: "“…your opener is doing the opposite of what you think it's doing on the algorithm…”",
    thumbHue: 330,
  },
  {
    id: "c3",
    index: 3,
    title: "He answered the question they never asked.",
    viralScore: 88,
    hookLine: "Then he said the line that made the room stop.",
    estimatedReach: "est. 64k–180k views",
    duration: "00:51",
    transcriptWindow: "“…then he said the line that made the room stop, and everyone leaned in…”",
    thumbHue: 312,
  },
  {
    id: "c4",
    index: 4,
    title: "The replay line.",
    viralScore: 86,
    hookLine: "Watch this twice. The second time hits harder.",
    estimatedReach: "est. 52k–130k views",
    duration: "00:29",
    transcriptWindow: "“…watch this twice — the second time it hits a different part of your brain…”",
    thumbHue: 305,
  },
  {
    id: "c5",
    index: 5,
    title: "90 seconds, then the silence.",
    viralScore: 84,
    hookLine: "He paused for nine seconds. Everyone leaned in.",
    estimatedReach: "est. 48k–116k views",
    duration: "01:32",
    transcriptWindow: "“…and he just paused for nine seconds and everyone leaned in to fill the silence…”",
    thumbHue: 340,
  },
  {
    id: "c6",
    index: 6,
    title: "The frame everyone screenshots.",
    viralScore: 82,
    hookLine: "Camera caught it before anyone in the room did.",
    estimatedReach: "est. 38k–98k views",
    duration: "00:24",
    transcriptWindow: "“…the camera caught the look on his face before anyone in the room did…”",
    thumbHue: 296,
  },
  {
    id: "c7",
    index: 7,
    title: "The pivot at 03:42.",
    viralScore: 79,
    hookLine: "Everything before this is setup. This is the turn.",
    estimatedReach: "est. 32k–80k views",
    duration: "00:46",
    transcriptWindow: "“…everything before this was the setup; this is where the conversation actually starts…”",
    thumbHue: 318,
  },
  {
    id: "c8",
    index: 8,
    title: "The line you'll quote tomorrow.",
    viralScore: 77,
    hookLine: "Say it once, mean it forever — the room knew.",
    estimatedReach: "est. 28k–72k views",
    duration: "00:35",
    transcriptWindow: "“…say it once, mean it forever — and the room knew exactly what he meant…”",
    thumbHue: 335,
  },
  {
    id: "c9",
    index: 9,
    title: "Where the algorithm leans in.",
    viralScore: 74,
    hookLine: "The next eight seconds are why this clip ships.",
    estimatedReach: "est. 22k–58k views",
    duration: "00:33",
    transcriptWindow: "“…the next eight seconds are doing the heavy lifting for the whole minute…”",
    thumbHue: 308,
  },
  {
    id: "c10",
    index: 10,
    title: "The clip that earns the comment.",
    viralScore: 71,
    hookLine: "This is the part people will argue about in the replies.",
    estimatedReach: "est. 18k–46k views",
    duration: "00:41",
    transcriptWindow: "“…this is the part people are going to argue about for weeks in the replies…”",
    thumbHue: 326,
  },
];

/** Used by the analysis state — drips word by word from a single block. */
export const FIXTURE_TRANSCRIPT_DRIP = [
  "Most people think clipping is about cutting.",
  "It's not. It's about knowing what to leave in.",
  "Your opener decides whether the algorithm hands the next 30 seconds to anyone.",
  "If the first three seconds promise nothing, the rest of the clip is invisible.",
  "Here's the part that breaks most clippers.",
  "They cut where the conversation pauses.",
  "Pauses don't get watched. Lean-ins do.",
  "Cut into a lean-in.",
  "Watch this twice. The second time it hits a different part of your brain.",
  "And the line you'll quote tomorrow — say it once, mean it forever.",
];
