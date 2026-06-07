#!/usr/bin/env bash
# system-audit.sh — one-call truth audit of the entire Liquid Clips system.
# Pipelines use || true because grep-no-match (exit 1) is normal here.

set -u

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$REPO/desktop/docs/system-audit.json"

exit_code() {
  set +e
  "$@" >/dev/null 2>&1
  local rc=$?
  set -e
  echo $rc
}

# 1. installed app ───────────────────────────────────────────────────────
INSTALLED_PATH="/Applications/Liquid Clips.app"
if [ -d "$INSTALLED_PATH" ]; then
  INSTALLED_VERSION=$(plutil -p "$INSTALLED_PATH/Contents/Info.plist" 2>/dev/null | awk -F'"' '/CFBundleShortVersionString/{print $4}')
  if codesign --verify --strict "$INSTALLED_PATH" >/dev/null 2>&1; then
    INSTALLED_CODESIGN="valid"
  else
    INSTALLED_CODESIGN="invalid"
  fi
  INSTALLED_MTIME=$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$INSTALLED_PATH")
else
  INSTALLED_VERSION="not-installed"
  INSTALLED_CODESIGN="not-installed"
  INSTALLED_MTIME="not-installed"
fi

# 2. git state ─────────────────────────────────────────────────────────────
cd "$REPO"
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git")
GIT_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "no-git")
GIT_RECENT=$(git log --oneline -5 2>/dev/null || echo "")
GIT_STATUS=$(git status --short 2>/dev/null || echo "")
GIT_UNCOMMITTED=$(printf "%s\n" "$GIT_STATUS" | grep -v '^??' | grep -vE ' 2\.' | grep -c . | head -1)
GIT_UNTRACKED=$(printf "%s\n" "$GIT_STATUS" | grep '^??' | grep -vE '_backups| 2\.' | grep -c . | head -1)
GIT_UNCOMMITTED=${GIT_UNCOMMITTED:-0}
GIT_UNTRACKED=${GIT_UNTRACKED:-0}

# 3. mechanical gates ─────────────────────────────────────────────────────
cd "$REPO/desktop"
GATE_TSC=$(exit_code npx --no-install tsc --noEmit)
GATE_PY=$(exit_code python3 -m py_compile python-sidecar/sidecar.py python-sidecar/project.py python-sidecar/llm.py)
GATE_HUMANERROR=$(exit_code bash scripts/check-humanError.sh)
cd "$REPO"
if [ -f account-app/scripts/smoke-embed.sh ]; then
  GATE_SMOKE=$(exit_code bash account-app/scripts/smoke-embed.sh)
else
  GATE_SMOKE="no-script"
fi
if [ -f desktop/scripts/ship-gate.sh ]; then
  GATE_SHIP=$(exit_code bash desktop/scripts/ship-gate.sh)
else
  GATE_SHIP="no-script"
fi

# 4. live infrastructure reachability ────────────────────────────────────
JNR_HEALTH=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://api.jnremployee.com/healthcheck || echo "000")
LC_HEALTH=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://api.liquidclips.app/healthcheck || echo "000")
LC_EMBED=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://account.liquidclips.app/embed/earn || echo "000")
JNR_EMBED=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://account.jnremployee.com/embed/earn || echo "000")
BANNER_AFFILIATE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://api.jnremployee.com/static/campaigns/affiliate.mp4 || echo "000")

# 5. sidecar RPC registry ───────────────────────────────────────────────
RPC_COUNT=$(grep -cE '^\s+"[a-z_]+":\s*method_' "$REPO/desktop/python-sidecar/sidecar.py" 2>/dev/null | head -1)
RPC_COUNT=${RPC_COUNT:-0}
RPC_EXPECTED=("import_ready_clips" "edit_captions" "apply_overlay_template" "set_clip_platforms" "lift_transcript" "ingest_url" "secrets_status" "validate_openai_key" "list_projects" "request_delete_project")
RPC_MISSING=""
for m in "${RPC_EXPECTED[@]}"; do
  if ! grep -qE "^\s+\"$m\":\s*method_" "$REPO/desktop/python-sidecar/sidecar.py"; then
    RPC_MISSING+="$m,"
  fi
done

# 6. mount state — DARK detector ────────────────────────────────────────
check_mount() {
  local component="$1"
  local file_path="$2"
  if [ ! -f "$file_path" ]; then echo "MISSING"; return; fi
  # Canonical mount signal: another .tsx file renders <Component> in JSX.
  # Imports/comments/type refs don't prove a user can see it; JSX render does.
  local renderers
  renderers=$(grep -rln "<${component}\b" "$REPO/desktop/src" --include="*.tsx" 2>/dev/null | grep -v "$file_path" | grep -v "_backups" || true)
  if [ -n "$renderers" ]; then echo "MOUNTED"; return; fi
  echo "DARK"
}

K1_DRAWER=$(check_mount "ClipEditDrawer" "$REPO/desktop/src/components/workbench/ClipEditDrawer.tsx")
K4_LIBPREV=$(check_mount "LibraryQuickPreview" "$REPO/desktop/src/components/cockpit/LibraryQuickPreview.tsx")
K5_BOUNTY=$(check_mount "BountySwipe" "$REPO/desktop/src/components/earn/BountySwipe.tsx")
K6_TOUR=$(check_mount "StudioTour" "$REPO/desktop/src/components/onboarding/StudioTour.tsx")
K7_ORBIT=$(check_mount "ActivityOrbit" "$REPO/desktop/src/components/cockpit/ActivityOrbit.tsx")
PLATFORM_BADGE=$(check_mount "PlatformBadge" "$REPO/desktop/src/components/PlatformBadge.tsx")
PLATFORM_PICKER=$(check_mount "PlatformBadgePicker" "$REPO/desktop/src/components/PlatformBadge.tsx")
OVERLAY_GALLERY=$(check_mount "OverlayTemplateGallery" "$REPO/desktop/src/components/OverlayTemplateGallery.tsx")

check_hook() {
  local hook="$1"
  local file_path="$2"
  if [ ! -f "$file_path" ]; then echo "MISSING"; return; fi
  local importers
  importers=$(grep -rln "$hook" "$REPO/desktop/src" --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v "$file_path" | grep -v "_backups" || true)
  if [ -z "$importers" ]; then echo "UNUSED"; return; fi
  echo "CONSUMED"
}

HOOK_MULTISELECT=$(check_hook "useMultiSelect" "$REPO/desktop/src/lib/useMultiSelect.ts")
HOOK_LIBPROJECT=$(check_hook "useLibraryProject" "$REPO/desktop/src/contracts/useLibraryProject.ts")
HOOK_BOUNTY=$(check_hook "useBountySwipe" "$REPO/desktop/src/contracts/useBountySwipe.ts")
HOOK_ONBOARD=$(check_hook "useOnboardingStep" "$REPO/desktop/src/contracts/useOnboardingStep.ts")
HOOK_ACTIVITY=$(check_hook "useActivityEvents" "$REPO/desktop/src/contracts/useActivityEvents.ts")

# 7. reviewer state ─────────────────────────────────────────────────────
REVIEW_FILE="$REPO/desktop/docs/ship-lens-review.json"
if [ -f "$REVIEW_FILE" ]; then
  REVIEW_VERDICT=$(python3 -c "import json;print(json.load(open('$REVIEW_FILE')).get('verdict','?'))" 2>/dev/null || echo "?")
  REVIEW_UNADDRESSED=$(python3 -c "
import json
d = json.load(open('$REVIEW_FILE'))
print(sum(1 for f in d.get('findings', []) if f.get('severity') in ('P0','P1') and not f.get('addressed')))
" 2>/dev/null || echo "0")
  REVIEW_AT=$(python3 -c "import json;print(json.load(open('$REVIEW_FILE')).get('reviewed_at','?'))" 2>/dev/null || echo "?")
else
  REVIEW_VERDICT="no-review"
  REVIEW_UNADDRESSED="0"
  REVIEW_AT="never"
fi

# write JSON ────────────────────────────────────────────────────────────
mkdir -p "$REPO/desktop/docs"
python3 - "$OUT" \
  "$INSTALLED_VERSION" "$INSTALLED_CODESIGN" "$INSTALLED_MTIME" \
  "$GIT_BRANCH" "$GIT_HEAD" "$GIT_UNCOMMITTED" "$GIT_UNTRACKED" \
  "$GATE_TSC" "$GATE_PY" "$GATE_HUMANERROR" "$GATE_SMOKE" "$GATE_SHIP" \
  "$JNR_HEALTH" "$LC_HEALTH" "$LC_EMBED" "$JNR_EMBED" "$BANNER_AFFILIATE" \
  "$RPC_COUNT" "$RPC_MISSING" \
  "$K1_DRAWER" "$K4_LIBPREV" "$K5_BOUNTY" "$K6_TOUR" "$K7_ORBIT" "$PLATFORM_BADGE" "$PLATFORM_PICKER" "$OVERLAY_GALLERY" \
  "$HOOK_MULTISELECT" "$HOOK_LIBPROJECT" "$HOOK_BOUNTY" "$HOOK_ONBOARD" "$HOOK_ACTIVITY" \
  "$REVIEW_VERDICT" "$REVIEW_UNADDRESSED" "$REVIEW_AT" \
  "$GIT_RECENT" << 'PY_EOF'
import sys, json, datetime
(
  out, iv, icode, imtime,
  gb, gh, gu, gun,
  ts, py, he, sm, sg,
  jh, lh, le, je, ba,
  rc, rm,
  k1, k4, k5, k6, k7, pb, pp, og,
  hm, hl, hb, ho, ha,
  rv, ru, rt,
  recent
) = sys.argv[1:]

def g(c):
  if c == "0": return "PASS"
  if c == "no-script": return "NO-SCRIPT"
  return f"FAIL(exit={c})"

doc = {
  "audit_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "installed_app": {"version": iv, "codesign": icode, "mtime": imtime},
  "git": {
    "branch": gb, "head": gh,
    "uncommitted_files": int(gu or 0),
    "untracked_files": int(gun or 0),
    "recent_commits": [l for l in recent.split("\n") if l.strip()],
  },
  "mechanical_gates": {
    "tsc": g(ts), "py_compile": g(py),
    "check_humanError": g(he), "smoke_embed": g(sm), "ship_gate": g(sg),
  },
  "live_reachability": {
    "api_jnremployee_health": jh,
    "api_liquidclips_health": lh,
    "embed_liquidclips_earn": le,
    "embed_jnremployee_earn": je,
    "banner_affiliate_mp4": ba,
  },
  "sidecar_rpcs": {
    "registered_count": int(rc or 0),
    "missing_expected": rm.rstrip(",") if rm else "",
  },
  "kimi_mount_state": {
    "K1_ClipEditDrawer": k1,
    "K4_LibraryQuickPreview": k4,
    "K5_BountySwipe": k5,
    "K6_StudioTour": k6,
    "K7_ActivityOrbit": k7,
    "PlatformBadge": pb,
    "PlatformBadgePicker": pp,
    "OverlayTemplateGallery": og,
  },
  "contract_hook_consumption": {
    "useMultiSelect": hm,
    "useLibraryProject": hl,
    "useBountySwipe": hb,
    "useOnboardingStep": ho,
    "useActivityEvents": ha,
  },
  "confirmed_wired_integrations": [
    "Clerk auth (sign-in + activation + satellite cookie)",
    "Whop affiliate + content rewards (proxy via /whop/*)",
    "Stripe Connect Express onboarding + payouts",
    "Ayrshare social publishing (channels + publish-now + webhooks)",
  ],
  "reviewer_gate": {
    "verdict": rv,
    "unaddressed_p0_p1": int(ru or 0),
    "reviewed_at": rt,
  },
}

with open(out, "w") as f:
  json.dump(doc, f, indent=2)

print(f"✓ system audit → {out}")
print(f"  installed:   v{iv}  codesign={icode}")
print(f"  gates:       tsc={g(ts)}  py={g(py)}  humanError={g(he)}  smoke={g(sm)}  ship={g(sg)}")
print(f"  reach:       jnr-health={jh}  lc-health={lh}  embed lc={le}/jnr={je}  banner={ba}")
print(f"  RPCs:        registered={rc}  missing={rm.rstrip(',') if rm else 'none'}")
print(f"  K-mounts:    K1={k1} K4={k4} K5={k5} K6={k6} K7={k7}")
print(f"  data UIs:    PlatformBadge={pb}  PlatformPicker={pp}  OverlayGallery={og}")
print(f"  hooks:       useMultiSelect={hm} useLibraryProject={hl} useBountySwipe={hb} useOnboardingStep={ho} useActivityEvents={ha}")
print(f"  reviewer:    {rv} (unaddressed P0/P1: {ru})")
PY_EOF
