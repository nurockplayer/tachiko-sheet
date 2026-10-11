//! Exports the Sheet offers for download, from WebKit to a user-chosen file.
//!
//! WebKit first writes each export to a private staging file, without any
//! panel open inside its download callback. Once complete, the person picks a
//! destination (one Save panel at a time) and the export is copied beside it
//! and renamed into place, so a failed export never leaves a partial file or
//! replaces an existing one, and an older export can never overwrite a newer
//! one at the same destination.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Default)]
pub struct ExportLedger {
    /// Download URL → staging file WebKit is writing.
    staged: HashMap<String, PathBuf>,
    /// Completed exports waiting for, or being moved to, their destination.
    placing: usize,
    serial: u64,
}

impl ExportLedger {
    /// Where WebKit should write this download, or `None` if the same
    /// download is already in flight.
    pub fn stage(&mut self, url: &str, folder: &Path, name: &str) -> Option<PathBuf> {
        if self.staged.contains_key(url) {
            return None;
        }
        self.serial += 1;
        let file = folder.join(format!("{}-{}", self.serial, sanitize(name)));
        self.staged.insert(url.to_owned(), file.clone());
        Some(file)
    }

    /// The download finished writing; it now waits to be placed.
    pub fn take(&mut self, url: &str) -> Option<PathBuf> {
        let file = self.staged.remove(url)?;
        self.placing += 1;
        Some(file)
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

/// Copy a completed export beside `destination` and rename it into place.
/// On failure any existing destination file is unchanged. The staging file
/// is removed either way.
pub fn place(staged: &Path, destination: &Path, process: u32) -> io::Result<()> {
    let result = (|| {
        let name = destination.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
        })?;
        let temporary = destination.with_file_name(format!(
            ".{}.tachiko-export-{process}",
            name.to_string_lossy()
        ));
        if let Err(error) =
            std::fs::copy(staged, &temporary).and_then(|_| std::fs::rename(&temporary, destination))
        {
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
    fn exports_are_tracked_until_placed() {
        let folder = PathBuf::from("/staging");
        let mut ledger = ExportLedger::default();
        assert!(ledger.is_empty());
        let first = ledger.stage("blob:a", &folder, "Report.csv").unwrap();
        assert_eq!(first, folder.join("1-Report.csv"));
        assert_eq!(
            ledger.stage("blob:a", &folder, "Report.csv"),
            None,
            "the same download is in flight"
        );
        let second = ledger
            .stage("blob:b", &folder, "../../etc/Report.csv")
            .unwrap();
        assert_eq!(
            second,
            folder.join("2-Report.csv"),
            "only the final path component is used"
        );
        assert_eq!(suggested_name(&second), "Report.csv");
        assert_eq!(ledger.take("blob:a"), Some(first));
        assert!(
            !ledger.is_empty(),
            "a completed export still waits for its destination"
        );
        ledger.placed();
        assert_eq!(ledger.abandon_staged(), vec![second]);
        assert!(ledger.is_empty());
    }

    #[test]
    fn placing_replaces_atomically_or_leaves_the_destination_unchanged() {
        let dir = scratch("place");
        let destination = dir.join("Export.csv");
        std::fs::write(&destination, "old").unwrap();

        let staged = dir.join("1-Export.csv");
        std::fs::write(&staged, "new").unwrap();
        place(&staged, &destination, 1).unwrap();
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new");
        assert!(!staged.exists());

        // A destination that cannot be replaced (here: a directory) is left as it was.
        let blocked = dir.join("Folder.csv");
        std::fs::create_dir(&blocked).unwrap();
        std::fs::write(blocked.join("inside"), "kept").unwrap();
        let staged = dir.join("2-Folder.csv");
        std::fs::write(&staged, "new").unwrap();
        assert!(place(&staged, &blocked, 1).is_err());
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
}
