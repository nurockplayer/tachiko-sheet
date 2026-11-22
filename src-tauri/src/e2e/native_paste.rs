//! Activate the installed native Paste item, never manufacture keyboard input.
//! This module is included only by the `e2e` feature.

#[cfg(target_os = "macos")]
pub fn activate(_: &tauri::AppHandle) -> Result<(), String> {
    use objc2::{class, msg_send, sel};
    use objc2::runtime::{AnyObject, Sel};

    unsafe fn choose(menu: *mut AnyObject) -> bool {
        if menu.is_null() { return false; }
        let count: isize = unsafe { msg_send![menu, numberOfItems] };
        for index in 0..count {
            let item: *mut AnyObject = unsafe { msg_send![menu, itemAtIndex: index] };
            let action: Option<Sel> = unsafe { msg_send![item, action] };
            if action == Some(sel!(paste:)) {
                // NSMenu sends the item's action through the responder chain,
                // exactly as selecting Edit > Paste does. No CGEvent/AX access.
                let _: () = unsafe { msg_send![menu, performActionForItemAtIndex: index] };
                return true;
            }
            let submenu: *mut AnyObject = unsafe { msg_send![item, submenu] };
            if unsafe { choose(submenu) } { return true; }
        }
        false
    }
    let found = unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let menu: *mut AnyObject = msg_send![app, mainMenu];
        choose(menu)
    };
    if found { Ok(()) } else { Err("native Paste menu item missing".into()) }
}

#[cfg(target_os = "windows")]
pub fn activate(app: &tauri::AppHandle) -> Result<(), String> {
    use std::ffi::c_void;
    use tauri::Manager;
    type Handle = *mut c_void;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetMenu(window: Handle) -> Handle;
        fn GetMenuItemCount(menu: Handle) -> i32;
        fn GetSubMenu(menu: Handle, position: i32) -> Handle;
        fn GetMenuStringW(menu: Handle, item: u32, text: *mut u16, capacity: i32, flags: u32) -> i32;
        fn GetMenuItemID(menu: Handle, position: i32) -> u32;
        fn SendMessageW(window: Handle, message: u32, wparam: usize, lparam: isize) -> isize;
    }
    unsafe fn choose(menu: Handle, window: Handle) -> bool {
        for index in 0..unsafe { GetMenuItemCount(menu) } {
            let mut text = [0u16; 256];
            let size = unsafe { GetMenuStringW(menu, index as u32, text.as_mut_ptr(), 256, 0x400) };
            let label = String::from_utf16_lossy(&text[..size as usize]).replace('&', "");
            if label.split('\t').next() == Some("Paste") {
                let id = unsafe { GetMenuItemID(menu, index) };
                // Dispatch the actual installed item's command. Muda owns its
                // normal Paste implementation, including its internal SendInput.
                unsafe { SendMessageW(window, 0x111, id as usize, 0); }
                return true;
            }
            let submenu = unsafe { GetSubMenu(menu, index) };
            if !submenu.is_null() && unsafe { choose(submenu, window) } { return true; }
        }
        false
    }
    let window = app.get_webview_window("main").ok_or("main window missing")?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as Handle;
    if unsafe { choose(GetMenu(hwnd), hwnd) } { Ok(()) }
    else { Err("native Paste menu item missing".into()) }
}

#[cfg(target_os = "linux")]
pub fn activate(app: &tauri::AppHandle) -> Result<(), String> {
    use std::cell::Cell;
    use std::rc::Rc;
    use gtk::prelude::*;
    use tauri::Manager;

    fn choose(container: &gtk::Container) -> Option<gtk::MenuItem> {
        for child in container.children() {
            let Ok(item) = child.downcast::<gtk::MenuItem>() else { continue };
            if item.label().is_some_and(|label| label.replace('_', "") == "Paste") {
                return Some(item);
            }
            let submenu = item.submenu().and_then(|menu| menu.downcast::<gtk::Container>().ok());
            if let Some(found) = submenu.and_then(|menu| choose(&menu)) { return Some(found); }
        }
        None
    }
    let window = app.get_webview_window("main").ok_or("main window missing")?;
    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    let vbox = window.default_vbox().map_err(|error| error.to_string())?;
    // The Paste item a person sees in the window's GTK menu bar.
    let item = vbox.children().into_iter()
        .filter_map(|child| child.downcast::<gtk::MenuBar>().ok())
        .find_map(|bar| choose(bar.upcast_ref()))
        .ok_or("native Paste menu item missing")?;
    let activated = Rc::new(Cell::new(false));
    let seen = activated.clone();
    let handler = item.connect_activate(move |_| seen.set(true));
    // Press Ctrl+V through the window's accelerator groups, as GTK does for a
    // real key press before the webview sees it. GTK emits the item's
    // `activate`, muda turns it into the menu event, and the app's menu
    // handler pastes. No synthetic key event or libxdo.
    let handled = gtk::accel_groups_activate(&gtk_window, *gtk::gdk::keys::constants::v, gtk::gdk::ModifierType::CONTROL_MASK);
    item.disconnect(handler);
    if !handled { return Err("Ctrl+V is not a window accelerator".into()); }
    if !activated.get() { return Err("Ctrl+V did not activate the Paste menu item".into()); }
    Ok(())
}
