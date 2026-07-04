# Proof · Port · wallet-detail

Section B port #3. 6 scrubber states (fresh-install + populated + 4
hover demos). Hover uses native CSS `:hover` — `page.hover()` in
Playwright fires the same. Rows tagged `data-tile` per D2 v1.1.

## artifacts
- mockup-fresh-install.png · assert: exists
- mockup-fresh-install.png · assert: size > 5000
- mockup-populated.png · assert: exists
- mockup-hover-marques.png · assert: exists
- mockup-hover-ali.png · assert: exists
- mockup-hover-airrack.png · assert: exists
- mockup-hover-johnny.png · assert: exists
- port-diff.txt · assert: "streak-row-0"
- port-diff.txt · assert: "streak-row-1"
- port-diff.txt · assert: "missed-row-0"
- port-diff.txt · assert: "cancelled-row-0"
- port-diff.txt · assert: "paid-row-0"
- port-diff.txt · assert: "founder-wallet.mp4: present"
- port-diff.txt · assert: "kade-celebration.webp: present"
- port-diff.txt · assert: "kade-error.webp: present"
- port-diff.txt · assert: "kade-idle.webp: present"
- port-diff.txt · assert: "kade-success.webp: present"
- port-diff.txt · assert: "kadePose: 'celebration'"
- port-diff.txt · assert: "kadePose: 'error'"
- port-diff.txt · assert: "kadePose: 'idle'"
- port-diff.txt · assert: "kadePose: 'success'"
- port-diff.txt · assert: "'bounty' occurrences: 0"
- port-diff.txt · assert: "onMouseEnter"
- scope-notes.md · assert: exists
- scope-notes.md · assert: "$50/mo"
- scope-notes.md · assert: "page.hover()"
- scope-notes.md · assert: "founder-wallet.mp4"
