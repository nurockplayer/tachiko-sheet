//! Saving exports as new files the person names.
//!
//! The page hands the host the bytes of an export; the host asks for a
//! destination with a Save sheet and creates the file. WebKit downloads are not
//! used, so one owner sees an export from request to file.
//!
//! - Exports are saved as new files only ("Save a copy"): an existing name —
//!   a file, a folder, a symlink, a pipe — is never opened or replaced.
//! - The page orders its saves; the host serves one Save sheet at a time.
//! - Each page load the host allows starts a new page epoch; a page learns it
//!   when it starts, and a save from an earlier page is refused.
//! - Only the leave decision and an allowed page load change the phase:
//!   while leaving is being decided, no write starts; once decided, none will.
//!   A write already started is completed, and leaving waits for it without
//!   blocking the main thread.
//! - Each save has an id; its receipt is kept, so a transport retry of the
//!   same save returns the original outcome instead of a guess.
//! - The bytes go to an exclusively created temporary file in the destination
//!   folder, which is moved into place only if the name is still free
//!   (`RENAME_EXCL`), checked to be that file, and the folder flushed.

use std::collections::{HashMap, VecDeque};
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
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

/// How many finished receipts are remembered for retries.
const RECEIPTS_KEPT: usize = 64;

#[derive(Debug)]
struct State {
    epoch: u64,
    phase: Phase,
    /// Writes started and not yet finished.
    writing: usize,
    /// Save id → its outcome, once known (`None` while in progress).
    receipts: HashMap<String, Option<Result<String, String>>>,
    finished: VecDeque<String>,
}

/// What became of one save.
#[derive(Debug, PartialEq, Eq)]
pub enum Published {
    Saved,
    /// Leaving was decided first, or the save belongs to an earlier page.
    Cancelled,
}

/// The first request for a save id runs it; a retry gets its receipt.
pub enum Claim {
    Run,
    Receipt(Result<String, String>),
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
                receipts: HashMap::new(),
                finished: VecDeque::new(),
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
    /// earlier pages are refused from now on, and saving is open.
    pub fn new_page(&self) {
        self.set(|state| {
            state.epoch += 1;
            state.phase = Phase::Open;
        });
    }

    /// The current page epoch. This never changes the phase.
    pub fn page(&self) -> u64 {
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

    /// Run the save `id` here, or wait for and return its earlier outcome.
    pub async fn claim(&self, id: &str) -> Claim {
        loop {
            let changed = self.changed.notified();
            {
                let mut state = self.lock();
                match state.receipts.get(id) {
                    None => {
                        state.receipts.insert(id.to_owned(), None);
                        return Claim::Run;
                    }
                    Some(Some(outcome)) => return Claim::Receipt(outcome.clone()),
                    Some(None) => {}
                }
            }
            changed.await;
        }
    }

    /// Record the outcome of save `id` for any retry of it.
    pub fn receipt(&self, id: &str, outcome: Result<String, String>) {
        self.set(|state| {
            state.receipts.insert(id.to_owned(), Some(outcome));
            state.finished.push_back(id.to_owned());
            while state.finished.len() > RECEIPTS_KEPT {
                if let Some(old) = state.finished.pop_front() {
                    state.receipts.remove(&old);
                }
            }
        });
    }

    /// Create `destination` with `bytes` for the page of `epoch`, unless
    /// leaving was decided or the page is gone. Waits while leaving is being
    /// decided.
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
        let written = tauri::async_runtime::spawn_blocking(move || write_new(&bytes, &destination))
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
    /// Something already has this name; nothing was written there.
    Exists,
    /// Nothing was created; nothing at the destination changed.
    NotSaved(io::Error),
    /// The new file was created, but it could not be confirmed (another
    /// program changed it, or the folder could not be flushed).
    Unconfirmed(io::Error),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Exists => formatter.write_str("the name is already in use"),
            Self::NotSaved(error) | Self::Unconfirmed(error) => error.fmt(formatter),
        }
    }
}

fn identity(metadata: &std::fs::Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

fn c_path(path: &Path) -> io::Result<CString> {
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "the name contains a NUL byte"))
}

/// Move `from` to `to` only if `to` does not exist (`renamex_np` with
/// `RENAME_EXCL`): an existing entry is never replaced.
fn rename_new(from: &Path, to: &Path) -> io::Result<()> {
    let (from, to) = (c_path(from)?, c_path(to)?);
    // SAFETY: both are valid NUL-terminated paths for the duration of the call.
    if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Create `destination` with `bytes` as a new file; never open or replace
/// anything already there.
pub fn write_new(bytes: &[u8], destination: &Path) -> Result<(), WriteError> {
    static UNIQUE: AtomicU64 = AtomicU64::new(0);
    let not_saved = WriteError::NotSaved;
    let folder = destination
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
    // Looked at without opening or following it.
    if std::fs::symlink_metadata(destination).is_ok() {
        return Err(WriteError::Exists);
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.subsec_nanos());
    let temporary = folder.join(format!(
        ".tachiko-save-{}-{nanos}-{}.tmp",
        std::process::id(),
        UNIQUE.fetch_add(1, Ordering::SeqCst)
    ));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o666)
        .open(&temporary)
        .map_err(not_saved)?;
    let ours = output.metadata().map_err(not_saved)?;
    let still_ours = |path: &Path| {
        std::fs::symlink_metadata(path).is_ok_and(|named| identity(&named) == identity(&ours))
    };
    let prepared = output
        .write_all(bytes)
        .and_then(|()| output.sync_all())
        .and_then(|()| {
            if still_ours(&temporary) {
                Ok(())
            } else {
                Err(io::Error::other(
                    "the temporary file was replaced by another program",
                ))
            }
        });
    if let Err(error) = prepared.and_then(|()| rename_new(&temporary, destination)) {
        if still_ours(&temporary) {
            let _ = std::fs::remove_file(&temporary);
        }
        return Err(if error.raw_os_error() == Some(libc::EEXIST) {
            WriteError::Exists
        } else {
            not_saved(error)
        });
    }
    let unconfirmed = WriteError::Unconfirmed;
    if !still_ours(destination) {
        return Err(unconfirmed(io::Error::other(
            "another program changed the file while it was being saved",
        )));
    }
    let directory = File::open(folder).map_err(unconfirmed)?;
    // F_FULLFSYNC where the volume supports it on a folder, else fsync.
    // SAFETY: the descriptor is open for the duration of the call.
    if directory.sync_all().is_err() && unsafe { libc::fsync(directory.as_raw_fd()) } != 0 {
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

    fn hidden_leftovers(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with('.'))
            .count()
    }

    #[test]
    fn a_new_file_is_created_and_flushed() {
        let dir = scratch("new");
        let destination = dir.join(format!("{}.csv", "n".repeat(240)));
        write_new(b"new", &destination).unwrap();
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        assert_eq!(hidden_leftovers(&dir), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nothing_already_named_is_opened_or_replaced() {
        let dir = scratch("exists");
        let file = dir.join("Report.csv");
        std::fs::write(&file, "old").unwrap();
        assert!(matches!(write_new(b"new", &file), Err(WriteError::Exists)));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "old");

        let target = dir.join("elsewhere.txt");
        std::fs::write(&target, "precious").unwrap();
        let link = dir.join("Linked.csv");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(matches!(write_new(b"new", &link), Err(WriteError::Exists)));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "precious");

        // A named pipe without a writer would block an open: it is never opened.
        let pipe = dir.join("Pipe.csv");
        let path = c_path(&pipe).unwrap();
        // SAFETY: a valid NUL-terminated path.
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        assert!(matches!(write_new(b"new", &pipe), Err(WriteError::Exists)));

        // The final move never replaces a name taken after the first check.
        let raced = dir.join("Raced.csv");
        let temporary = dir.join(".candidate.tmp");
        std::fs::write(&temporary, "new").unwrap();
        std::fs::write(&raced, "theirs").unwrap();
        assert_eq!(
            rename_new(&temporary, &raced).unwrap_err().raw_os_error(),
            Some(libc::EEXIST)
        );
        assert_eq!(std::fs::read_to_string(&raced).unwrap(), "theirs");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_folder_saves_nothing() {
        let dir = scratch("missing");
        let destination = dir.join("gone").join("Report.csv");
        assert!(matches!(
            write_new(b"new", &destination),
            Err(WriteError::NotSaved(_))
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_an_allowed_page_load_reopens_saving() {
        let dir = scratch("fence");
        let saves = Saves::default();
        saves.new_page();
        let first = saves.page();
        assert_eq!(
            publish(&saves, first, b"a", &dir.join("a.csv")),
            Published::Saved
        );

        saves.seal();
        assert_eq!(saves.page(), first, "asking for the page never reopens it");
        assert_eq!(
            publish(&saves, first, b"late", &dir.join("late.csv")),
            Published::Cancelled
        );
        assert!(!dir.join("late.csv").exists());

        saves.new_page();
        let second = saves.page();
        assert_ne!(first, second);
        assert_eq!(
            publish(&saves, first, b"stale", &dir.join("stale.csv")),
            Published::Cancelled
        );
        assert_eq!(
            publish(&saves, second, b"b", &dir.join("b.csv")),
            Published::Saved
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn no_write_starts_while_leaving_is_decided() {
        use std::sync::Arc;
        let dir = scratch("held");
        let saves = Arc::new(Saves::default());
        saves.new_page();
        let epoch = saves.page();
        saves.hold();
        let kept = dir.join("kept.csv");
        let waiting = {
            let (saves, kept) = (Arc::clone(&saves), kept.clone());
            std::thread::spawn(move || publish(&saves, epoch, b"kept", &kept))
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            !kept.exists(),
            "nothing is written while leaving is decided"
        );
        saves.release();
        assert_eq!(waiting.join().unwrap(), Published::Saved);
        block_on(saves.writes_finished());

        saves.hold();
        let lost = dir.join("lost.csv");
        let refused = {
            let (saves, lost) = (Arc::clone(&saves), lost.clone());
            std::thread::spawn(move || publish(&saves, epoch, b"lost", &lost))
        };
        std::thread::sleep(std::time::Duration::from_millis(100));
        saves.seal();
        assert_eq!(refused.join().unwrap(), Published::Cancelled);
        assert!(!lost.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_retried_save_returns_its_original_receipt() {
        let saves = Saves::default();
        assert!(matches!(block_on(saves.claim("save-1")), Claim::Run));
        saves.receipt("save-1", Ok("saved".to_owned()));
        match block_on(saves.claim("save-1")) {
            Claim::Receipt(outcome) => assert_eq!(outcome, Ok("saved".to_owned())),
            Claim::Run => panic!("a retry must not run the save again"),
        }
        assert!(matches!(block_on(saves.claim("save-2")), Claim::Run));
    }
}
