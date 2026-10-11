//! Packaged end-to-end test driver, compiled only with the `e2e` feature.
//!
//! The shipped app does not contain this module. An e2e build is the same
//! frontend, native runtime and host with this file-based script channel added,
//! under a separate bundle identity so it never shares the person's data.
//!
//! When `TACHIKO_SHEET_E2E_DIR` is set, each `<id>.js` file written there is
//! evaluated once in the Sheet window as an async function body; its JSON
//! result is written to `<id>.result.json`. When `TACHIKO_SHEET_E2E_DOWNLOADS`
//! is set, downloads are saved there instead of asking with a Save panel, and
//! `TACHIKO_SHEET_E2E_CLOSE_ANSWER` answers the unsaved-work dialog.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

const SCRIPT_POLL: Duration = Duration::from_millis(40);

fn script_dir() -> Option<PathBuf> {
    std::env::var_os("TACHIKO_SHEET_E2E_DIR").map(PathBuf::from)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Where e2e exports are placed instead of asking with a Save panel.
pub fn download_folder() -> Option<PathBuf> {
    std::env::var_os("TACHIKO_SHEET_E2E_DOWNLOADS").map(PathBuf::from)
}

/// How long the "person" takes in the Save panel (`TACHIKO_SHEET_E2E_DOWNLOAD_DELAY_MS`).
pub fn download_delay() -> Option<Duration> {
    std::env::var("TACHIKO_SHEET_E2E_DOWNLOAD_DELAY_MS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map(Duration::from_millis)
}

/// The scripted answer to the unsaved-work dialog (`discard` or `cancel`), so
/// the real close decision can be tested without clicking a native dialog.
pub fn close_answer() -> Option<String> {
    std::env::var("TACHIKO_SHEET_E2E_CLOSE_ANSWER").ok()
}

/// Request closing the window exactly as the close button or ⌘W does.
#[tauri::command]
pub fn e2e_request_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

/// Host entry points the driver exercises exactly as the OS would.
pub struct Hooks {
    /// The menu's Quit (⌘Q).
    pub quit: fn(&AppHandle),
    /// `NSApp terminate:` — Dock Quit, logout.
    pub terminate: fn(&AppHandle),
}

static HOOKS: std::sync::OnceLock<Hooks> = std::sync::OnceLock::new();

/// Request quitting exactly as the menu's Quit (⌘Q) does.
#[tauri::command]
pub fn e2e_request_quit(app: AppHandle) {
    if let Some(hooks) = HOOKS.get() {
        (hooks.quit)(&app);
    }
}

/// Request application termination exactly as the Dock's Quit or logout does.
#[tauri::command]
pub fn e2e_request_terminate(app: AppHandle) {
    if let Some(hooks) = HOOKS.get() {
        let terminate = hooks.terminate;
        let target = app.clone();
        let _ = app.run_on_main_thread(move || terminate(&target));
    }
}

/// Start polling the script folder for the main window.
pub fn start(app: &AppHandle, hooks: Hooks) {
    let _ = HOOKS.set(hooks);
    let Some(dir) = script_dir() else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(SCRIPT_POLL);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            let mut scripts: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.extension().is_some_and(|extension| extension == "js"))
                .collect();
            scripts.sort();
            for path in scripts {
                // `<id>.js` runs in the Sheet window; `<id>@<label>.js` in that window.
                let Some(stem) = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_owned)
                else {
                    continue;
                };
                let (id, label) = stem.split_once('@').map_or_else(
                    || (stem.clone(), "main".to_owned()),
                    |(id, label)| (id.to_owned(), label.to_owned()),
                );
                let Ok(body) = std::fs::read_to_string(&path) else {
                    continue;
                };
                if std::fs::rename(&path, path.with_extension("sent")).is_err()
                    || !valid_id(&id)
                    || !valid_id(&label)
                {
                    continue;
                }
                let Some(window) = app.get_webview_window(&label) else {
                    log(&format!("no window {label} for script {id}"));
                    continue;
                };
                let script = format!(
                    "(async () => {{ let r; try {{ r = {{ ok: true, value: await (async () => {{\n{body}\n}})() }}; }} \
                     catch (e) {{ r = {{ ok: false, error: String(e) + '\\n' + String((e && e.stack) || '') }}; }} \
                     window.__TAURI_INTERNALS__.invoke('e2e_result', {{ id: {id:?}, result: JSON.stringify(r) }}); }})();"
                );
                let _ = window.eval(&script);
            }
        }
    });
}

#[tauri::command]
pub fn e2e_result(id: String, result: String) -> Result<(), String> {
    let dir = script_dir().ok_or("e2e is not configured")?;
    if !valid_id(&id) {
        return Err("invalid e2e id".to_owned());
    }
    let partial = dir.join(format!("{id}.result.partial"));
    std::fs::write(&partial, result).map_err(|error| error.to_string())?;
    std::fs::rename(partial, dir.join(format!("{id}.result.json")))
        .map_err(|error| error.to_string())
}

/// Append one diagnostic line to `host.log` in the e2e script folder.
pub fn log(line: &str) {
    use std::io::Write;
    let Some(dir) = script_dir() else { return };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("host.log"))
    {
        let _ = writeln!(file, "{line}");
    }
}
