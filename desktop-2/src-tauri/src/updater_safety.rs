// Updater pre-flight safety check (2026-09-03).
//
// Real incident: a production user's update reached "Writing the new
// build…" (i.e. the download fully succeeded) and then failed with the
// raw OS error "Cross-device link (os error 18)". Traced to a confirmed,
// still-unpatched bug in tauri-plugin-updater 2.10.1's macOS installer —
// see ~/.cargo/registry/src/…/tauri-plugin-updater-2.10.1/src/updater.rs,
// `impl Update::install_inner` (macOS block). That function:
//   1. extracts the downloaded build into a *system temp* dir
//      (`tempfile::Builder::new().tempdir()` — no `_in()` override, so it
//      resolves to `std::env::temp_dir()`, which is always on the boot
//      volume);
//   2. does `std::fs::rename(&self.extract_path, tmp_backup_dir…)` to move
//      the CURRENTLY RUNNING .app bundle into a backup location.
// `extract_path` is derived from `std::env::current_exe()` by
// `extract_path_from_executable()` (also this crate, re-exported — see
// `pub use updater::*` in its lib.rs) — it resolves to the `.app` bundle
// itself. `std::fs::rename` is a raw filesystem rename; it can only
// succeed within a single filesystem/volume. If the running app's volume
// differs from the boot volume (most commonly: launched straight from a
// mounted DMG, which macOS mounts as its own separate, often read-only
// volume — but the same failure applies to any other volume the temp dir
// isn't on, e.g. certain external or network-backed volumes), that
// rename() raises EXDEV, which install_inner only handles for the
// unrelated PermissionDenied case — everything else propagates as a raw,
// user-hostile io::Error.
//
// Rather than patch (or fork) the upstream crate, this check runs BEFORE
// we ever call `update.download()`/`update.install()`: it performs the
// exact same device comparison — the crate itself already does this same
// `dev()` comparison for its Linux AppImage path (see error.rs:66 +
// updater.rs:993) but not for macOS, which is the actual gap.
//
// Deliberately NOT path-string matching (e.g. "/Volumes/") — a real
// `st_dev` comparison is correct regardless of *why* the two locations
// are on different filesystems (mounted DMG, external drive, certain
// network/cloud-sync mount points, etc.), and never false-positives on
// exotic-but-same-device layouts a path prefix check could misjudge.
//
// Re-verify this file whenever `tauri-plugin-updater` is upgraded — a
// future version may fix the underlying macOS gap outright, in which case
// this pre-flight check becomes redundant defense-in-depth rather than
// load-bearing (harmless either way: it only ever blocks a doomed
// self-update attempt, never a safe one).

use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateInstallSafety {
    /// true = the running app and the updater's staging temp dir share a
    /// filesystem/volume, so the crate's internal rename() calls won't
    /// cross a device boundary.
    safe: bool,
    /// The `.app` bundle path the safety check resolved and compared —
    /// surfaced so the UI can offer "Reveal in Finder" on exactly this
    /// path without re-deriving it in JS.
    app_path: String,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn check_update_install_safety() -> Result<UpdateInstallSafety, String> {
    use std::os::unix::fs::MetadataExt;

    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let app_path = tauri_plugin_updater::extract_path_from_executable(&exe)
        .map_err(|e| format!("extract_path_from_executable: {e}"))?;

    let app_dev = std::fs::metadata(&app_path)
        .map_err(|e| format!("stat app bundle: {e}"))?
        .dev();
    let tmp_dev = std::fs::metadata(std::env::temp_dir())
        .map_err(|e| format!("stat temp dir: {e}"))?
        .dev();

    Ok(UpdateInstallSafety {
        safe: app_dev == tmp_dev,
        app_path: app_path.to_string_lossy().into_owned(),
    })
}

// Non-macOS builds (dev/CI on other hosts, if ever) — nothing to check;
// this crate's cross-device gap is macOS-specific (Linux already handles
// it internally, Windows installs via a different mechanism entirely).
// Report "safe" so the JS-side pre-flight is a no-op rather than a false
// block on platforms this bug doesn't affect.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn check_update_install_safety() -> Result<UpdateInstallSafety, String> {
    Ok(UpdateInstallSafety {
        safe: true,
        app_path: std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn safety_check_runs_and_reports_current_app_path() {
        // Under `cargo test`, current_exe() is the test binary itself, not
        // Liquid Clips.app — so this only asserts the check executes
        // end-to-end without panicking and returns a non-empty path; the
        // real safe/unsafe branches are covered by the manual DMG repro in
        // the acceptance test (see RELEASING.md), which this unit test
        // cannot simulate without an actual second volume.
        let result = check_update_install_safety();
        assert!(result.is_ok());
        assert!(!result.unwrap().app_path.is_empty());
    }
}
