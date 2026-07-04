# Proof · Port · login-activation

Section B port #2. 11 real states per D2 v1.1 slug map. Preserves
IG-004 activation.ts state machine — reads `useActivation()`, does not
mutate internals.

## artifacts
- mockup-idle.png · assert: exists
- mockup-idle.png · assert: size > 5000
- mockup-waiting.png · assert: exists
- mockup-activating.png · assert: exists
- mockup-activated.png · assert: exists
- mockup-activated_degraded.png · assert: exists
- mockup-failed.png · assert: exists
- mockup-already_activated.png · assert: exists
- mockup-inapp_panel_open.png · assert: exists
- mockup-inapp_fallback.png · assert: exists
- mockup-manual_paste.png · assert: exists
- mockup-offline.png · assert: exists
- port-diff.txt · assert: "activation.ts preserved (IG-004)"
- port-diff.txt · assert: "'authStorage.setJwt' calls in port: 0"
- port-diff.txt · assert: "'clearJwt' calls in port: 0"
- port-diff.txt · assert: "'bounty' occurrences: 0"
- port-diff.txt · assert: "'idle'"
- port-diff.txt · assert: "'inapp_panel_open'"
- port-diff.txt · assert: "'inapp_fallback'"
- port-diff.txt · assert: "'manual_paste'"
- port-diff.txt · assert: "'offline'"
- scope-notes.md · assert: exists
- scope-notes.md · assert: "11 states"
- scope-notes.md · assert: "IG-004"
