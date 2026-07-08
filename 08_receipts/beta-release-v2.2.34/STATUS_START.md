# Beta Release v2.2.34 · Status Start · 2026-07-08

Release Captain: taking over from Max. Daniel is out.

## Repo state at freeze
- Branch: `release/v2.2.34-hotfix` (freshly cut from `main` at `d70a622`)
- Latest tag on `main`: `desktop-2-v2.2.33` (BROKEN · crashing on Intel)
- Target next tag: `desktop-2-v2.2.34`
- No dirty files at freeze · Max's `updates.py` env-var patch committed at `d70a622`

## Known broken · v2.2.33
- Boot crash on Intel · confirmed by Daniel personally
- Root cause: `VITE_CLERK_PUBLISHABLE_KEY` not baked into CI build. Vite ships an empty string → ClerkProvider mounts with `""` → runtime crash before shell paints
- No auto-recovery path · users must delete + reinstall

## Live surfaces at freeze
| Surface | State |
|---|---|
| `liquidclips.app` (front door) | ✅ 200 |
| `liquidclips.app/download` | ✅ 200 · Kade hero live · button auto-follows GitHub Latest |
| `github.com/Powstit/liquidclips/releases/latest` | ✅ 200 (currently v2.2.33 · broken) |
| Direct dmgs (aarch64 · x86_64 for v2.2.33) | ✅ 200 (but the dmg is broken · crashes on boot) |
| `api.liquidclips.app/healthcheck` | ✅ 200 |
| `api.liquidclips.app/auth/clerk/exchange` | ✅ live · JWKS wired |
| `updates.liquidclips.app/latest.json` | ✅ patched by Max · returns v2.2.33 manifest with GitHub-hosted tarball URLs |
| `account.liquidclips.app/admin` | ⚠ 404 · edge cache stuck after alias reshuffle · not release-blocking |

## Guardrails in force
- No secrets in receipts / logs / chat / commits
- Verify every claim with a receipt
- No Railway-served dmgs
- No breaking working routes
- No fake success — only publish when the whole chain proves out

## Sprint scope (executing in order)
1. CI Clerk env fix (Phase 2)
2. CI auto-updater manifest publish (Phase 3)
3. Support/contact + error boundary (Phase 8) · adds Telegram/email fallback so no dead first screen
4. Version bump 2.2.33 → 2.2.34
5. Tag + push · CI builds
6. Verify release + manifest live
7. Manual install proof + friend-ready message
8. Final PROOF.md + BETA RELEASE STATUS block
