"use client";

// JourneyMapTab — solid state-of-truth for every customer journey in the
// Liquid Clips app. Static data source (this file) auditied read-only against
// the codebase on 2026-07-05 by grepping every citation. Update this file
// same-turn when a wire changes so the admin panel never lies about wire state.
//
// Sits alongside SystemMapTab (architecture nodes + health probes) — that tab
// shows the network topology; this tab shows customer-flow completeness.
//
// Editing rules:
//   1. Any WIRED row must include a file:line citation you can grep RIGHT NOW.
//   2. Any DEMO row must name the setState/setTimeout/toast that fakes it.
//   3. Any MISSING row must name what would need to be built (endpoint / file).
//   4. Never mark a row WIRED without a `citation` string.

import { useMemo, useState } from "react";

type Status = "wired" | "demo" | "missing";
type Cluster = "identity" | "pipeline" | "money" | "agency";

interface Journey {
  id: string;
  cluster: Cluster;
  name: string;
  status: Status;
  citation: string;   // file:line proving the current state
  endpoint?: string;  // backend endpoint the surface hits (if any)
  note: string;       // one-line evidence
  blocker?: boolean;  // marks Cohort 0 launch-critical gaps
}

// ── The 80-journey dataset · verified 2026-07-05 · main @ c766548 ──
const JOURNEYS: Journey[] = [
  // ── Identity + access (12) ──
  { id: "id-01", cluster: "identity", name: "First-launch intro splash → free-tier shell", status: "wired", citation: "desktop-2/src/App.tsx:225", note: "IntroSplash gate + localStorage/keychain JWT cold-boot. Wrapped in Watchdog identity/id-01/intro-splash (2026-07-06) — crash renders KadeRepairScreen fallback instead of white-screen; failure dispatches to HQ Admin intercession bus." },
  { id: "id-02", cluster: "identity", name: "Sign in pill → Whop checkout → JWT deep link", status: "wired", citation: "desktop-2/src/design-os/components/TopHud.tsx:425", endpoint: "GET /whop/checkout-success", note: "Native browser → Whop hosted → 302 to backend → apply_membership_tier → activation-fallback HTML → deep link → keychain. Wrapped in Watchdog identity/id-02/sign-in-pill (2026-07-06) — crash in click handler renders KadeRepairScreen instead of TopHud white-screen; failure dispatches to HQ Admin intercession bus." },
  { id: "id-03", cluster: "identity", name: "account-app /connect-desktop bridge (Clerk users)", status: "wired", citation: "account-app/src/app/connect-desktop/page.tsx:102", endpoint: "POST /api/desktop/connect", note: "Clerk verified session → server mints JWT via challenge → deep link." },
  { id: "id-04", cluster: "identity", name: "/auth/whop/callback OAuth (creator-link buyers)", status: "wired", citation: "junior-backend/app/routes/auth_whop.py:311", endpoint: "GET /auth/whop/callback", note: "OAuth exchange → Whop /me lookup → mint JWT → HTML activation fallback." },
  { id: "id-05", cluster: "identity", name: "/sync auto-rotate JWT ≤5 days", status: "wired", citation: "junior-backend/app/routes/sync.py:62", endpoint: "GET /sync", note: "Returns new_license_jwt when Ed25519 30-day token has ≤5 days remaining." },
  { id: "id-06", cluster: "identity", name: "Settings → Connections (Ayrshare / Whop / Gmail / YouTube)", status: "wired", citation: "desktop-2/src/design-os/routes/Settings.tsx:1494", endpoint: "POST /social/connect", note: "Profile-Key paste + OAuth flow → social_connections row. Wrapped in Watchdog identity/id-06/settings-body (2026-07-06) — outer SettingsRoute boundary aggregates connections + profile + notifications tabs; C2's inner ag-01 Watchdog covers Agency tab separately." },
  { id: "id-07", cluster: "identity", name: "Settings → Profile + unified handle", status: "wired", citation: "desktop-2/src/design-os/routes/Settings.tsx:1494", endpoint: "POST /me/handle", note: "Handle edit + avatar + tier display from /me. Coverage inherited from id-06 SettingsRoute wrap · shared node." },
  { id: "id-08", cluster: "identity", name: "Settings → Notifications", status: "wired", citation: "desktop-2/src/design-os/routes/Settings.tsx:1494", endpoint: "GET /notifications", note: "Inbox list from backend. Coverage inherited from id-06 SettingsRoute wrap · shared node." },
  { id: "id-09", cluster: "identity", name: "Sign out (bus → keychain wipe)", status: "wired", citation: "desktop-2/src/design-os/components/TopHud.tsx:227", note: "clearJwt + clearActivation + auth:signed-out → shell re-render." },
  { id: "id-10", cluster: "identity", name: "Onboarding milestone stream", status: "wired", citation: "desktop-2/src/lib/onboardingEmitter.ts:1", endpoint: "GET /sync (onboarding_status)", note: "User.onboarding_status JSON diffs to Kade pose reactions." },
  { id: "id-11", cluster: "identity", name: "Offline license verify (bundled pubkey)", status: "demo", citation: "desktop-2/src/lib/intro.ts", endpoint: "GET /desktop/public-key", note: "Ed25519 pubkey bundled at build; verified locally; no multi-device UX." },
  { id: "id-12", cluster: "identity", name: "Manual JWT paste pane", status: "missing", citation: "dead code removed 2026-07-05 · CM-T10 · activation.ts activateWithToken deleted", note: "Never rendered from any React component. Sign-in flow routes through Whop checkout → deep link exclusively. If a manual-paste UI is ever needed, re-scope from scratch." },

  // ── Clip pipeline (19) ──
  { id: "cp-01", cluster: "pipeline", name: "Import from disk (drag-drop, file-picker)", status: "wired", citation: "desktop-2/src/design-os/engine/sidecar-stub.ts:312 → sidecar.py method_import_ready_clips", note: "Real sidecar method." },
  { id: "cp-02", cluster: "pipeline", name: "Import from URL (yt-dlp)", status: "wired", citation: "desktop-2/src/design-os/engine/sidecar-stub.ts:216 → sidecar.py:2619", note: "start_ingest_url → ingest_url method with yt-dlp." },
  { id: "cp-03", cluster: "pipeline", name: "Transcribe · hosted Modal/Replicate GPU", status: "wired", citation: "junior-backend/app/routes/transcribe.py:65", endpoint: "POST /transcribe-stream", note: "MODAL_TRANSCRIBE_URL or REPLICATE_API_TOKEN gated; stub fallback." },
  { id: "cp-04", cluster: "pipeline", name: "Transcribe · local Whisper fallback", status: "wired", citation: "sidecar.py:2841 method_lift_transcript", note: "faster-whisper tiny model bundled — Free-tier path." },
  { id: "cp-05", cluster: "pipeline", name: "LLM segment + title (hosted /proxy/llm)", status: "wired", citation: "junior-backend/app/routes/proxy_llm.py:25", endpoint: "POST /proxy/llm", note: "Pro+ tier gate; BYO OpenAI key fallback." },
  { id: "cp-06", cluster: "pipeline", name: "Auto-cut into variants (9:16 / 1:1 / 16:9)", status: "wired", citation: "sidecar.py:4841 (ffmpeg scale filter)", note: "Format param passed into export_clip." },
  { id: "cp-07", cluster: "pipeline", name: "Custom captions (per-word colour, timings)", status: "wired", citation: "desktop-2/src/design-os/components/EngineRightRail.tsx:66", note: "React state machine + libass-wasm renderer." },
  { id: "cp-08", cluster: "pipeline", name: "Thumbnail generation via gpt-image-1", status: "wired", citation: "sidecar.py:4328 method_thumbnail_generate", note: "9-field brand preset + identity refs from method_save_avatar:376." },
  { id: "cp-09", cluster: "pipeline", name: "Liquid Clips watermark (Free locked / Pro toggle)", status: "wired", citation: "sidecar.py:4793 _watermark_export_filter", note: "drawtext ffmpeg filter; paywall trigger routes Free tier to Whop checkout." },
  { id: "cp-10", cluster: "pipeline", name: "Real MP4 export (C1-T3)", status: "wired", citation: "sidecar.py:4805 method_export_clip", note: "libx264/veryfast/crf20/yuv420p/aac160k/+faststart · progress via -progress pipe:2." },
  { id: "cp-11", cluster: "pipeline", name: "Save-copy-as", status: "wired", citation: "sidecar.py:4991 method_save_copy_as", note: "Copies MP4 to caller-supplied dest with atomic replace." },
  { id: "cp-12", cluster: "pipeline", name: "Reveal-in-Finder", status: "wired", citation: "sidecar.py:5021 method_reveal_in_finder", note: "macOS open -R / Windows explorer /select / Linux xdg-open." },
  { id: "cp-13", cluster: "pipeline", name: "Export history persistence", status: "wired", citation: "sidecar.py:4940 _write_export_history", note: "~/LiquidClips/export_history.json · atomic tmp+replace · trim to 200 rows." },
  { id: "cp-14", cluster: "pipeline", name: "Delete / archive clip", status: "wired", citation: "sidecar.py:629 method_set_project_archived / :651 method_delete_project", note: "Soft-archive or hard-delete." },
  { id: "cp-15", cluster: "pipeline", name: "Import via in-app browser (spider capture)", status: "demo", citation: "desktop-2/src/design-os/routes/BrowseSection.tsx", note: "Webview works; no auto-capture-to-clip path." },
  { id: "cp-16", cluster: "pipeline", name: "Overlay templates → MP4 bake", status: "demo", citation: "desktop-2/src/design-os/studio/OverlayTemplateGallery.tsx:46", note: "5 hard-coded templates selectable; bake into export deferred." },
  { id: "cp-17", cluster: "pipeline", name: "Export retry (UI-driven)", status: "demo", citation: "sidecar.py:4940 history reader", note: "History readable; retry is manual clip-reselect." },
  { id: "cp-18", cluster: "pipeline", name: "Batch export (multi-clip)", status: "missing", citation: "not implemented", note: "No endpoint; UI would loop per-clip." },
  { id: "cp-19", cluster: "pipeline", name: "Watch-folder import", status: "missing", citation: "not implemented", note: "No listener process." },

  // ── Distribution + money (20) ──
  { id: "mo-01", cluster: "money", name: "Publish-now (walk-around · reveal + persistent-cookie composer)", status: "wired", citation: "desktop-2/src/components/publish/PublishModal.tsx (CM-T7 · 2026-07-05) + desktop-2/src/design-os/schedule/assistedSchedule.ts:211 startAssistedHandoff", note: "PublishModal writes AssistedScheduleRecord per platform → revealItemInDir + writeText(caption) + opens platformComposerUrl in persistent-cookie BrowseOverlay. User posts manually in already-signed-in composer. Ayrshare pulled." },
  { id: "mo-02", cluster: "money", name: "Schedule notification fire (walk-around · native OS notification)", status: "wired", citation: "desktop-2/src/design-os/schedule/AssistedScheduleMonitor.tsx + App.tsx:226", note: "Monitor polls every 15s + listens for @tauri-apps/plugin-notification onAction · fires startAssistedHandoff when scheduledFor hits. No cron, no backend." },
  { id: "mo-03", cluster: "money", name: "Schedule single post (UI)", status: "wired", citation: "desktop-2/src/components/publish/PublishModal.tsx cadence=scheduled (CM-T7) + scheduleAssistedNotification per platform", note: "PublishModal.submit builds AssistedScheduleRecord + requestPermission + scheduleAssistedNotification for each platform." },
  { id: "mo-04", cluster: "money", name: "Drip scheduling (multi-post tier-gated)", status: "wired", citation: "PublishModal.tsx cadence=drip + AssistedScheduleMonitor polling", note: "Drip queue = multiple AssistedScheduleRecord rows spaced by user pick · monitor fires each in turn." },
  { id: "mo-05", cluster: "money", name: "Reschedule / cancel / retry job", status: "wired", citation: "desktop-2/src/design-os/engine/sidecar-stub.ts:1701 (cancel) / :1738 (reschedule) / :1800 (retry · CM-T8 local branch)", note: "All three fire cancelAssistedNotification + patchAssistedJob + scheduleAssistedNotification + toast. Retry re-arms for +2 min." },
  { id: "mo-06", cluster: "money", name: "Calendar view of scheduled posts", status: "wired", citation: "desktop-2/src/design-os/state/useSchedule.ts:100 subscribeAssistedSchedule + scheduleApi.listScheduledClips → readAssistedSchedule()", note: "WeekStrip + DayColumnList read real localStorage rows · re-render on any assisted-schedule change." },
  { id: "mo-07", cluster: "money", name: "Ayrshare Profile-Key paste + OAuth (DEPRECATED)", status: "demo", citation: "junior-backend/app/routes/social.py:191", note: "Surface still exists in code but Ayrshare rail is pulled 2026-07-05. Walk-around replaces this entirely. Remove in cleanup sprint." },
  { id: "mo-08", cluster: "money", name: "Reward-clip mint on publish (C1-T4)", status: "wired", citation: "junior-backend/app/routes/reward_clips.py:168", endpoint: "POST /me/reward-clips", note: "Creates RewardClip + TrackingLink row." },
  { id: "mo-09", cluster: "money", name: "Reward-clip statuses (pending/approved/rejected/paid)", status: "wired", citation: "junior-backend/app/routes/reward_clips.py:254", endpoint: "GET /me/reward-clips", note: "Polling reads status; Whop drives transitions." },
  { id: "mo-10", cluster: "money", name: "Earn summary 5-tile strip", status: "wired", citation: "junior-backend/app/routes/me_wallet.py:151", endpoint: "GET /me/wallet/summary", note: "WalletPipelineBlock: in_review + approved + paid + rejected + rpm." },
  { id: "mo-11", cluster: "money", name: "Leaderboard top-5 earners", status: "wired", citation: "junior-backend/app/routes/leaderboard.py:69", endpoint: "GET /leaderboard/earnings", note: "Cached lifetime earnings; 6h cron refresh." },
  { id: "mo-12", cluster: "money", name: "Wallet ledger (compute_lifetime_paid)", status: "wired", citation: "junior-backend/app/wallet.py + me_wallet.py:137", note: "Append-only journal; ledger canonical over carrot counter (CM-T4)." },
  { id: "mo-13", cluster: "money", name: "Withdraw button (real payout)", status: "demo", citation: "junior-backend/app/carrot.py:80 (CARROT_WHOP_LIVE)", endpoint: "POST /me/carrot/claim", note: "Env-gated OFF; button hidden until Railway env flip.", blocker: true },
  { id: "mo-14", cluster: "money", name: "Stripe Connect Express onboarding", status: "demo", citation: "junior-backend/app/routes/stripe_connect.py:115 (backend alive) + desktop-2/src/design-os/routes/Settings.tsx:971 (desktop placeholder)", note: "Backend endpoint alive. Desktop Settings.tsx:971 renders 'Not checked yet · coming soon' placeholder; no /stripe-connect/onboarding call fires. Wire the desktop CTA before flipping to WIRED." },
  { id: "mo-15", cluster: "money", name: "Whop native payout rail (referral USDC)", status: "wired", citation: "junior-backend/app/routes/affiliate.py:150", note: "Whop /api/v1/affiliates is source of truth; Junior mirrors." },
  { id: "mo-16", cluster: "money", name: "Sponsored campaign submission (Uncle Daniel lanes)", status: "demo", citation: "desktop-2/src/design-os/campaigns/CampaignPageShell.tsx", note: "Opens Whop URL in webview; LC polls /whop/submissions/{id}. Watchdog-wrapped 2026-07-06 · money/mo-16/sponsored-campaign-submission." },
  { id: "mo-17", cluster: "money", name: "Sponsored reward module (viewCount + referralCount)", status: "wired", citation: "junior-backend/app/carrot.py:103", note: "CarrotProgressBlock + qualified flag." },
  { id: "mo-18", cluster: "money", name: "Affiliate widget (unified handle + share URL)", status: "wired", citation: "desktop-2/src/design-os/earn/AffiliateWidget.tsx", endpoint: "GET /affiliate/me", note: "Real Whop referral_url + affiliate_code." },
  { id: "mo-19", cluster: "money", name: "First-touch attribution + tracking redirect", status: "wired", citation: "junior-backend/app/routes/redirect.py:1", endpoint: "GET /r/{tracking_link_id}", note: "IP hashed daily; UA sanitized; referer host only." },
  { id: "mo-20", cluster: "money", name: "Boost pack ($9 thumbnail) purchase", status: "missing", citation: "no /boost-pack route", note: "Likely Whop product SKU or Clerk add-on; not a backend route yet." },

  // ── Agency + community + billing (29) ──
  { id: "ag-01", cluster: "agency", name: "Create agency workspace + upgrade", status: "wired", citation: "junior-backend/app/routes/agency.py", note: "Tier resolution via /me/affiliate." },
  { id: "ag-02", cluster: "agency", name: "Roster: view members / active / inactive", status: "wired", citation: "desktop-2/src/design-os/routes/agency-panels/RosterPanel.tsx:43", endpoint: "GET /agency/{id}/roster", note: "Members + pending invites + status." },
  { id: "ag-03", cluster: "agency", name: "Roster: invite by email (real Resend)", status: "wired", citation: "junior-backend/app/routes/agency.py:429", endpoint: "POST /agency/{id}/roster/invite", note: "Writes AgencyInvite + send_agency_invite via Resend — real email lands." },
  { id: "ag-04", cluster: "agency", name: "Roster: revoke pending invite", status: "wired", citation: "junior-backend/app/routes/agency.py:700", endpoint: "POST /agency/{id}/roster/invite/{id}/revoke", note: "Audits via _audit_agency." },
  { id: "ag-05", cluster: "agency", name: "Roster: remove member", status: "wired", citation: "junior-backend/app/routes/agency.py:743", endpoint: "DELETE /agency/{id}/roster/{user_id}", note: "Soft-delete + zeros split." },
  { id: "ag-06", cluster: "agency", name: "Roster: change member role", status: "wired", citation: "junior-backend/app/routes/agency.py:799", endpoint: "POST /agency/{id}/roster/{user_id}/role", note: "member ↔ mod flip + audit." },
  { id: "ag-07", cluster: "agency", name: "Agency campaigns: create / edit / publish", status: "wired", citation: "desktop-2/src/design-os/routes/AgencyCampaigns.tsx", endpoint: "POST/PATCH /agency/campaigns", note: "8-step wizard: reward → title → banner → links → discussion → targeting → featured → review." },
  { id: "ag-08", cluster: "agency", name: "Payout splits: define %", status: "wired", citation: "desktop-2/src/design-os/routes/agency-panels/PayoutSplitPanel.tsx:117", endpoint: "PUT /agency/{id}/payout-splits", note: "Sum-to-100 (10k bps); rejects non-active members." },
  { id: "ag-09", cluster: "agency", name: "Payout splits: enforce on RewardClip approval", status: "wired", citation: "PayoutSplitPanel.tsx:68 + backend accept_at logic", note: "Splits read on every approval." },
  { id: "ag-10", cluster: "agency", name: "Watermark removal → real card charge", status: "wired", citation: "desktop-2/src/lib/useWatermarkRemovalPaywall.ts + junior-backend/app/routes/trial_convert.py:123", endpoint: "POST /me/trial/approve", note: "Whop end_free_trial → real card charge on file." },
  { id: "ag-11", cluster: "agency", name: "Publish gate (tier check)", status: "wired", citation: "junior-backend/app/routes/publish.py:52", note: "_require_paid_tier gates on Solo+; 402 if free." },
  { id: "ag-12", cluster: "agency", name: "Trial approve early", status: "wired", citation: "junior-backend/app/routes/trial_convert.py:123", endpoint: "POST /me/trial/approve", note: "Best-effort Whop end_free_trial + trial_convert_approved_at stamp." },
  { id: "ag-13", cluster: "agency", name: "Cancel subscription (CM-T2)", status: "wired", citation: "junior-backend/app/routes/trial_convert.py:245", endpoint: "POST /me/trial/cancel", note: "Whop end_membership + access_ends_at return." },
  { id: "ag-14", cluster: "agency", name: "Founder seat cap 12k", status: "wired", citation: "junior-backend/app/routes/founder.py + webhooks_whop.py try_grant_founder_seat", note: "Enforced at both webhook + checkout-success paths." },
  { id: "ag-15", cluster: "agency", name: "Monthly-post cap enforcement", status: "wired", citation: "junior-backend/app/routes/publish.py _enforce_monthly_post_cap", note: "Tier + add-ons drive ceiling." },
  { id: "ag-16", cluster: "agency", name: "Onboarding email drip (14 Resend templates)", status: "wired", citation: "junior-backend/app/mailer.py:128-220", note: "welcome / subscription_activated / subscription_canceled / founder_welcome / license_activated / bounty_approved / bounty_rejected / affiliate_qualified / first_paid_referral / agency_invite + 4 more." },
  { id: "ag-17", cluster: "agency", name: "Community: 9 default rooms seeded", status: "wired", citation: "junior-backend/scripts/seed_community_channels.py", note: "Auto-seed on lifespan startup." },
  { id: "ag-18", cluster: "agency", name: "Community: chat panel (WhopChat)", status: "demo", citation: "junior-backend/app/agents/whop_chat.py + desktop-2/src/design-os/community/CommunityChatHome.tsx", note: "Fleet framework ready; WHOP_AGENT_ENABLED=false by default. Watchdog-wrapped 2026-07-06 · agency/ag-18/community-chat (shared with ag-19)." },
  { id: "ag-19", cluster: "agency", name: "Community: post message", status: "demo", citation: "whop_chat.py proxies + CommunityChatHome.tsx composer", note: "Proxies to Whop channel_id; no local message table. Watchdog coverage inherited from ag-18 wrap (same subtree)." },
  { id: "ag-20", cluster: "agency", name: "Notifications inbox UI", status: "demo", citation: "desktop-2/src/shell/InboxSheet.tsx + junior-backend /notifications route", note: "GET /notifications works; desktop InboxSheet renders local inbox store (records + email-status). Watchdog-wrapped 2026-07-06 · agency/ag-20/notifications-inbox." },
  { id: "ag-21", cluster: "agency", name: "Announcements", status: "demo", citation: "desktop-2/src/design-os/components/AnnouncementBanner.tsx (mounted from AppShell:119) + CommunityChannel.is_admin_only flag", note: "Model supports flag; Whop handles posting. Desktop banner stack reads /sync.active_announcements. Watchdog-wrapped 2026-07-06 · agency/ag-21/announcements." },
  { id: "ag-22", cluster: "agency", name: "Agency dashboard (analytics rollup)", status: "demo", citation: "account-app/src/app/agency/page.tsx:52", note: "Campaign list only; no unified analytics/payout dashboard." },
  { id: "ag-23", cluster: "agency", name: "Agency-preview gate (see-first-then-upgrade)", status: "demo", citation: "desktop-2/src/components/paywall/AgencyPreviewBanner.tsx", note: "Banner component exists; flow half-wired. Watchdog-wrapped 2026-07-06 · agency/ag-23/agency-preview-gate (covers both agency-tier pill and non-agency preview return branches)." },
  { id: "ag-24", cluster: "agency", name: "Boost pack purchase gate", status: "demo", citation: "desktop-2/src/design-os/schedule/ScheduleFromExportDrawer.tsx:338 (cap card + block upgrade CTA) + useTierCaps.monthlyPosts", note: "Dedicated boost-pack SKU is missing; today the monthly-cap warning renders an upgrade-to-next-tier CTA fired through billing.adapter.startCheckout inside the blocked GlassCard. Watchdog-wrapped 2026-07-06 · agency/ag-24/boost-pack-purchase (covers both cap-card + block-card CTA)." },
  { id: "ag-25", cluster: "agency", name: "Agency custom watermark / brand kit", status: "missing", citation: "no upload route · no gpt-image-1 wire · no template · sidecar.py:4793 hard-coded", note: "Small ~1sp (upload PNG) · Medium ~2sp (+gpt-image-1 generate) · Large ~4sp (full brand system)." },
  { id: "ag-26", cluster: "agency", name: "White-label domain / subdomain", status: "missing", citation: "no domain routing surface", note: "Post-Cohort 0 backlog." },
  { id: "ag-27", cluster: "agency", name: "Roster-scoped analytics rollup", status: "missing", citation: "no endpoint", note: "Leaderboard stub in backend CLAUDE.md; no agency-scoped rollup." },
  { id: "ag-28", cluster: "agency", name: "Sub-account management", status: "missing", citation: "FEATURES_BY_TIER.sub_accounts flag exists, no UI/endpoint", note: "Backend flag ready; no wire." },
  { id: "ag-29", cluster: "agency", name: "F5 Scanner → email crew from Gmail contacts (mailto: composer)", status: "wired", citation: "desktop-2/src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx onSend + desktop-2/src/lib/f5/sendComposer.ts (CM-T10 · 2026-07-05)", note: "Loops selectSendBatch → openSmart(mailto:) per row with 250ms stagger. Real emails go through user's own Mail client with sender's /affiliate/me referral URL threaded. 23 unit tests." },
];

// ── Cluster metadata ────────────────────────────────────────────────
const CLUSTER_META: Record<Cluster, { label: string; sub: string }> = {
  identity:  { label: "Identity + access", sub: "sign-in · session · settings" },
  pipeline:  { label: "Clip pipeline",     sub: "import → transcribe → cut → export" },
  money:     { label: "Distribution + money", sub: "publish · schedule · earn · payout" },
  agency:    { label: "Agency + community + billing", sub: "roster · campaigns · paywall · comms" },
};

// ── Component ──────────────────────────────────────────────────────
export function JourneyMapTab() {
  const [cluster, setCluster] = useState<Cluster | "all">("all");
  const [status, setStatus] = useState<Status | "all" | "blocker">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return JOURNEYS.filter((j) => {
      if (cluster !== "all" && j.cluster !== cluster) return false;
      if (status === "blocker") { if (!j.blocker) return false; }
      else if (status !== "all" && j.status !== status) return false;
      if (qLower && !j.name.toLowerCase().includes(qLower) && !j.citation.toLowerCase().includes(qLower) && !j.note.toLowerCase().includes(qLower)) return false;
      return true;
    });
  }, [cluster, status, q]);

  const stats = useMemo(() => {
    const per: Record<Cluster, { total: number; wired: number; demo: number; missing: number }> = {
      identity: { total: 0, wired: 0, demo: 0, missing: 0 },
      pipeline: { total: 0, wired: 0, demo: 0, missing: 0 },
      money:    { total: 0, wired: 0, demo: 0, missing: 0 },
      agency:   { total: 0, wired: 0, demo: 0, missing: 0 },
    };
    let blockers = 0;
    for (const j of JOURNEYS) {
      per[j.cluster].total += 1;
      per[j.cluster][j.status] += 1;
      if (j.blocker) blockers += 1;
    }
    const total = JOURNEYS.length;
    const wired = JOURNEYS.filter((j) => j.status === "wired").length;
    const demo = JOURNEYS.filter((j) => j.status === "demo").length;
    const missing = JOURNEYS.filter((j) => j.status === "missing").length;
    return { per, total, wired, demo, missing, blockers, pct: Math.round((wired / total) * 100) };
  }, []);

  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* Header + overall score */}
      <div className="rounded-2xl border border-line bg-paper-warm p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-ink">Customer Journey Map</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">state of truth · updated 2026-07-05 · CM-T7/T8/T10 landed · Cohort 0 blockers cleared</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatChip label="wired"   value={stats.wired}   tone="ok"   />
            <StatChip label="demo"    value={stats.demo}    tone="pending" />
            <StatChip label="missing" value={stats.missing} tone="fail" />
            <StatChip label="Cohort 0 blockers" value={stats.blockers} tone={stats.blockers === 0 ? "ok" : "fail"} />
            <span className="rounded-full border border-fuchsia bg-fuchsia-soft px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-fuchsia-deep">
              {stats.pct}% wired
            </span>
          </div>
        </div>

        {/* Per-cluster mini bars */}
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          {(["identity","pipeline","money","agency"] as Cluster[]).map((c) => {
            const s = stats.per[c];
            const pct = Math.round((s.wired / s.total) * 100);
            return (
              <button
                key={c}
                onClick={() => setCluster(cluster === c ? "all" : c)}
                className={`text-left rounded-xl border p-3 transition-colors ${cluster === c ? "border-fuchsia bg-fuchsia-soft" : "border-line bg-paper hover:border-fuchsia"}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[13px] font-semibold text-ink">{CLUSTER_META[c].label}</span>
                  <span className="font-mono text-[11px] font-bold text-fuchsia-deep">{pct}%</span>
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.10em] text-text-tertiary">{CLUSTER_META[c].sub}</div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="bg-[var(--lc-ok,#4dc6a8)]" style={{ width: `${(s.wired/s.total)*100}%` }} />
                  <div className="bg-[var(--lc-warn,#d99b2d)]" style={{ width: `${(s.demo/s.total)*100}%` }} />
                  <div className="bg-fuchsia" style={{ width: `${(s.missing/s.total)*100}%` }} />
                </div>
                <div className="mt-1 font-mono text-[10px] text-text-secondary">
                  {s.wired} wired · {s.demo} demo · {s.missing} missing · {s.total} total
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Waiting on you · Cohort 0 close-out strip */}
      <div className="rounded-2xl border border-fuchsia bg-fuchsia-soft p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="font-display text-[14px] font-semibold text-ink">Waiting on Daniel · Cohort 0 close-out</h3>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">Session closed 2026-07-05 · C1 lane + CM lane both signed off · code side is done</p>
          </div>
          <span className="rounded-full border border-fuchsia bg-paper px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.10em] text-fuchsia-deep">
            2 actions
          </span>
        </div>
        <ol className="mt-3 space-y-2 font-mono text-[11px] text-ink">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia" />
            <span><strong>Hide canary plan</strong> · Whop dashboard · plan_m5VlS0xghUdJW · 30-second click · API PATCH/DELETE both 401 with current scope</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia" />
            <span><strong>Build + install</strong> · <code className="text-fuchsia-deep">npm run tauri build</code> in desktop-2 · installs the new Founder plan URL + all CM-T7/T8/T10 wires · verify: click Publish, drop file, post</span>
          </li>
        </ol>
        <p className="mt-3 font-mono text-[10px] text-text-tertiary">Post-launch (organic traffic): flip <code>CARROT_WHOP_LIVE=true</code> on Railway to surface Withdraw button · Carrot is for organic users not cold-email cohort so it&apos;s not a Cohort 0 blocker. Also queued: agency custom watermark (S/M/L pick) · white-label domain · roster analytics · sub-accounts · batch export · boost-pack purchase surface.</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPill label="all"     active={status === "all"}     onClick={() => setStatus("all")} />
        <FilterPill label="wired"   active={status === "wired"}   onClick={() => setStatus("wired")}   tone="ok" />
        <FilterPill label="demo"    active={status === "demo"}    onClick={() => setStatus("demo")}    tone="pending" />
        <FilterPill label="missing" active={status === "missing"} onClick={() => setStatus("missing")} tone="fail" />
        <FilterPill label="Cohort 0 blockers" active={status === "blocker"} onClick={() => setStatus("blocker")} tone="fail" />
        <span className="mx-2 h-4 w-px bg-line" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search journey / file / note…"
          className="flex-1 min-w-[200px] rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-fuchsia"
          aria-label="Search journeys"
        />
        <span className="font-mono text-[11px] text-text-tertiary">{filtered.length} of {JOURNEYS.length}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-line text-left uppercase tracking-[0.10em] text-text-tertiary">
              <th className="px-3 py-2 font-normal">status</th>
              <th className="px-3 py-2 font-normal">cluster</th>
              <th className="px-3 py-2 font-normal">journey</th>
              <th className="px-3 py-2 font-normal">endpoint</th>
              <th className="px-3 py-2 font-normal">citation</th>
              <th className="px-3 py-2 font-normal">evidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => (
              <tr key={j.id} className="border-b border-line/60 align-top text-ink">
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusChip status={j.status} />
                  {j.blocker && <span className="ml-1 rounded-full border border-fuchsia bg-fuchsia-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.10em] text-fuchsia-deep">P0</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-text-secondary">{CLUSTER_META[j.cluster].label.split(" +")[0]}</td>
                <td className="px-3 py-2">{j.name}</td>
                <td className="px-3 py-2 whitespace-nowrap text-fuchsia-deep">{j.endpoint ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-text-secondary">{j.citation}</td>
                <td className="px-3 py-2 text-text-secondary">{j.note}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-tertiary">no journeys match this filter</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[10px] text-text-tertiary">
        Static source of truth. Update <code className="text-ink">JourneyMapTab.tsx</code> same-turn when a wire changes. Any WIRED row must include a grep-able file:line citation. Sits alongside SystemMapTab (architecture health probes) — this tab is customer-flow completeness.
      </p>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────
function StatChip({ label, value, tone }: { label: string; value: number; tone: "ok" | "pending" | "fail" }) {
  const style: React.CSSProperties =
    tone === "ok" ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" }
    : tone === "pending" ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" }
    : { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft, rgba(255, 26, 140, 0.10))", color: "var(--lc-accent-mid, #ff66b8)" };
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.10em]" style={style}>
      <span className="font-bold">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function FilterPill({ label, active, onClick, tone }: { label: string; active: boolean; onClick: () => void; tone?: "ok" | "pending" | "fail" }) {
  const baseStyle: React.CSSProperties = active
    ? tone === "ok"       ? { borderColor: "rgba(77, 198, 168, 0.6)", background: "rgba(77, 198, 168, 0.14)", color: "var(--lc-ok)" }
    : tone === "pending"  ? { borderColor: "rgba(217, 155, 45, 0.6)", background: "rgba(217, 155, 45, 0.14)", color: "var(--lc-warn)" }
    : tone === "fail"     ? { borderColor: "rgba(255, 102, 184, 0.6)", background: "var(--lc-accent-soft, rgba(255, 26, 140, 0.14))", color: "var(--lc-accent-mid, #ff66b8)" }
    : { borderColor: "var(--color-fuchsia)", background: "var(--color-fuchsia-soft)", color: "var(--color-fuchsia-deep)" }
    : { borderColor: "var(--color-line)", background: "var(--color-paper)", color: "var(--color-ink)" };
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.10em] hover:border-fuchsia"
      style={baseStyle}
    >
      {label}
    </button>
  );
}

function StatusChip({ status }: { status: Status }) {
  const cfg =
    status === "wired"   ? { label: "wired",   style: { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" } }
    : status === "demo"  ? { label: "demo",    style: { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" } }
    :                      { label: "missing", style: { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft, rgba(255, 26, 140, 0.10))", color: "var(--lc-accent-mid, #ff66b8)" } };
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]" style={cfg.style}>
      {cfg.label}
    </span>
  );
}
