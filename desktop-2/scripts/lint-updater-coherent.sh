#!/usr/bin/env bash
# IG-UPDATER-COHERENT · Layer 2 · The Rust updater MUST be coherent:
# streaming download, connect-only timeout, stall watchdog, Range/If-Range
# resume, retry with backoff, atomic promote, LKG snapshot, healthy-boot
# acknowledgement.
# LOCKED 2026-07-20.
#
# The regression this locks: the pre-v2 updater used a 30-second whole-
# request timeout on reqwest which killed every 275MB download over any
# real home connection. The webview then loaded the previously staged
# bundle before the async retry completed, so a successful new bundle
# was never used until another launch. This fence enforces every element
# of the coherent v2 replacement so a hostile refactor can't quietly
# regress any single piece.
#
# 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IG-UPDATER-COHERENT sentinel in runtime.rs
#   Layer 2 · THIS grep-guard (source-text asserts the wire)
#   Layer 3 · Rust unit tests inside runtime.rs
#   Layer 4 · Runtime — the actual streaming/resume/watchdog/backoff
#
# Wired into .githooks/pre-commit + scripts/iron-gates.sh fast tier.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
RUNTIME_RS="${LINT_UPDATER_COHERENT_TARGET:-$REPO_ROOT/desktop-2/src-tauri/src/runtime.rs}"

if [ ! -f "$RUNTIME_RS" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

fail=0
missing=""

check() {
  local pattern=$1
  local hint=$2
  if ! /usr/bin/grep -Eq "$pattern" "$RUNTIME_RS"; then
    fail=1
    missing="${missing}
  - $hint
    (pattern: $pattern)"
  fi
}

antimatch() {
  local pattern=$1
  local hint=$2
  if /usr/bin/grep -Eq "$pattern" "$RUNTIME_RS"; then
    fail=1
    missing="${missing}
  - $hint
    (pattern: $pattern · MUST NOT appear)"
  fi
}

# ── STREAMING download — no full-body buffering ────────────────────────
check 'bytes_stream'                                    "response streamed via bytes_stream (was: .bytes().await full buffer)"
check 'StreamExt'                                       "futures_util::StreamExt imported for chunked reads"

# ── connect_timeout, NOT whole-body timeout ────────────────────────────
check '\.connect_timeout'                               ".connect_timeout() on reqwest client"
antimatch 'Client::builder\(\)[^;]*\.timeout\('         "Client-level .timeout() is the pre-v2 bug · do not reintroduce"

# ── Stall watchdog · resettable per-chunk ──────────────────────────────
check 'STALL_TIMEOUT'                                   "STALL_TIMEOUT constant"
check 'tokio::time::timeout\(STALL_TIMEOUT'             "stall watchdog wraps every chunk read"

# ── Range / If-Range resume ────────────────────────────────────────────
check '"Range"'                                         "Range header sent on resume"
check '"If-Range"'                                      "If-Range header sent on resume"
check 'partial_path'                                    ".partial file path helper"
check 'partial_etag_path'                               "ETag persistence for If-Range on next attempt"

# ── Retry loop with bounded backoff ────────────────────────────────────
check 'MAX_ATTEMPTS'                                    "MAX_ATTEMPTS retry ceiling"
check 'backoff_for'                                     "exponential backoff between attempts"

# ── Progress emission ──────────────────────────────────────────────────
check 'runtime:progress'                                "runtime:progress event emitted for the bootstrap splash"
check 'runtime:decision'                                "runtime:decision event emitted on terminal outcome"
check 'DownloadProgress'                                "structured progress payload type"

# ── Signature + hash verification (preserved) ──────────────────────────
check 'minisign_verify::Signature::decode'              "minisign signature decode preserved"
check 'pubkey\.verify\(&bundle_bytes'                   "minisign verify against downloaded bytes preserved"
check 'Sha256::new'                                     "sha256 verify preserved"

# ── Atomic promote + LKG + health-ack + rollback ───────────────────────
check 'write_current_pointer'                           "atomic pointer write helper (via .tmp + rename)"
check 'previous_version'                                "LKG previous_version field on pointer"
check 'previous_sha256'                                 "LKG previous_sha256 field on pointer"
check 'healthy_boot_ack_at'                             "healthy_boot_ack_at field on pointer"
check 'boot_attempts'                                   "boot_attempts counter"
check 'HEALTHY_BOOT_ATTEMPT_LIMIT'                      "HEALTHY_BOOT_ATTEMPT_LIMIT constant"
check 'maybe_rollback_unhealthy_boot'                   "rollback trigger fn"
check 'runtime_ack_boot_healthy'                        "runtime_ack_boot_healthy Tauri command"

# ── Path-traversal guard on extraction ─────────────────────────────────
check 'extract_tarball_safe'                            "traversal-safe extract wrapper"
check 'Component::ParentDir'                            "reject .. components explicitly"
check 'Component::RootDir'                              "reject root components explicitly"

# ── Concurrency lock ───────────────────────────────────────────────────
check 'try_take_updater_lock'                           "updater concurrency lock helper"
check 'release_updater_lock'                            "lock release helper"
check 'updater\.lock'                                   "lock file path literal"

if [ $fail -ne 0 ]; then
  echo "IG-UPDATER-COHERENT FAIL · Rust updater coherence contract broken"
  echo "$missing"
  echo ""
  echo "  Every element above is required so the shell-owned updater"
  echo "  stays coherent. Removing any of them re-opens the class of"
  echo "  bugs that stranded users on 2.2.57 for weeks."
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-UPDATER-COHERENT 2026-07-20"
  exit 1
fi

echo "IG-UPDATER-COHERENT · streaming + resume + watchdog + atomic promote + LKG + ack · PASS"
exit 0
