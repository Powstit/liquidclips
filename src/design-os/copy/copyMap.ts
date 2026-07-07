/**
 * Liquid Clips · Shell Copy Map
 *
 * Single source of truth for shell strings. NO copy lives inline in components.
 *
 * Voice rules (legacy desktop established):
 *   - Past tense for done ("You shipped your first cut.")
 *   - Plain verb for in-progress ("Activating…")
 *   - No exclamation marks. No emojis. No jargon.
 *   - One question per screen.
 *   - Mono UPPERCASE for eyebrows, status, system labels.
 *   - Sentence case for everything human-facing.
 */

import type { RouteId } from "../bridge";

/* ============================================================
   Nav · 13 labels
   ============================================================ */

export const NAV_LABEL: Record<RouteId, string> = {
  home:        "Home",
  workstation: "My Clips",
  submissions: "Submissions",
  analytics:   "Analytics",
  create:     "Create",
  engine:     "My Clips",
  studio:     "Studio",
  thumbnail:  "Thumbs",
  export:     "Export",
  campaigns:  "Campaigns",
  "campaign-builder": "Campaign Builder",
  clipper:    "Clipper",
  earn:       "Earn",
  community:  "Community",
  library:    "Library",
  channels:   "Channels",
  schedule:   "Schedule",
  settings:   "Settings",
  support:    "Support",
};

/* Kade brief — shown as a tooltip on nav hover. Daniel-approved strings. */
export const NAV_KADE_BRIEF: Record<RouteId, string> = {
  home:        "Your command room.",
  workstation: "Edit and post your clips.",
  submissions: "Review clipper submissions to your campaigns.",
  analytics:   "How your campaigns perform · coming after launch.",
  create:     "Drop a link or file to start clipping.",
  engine:     "I scan footage and find moments.",
  studio:     "Trim, caption, layout, export.",
  thumbnail:  "Generate cover thumbnails with your identity locked.",
  export:     "Render the final clip and pick where it ships.",
  campaigns:  "Find paid clip missions.",
  "campaign-builder": "Draft, connect, and publish your Whop reward campaigns.",
  clipper:    "Track your campaign journey.",
  earn:       "Track coins, payouts and rewards.",
  community:  "See squads, ranks and wins.",
  library:    "Reopen past clips and exports.",
  channels:   "Connect platforms and publish.",
  schedule:   "Queue clips and launch posts.",
  settings:   "Tune your console.",
  support:    "Get help from the team.",
};

/* ============================================================
   HUD pills
   ============================================================ */

export const HUD = {
  greetEvening:  "Good evening ✦",
  greetMorning:  "Good morning ✦",
  greetAfternoon:"Good afternoon ✦",
  searchPlaceholder: "Search clips, campaigns, missions…",
  searchKbd: "⌘F",
  newsLabel: "NEWS",
  streakUnit: "day",
  // BUG-001 follow-up · dead but bundled. The historical "Daniel" /
  // "Solo · 1.4k clips" pair was the original fake greeting that used to
  // render before /me resolved (see TopHud.tsx FEATURE-002 note). No
  // component imports them today, but the strings still ship in the JS
  // bundle and could be re-leaked by any future grep. Generic fallbacks
  // mirror the live TopHud + SplashLeaderboard defaults.
  defaultUserName: "Guest",
  defaultUserTier: "Free",
} as const;

/* ============================================================
   Per-route hero copy
   ============================================================ */

export interface RouteHero {
  eyebrow: string;
  h1: string;
  sub: string;
}

export const ROUTE_HERO: Record<RouteId, RouteHero> = {
  home: {
    eyebrow: "Liquid Clips Command Room",
    h1: "Welcome back to the Clip Console",
    sub: "Pick a mission, make your clips, ship them — your world levels up as you go.",
  },
  workstation: {
    eyebrow: "My Clips",
    h1: "Edit and post your clips.",
    sub: "Pick a clip · shape it · post it · submit to Whop for payout.",
  },
  submissions: {
    eyebrow: "Agency · submissions",
    h1: "Review what your clippers shipped",
    sub: "Approve or reject each clip. Whop handles the payout once it lands.",
  },
  analytics: {
    eyebrow: "Analytics · stub",
    h1: "Coming after launch.",
    sub: "Live analytics ship after Batch D. Here's what we're planning to surface.",
  },
  create: {
    eyebrow: "Source bay",
    h1: "Drop a YouTube link to start clipping",
    sub: "Paste a URL, drag a file, or pick from your library. Kade routes it into the Engine.",
  },
  engine: {
    eyebrow: "Cutting floor",
    h1: "Kade is scanning your footage",
    sub: "Finding hooks, cuts, and viral moments. You review the candidates next.",
  },
  studio: {
    eyebrow: "Studio deck",
    h1: "Trim, caption, layout, ship",
    sub: "Pixel-perfect editing with locked watermark. Captions auto-on for Clipper mode.",
  },
  thumbnail: {
    eyebrow: "Thumbnail studio",
    h1: "Generate covers with your identity locked",
    sub: "Reference images drive identity. Variants compete on hook + clarity. Pick the winner.",
  },
  export: {
    eyebrow: "Export · render + ship",
    h1: "Render the final clip and pick where it ships",
    sub: "Format · preset · watermark · target accounts. Real bake lands with the sidecar runtime.",
  },
  campaigns: {
    eyebrow: "Mission pedestal room",
    h1: "Pick a mission, read the brief, join",
    sub: "Live campaigns ranked by fit-score. Stamps and rewards visible before you commit.",
  },
  "campaign-builder": {
    eyebrow: "Agency · campaign builder",
    h1: "Draft, connect, publish your reward campaign",
    sub: "Write the brief · paste a Whop content-reward URL · publish when funding lands.",
  },
  clipper: {
    eyebrow: "Clipper journey",
    h1: "Join · Clip · Post · Submit · Earn",
    sub: "Five-step badge chain rides over any surface. Each chip lights as you advance.",
  },
  earn: {
    eyebrow: "Earnings vault",
    h1: "Your coins, your payouts, your pace",
    sub: "Tracked daily. Paid weekly on Whop. Click any row to see Kade's stamp trail.",
  },
  community: {
    eyebrow: "Squad lounge",
    h1: "Find your squad",
    sub: "Whop rooms, leaderboards, and active campaign drops. Kade waves the holograms in.",
  },
  library: {
    eyebrow: "Archive vault",
    h1: "Your past work, ready to remix",
    sub: "Past clips, exports, footage. Click any tile — Kade re-opens the project drawer.",
  },
  channels: {
    eyebrow: "Relay tower",
    h1: "Connect a platform to ship clips",
    sub: "TikTok · YouTube Shorts · Instagram · X. Kade beams a signal to each connected channel.",
  },
  schedule: {
    eyebrow: "Launch pad",
    h1: "Drop a clip on a lane, watch it launch",
    sub: "Rockets queue per platform. Drip calendar shows when each fires.",
  },
  settings: {
    eyebrow: "Calibration tower",
    h1: "Tune your console",
    sub: "Account · Billing · Connections · Diagnostics. Kade keeps the wrench out.",
  },
  support: {
    eyebrow: "Support",
    h1: "How can we help?",
    sub: "Reach the team or browse the playbook.",
  },
};

/* ============================================================
   Per-route states (empty · loading · success · warning · error)
   ============================================================ */

export interface RouteStates {
  empty:    { title: string; body: string };
  loading:  { title: string; body: string };
  success:  { title: string; body: string };
  warning:  { title: string; body: string };
  error:    { title: string; body: string };
}

export const ROUTE_STATES: Record<RouteId, RouteStates> = {
  home: {
    empty:   { title: "No active campaigns",    body: "Browse the mission pedestal to join your first one." },
    loading: { title: "Catching up",             body: "Pulling your queue, allowance and squad rank." },
    success: { title: "Campaign joined",         body: "Stamp is now on Kade's chest. You're in." },
    warning: { title: "Only 13 free clips left", body: "Upgrade to Solo or wait for the weekly reset." },
    error:   { title: "Sidecar offline",         body: "Kade lost contact with the engine. Tap to retry." },
  },
  workstation: {
    empty:   { title: "No clips yet",            body: "Create or import footage to start." },
    loading: { title: "Loading project",         body: "Pulling your grid, cockpit, and recent edits." },
    success: { title: "Clips ready",             body: "Pick one — the cockpit opens for editing." },
    warning: { title: "Some clips need attention", body: "A few clips failed an earlier stage. Tap them to retry." },
    error:   { title: "Project failed to load",  body: "Tap to retry. If it persists, ping support." },
  },
  submissions: {
    empty:   { title: "No submissions yet",      body: "Share your campaign link with clippers to start receiving submissions." },
    loading: { title: "Loading submissions",     body: "Pulling pending submissions from your campaigns." },
    success: { title: "Submission reviewed",     body: "Whop will handle the payout from here." },
    warning: { title: "Two submissions need a call", body: "Borderline submissions are flagged for your review." },
    error:   { title: "Could not load",          body: "Tap to retry — your queue is safe." },
  },
  analytics: {
    empty:   { title: "Coming after launch",     body: "Live analytics ship after Batch D." },
    loading: { title: "Loading",                  body: "" },
    success: { title: "Analytics ready",          body: "Per-campaign views, top clips, channel breakdown." },
    warning: { title: "Some metrics are stale",   body: "Recent runs may not yet appear." },
    error:   { title: "Could not load",          body: "Tap to retry." },
  },
  create: {
    empty:   { title: "Paste a link to start",   body: "YouTube, Drive, direct upload — Kade takes them all." },
    loading: { title: "Importing",                body: "Probing the source. This usually finishes in under 800ms." },
    success: { title: "Source ready",             body: "Routing into the Engine for moment detection." },
    warning: { title: "Source flagged",           body: "This video is private or geo-blocked in your region." },
    error:   { title: "Source not supported",     body: "Try a different URL or upload the file directly." },
  },
  engine: {
    empty:   { title: "No footage queued",        body: "Drop a link in Create — Kade scans it here." },
    loading: { title: "Scanning",                  body: "Reading transcript, finding hooks. ETA under a minute." },
    success: { title: "12 candidates ready",       body: "Pick the keepers. Each accepted clip costs 1 from your allowance." },
    warning: { title: "Only 3 above threshold",    body: "Try lowering threshold or scanning another source." },
    error:   { title: "Transcode failed",          body: "Kade is on it. Bug found, system cleaned. Tap to retry." },
  },
  studio: {
    empty:   { title: "No clip selected",          body: "Pick one from the queue rail to start editing." },
    loading: { title: "Encoding",                   body: "Rendering 1080p with locked watermark." },
    success: { title: "Saved to library",           body: "Your clip is in archive and queued for Channels." },
    warning: { title: "Watermark missing",          body: "Apply your campaign stamp before exporting." },
    error:   { title: "Codec mismatch",             body: "Try 1080p H.264 — that's the safe export preset." },
  },
  thumbnail: {
    empty:   { title: "No thumbnail yet",           body: "Pick a clip in Engine, then generate cover variants here." },
    loading: { title: "Generating variants",        body: "Composing prompt · sending to gpt-image-1 · ETA under 30s per variant." },
    success: { title: "Variants ready",             body: "Score breakdown below. Pick the winner and set as cover." },
    warning: { title: "Face out of safe area",      body: "Toggle the face guide on and try a re-roll." },
    error:   { title: "Thumbnail render failed",    body: "Check your identity reference and OpenAI key. Retry available." },
  },
  export: {
    empty:   { title: "No clip selected",           body: "Pick a clip in Engine first. Export needs source MP4 + selected ratio." },
    loading: { title: "Rendering",                  body: "Encoding 1080p with locked watermark for free tier · clean export for Pro+." },
    success: { title: "Export complete",            body: "Your clip is in archive and queued for the target accounts you picked." },
    warning: { title: "Account expired",            body: "Re-link one of the target accounts before scheduling." },
    error:   { title: "Render failed",              body: "Codec mismatch · try the safe H.264 preset. Retry available." },
  },
  campaigns: {
    empty:   { title: "No campaigns match",         body: "Adjust your platforms or browse the active drops." },
    loading: { title: "Reading the brief",          body: "Pedestal is reading the campaign rules." },
    success: { title: "You joined the squad",       body: "Stamp is on. Spots taken — start clipping." },
    warning: { title: "Rules require Stamped layout", body: "Switch your layout to Stamped before you submit." },
    error:   { title: "Brief failed to load",        body: "Tap to retry. If it persists, ping #support." },
  },
  "campaign-builder": {
    empty:   { title: "No campaigns yet",           body: "Draft your first campaign — brief · reward URL · publish." },
    loading: { title: "Loading your campaigns",     body: "Pulling drafts and live campaigns from the backend." },
    success: { title: "Campaign live",              body: "Clippers can now submit. Approvals land in your review queue." },
    warning: { title: "Enrichment deferred",        body: "Whop URL saved · snapshot fetch failed. Publish still safe." },
    error:   { title: "Campaign action failed",     body: "Try again · if it persists, check your Whop reward URL." },
  },
  clipper: {
    empty:   { title: "Not in a campaign yet",      body: "Join one from the pedestal to start the journey." },
    loading: { title: "Recording your step",        body: "Updating the chip strip. Hold tight." },
    success: { title: "Step complete",              body: "Strip advanced. Earn step lights up at the end." },
    warning: { title: "Step gated",                  body: "Tier-locked or Whop connection needed." },
    error:   { title: "Submit failed on Whop",      body: "Whop is slow today. Tap to retry the handoff." },
  },
  earn: {
    empty:   { title: "No coins yet",                body: "Clip a campaign to earn your first 100." },
    loading: { title: "Reading the ledger",          body: "Pulling payouts from Whop." },
    success: { title: "Payout landed",               body: "Coin stack stamped. Check your linked bank." },
    warning: { title: "Whop pending",                body: "Approval queued — usually clears within 24h." },
    error:   { title: "Payout failed on Whop",       body: "Update your payout details in Whop and retry." },
  },
  community: {
    empty:   { title: "No squad joined",             body: "Browse the live campaigns to find one." },
    loading: { title: "Loading rooms",                body: "Whop is sending the squad list." },
    success: { title: "Rank up",                     body: "You climbed. Badge flipped — Kade celebrates." },
    warning: { title: "Whop offline",                 body: "Showing cached rooms. Some data may lag." },
    error:   { title: "Room failed to load",          body: "Tap retry. Otherwise open it externally on Whop." },
  },
  library: {
    empty:   { title: "Archive empty",                body: "Clip something to fill these shelves." },
    loading: { title: "Loading projects",              body: "Pulling your archive from the vault." },
    success: { title: "Project reopened",              body: "Cards streaming in. Pick where you left off." },
    warning: { title: "Footage missing locally",       body: "Some clips need re-import to edit again." },
    error:   { title: "Could not load archive",        body: "Tap to retry. The vault may be syncing." },
  },
  channels: {
    empty:   { title: "No channels connected",         body: "Pick one to start shipping your clips." },
    loading: { title: "Connecting",                     body: "Ayrshare is opening the platform's login." },
    success: { title: "Channel locked in",              body: "Beam is fuchsia. Your queue can fire now." },
    warning: { title: "Token expired",                  body: "Reconnect to keep your scheduled rockets firing." },
    error:   { title: "Connection broke",                body: "Reconnect or pause this channel — your call." },
  },
  schedule: {
    empty:   { title: "Nothing scheduled",              body: "Drop a clip onto a lane to queue it." },
    loading: { title: "Syncing the lanes",               body: "Catching up to Ayrshare's queue state." },
    success: { title: "Rocket fired",                   body: "Clip is live. Track engagement on Channels." },
    warning: { title: "Time slot conflict",              body: "Two rockets fighting for the same minute. Resolve." },
    error:   { title: "Schedule failed",                 body: "Rocket sputtered. Tap to re-arm." },
  },
  settings: {
    empty:   { title: "",                                body: "" },
    loading: { title: "Saving",                          body: "Writing to keychain. Should be done in a blink." },
    success: { title: "Saved",                           body: "Settings synced. Kade tucked the wrench away." },
    warning: { title: "Unsaved changes",                  body: "You moved something. Save or discard." },
    error:   { title: "Couldn't save",                   body: "Disk write failed. Try again or quit + reopen." },
  },
  support: {
    empty:   { title: "How can we help?",                body: "Reach the team or browse the playbook." },
    loading: { title: "Sending",                          body: "Routing your message." },
    success: { title: "Message sent",                     body: "We'll reply by end of day." },
    warning: { title: "Slow today",                       body: "Replies may take 24h. Real ones." },
    error:   { title: "Couldn't send",                   body: "Email us instead: hello@liquidclips.app" },
  },
};

/* ============================================================
   CTA labels
   ============================================================ */

export const CTA = {
  // Primary actions per route — the "do the thing"
  create_paste:      "Paste a link",
  create_drop:       "Drop a file",
  engine_send:       "Send to Studio",
  studio_export:     "Export",
  studio_publish:    "Publish",
  studio_schedule:   "Schedule",
  campaigns_join:    "Join campaign",
  campaigns_brief:   "Read brief",
  earn_claim:        "Claim on Whop",
  community_join:    "Find your squad",
  library_open:      "Open project",
  channels_connect:  "Reconnect",
  schedule_drop:     "Drop a clip",
  settings_save:     "Save",
  settings_discard:  "Discard",
  login_signin:      "Sign in to start clipping",

  // Generic
  retry:             "Retry",
  cancel:            "Cancel",
  dismiss:           "Dismiss",
  // Daniel's 2026-06-23 monetisation pass: tier ladder is Free Clipper /
  // Pro $29 / Growth $79 / Agency $500. The old `upgrade_solo` ($9/mo)
  // string is retired in user-facing copy — Pro at $29 is the entry-paid
  // tier. `upgrade_solo` is kept as an alias so any lingering consumer
  // still compiles. New call-sites must use `upgrade_pro`,
  // `upgrade_growth`, or `upgrade_agency` directly.
  upgrade_solo:      "Upgrade to Pro · $29/mo",
  upgrade_pro:       "Upgrade to Pro · $29/mo",
  upgrade_growth:    "Upgrade to Growth · $79/mo",
  upgrade_agency:    "Upgrade to Agency · $500/mo",
  open_external:     "Open on Whop ↗",
  back_to_home:      "Back to Command Room",
} as const;

/* ============================================================
   Phase 6L-B · Discussion copy block
   Generic discussion vocabulary — survives the Community → Campaign
   transition. "Open discussion" is the primary CTA in both worlds;
   the Whop mirror is labelled as a temporary external fallback so the
   UI doesn't bake Whop into the user's mental model.
   ============================================================ */

export const DISCUSSION = {
  open_cta:           "Open discussion",
  whop_secondary:     "Open Whop mirror",
  whop_subtext:       "External · Whop-hosted. Native discussion lands later.",
  locked_eb:          "Locked discussion",
  locked_body:        "Premium discussion · unlock with a paid plan.",
  coming_eb:          "Discussion not ready",
  coming_body:        "This discussion hasn't been provisioned yet · check back soon.",
  admin_eb:           "Admin only",
  admin_body:         "Read-only · admin posts to this thread.",
  available_pill:     "Discussion available",
  no_mirror_note:     "No Whop mirror yet · native discussion lands later.",
  upgrade_cta:        "Upgrade plan",
  mark_visited:       "Mark as visited",
  perks_eb:           "What you get",
  perks_default: [
    "Direct line to the agency running this discussion.",
    "Brief drops, payout pings, and rule changes first.",
    "Replay of past wins from other clippers.",
  ],
} as const;

/* ============================================================
   Social proof + flywheel + upgrade copy
   ============================================================ */

export const SOCIAL_PROOF = {
  clippersOnline:    "Clippers online",
  clipsGenerated:    "Clips generated",
  campaignsLive:     "Campaigns live",
  weeklyReset:       "Reset in",
  yourRank:          "Your rank",
  yourStreak:        "Day streak",
} as const;

export const FLYWHEEL = {
  step1: "Join a mission",
  step2: "Make a clip",
  step3: "Ship it to your channels",
  step4: "Earn coins",
  step5: "Level your tier",
  tagline: "Every clip you ship makes the world louder.",
} as const;

export const UPGRADE = {
  freeCap:          "Free tier caps at 10 clips. Whop unlock opens at clip 11 · $99.99/mo locked for life for the first 12,000 clippers.",
  // Daniel's 2026-06-23 monetisation pass: ladder is Free / Pro $29 /
  // Growth $79 / Agency $500. Pitches re-cast accordingly. `soloPitch`
  // retained as alias for back-compat consumers; reads as Pro now.
  soloPitch:        "Pro · unlimited clips, watermark off, $29/mo.",
  proPitch:         "Pro · split-screen, Studio Engine, faster export, $29/mo.",
  growthPitch:      "Growth · hosted AI lane, priority queue, 750 posts/mo, $79/mo.",
  agencyPitch:      "Agency · run campaigns, multi-brand, analytics rollups, $500/mo.",
} as const;

/* ============================================================
   Kade microcopy — short toasts and bubbles
   ============================================================ */

export const KADE_SAYS = {
  // States
  idle:           "Ready when you are.",
  hover:          "Yep?",
  create:         "Show me what to clip.",
  importing:      "Pulling that in…",
  reading:        "Reading the brief.",
  cutting:        "Scanning for the hook.",
  captions:       "Writing captions.",
  exporting:      "Rendering.",
  publishing:     "Queueing for Ayrshare.",
  campaign:       "Mission set.",
  earnMode:       "Counting coins.",
  community:      "Find your people.",
  settings:       "Wrench out.",
  success:        "You shipped that one.",
  celebration:    "Big win.",
  warning:        "Heads up.",
  error:          "I'll fix it. Hang on.",

  // Suggestions (rare, context-driven)
  suggestLowerThreshold: "Try lowering the threshold — there are softer moments here.",
  suggestGoldAccent:     "Try a gold accent on the title — your hook score wants it.",
  suggestStampedLayout:  "This campaign needs Stamped layout. Switch it before submit.",
  suggestUpgradePro:     "Split-screen is a Pro move. Worth it for podcasts.",
} as const;

/* ============================================================
   Stop-page copy (10 blocking states)
   ============================================================ */

export interface StopPage {
  badge: string;
  tone: "fx" | "amber" | "danger";
  h: string;
  body: string;
  ctaPrimary: string;
  ctaGhost: string;
}

export const STOP_PAGES: Record<string, StopPage> = {
  freeClipsUsedUp: {
    badge: "Allowance · empty", tone: "amber",
    h: "You're out of free clips this week",
    body: "You shipped 100 / 100 — that's the cap on Free. Upgrade to keep clipping, or wait for the weekly reset.",
    ctaPrimary: CTA.upgrade_solo, ctaGhost: "Wait for reset",
  },
  watermarkLocked: {
    badge: "Campaign · stamped", tone: "fx",
    h: "This clip is locked to the campaign",
    body: "You joined a campaign. The watermark, accent rules and submission flow are set by the campaign — change them in the campaign brief.",
    ctaPrimary: CTA.campaigns_brief, ctaGhost: "Leave campaign",
  },
  upgradeRequired: {
    badge: "Pro feature", tone: "fx",
    h: "Split-screen layouts are a Pro move",
    body: "Podcast, green-screen and quote layouts — all on Pro. Includes unlimited clips, Studio Engine, and Kade armour-up.",
    ctaPrimary: CTA.upgrade_pro, ctaGhost: "See Pro limits",
  },
  paymentFailed: {
    badge: "Billing · failed", tone: "danger",
    h: "We couldn't charge your card",
    body: "Your Pro renewal didn't go through. We held your access for 5 more days — fix it now and Kade keeps the chrome on.",
    ctaPrimary: "Update card", ctaGhost: "Downgrade to Free",
  },
  exportFailed: {
    badge: "Encoding · failed", tone: "danger",
    h: "Codec mismatch · Kade is on it",
    body: "The encoder couldn't handle this source profile. Kade shot the bug — try the same clip with a different output preset.",
    ctaPrimary: "Retry as 1080p H.264", ctaGhost: "Try another clip",
  },
  whopHandoff: {
    badge: "External · Whop", tone: "fx",
    h: "Opening Whop to finish this",
    body: "Submissions, payouts and community live on Whop — we hand you off cleanly. Liquid Clips re-activates when you come back.",
    ctaPrimary: CTA.open_external, ctaGhost: "Stay here",
  },
  channelExpired: {
    badge: "Channel · expired", tone: "amber",
    h: "YouTube channel token expired",
    body: "Your YouTube connection went stale (every 90 days). Reconnect to keep your scheduled rockets firing.",
    ctaPrimary: CTA.channels_connect, ctaGhost: "Pause this channel",
  },
  submissionRejected: {
    badge: "Submission · rejected", tone: "danger",
    h: "Agency rejected your clip",
    body: "The agency review desk said this one doesn't meet the brief. This doesn't cost your allowance. Read the note and try again.",
    ctaPrimary: "Open clip in Studio", ctaGhost: "Discuss in squad",
  },
  invalidRules: {
    badge: "Needs changes", tone: "amber",
    h: "3 rules to fix before submitting",
    body: "This campaign requires Stamped layout, 9:16 only, and a minimum 14s duration. We caught the violations before you sent it.",
    ctaPrimary: "Auto-fix all 3", ctaGhost: "Review rules",
  },
  loginExpired: {
    badge: "Session · expired", tone: "amber",
    h: "Console asleep · sign in to wake up",
    body: "Your sign-in expired (it happens after a long quiet stretch). One tap and Kade boots back up where you left off.",
    ctaPrimary: "Sign in to wake", ctaGhost: "Forget this device",
  },
};
