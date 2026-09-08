// Liquid Clips — native macOS Contacts picker bridge (Phase 2).
//
// Spawns a small prebuilt Swift helper binary
// (native-contacts/dist/liquidclips-contacts-picker, built by
// native-contacts/build.sh, bundled via tauri.conf.json's
// `bundle.resources` — same shipping pattern as the Python sidecar in
// sidecar.rs) that shows exactly one native CNContactPicker popover
// and prints a single line of JSON to stdout describing the user's
// explicit selection (or cancellation). This module never touches the
// address book itself — it only spawns the helper process and relays
// its stdout line back to the frontend verbatim.
//
// Alternative contact source alongside the existing Google OAuth/
// Gmail-metadata flow (f5/googleOAuth.ts, f5/contactScan.ts on the
// frontend) — those remain untouched; this command is additive.

use std::path::PathBuf;
use tauri::Manager;

fn locate_helper_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Production / bundled: the `"native-contacts/dist/..."` entry in
    // tauri.conf.json's bundle.resources lands here verbatim, since
    // native-contacts/ already lives inside src-tauri/ (no `../`
    // segments in the resource path, so none of the `_up_` encoding
    // Tauri applies to parent-relative resources — see sidecar.rs's
    // python-sidecar comment — applies here).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir
            .join("native-contacts")
            .join("dist")
            .join("liquidclips-contacts-picker");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Dev (`tauri dev`): resource_dir() may not point at a real bundle.
    // Fall back to the fixed on-disk location relative to this crate —
    // mirrors sidecar.rs's Bundled/Dev fallback pattern.
    let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("native-contacts")
        .join("dist")
        .join("liquidclips-contacts-picker");
    if dev_candidate.is_file() {
        return Some(dev_candidate);
    }
    None
}

/// Returns one JSON line describing the user's explicit pick:
///   {"status":"selected","email":"...","displayName":"..."}
///   {"status":"no_email","displayName":"..."}
///   {"status":"cancelled"}
///   {"status":"error","message":"..."}
/// The frontend (desktop-2/src/lib/f5/nativeContactPicker.ts) parses
/// this string — this command does no JSON validation itself, it only
/// relays the helper's stdout.
#[tauri::command]
pub fn pick_contact_macos(app: tauri::AppHandle) -> Result<String, String> {
    if !cfg!(target_os = "macos") {
        return Ok(r#"{"status":"error","message":"native contact picker is macOS-only"}"#.to_string());
    }

    let Some(binary) = locate_helper_binary(&app) else {
        return Ok(r#"{"status":"error","message":"contacts picker helper not bundled — run native-contacts/build.sh"}"#.to_string());
    };

    // Blocks this command's worker thread until the user picks a
    // contact or cancels — expected, since this is a modal, user-paced
    // selection, not a background task. Tauri commands run off the
    // main/webview thread by default, so this does not freeze the UI.
    let output = std::process::Command::new(&binary)
        .output()
        .map_err(|e| format!("failed to spawn contacts picker helper: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "contacts picker helper produced no output (stderr: {stderr})"
        ));
    }
    Ok(stdout)
}
