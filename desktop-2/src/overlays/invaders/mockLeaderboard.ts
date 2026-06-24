// Mock leaderboard data for the splash. Explicitly simulator-only — no
// real view tracking, no real payout tracking, no API calls. Values stay
// modest + believable so the splash doesn't lie about scale.
//
// Wiring: SplashLeaderboard.tsx imports these arrays directly. When a
// real backend leaderboard lands, swap the import for a hook that
// returns the same shape.

export type ClipperRow = {
  name: string;
  /** Display string — "2.4M views" rendered as detail. */
  views: string;
  /** Invader-score · arbitrary "in-game" score number. */
  score: number;
  /** PixelLab-gen pixel-art portrait. */
  avatarSrc: string;
};

export type AgencyRow = {
  name: string;
  /** Display string — "$24,560 paid" rendered as detail. */
  paid: string;
  score: number;
  avatarSrc: string;
};

// 2026-06-24 · 10 Kade-derivative avatars from /public/brand/splash/avatars/
// Generated via PixelLab pixflux · 32×32 native pixel art · transparent bg.
// 5 used as top clippers · 5 as top agencies · names match avatar persona.
export const MOCK_CLIPPERS: ClipperRow[] = [
  { name: "KingKade",      views: "2.4M", score: 2840, avatarSrc: "/brand/splash/avatars/avatar-01-king-kade.png" },
  { name: "CapeClipper",   views: "1.8M", score: 2120, avatarSrc: "/brand/splash/avatars/avatar-02-cape-clipper.png" },
  { name: "VisorVibe",     views: "1.5M", score: 1760, avatarSrc: "/brand/splash/avatars/avatar-03-visor-vibe.png" },
  { name: "CyanSoldier",   views: "1.2M", score: 1420, avatarSrc: "/brand/splash/avatars/avatar-04-cyan-soldier.png" },
  { name: "StarStriker",   views: "1.1M", score: 1150, avatarSrc: "/brand/splash/avatars/avatar-05-star-striker.png" },
];

export const MOCK_AGENCIES: AgencyRow[] = [
  { name: "Bowtie Boss",       paid: "$24,560", score: 24560, avatarSrc: "/brand/splash/avatars/avatar-10-bowtie-boss.png" },
  { name: "Gold Medalist",     paid: "$18,340", score: 18340, avatarSrc: "/brand/splash/avatars/avatar-09-gold-medalist.png" },
  { name: "Rainbow Runner",    paid: "$14,280", score: 14280, avatarSrc: "/brand/splash/avatars/avatar-08-rainbow-runner.png" },
  { name: "Ninja Clipper",     paid: "$11,920", score: 11920, avatarSrc: "/brand/splash/avatars/avatar-07-ninja-clipper.png" },
  { name: "Purple Wizard",     paid: "$9,850",  score: 9850,  avatarSrc: "/brand/splash/avatars/avatar-06-purple-wizard.png" },
];

export const MOCK_COUNTERS = {
  clippers: { value: 243, deltaToday: 12 },
  agencies: { value: 47, deltaToday: 3 },
};
