# Proof · Port · in-app-browser

Section B port #4. BrowseOverlay chrome reskin. 11 states covering the
D2 v1.1 slug map + 2 new ones for the sync-mail button family (Daniel
2026-07-04).

## artifacts
- mockup-default.png · assert: exists
- mockup-default.png · assert: size > 5000
- mockup-loading.png · assert: exists
- mockup-whop-checkout.png · assert: exists
- mockup-youtube-auth.png · assert: exists
- mockup-engine-consumable.png · assert: exists
- mockup-gmail-inbox.png · assert: exists
- mockup-add-shortcut-open.png · assert: exists
- mockup-maximized.png · assert: exists
- mockup-error.png · assert: exists
- port-diff.txt · assert: "'default'"
- port-diff.txt · assert: "'loading'"
- port-diff.txt · assert: "'error'"
- port-diff.txt · assert: "'maximized'"
- port-diff.txt · assert: "'gmail-inbox'"
- port-diff.txt · assert: "'whop-checkout'"
- port-diff.txt · assert: "'youtube-auth'"
- port-diff.txt · assert: "'engine-consumable'"
- port-diff.txt · assert: "'add-shortcut-open'"
- port-diff.txt · assert: "'outreach-inbox'"
- port-diff.txt · assert: "'other-mail-linked'"
- port-diff.txt · assert: "onSyncGmail"
- port-diff.txt · assert: "onSyncOther"
- port-diff.txt · assert: "Sync Gmail"
- port-diff.txt · assert: "'kade-community-mode'"
- port-diff.txt · assert: "'kade-earn-mode'"
- port-diff.txt · assert: "'kade-error'"
- port-diff.txt · assert: "'kade-hover'"
- port-diff.txt · assert: "'kade-idle'"
- port-diff.txt · assert: "'bounty' occurrences: 0"
- scope-notes.md · assert: exists
- scope-notes.md · assert: "sync-mail"
- scope-notes.md · assert: "browse.rs untouched"
- scope-notes.md · assert: "11 states"
