# Liquid Clips — Source of Truth

> Established 2026-06-13 after a build-loop where one agent compared
> `/Users/dipdip/Desktop/jnr` (stale) against history while the actual
> v0.7.62 installed binary was built from `/Users/dipdip/code/jnr`.

## Canonical repo

**`/Users/dipdip/code/jnr`**

All future reads, edits, comparisons, builds, and installs use this
path. `/Users/dipdip/Desktop/jnr` is stale (v0.7.56) and must not be
treated as authoritative.

## Audit evidence (2026-06-13 12:47 BST)

| Check | `/Users/dipdip/code/jnr` (canonical) | `/Users/dipdip/Desktop/jnr` (stale) |
|---|---|---|
| HEAD commit | `f73084c` + uncommitted v0.7.62 work | `f73084c`, clean |
| `desktop/package.json` version | `0.7.62` | `0.7.56` |
| `desktop/src-tauri/tauri.conf.json` version | `0.7.62` | `0.7.56` |
| `desktop/src/components/earn/EarnTab.tsx` | 581 lines, native render, marker at line 156 | 81-line `EarnPanelMount` webview wrapper |
| `target/release/bundle/.../Liquid Clips.app` plist | `0.7.62`, binary mtime 12:46:28 | `0.7.56`, binary mtime 2026-06-12 20:30 |
| Installed `/Applications/Liquid Clips.app` plist | — | — |
| Installed binary mtime | 12:47:45 (77s after code/jnr build) | — |

The 77-second gap between the code/jnr `target/release` build and
the installed `/Applications` binary, plus version + marker match,
confirms the install came from `code/jnr`.

## Working version (canonical, uncommitted)

* desktop frontend + tauri shell: **0.7.62**
* Currently uncommitted on `main` in `/Users/dipdip/code/jnr`:
  ~30 files including `desktop/src/components/earn/EarnTab.tsx`,
  `desktop/src/lib/activation.ts`, `desktop/CLAUDE.md`,
  `desktop/docs/IRON_GATES.md`, `account-app/src/app/embed/earn/page.tsx`.

## Installed app

`/Applications/Liquid Clips.app` — v0.7.62, x86_64 Mach-O,
bundle id `app.liquidclips.desktop`.

## Build command (from canonical repo only)

```bash
cd /Users/dipdip/code/jnr/desktop
npm run tauri build -- --bundles app
```

## Install command (from canonical repo only)

```bash
cd /Users/dipdip/code/jnr/desktop
bash scripts/local-install.sh
```

`local-install.sh` resolves `SRC` via `$(pwd)/src-tauri/target/...` —
**the script must be invoked from the canonical repo's `desktop/`
directory or it will install the wrong build.**

## Hard rule for agents

1. Before any read / grep / edit on Liquid Clips desktop files, confirm
   `pwd` starts with `/Users/dipdip/code/jnr` (or use absolute paths
   that start there).
2. Never run `git`, `npm`, `cargo`, `tauri`, or
   `scripts/local-install.sh` from `/Users/dipdip/Desktop/jnr`.
3. Never compare history or "current" vs "old" using
   `/Users/dipdip/Desktop/jnr` as the "current" side. It is frozen at
   v0.7.56 + the legacy webview Earn wrapper.
4. If a future audit shows the installed `/Applications/Liquid Clips.app`
   binary mtime no longer matches a `code/jnr` build artifact, repeat the
   audit in this file before trusting either tree.

## How to re-verify in one command

```bash
echo "installed: $(defaults read '/Applications/Liquid Clips.app/Contents/Info.plist' CFBundleShortVersionString)"
echo "canonical: $(grep '"version"' /Users/dipdip/code/jnr/desktop/package.json | head -1)"
echo "stale:     $(grep '"version"' /Users/dipdip/Desktop/jnr/desktop/package.json | head -1)"
```

Installed version must equal canonical version. If it equals stale,
re-do the audit.

## Out-of-scope sibling repos (do not confuse)

* `/Users/dipdip/code/jnr-stale-20260612` — explicit stale snapshot,
  do not edit.
* `/Users/dipdip/Desktop/jnr-codex-launch` — separate codex worktree.
* `/Users/dipdip/Desktop/jnr/jnr-powstit` — Powstit worktree at v0.4.36.
* `/Users/dipdip/Desktop/jnr/.claude/worktrees/agent-*` — locked
  parallel-agent worktrees on old commits.

None of these are the source for the v0.7.62 installed build.
