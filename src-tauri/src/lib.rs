//! Tachiko Sheet desktop host.
//!
//! Tauri owns only the OS lifecycle, the window and user-chosen file effects.
//! The Tachiko Work Rust runtime, reached through [`runtime_channel`], owns all
//! spreadsheet meaning, validation, revision and publication.

#[cfg(feature = "e2e")]
mod e2e;
mod runtime_channel;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::webview::DownloadEvent;
use tauri::{Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub use runtime_channel::{ChannelError, RuntimeChannel};

const MAIN_WINDOW: &str = "main";

/// Asks the page whether it holds unsaved work, using the Sheet's own
/// `beforeunload` guard, and reports the answer to the host.
const CLOSE_CHECK_SCRIPT: &str = "(() => { let unsaved = false; try { \
    const event = new Event('beforeunload', { cancelable: true }); \
    window.dispatchEvent(event); unsaved = event.defaultPrevented; } catch { unsaved = true; } \
    window.__TAURI_INTERNALS__.invoke('window_close_check', { unsaved }); })();";

/// Close bookkeeping for the single Sheet window.
#[derive(Default)]
struct CloseGuard {
    /// The person agreed to close, or there was nothing unsaved.
    confirmed: AtomicBool,
    /// A check was sent to the page and has not been answered yet.
    pending: AtomicBool,
}

#[tauri::command]
async fn runtime_attach(channel: State<'_, RuntimeChannel>) -> Result<u64, String> {
    Ok(channel.attach())
}

#[tauri::command]
async fn runtime_dispatch(
    channel: State<'_, RuntimeChannel>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("the runtime channel accepts only binary frames".to_owned());
    };
    channel
        .dispatch(frame)
        .map(tauri::ipc::Response::new)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close_check(window: WebviewWindow, guard: State<'_, CloseGuard>, unsaved: bool) {
    guard.pending.store(false, Ordering::SeqCst);
    if unsaved {
        confirm_discard_then_close(&window, "You have changes that are not saved. If you close Tachiko Sheet now, they will be lost.");
    } else {
        close_confirmed(&window);
    }
}

fn close_confirmed(window: &WebviewWindow) {
    window.state::<CloseGuard>().confirmed.store(true, Ordering::SeqCst);
    let _ = window.close();
}

fn confirm_discard_then_close(window: &WebviewWindow, description: &'static str) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let choice = MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("Close Tachiko Sheet?")
            .set_description(description)
            .set_buttons(MessageButtons::OkCancelCustom("Discard and Close".to_owned(), "Cancel".to_owned()))
            .show();
        if matches!(choice, MessageDialogResult::Custom(ref label) if label == "Discard and Close")
            || matches!(choice, MessageDialogResult::Ok)
        {
            close_confirmed(&target);
        }
    });
}

fn on_close_requested(window: &WebviewWindow, api: &tauri::CloseRequestApi) {
    let guard = window.state::<CloseGuard>();
    if guard.confirmed.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_close();
    if guard.pending.swap(true, Ordering::SeqCst) {
        // The page did not answer the first check; let the person decide.
        guard.pending.store(false, Ordering::SeqCst);
        confirm_discard_then_close(window, "Tachiko Sheet is not responding, so it cannot tell whether your work is saved. Unsaved changes will be lost.");
        return;
    }
    if window.eval(CLOSE_CHECK_SCRIPT).is_err() {
        guard.pending.store(false, Ordering::SeqCst);
        confirm_discard_then_close(window, "Tachiko Sheet cannot tell whether your work is saved. Unsaved changes will be lost.");
    }
}

/// Downloads in flight: each is written to a hidden temporary file beside the
/// chosen destination and moved into place only when it completed, so a failed
/// export never leaves a partial file or replaces an existing one.
#[derive(Default)]
struct Downloads {
    /// Blob URL → (temporary file being written, chosen destination).
    pending: Mutex<HashMap<String, (PathBuf, PathBuf)>>,
    serial: AtomicU64,
}

/// Ask where to save a file the Sheet offered for download. Nothing is written
/// unless the person picks a destination in the native Save panel.
fn choose_download_destination(destination: &Path) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(path) = e2e::download_destination(destination) {
        return Some(path);
    }
    let suggested = destination
        .file_name()
        .map_or_else(|| "Tachiko Sheet export".to_owned(), |name| name.to_string_lossy().into_owned());
    let mut dialog = rfd::FileDialog::new().set_file_name(&suggested);
    if let Some(home) = std::env::var_os("HOME") {
        dialog = dialog.set_directory(PathBuf::from(home).join("Documents"));
    }
    dialog.save_file()
}

fn on_download(downloads: &Downloads, event: DownloadEvent<'_>) -> bool {
    #[cfg(feature = "e2e")]
    match &event {
        DownloadEvent::Requested { url, destination } => e2e::log(&format!("requested {url} -> {}", destination.display())),
        DownloadEvent::Finished { url, path, success } => e2e::log(&format!("finished {url} {path:?} {success}")),
        _ => e2e::log("other download event"),
    }
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Some(target) = choose_download_destination(destination) else { return false };
            let Some(name) = target.file_name() else { return false };
            let serial = downloads.serial.fetch_add(1, Ordering::SeqCst);
            let temporary = target.with_file_name(format!(
                ".{}.tachiko-download-{}-{serial}",
                name.to_string_lossy(),
                std::process::id()
            ));
            downloads.pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(url.to_string(), (temporary.clone(), target));
            *destination = temporary;
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            // macOS reports no final path; use the temporary file recorded above.
            let pending = downloads.pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(url.as_str());
            if let Some((temporary, target)) = pending {
                if !success || std::fs::rename(&temporary, &target).is_err() {
                    let _ = std::fs::remove_file(&temporary);
                }
            }
            true
        }
        _ => true,
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RuntimeChannel::default())
        .manage(CloseGuard::default())
        .manage(Downloads::default());
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![runtime_attach, runtime_dispatch, window_close_check]);
    #[cfg(feature = "e2e")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_attach,
        runtime_dispatch,
        window_close_check,
        e2e::e2e_result
    ]);
    builder
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                .title("Tachiko Sheet")
                .inner_size(1280.0, 820.0)
                .min_inner_size(880.0, 600.0)
                .on_download(|webview, event| on_download(&webview.state::<Downloads>(), event))
                .build()?;
            let guarded = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    on_close_requested(&guarded, api);
                }
            });
            #[cfg(feature = "e2e")]
            {
                app.add_capability(include_str!("../capabilities/e2e.json"))?;
                e2e::start(app.handle());
            }
            window.set_focus()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tachiko Sheet")
        .run(|app, event| {
            // Quit (Cmd+Q) goes through the same unsaved-work check as closing.
            if let RunEvent::ExitRequested { api, code: None, .. } = event
                && let Some(window) = app.get_webview_window(MAIN_WINDOW)
                && !window.state::<CloseGuard>().confirmed.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = window.close();
            }
        });
}
