//! Saving exports to files the person chooses.
//!
//! The page hands the host the bytes of an export; the host asks for a
//! destination with a Save sheet and writes the file. WebKit downloads are not
//! used, so one owner sees an export from request to file.
//!
//! - The page orders its saves; the host serves one Save sheet at a time.
//! - Each page load the host allows starts a new epoch; a page learns its
//!   epoch when it starts, and a save from an earlier page is refused.
//! - Only the leave decision and an allowed page load change the phase:
//!   while leaving is being decided, no write starts; once decided, none will.
//!   A write already started is completed, and leaving waits for it without
//!   blocking the main thread.
//! - The file is written to an exclusively created temporary file beside the
//!   destination and renamed into place, so a failed save never leaves a
//!   partial file or replaces an existing one, and no symlink is followed.
//!   Replacing a file keeps its permission bits, ACL and extended attributes,
//!   and its new contents are never readable by others while being written.

use std::fs::{File, OpenOptions, Permissions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Open,
    /// Leaving is being decided; no write starts.
    Held,
    /// Leaving is decided; no write will start.
    Sealed,
}

#[derive(Debug)]
struct State {
    epoch: u64,
    phase: Phase,
    /// Writes started and not yet finished.
    writing: usize,
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
                writing: 0,
            }),
            changed: tokio::sync::Notify::new(),
            turn: tokio::sync::Mutex::new(()),
        }
    }
}

impl Saves {
    /// The lock is only ever held briefly: never across file I/O.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn set(&self, change: impl FnOnce(&mut State)) {
        change(&mut self.lock());
        self.changed.notify_waiters();
    }

    /// The host allowed a new page to load (first load or a decided reload):
    /// earlier pages' saves are refused from now on, and saving is open.
    pub fn new_page(&self) {
        self.set(|state| {
            state.epoch += 1;
            state.phase = Phase::Open;
        });
    }

    /// A starting page learns its epoch. This never changes the phase.
    pub fn attach(&self) -> u64 {
        self.lock().epoch
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

    /// Leaving is decided: no further write starts.
    pub fn seal(&self) {
        self.set(|state| state.phase = Phase::Sealed);
    }

    /// Resolves once no write is in progress.
    pub async fn writes_finished(&self) {
        loop {
            let changed = self.changed.notified();
            if self.lock().writing == 0 {
                return;
            }
            changed.await;
        }
    }

    /// Write `bytes` to `destination` for the page of `epoch`, unless leaving
    /// was decided or the page is gone. Waits while leaving is being decided.
    pub async fn publish(
        &self,
        epoch: u64,
        bytes: Vec<u8>,
        destination: PathBuf,
    ) -> Result<Published, WriteError> {
        loop {
            let changed = self.changed.notified();
            {
                let mut state = self.lock();
                if state.epoch != epoch || state.phase == Phase::Sealed {
                    return Ok(Published::Cancelled);
                }
                if state.phase == Phase::Open {
                    state.writing += 1;
                    break;
                }
            }
            changed.await;
        }
        let written =
            tauri::async_runtime::spawn_blocking(move || write_replacing(&bytes, &destination))
                .await
                .unwrap_or_else(|_| {
                    Err(WriteError::Unconfirmed(io::Error::other(
                        "the save stopped unexpectedly",
                    )))
                });
        self.set(|state| state.writing -= 1);
        written.map(|()| Published::Saved)
    }
}

/// Why a save did not complete as expected.
#[derive(Debug)]
pub enum WriteError {
    /// Nothing was published: any file already at the destination is unchanged.
    NotSaved(io::Error),
    /// The new file was put in place, but it could not be confirmed (another
    /// program changed it, or the directory could not be flushed).
    Unconfirmed(io::Error),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSaved(error) | Self::Unconfirmed(error) => error.fmt(formatter),
        }
    }
}

fn identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

/// Write `bytes` to a new, exclusively created file beside `destination`, then
/// rename it into place.
///
/// - The temporary file has a short name, is created exclusively (an existing
///   file or symlink is never opened) and is only removed if it is still ours.
/// - Replacing a file keeps its permission bits, ACL and extended attributes,
///   copied descriptor to descriptor; if they cannot be read, the file is not
///   replaced. The new contents stay private (0600) until then.
/// - Before and after the rename, the name must still refer to the file that
///   was written; afterwards the directory is flushed.
pub fn write_replacing(bytes: &[u8], destination: &Path) -> Result<(), WriteError> {
    static UNIQUE: AtomicU64 = AtomicU64::new(0);
    let not_saved = WriteError::NotSaved;
    let directory = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            not_saved(io::Error::new(
                io::ErrorKind::InvalidInput,
                "destination has no folder",
            ))
        })?;
    if destination.file_name().is_none() {
        return Err(not_saved(io::Error::new(
            io::ErrorKind::InvalidInput,
            "destination has no file name",
        )));
    }
    // The file being replaced, opened without following a symlink.
    let replaced = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(destination)
    {
        Ok(file) if file.metadata().map_err(not_saved)?.is_file() => Some(file),
        Ok(_) => None,
        Err(error)
            if error.kind() == io::ErrorKind::NotFound
                || error.raw_os_error() == Some(libc::ELOOP) =>
        {
            None
        }
        Err(error) => return Err(not_saved(error)),
    };
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    let temporary = directory.join(format!(
        ".tachiko-save-{}-{nanos}-{}.tmp",
        std::process::id(),
        UNIQUE.fetch_add(1, Ordering::SeqCst)
    ));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(if replaced.is_some() { 0o600 } else { 0o666 })
        .open(&temporary)
        .map_err(not_saved)?;
    let ours = output.metadata().map_err(not_saved)?;
    let still_ours = |path: &Path| {
        std::fs::symlink_metadata(path).is_ok_and(|named| identity(&named) == identity(&ours))
    };
    let prepared = (|| {
        output.write_all(bytes)?;
        if let Some(replaced) = &replaced {
            // SAFETY: both descriptors are open for the duration of the call;
            // a null state is allowed by copyfile(3).
            let copied = unsafe {
                libc::fcopyfile(
                    replaced.as_raw_fd(),
                    output.as_raw_fd(),
                    std::ptr::null_mut(),
                    libc::COPYFILE_ACL | libc::COPYFILE_XATTR,
                )
            };
            if copied != 0 {
                return Err(io::Error::last_os_error());
            }
            let mode = replaced.metadata()?.permissions().mode() & 0o7777;
            output.set_permissions(Permissions::from_mode(mode))?;
        }
        output.sync_all()?;
        if still_ours(&temporary) {
            Ok(())
        } else {
            Err(io::Error::other(
                "the temporary file was replaced by another program",
            ))
        }
    })();
    if let Err(error) = prepared.and_then(|()| std::fs::rename(&temporary, destination)) {
        if still_ours(&temporary) {
            let _ = std::fs::remove_file(&temporary);
        }
        return Err(not_saved(error));
    }
    let unconfirmed = WriteError::Unconfirmed;
    if !still_ours(destination) {
        return Err(unconfirmed(io::Error::other(
            "another program changed the file while it was being saved",
        )));
    }
    let folder = File::open(directory).map_err(unconfirmed)?;
    // F_FULLFSYNC where the volume supports it on a directory, else fsync.
    if folder.sync_all().is_err() && unsafe { libc::fsync(folder.as_raw_fd()) } != 0 {
        return Err(unconfirmed(io::Error::last_os_error()));
    }
    Ok(())
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

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn publish(saves: &Saves, epoch: u64, bytes: &[u8], destination: &Path) -> Published {
        block_on(saves.publish(epoch, bytes.to_vec(), destination.to_path_buf())).unwrap()
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
    fn a_replaced_private_file_stays_private() {
        let dir = scratch("private");
        let destination = dir.join("Private.csv");
        std::fs::write(&destination, "old").unwrap();
        std::fs::set_permissions(&destination, Permissions::from_mode(0o600)).unwrap();
        write_replacing(b"new", &destination).unwrap();
        let mode = std::fs::metadata(&destination)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_replaced_file_keeps_its_acl() {
        let dir = scratch("acl");
        let destination = dir.join("Shared.csv");
        std::fs::write(&destination, "old").unwrap();
        let added = std::process::Command::new("/bin/chmod")
            .args(["+a", "everyone deny write"])
            .arg(&destination)
            .status()
            .unwrap();
        assert!(added.success());
        write_replacing(b"new", &destination).unwrap();
        let listing = std::process::Command::new("/bin/ls")
            .arg("-le")
            .arg(&destination)
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&listing.stdout).contains("everyone deny write"));
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_long_valid_name_can_be_saved() {
        let dir = scratch("long");
        let destination = dir.join(format!("{}.csv", "n".repeat(240)));
        write_replacing(b"new", &destination).unwrap();
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
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
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_an_allowed_page_load_reopens_saving() {
        let dir = scratch("fence");
        let destination = dir.join("Export.csv");
        let saves = Saves::default();
        saves.new_page();
        let first = saves.attach();
        assert_eq!(publish(&saves, first, b"a", &destination), Published::Saved);

        // Attaching never reopens a held or sealed phase.
        saves.seal();
        assert_eq!(saves.attach(), first);
        assert_eq!(
            publish(&saves, first, b"late", &destination),
            Published::Cancelled
        );

        // A decided reload: the new page saves; the earlier page cannot.
        saves.new_page();
        let second = saves.attach();
        assert_ne!(first, second);
        assert_eq!(
            publish(&saves, first, b"stale", &destination),
            Published::Cancelled
        );
        assert_eq!(
            publish(&saves, second, b"b", &destination),
            Published::Saved
        );
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "b");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn no_write_starts_while_leaving_is_decided() {
        use std::sync::Arc;
        let dir = scratch("held");
        let destination = dir.join("Export.csv");
        let saves = Arc::new(Saves::default());
        saves.new_page();
        let epoch = saves.attach();
        saves.hold();
        let waiting = {
            let saves = Arc::clone(&saves);
            let destination = destination.clone();
            std::thread::spawn(move || publish(&saves, epoch, b"kept", &destination))
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            !destination.exists(),
            "nothing is written while leaving is decided"
        );
        saves.release();
        assert_eq!(waiting.join().unwrap(), Published::Saved);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "kept");
        block_on(saves.writes_finished());

        saves.hold();
        let refused = {
            let saves = Arc::clone(&saves);
            let destination = destination.clone();
            std::thread::spawn(move || publish(&saves, epoch, b"lost", &destination))
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        saves.seal();
        assert_eq!(refused.join().unwrap(), Published::Cancelled);
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "kept");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
