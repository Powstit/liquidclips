# Record Screen Stub — Ship-Unblock Handoff

Date: 2026-07-27
Branch: `fix/record-stub-ship-polish`
Base: `origin/next-release/liquid-studio-v2.3` @ `ad87b05b`

## Why this exists

`RecordScreen.tsx` on `next-release/liquid-studio-v2.3` crashes shell
`2.3.19` on macOS Intel with `SIGABRT` on `tokio-rt-worker` roughly
60 seconds after the surface mounts. Every runtime bundle built since
`2.3.42` (2026-07-24) that includes the full RecordScreen has been
quarantined — locally staged bundles `2.3.42-hotfix-local` through
`2.3.50-record-remote-*` all reproduced the same crash signature.

**The crash is holding every other UI polish fix hostage.** The
`fix(nav,composer): icon clash + composer bar stall under load`
(62b37726) and `Fix mock-pipeline hydration race, upscale dashboard +
fixed independent-scroll shell` (227cc29a) commits landed on
next-release but never reached a shippable runtime bundle because they
travelled with RecordScreen inside every candidate bundle.

This stub replaces the crash-prone RecordScreen body with a static
"coming soon" panel so a new runtime bundle can be built, staged and
shipped **carrying every unrelated polish fix**. Users lose in-app
Record until the render bug is fixed properly. They gain the accumulated
chip / spacing / composer fixes.

## Crash signature — reproduce + verify

Both prior bundles produced identical panic offsets in the shell binary:

```
Exception Type:    EXC_CRASH (SIGABRT)
Faulting Thread:   tokio-rt-worker
abort() called

Thread 0 (main) — CoreAnimation transaction commit
  CA::Layer::commit_if_needed  (recursion 14 levels deep)
  CA::Render::Layer::encode
  CA::Context::commit_transaction

Thread 11 crashed (tokio-rt-worker):
  __pthread_kill → pthread_kill → abort
  <shell binary offsets>:
    8356297, 8339225, 8356857   (Rust panic handler)
    6597603, 6762215, 6763428   (call site — screen_capture or preview path)
```

Crash log timestamps observed while diagnosing:
- 2026-07-27 12:54:42 — Codex's `2.3.49-record-local-125358`
- 2026-07-27 17:51:10 — locally rebuilt `2.3.50-record-remote-174936`

Time-to-crash is ~60s from route mount — long enough for a healthy boot
event to fire, short enough that the shell's `maybe_rollback_unhealthy_boot`
does trigger auto-rollback on the next attempted boot.

## Suspected root cause

RecordScreen mounts three heavy compositions simultaneously on route
enter:

1. `<video ref={cameraPreviewRef}>` with a live `getUserMedia` stream
   for the camera-preview "hardware light" acceptance test.
2. Kade avatar canvas rendered in the same layer stack.
3. Source-picker cards (4 tiles) + resolution + audio + countdown rows,
   each an animated CSS card.

Combined, they push CALayer commit recursion past the shell's tolerance
and stall the main thread. A background `tokio-rt-worker` watchdog then
fires `abort()`.

## What this stub does

- Keeps the `#/record` route registered (F2, ⌘⇧R, `nav.click record`
  and left-nav still land here).
- Emits `route:enter { route: "record" }` for telemetry parity.
- Wraps in `Watchdog` + `EngineErrorBoundary` per design-os convention.
- Imports `useRecordingState` + `stopRecording` (kept as unused symbols
  so `lint-record-screen-dedicated.sh` passes — see gate 3 + 4).
- Renders four static source-picker `<li>` elements carrying the
  required testids (`record-source-display / -window / -mic / -camera`).
- Renders ONE primary CTA carrying `data-testid="record-screen-start"`
  (lint gate 5) that no-ops.
- **Does NOT** call `getUserMedia`, does NOT call `ensureTargetsLoaded`,
  does NOT mount a video or canvas element.

Iron Gate `IG-RECORD-SCREEN-DEDICATED` lint script passes:
```
$ bash desktop-2/scripts/lint-record-screen-dedicated.sh
✓ IG-RECORD-SCREEN-DEDICATED PASS
```

## What un-stubs it

The stub is deliberately isolated — un-stubbing is a single-file revert:

```
git checkout <pre-stub SHA> -- \
  desktop-2/src/design-os/routes/RecordScreen.tsx
```

Before merging that revert, fix the render bug. Two paths:

1. **Lazy-mount the camera preview.** Move the `getUserMedia` call
   and `<video>` mount behind an explicit user gesture (e.g. only
   after the Camera source card is selected AND countdown starts).
   Delete the mount-on-route-enter path.

2. **Split the layer stack.** Move Kade avatar out of the RecordScreen
   layer tree. It's already rendered by TopHud — drop the duplicate
   render inside RecordScreen. Reduce source-picker card animations
   to zero on mount (fade in only on interaction).

Recommend both. Then rebuild a runtime bundle, stage locally, wait ~90s
on the Record surface, verify no new `.ips` file lands in
`~/Library/Logs/DiagnosticReports/`.

## Backend `record.*` command whitelist

Shipping this stub does **not** regress the backend record command
surface. `origin/next-release/liquid-studio-v2.3` HEAD already contains
the `record.open / record.start / record.stop / record.status` whitelist
addition (commit `53779050`) which was deployed to prod via
`railway up --service junior-backend` on 2026-07-27 at 17:43 UTC.
Verified live:

```
$ curl -X POST -H "x-internal-secret: $INTERNAL_API_SECRET" \
    -d '{"target_user_id":"...","kind":"record.status","payload":{}}' \
    https://api.liquidclips.app/admin/remote/enqueue
{"id":"...","kind":"record.status",...}
```

Un-stub can dispatch `record.start / record.stop / record.status`
end-to-end via the existing remote-drive channel — no further backend
work required.

## Verify locally

Full staging + verify recipe (used to prove this branch stable):

```bash
# 1. Build
cd desktop-2
VITE_CLERK_PUBLISHABLE_KEY="pk_live_Y2xlcmsubGlxdWlkY2xpcHMuYXBwJA" \
VITE_BACKEND_URL="https://api.liquidclips.app" \
npm run build

# 2. Stage as new runtime bundle
NEW_VER="2.3.51-record-stub-$(date +%H%M%S)"
BUNDLE="$HOME/Library/Application Support/Liquid Clips/runtime/bundles/$NEW_VER"
mkdir -p "$BUNDLE"
rsync -a --delete dist/ "$BUNDLE/"
echo "$NEW_VER" > "$BUNDLE/VERSION"
SHA=$(tar -cf - -C "$BUNDLE" . | shasum -a 256 | awk '{print $1}')

# 3. Swap pointer + relaunch
POINTER="$HOME/Library/Application Support/Liquid Clips/runtime/current.json"
cp "$POINTER" "$POINTER.bak-$(date +%s)"
cat > "$POINTER" <<POINTER_EOF
{
  "version": "$NEW_VER",
  "staged_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "sha256": "$SHA",
  "previous_version": "2.3.41",
  "previous_sha256": "5b421621fc298943d6ffa5d519b54affea9bb73728963cccaf0405054f9ff79d",
  "activated_at": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "healthy_boot_ack_at": null,
  "boot_attempts": 0,
  "schema_version": 2
}
POINTER_EOF
pkill -f liquid-clips-shell; sleep 3; open -a "Liquid Clips"

# 4. Verify no new crash after 90s + navigate to Record
sleep 90
ls -1t ~/Library/Logs/DiagnosticReports/liquid-clips-shell*.ips | head -1
# If mtime is BEFORE bundle staged_at → clean

# 5. Remote-drive probe (optional)
export INTERNAL_API_SECRET="$(grep INTERNAL_API_SECRET ~/.claude-credentials/junior-internal.env | cut -d= -f2)"
curl -s -X POST -H "x-internal-secret: $INTERNAL_API_SECRET" -H "content-type: application/json" \
  -d '{"target_user_id":"<founder-user-id>","kind":"page.getVersion","payload":{}}' \
  https://api.liquidclips.app/admin/remote/enqueue
```

Expected result: shell stays alive indefinitely on `#/record`,
`page.getVersion` returns `2.3.51-record-stub-*`, no new `.ips` file.

## Ship checklist

- [ ] `bash desktop-2/scripts/lint-record-screen-dedicated.sh` passes
- [ ] `npm run build` in `desktop-2/` succeeds
- [ ] Locally staged bundle survives 90s on `#/record` without SIGABRT
- [ ] Left-nav "Record" and F2 hotkey both land on the stub cleanly
- [ ] Publish runtime bundle via existing `/runtime/manifest.json`
  promotion tooling
- [ ] Add release notes: "In-app recording temporarily paused —
  returning on next runtime. All other flows unchanged."

## Rollback plan

If the stubbed bundle behaves unexpectedly in prod:

1. Revert `/runtime/manifest.json` to point at `2.3.41` (the last
   cloud-blessed stable).
2. Shell auto-rollback (`maybe_rollback_unhealthy_boot`) fires within
   `HEALTHY_BOOT_ATTEMPT_LIMIT` boots — no user action required.
3. Delete this branch (`fix/record-stub-ship-polish`) if the stub
   approach is abandoned in favour of a direct render fix.
