# Claude Handoff — Reaction Library Online Providers

Date: 2026-06-04
Owner: Codex
Status: built locally, not pushed

## Summary

Daniel wanted reaction/meme clips available inside the open clip editor, with GIPHY prioritized because it has the funny reaction content clippers expect. The implementation now supports:

- GIPHY as the default reaction search provider
- Pexels as a stock-video fallback
- Pixabay as a stock-video fallback
- local download/cache into the user reaction library
- applying the selected asset into the existing stack / side-by-side / PiP overlay renderer

No provider keys were hardcoded into the repo.

## User Flow

1. User opens a clip editor.
2. In the right panel, `Reaction layout` shows explicit layout buttons:
   - Stack below
   - Stack above
   - Side-by-side left
   - Side-by-side right
   - PiP right
   - PiP left
3. When a layout needs a source clip, the source picker opens.
4. Picker can use:
   - another clip from the same project
   - GIPHY online search
   - Pexels online search
   - Pixabay online search
   - upload from disk
5. Online selected assets download to:

```text
~/LiquidClips/Reaction Library/downloaded/
```

6. Downloaded file path is passed to existing `apply_overlay`.
7. Existing sidecar renderer outputs the composed clip beside the original render files.

## Provider Priority

Default provider is GIPHY.

Do not merge GIPHY results into a combined provider grid. GIPHY terms require visible `Powered by GIPHY` attribution and user/source attribution where available, and their API terms disallow commingling GIPHY search results with other provider results without approval. Keep provider tabs/lanes separate:

- GIPHY
- Pexels
- Pixabay

Pexels/Pixabay are fallbacks for stock-style reaction/B-roll, not the main meme source.

## Secret Keys

Supported sidecar secrets now include:

- `GIPHY_API_KEY`
- `PEXELS_API_KEY`
- `PIXABAY_API_KEY`

Storage path:

- OS keychain through `desktop/python-sidecar/secrets_store.py`

UI path:

- Desktop app → Settings → API keys

The React layer can set/delete/status-check these secrets, but does not read raw values. Provider calls happen in the Python sidecar so API keys stay opaque to UI.

## Files Touched

Core provider/search:

- `desktop/python-sidecar/secrets_store.py`
- `desktop/python-sidecar/sidecar.py`
- `desktop/src/lib/sidecar.ts`
- `desktop/src/lib/mock-sidecar.ts`

UI:

- `desktop/src/components/ClipPreview.tsx`
- `desktop/src/components/OverlaySourcePicker.tsx`

Note:

- `desktop/src/App 3.tsx` is an untracked duplicate app file that TypeScript currently checks. It was patched only to pass the existing required `UploadTab.onOpenProject` prop.

## Sidecar Methods

New methods:

- `reaction_search`
- `reaction_download`

`reaction_search` params:

```json
{
  "query": "funny reaction",
  "provider": "giphy",
  "per_page": 12
}
```

Provider values:

- `giphy`
- `pexels`
- `pixabay`

`reaction_download` params:

```json
{
  "item": { "provider": "giphy", "...": "selected search result" },
  "query": "funny reaction"
}
```

Returns:

```json
{
  "path": "/Users/.../LiquidClips/Reaction Library/downloaded/giphy-....mp4",
  "item": { "provider": "giphy", "local_path": "..." }
}
```

## Provider Notes

### GIPHY

- Endpoint: `https://api.giphy.com/v1/gifs/search`
- Uses `images.original.mp4` first, then fixed-width MP4 fallback.
- UI attribution: `Powered by GIPHY`
- Rating currently `pg-13`.
- Bundle currently `messaging_non_clips`.

### Pexels

- Endpoint: `https://api.pexels.com/videos/search`
- Uses API key via `Authorization` header.
- Chooses an MP4 rendition near 1280px max dimension.
- UI attribution: `Videos provided by Pexels`

### Pixabay

- Endpoint: `https://pixabay.com/api/videos/`
- Uses API key as request query param server-side only.
- Searches `category=feelings`, `safesearch=true`, `order=popular`.
- Chooses medium/small/tiny/large available rendition in that order.
- UI attribution: `Videos provided by Pixabay`

## Verification Already Run

```bash
cd /Users/dipdip/Desktop/jnr
python3 -m py_compile desktop/python-sidecar/*.py
cd desktop && npx tsc -b --pretty false
```

Both passed.

## Manual Smoke Test

1. Open Liquid Clips.
2. Settings → API keys.
3. Add:
   - `GIPHY_API_KEY`
   - optionally `PEXELS_API_KEY`
   - optionally `PIXABAY_API_KEY`
4. Open an existing generated clip or imported clip.
5. Click `Stack below` or `Side-by-side right`.
6. In source picker:
   - provider should default to GIPHY
   - search `funny reaction`
   - verify Powered by GIPHY link is visible
   - choose a result
7. Confirm selected asset downloads to `~/LiquidClips/Reaction Library/downloaded/`.
8. Confirm sidecar renders overlay output.
9. Switch layout between stack/split/PiP; it should reuse the same reaction source unless `Change reaction clip` is clicked.

## Known Follow-Ups

- Add local Reaction Library browser/search for already-downloaded assets.
- Add Settings control for Reaction Library folder location.
- Add provider health/gate in Admin Health:
  - key present
  - search succeeds
  - download succeeds
- Consider GIPHY action-register endpoint if required for production approval.
- Consider “Suggest 3 reactions” after clip generation using clip title/theme/score reason as the search query.

## Caution

Do not push provider keys. Do not move GIPHY into a mixed all-provider grid unless Daniel has explicit GIPHY approval for commingled results.

