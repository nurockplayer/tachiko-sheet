//! Tachiko Sheet desktop host.
//!
//! Tauri owns only the OS lifecycle, the window and user-chosen file effects.
//! The Tachiko Work Rust runtime, reached through [`runtime_channel`], owns all
//! spreadsheet meaning, validation, revision and publication.
//!
//! Every host dialog is a sheet on the Sheet window with a completion
//! handler: none runs a nested modal event loop inside a WebKit or Tauri
//! callback.

#[cfg(feature = "e2e")]
mod e2e;
mod runtime_channel;
mod saves;
#[cfg(target_os = "macos")]
mod termination;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use rfd::{AsyncFileDialog, AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use saves::{Claim, Published, Saves, WriteError};
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
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

/// Attach a page's runtime channel; see [`RuntimeChannel::attach_for`].
#[tauri::command]
async fn runtime_attach(
    runtime: State<'_, RuntimeChannel>,
    saves: State<'_, Saves>,
    page: u64,
    channel: u64,
) -> Result<u64, String> {
    runtime
        .attach_for(page, channel, saves.page())
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn runtime_dispatch(
    channel: State<'_, RuntimeChannel>,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(frame) = request.body() else {
        return Err("the runtime channel accepts only binary frames".to_owned());
    };
    #[cfg(feature = "e2e")]
    let started = std::time::Instant::now();
    let reply = channel.dispatch(frame);
    #[cfg(feature = "e2e")]
    e2e::log(&format!(
        "dispatch {} B -> {} in {} ms",
        frame.len(),
        reply
            .as_ref()
            .map_or_else(ToString::to_string, |reply| format!("{} B", reply.len())),
        started.elapsed().as_millis()
    ));
    reply
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
    /// Leaving is decided and under way; nothing can undo it for this page.
    Leaving,
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
const NOT_RESPONDING: &str = "Tachiko Sheet is not responding, so it cannot tell whether your work is saved. Unsaved changes will be lost.";
const CANNOT_TELL: &str =
    "Tachiko Sheet cannot tell whether your work is saved. Unsaved changes will be lost.";

/// Freezes the page (no input can change it after this point) and asks
/// whether it holds unsaved or in-flight work, using the Sheet's own
/// `beforeunload` guard; reports the answer for one check.
fn leave_check_script(check: u64) -> String {
    format!(
        "(() => {{ let unsaved = false; try {{ \
         window.__tachikoLeaveFocus = document.activeElement; document.body.inert = true; \
         const event = new Event('beforeunload', {{ cancelable: true }}); \
         window.dispatchEvent(event); unsaved = event.defaultPrevented; }} catch {{ unsaved = true; }} \
         window.__TAURI_INTERNALS__.invoke('window_close_check', {{ check: {check}, unsaved }}); }})();"
    )
}

/// The person kept the work open: make the page usable again where it was.
const UNFREEZE_SCRIPT: &str = "(() => { document.body.inert = false; \
    const focus = window.__tachikoLeaveFocus; window.__tachikoLeaveFocus = null; \
    if (focus && focus.isConnected && typeof focus.focus === 'function') focus.focus(); })();";

/// Start deciding whether to leave. New runtime operations are held until the
/// decision, so nothing can change the work after the page answers.
fn request_leave(window: &WebviewWindow, leave: Leave) {
    #[cfg(feature = "e2e")]
    e2e::log(&format!(
        "leave requested ({leave:?}): {:?}",
        lock(&window.state::<LeaveGuard>().deciding)
    ));
    let guard = window.state::<LeaveGuard>();
    let check = {
        let mut deciding = lock(&guard.deciding);
        match *deciding {
            // A confirmation is already showing; it decides.
            Deciding::Asking | Deciding::Leaving => return,
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
        window.state::<Saves>().hold();
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
    let reason = if unsaved {
        Some(UNSAVED)
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
            *deciding = Deciding::Leaving;
            drop(deciding);
            proceed(&window, leave);
        }
    }
}

fn ask_then_leave(window: &WebviewWindow, leave: Leave, reason: &'static str) {
    let target = window.clone();
    tauri::async_runtime::spawn(async move {
        let discard = confirm_discard(&target, leave, reason).await;
        let channel = target.state::<RuntimeChannel>();
        let guard = target.state::<LeaveGuard>();
        let mut deciding = lock(&guard.deciding);
        // Only the open confirmation decides; a committed leave stays committed.
        if *deciding != Deciding::Asking {
            return;
        }
        if discard {
            *deciding = Deciding::Leaving;
            drop(deciding);
            channel.seal();
            proceed(&target, leave);
        } else {
            *deciding = Deciding::Idle;
            drop(deciding);
            channel.release();
            target.state::<Saves>().release();
            let _ = target.eval(UNFREEZE_SCRIPT);
        }
    });
}

async fn confirm_discard(window: &WebviewWindow, leave: Leave, reason: &str) -> bool {
    #[cfg(feature = "e2e")]
    if let Some(answer) = e2e::close_answer() {
        e2e::log(&format!("leave dialog ({leave:?}): {reason} -> {answer}"));
        if let Some(delay) = e2e::answer_delay() {
            tokio_sleep(delay).await;
        }
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

/// Leaving is decided and the runtime is sealed. No further save starts; a
/// save already being written finishes first, without blocking this thread.
fn proceed(window: &WebviewWindow, leave: Leave) {
    window.state::<Saves>().seal();
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        window.state::<Saves>().writes_finished().await;
        let guard = window.state::<LeaveGuard>();
        match leave {
            Leave::Close => {
                guard.closing.store(true, Ordering::SeqCst);
                let _ = window.close();
            }
            Leave::Reload => {
                guard.reload_allowed.store(true, Ordering::SeqCst);
                let _ = window.eval("location.reload()");
            }
        }
    });
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
#[cfg(target_os = "macos")]
fn quit_decided(app: &AppHandle) -> bool {
    app.state::<LeaveGuard>().closing.load(Ordering::SeqCst)
        || app.get_webview_window(MAIN_WINDOW).is_none()
}

// ---- navigation ---------------------------------------------------------------

fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        // Windows serves the bundled frontend from this origin; `tauri dev`
        // serves it from the Vite dev server.
        "http" => {
            (cfg!(windows) && url.host_str() == Some("tauri.localhost"))
                || (cfg!(debug_assertions)
                    && url.host_str() == Some("localhost")
                    && url.port() == Some(5174))
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
    if index
        && (!guard.loaded.swap(true, Ordering::SeqCst)
            || guard.reload_allowed.swap(false, Ordering::SeqCst))
    {
        // A page the host allowed: it starts with saving and the runtime open.
        *lock(&guard.deciding) = Deciding::Idle;
        app.state::<Saves>().new_page();
        app.state::<RuntimeChannel>().new_page();
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
        open_externally(url);
    }
    false
}

/// Hand a web or mail link to the OS's default app.
fn open_externally(url: &Url) {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    // An AppImage's bundled libraries must not reach the browser it starts.
    #[cfg(target_os = "linux")]
    command.env_remove("LD_LIBRARY_PATH");
    #[cfg(windows)]
    let mut command = std::process::Command::new("rundll32");
    #[cfg(windows)]
    command.arg("url.dll,FileProtocolHandler");
    let _ = command.arg(url.as_str()).spawn();
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

// ---- saving exports -----------------------------------------------------------

/// Largest export the page may hand over.
const MAX_SAVE_BYTES: usize = 256 * 1024 * 1024;

/// A starting page learns its identity; it fences its saves and runtime
/// attaches from those of earlier pages.
#[tauri::command]
async fn page_identity(saves: State<'_, Saves>) -> Result<u64, String> {
    Ok(saves.page())
}

/// Ask where to save one export and write it there. "saved" or "cancelled";
/// an error means nothing was saved.
#[tauri::command]
async fn save_export(
    app: AppHandle,
    saves: State<'_, Saves>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    // Every save has an id: a transport retry of it gets the original receipt.
    let Some(id) = request
        .headers()
        .get(SAVE_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .map(str::to_owned)
    else {
        return Err("The export could not be read. Nothing was saved.".to_owned());
    };
    match saves.claim(&id).await {
        Claim::Receipt(outcome) => return outcome,
        Claim::Run => {}
    }
    let outcome = match request.body() {
        tauri::ipc::InvokeBody::Raw(frame) => save_frame(&app, &saves, frame).await,
        // Not a frame this page sent: the save's real outcome is unknown here.
        tauri::ipc::InvokeBody::Json(_) => Err(
            "The export may not have been saved. Check the destination before relying on it."
                .to_owned(),
        ),
    };
    saves.receipt(&id, outcome.clone());
    outcome
}

const SAVE_ID_HEADER: &str = "tachiko-save-id";

async fn save_frame(app: &AppHandle, saves: &Saves, frame: &[u8]) -> Result<String, String> {
    let Some((epoch, name, bytes)) = parse_save_frame(frame) else {
        return Err("The export could not be read. Nothing was saved.".to_owned());
    };
    #[cfg(feature = "e2e")]
    e2e::log(&format!("save requested {name}"));
    // One Save sheet at a time; the leave decision never waits on this.
    let _turn = saves.turn.lock().await;
    let Some(destination) = choose_destination(app, &name).await else {
        return Ok("cancelled".to_owned());
    };
    let published = saves.publish(epoch, bytes.to_vec(), destination).await;
    #[cfg(feature = "e2e")]
    e2e::log(&format!("saved {name}: {published:?}"));
    match published {
        Ok(Published::Saved) => Ok("saved".to_owned()),
        Ok(Published::Cancelled) => Ok("cancelled".to_owned()),
        Err(WriteError::Exists) => Err(format!(
            "“{name}” already exists. Exports are saved as new files and never replace one; choose another name."
        )),
        Err(WriteError::NotSaved(error)) => Err(format!(
            "“{name}” was not saved ({error}). Nothing at the destination changed."
        )),
        Err(WriteError::Unconfirmed(error)) => Err(format!(
            "“{name}” was written, but Tachiko Sheet could not confirm it ({error}). Check the file before relying on it."
        )),
    }
}

/// `[u64 epoch][u32 name length][name][bytes]`, little-endian. Only the
/// name's final path component is used.
fn parse_save_frame(frame: &[u8]) -> Option<(u64, String, &[u8])> {
    let epoch = u64::from_le_bytes(frame.get(..8)?.try_into().ok()?);
    let length = u32::from_le_bytes(frame.get(8..12)?.try_into().ok()?) as usize;
    if length == 0 || length > 1024 {
        return None;
    }
    let name = std::str::from_utf8(frame.get(12..12 + length)?).ok()?;
    let name = Path::new(name).file_name()?.to_string_lossy().into_owned();
    let bytes = frame.get(12 + length..)?;
    (bytes.len() <= MAX_SAVE_BYTES).then_some((epoch, name, bytes))
}

/// Exports are saved by `save_export`; WebKit downloads are refused.
fn on_download(event: &DownloadEvent<'_>) -> bool {
    #[cfg(feature = "e2e")]
    if let DownloadEvent::Requested { url, .. } = event {
        e2e::log(&format!("download refused {url}"));
    }
    let _ = event;
    false
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

// ---- menu ---------------------------------------------------------------------

/// A menu command the page carries out, as its own buttons and keys do.
struct PageCommand {
    id: &'static str,
    label: &'static str,
    accelerator: &'static str,
}

const NEW_TABLE: PageCommand = PageCommand {
    id: "new-table",
    label: "New Table…",
    accelerator: "CmdOrCtrl+N",
};
const SAVE: PageCommand = PageCommand {
    id: "save",
    label: "Save",
    accelerator: "CmdOrCtrl+S",
};
const SAVE_COPY: PageCommand = PageCommand {
    id: "save-copy",
    label: "Save a Copy…",
    accelerator: "CmdOrCtrl+Shift+S",
};
const PRINT: PageCommand = PageCommand {
    id: "print",
    label: "Print…",
    accelerator: "CmdOrCtrl+P",
};
const UNDO: PageCommand = PageCommand {
    id: "undo",
    label: "Undo",
    accelerator: "CmdOrCtrl+Z",
};
const REDO: PageCommand = PageCommand {
    id: "redo",
    label: "Redo",
    accelerator: if cfg!(target_os = "macos") {
        "Cmd+Shift+Z"
    } else {
        "Ctrl+Y"
    },
};
const FILE_COMMANDS: [&PageCommand; 4] = [&NEW_TABLE, &SAVE, &SAVE_COPY, &PRINT];
const PAGE_COMMANDS: [&PageCommand; 6] = [&NEW_TABLE, &SAVE, &SAVE_COPY, &PRINT, &UNDO, &REDO];

fn page_item(app: &AppHandle, command: &PageCommand) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(
        app,
        command.id,
        command.label,
        true,
        Some(command.accelerator),
    )
}

/// Tell the page which menu command was chosen. Ids come only from `PAGE_COMMANDS`.
fn run_page_command(app: &AppHandle, id: &str) {
    if PAGE_COMMANDS.iter().any(|command| command.id == id)
        && let Some(window) = app.get_webview_window(MAIN_WINDOW)
    {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('tachiko-menu', {{ detail: '{id}' }}));"
        ));
    }
}

/// The standard menu, with Quit routed through the unsaved-work check. The
/// stock Quit terminates the process without asking. File gains the page's
/// commands. Edit's Undo and Redo reach the page's history: the stock ones only
/// know the webview's text fields.
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    // Tauri's default menu has no File submenu on Linux, and so no Quit either.
    #[cfg(target_os = "linux")]
    {
        let quit = MenuItem::with_id(
            app,
            QUIT_MENU_ITEM,
            "Quit Tachiko Sheet",
            true,
            Some("CmdOrCtrl+Q"),
        )?;
        menu.insert(
            &tauri::menu::Submenu::with_items(app, "File", true, &[&quit])?,
            0,
        )?;
    }
    for top in menu.items()? {
        let MenuItemKind::Submenu(submenu) = top else {
            continue;
        };
        match submenu.text()?.as_str() {
            "File" => {
                for (position, command) in FILE_COMMANDS.into_iter().enumerate() {
                    submenu.insert(&page_item(app, command)?, position)?;
                }
                submenu.insert(&PredefinedMenuItem::separator(app)?, FILE_COMMANDS.len())?;
            }
            "Edit" => {
                for (position, item) in submenu.items()?.into_iter().enumerate() {
                    let MenuItemKind::Predefined(predefined) = &item else {
                        continue;
                    };
                    let text = predefined.text()?.replace('&', "");
                    let command = if text.starts_with("Undo") {
                        &UNDO
                    } else if text.starts_with("Redo") {
                        &REDO
                    } else {
                        continue;
                    };
                    submenu.remove(&item)?;
                    submenu.insert(&page_item(app, command)?, position)?;
                }
            }
            _ => {}
        }
    }
    if let Some(MenuItemKind::Submenu(app_submenu)) = menu.items()?.into_iter().next() {
        for (position, item) in app_submenu.items()?.into_iter().enumerate() {
            if let MenuItemKind::Predefined(predefined) = &item
                // Windows and Linux labels carry a mnemonic marker, as in `&Quit`.
                && predefined.text()?.replace('&', "").starts_with("Quit")
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

/// Run a command the menu really has, as choosing it does.
#[cfg(feature = "e2e")]
fn menu_command_hook(app: &AppHandle, id: &str) -> bool {
    let present = app.menu().is_some_and(|menu| {
        menu.items().is_ok_and(|items| {
            items.iter().any(|top| match top {
                MenuItemKind::Submenu(submenu) => submenu
                    .items()
                    .is_ok_and(|items| items.iter().any(|item| item.id().as_ref() == id)),
                _ => false,
            })
        })
    });
    if present {
        run_page_command(app, id);
    }
    present
}

// ---- app ----------------------------------------------------------------------

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(RuntimeChannel::default())
        .manage(LeaveGuard::default())
        .manage(Saves::default())
        .menu(app_menu)
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ITEM {
                request_quit(app);
            } else {
                run_page_command(app, event.id().as_ref());
            }
        });
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_attach,
        runtime_dispatch,
        window_close_check,
        page_identity,
        save_export
    ]);
    #[cfg(feature = "e2e")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_attach,
        runtime_dispatch,
        window_close_check,
        page_identity,
        save_export,
        e2e::e2e_result,
        e2e::e2e_request_close,
        e2e::e2e_request_quit,
        e2e::e2e_menu_command,
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
                    .on_download(|_webview, event| on_download(&event));
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
                // Keep the test window visible: an occluded WebKit view pauses
                // animation frames, which the grid's row window waits on.
                window.set_always_on_top(true)?;
                if let Some((width, height)) = e2e::window_size() {
                    window.set_size(tauri::LogicalSize::new(width, height))?;
                }
                app.add_capability(include_str!("../capabilities/e2e.json"))?;
                e2e::start(
                    app.handle(),
                    e2e::Hooks {
                        menu_command: menu_command_hook,
                        quit: request_quit,
                        // Only macOS routes `NSApplication terminate:`; elsewhere
                        // the OS's quit already goes through the same leave guard.
                        #[cfg(target_os = "macos")]
                        terminate: termination::terminate_like_the_os,
                        #[cfg(not(target_os = "macos"))]
                        terminate: request_quit,
                    },
                );
            }
            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tachiko Sheet");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_app(url: &str) -> bool {
        is_app_url(&Url::parse(url).unwrap())
    }

    #[test]
    fn only_the_bundled_origin_is_the_app() {
        assert!(is_app("tauri://localhost/"));
        assert_eq!(is_app("http://tauri.localhost/"), cfg!(windows));
        assert!(!is_app("http://tauri.localhost.example.com/"));
        assert!(!is_app("https://tauri.localhost/"));
        assert!(!is_app("https://example.com/"));
    }
}
