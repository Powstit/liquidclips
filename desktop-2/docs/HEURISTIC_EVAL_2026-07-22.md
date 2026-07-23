# Liquid Clips · Heuristic Evaluation · 2026-07-22

**Evaluator:** Claude (Opus 4.7) acting as expert UX reviewer
**Method:** Nielsen Norman Group · 10 Usability Heuristics (Nielsen 1994 · refined 2020)
**Surfaces evaluated:** WelcomeRoute · Home cockpit · Composer / ComposerSuiteFrame · Workstation · Wallet (money surface) · Earn · Campaigns · Settings · Diagnostic Center · Update Pill · BootErrorBoundary
**Severity scale:** 0 = cosmetic · 1 = minor · 2 = major · 3 = catastrophe · 4 = blocker

Findings ranked most-severe first. Each finding lists file:line evidence so the fix is unambiguous. Reference: [Nielsen · How to Conduct a Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/).

---

## Findings ranked by severity

### P0 · Catastrophe · fix before launch (ALL 3 SHIPPED 2026-07-22 · IG-fenced)

| ID | Heuristic | Surface | Finding | Fix status | Evidence |
|---|---|---|---|---|---|
| H0-01 | H9 Recognize errors | KadeSpeechBubble | Silent "Try again" dismiss-only bubble on any UNKNOWN error. | ✅ SHIPPED · KadeSpeechBubble now renders a real action button (diagnostics / retry / settings / signin / browse-supported). AppShell forwards `safe.action` through. `IG-KADE-BUBBLE-ACTIONABLE` fence · 14 lint guards + 9 vitest tests. | `src/design-os/components/KadeSpeechBubble.tsx` · `src/design-os/components/AppShell.tsx:194,258,186` |
| H0-02 | H5 Error prevention | ComposerSuiteFrame record tiles | "Coming soon" tiles fired handler at runtime even with pointer-events: none. | ✅ SHIPPED · runtime guard added: `if (b.getAttribute("data-status") === "coming-soon") { bubble(...); return; }`. `IG-COCKPIT-COMING-SOON-GUARD` fence · 5 lint guards. | `public/mockup/composer-suite.html:6086-6099` |
| H0-03 | H1 Visibility of status | Home cockpit / TopHud | No persistent backend health signal — Railway outage looked like user fault. | ✅ SHIPPED · new `ServerHealthDot` component polls /healthcheck every 60s · 4 states (grey/green/amber/red) · red click → #/diagnostics. Mounted in TopHud alongside WhopStatusChip. `IG-SERVER-HEALTH-DOT` fence · 7 lint guards + 10 vitest tests. | `src/design-os/components/ServerHealthDot.tsx` · `src/design-os/components/TopHud.tsx:29,691` |

### P1 · Major · fix in first patch after launch

| ID | Heuristic | Surface | Finding | Evidence | Fix |
|---|---|---|---|---|---|
| H1-01 | H2 Match real world | WelcomeRoute | "Kade" is introduced with no explanation. New user sees a character named Kade and no context. | `src/design-os/routes/WelcomeRoute.tsx` shows Kade hero image immediately. | Add a one-liner subtitle on WelcomeRoute: "Kade is your AI clipping partner — you'll meet him inside." |
| H1-02 | H3 User control | Composer | No cancel button for in-flight clip generation. Once fired, user waits or force-quits. | Cockpit-drivetrain drives progress state · no `state.cancellable = true` branch. | Add cancel button when `state.status === "working"` · wire to `sidecar.cancel(slug)`. |
| H1-03 | H4 Consistency | Composer/Campaigns | "Campaign" (Composer submit) vs "Bounty" (Whop) vs "Mission" (Uncle Daniel) — three names for the same $-earn concept. | Multiple surface labels · `WhopAction.BOUNTY_CREATE` vs `campaign.submit`. | Pick ONE. Ship-lens should grep-lint the app for the three synonyms and settle on "Bounty" per Whop-native language. |
| H1-04 | H6 Recognition | Composer | Voice input via `beginOneShotVoiceCapture` is invisible to new users. No affordance says "you can speak to Kade." | `voiceInput.ts` fires only on explicit `voice.toggle` action. | Add a persistent microphone icon next to the command input · click-to-toggle · always visible. |
| H1-05 | H7 Flexibility | Home + Composer | No keyboard-shortcut cheatsheet. F2 hotkey exists (screen record) but is hidden. ⌘⇧K exists (kill remote) but is hidden. | Only mentioned in memory + iron-gate lint. | Add a "Shortcuts" panel triggered by ? key · list all hotkeys · always accessible. |
| H1-06 | H9 Recognize errors | Boot boundary | BootErrorBoundary text is "Kade hit a snag." — brand-friendly but doesn't tell the user WHAT went wrong. | `src/lib/BootErrorBoundary.tsx:96-100`. | Add the error name (e.g. "Network unreachable" · "Login failed") to the copy so user knows if to try again vs contact support. |
| H1-07 | H10 Help | Settings + Learn route | Learn route exists in section registry but has no visible entry point from Home. | `src/routes/learn/` present · no nav link. | Add "Learn" tab to ConsoleNav · surface Kade tutorial + keyboard shortcuts + common tasks. |

### P2 · Minor · queue for a later cycle

| ID | Heuristic | Surface | Finding | Evidence | Fix |
|---|---|---|---|---|---|
| H2-01 | H1 Visibility | Update pill | Pill fires after 60s poll but no visible "checking for updates" state. If polling is broken, user has no signal. | `src/components/UpdateReadyPill.tsx`. | Add a subtle spinner state during poll · appear only in dev builds. |
| H2-02 | H4 Consistency | Screen record | F2 fires screen record from anywhere. But "Screen Recording" tile on Home ALSO fires it. Two entry points. | FINISH-8 wired both. | Not a bug — just document in tooltip: "F2 or click the tile" · consistent affordance. |
| H2-03 | H8 Minimalist | Diagnostic Center | Diagnostic Center exposes technical fields that mean nothing to end users (correlation_id, schema_version). | `src/design-os/routes/DiagnosticCenter.tsx`. | Gate technical view behind a "Show technical details" toggle · default = user-facing summary. |
| H2-04 | H6 Recognition | Founder moments | Founder video autoplay but no visible "skip" button in first 3s. | `src/components/founder/FounderMoments.tsx`. | Add a small skip control that fades in after 3s. |
| H2-05 | H10 Help | WelcomeRoute | New user can't see the marketing site from the app. No back-out to liquidclips.app. | WelcomeRoute takes over the whole viewport. | Small "About Liquid Clips →" link on the WelcomeRoute footer opening in-app browser. |

### P3 · Cosmetic · low priority

| ID | Heuristic | Surface | Finding | Fix |
|---|---|---|---|---|
| H3-01 | H8 Minimalist | Composer | The mockup uses a lot of amber highlight — some users may find it fatiguing after 30 min. | Consider a Focus mode toggle that dampens amber accents. |
| H3-02 | H8 Minimalist | Home cockpit | Multiple "Coming Soon" tiles feel like an unfinished demo. | Group all Coming Soon into one collapsed drawer. |

---

## Heuristic-by-heuristic summary

| Heuristic | Findings | Severity max | Verdict |
|---|---|---|---|
| H1 · Visibility of system status | 2 | ✅ H0-03 fixed | 1 P2 remains |
| H2 · Match system + real world | 1 | P1 | Fix in first patch |
| H3 · User control + freedom | 1 | P1 | Fix in first patch |
| H4 · Consistency + standards | 2 | P1 (H1-03) | Fix in first patch |
| H5 · Error prevention | 1 | ✅ H0-02 fixed | Green |
| H6 · Recognition over recall | 2 | P1 | Fix in first patch |
| H7 · Flexibility + efficiency | 1 | P1 | Fix in first patch |
| H8 · Aesthetic + minimalist | 3 | P2 | Queue |
| H9 · Recognize errors | 2 | ✅ H0-01 fixed | Green |
| H10 · Help + documentation | 2 | P1 | Fix in first patch |

**Launch gate:** ✅ All 3 P0 findings fixed and fenced 2026-07-22. All 7 P1 findings should have committed fix-dates before launch — some can ship day-2. All P2/P3 are backlog.

---

## Confidence + limitations

- Solo evaluator · industry standard is 3-5 evaluators for full coverage.
- No participant observed (no UAT ran yet · L2 pending).
- Not exhaustive · this walk covered the 11 primary surfaces. Sub-flows (agency panels, remote-log route, cancellation intercept) not audited.
- Nielsen 5-user think-aloud (Layer 2) will surface additional issues these heuristics miss.

## Sources

- [Nielsen · 10 Usability Heuristics for User Interface Design](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Nielsen · How to Conduct a Heuristic Evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/)
- [Nielsen · Severity Ratings for Usability Problems](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/)
