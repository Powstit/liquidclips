# 07 · Code Graph

Machine-derived. Regenerated on every merge. Never hand-edited.

Populated at P5 by scanner v0.1.

## Output

- `graph/nodes.json` — every symbol as a node with source citation
- `graph/edges.json` — every reads/writes/calls/renders/subscribes_to edge with source citation
- `graph/meta.json` — `source_commit_sha` + `generated_at` + `scanner_version`

## Node types (closed set)

```
component  hook  function  module_state  route  endpoint  table  column
event      storage_key  session_key  test  sidecar_rpc  tauri_command
hq_event   watchdog  cta  feature_flag  journey_station  feature
```

## Edge kinds (closed set)

```
reads  writes  calls  renders  invalidates  subscribes_to  emits
tests  guards  navigates_to  blocks_on  implements  contradicts
```

## Consumers

- `06 Canonical State Registry` reads this to detect duplicate writers.
- `10 Impact Reports` reads this to compute blast radius.
- `11 Anthropic Brain` reads this to answer all queries with citations.
- `12 Proofs` read this to verify claims.
- `13 Doctor` reads this for every diagnostic.

## Regeneration trigger

- Every merge on `integration/*` branches.
- Manual: `/brain scan` skill command.
- Ship-lens rule (P11): refuses merge if `meta.source_commit_sha != git HEAD`.
