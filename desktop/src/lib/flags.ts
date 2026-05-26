// Build-time capability flags for honest launch posture.
//
// Publishing (publish-now / schedule / drip) runs through the hidden Postiz
// engine, which is NOT deployed to prod yet: no POSTIZ_CLIENT_ID/SECRET set,
// the cron fire path is a stub, and media isn't uploaded at schedule time. Until
// that path is configured + verified end-to-end, publishing ships DISABLED with
// a clear Beta notice — never a silent stub that pretends to post. Flip to true
// once the real Postiz path is live and tested (see docs/launch-hardening-checklist.md).
export const PUBLISHING_ENABLED: boolean = false;

// Hosted LLM (Junior supplies the model credits so users don't bring an OpenAI
// key) is NOT built — the desktop always resolves the key locally
// (env → keychain → dev file). Until a real hosted path ships, every tier needs
// their own OpenAI key for clip-picking, so the pipeline guards on key presence.
// Flip to true only when a tested hosted-LLM proxy is live.
export const HOSTED_LLM_ENABLED: boolean = false;
