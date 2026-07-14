# LCOS scanners

Deterministic extraction. Layer A of the three-layer split. Never overwrites human intent.

## Design rules

1. **Facts only.** No prose. No opinions.
2. **Cite everything.** Every fact carries `file:start_line:end_line`.
3. **Confidence per fact.** AST-verified = 1.00. Grep-matched = 0.85. Heuristic = 0.60.
4. **Deterministic.** Same source SHA + same scanner version = same output.
5. **Cache-friendly.** Incremental. Keyed by file mtime + content hash.
6. **Never touch product code.**

## Planned scanners

| Scanner | Extracts | Phase | Confidence |
|---|---|---|---|
| `scan-ts.mjs` | components, hooks, functions, JSX render edges, useState/useEffect | P5 | 1.00 for AST-verified |
| `scan-py.mjs` | routes, endpoints, models, columns | P5 | 1.00 for AST-verified |
| `scan-events.mjs` | `bus.emit(<literal>)`, `useEvent(<literal>)`, `lcDiag(<literal>)` | P5 | 0.85 (string-typed) |
| `scan-storage.mjs` | `localStorage.setItem/getItem/removeItem(<literal>)`, zustand persist keys | P5 | 0.85 |
| `scan-routes.mjs` | `SECTION_REGISTRY`, `SURFACE_FOR`, `ALIAS_FOR` maps | P5 | 1.00 (AST) |
| `scan-tauri.mjs` | `#[tauri::command]` locations + `invoke(<literal>)` frontend calls | P5 | 0.85 (Rust regex, TS AST) |
| `scan-sidecar-rpc.mjs` | sidecar `method_*` handlers + frontend `sidecar.<method>` calls | P6 | 0.85 |
| `scan-tests.mjs` | `it(<literal>)`, `describe(<literal>)`, `def test_*` names + files | P5 | 1.00 |
| `scan-ctas.mjs` | `<button onClick>`, `<a onClick>`, visible text (heuristic) | P6 | 0.60 (heuristic) |
| `scan-watchdogs.mjs` | `<Watchdog id=<literal>>` mounts | P6 | 1.00 |
| `merge.mjs` | Combines all scanner outputs into `graph/*.json` with meta | P5 | — |

## Dependency stance

- **No new npm deps in the app.** If ts-morph is required, install locally in `lcos/scanners/` only.
- **No Python venv changes.** Python AST uses the built-in `ast` module.
- **Rust files read-only.** Regex only. Never modify.

## Provenance

`graph/meta.json` records `source_commit_sha` + `scanner_version`. Ship-lens rule (P11) refuses merge if the SHA drifts from `git HEAD` without a subsequent scanner run.
