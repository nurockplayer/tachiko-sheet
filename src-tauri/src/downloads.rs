//! Exports the Sheet offers for download, from WebKit to a user-chosen file.
//!
//! WebKit first writes each export to a private staging file, without any
//! panel open inside its download callback, and only one export is written at
//! a time, so exports complete in the order they were requested. Completed
//! exports are placed strictly in that order: the person picks a destination
//! (one Save panel at a time), the export is written to a new, exclusively
//! created file beside it and renamed into place. A failed export never leaves
//! a partial file or replaces an existing one, and an older export can never
//! overwrite a newer one.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The same download is already in flight.
    Duplicate,
    /// Another export is still being written.
    Busy,
}

#[derive(Default)]
pub struct ExportLedger {
    /// Download URL → staging file WebKit is writing (at most one).
    staged: HashMap<String, PathBuf>,
    /// Completed exports waiting for, or being moved to, their destination.
    placing: usize,
    serial: u64,
    /// The placement turn handed to the next completed export.
    next_turn: u64,
}

impl ExportLedger {
    /// Where WebKit should write this download.
    pub fn stage(&mut self, url: &str, folder: &Path, name: &str) -> Result<PathBuf, Refusal> {
        if self.staged.contains_key(url) {
            return Err(Refusal::Duplicate);
        }
        if !self.staged.is_empty() {
            return Err(Refusal::Busy);
        }
        self.serial += 1;
        let file = folder.join(format!("{}-{}", self.serial, sanitize(name)));
        self.staged.insert(url.to_owned(), file.clone());
        Ok(file)
    }

    /// The download finished writing. A successful one gets its placement
    /// turn; turns are consecutive, so every turn is eventually taken.
    pub fn take(&mut self, url: &str, success: bool) -> Option<(PathBuf, Option<u64>)> {
        let file = self.staged.remove(url)?;
        if !success {
            return Some((file, None));
        }
        self.placing += 1;
        let turn = self.next_turn;
        self.next_turn += 1;
        Some((file, Some(turn)))
    }

    pub fn placed(&mut self) {
        self.placing = self.placing.saturating_sub(1);
    }

    /// No export is being written or waiting for its destination.
    pub fn is_empty(&self) -> bool {
        self.staged.is_empty() && self.placing == 0
    }

    /// Give up exports still being written; returns their staging files.
    pub fn abandon_staged(&mut self) -> Vec<PathBuf> {
        self.staged.drain().map(|(_, file)| file).collect()
    }
}

/// Keep only the final path component and drop control characters.
fn sanitize(name: &str) -> String {
    let base = Path::new(name).file_name().map_or_else(
        || "export".to_owned(),
        |base| base.to_string_lossy().into_owned(),
    );
    let clean: String = base
        .chars()
        .filter(|character| !character.is_control())
        .collect();
    if clean.is_empty() || clean == "." || clean == ".." {
        "export".to_owned()
    } else {
        clean
    }
}

/// The file name WebKit suggested, for the Save panel.
pub fn suggested_name(staged: &Path) -> String {
    let name = staged
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    match name.split_once('-') {
        Some((serial, rest)) if serial.chars().all(|c| c.is_ascii_digit()) && !rest.is_empty() => {
            rest.to_owned()
        }
        _ => name,
    }
}

/// Write a completed export beside `destination` and rename it into place.
/// The temporary file is created exclusively (an existing file or symlink of
/// that name is never opened), so nothing outside it is written. On failure
/// any existing destination file is unchanged. The staging file is removed
/// either way.
pub fn place(staged: &Path, destination: &Path) -> io::Result<()> {
    static UNIQUE: AtomicU64 = AtomicU64::new(0);
    let result = (|| {
        let name = destination.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
        })?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let temporary = destination.with_file_name(format!(
            ".{}.tachiko-export-{}-{nanos}-{}",
            name.to_string_lossy(),
            std::process::id(),
            UNIQUE.fetch_add(1, Ordering::SeqCst)
        ));
        let written = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            io::copy(&mut File::open(staged)?, &mut output)?;
            output.sync_all()
        })();
        if let Err(error) = written.and_then(|()| std::fs::rename(&temporary, destination)) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(staged);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("tachiko-exports-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn one_export_is_written_at_a_time_and_placed_in_order() {
        let folder = PathBuf::from("/staging");
        let mut ledger = ExportLedger::default();
        assert!(ledger.is_empty());
        let first = ledger.stage("blob:a", &folder, "Report.csv").unwrap();
        assert_eq!(first, folder.join("1-Report.csv"));
        assert_eq!(
            ledger.stage("blob:a", &folder, "Report.csv"),
            Err(Refusal::Duplicate)
        );
        assert_eq!(
            ledger.stage("blob:b", &folder, "Report.csv"),
            Err(Refusal::Busy),
            "one export is written at a time"
        );
        assert_eq!(ledger.take("blob:a", true), Some((first, Some(0))));
        assert!(
            !ledger.is_empty(),
            "a completed export still waits for its destination"
        );

        let failed = ledger
            .stage("blob:b", &folder, "../../etc/Report.csv")
            .unwrap();
        assert_eq!(
            failed,
            folder.join("2-Report.csv"),
            "only the final path component is used"
        );
        assert_eq!(suggested_name(&failed), "Report.csv");
        assert_eq!(
            ledger.take("blob:b", false),
            Some((failed, None)),
            "a failed export takes no turn"
        );
        let third = ledger.stage("blob:c", &folder, "Report.csv").unwrap();
        assert_eq!(
            ledger.take("blob:c", true),
            Some((third, Some(1))),
            "turns stay consecutive"
        );
        ledger.placed();
        ledger.placed();
        let fourth = ledger.stage("blob:d", &folder, "Report.csv").unwrap();
        assert_eq!(ledger.abandon_staged(), vec![fourth]);
        assert!(ledger.is_empty());
    }

    #[test]
    fn placing_replaces_atomically_or_leaves_the_destination_unchanged() {
        let dir = scratch("place");
        let destination = dir.join("Export.csv");
        std::fs::write(&destination, "old").unwrap();

        let staged = dir.join("1-Export.csv");
        std::fs::write(&staged, "new").unwrap();
        place(&staged, &destination).unwrap();
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        assert!(!staged.exists());

        // A destination that cannot be replaced (here: a directory) is left as it was.
        let blocked = dir.join("Folder.csv");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("inside"), "kept").unwrap();
        let staged = dir.join("2-Folder.csv");
        std::fs::write(&staged, "new").unwrap();
        assert!(place(&staged, &blocked).is_err());
        assert_eq!(
            std::fs::read_to_string(blocked.join("inside")).unwrap(),
            "kept"
        );
        assert!(!staged.exists());
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with('.'))
            .collect();
        assert!(leftovers.is_empty(), "no temporary file remains");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_symlinked_destination_is_replaced_without_touching_its_target() {
        let dir = scratch("symlink");
        let target = dir.join("elsewhere.txt");
        std::fs::write(&target, "precious").unwrap();
        let destination = dir.join("Export.csv");
        std::os::unix::fs::symlink(&target, &destination).unwrap();
        let staged = dir.join("1-Export.csv");
        std::fs::write(&staged, "new").unwrap();
        place(&staged, &destination).unwrap();
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
}
