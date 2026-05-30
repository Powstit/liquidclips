# Releasing Liquid Clips — Solo Founder Guide

**One-time setup (30 min). Then every release is 3 commands.**

---

## One-Time Setup

### 1. Apple Developer Certificates

You do this yourself. I cannot create your private signing key.

**Step A — Create Certificate Signing Request (CSR)**

Open Terminal, paste exactly:

```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout ~/Desktop/LiquidClips_DevID.key \
  -out ~/Desktop/LiquidClips_DevID.csr \
  -subj "/C=GB/O=Liquid Clips/CN=Liquid Clips Developer ID"
```

You now have two files on Desktop:
- `LiquidClips_DevID.key` — **PRIVATE KEY. Never share. Never commit.**
- `LiquidClips_DevID.csr` — public request, safe to upload

**Step B — Get Developer ID Application certificate**

1. Go to [developer.apple.com](https://developer.apple.com) → Account → Certificates, IDs & Profiles
2. Click **+** → **Developer ID Application** → Continue
3. Upload `LiquidClips_DevID.csr` → Download `.cer` file
4. Double-click `.cer` → opens Keychain Access

**Step C — Export as .p12 (what Tauri needs)**

1. Open **Keychain Access** (Spotlight search)
2. Left sidebar: click **login** → **My Certificates**
3. Find **Developer ID Application: Your Name**
4. Right-click → **Export "Developer ID Application..."**
5. Save to Desktop as `LiquidClips_DevID.p12`
6. Set a password — write it down. This is your **P12 password**.
7. Keychain asks for your Mac login password — type it.

**Step D — Generate Tauri updater signing key**

In Terminal:

```bash
cd ~/Desktop/jnr/desktop/src-tauri
cargo tauri signer generate
# It will prompt you for a password — set one, write it down
# This creates:
#   ~/.tauri/mykey.priv   (private — NEVER share)
#   ~/.tauri/mykey.pub    (public — already in tauri.conf.json)
```

Copy the public key from the output and verify it matches the `updater.pubkey` value already in `tauri.conf.json`. If they differ, update `tauri.conf.json` with the new pubkey.

**Step E — Create App-Specific Password for Notarization**

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign-In and Security → App-Specific Passwords
3. Generate one, name it "Tauri Notarization"
4. Copy the password (looks like `abcd-efgh-ijkl-mnop`)

---

### 2. GitHub Repository Secrets

Go to your GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**

Add these 6 secrets:

| Secret Name | Value | How to get |
|-------------|-------|-----------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file | `base64 -i ~/Desktop/LiquidClips_DevID.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set in Step C | Write it down in Step C |
| `APPLE_ID` | Your Apple ID email | `danieldiyepriye@gmail.com` |
| `APPLE_PASSWORD` | App-specific password from Step E | [appleid.apple.com](https://appleid.apple.com) |
| `APPLE_TEAM_ID` | 10-character Team ID | Apple Developer → Membership → Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.tauri/mykey.priv` | `cat ~/.tauri/mykey.priv \| pbcopy` |

**Verify:** The `APPLE_CERTIFICATE` value should start with `MII` (base64). Paste it into a blank text document to check — it should be a very long single line.

---

### 3. Updater Endpoint (Backend)

Tauri checks this JSON on every app launch to see if an update exists.

Create a new backend route at `app/routes/updater.py`:

```python
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class UpdateManifest(BaseModel):
    version: str
    notes: str
    pub_date: str
    url: str
    signature: str

# Hardcoded for now — replace with DB-backed config when you have time
_LATEST = {
    "version": "0.4.37",
    "notes": "Bug fixes and improvements",
    "pub_date": "2026-06-01T12:00:00Z",
    "url": "https://github.com/your-org/your-repo/releases/download/v0.4.37/Liquid.Clips_0.4.37_x64.dmg",
    "signature": "BASE64_SIGNATURE_FROM_BUILD_OUTPUT"
}

@router.get("/desktop/update/{target}/{current_version}")
def get_update(target: str, current_version: str):
    # target = "darwin-universal" or "darwin-aarch64" etc.
    # current_version = "0.4.34" (what user has)
    
    if current_version >= _LATEST["version"]:
        return {"available": False}
    
    return {
        "available": True,
        **_LATEST
    }
```

**After every release, update `_LATEST` with:**
1. New version number
2. Release notes (copy from CHANGELOG.md)
3. DMG URL (from GitHub Release assets)
4. Signature (from build output — see Step 5 below)

---

## Every Release (3 Commands, 5 Minutes)

### Step 1 — Write changelog

Edit `CHANGELOG.md`. Add a section under `[Unreleased]` describing what changed.

### Step 2 — Bump version

```bash
cd ~/Desktop/jnr/desktop
npm version patch   # or minor, or major
# This updates package.json and package-lock.json
```

Then sync `tauri.conf.json`:
```bash
# Edit tauri.conf.json — update "version" field to match package.json
```

### Step 3 — Commit, tag, push

```bash
cd ~/Desktop/jnr
git add .
git commit -m "release: v0.4.37"
git tag v0.4.37
git push origin main --tags
```

**What happens automatically:**

1. GitHub Actions triggers on the `v0.4.37` tag
2. Spins up a `macos-latest` runner
3. Installs Node, Rust, dependencies
4. Builds the universal binary (Intel + Apple Silicon)
5. Signs with your Developer ID certificate
6. Notarizes with Apple
7. Creates a GitHub Release as **Draft**
8. Uploads the signed `.dmg` and `.app.tar.gz`

### Step 4 — Publish the release

1. Go to GitHub → Releases → find the draft "Liquid Clips v0.4.37"
2. Edit the release notes (copied from CHANGELOG.md)
3. Click **Publish release**

### Step 5 — Update the updater endpoint

After the build finishes, GitHub Actions prints a log line like:

```
Signature: WN0YWduYXR1cmV...
```

Or you can extract it from the `.sig` file attached to the release.

Update your backend `/desktop/update/latest.json` (or the DB row) with:
- New version: `0.4.37`
- New DMG URL: copy from GitHub Release assets
- New signature: copy from build log or `.sig` file

**Users will get the update prompt within 24 hours** (Tauri checks on launch, then every 6 hours while running).

---

## Troubleshooting

### "No valid signing identity found"

- Verify `APPLE_CERTIFICATE` secret is correct base64 of the `.p12`
- Verify `APPLE_CERTIFICATE_PASSWORD` matches what you set in Keychain
- Verify `APPLE_TEAM_ID` is exactly 10 characters, no spaces

### "Notarization failed"

- Verify `APPLE_ID` and `APPLE_PASSWORD` (app-specific password, not your Apple ID password)
- Check Apple Developer → Certificates → is your Developer ID Application cert **valid** and **not expired**?
- Check Apple Developer → App-Specific Passwords → is the password still active?

### "The updater signature is invalid"

- The `TAURI_SIGNING_PRIVATE_KEY` secret must match the `updater.pubkey` in `tauri.conf.json`
- If you regenerated the keypair, update `tauri.conf.json` with the new pubkey

### Build hangs on "waiting on file lock"

- This is normal for Rust compiles on first build (15-20 min)
- GitHub Actions `macos-latest` has 4 cores — builds take 8-12 min
- If it exceeds 30 min, cancel and retry (Rust build cache gets corrupted sometimes)

### "This app is damaged" on user machine

- This is a Gatekeeper lie — the app is not damaged, it's just not notarized yet
- Tell users: Right-click → Open → "Open" (do this once, then double-click works forever)
- After notarization succeeds (24-48h), this warning disappears

---

## Advanced: Testing Locally Before Tagging

Want to verify the build works before pushing a tag? Run locally:

```bash
cd ~/Desktop/jnr/desktop

# Set your secrets as env vars (replace with actual values)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_CERTIFICATE="$(base64 -i ~/Desktop/LiquidClips_DevID.p12)"
export APPLE_CERTIFICATE_PASSWORD="your-p12-password"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="YOURTEAMID"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/mykey.priv)"

# Build
npm run tauri build -- --target universal-apple-darwin
```

This takes 15-30 minutes on first run. The output `.dmg` will be at `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.

**Tip:** The first time is slow. Subsequent builds are 3-5 min because Rust caches compiled crates.

---

## Summary Checklist

- [ ] Apple Developer ID Application certificate created
- [ ] `.p12` exported from Keychain with password
- [ ] Tauri updater signing key generated (`cargo tauri signer generate`)
- [ ] 6 GitHub repository secrets added
- [ ] Updater endpoint (`/desktop/update`) deployed on backend
- [ ] `CHANGELOG.md` maintained
- [ ] Test release tagged and build succeeded
- [ ] GitHub Release published
- [ ] Updater endpoint updated with new version + signature

**After this checklist: every future release is `git tag vX.Y.Z && git push --tags`. That's it.**

---

*Co-Authored-By: Kimi <noreply@kimi>*
