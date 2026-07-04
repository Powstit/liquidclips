# Proof · Port · cold-email-preview-embed-card

Section B port #7 · component (not a route). Slotted into campaign-
builder hero for SENDER-side preview. 7 states per D2 v1.1. Every
§13 lock applied.

## artifacts
- mockup-populated.png · assert: exists
- mockup-populated.png · assert: size > 5000
- mockup-loading.png · assert: exists
- mockup-critical_countdown.png · assert: exists
- mockup-already_settled.png · assert: exists
- mockup-expired.png · assert: exists
- mockup-empty_catalog.png · assert: exists
- mockup-offline.png · assert: exists
- port-diff.txt · assert: "loading"
- port-diff.txt · assert: "populated"
- port-diff.txt · assert: "empty_catalog"
- port-diff.txt · assert: "critical_countdown"
- port-diff.txt · assert: "already_settled"
- port-diff.txt · assert: "expired"
- port-diff.txt · assert: "offline"
- port-diff.txt · assert: "'£' rendered occurrences: 0"
- port-diff.txt · assert: "'$99.99' occurrences: 10"
- port-diff.txt · assert: "'kade-generating-captions'"
- port-diff.txt · assert: "'kade-earn-mode'"
- port-diff.txt · assert: "'kade-idle'"
- port-diff.txt · assert: "'kade-warning'"
- port-diff.txt · assert: "'kade-success'"
- port-diff.txt · assert: "'kade-hover'"
- port-diff.txt · assert: "'kade-error'"
- port-diff.txt · assert: "kade-warning.webp: present"
- port-diff.txt · assert: "epc-hud-tr/br brackets: 4"
- port-diff.txt · assert: "'bounty' occurrences: 0"
- scope-notes.md · assert: exists
- scope-notes.md · assert: "7 states"
- scope-notes.md · assert: "$99.99"
- scope-notes.md · assert: "§13"
