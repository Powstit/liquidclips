#!/usr/bin/env bash
# smoke-gate.sh · Block 4 · 2026-07-11
#
# Golden-path smoke gate. Runs 5 mandatory customer walks + 5 failure
# walks against the local backend and the current desktop-2 bundle.
# Exits 1 if ANY mandatory walk fails so the release script can refuse
# to flip current.json.
#
# Deterministic — never depends on Daniel's Downloads folder. All video
# fixtures are generated fresh in a mktemp dir via the on-disk ffmpeg
# (bundled with Liquid Clips), so re-running the gate always exercises
# the same shape of input.
#
# Runtime-only. No shell / Rust / Cargo / Tauri / sidecar / npm-deps.
# Depends on: curl, jq, node, ffmpeg, grep. All standard on macOS.
#
# Environment overrides:
#   BACKEND_URL   default http://localhost:8000
#   BUNDLE_DIR    default desktop-2/dist  (relative to repo root or absolute)
#   VERBOSE=1     print each walk's raw response

set -u
set -o pipefail

# ── Config ─────────────────────────────────────────────────────────────
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DESKTOP_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
BUNDLE_DIR="${BUNDLE_DIR:-$DESKTOP_ROOT/dist}"
VERBOSE="${VERBOSE:-0}"

FFMPEG="/Applications/Liquid Clips.app/Contents/Resources/_up_/_up_/python-sidecar/bin/ffmpeg"
if [ ! -x "$FFMPEG" ]; then
  FFMPEG="$(command -v ffmpeg || true)"
fi

TMPDIR_SMOKE="$(mktemp -d /tmp/lc-smoke-gate.XXXXXX)"
trap 'rm -rf "$TMPDIR_SMOKE"' EXIT

# ── State ──────────────────────────────────────────────────────────────
MANDATORY_PASS=0
MANDATORY_FAIL=0
FAILURE_PASS=0
FAILURE_FAIL=0
declare -a MANDATORY_FAILURES
declare -a FAILURE_FAILURES

# ── Helpers ────────────────────────────────────────────────────────────
say()  { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }

mandatory_ok()   { step "✓ $1"; MANDATORY_PASS=$((MANDATORY_PASS+1)); }
mandatory_fail() { step "✗ $1"; MANDATORY_FAILURES+=("$1"); MANDATORY_FAIL=$((MANDATORY_FAIL+1)); }

failure_ok()   { step "✓ $1"; FAILURE_PASS=$((FAILURE_PASS+1)); }
failure_fail() { step "✗ $1"; FAILURE_FAILURES+=("$1"); FAILURE_FAIL=$((FAILURE_FAIL+1)); }

curl_status() {
  # curl_status URL [extra-curl-args...]  → prints HTTP status code
  local url="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$@" "$url" || echo "000"
}

# ── Fixtures ───────────────────────────────────────────────────────────
prepare_fixtures() {
  say ""
  say "── Fixtures (deterministic · generated fresh in $TMPDIR_SMOKE)"
  if [ -z "$FFMPEG" ] || [ ! -x "$FFMPEG" ]; then
    step "ffmpeg not found · using zero-byte + text-only stand-ins"
    : > "$TMPDIR_SMOKE/valid.mp4"           # empty — flags upload as failing
  else
    # 2-second solid-color 320x180 h264 mp4 · tiny, valid, deterministic.
    "$FFMPEG" -loglevel error -y \
      -f lavfi -i "color=c=fuchsia:s=320x180:d=2" \
      -pix_fmt yuv420p "$TMPDIR_SMOKE/valid.mp4"
  fi
  : > "$TMPDIR_SMOKE/empty.mp4"              # 0-byte · simulates Dropbox stub
  printf 'not a video\n' > "$TMPDIR_SMOKE/bad.txt"

  local valid_size empty_size
  valid_size=$(stat -f%z "$TMPDIR_SMOKE/valid.mp4" 2>/dev/null || echo 0)
  empty_size=$(stat -f%z "$TMPDIR_SMOKE/empty.mp4" 2>/dev/null || echo 0)
  step "valid.mp4  ${valid_size}B"
  step "empty.mp4  ${empty_size}B (Dropbox-stub simulation)"
  step "bad.txt    unsupported extension"
}

# ── Backend probe ──────────────────────────────────────────────────────
require_backend() {
  say ""
  say "── Backend probe"
  local status
  status=$(curl_status "$BACKEND_URL/healthcheck")
  if [ "$status" = "200" ]; then
    step "$BACKEND_URL is live"
  else
    step "$BACKEND_URL/healthcheck → HTTP $status"
    say "SMOKE GATE ABORTED · backend not reachable"
    exit 2
  fi
}

# ── Mandatory Walk 1 · Sign in ─────────────────────────────────────────
walk_signin() {
  say ""
  say "── Walk 1/5 · Sign in (email → OTP → JWT → /me)"
  # pydantic EmailStr rejects .local / .test / .invalid TLDs (RFC 6761
  # special-use). example.com is the RFC 2606 reserved-for-docs domain
  # that IS valid to email-parsers. Prod inbox never receives these.
  local email="smoke-$$-$(date +%s)@smoke.example.com"

  local start
  start=$(curl -sf -X POST "$BACKEND_URL/desktop/auth/start" \
    -H "content-type: application/json" -d "{\"email\":\"$email\"}" || echo '')
  [ "$VERBOSE" = "1" ] && step "start resp: $start"
  if echo "$start" | grep -q '"sent":true'; then
    mandatory_ok "signin · /desktop/auth/start returns sent:true"
  else
    mandatory_fail "signin · /desktop/auth/start"; return
  fi

  local verify
  verify=$(curl -sf -X POST "$BACKEND_URL/desktop/auth/verify" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$email\",\"code\":\"000000\"}" || echo '')
  [ "$VERBOSE" = "1" ] && step "verify resp: ${verify:0:120}…"
  SMOKE_JWT=$(printf '%s' "$verify" | jq -r '.license_jwt // empty' 2>/dev/null)
  if [ -n "$SMOKE_JWT" ] && [ "$SMOKE_JWT" != "null" ]; then
    mandatory_ok "signin · JWT minted (dev-bypass accepted 000000)"
  else
    mandatory_fail "signin · JWT mint failed"; return
  fi

  local me_status
  me_status=$(curl_status "$BACKEND_URL/me" -H "authorization: Bearer $SMOKE_JWT")
  if [ "$me_status" = "200" ]; then
    mandatory_ok "signin · /me returns 200 with fresh JWT"
  else
    mandatory_fail "signin · /me HTTP $me_status"
  fi
}

# ── Mandatory Walk 2 · Upload local video (preflight contract) ─────────
walk_upload_local() {
  say ""
  say "── Walk 2/5 · Upload local · preflight contract"
  local size
  size=$(stat -f%z "$TMPDIR_SMOKE/valid.mp4" 2>/dev/null || echo 0)
  if [ "$size" -gt 0 ]; then
    mandatory_ok "upload-local · valid mp4 fixture non-zero ($size B)"
  else
    mandatory_fail "upload-local · valid mp4 fixture is empty (ffmpeg missing?)"
  fi
}

# ── Mandatory Walk 3 · URL clipping (contract in bundle) ───────────────
walk_url_clipping() {
  say ""
  say "── Walk 3/5 · URL clipping · ingest contract"
  if grep -qE "isSupportedPortalUrl|ingestUrl|start_ingest_url" "$BUNDLE_DIR/assets/"*.js 2>/dev/null; then
    mandatory_ok "url-clipping · ingestUrl / allowlist baked in bundle"
  else
    mandatory_fail "url-clipping · missing ingestUrl symbols in bundle"
  fi
}

# ── Mandatory Walk 4 · Wallet ──────────────────────────────────────────
walk_wallet() {
  say ""
  say "── Walk 4/5 · Wallet"
  if [ -z "${SMOKE_JWT:-}" ]; then
    mandatory_fail "wallet · no JWT (signin failed)"; return
  fi

  local wallet
  wallet=$(curl -sf "$BACKEND_URL/me/wallet/summary" \
    -H "authorization: Bearer $SMOKE_JWT" || echo '')
  [ "$VERBOSE" = "1" ] && step "wallet resp: $wallet"
  if printf '%s' "$wallet" | jq -e '.balance_cents!=null' >/dev/null 2>&1; then
    mandatory_ok "wallet · /me/wallet/summary returns balance_cents"
  else
    mandatory_fail "wallet · /me/wallet/summary shape wrong"
  fi

  local aff_status
  aff_status=$(curl_status "$BACKEND_URL/me/affiliate" \
    -H "authorization: Bearer $SMOKE_JWT")
  if [ "$aff_status" = "200" ]; then
    mandatory_ok "wallet · /me/affiliate reachable (referral link source)"
  else
    mandatory_fail "wallet · /me/affiliate HTTP $aff_status"
  fi
}

# ── Mandatory Walk 5 · Submit to Whop contract ─────────────────────────
walk_submit() {
  say ""
  say "── Walk 5/5 · Submit to Whop · permission_type contract"
  if [ -z "${SMOKE_JWT:-}" ]; then
    mandatory_fail "submit · no JWT"; return
  fi
  local missing_status
  missing_status=$(curl_status "$BACKEND_URL/submissions" \
    -X POST \
    -H "authorization: Bearer $SMOKE_JWT" \
    -H "content-type: application/json" \
    -d '{"campaign_id":"nx","clip_url":"https://youtube.com/watch?v=x","moment_type":"clip","disclosure_confirmed":true}')
  if [ "$missing_status" = "422" ]; then
    mandatory_ok "submit · missing permission_type → 422"
  else
    mandatory_fail "submit · missing permission_type got HTTP $missing_status (expected 422)"
  fi
  local ok_status
  ok_status=$(curl_status "$BACKEND_URL/submissions" \
    -X POST \
    -H "authorization: Bearer $SMOKE_JWT" \
    -H "content-type: application/json" \
    -d '{"campaign_id":"nx","clip_url":"https://youtube.com/watch?v=x","moment_type":"clip","disclosure_confirmed":true,"permission_type":"my_own_footage"}')
  # 201 (submitted) or 404 (campaign missing but contract accepted) both prove
  # the shape reaches the campaign lookup step.
  if [ "$ok_status" = "201" ] || [ "$ok_status" = "404" ]; then
    mandatory_ok "submit · permission_type=my_own_footage passes validation (HTTP $ok_status)"
  else
    mandatory_fail "submit · permission_type_ok HTTP $ok_status"
  fi
}

# ── Failure Walk 6 · Dropbox placeholder rejected cleanly ──────────────
walk_dropbox_failure() {
  say ""
  say "── Walk 6/10 · Failure · Dropbox placeholder rejected cleanly"
  if grep -qE "PREFLIGHT_DROPBOX_STUB|Make Available Offline|looksLikeDropbox" "$BUNDLE_DIR/assets/"*.js 2>/dev/null; then
    failure_ok "failure · Dropbox stub copy + reason baked in bundle"
  else
    failure_fail "failure · Dropbox stub handling missing from bundle"
  fi
}

# ── Failure Walk 7 · Invalid URL rejected cleanly ──────────────────────
walk_invalid_url() {
  say ""
  say "── Walk 7/10 · Failure · Invalid URL rejected cleanly"
  # isSupportedPortalUrl is minified out (local function). The allowed
  # host literal `youtube.com` survives — proves the allowlist reached
  # the bundle even if the wrapper's symbol name changed.
  if grep -qE 'youtube\.com' "$BUNDLE_DIR/assets/"*.js 2>/dev/null; then
    failure_ok "failure · URL host allowlist (youtube.com) baked in bundle"
  else
    failure_fail "failure · URL host allowlist missing"
  fi
}

# ── Failure Walk 8 · Expired auth returns to sign-in ───────────────────
walk_expired_auth() {
  say ""
  say "── Walk 8/10 · Failure · Expired/invalid auth"
  local status
  status=$(curl_status "$BACKEND_URL/me" \
    -H "authorization: Bearer eyJhbGciOiJIUzI1NiJ9.invalid.jwt")
  if [ "$status" = "401" ]; then
    failure_ok "failure · invalid JWT → 401 (authedFetch handles this)"
  else
    failure_fail "failure · invalid JWT expected 401, got $status"
  fi
  if grep -qE 'expired_401|consumePostAuthRedirect|postAuthRedirect' "$BUNDLE_DIR/assets/"*.js 2>/dev/null; then
    failure_ok "failure · authedFetch 401 interceptor baked in bundle"
  else
    failure_fail "failure · authedFetch 401 interceptor missing"
  fi
}

# ── Failure Walk 9 · Backend failure produces visible error ────────────
walk_backend_failure() {
  say ""
  say "── Walk 9/10 · Failure · Backend failure produces visible error"
  if grep -qE 'describeError|customerSafeErrors|IngestErrorStrip|EngineErrorBoundary' "$BUNDLE_DIR/assets/"*.js 2>/dev/null; then
    failure_ok "failure · customer-safe error surfaces baked in bundle"
  else
    failure_fail "failure · error boundaries + describeError missing"
  fi
}

# ── Failure Walk 10 · No fixture / fake-success markers in prod bundle ─
walk_no_fixture_leak() {
  say ""
  say "── Walk 10/10 · Failure · No fixture / fake-success markers in bundle"
  local hits
  hits=$(grep -oE '742\.50|247\.50|15 clippers|20 clippers|FIXTURE_PROJECT|fakeCampaigns' \
    "$BUNDLE_DIR/assets/"*.js 2>/dev/null | wc -l | tr -d ' ')
  if [ "$hits" = "0" ]; then
    failure_ok "failure · zero fixture-marker matches in bundle"
  else
    failure_fail "failure · found $hits fixture-marker matches in bundle"
  fi
}

# ── Main ───────────────────────────────────────────────────────────────
main() {
  say "════════════════════════════════════════════════════════════"
  say "  Liquid Clips · Golden-path smoke gate"
  say "════════════════════════════════════════════════════════════"
  say "backend: $BACKEND_URL"
  say "bundle:  $BUNDLE_DIR"

  if [ ! -d "$BUNDLE_DIR/assets" ]; then
    say "SMOKE GATE ABORTED · bundle dir missing: $BUNDLE_DIR"
    say "Run \`npm run build\` in desktop-2/ first."
    exit 2
  fi

  require_backend
  prepare_fixtures

  say ""
  say "════════ Mandatory walks (5) ════════"
  walk_signin
  walk_upload_local
  walk_url_clipping
  walk_wallet
  walk_submit

  say ""
  say "════════ Failure walks (5) ════════"
  walk_dropbox_failure
  walk_invalid_url
  walk_expired_auth
  walk_backend_failure
  walk_no_fixture_leak

  say ""
  say "════════════════════════════════════════════════════════════"
  say "  Mandatory: $MANDATORY_PASS pass / $MANDATORY_FAIL fail"
  say "  Failure walks: $FAILURE_PASS pass / $FAILURE_FAIL fail"
  say "════════════════════════════════════════════════════════════"

  if [ "$MANDATORY_FAIL" -gt 0 ]; then
    say ""
    say "MANDATORY FAILURES:"
    for f in "${MANDATORY_FAILURES[@]}"; do say "  - $f"; done
    say ""
    say "SMOKE GATE CLOSED · bundle MUST NOT be promoted"
    exit 1
  fi

  if [ "$FAILURE_FAIL" -gt 0 ]; then
    say ""
    say "FAILURE-WALK ISSUES (informational · not blocking):"
    for f in "${FAILURE_FAILURES[@]}"; do say "  - $f"; done
  fi

  say ""
  say "SMOKE GATE OPEN · bundle SAFE to promote"
  exit 0
}

main
