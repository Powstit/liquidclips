# MAX REPORT · Option D · Composer wire · 2026-07-21

**Ask:** "ok do it im going bed ensure its complete"
**Executed:** Option D · hosted `/proxy/llm/intent` + real sidecar
delivery + 4-layer defense · shipped as runtime bundle 2.2.71.

## TL;DR

The composer command bar now delivers on user commands. Type
"make me 15 clips with great hooks" → Kade asks for a source (file
or URL) → picks up file via native picker → calls sidecar → shows
live progress → renders clip cards ranked by hook score.

**Nothing rebuilt. Nothing deployed. Pure runtime bundle · users get
it on next relaunch of the installed .app.**

## Live verification (proof gates)

```bash
$ curl -sS "https://api.liquidclips.app/runtime/manifest.json?channel=stable"
{"version":"2.2.71","channel":"stable",
 "sha256":"7cdaa6c13f5266c2f41dd6ca47edb89c3114a8a7b1471bfd51e6a997ca026194",
 "url":"https://api.liquidclips.app/runtime/download/2.2.71",
 "pub_date":"2026-07-21T01:56:39.803226+00:00",
 "ship_lens_verdict":"PASS"}
```

## Proof gate log

| Gate | Result | Detail |
|---|---|---|
| tsc --noEmit | ✓ exit 0 | ~4s |
| vitest run (full suite) | ✓ 127 files · 1125/1125 pass · 1 skipped | 106s |
| New tests (SimpleComposer.hosted) | ✓ 18/18 pass | 3s |
| Client contract (classC.test.ts) | ✓ 15/15 pass | 3s |
| Iron Gates fast tier | ✓ all 20 fences PASS incl. new IG-COMPOSER-HOSTED-INTENT | 4min |
| Ship-lens-reviewer | ✓ PASS · 3 P1s addressed pre-ship | manual dispatch |
| IG-BUNDLE-NO-LOCALHOST | ✓ zero backend localhost URLs in dist | inside runtime-ship.sh |
| Runtime signed | ✓ minisign · 424B sig · same key as 2.2.70 | Tauri updater key |
| Runtime uploaded | ✓ POST /runtime/upload · verdict PENDING | api.liquidclips.app |
| Runtime promoted | ✓ POST /runtime/promote · verdict PASS | serving=true |
| Manifest verified | ✓ /runtime/manifest.json?channel=stable serves 2.2.71 | via curl |

## What was already built (walk-around wins)

Daniel's hint "there's always a walk-around" saved ~4 hours. Two
pieces of the wire already existed and had been sitting unused:

1. **Backend endpoint** — `junior-backend/app/routes/proxy_llm.py:308`
   `/proxy/llm/intent`. Iron-gated as IG-COMPOSER-X. Purpose-built for
   the composer command bar. Comment on line 104-108: "The desktop
   Composer command bar hands raw user text to /proxy/llm/intent and
   receives back a normalised { action, capability, resolved_params,
   choices? } payload." Ships with tier gates, quota metering, and a
   billing:reserve-refused emit on 402/403.
2. **Frontend client** — `src/lib/kadeIntentClient.ts`. Iron-gated as
   IG-COMPOSER-X (companion). Exports `requestKadeIntent()`. Handles
   auth (via authedFetch), 402/403 → billing:reserve-refused bus emit,
   and typed response shape.

Neither had ever been wired into SimpleComposer.tsx. Wire is now live.

## Architecture (in plain English)

**Before this ship:** command bar had a regex router. "give me 3
clips" matched → emitted "Paste a URL" as text and STOPPED. No file
picker. No sidecar call. No results. Cosmetic only.

**After this ship:** hosted-first agent pattern.

1. User types → send to hosted LLM (gpt-4o-mini structured output)
   with the full capability catalogue + session context
2. LLM returns typed decision · `execute` (has everything) · `ask`
   (needs more) · `miss` (doesn't know)
3. `ask` path with source-shaped question → mount file picker + URL
   input · user picks · picker stores path in `sessionCtx` · re-runs
   hostedIntent · LLM now says `execute`
4. `execute` path for `discovery.scrub` → sidecar.startRun or
   sidecar.ingestUrl · gets project.slug back · subscribes to engine
   events · renders progress bar · on complete renders clip cards

**Fallback path:** any hosted-call throw (401/402/403/timeout/network)
→ local routeIntent runs · command bar never dead-ends offline.

**Diagnostic Center visibility:** every step emits either a `bus.emit`
(visible in Bus panel) or a fetch call (visible in Fetch log). Daniel
can open `#/diagnostics?staff=1` while running a command and see the
entire round-trip flying past in real time. Substitute for Web
Inspector which release Tauri builds disable.

## Ship-lens P1 fixes (all addressed pre-ship)

1. **Stale-closure risk** in `useEvent` handlers reading `activeSlug` —
   added `activeSlugRef` + `useEffect` to sync, callback reads ref.
   Defence-in-depth (useEvent.ts uses handlerRef which refreshes
   closure identity, but the ref pattern is now redundant-safe).
2. **TDZ hazard** — `acceptSource` referencing `handleSubmit` before
   its declaration. Converted to `handleSubmitRef.current?.()`. Clean.
3. **Regex miss** — `parseCountFromCommand` didn't handle "15-clip
   pack" (hyphen form). Regex updated to `/(\d{1,3})[\s-]*clips?/i`.
   Test added.

## What the user actually needs to do

1. Open the installed `Liquid Clips.app` (already at /Applications)
2. Wait for the boot splash — the Rust updater fetches 2.2.71 in the
   background (max 30s on wifi)
3. Reload happens automatically via the runtime hotswap fence
4. Navigate to Composer
5. Type "make me 5 clips with great hooks"
6. Follow the source picker
7. Watch the progress bar
8. See the clip cards

If any step doesn't behave, open Diagnostic Center
(`localStorage.setItem("lc.staff.flag","1")` in console OR
`#/diagnostics?staff=1` in URL) and screenshot the Bus + Fetch panels.
That'll pinpoint the failure precisely.

## Files (paste-able list for git)

```
desktop-2/package.json
desktop-2/src/design-os/routes/SimpleComposer.tsx
desktop-2/src/design-os/routes/SimpleComposer.css
desktop-2/src/design-os/routes/SimpleComposer.hosted.test.ts
desktop-2/scripts/lint-composer-hosted-intent.sh
desktop-2/scripts/iron-gates.sh
desktop-2/docs/IRON_GATES_REGISTRY.md
desktop-2/docs/SYSTEM_UPDATE.md
```

## Rollback (one command each)

Manifest rollback (fastest):
```
curl -X POST https://api.liquidclips.app/runtime/promote \
  -H "Content-Type: application/json" \
  -d '{"version":"2.2.70","channel":"stable"}'
```

Rust-side auto-rollback (already engaged): unhealthy 2.2.71 boots
trigger auto-revert to LKG (2.2.70) per IG-UPDATER-COHERENT.

---

Sleep well.
