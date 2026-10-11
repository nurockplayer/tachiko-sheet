//! Route macOS application termination through the unsaved-work check.
//!
//! The Dock's Quit, logout and shutdown send `-[NSApplication terminate:]`.
//! The pinned tao app delegate does not implement
//! `applicationShouldTerminate:`, so AppKit would terminate at once and
//! unsaved work would be lost. This adds that one delegate method: it cancels
//! termination and asks through the same leave decision as closing; once the
//! Sheet window has closed, termination is allowed.

#![allow(unsafe_code)]

use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{MainThreadMarker, ffi, sel};
use objc2_app_kit::NSApplication;
use tauri::AppHandle;

/// `NSApplicationTerminateReply`.
const TERMINATE_CANCEL: usize = 0;
const TERMINATE_NOW: usize = 1;

struct Routes {
    app: AppHandle,
    decided: fn(&AppHandle) -> bool,
    ask: fn(&AppHandle),
}

static ROUTES: OnceLock<Routes> = OnceLock::new();

extern "C-unwind" fn application_should_terminate(
    _this: *mut AnyObject,
    _command: Sel,
    _sender: *mut AnyObject,
) -> usize {
    let Some(routes) = ROUTES.get() else {
        return TERMINATE_NOW;
    };
    // Never unwind into AppKit: on a panic, keep the app (and the work) open.
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if (routes.decided)(&routes.app) {
            TERMINATE_NOW
        } else {
            (routes.ask)(&routes.app);
            TERMINATE_CANCEL
        }
    }))
    .unwrap_or(TERMINATE_CANCEL)
}

/// Install the delegate method. Must run on the main thread after launch.
pub fn install(app: &AppHandle, decided: fn(&AppHandle) -> bool, ask: fn(&AppHandle)) {
    let _ = ROUTES.set(Routes {
        app: app.clone(),
        decided,
        ask,
    });
    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };
    let application = NSApplication::sharedApplication(main_thread);
    let Some(delegate) = application.delegate() else {
        return;
    };
    let object: &AnyObject = (*delegate).as_ref();
    let class: &AnyClass = object.class();
    let method: extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize =
        application_should_terminate;
    // SAFETY: the delegate class is tao's Objective-C class; we add (never
    // replace) one method whose Rust signature matches the type encoding
    // "Q@:@" (NSUInteger return; self, _cmd, sender), as AppKit calls it.
    let added = unsafe {
        let imp: Imp = std::mem::transmute(method);
        ffi::class_addMethod(
            std::ptr::from_ref(class).cast_mut(),
            sel!(applicationShouldTerminate:),
            imp,
            c"Q@:@".as_ptr(),
        )
    };
    debug_assert!(
        added.as_bool(),
        "the tao delegate already answered applicationShouldTerminate:"
    );
}

/// Send `terminate:` exactly as the Dock's Quit does (e2e driver only).
#[cfg(feature = "e2e")]
pub fn terminate_like_the_os(_app: &AppHandle) {
    if let Some(main_thread) = MainThreadMarker::new() {
        NSApplication::sharedApplication(main_thread).terminate(None);
    }
}
