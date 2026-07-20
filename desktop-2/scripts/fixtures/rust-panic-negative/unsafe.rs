// IG-RUST-PANIC negative fixture · MUST FAIL the scanner.
// This file is not compiled — it lives outside src-tauri/src on purpose.
// It exercises each forbidden pattern once so the fence proves it detects them.

pub fn setup_response() {
    let value: Option<u32> = None;
    let _ = value.unwrap();           // NEG-1 · bare unwrap → must be flagged
}

pub fn init_app() {
    let cfg: Result<u32, ()> = Err(());
    let _ = cfg.expect("missing config"); // NEG-2 · bare expect → must be flagged
}

pub fn panic_here() {
    panic!("boom");                    // NEG-3 · bare panic! → must be flagged
}

pub fn todo_here() {
    todo!();                            // NEG-4 · bare todo!() → must be flagged
}

pub fn unimpl_here() {
    unimplemented!();                   // NEG-5 · bare unimplemented!() → must be flagged
}
