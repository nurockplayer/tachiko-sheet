//! Files the person opens: from the OS (double-click, Open With, a launch
//! argument) or from File > Open.
//!
//! The host reads the file and holds it; the page asks for it when it can act
//! on it. The page never names a path.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

use crate::{lock, MAIN_WINDOW};

pub const EXTENSIONS: [&str; 5] = ["ro", "xlsx", "csv", "tsv", "txt"];
const MAX_BYTES: u64 = 256 * 1024 * 1024;

const READY_EVENT: &str =
    "window.dispatchEvent(new CustomEvent('tachiko-menu', { detail: 'file-opened' }));";

#[derive(Debug, PartialEq)]
enum Held {
    File { name: String, bytes: Vec<u8> },
    Refused { message: String },
}

/// The one file waiting for the page. The newest request wins, however long
/// each file takes to read.
#[derive(Default)]
pub struct OpenedFiles {
    waiting: Mutex<Option<Held>>,
    latest_request: AtomicU64,
}

impl OpenedFiles {
    /// A new request also drops an older file still waiting.
    fn begin(&self) -> u64 {
        let mut waiting = lock(&self.waiting);
        *waiting = None;
        self.latest_request.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// False when a newer request has superseded this one.
    fn publish(&self, request: u64, held: Held) -> bool {
        let mut waiting = lock(&self.waiting);
        if self.latest_request.load(Ordering::SeqCst) != request {
            return false;
        }
        *waiting = Some(held);
        true
    }
}

pub fn supported(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            EXTENSIONS
                .iter()
                .any(|known| extension.eq_ignore_ascii_case(known))
        })
}

fn read(path: &Path, limit: u64) -> Held {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !supported(path) {
        return Held::Refused {
            message: format!(
                "Tachiko Sheet opens .ro, .xlsx, .csv, .tsv and .txt files. “{name}” was not opened."
            ),
        };
    }
    let mut bytes = Vec::new();
    let result = File::open(path).and_then(|file| file.take(limit + 1).read_to_end(&mut bytes));
    match result {
        Err(_) => Held::Refused {
            message: format!("“{name}” could not be read. Nothing was opened."),
        },
        Ok(size) if size as u64 > limit => Held::Refused {
            message: format!("“{name}” is too large to open. Nothing was opened."),
        },
        Ok(_) => Held::File { name, bytes },
    }
}

/// `[status: 0 file, 1 refused][text length: u32 LE][name or message][bytes]`;
/// empty when no file is waiting.
fn encode(held: Option<Held>) -> Vec<u8> {
    let (status, text, bytes) = match held {
        None => return Vec::new(),
        Some(Held::File { name, bytes }) => (0, name, bytes),
        Some(Held::Refused { message }) => (1, message, Vec::new()),
    };
    let mut frame = Vec::with_capacity(5 + text.len() + bytes.len());
    frame.push(status);
    frame.extend_from_slice(&(text.len() as u32).to_le_bytes());
    frame.extend_from_slice(text.as_bytes());
    frame.extend_from_slice(&bytes);
    frame
}

/// Read the file off the main thread, hold it, and tell the page.
pub fn offer(app: &AppHandle, path: PathBuf) {
    let app = app.clone();
    let request = app.state::<OpenedFiles>().begin();
    tauri::async_runtime::spawn_blocking(move || {
        let held = read(&path, MAX_BYTES);
        if !app.state::<OpenedFiles>().publish(request, held) {
            return;
        }
        // A page that isn't listening yet asks when it starts.
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.eval(READY_EVENT);
        }
    });
}

#[tauri::command]
pub fn take_opened_file(files: State<'_, OpenedFiles>) -> Response {
    Response::new(encode(lock(&files.waiting).take()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, content: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sheet-opened-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn known_extensions_in_any_case_are_supported() {
        assert!(supported(Path::new("/a/book.XLSX")));
        assert!(supported(Path::new("work.ro")));
        assert!(!supported(Path::new("/a/notes.pdf")));
        assert!(!supported(Path::new("/a/--flag")));
    }

    #[test]
    fn a_file_is_read_up_to_the_limit_and_refused_past_it() {
        let path = temp_file("limit.csv", b"12345");
        assert_eq!(
            read(&path, 5),
            Held::File {
                name: "limit.csv".into(),
                bytes: b"12345".to_vec()
            }
        );
        assert!(matches!(read(&path, 4), Held::Refused { .. }));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn an_unsupported_or_missing_file_is_refused_by_name() {
        let Held::Refused { message } = read(Path::new("/no/such/notes.pdf"), 5) else {
            panic!("an unsupported file was read");
        };
        assert!(message.contains("notes.pdf"));
        let Held::Refused { message } = read(Path::new("/no/such/book.csv"), 5) else {
            panic!("a missing file was read");
        };
        assert!(message.contains("book.csv"));
    }

    #[test]
    fn an_older_request_that_finishes_last_does_not_replace_a_newer_one() {
        let refused = |message: &str| Held::Refused {
            message: message.into(),
        };
        let files = OpenedFiles::default();
        let older = files.begin();
        let newer = files.begin();
        assert!(files.publish(newer, refused("newer")));
        assert!(!files.publish(older, refused("older")));
        assert_eq!(lock(&files.waiting).take(), Some(refused("newer")));
    }

    #[test]
    fn a_new_request_drops_an_older_file_still_waiting() {
        let files = OpenedFiles::default();
        let older = files.begin();
        assert!(files.publish(
            older,
            Held::Refused {
                message: "older".into()
            }
        ));
        files.begin();
        assert_eq!(lock(&files.waiting).take(), None);
    }

    #[test]
    fn the_frame_carries_status_name_and_bytes() {
        assert!(encode(None).is_empty());
        let frame = encode(Some(Held::File {
            name: "a.ro".into(),
            bytes: vec![9, 8],
        }));
        assert_eq!(frame, [&[0, 4, 0, 0, 0][..], b"a.ro", &[9, 8]].concat());
        let refused = encode(Some(Held::Refused {
            message: "no".into(),
        }));
        assert_eq!(refused, [&[1, 2, 0, 0, 0][..], b"no"].concat());
    }
}
