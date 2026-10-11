//! Bookkeeping for exports being saved to user-chosen files.
//!
//! Each export is written to a hidden temporary file beside its destination
//! and moved into place only when it completed, so a failed export never
//! leaves a partial file or replaces an existing one. A destination accepts
//! one export at a time, so an older export can never overwrite a newer one.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum Reservation {
    /// Write the download here, then call [`DownloadLedger::finish`].
    Write(PathBuf),
    /// The same download is already in flight.
    DuplicateDownload,
    /// Another export to this destination is still being saved.
    DestinationBusy,
}

#[derive(Default)]
pub struct DownloadLedger {
    /// Download URL → (temporary file, destination).
    pending: HashMap<String, (PathBuf, PathBuf)>,
    serial: u64,
}

impl DownloadLedger {
    pub fn reserve(&mut self, url: &str, destination: PathBuf, process: u32) -> Reservation {
        if self.pending.contains_key(url) {
            return Reservation::DuplicateDownload;
        }
        if self
            .pending
            .values()
            .any(|(_, busy)| same_file(busy, &destination))
        {
            return Reservation::DestinationBusy;
        }
        let Some(name) = destination.file_name() else {
            return Reservation::DestinationBusy;
        };
        self.serial += 1;
        let temporary = destination.with_file_name(format!(
            ".{}.tachiko-download-{process}-{}",
            name.to_string_lossy(),
            self.serial
        ));
        self.pending
            .insert(url.to_owned(), (temporary.clone(), destination));
        Reservation::Write(temporary)
    }

    /// Release a download's reservation: `(temporary file, destination)`.
    pub fn finish(&mut self, url: &str) -> Option<(PathBuf, PathBuf)> {
        self.pending.remove(url)
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Give up every unfinished export; returns the temporary files to delete.
    pub fn abandon_all(&mut self) -> Vec<PathBuf> {
        self.pending
            .drain()
            .map(|(_, (temporary, _))| temporary)
            .collect()
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    // The Save panel returns absolute paths; compare case-insensitively as the
    // default macOS volume format does.
    left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
}

/// Move a completed download into place. Returns whether the destination now
/// holds it; on failure the temporary file is removed and any existing file
/// is unchanged.
pub fn complete(temporary: &Path, destination: &Path, success: bool) -> bool {
    let moved = success && std::fs::rename(temporary, destination).is_ok();
    if !moved {
        let _ = std::fs::remove_file(temporary);
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_export_per_destination_and_per_download() {
        let mut ledger = DownloadLedger::default();
        let target = PathBuf::from("/tmp/Report.csv");
        let Reservation::Write(first) = ledger.reserve("blob:a", target.clone(), 7) else {
            panic!("first export is accepted");
        };
        assert!(
            first
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".Report.csv.tachiko-download-7-")
        );
        assert_eq!(
            ledger.reserve("blob:a", PathBuf::from("/tmp/Other.csv"), 7),
            Reservation::DuplicateDownload
        );
        assert_eq!(
            ledger.reserve("blob:b", PathBuf::from("/tmp/report.CSV"), 7),
            Reservation::DestinationBusy
        );
        assert!(matches!(
            ledger.reserve("blob:c", PathBuf::from("/tmp/Other.csv"), 7),
            Reservation::Write(_)
        ));
        assert_eq!(ledger.finish("blob:a"), Some((first, target.clone())));
        assert!(
            matches!(ledger.reserve("blob:b", target, 7), Reservation::Write(_)),
            "the destination is free again"
        );
        assert_eq!(ledger.abandon_all().len(), 2);
        assert!(ledger.is_empty());
    }

    #[test]
    fn completion_replaces_atomically_or_leaves_the_destination_unchanged() {
        let dir = std::env::temp_dir().join(format!("tachiko-downloads-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let destination = dir.join("Export.csv");
        std::fs::write(&destination, "old").unwrap();

        let failed = dir.join(".Export.csv.tmp-failed");
        std::fs::write(&failed, "partial").unwrap();
        assert!(!complete(&failed, &destination, false));
        assert!(!failed.exists());
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "old");

        let written = dir.join(".Export.csv.tmp-ok");
        std::fs::write(&written, "new").unwrap();
        assert!(complete(&written, &destination, true));
        assert!(!written.exists());
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
