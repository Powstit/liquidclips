# Production Fixture Audit · 2026-07-10 · Phase 2 Option B

**Branch:** `integration/cold-entry-mode-b`
**Build:** `npm run build` · Vite v6.4.3 · 43 asset chunks · ✓ built in 8.12s

## Methodology

After a clean production build, `desktop-2/dist/assets/*.js` was grepped
for every fixture/mock/demo constant name deleted or dev-gated during
Phase 1 and Phase 2. Zero survival is the pass bar. Non-zero survival
is a documented residual with justification.

## Results — customer-safe

| Fixture symbol | Hits in prod bundle | Verdict |
|---|---|---|
| `dQw4w9WgXcQ` (Rick Astley video ID · RickRoll trap) | **0** | ✅ neutralized |
| `FIXTURE_CAMPAIGN` | **0** | ✅ deleted (Alpha AU-B-1) |
| `preview-campaign` slug | **0** | ✅ purged from both SubmitToWhopModal variants |
| `TICKER_LIVE` (fictional creator handles + earnings) | **0** | ✅ deleted (Phase 2 AMBER #2) |
| `DEMO_TILES` (10 Rick Astley catalog rows) | **0** | ✅ deleted (Phase 1 P1-004) |
| `DEMO_ROSTER` (fake .demo emails) | **0** | ✅ `isDev`-gated (Papa purge) |
| `DEMO_CLIPS` (MrBeast / MKBHD / Airrack fake tiles) | **0** | ✅ deleted (Papa purge) |
| Fake handles: `marcus.beats`, `nailsbylila`, `zayn.clips`, `kayce.hair`, `jayxvibes` | **0** | ✅ deleted with TICKER_LIVE |
| Generic `FIXTURE_[A-Z]+`, `MOCK_[A-Z]+`, `SAMPLE_[A-Z]+` constants | **0** | ✅ tree-shaken |

## Residual · `FIXTURE_PROJECT` guard-sentinel (documented)

| Symbol | Hits | Justification |
|---|---|---|
| `Uncle Daniel — Wednesday drop` (project name) | 1 | Guard sentinel in `EditorSection.tsx:176` — `if (project.name === FIXTURE_PROJECT.name) return;` REFUSES to render fixture data. The name string ships because the guard needs to compare against it. Never rendered to a customer in the installed Tauri app. |
| `https://example.com/preview` (project source_url) | 1 | Neutralized from the original RickRoll (`https://youtu.be/dQw4w9WgXcQ`) so any browser-preview fallback that leaks through cannot RickRoll a customer. Sentinel URL only. |
| `uncle-daniel-clip-squad-2026` (project slug) | 1 | Same guard-sentinel. Not rendered. |

**Rationale for keeping:** `FIXTURE_PROJECT` is consumed by:

1. `sections/editor/EditorSection.tsx:49,176` — defensive guard (RENDERS NOTHING · returns early)
2. `design-os/engine/sidecar-stub.ts` — browser-preview fallback only fires when Tauri is unavailable, which never happens in the installed .app
3. `design-os/components/SubmitToWhopModal.tsx` — previously fell through to `FIXTURE_PROJECT.clips` when `session.project` was null; now refuses to open the modal without a real session (Phase 2 Option B fix at `SubmitToWhopModal.tsx:135`)

The name + slug + neutralized URL ship as inert data — <200 bytes of guard-sentinel that the customer never sees. Removing them would require refactoring the EditorSection guard to use a separate `SIDECAR_STUB_PROJECT_NAME` constant, which is a larger surgery for zero customer-visible benefit.

## Verdict

✅ **No fake fixtures survive as customer-visible data in the production bundle.** The one residual (`FIXTURE_PROJECT` guard-sentinel) is inert defensive-guard scaffolding with a neutralized URL. Every customer-facing fixture from the Phase 1 + Phase 2 purge is either deleted, dev-gated (`isDev` conditional), or tree-shaken.

## Reproduce

```bash
cd desktop-2
npm run build
cd dist
grep -c "dQw4w9WgXcQ" assets/*.js
grep -c "FIXTURE_CAMPAIGN\|preview-campaign\|TICKER_LIVE\|DEMO_TILES\|DEMO_ROSTER\|DEMO_CLIPS" assets/*.js
grep -c "marcus.beats\|nailsbylila\|zayn.clips\|kayce.hair\|jayxvibes" assets/*.js
grep -cE "FIXTURE_[A-Z]+|MOCK_[A-Z]+|SAMPLE_[A-Z]+" assets/*.js
```

Expected: every count is 0.
