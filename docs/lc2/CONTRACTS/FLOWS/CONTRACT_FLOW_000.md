# CONTRACT_FLOW_000 — App shell

```
Contract ID:           CONTRACT_FLOW_000_APP_SHELL
Flow ID:               FLOW_000_APP_SHELL
Section IDs:           SECTION_HOME (default route), all sections (rail)
Entry source:          OS app launch; OS deep-link delivery
Allowed entry points:  app icon, liquidclips:// URL via OS handler
State owner:           shell only — no business stores at boot
Allowed dependencies:  Tauri runtime, React DOM, section registry,
                       Clerk session cookie (read-only hydrate of ACCOUNT)
Forbidden dependencies: any store, any sidecar invoke, any backend call,
                        any keychain read, any Whop API call, any Ayrshare call
Side effects on launch (allowed):
  - read app version string
  - hydrate ACCOUNT user from Clerk session cookie (no token network call)
  - register deep-link handler
  - register auto-update check
  - register section route table
Side effects on launch (forbidden):
  - read keychain
  - call Whop license endpoint
  - call Ayrshare /me
  - probe sidecar RPCs
  - mount COMMUNITY, EARN, SCHEDULE, CHANNELS, SETTINGS, EDITOR, PROJECTS state
  - prefetch any /api/* on backend

Success path:          shell mounts, side nav shows all sections, default
                       route lands on /home, flowTrace records
                       FLOW_000_APP_SHELL/section.activated for HOME.
Failure path:          missing section component → fall back to HOME, write
                       critical row in healthCheck, emit a flowTrace warning.
Events emitted:        deeplink.received (when OS delivers a deep-link URL)
Events listened to:    license.refreshed (only ACCOUNT re-hydrate consumer
                       of this event lives in shell; the section consumes it)

Manual Daniel test:
  - launch the app cold (kill if running first)
  - confirm OS does NOT show a keychain prompt
  - confirm OS does NOT show a network permission prompt on first launch
  - click every nav item; each renders an empty/fixture page
  - close + reopen — same behaviour
  - from terminal: `open "liquidclips://open?section=schedule&tab=channels"`
    — Schedule tab opens, channels sub-tab is selected

Automated guard:
  - scripts/assert-shell-contracts.sh passes
  - Playwright (later): with network blocked, the shell mounts and renders
    every section without console errors.

Lock status:           unlocked. Locks at end of Phase 1 (IG-LC2-001).
```
