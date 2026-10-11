//! Tachiko Sheet desktop host.
//!
//! Tauri owns only the OS lifecycle, the window and user-chosen file effects.
//! The Tachiko Work Rust runtime, reached through [`runtime_channel`], owns all
//! spreadsheet meaning, validation, revision and publication.

mod downloads;
#[cfg(feature = "e2e")]
mod e2e;
mod runtime_channel;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use downloads::{DownloadLedger, Reservation};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::webview::DownloadEvent;
use tauri::{
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub use runtime_channel::{ChannelError, RuntimeChannel};

const MAIN_WINDOW: &str = "main";
const QUIT_MENU_ITEM: &str = "tachiko-quit";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ---- runtime commands ---------------------------------------------------------

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

// ---- leaving the work: close, quit, reload ------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Leave {
    Close,
    Reload,
}

/// One decision at a time about leaving the current work.
#[derive(Default)]
struct LeaveGuard {
    /// Closing is decided; the window may close.
    closing: AtomicBool,
    /// The one check awaiting the page's answer. Any other answer — late,
    /// repeated or from an abandoned check — is ignored.
    pending: Mutex<Option<(u64, Leave)>>,
    checks: AtomicU64,
    /// The page's first load has happened; later loads are reloads.
    loaded: AtomicBool,
    /// A reload was decided; let exactly one through.
    reload_allowed: AtomicBool,
}

const UNSAVED: &str = "You have changes that are not saved, or a change still in progress. If you continue, they will be lost.";
const EXPORTING: &str =
    "An export is still being saved. If you continue, that file will not be saved.";
const NOT_RESPONDING: &str = "Tachiko Sheet is not responding, so it cannot tell whether your work is saved. Unsaved changes will be lost.";
const CANNOT_TELL: &str =
    "Tachiko Sheet cannot tell whether your work is saved. Unsaved changes will be lost.";

/// Asks the page whether it holds unsaved or in-flight work, using the
/// Sheet's own `beforeunload` guard, and reports the answer for one check.
fn leave_check_script(check: u64) -> String {
    format!(
        "(() => {{ let unsaved = false; try {{ \
         const event = new Event('beforeunload', {{ cancelable: true }}); \
         window.dispatchEvent(event); unsaved = event.defaultPrevented; }} catch {{ unsaved = true; }} \
         window.__TAURI_INTERNALS__.invoke('window_close_check', {{ check: {check}, unsaved }}); }})();"
    )
}

/// Start deciding whether to leave. New runtime operations are held until the
/// decision, so nothing can change the work after the page answers.
fn request_leave(window: &WebviewWindow, leave: Leave) {
    let guard = window.state::<LeaveGuard>();
    let channel = window.state::<RuntimeChannel>();
    let check = {
        let mut pending = lock(&guard.pending);
        if let Some((_, earlier)) = pending.take() {
            // The page did not answer the earlier check; abandon it (a late
            // answer is then ignored) and let the person decide.
            drop(pending);
            ask_then_leave(window, earlier, NOT_RESPONDING);
            return;
        }
        channel.hold();
        let check = guard.checks.fetch_add(1, Ordering::SeqCst) + 1;
        *pending = Some((check, leave));
        check
    };
    if window.eval(leave_check_script(check)).is_err() {
        *lock(&guard.pending) = None;
        ask_then_leave(window, leave, CANNOT_TELL);
    }
}

#[tauri::command]
fn window_close_check(
    window: WebviewWindow,
    guard: State<'_, LeaveGuard>,
    check: u64,
    unsaved: bool,
) {
    let leave = {
        let mut pending = lock(&guard.pending);
        match *pending {
            Some((current, leave)) if current == check => {
                *pending = None;
                leave
            }
            _ => return,
        }
    };
    let exporting = !lock(&window.state::<Downloads>().0).is_empty();
    if unsaved {
        ask_then_leave(&window, leave, UNSAVED);
    } else if exporting {
        ask_then_leave(&window, leave, EXPORTING);
    } else if window.state::<RuntimeChannel>().seal_if_idle() {
        proceed(&window, leave);
    } else {
        // An operation arrived after the page answered; that answer is stale.
        ask_then_leave(&window, leave, UNSAVED);
    }
}

fn ask_then_leave(window: &WebviewWindow, leave: Leave, reason: &'static str) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let channel = target.state::<RuntimeChannel>();
        if confirm_discard(leave, reason) {
            channel.seal();
            proceed(&target, leave);
        } else {
            channel.release();
        }
    });
}

fn confirm_discard(leave: Leave, reason: &str) -> bool {
    #[cfg(feature = "e2e")]
    if let Some(answer) = e2e::close_answer() {
        e2e::log(&format!("leave dialog ({leave:?}): {reason} -> {answer}"));
        return answer == "discard";
    }
    let (title, action) = match leave {
        Leave::Close => ("Close Tachiko Sheet?", "Discard and Close"),
        Leave::Reload => ("Reload Tachiko Sheet?", "Discard and Reload"),
    };
    let choice = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title(title)
        .set_description(reason)
        .set_buttons(MessageButtons::OkCancelCustom(
            action.to_owned(),
            "Cancel".to_owned(),
        ))
        .show();
    matches!(choice, MessageDialogResult::Custom(ref label) if label == action)
        || matches!(choice, MessageDialogResult::Ok)
}

/// Leaving is decided and the runtime is sealed.
fn proceed(window: &WebviewWindow, leave: Leave) {
    let guard = window.state::<LeaveGuard>();
    match leave {
        Leave::Close => {
            for temporary in lock(&window.state::<Downloads>().0).abandon_all() {
                let _ = std::fs::remove_file(temporary);
            }
            guard.closing.store(true, Ordering::SeqCst);
            let _ = window.close();
        }
        Leave::Reload => {
            guard.reload_allowed.store(true, Ordering::SeqCst);
            let _ = window.eval("location.reload()");
        }
    }
}

// ---- navigation ---------------------------------------------------------------

fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        // `tauri dev` serves the frontend from the Vite dev server.
        "http" => {
            cfg!(debug_assertions)
                && url.host_str() == Some("localhost")
                && url.port() == Some(5174)
        }
        _ => false,
    }
}

/// The Sheet document stays in place: a reload is decided like closing,
/// bundled notices open in their own window and web links open in the browser.
fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    let guard = app.state::<LeaveGuard>();
    let app_url = is_app_url(url);
    let index = app_url && matches!(url.path(), "" | "/" | "/index.html");
    if index && !guard.loaded.swap(true, Ordering::SeqCst) {
        return true;
    }
    if index && guard.reload_allowed.swap(false, Ordering::SeqCst) {
        return true;
    }
    #[cfg(feature = "e2e")]
    e2e::log(&format!("navigation held: {url}"));
    if index {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            request_leave(&window, Leave::Reload);
        }
    } else if app_url {
        open_bundled_page(app, url.path());
    } else if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .spawn();
    }
    false
}

/// Show a bundled read-only page (license notices) without replacing the Sheet.
fn open_bundled_page(app: &AppHandle, path: &str) {
    static PAGES: AtomicU64 = AtomicU64::new(0);
    let label = format!("page-{}", PAGES.fetch_add(1, Ordering::SeqCst));
    let app = app.clone();
    let path = PathBuf::from(path.trim_start_matches('/'));
    std::thread::spawn(move || {
        let title = path.file_name().map_or_else(
            || "Tachiko Sheet".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        let _ = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(path))
            .title(title)
            .inner_size(720.0, 640.0)
            .on_navigation(|_| false)
            .build();
    });
}

// ---- downloads ----------------------------------------------------------------

struct Downloads(Mutex<DownloadLedger>);

/// Ask where to save a file the Sheet offered for download. Nothing is written
/// unless the person picks a destination in the native Save panel.
fn choose_download_destination(suggested: &Path) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(path) = e2e::download_destination(suggested) {
        return Some(path);
    }
    let name = suggested.file_name().map_or_else(
        || "Tachiko Sheet export".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    );
    let mut dialog = rfd::FileDialog::new().set_file_name(&name);
    if let Some(home) = std::env::var_os("HOME") {
        dialog = dialog.set_directory(PathBuf::from(home).join("Documents"));
    }
    dialog.save_file()
}

fn on_download(webview: &tauri::Webview, event: DownloadEvent<'_>) -> bool {
    let downloads = webview.state::<Downloads>();
    match event {
        DownloadEvent::Requested { url, destination } => {
            #[cfg(feature = "e2e")]
            e2e::log(&format!("requested {url} -> {}", destination.display()));
            let Some(target) = choose_download_destination(destination) else {
                return false;
            };
            let reservation = lock(&downloads.0).reserve(url.as_str(), target, std::process::id());
            match reservation {
                Reservation::Write(temporary) => {
                    *destination = temporary;
                    true
                }
                Reservation::DuplicateDownload => {
                    report_export_failure(
                        webview,
                        "This export is already being saved. Wait for it to finish, then export again if needed.",
                    );
                    false
                }
                Reservation::DestinationBusy => {
                    report_export_failure(
                        webview,
                        "Another export to that file is still being saved. Wait for it to finish, then export again.",
                    );
                    false
                }
            }
        }
        DownloadEvent::Finished { url, success, .. } => {
            #[cfg(feature = "e2e")]
            e2e::log(&format!("finished {url} {success}"));
            // macOS reports no final path; use the temporary file recorded above.
            let reservation = lock(&downloads.0).finish(url.as_str());
            if let Some((temporary, target)) = reservation
                && !downloads::complete(&temporary, &target, success)
            {
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

// ---- menu ---------------------------------------------------------------------

/// The standard menu, with Quit routed through the unsaved-work check. The
/// stock Quit terminates the process without asking.
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        for (position, item) in app_submenu.items()?.into_iter().enumerate() {
            if let MenuItemKind::Predefined(predefined) = &item
                && predefined.text()?.starts_with("Quit")
            {
                app_submenu.remove(&item)?;
                let quit = MenuItem::with_id(
                    app,
                    QUIT_MENU_ITEM,
                    "Quit Tachiko Sheet",
                    true,
                    Some("CmdOrCtrl+Q"),
                )?;
                app_submenu.insert(&quit, position)?;
                break;
            }
        }
    }
    Ok(menu)
}

/// Quit asks like closing the window does; the app exits once it closes.
fn request_quit(app: &AppHandle) {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => request_leave(&window, Leave::Close),
        None => app.exit(0),
    }
}

/// The menu's Quit path, for the packaged e2e driver.
#[cfg(feature = "e2e")]
fn quit_like_menu(app: &AppHandle) {
    request_quit(app);
}

// ---- app ----------------------------------------------------------------------

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RuntimeChannel::default())
        .manage(LeaveGuard::default())
        .manage(Downloads(Mutex::new(DownloadLedger::default())))
        .menu(app_menu)
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ITEM {
                request_quit(app);
            }
        });
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
        e2e::e2e_request_close,
        e2e::e2e_request_quit
    ]);
    builder
        .setup(|app| {
            let handle = app.handle().clone();
            let window =
                WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
                    .title("Tachiko Sheet")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(880.0, 600.0)
                    .on_navigation(move |url| on_navigation(&handle, url))
                    .on_download(|webview, event| on_download(&webview, event))
                    .build()?;
            let guarded = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. }
                    if !guarded.state::<LeaveGuard>().closing.load(Ordering::SeqCst) =>
                {
                    api.prevent_close();
                    request_leave(&guarded, Leave::Close);
                }
                // The Sheet window is the app: closing it also closes any notices window.
                WindowEvent::Destroyed => guarded.app_handle().exit(0),
                _ => {}
            });
            #[cfg(feature = "e2e")]
            {
                app.add_capability(include_str!("../capabilities/e2e.json"))?;
                e2e::start(app.handle(), quit_like_menu);
            }
            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tachiko Sheet");
}
