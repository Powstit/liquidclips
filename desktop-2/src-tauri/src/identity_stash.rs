// Identity stash — Tauri command for writing thumbnail identity reference
// images to disk so the Python sidecar can read them.
//
// Background: `ThumbnailIdentityUpload.tsx` used to hand a `blob:` URI
// (`URL.createObjectURL(f)`) to `thumbnail.saveIdentity(...)`. The Python
// sidecar cannot open blob URIs — it only reads real filesystem paths —
// so identity-locked thumbnails failed 100% on shipped Tauri builds
// (only the dev mock accepted them, which is where the bug hid).
//
// The frontend now sends `bytes: number[]` (a JS Uint8Array) plus the
// original filename, and this command writes them to
//   `~/Library/Application Support/Liquid Clips/identity/staging/<sanitized_name>`
// returning the absolute path. The sidecar then reads that path.
//
// Hard rules:
//   - `name` is sanitized: no path separators, no `..`, cap length.
//   - `bytes` is capped so a malicious/renegade frontend can't OOM us.
//   - Directory is created with `fs::create_dir_all` (idempotent).

use std::fs;
use std::path::PathBuf;

/// Max bytes accepted per upload (32 MiB). Real face-crop references are
/// well under this; the cap protects against runaway frontends and OOM.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Max characters allowed in the sanitized filename. macOS APFS allows 255;
/// we clip earlier so leaves room for suffixes and stays HFS-friendly.
const MAX_NAME_LEN: usize = 120;

/// `~/Library/Application Support/Liquid Clips/identity/staging/` on macOS,
/// mirrors `runtime_root_dir` in runtime.rs so identity + runtime data live
/// under the same app-support root.
fn identity_staging_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_default()
                .join(".local")
                .join("share")
        })
        .join("Liquid Clips")
        .join("identity")
        .join("staging")
}

/// Reduce an arbitrary user-supplied `name` down to a filesystem-safe
/// leaf name. Strips path separators, `..`, control characters, and any
/// non-`[A-Za-z0-9._-]` byte. Empty results fall back to `identity`.
/// Length capped at `MAX_NAME_LEN`.
fn sanitize_name(input: &str) -> String {
    // Take only the trailing component so `../../etc/passwd` becomes `passwd`
    // before further filtering (defence-in-depth; the char filter below also
    // strips `.` and `/` but we don't want to rely on a single layer).
    let leaf = std::path::Path::new(input)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let filtered: String = leaf
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();

    // Reject leading `.` so `.htaccess`-style hidden files can't be written
    // and reject empty names (all chars stripped).
    let cleaned = filtered.trim_start_matches('.');
    let base = if cleaned.is_empty() {
        "identity".to_string()
    } else {
        cleaned.to_string()
    };

    // Cap length. Truncation is on chars (all ASCII by this point) so no
    // UTF-8 boundary risk.
    if base.len() > MAX_NAME_LEN {
        base[..MAX_NAME_LEN].to_string()
    } else {
        base
    }
}

/// Persist an identity reference image to app-support staging. Returns the
/// absolute path as a string so the frontend can hand it straight to
/// `thumbnail.saveIdentity([...])` which forwards to the Python sidecar.
#[tauri::command]
pub async fn stash_upload(name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("stash_upload: bytes is empty".to_string());
    }
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "stash_upload: {} bytes exceeds MAX_BYTES ({})",
            bytes.len(),
            MAX_BYTES
        ));
    }

    let dir = identity_staging_dir();
    fs::create_dir_all(&dir)
        .map_err(|e| format!("stash_upload: mkdir {} failed: {}", dir.display(), e))?;

    let safe = sanitize_name(&name);

    // Prefix with a monotonic timestamp so re-uploads of the same filename
    // don't overwrite an image the sidecar might still be reading. The
    // sanitized leaf remains the visible suffix.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let final_name = format!("{}-{}", ts, safe);
    let out = dir.join(&final_name);

    // Defence-in-depth: the joined path must live inside `dir`. Reject
    // anything that would escape (should be impossible after sanitize_name
    // but the check costs nothing).
    match (out.parent(), Some(dir.as_path())) {
        (Some(parent), Some(expected)) if parent == expected => {}
        _ => {
            return Err("stash_upload: refusing to write outside staging dir".to_string());
        }
    }

    fs::write(&out, &bytes)
        .map_err(|e| format!("stash_upload: write {} failed: {}", out.display(), e))?;

    println!(
        "[identity_stash] wrote {} bytes to {}",
        bytes.len(),
        out.display()
    );

    Ok(out.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::sanitize_name;

    #[test]
    fn strips_path_traversal() {
        assert_eq!(sanitize_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_name("/tmp/foo.png"), "foo.png");
        assert_eq!(sanitize_name("..\\..\\evil.png"), "evil.png");
    }

    #[test]
    fn strips_unusual_chars() {
        assert_eq!(sanitize_name("hello world.png"), "helloworld.png");
        assert_eq!(sanitize_name("weird$?<>|.png"), "weird.png");
    }

    #[test]
    fn fallback_when_empty() {
        assert_eq!(sanitize_name(""), "identity");
        assert_eq!(sanitize_name("$$$"), "identity");
    }

    #[test]
    fn drops_leading_dots() {
        assert_eq!(sanitize_name(".htaccess"), "htaccess");
        assert_eq!(sanitize_name("...secret"), "secret");
    }

    #[test]
    fn caps_length() {
        let long = "a".repeat(500);
        assert!(sanitize_name(&long).len() <= 120);
    }
}
