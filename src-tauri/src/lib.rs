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
use tauri::{
    Manager, RunEvent, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub use runtime_channel::{ChannelError, RuntimeChannel};

const MAIN_WINDOW: &str = "main";

/// Asks the page whether it holds unsaved or in-flight work, using the
/// Sheet's own `beforeunload` guard, and reports the answer for one check.
fn close_check_script(check: u64) -> String {
    format!(
        "(() => {{ let unsaved = false; try {{ \
         const event = new Event('beforeunload', {{ cancelable: true }}); \
         window.dispatchEvent(event); unsaved = event.defaultPrevented; }} catch {{ unsaved = true; }} \
         window.__TAURI_INTERNALS__.invoke('window_close_check', {{ check: {check}, unsaved }}); }})();"
    )
}

/// Close bookkeeping for the single Sheet window.
#[derive(Default)]
struct CloseGuard {
    /// The person agreed to close, or there was nothing unsaved.
    confirmed: AtomicBool,
    /// The one close check awaiting the page's answer. Any other answer —
    /// late, repeated or from a check that was abandoned — is ignored.
    pending: Mutex<Option<u64>>,
    checks: AtomicU64,
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
fn window_close_check(
    window: WebviewWindow,
    guard: State<'_, CloseGuard>,
    check: u64,
    unsaved: bool,
) {
    {
        let mut pending = lock(&guard.pending);
        if *pending != Some(check) {
            return;
        }
        *pending = None;
    }
    if unsaved {
        confirm_discard_then_close(
            &window,
            "You have changes that are not saved, or a change still in progress. If you close Tachiko Sheet now, they will be lost.",
        );
    } else {
        close_confirmed(&window);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Closing is decided: stop the runtime from accepting further changes, then close.
fn close_confirmed(window: &WebviewWindow) {
    window.state::<RuntimeChannel>().seal();
    window
        .state::<CloseGuard>()
        .confirmed
        .store(true, Ordering::SeqCst);
    let _ = window.close();
}

fn ask_discard(description: &str) -> bool {
    #[cfg(feature = "e2e")]
    if let Some(answer) = e2e::close_answer() {
        e2e::log(&format!("close dialog: {description} -> {answer}"));
        return answer == "discard";
    }
    let choice = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("Close Tachiko Sheet?")
        .set_description(description)
        .set_buttons(MessageButtons::OkCancelCustom(
            "Discard and Close".to_owned(),
            "Cancel".to_owned(),
        ))
        .show();
    matches!(choice, MessageDialogResult::Custom(ref label) if label == "Discard and Close")
        || matches!(choice, MessageDialogResult::Ok)
}

fn confirm_discard_then_close(window: &WebviewWindow, description: &'static str) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if ask_discard(description) {
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
    let check = {
        let mut pending = lock(&guard.pending);
        if pending.take().is_some() {
            // The page did not answer the earlier check; abandon it (a late
            // answer is ignored) and let the person decide.
            drop(pending);
            confirm_discard_then_close(
                window,
                "Tachiko Sheet is not responding, so it cannot tell whether your work is saved. Unsaved changes will be lost.",
            );
            return;
        }
        let check = guard.checks.fetch_add(1, Ordering::SeqCst) + 1;
        *pending = Some(check);
        check
    };
    if window.eval(close_check_script(check)).is_err() {
        *lock(&guard.pending) = None;
        confirm_discard_then_close(
            window,
            "Tachiko Sheet cannot tell whether your work is saved. Unsaved changes will be lost.",
        );
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
    let suggested = destination.file_name().map_or_else(
        || "Tachiko Sheet export".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    let mut dialog = rfd::FileDialog::new().set_file_name(&suggested);
    if let Some(home) = std::env::var_os("HOME") {
        dialog = dialog.set_directory(PathBuf::from(home).join("Documents"));
    }
    dialog.save_file()
}

fn on_download(webview: &tauri::Webview, event: DownloadEvent<'_>) -> bool {
    let downloads = webview.state::<Downloads>();
    #[cfg(feature = "e2e")]
    match &event {
        DownloadEvent::Requested { url, destination } => {
            e2e::log(&format!("requested {url} -> {}", destination.display()))
        }
        DownloadEvent::Finished { url, success, .. } => {
            e2e::log(&format!("finished {url} {success}"))
        }
        _ => e2e::log("other download event"),
    }
    match event {
        DownloadEvent::Requested { url, destination } => {
            // Completion is matched by URL, so the same URL may not be in flight twice.
            if lock(&downloads.pending).contains_key(url.as_str()) {
                report_export_failure(
                    webview,
                    "This export is already being saved. Wait for it to finish, then export again if needed.",
                );
                return false;
            }
            let Some(target) = choose_download_destination(destination) else {
                return false;
            };
            let Some(name) = target.file_name() else {
                return false;
            };
            let serial = downloads.serial.fetch_add(1, Ordering::SeqCst);
            let temporary = target.with_file_name(format!(
                ".{}.tachiko-download-{}-{serial}",
                name.to_string_lossy(),
                std::process::id()
            ));
            lock(&downloads.pending).insert(url.to_string(), (temporary.clone(), target));
            *destination = temporary;
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            // macOS reports no final path; use the temporary file recorded above.
            let pending = lock(&downloads.pending).remove(url.as_str());
            if let Some((temporary, target)) = pending {
                let moved = success && std::fs::rename(&temporary, &target).is_ok();
                if !moved {
                    let _ = std::fs::remove_file(&temporary);
                    let name = target
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
                    report_export_failure(
                        webview,
                        &format!(
                            "“{name}” was not saved. Any file already there is unchanged. Your work is still open; export it again."
                        ),
                    );
                }
            }
            true
        }
        _ => true,
    }
}

/// Tell the person an export did not reach its file; the page cannot observe it.
fn report_export_failure(webview: &tauri::Webview, message: &str) {
    #[cfg(feature = "e2e")]
    if e2e::close_answer().is_some() {
        e2e::log(&format!("export failure: {message}"));
        return;
    }
    let message = message.to_owned();
    let _ = webview.run_on_main_thread(move || {
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("Export not saved")
            .set_description(message)
            .set_buttons(MessageButtons::Ok)
            .show();
    });
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RuntimeChannel::default())
        .manage(CloseGuard::default())
        .manage(Downloads::default());
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_attach,
        runtime_dispatch,
        window_close_check
    ]);
    #[cfg(feature = "e2e")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_attach,
        runtime_dispatch,
        window_close_check,
        e2e::e2e_result,
        e2e::e2e_request_close
    ]);
    builder
        .setup(|app| {
            let window =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Tachiko Sheet")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(880.0, 600.0)
                    .on_download(|webview, event| on_download(&webview, event))
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
            if let RunEvent::ExitRequested {
                api, code: None, ..
            } = event
                && let Some(window) = app.get_webview_window(MAIN_WINDOW)
                && !window
                    .state::<CloseGuard>()
                    .confirmed
                    .load(Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = window.close();
            }
        });
}
