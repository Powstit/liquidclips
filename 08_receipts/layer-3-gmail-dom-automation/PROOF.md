# Proof · Layer 3 · Gmail DOM automation (F6)

De-scoped per Daniel's 2026-07-04 unblock message: real Gmail E2E is his
manual step at `signoff G1`; my proof list swaps to jsdom-tested driver +
synthetic captcha + synthetic circuit-breaker + rate-limit + webview_eval
diff.

## artifacts
- vitest.txt · assert: "15 passed"
- vitest.txt · assert: "primary selector hits on a fresh Gmail DOM"
- vitest.txt · assert: "secondary selector fires when primary is missing"
- vitest.txt · assert: "tertiary selector fires when primary + secondary missing"
- vitest.txt · assert: "pauses the send flow when a captcha interstitial is present"
- vitest.txt · assert: "blocks the 101st send in a 24h window"
- vitest.txt · assert: "allows the 100th send but blocks the 101st"
- vitest.txt · assert: "opens after 3 misses in the rolling window and captures an HTML dump"
- vitest.txt · assert: "driver refuses to send when the breaker is open"
- vitest.txt · assert: "per-char delay lands in the 60-140ms window"
- vitest.txt · assert: "between-sends delay lands in the 6-12s window"
- gmail-dom-dump.html · assert: exists
- gmail-dom-dump.html · assert: size > 100
- circuit-breaker-log.txt · assert: "CIRCUIT_OPEN"
- circuit-breaker-log.txt · assert: "SELECTOR_MISS"
- circuit-breaker-log.txt · assert: "dumpedTo="
- queue-state-50-sends.png · assert: exists
- queue-state-50-sends.png · assert: size > 5000
- webview-eval-diff.txt · assert: "webview_eval"
- webview-eval-diff.txt · assert: "browse.rs"
- webview-eval-diff.txt · assert: "browse::webview_eval"
- scope-notes.md · assert: exists
