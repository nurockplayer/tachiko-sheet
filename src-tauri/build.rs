const COMMANDS: &[&str] = &["runtime_attach", "runtime_dispatch", "window_close_check"];
const E2E_COMMANDS: &[&str] = &[
    "runtime_attach",
    "runtime_dispatch",
    "window_close_check",
    "e2e_result",
    "e2e_request_close",
];

fn main() {
    // Only the host's private commands exist; capability files grant them to
    // the Sheet window. The e2e driver's command exists only in e2e builds.
    let commands = if std::env::var_os("CARGO_FEATURE_E2E").is_some() {
        E2E_COMMANDS
    } else {
        COMMANDS
    };
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to run the Tauri build script");
}
