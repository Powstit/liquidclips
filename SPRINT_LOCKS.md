# Sprint Locks — active file locks

Read this BEFORE editing any high-conflict file (see `~/Desktop/COMPLETION_SPRINT.md` for the list).

## Active locks
- [CODEX · 2026-05-31 23:00] items #1 + #9 + #21 + #22 Apple notarization/xattr/privacy/entitlements — editing .github/workflows/release.yml, desktop/scripts/notarize.sh, desktop/src-tauri/tauri.conf.json, desktop/src-tauri/PrivacyInfo.xcprivacy, desktop/src-tauri/entitlements-direct.plist
- [CODEX · 2026-05-31 23:20] item #11 account-app v2 pricing — editing account-app/src/components/PricingCards.tsx, account-app/src/components/PricingComparison.tsx, account-app/src/app/upgrade/page.tsx, account-app/src/app/dashboard/page.tsx, account-app/src/app/download/page.tsx, account-app/src/app/checkout/page.tsx

## Lock format
- `[AGENT · YYYY-MM-DD HH:MM] item #N <name> — editing <file paths comma-separated>`

## Rules
1. Add your lock entry BEFORE editing a high-conflict file. Commit just this file if needed.
2. If the file you want is locked, work a different item first.
3. Delete your lock entry immediately when done with that item.
4. Locks older than 4 hours are assumed stale — the other agent may remove and proceed.

## High-conflict files (locks required)
- `desktop/src/App.tsx`
- `desktop/src/components/Settings.tsx`
- `desktop/src/components/ClipPreview.tsx`
- `desktop/src/lib/sidecar.ts`
- `desktop/src/lib/backend.ts`
- `desktop/python-sidecar/sidecar.py` (specifically the `METHODS` dict)
- `desktop/python-sidecar/stages.py`
- `desktop/src-tauri/tauri.conf.json`

## Safe-to-edit files (no lock needed)
- New files (anywhere)
- Files owned exclusively by one agent per the ownership table
- Documentation files (CHANGELOG, READMEs, this file)
