# Claude Handoff: IG Research Tool Install

Date: 2026-06-03
Owner: Codex

## Installed Location

External tool installed at:

```text
/Users/dipdip/ig-research
```

This is intentionally outside the Liquid Clips repo. Liquid Clips should treat it as a local library builder, not as app code.

## What Is Installed

- `package.json`
- `scripts/scrape.js`
- `scripts/transcribe.sh`
- `scripts/report-html.js`
- `scripts/export-remix-library.js`
- `projects/example/config.json`
- Node dependency: `chrome-remote-interface`
- Python 3.11 virtualenv: `/Users/dipdip/ig-research/.venv`
- Whisper package installed in the venv with pinned Python 3.11-compatible dependency stack:
  - `openai-whisper==20231117`
  - `numba==0.58.1`
  - `llvmlite==0.41.1`
  - `numpy<2`

## Verification

Passed:

- `npm install`
- `npm run scrape` without args prints usage.
- `npm run report -- example` generated:
  - `/Users/dipdip/ig-research/projects/example/report.html`
- `npm run export-remix -- example example` generated:
  - `/Users/dipdip/LiquidClips/remix/libraries/example/library.json`

Partial / needs follow-up:

- `openai-whisper` installed successfully in the venv, but `python -m whisper --help` and `import whisper` hung during first Torch/Whisper import verification. Processes were terminated with `pkill -f 'whisper|import whisper'`.
- Do not assume transcription is healthy until a small real audio-file test completes.

## Why The Install Uses A Venv

System `python3` is Python 3.13. `openai-whisper` and its `numba/llvmlite` stack failed there.

Python 3.11 exists on the machine, so the tool now uses:

```text
/Users/dipdip/ig-research/.venv/bin/python
```

`transcribe.sh` automatically prefers that venv and falls back to `python3` only if the venv is missing.

## Manual Step Before Real Scrape

Daniel must launch Chrome with remote debugging and log into Instagram:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Then run:

```bash
cd /Users/dipdip/ig-research
npm run scrape -- <project-name>
npm run transcribe -- <project-name>
npm run report -- <project-name>
npm run export-remix -- <project-name> <library-name>
```

## Product Note

The visible Liquid Clips feature should remain Remix. This external tool builds local candidate libraries for:

```text
/Users/dipdip/LiquidClips/remix/libraries/<library-name>/library.json
```

Do not expose a standalone Research tab before the post-generation Remix flow is proven.
