# Post-RC1 Progress · Liquid Clips

**Base**: tag `rc1-dev-handover-2.2.36` · GitHub SHA `e1794812`
**Working branch**: `codex/post-rc1-launch`
**Living document** — updated on every completion by Codex.

For each completed task: commit · PR · evidence · tests · risks · remaining work · human-review requirement.

---

## Cadence

| Column | Meaning |
|--------|---------|
| Commit | short SHA on `codex/post-rc1-launch` |
| PR | link once opened |
| Evidence | file paths of proof (screenshots, logs, traces) |
| Tests | new spec paths + green run tail |
| Risks | rollback trigger + reversibility |
| Remaining | follow-ups |
| Review needed | `yes` for money/pricing/auth/shell touches, `no` otherwise |

---

## In flight

_(none — session start)_

---

## Completed

### 2026-07-13 · P4 · Ship-ready regression report

| Column | Value |
|--------|-------|
| Commit | pending (this edit) |
| PR | none — read-only report |
| Evidence | `desktop-2/docs/POST_RC1_P4_SHIP_READY_REPORT.md` · covers 14 customer journeys, buckets each into foundation-green / launch-ready / mocked / roadmap / blocker |
| Tests | none |
| Risks | none |
| Remaining | (a) Agency six-state sweep is highest-priority next work item; (b) Dropbox+emoji ingest is the one true blocker; (c) Sponsored Reward owning-org signup remains roadmap |
| Review needed | no (report only) |

### 2026-07-13 · P3 · Live installed-app journey (evidence report)

| Column | Value |
|--------|-------|
| Commit | pending (this edit) |
| PR | none — read-only evidence report |
| Evidence | `desktop-2/docs/POST_RC1_P3_LIVE_APP_JOURNEY.md` · 170 projects · 724 clips · ffprobe playback proof · sidecar codesign valid |
| Tests | none (evidence-only report) |
| Risks | none (read-only) |
| Remaining | (a) add `liquidclips://ingest?path=…` deep-link so future P3 can drive fully autonomously; (b) fix Dropbox smart-sync + emoji filename ingest failure (surfaced in `project.json` of `jae5-x-walkz-stream-guest-stream-1`); (c) add clip-lifecycle events (`clip.run`, `export.done`) to `diagnosticLogger` so future evidence is queryable |
| Review needed | no (report only) |

---

## Deferred / escalated

_(none)_
