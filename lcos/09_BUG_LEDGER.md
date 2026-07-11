# 09 · Bug Ledger

**No bug exists only in conversation.** Every bug lives here, structured, with business consequence and confidence. Populated in P1.

DECISION-0004 · Anthropic never closes a bug. Only proof closes a bug.

## Schema

```
BUG-XXX
Symptom (customer-visible):     <one sentence>
Root cause (technical):         <mechanism>
Root cause (business):          <which product decision or missing piece>
Confidence root cause:          <0.00 – 1.00>
Affected capabilities:          [capability.id, ...]
Affected journeys:              [journey.id, ...]
Affected stations:              [station.id, ...]
Files involved:                 [file:line, ...]
Business consequence:
  Revenue:                      <CRITICAL | HIGH | MEDIUM | LOW>
  Support:                      <CRITICAL | HIGH | MEDIUM | LOW>
  Trust:                        <CRITICAL | HIGH | MEDIUM | LOW>
  Conversion:                   <CRITICAL | HIGH | MEDIUM | LOW>
Confidence business consequence: <0.00 – 1.00>
Severity (composite):           <P0 | P1 | P2>
Canonical source of truth:      <state.id | endpoint.id>
Assigned branch:                <branch | unassigned>
Status:                         <OPEN | IN_PROGRESS | AWAITING_PROOF | CLOSED>
Permanent fix (proposed):       <one paragraph>
Regression test:                <test.id>
Closes only when:               [assertion, ...]
Evidence when closed:           [proof.id, ...]
Dependencies:                   [BUG-YYY, ...]
Discovered:                     <YYYY-MM-DD>
Opened by:                      <person>
Closed:                         <YYYY-MM-DD | null>
Closed by:                      <person | null>
```

## Ledger

*Rows populated in P1 · Wave 1 containment · see `09_BUGS_TARGET.md` for the 14 known open bugs to seed.*

The 14 seeds identified in this thread:
- BUG-001 · Campaigns click telemetry not emitting
- BUG-002 · Authenticated user shows Guest·Admin in avatar (P10 target)
- BUG-003 · No handle claim path · no LC-ID visible surface
- BUG-004 · "Connect Whop" not visible from all states
- BUG-005 · Notifications badge drifts from empty inbox
- BUG-006 · Version pill shows shell version when runtime differs
- BUG-007 · `__APP_VERSION__` still hardcoded in Settings, IntroSplash, DiagnosticsSection
- BUG-008 · ExportPanel + OverlayTemplateGallery + ReactionControls default `userTier="free"`
- BUG-009 · Update Beacon 404-polls `/runtime/manifest.json`
- BUG-010 · Learn nav item visibility in cold-boot walkthrough uncertain
- BUG-011 · `text-transform: uppercase` obscures identity pill copy verification
- BUG-012 · Bundle hot-swap requires quit+relaunch · Cmd+R alone doesn't stick
- BUG-013 · "Good evening ✦" static — never personalized
- BUG-014 · Home hero copy lacks Whop CTA when unconnected

Full rows land in P1.

## Closure gate (locked)

A bug flips to CLOSED only when `Closes only when` block is entirely green. Doctor Mode (13) verifies. Ship-lens refuses merge if any CLOSED bug has ungreen assertions.
