# Liquid Clips v0.7.45 — Release Notes

**Released:** 2026-06-10

Headline: **the Earn tab no longer crashes the app, mass-delete lands in the Library, reaction bake shows progress, imported clips render in the workbench, and the connect-a-channel flow is fully wired across every entry point.** Plus a top-to-bottom contrast sweep and a defensive shell-open hardening.

---

## What's new

### Mass-delete in the Library

Select-mode toggle in the Library wall. Click into select mode, tap clips (or "Select all"), then "Delete N". Confirm dialog protects against accidents. Removed clips disappear from the wall immediately; if anything fails server-side, the row restores automatically. Backed by a single `library_bulk_delete` RPC with per-slug error reporting.

### Reaction bake — live progress

The reaction overlay pipeline now reports progress at each stage: starting → per-ratio baking (33%, 66%, 100%) → done. A progress bar with a stage label ("Baking vertical… 66%") renders under the layout strip while the bake runs. Cancel still works mid-bake.

### Imported clip rendering

Imported clips now generate a source poster on import and use the actual filename in the workbench header. The workbench opens to a results view showing the source AND the cut clip beneath it, instead of "1 imported clip(s)" placeholder copy.

### Channel-connect flow — all four bugs

- Connect-a-channel modal now opens cleanly from the Schedule → Channels surface; an empty `link_url` from the backend surfaces an actionable error toast instead of silently failing.
- Channel status pills now reflect the backend reconcile loop in real time. If a token is expired or revoked at the platform level, the pill flips to "STALE" within 60 seconds of focus.
- The BottomCockpit "Connect a channel" CTA routes correctly to Schedule → Channels from every entry point (cockpit, library empty state, publish flow).
- Platform badges on each ClipCard are now clickable — tap TikTok / YouTube / IG to open Schedule with that platform pre-selected.

### Earn tab — no more crashes

Earn used to crash the app on tab click because the embedded webview's external-link handler called into a Tauri plugin that wasn't actually mounted. The plugin is now wired correctly into the Rust shell. Click Earn, the embed loads, clicking through to Whop / Stripe opens in your default browser as intended.

### Filesystem open — defensive hardening

Filesystem paths previously went through the shell plugin (which only allows `mailto:` / `tel:` / `https:` URLs), causing a red "Scoped command argument" banner on every "Open folder" click. Filesystem paths now route through the opener plugin while URLs continue through shell. 31 call sites migrated to the new `openSmart` helper as a defensive measure — any future empty/invalid URL silently falls through instead of triggering the banner.

### Contrast + legibility sweep

Twelve invisible-text bugs fixed: the Library Undo pill (white-on-cream), the Overlay source picker header + provider badges, the affiliate-hero edit-pencil, the reaction-cell title overlay, the thumbnail-studio retry button, and five polish-tier hits across NotificationSheet, TranscriptResult, ClipPreview, DoctrineLibrary, and ClipReadyCard. New `contrast-lens` skill auto-scans for these bug families at every UI sprint and reports actual WCAG ratios + colour-wheel clashes.

### Cockpit scroll — Workstation home

When the Workstation home was taller than the visible window (Sponsored banner + four tiles), the lower tiles (Thumbnails, Script) got hidden behind the BottomCockpit. RoomShell now uses a block scroller with a min-h-full inner flex column so content fills the viewport when short and scrolls past the cockpit when tall. Locked as IG-008.

---

## Under-the-hood improvements

- 9 `String(e)` catch sites swapped to `humanError(e)` — error messages now preserve the typed-class info while presenting human-readable copy.
- 7 user-content `<img>` tags got `onError` silent-hide fallbacks — broken thumbnails no longer render as missing-image icons.
- New `~/.claude/skills/contrast-lens/` skill (math-based WCAG scanner with HSL colour-wheel clash detection).

## Known issues

- Two contrast hits in `Splash.tsx:287, 290` deferred — under IG-003 cinematic intro lock; require explicit override to touch.
- Whop OAuth has 4 dangling TS wrappers + 4 unused Python methods carried over from earlier sprints. Functionally harmless; cleanup tracked for v0.7.46 (under IG-002 override).

## Acknowledgements

- **Kimi** — P0 mass-delete, P1 reaction bake progress, P2 import render, P3 social-connection cluster + clickable platform badges.
- **Claude (Opus 4.7)** — cockpit scroll fix, Earn crash root-cause, openSmart helper + 31-file migration, contrast sweep + scanner skill, paperwork close-outs.
- **Daniel** — caught every visual bug, vetoed every premature green-light, kept the ship discipline.

---

## Install

- **New users:** `https://liquidclips.app/download` — pick Apple Silicon or Intel DMG.
- **Existing users:** auto-update will prompt on the next app launch (manifest flip schedule TBD per B4 disposition).
