# Proof · Port · Contextual overlays #8b (partial · #1 BLOCKED)

Section B port #8b. Shared DemoOverlay component landed + wired into
3 of the 4 target routes. #1 (BuildHero) is BLOCKED — the route
`desktop-2/src/routes/build/BuildHero.tsx` does not exist in the tree.
See `scope-notes.md` for the clarification ask.

## artifacts
- port-diff.txt · assert: "DemoOverlay.tsx"
- port-diff.txt · assert: "DemoOverlay.css"
- port-diff.txt · assert: "BuildHero.tsx: BLOCKED"
- port-diff.txt · assert: "#2 LoginActivation wire-in"
- port-diff.txt · assert: "#3 SyncMailMoneyDrop wire-in"
- port-diff.txt · assert: "#4 WalletDetail wire-in"
- port-diff.txt · assert: "demo-shown-login"
- port-diff.txt · assert: "demo-shown-sync-mail"
- port-diff.txt · assert: "demo-shown-wallet"
- port-diff.txt · assert: "02-login-activation.mp4: present"
- port-diff.txt · assert: "03-money-moment.mp4: present"
- port-diff.txt · assert: "04-wallet-payouts.mp4: present"
- port-diff.txt · assert: "kade-reading-brief.webp"
- port-diff.txt · assert: "kade-earn-mode.webp"
- port-diff.txt · assert: "kade-success.webp"
- port-diff.txt · assert: "poster pointer-events: none · z-index 0: 1"
- port-diff.txt · assert: "is-playing hides poster: 1"
- port-diff.txt · assert: "'bounty' occurrences: 0"
- scope-notes.md · assert: exists
- scope-notes.md · assert: "BLOCKED"
- scope-notes.md · assert: "BuildHero"
- scope-notes.md · assert: "3 of 4"
