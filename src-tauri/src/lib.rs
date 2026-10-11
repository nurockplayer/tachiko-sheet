//! Tachiko Sheet desktop host.
//!
//! Tauri owns only the OS lifecycle, the window and user-chosen file effects.
//! The Tachiko Work Rust runtime, reached through [`runtime_channel`], owns all
//! spreadsheet meaning, validation, revision and publication.
//!
//! Every host dialog is a sheet on the Sheet window with a completion
//! handler: none runs a nested modal event loop inside a WebKit or Tauri
//! callback.

mod downloads;
#[cfg(feature = "e2e")]
mod e2e;
mod runtime_channel;
#[cfg(target_os = "macos")]
mod termination;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use downloads::ExportLedger;
use rfd::{AsyncFileDialog, AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
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

// ---- leaving the work: close, quit, terminate, reload ---------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Leave {
    Close,
    Reload,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Deciding {
    Idle,
    /// Waiting for the page's answer to this check.
    Checking(u64, Leave),
    /// The person is answering a confirmation sheet.
    Asking,
}

/// One decision at a time about leaving the current work.
struct LeaveGuard {
    deciding: Mutex<Deciding>,
    checks: AtomicU64,
    /// Closing is decided; the window may close and the app may terminate.
    closing: AtomicBool,
    /// The page's first load has happened; later loads are reloads.
    loaded: AtomicBool,
    /// A reload was decided; let exactly one through.
    reload_allowed: AtomicBool,
}

impl Default for LeaveGuard {
    fn default() -> Self {
        Self {
            deciding: Mutex::new(Deciding::Idle),
            checks: AtomicU64::new(0),
            closing: AtomicBool::new(false),
            loaded: AtomicBool::new(false),
            reload_allowed: AtomicBool::new(false),
        }
    }
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
    let check = {
        let mut deciding = lock(&guard.deciding);
        match *deciding {
            // A confirmation is already showing; it decides.
            Deciding::Asking => return,
            Deciding::Checking(_, earlier) => {
                // The page did not answer the earlier check; abandon it (a late
                // answer is then ignored) and let the person decide.
                *deciding = Deciding::Asking;
                drop(deciding);
                ask_then_leave(window, earlier, NOT_RESPONDING);
                return;
            }
            Deciding::Idle => {}
        }
        window.state::<RuntimeChannel>().hold();
        let check = guard.checks.fetch_add(1, Ordering::SeqCst) + 1;
        *deciding = Deciding::Checking(check, leave);
        check
    };
    if window.eval(leave_check_script(check)).is_err() {
        *lock(&guard.deciding) = Deciding::Asking;
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
    let mut deciding = lock(&guard.deciding);
    let Deciding::Checking(current, leave) = *deciding else {
        return;
    };
    if current != check {
        return;
    }
    let exporting = !lock(&window.state::<Exports>().ledger).is_empty();
    let reason = if unsaved {
        Some(UNSAVED)
    } else if exporting {
        Some(EXPORTING)
    } else if window.state::<RuntimeChannel>().seal_if_idle() {
        None
    } else {
        // An operation arrived after the page answered; that answer is stale.
        Some(UNSAVED)
    };
    match reason {
        Some(reason) => {
            *deciding = Deciding::Asking;
            drop(deciding);
            ask_then_leave(&window, leave, reason);
        }
        None => {
            *deciding = Deciding::Idle;
            drop(deciding);
            proceed(&window, leave);
        }
    }
}

fn ask_then_leave(window: &WebviewWindow, leave: Leave, reason: &'static str) {
    let target = window.clone();
    tauri::async_runtime::spawn(async move {
        let discard = confirm_discard(&target, leave, reason).await;
        *lock(&target.state::<LeaveGuard>().deciding) = Deciding::Idle;
        let channel = target.state::<RuntimeChannel>();
        if discard {
            channel.seal();
            proceed(&target, leave);
        } else {
            channel.release();
        }
    });
}

async fn confirm_discard(window: &WebviewWindow, leave: Leave, reason: &str) -> bool {
    #[cfg(feature = "e2e")]
    if let Some(answer) = e2e::close_answer() {
        e2e::log(&format!("leave dialog ({leave:?}): {reason} -> {answer}"));
        return answer == "discard";
    }
    let (title, action) = match leave {
        Leave::Close => ("Close Tachiko Sheet?", "Discard and Close"),
        Leave::Reload => ("Reload Tachiko Sheet?", "Discard and Reload"),
    };
    let choice = AsyncMessageDialog::new()
        .set_parent(window)
        .set_level(MessageLevel::Warning)
        .set_title(title)
        .set_description(reason)
        .set_buttons(MessageButtons::OkCancelCustom(
            action.to_owned(),
            "Cancel".to_owned(),
        ))
        .show()
        .await;
    matches!(choice, MessageDialogResult::Custom(ref label) if label == action)
        || matches!(choice, MessageDialogResult::Ok)
}

/// Leaving is decided and the runtime is sealed.
fn proceed(window: &WebviewWindow, leave: Leave) {
    let guard = window.state::<LeaveGuard>();
    match leave {
        Leave::Close => {
            for staged in lock(&window.state::<Exports>().ledger).abandon_staged() {
                let _ = std::fs::remove_file(staged);
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

/// Quit (menu ⌘Q, Dock, logout) asks like closing the window; the app exits
/// once the Sheet window has closed.
fn request_quit(app: &AppHandle) {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => request_leave(&window, Leave::Close),
        None => app.exit(0),
    }
}

/// Whether the app may terminate now without asking.
fn quit_decided(app: &AppHandle) -> bool {
    app.state::<LeaveGuard>().closing.load(Ordering::SeqCst)
        || app.get_webview_window(MAIN_WINDOW).is_none()
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
    // `tauri://localhost` has an empty path.
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
        open_bundled_page(app, url);
    } else if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .spawn();
    }
    false
}

/// Show a bundled read-only page (license notices) without replacing the Sheet.
fn open_bundled_page(app: &AppHandle, url: &Url) {
    static PAGES: AtomicU64 = AtomicU64::new(0);
    let label = format!("page-{}", PAGES.fetch_add(1, Ordering::SeqCst));
    let app = app.clone();
    let page = url.clone();
    let path = PathBuf::from(url.path().trim_start_matches('/'));
    std::thread::spawn(move || {
        let title = path.file_name().map_or_else(
            || "Tachiko Sheet".to_owned(),
            |name| name.to_string_lossy().into_owned(),
        );
        let loaded = AtomicBool::new(false);
        let _ = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(path))
            .title(title)
            .inner_size(720.0, 640.0)
            // Only the page itself loads; it cannot navigate anywhere else.
            .on_navigation(move |target| {
                target.path() == page.path() && !loaded.swap(true, Ordering::SeqCst)
            })
            .build();
    });
}

// ---- downloads ----------------------------------------------------------------

struct Exports {
    ledger: Mutex<ExportLedger>,
    /// One Save panel at a time, so exports are placed in the order chosen.
    placing: tauri::async_runtime::Mutex<()>,
}

fn staging_folder(app: &AppHandle) -> Option<PathBuf> {
    let folder = app.path().app_cache_dir().ok()?.join("exports");
    std::fs::create_dir_all(&folder).ok()?;
    Some(folder)
}

/// WebKit download callbacks only record and redirect the download; no
/// panel opens inside them.
fn on_download(webview: &tauri::Webview, event: DownloadEvent<'_>) -> bool {
    let app = webview.app_handle();
    let exports = webview.state::<Exports>();
    match event {
        DownloadEvent::Requested { url, destination } => {
            #[cfg(feature = "e2e")]
            e2e::log(&format!("requested {url}"));
            let name = destination.file_name().map_or_else(
                || "Tachiko Sheet export".to_owned(),
                |name| name.to_string_lossy().into_owned(),
            );
            let Some(folder) = staging_folder(app) else {
                report_export_failure(
                    app,
                    "Tachiko Sheet could not prepare the export. Nothing was saved.".to_owned(),
                );
                return false;
            };
            let Some(staged) = lock(&exports.ledger).stage(url.as_str(), &folder, &name) else {
                return false;
            };
            *destination = staged;
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            #[cfg(feature = "e2e")]
            e2e::log(&format!("finished {url} {success}"));
            let Some(staged) = lock(&exports.ledger).take(url.as_str()) else {
                return true;
            };
            if success {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { place_export(app, staged).await });
            } else {
                let _ = std::fs::remove_file(&staged);
                lock(&exports.ledger).placed();
                report_export_failure(
                    app,
                    "The export could not be written. Nothing was saved; export it again."
                        .to_owned(),
                );
            }
            true
        }
        _ => true,
    }
}

/// Ask where to save a completed export, then move it into place.
async fn place_export(app: AppHandle, staged: PathBuf) {
    let exports = app.state::<Exports>();
    let _turn = exports.placing.lock().await;
    let name = downloads::suggested_name(&staged);
    let destination = choose_destination(&app, &name).await;
    let outcome = match &destination {
        Some(destination) => {
            downloads::place(&staged, destination, std::process::id()).map(|()| true)
        }
        None => {
            let _ = std::fs::remove_file(&staged);
            Ok(false)
        }
    };
    lock(&exports.ledger).placed();
    #[cfg(feature = "e2e")]
    e2e::log(&format!("placed {name}: {outcome:?}"));
    if outcome.is_err() {
        report_export_failure(
            &app,
            format!(
                "“{name}” was not saved. Any file already there is unchanged. Your work is still open; export it again."
            ),
        );
    }
}

/// Nothing is written unless the person picks a destination in the Save panel.
async fn choose_destination(app: &AppHandle, name: &str) -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    if let Some(folder) = e2e::download_folder() {
        if let Some(delay) = e2e::download_delay() {
            tokio_sleep(delay).await;
        }
        return Some(folder.join(name));
    }
    let mut dialog = AsyncFileDialog::new().set_file_name(name);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        dialog = dialog.set_parent(&window);
    }
    if let Some(home) = std::env::var_os("HOME") {
        dialog = dialog.set_directory(PathBuf::from(home).join("Documents"));
    }
    dialog
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf())
}

#[cfg(feature = "e2e")]
async fn tokio_sleep(duration: std::time::Duration) {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        std::thread::sleep(duration);
        let _ = sender.send(());
    });
    let _ = tauri::async_runtime::spawn_blocking(move || receiver.recv()).await;
}

/// Tell the person an export did not reach its file; the page cannot observe it.
fn report_export_failure(app: &AppHandle, message: String) {
    #[cfg(feature = "e2e")]
    if e2e::close_answer().is_some() {
        e2e::log(&format!("export failure: {message}"));
        return;
    }
    let window = app.get_webview_window(MAIN_WINDOW);
    tauri::async_runtime::spawn(async move {
        let mut dialog = AsyncMessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title("Export not saved")
            .set_description(message)
            .set_buttons(MessageButtons::Ok);
        if let Some(window) = &window {
            dialog = dialog.set_parent(window);
        }
        dialog.show().await;
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

// ---- app ----------------------------------------------------------------------

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RuntimeChannel::default())
        .manage(LeaveGuard::default())
        .manage(Exports {
            ledger: Mutex::new(ExportLedger::default()),
            placing: tauri::async_runtime::Mutex::new(()),
        })
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
        e2e::e2e_request_quit,
        e2e::e2e_request_terminate
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
                    .on_download(|webview, event| on_download(&webview, event));
            // The packaged e2e run must not stall when its window is covered.
            #[cfg(feature = "e2e")]
            let window = window
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
            let window = window.build()?;
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
            #[cfg(target_os = "macos")]
            termination::install(app.handle(), quit_decided, request_quit);
            #[cfg(feature = "e2e")]
            {
                app.add_capability(include_str!("../capabilities/e2e.json"))?;
                e2e::start(
                    app.handle(),
                    e2e::Hooks {
                        quit: request_quit,
                        terminate: termination::terminate_like_the_os,
                    },
                );
            }
            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tachiko Sheet");
}
