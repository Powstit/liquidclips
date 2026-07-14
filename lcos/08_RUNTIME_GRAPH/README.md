# 08 · Runtime Graph

Live evidence. What actually happened, not what the code says should happen.

Populated at P7 by consuming HQ telemetry + local `/tmp/backend.log` diag ingest.

## Sources

- Frontend: `lcDiag` events (batched to `/telemetry/diagnostic`)
- Backend: uvicorn access logs + `admin_*` HQ endpoints
- Sidecar: `sidecar-startup.log`
- Rust shell: `invoke("runtime_info")` return

## Format

Time-ordered stream, indexed by session id + route + user id (when authenticated). Rolling window (default 24h).

## Consumers

- `13 Doctor` compares expected event ordering vs actual per station.
- `14 Accuracy` scores prediction confidence against realized events.
- `04 Journey Bible` status (GREEN/AMBER/RED) is set from live proof.

## Rules

- **Never mutate source records.** Append-only.
- **No PII in queryable form.** Session IDs, not emails.
- **Confidence 1.00 only for signals from HQ (durable), 0.85 for stdout logs (ephemeral).**
