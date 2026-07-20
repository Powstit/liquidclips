// IG-RUST-PANIC positive fixture · MUST PASS the scanner.
// Exercises the safe patterns + the sentinel escape hatch.

pub fn safe_result() -> Result<u32, String> {
    let value: Option<u32> = None;
    let out = value.ok_or_else(|| "missing".to_string())?;
    Ok(out)
}

pub fn safe_result_2() -> Result<u32, String> {
    let cfg: Result<u32, ()> = Err(());
    let out = cfg.map_err(|_| "config load failed".to_string())?;
    Ok(out)
}

pub fn safe_unwrap_or() -> u32 {
    let value: Option<u32> = None;
    value.unwrap_or(0)                // safe · unwrap_or is not bare unwrap
}

pub fn safe_unwrap_or_default() -> u32 {
    let value: Option<u32> = None;
    value.unwrap_or_default()          // safe · unwrap_or_default is not bare unwrap
}

pub fn safe_unwrap_or_else() -> u32 {
    let value: Option<u32> = None;
    value.unwrap_or_else(|| 0)         // safe · unwrap_or_else is not bare unwrap
}

pub fn sentinel_covers_setup() {
    let cfg: Option<u32> = None;
    // SETUP-OK: init path · panic here means Tauri cannot start · no JS layer exists
    let _ = cfg.unwrap();
}

pub fn sentinel_same_line() {
    let cfg: Option<u32> = None;
    let _ = cfg.unwrap(); // UNWRAP-OK: same-line sentinel also valid
}

#[cfg(test)]
mod tests {
    // Bodies inside #[cfg(test)] mod { ... } are excluded — test-only.
    #[test]
    fn any_panic_here_is_fine() {
        let value: Option<u32> = None;
        let _ = value.unwrap();
        let cfg: Result<u32, ()> = Err(());
        let _ = cfg.expect("test-only");
    }
}

#[test]
fn top_level_test_fn_is_also_excluded() {
    let value: Option<u32> = None;
    let _ = value.unwrap();
}
