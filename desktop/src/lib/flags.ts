// Build-time capability flags for honest launch posture.
//
// Publishing (publish-now / schedule / drip) runs through the hidden Postiz
// engine, which is NOT deployed to prod yet: no POSTIZ_CLIENT_ID/SECRET set,
// the cron fire path is a stub, and media isn't uploaded at schedule time. Until
// that path is configured + verified end-to-end, publishing ships DISABLED with
// a clear Beta notice — never a silent stub that pretends to post. Flip to true
// once the real Postiz path is live and tested (see docs/launch-hardening-checklist.md).
export const PUBLISHING_ENABLED: boolean = false;
