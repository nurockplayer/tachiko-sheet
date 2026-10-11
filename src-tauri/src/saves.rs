//! Saving exports to files the person chooses.
//!
//! The page hands the host the bytes of an export; the host asks for a
//! destination with a Save sheet and writes the file. WebKit downloads are not
//! used, so one owner sees an export from request to file.
//!
//! - The page orders its saves; the host serves one Save sheet at a time.
//! - Each page attaches and receives an epoch; a save from an earlier page
//!   (before a reload or a decided close) is refused.
//! - Publishing (final check plus write and rename) and the leave decision use
//!   one lock: a file is either saved before leaving was decided, or not at all.
//! - While leaving is being decided, publishing waits; Cancel lets it continue.
//! - The file is written to an exclusively created temporary file beside the
//!   destination and renamed into place, so a failed save never leaves a
//!   partial file or replaces an existing one, and no symlink is followed.

use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Open,
    /// Leaving is being decided; publishing waits.
    Held,
    /// Leaving is decided; nothing more is published.
    Sealed,
}

#[derive(Debug)]
struct State {
    epoch: u64,
    phase: Phase,
}

/// What became of one save.
#[derive(Debug, PartialEq, Eq)]
pub enum Published {
    Saved,
    /// Leaving was decided first, or the save belongs to an earlier page.
    Cancelled,
}

pub struct Saves {
    state: Mutex<State>,
    changed: tokio::sync::Notify,
    /// One Save sheet at a time, across pages.
    pub turn: tokio::sync::Mutex<()>,
}

impl Default for Saves {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                epoch: 0,
                phase: Phase::Open,
            }),
            changed: tokio::sync::Notify::new(),
            turn: tokio::sync::Mutex::new(()),
        }
    }
}

impl Saves {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn set(&self, change: impl FnOnce(&mut State)) {
        change(&mut self.lock());
        self.changed.notify_waiters();
    }

    /// A page starts: earlier pages' saves are refused from now on.
    pub fn attach(&self) -> u64 {
        let mut epoch = 0;
        self.set(|state| {
            state.epoch += 1;
            state.phase = Phase::Open;
            epoch = state.epoch;
        });
        epoch
    }

    pub fn hold(&self) {
        self.set(|state| {
            if state.phase == Phase::Open {
                state.phase = Phase::Held;
            }
        });
    }

    pub fn release(&self) {
        self.set(|state| {
            if state.phase == Phase::Held {
                state.phase = Phase::Open;
            }
        });
    }

    /// Leaving is decided. Waits for a publish in progress to finish.
    pub fn seal(&self) {
        self.set(|state| state.phase = Phase::Sealed);
    }

    /// Publish `bytes` at `destination` for the page of `epoch`, unless leaving
    /// was decided or the page is gone. Waits while leaving is being decided.
    pub async fn publish(
        &self,
        epoch: u64,
        bytes: &[u8],
        destination: &Path,
    ) -> io::Result<Published> {
        loop {
            let changed = self.changed.notified();
            {
                let state = self.lock();
                if state.epoch != epoch || state.phase == Phase::Sealed {
                    return Ok(Published::Cancelled);
                }
                if state.phase == Phase::Open {
                    // Writing under the lock: sealing waits for it to finish.
                    write_replacing(bytes, destination)?;
                    return Ok(Published::Saved);
                }
            }
            changed.await;
        }
    }
}

/// Write `bytes` to a new, exclusively created file beside `destination`, then
/// rename it into place. On failure the destination is unchanged and the
/// temporary file, if this call created it, is removed.
pub fn write_replacing(bytes: &[u8], destination: &Path) -> io::Result<()> {
    static UNIQUE: AtomicU64 = AtomicU64::new(0);
    let name = destination.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
    })?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let temporary: PathBuf = destination.with_file_name(format!(
        ".{}.tachiko-save-{}-{nanos}-{}",
        name.to_string_lossy(),
        std::process::id(),
        UNIQUE.fetch_add(1, Ordering::SeqCst)
    ));
    // `create_new` refuses an existing file or symlink: on that error there is
    // nothing of ours to remove.
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let written = output
        .write_all(bytes)
        .and_then(|()| output.sync_all())
        .and_then(|()| std::fs::rename(&temporary, destination));
    if written.is_err() {
        drop(output);
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tachiko-saves-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_all(path: &Path) -> Vec<u8> {
        let mut bytes = Vec::new();
        io::Read::read_to_end(&mut std::fs::File::open(path).unwrap(), &mut bytes).unwrap();
        bytes
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn writes_replace_atomically_or_leave_the_destination_unchanged() {
        let dir = scratch("write");
        let destination = dir.join("Export.csv");
        std::fs::write(&destination, "old").unwrap();
        write_replacing(b"new", &destination).unwrap();
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");

        // A destination that cannot be replaced (here: a directory) is left as it was.
        let blocked = dir.join("Folder.csv");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("inside"), "kept").unwrap();
        assert!(write_replacing(b"new", &blocked).is_err());
        assert_eq!(
            std::fs::read_to_string(blocked.join("inside")).unwrap(),
            "kept"
        );
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with('.'))
            .count();
        assert_eq!(leftovers, 0, "no temporary file remains");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_symlinked_destination_is_replaced_without_touching_its_target() {
        let dir = scratch("symlink");
        let target = dir.join("elsewhere.txt");
        std::fs::write(&target, "precious").unwrap();
        let destination = dir.join("Export.csv");
        std::os::unix::fs::symlink(&target, &destination).unwrap();
        write_replacing(b"new", &destination).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "precious");
        assert!(
            !std::fs::symlink_metadata(&destination)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(read_all(&destination), b"new");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn leaving_and_reloading_fence_publication() {
        let dir = scratch("fence");
        let destination = dir.join("Export.csv");
        let saves = Saves::default();
        let first = saves.attach();
        assert_eq!(
            block_on(saves.publish(first, b"a", &destination)).unwrap(),
            Published::Saved
        );

        // A reload: the earlier page's late save is refused.
        let second = saves.attach();
        assert_eq!(
            block_on(saves.publish(first, b"stale", &destination)).unwrap(),
            Published::Cancelled
        );
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "a");

        // Leaving decided: nothing more is published.
        saves.seal();
        assert_eq!(
            block_on(saves.publish(second, b"late", &destination)).unwrap(),
            Published::Cancelled
        );
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "a");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn publishing_waits_while_leaving_is_decided() {
        use std::sync::Arc;
        let dir = scratch("held");
        let destination = dir.join("Export.csv");
        let saves = Arc::new(Saves::default());
        let epoch = saves.attach();
        saves.hold();
        let waiting = {
            let saves = Arc::clone(&saves);
            let destination = destination.clone();
            std::thread::spawn(move || {
                block_on(saves.publish(epoch, b"kept", &destination)).unwrap()
            })
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            !destination.exists(),
            "nothing is written while leaving is decided"
        );
        saves.release();
        assert_eq!(waiting.join().unwrap(), Published::Saved);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "kept");

        saves.hold();
        let refused = {
            let saves = Arc::clone(&saves);
            let destination = destination.clone();
            std::thread::spawn(move || {
                block_on(saves.publish(epoch, b"lost", &destination)).unwrap()
            })
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        saves.seal();
        assert_eq!(refused.join().unwrap(), Published::Cancelled);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "kept");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
