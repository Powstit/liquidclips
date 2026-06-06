// Build-time capability flags for honest launch posture.
//
// Publishing (publish-now / schedule / drip) runs through Ayrshare as of P1
// (2026-05-30, see docs/CLAUDE_BUILD_BRIEF.md). Each user pastes their
// Ayrshare Profile Key into Settings → Connections, which the backend stores
// in social_connections. Publish features now flip themselves on/off via the
// backend's `built` flag (AYRSHARE_API_KEY presence on Railway), so this
// constant is the UI's *show the surface at all* switch. Leave true: the
// surface should be visible everywhere, individual actions degrade to 503/412
// (Connect first / Server beta) at call time.
// If true, ScheduleQueue is always shown; the "coming soon" fallback in
// SchedulePage is dead code unless this flips to false. Verified
// 2026-06-06: every consumer (SchedulePage, PublishModal, WorkspaceHeader)
// just renders the live surface. Don't delete the fallback — it's the
// kill-switch for the "Ayrshare went down" PR-friendly path.
export const PUBLISHING_ENABLED: boolean = true;

// Hosted LLM (Liquid Clips supplies the model credits so users don't bring an OpenAI
// key) is NOT built — the desktop always resolves the key locally
// (env → keychain → dev file). Until a real hosted path ships, every tier needs
// their own OpenAI key for clip-picking, so the pipeline guards on key presence.
// Flip to true only when a tested hosted-LLM proxy is live.
export const HOSTED_LLM_ENABLED: boolean = false;

// Browse Rewards in-app side panel — Tauri child-webview shipping in 0.4.34
// (graduated from 2026-05-28 spike). Implements URL filter for commerce
// paths (/checkout, /pay, /billing, /upgrade, /subscribe, /purchase, /cart)
// bouncing those to the system browser via shell.open — App Store
// Guideline 3.1.1 mitigation. ON by default in production; can be disabled
// for one-off dev/QA builds with VITE_BROWSE_PANEL=0.
export const BROWSE_PANEL_ENABLED: boolean =
  import.meta.env.VITE_BROWSE_PANEL !== "0" && import.meta.env.VITE_BROWSE_PANEL !== "false";
