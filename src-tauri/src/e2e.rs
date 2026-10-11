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

use std::path::{Path, PathBuf};
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

/// Where an e2e download is written, if the e2e download folder is configured.
/// `TACHIKO_SHEET_E2E_DOWNLOAD_DELAY_MS` holds the main thread first, like a
/// person taking time in the Save panel.
pub fn download_destination(suggested: &Path) -> Option<PathBuf> {
    let folder = PathBuf::from(std::env::var_os("TACHIKO_SHEET_E2E_DOWNLOADS")?);
    if let Some(delay) = std::env::var("TACHIKO_SHEET_E2E_DOWNLOAD_DELAY_MS")
        .ok()
        .and_then(|value| value.parse().ok())
    {
        std::thread::sleep(Duration::from_millis(delay));
    }
    Some(folder.join(suggested.file_name()?))
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

static QUIT: std::sync::OnceLock<fn(&AppHandle)> = std::sync::OnceLock::new();

/// Request quitting exactly as the menu's Quit (⌘Q) does.
#[tauri::command]
pub fn e2e_request_quit(app: AppHandle) {
    if let Some(quit) = QUIT.get() {
        quit(&app);
    }
}

/// Start polling the script folder for the main window.
pub fn start(app: &AppHandle, quit: fn(&AppHandle)) {
    let _ = QUIT.set(quit);
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
                let Some(id) = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(str::to_owned)
                else {
                    continue;
                };
                let Ok(body) = std::fs::read_to_string(&path) else {
                    continue;
                };
                if std::fs::rename(&path, path.with_extension("sent")).is_err() || !valid_id(&id) {
                    continue;
                }
                let Some(window) = app.get_webview_window("main") else {
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
