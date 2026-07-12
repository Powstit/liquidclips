# journey.j011-campaigns-navigation · Campaigns click waterfall + boot proof

## Purpose

A user in the Design OS shell clicks the "Campaigns" nav row in
`ConsoleNav`. The click t0 is captured, the route lazy-chunk loads,
the Campaigns route mounts, the `useCampaigns` hook flips from
`unknown` to `real-http` / `real-rpc` / `mock`, first paint lands, and
the interactive-ready tick fires. Every phase writes a User Timing
mark and emits a telemetry topic through `lcDiag`. A single
consolidated `nav_click_performance { route, click_ts, mount_ts,
content_ready_ts }` topic lands at the end of the cycle so HQ can
reconstruct the waterfall without joining four per-phase topics.

Before j011 existed as a canonical owner + regression test seam, a
cold-boot session could return zero waterfall events with two
indistinguishable causes:

1. Stale bundle rendered (runtime bundle hot-swap never resolved) —
   the code that emits `nav_click_performance` wasn't in this build.
2. lcDiag batch flusher never fired for the fresh session — the
   telemetry buffer sat in memory and got dropped on window close.

Both looked identical from HQ's side. Fixing that ambiguity is
exactly what BUG-001 blocked on. j011 pins the owner, the
class-elimination target (BC-005 · route events unobservable), and
the regression test.

## Owning capability

`capability.operational-excellence`

## Mission fingerprint

`[M3]`

- **M3 (Operational excellence):** engineering needs to see every
  nav click's waterfall to diagnose Intel-Iris-Plus lag (backdrop
  filter, framer, lazy-chunk streaming). Without observability there
  is no perf debug loop.

## Prerequisites

- User is past the Welcome / auth wall (Design OS shell mounted).
- `ConsoleNav` is rendered (auto-mounted by `DesignOSAppShell`).
- The staged runtime bundle carries `desktop-2/src/lib/navPerf.ts`
  with `emitBootTelemetry()` exported.
- `main.tsx` calls `bootDiag()` + `emitBootTelemetry()` synchronously
  before `ReactDOM.createRoot(...).render(...)`.

## Entry conditions

- `document.readyState !== "loading"` (main.tsx has executed).
- `bus.emit("nav:click", { route: "campaigns" })` — fired inside the
  `<NavRow>` onClick handler AFTER `markNavClick("campaigns")`.

## Canonical waterfall (4 User Timing marks + 1 consolidated topic)

| Mark                       | Name                                  | Emit site                              | Topic                                 |
|----------------------------|---------------------------------------|----------------------------------------|---------------------------------------|
| 1 · nav_click              | `lc-nav-click:campaigns`              | `ConsoleNav.tsx` NavRow onClick        | `nav_click_performance` (per-phase)   |
| 2 · route_mount_start      | `lc-route-mount-start:campaigns`      | `Campaigns.tsx` component body top     | `route_mount_performance`             |
| 3 · first_contentful_render| `lc-fcr:campaigns`                    | `Campaigns.tsx` mount useEffect + rAF  | `first_contentful_render_performance` |
| 4 · interactive_ready      | `lc-interactive:campaigns`            | `Campaigns.tsx` after useCampaigns flip| `interactive_ready_performance`       |

At the end of MARK 4 a consolidated `nav_click_performance` topic is
emitted with `{ route, click_ts, mount_ts, content_ready_ts }`. Fields
that never fired (e.g. mount_ts on a click that was interrupted) land
as `null` — HQ persistence (B3) can key on the null pattern to detect
mid-cycle abandon.

## Boot proof (BUG-001 · BC-005 class-elimination)

Before the first nav click, `emitBootTelemetry()` fires the `boot`
topic with:

```
{
  runtime_version:          "<meta name='runtime-version'>" ?? __APP_VERSION__ ?? "dev",
  source_sha:               "<meta name='source-sha'>"      ?? __APP_VERSION__ ?? "dev",
  bundle_index_html_sha256: <SHA-256 of document.documentElement.outerHTML>
}
```

Idempotent — a StrictMode double-invoke or a runtime hot-swap re-mount
is a silent no-op. The hash is computed async via WebCrypto so first
paint isn't blocked; the event still lands on the first
`FLUSH_INTERVAL_MS` batch (2s).

Two boots of the SAME bundle yield the SAME
`bundle_index_html_sha256`. A hot-swap produces a NEW hash. HQ can
therefore prove "which bundle actually rendered" without a
side-channel.

## Owning stations

- `station.consolenav.campaigns` (nav click emit)
- `station.route.campaigns` (mount + fcr + interactive)

## Owning canonical states

- `state.runtime-version` (proved by `boot.runtime_version`)
- `state.bundle-identity` (proved by `boot.bundle_index_html_sha256`)

## Telemetry topics owed by j011

| Topic                                  | Emitter                              | Payload                                                              |
|----------------------------------------|--------------------------------------|----------------------------------------------------------------------|
| `boot`                                 | `navPerf.emitBootTelemetry`          | `{ runtime_version, source_sha, bundle_index_html_sha256 }`          |
| `nav_click_performance` (per-phase)    | `navPerf.markNavClick`               | `{ route, ts_ms }`                                                   |
| `route_mount_performance`              | `navPerf.markRouteMountStart`        | `{ route, delta_ms_from_nav_click, chunk_load_ms_estimated }`        |
| `first_contentful_render_performance`  | `navPerf.markFirstContentfulRender`  | `{ route, delta_ms_from_mount_start, total_delta_ms_from_click }`    |
| `interactive_ready_performance`        | `navPerf.markInteractiveReady`       | `{ route, delta_ms_from_fcr, total_delta_ms_from_click, ... }`       |
| `nav_click_performance` (consolidated) | `navPerf.markInteractiveReady`       | `{ route, click_ts, mount_ts, content_ready_ts }`                    |
| `paint_performance`                    | PerformanceObserver `paint`          | `{ route, entry_name, start_time_ms, duration_ms }`                  |
| `long_task_performance`                | PerformanceObserver `longtask`       | `{ route, entry_name, start_time_ms, duration_ms }`                  |
| `layout_shift_performance`             | PerformanceObserver `layout-shift`   | `{ route, start_time_ms, value, had_recent_input }`                  |

## Regression tests

| Test file                                                                         | Coverage                                                        |
|-----------------------------------------------------------------------------------|-----------------------------------------------------------------|
| `desktop-2/src/lib/navPerf.boot-emit.test.ts`                                     | Idempotent emit · payload key contract · meta → shell precedence · SHA-256 hex format |
| `desktop-2/src/design-os/components/SideNav.learn-visibility.test.ts`             | Sister j001 test — but also asserts ConsoleNav ITEMS array is stable, protecting Campaigns row from silent removal |

## Non-goals

- j011 does NOT own the HQ persistence receiver — that's B3
  (`junior-backend/app/routes/telemetry_ingest.py` +
  `lcos_event` table).
- j011 does NOT gate on payment / tier — telemetry emits regardless
  of user tier.

## Adjacent journeys

- `j014-runtime-update` — provides the `runtime-version` meta tag j011
  keys on.
- `j001-fresh-user-otp-identity` — cold-boot arrival that produces the
  first Campaigns click.

## Introduced

- 2026-07-12 · Train B2 · RC1 sprint · Barrier 2.

## History

- 2026-07-11 · Phase 1 instrumentation shipped (`f7f2cad7`) but no
  boot-proof, no regression test, no journey owner.
- 2026-07-12 · Train B2 adds `emitBootTelemetry()`, consolidated
  `nav_click_performance` topic, and this journey doc. BUG-001 →
  FIXED_UNPROVEN.
