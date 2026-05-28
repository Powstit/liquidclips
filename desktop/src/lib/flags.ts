// Build-time capability flags for honest launch posture.
//
// Publishing (publish-now / schedule / drip) runs through the hidden Postiz
// engine, which is NOT deployed to prod yet: no POSTIZ_CLIENT_ID/SECRET set,
// the cron fire path is a stub, and media isn't uploaded at schedule time. Until
// that path is configured + verified end-to-end, publishing ships DISABLED with
// a clear Beta notice — never a silent stub that pretends to post. Flip to true
// once the real Postiz path is live and tested (see docs/launch-hardening-checklist.md).
export const PUBLISHING_ENABLED: boolean = false;

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
