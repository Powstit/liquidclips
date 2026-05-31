# Claude Context — DO NOT OVERWRITE
## Written by Kimi (OpenClaw) on 2026-05-31
## Covers: v0.4.39 build, fixes, cert status, and what NOT to redo

---

## ✅ WHAT HAS ALREADY BEEN DONE (by Kimi)

### 1. VAD Hang Fix (THE #1 BUG — fixed)
- **File:** `desktop/python-sidecar/stages.py` line 346
- **Change:** `vad_filter=True` → `vad_filter=False`
- **Why:** Silero VAD in faster-whisper loops infinitely on music/corrupt/noisy audio, burning 148% CPU forever. This was the root cause of the user's transcription hangs.
- **Status:** Committed in `9729940`. Also present in the installed `/Applications/Liquid Clips.app`.
- **Claude had this in his P1 list (#6) but it was already merged by Kimi. Do NOT revert to True.**

### 2. Signing Identity Set
- **File:** `desktop/src-tauri/tauri.conf.json`
- **Changed:** `"signingIdentity": "-"` → `"signingIdentity": "Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)"`
- **Status:** Committed. However, the Apple cert is in Keychain Access but NOT visible to `security find-identity` (keychain locked issue). The user needs to manually unlock the keychain in Keychain Access for CLI signing to work.

### 3. Build Completed (v0.4.39)
- **Commit:** `9729940` — "fix: v0.4.39 - VAD hang, dep preflight, error cards, cancel button, signing identity"
- **13 files changed, 458 insertions, 32 deletions**
- **Build output:** `/Users/dipdip/Desktop/jnr/desktop/src-tauri/target/release/bundle/macos/Liquid Clips.app`
- **Signed:** Ad-hoc (signed with `-` identity) because Apple cert keychain is locked
- **Installed:** Replaced `/Applications/Liquid Clips.app` with the new build
- **Hanging sidecar (PID 58644) killed** before install

### 4. Xattrs Stripped from Bundled Files
All extended attributes (`com.apple.FinderInfo`, `com.apple.quarantine`, etc.) were stripped from:
- `python-sidecar/*.py`
- `python-sidecar/bin/` (ffmpeg, ffprobe, junior-face-detect)
- `python-sidecar/models/` (faster-whisper-tiny)
- `src/`, `public/`, `src-tauri/icons/`, `src-tauri/entitlements*`
- This was necessary because the previous build failed at codesign with "resource fork not allowed".

---

## ✅ CLAUDE'S 4 P0 FIXES (already in the commit)

These are all in `9729940`. Claude fixed them, Kimi committed them. Do NOT redo.

| # | Bug | File | Status |
|---|---|---|---|
| 1 | Dep preflight — `method_check_deps` probes imports | `sidecar.py` | ✅ In commit |
| 2 | Ingest error card — structured error envelope | `sidecar.py` + `App.tsx` | ✅ In commit |
| 3 | Download cancel — polling during yt-dlp download | `sidecar.py` | ✅ In commit |
| 4 | Stage errors — human-readable framing | `sidecar.rs` + `sidecar.py` | ✅ In commit |
| 5 | Download cancel button | `App.tsx` | ✅ In commit |
| 6 | VAD filter hang | `stages.py` | ✅ Fixed by Kimi (see above) |

---

## 🔴 REMAINING BUGS (Claude's P1/P2 list — NOT yet fixed)

These are still outstanding. If Claude wants to continue, these are the targets:

| # | Bug | Severity | File | Notes |
|---|---|---|---|---|
| 7 | Whisper model integrity — half-downloaded cache | 🟠 P1 | `stages.py:96-110` | Check `model.bin` SHA or size |
| 8 | Cancel + restart race — stale events bleed | 🟠 P1 | `sidecar.py` + frontend | Needs request IDs |
| 9 | Inconsistent yt-dlp configs (probe vs download) | 🟠 P1 | `sidecar.py` | Shared helper needed |
| 10 | ffmpeg fallback to bare "ffmpeg" — no PATH | 🟡 P2 | `stages.py:78-93` | Fresh Mac killer |
| 11 | IG/TikTok 401 — no cookiefile | 🟡 P2 | `sidecar.py:555-573,655-664,762-784` | Most reels need session cookie |
| 12 | Sidecar crash undetected — 1-hour silent spinner | 🟡 P2 | `sidecar.rs:155-159` | Python segfault detection |
| 13 | .lift_cancel marker leak | 🟡 P2 | `sidecar.py` | Mostly harmless |
| 14 | Calibration block swallows exceptions | 🟡 P2 | `sidecar.py:1428-1441` | `except: pass` debugging blind spot |

---

## 🔴 APPLE CERT BLOCKER

### Current State:
- **Developer ID Application cert exists** in Keychain Access (KT68NGT4LX, expires May 2031)
- **BUT:** `security find-identity -v -p codesigning` returns 0 results
- **Reason:** The login keychain is locked or the cert is in a different keychain (e.g., iCloud or System)
- **Screenshots confirmed:** The cert is visible in Keychain Access under **login → My Certificates**

### What the user needs to do:
1. Open **Keychain Access** (Spotlight)
2. Go to **login → My Certificates**
3. Find **"Developer ID Application: daniel diyepriye dokubo"**
4. Double-click it → set **"Allow all applications to access this item"** (or at least allow `codesign`)
5. Also: **Keychain Access → Edit → Keychain List** → ensure `login` is checked and at the top
6. Run `security find-identity -v -p codesigning` in Terminal — should show the cert

### Once that's done:
```bash
cd ~/Desktop/jnr/desktop
npm run tauri build
```
The build will use the real signing identity and produce a properly signed `.app` + `.dmg`.

---

## 📋 BUILD INSTRUCTIONS (if Claude needs to rebuild)

### Clean build (recommended after any fix):
```bash
cd ~/Desktop/jnr/desktop
xattr -cr python-sidecar/
xattr -cr src/
xattr -cr public/
xattr -cr src-tauri/
rm -rf src-tauri/target/release/bundle/
cd src-tauri && cargo clean
cd ..
npm run tauri build
```

### Quick ad-hoc build (for testing only):
```bash
cd ~/Desktop/jnr/desktop
npm run tauri build
# If codesign fails with xattrs:
xattr -cr "src-tauri/target/release/bundle/macos/Liquid Clips.app"
codesign --force --deep --sign - "src-tauri/target/release/bundle/macos/Liquid Clips.app"
cp -R "src-tauri/target/release/bundle/macos/Liquid Clips.app" /Applications/
```

### Dev mode (fastest, no sign needed):
```bash
cd ~/Desktop/jnr/desktop
npm run tauri dev
```

---

## ⚠️ DO NOT OVERWRITE

The following files have been modified and committed. If Claude works on them again, he should **base his changes on the current `main` branch (commit 9729940)** rather than starting from scratch:

- `desktop/python-sidecar/stages.py` — VAD fix, xattr-clean
- `desktop/python-sidecar/sidecar.py` — preflight, error cards, cancel logic
- `desktop/src-tauri/src/sidecar.rs` — structured error envelopes
- `desktop/src-tauri/tauri.conf.json` — signing identity
- `desktop/src/App.tsx` — cancel button, error cards
- `desktop/src/components/JuniorLoader.tsx`
- `desktop/src/components/invaders/InvadersCanvas.tsx`
- `desktop/src/lib/sidecar.ts`
- `desktop/src/assets/invaders/` (4 new PNG assets)

---

## 📝 VERSION HISTORY

- `v0.4.37` — last tagged release (2026-05-23)
- `v0.4.38` — package.json bumped but never built
- `v0.4.39` — current (Kimi + Claude fixes, ad-hoc signed, installed)

Next release should be tagged `v0.4.40` or later.

---

*Last updated: 2026-05-31 by Kimi (OpenClaw)*
*Contact: Daniel (user) — the user can share this with Claude when needed*
