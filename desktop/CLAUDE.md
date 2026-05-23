# Junior Desktop — agent guide

The actual product: Tauri 2 desktop app that turns long-form video into ready-to-post short clips. Spec lives at `~/Downloads/junior-build-docs-v3.md`. Read §1.1 (non-negotiables), §1.8 (sprints), §3.3 (design tokens), §3.10 (copy rules) before writing code.

## Architecture

```
React (Vite + Tailwind 4)  ⇄  Tauri (Rust)  ⇄  Python sidecar (stdio JSON-RPC)
                                                  ⇄ ffmpeg / faster-whisper / OpenCV
```

- **Frontend**: `src/` — React 18 + TS. Brand tokens in `src/index.css` as Tailwind 4 `@theme` vars. Brand mark `<Logo />` in `src/components/Logo.tsx`.
- **Rust shell**: `src-tauri/src/lib.rs` — Tauri entry; spawns the sidecar in `setup`. `src-tauri/src/sidecar.rs` — stdio JSON-RPC client.
- **Python sidecar**: `python-sidecar/sidecar.py` — newline-delimited JSON over stdin/stdout. One method per RPC. Sprint 0 has `ping` + `probe`; Sprint 1 adds `transcribe`, `cut`, `reframe`, `thumbs`.
- **IPC contract**: `src/lib/sidecar.ts` — TypeScript wrappers around the `sidecar_call` Tauri command.

## Sprint status

- **Sprint 0** (✅ in progress): Tauri shell + Python sidecar IPC + drag-drop probe via system ffmpeg. Bundling ffmpeg-static + whisper-medium is the open Sprint 0 follow-up.
- Sprint 1+: see `~/Downloads/junior-build-docs-v3.md` §1.8.

## Hard rules

- **Feature freeze applies.** Anything not in the v1.0 sprint list (§1.8 of the spec) goes to `v1.1.md`. No mid-build additions.
- **Copy rules (§3.10):** past tense for done things ("Transcribed audio"), plain verb for in-progress ("Cutting clips"), no exclamation marks, no emojis in UI, specifics over vibes.
- **Design tokens (§3.3):** one fuchsia, one ink, one paper. No other accent colours. Tailwind 4 `@theme` defines them in `src/index.css`.
- **No mid-build refactors.** If a previous sprint's code annoys you, write it down in `v1.1.md` — do not stop building to clean it.

## Commands

```bash
npm install              # one-time
npm run tauri dev        # opens the app window with hot reload
npm run build            # type-check + vite build
npm run tauri build      # produces signed installers (Sprint 9+ — needs certs)
```

## Toolchain assumptions

- Node ≥ 22 (24 verified)
- Python 3.11+ on PATH (spec says 3.12; 3.11 works for Sprint 0)
- Rust stable via rustup (installed)
- `ffprobe` + `ffmpeg` on PATH for Sprint 0 (system or homebrew). Sprint 0 wrap-up bundles ffmpeg-static.

## Don't

- Don't reach for Electron, Webview2 native, or "wrap a webpage" patterns — Tauri 2 is locked in §2.1.
- Don't introduce a second styling library. Tailwind 4 + a few primitive components is the whole system.
- Don't add Redux. Zustand or React state.
- Don't introduce a UI framework that ships its own design tokens (MUI, Chakra, Mantine). The brand is the system.
