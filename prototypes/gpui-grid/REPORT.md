# GPUI grid canary: slice G1 (Sheet #327)

Throwaway spike. Never merged. App: `gpui-kit = "=0.9.0"` from crates.io, no
fork or vendoring; `Cargo.lock` is committed.

One run for every number below:
https://github.com/nurockplayer/tachiko-sheet/actions/runs/42337402786
(2026-11-07 13:12 JST, commit `d36d2e9`).

## Build history

- Round 1 (2026-11-07 11:49 JST, run 42331124547): the app did not compile.
  `when` needs `FluentBuilder` in scope, `v_flex` is not exported by
  `gpui_kit::*`, and `Window::focus` takes the app context. macOS also failed
  in `gpui-pre-macos` 0.3.11 (`map_or_default`, unstable before Rust 1.98).
- Round 2 (2026-11-07 12:02 JST, run 42332103171): library and binary built;
  the test target passed a `&str` to `find_all`, which needs a `'static`
  `ElementId` (`E0521`).
- Round 3 (2026-11-07 12:39 JST, run 42335009735): all cases ran; cells could
  not be addressed right after opening a window.
- Round 4 (2026-11-07 12:57 JST, run 42336270797): two rendered frames
  (`settle`) before lookups; the lookup still found no scrollable-column cell.
- Round 5 (2026-11-07 13:12 JST, run 42337402786): the failure message now
  reports registered/visible counts for neighbour cells and the table bounds.
  This is the run quoted throughout.

## Case table

`pass` means the case ran through a real headless window and its assertion
held; it is not a proof of feel. `fail` means it ran and failed. No case used
the "not driven by real input" fallback.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G1a/b last row and column (10k) | fail | fail | fail | last cell `table-cell:9999:29` is not addressable |
| G1a/b last row and column (100k) | fail | fail | fail | same, `table-cell:99999:49` |
| G2a drag select (10k) | fail | fail | fail | `table-cell:2:1` is not addressable |
| G2a drag select (100k) | fail | fail | fail | same |
| G2b shift-press select (10k) | fail | fail | fail | same |
| G2b shift-press select (100k) | fail | fail | fail | same |
| G2c shift-arrow extend (10k) | fail | fail | fail | `Window::click` needs an addressable id |
| G2c shift-arrow extend (100k) | fail | fail | fail | same |
| G2d drag after scrolling to row 5,000 (10k) | fail | fail | fail | `table-cell:5002:1` is not addressable |
| G1c scroll timing (10k) | pass | pass | pass | logged reading, no threshold |

The row axis does reach the last row: the `visible_range().rows()` assertion
passes in G1a/b on every OS. Only the cell lookup fails.

## What the log shows

The same line on all three OS for every G2 case:

```
no visible table cell table-cell:2:1: find_all returned 0 element(s), 0 visible;
probe 0:0 -> 1 registered/1 visible, 1:0 -> 1/1, 0:1 -> 0/0;
table bounds Bounds { origin: Point { x: 4px, y: 28px }, size: Size { 1016px × 668px } }
```

So after two rendered frames, cells in column 0 (rows 0 and 1) are registered
and visible, a cell in column 1 is not registered at all, and the table itself
is laid out at 1016 x 668. Kit's own integration test addresses
`table-cell:0:0`, a column-0 cell, in the same way.

The `table-cell:*` id is set by Kit's table render path, not by this app or
its test: the delegate supplies cell content only, and the test renders frames
and reads Kit's public observation registry. Why a scrollable-column cell has
no registered id is **cause unknown**; the logs show it is not the row axis,
not an unrendered frame, and not a zero-sized table.

## G1c readings

200 simulated scroll steps of 480 px. Each step dispatches one wheel event and
renders one frame. The harness is headless and has no GPU, so these are GPUI's
layout cost per frame, not a real frame rate.

| OS | Size | Mean | Max |
| --- | --- | --- | --- |
| macOS | 10k | 9.08 ms | 22.08 ms |
| macOS | 100k | 8.54 ms | 36.62 ms |
| Windows | 10k | 11.61 ms | 27.55 ms |
| Windows | 100k | 11.43 ms | 30.80 ms |
| Linux | 10k | 7.27 ms | 12.18 ms |
| Linux | 100k | 7.48 ms | 20.35 ms |

## Build size and time

Warm builds: the two test steps had already compiled the dependencies, so
"build seconds" is the remaining `cargo build --release` for the binary only.

| OS | Binary bytes | Build seconds |
| --- | --- | --- |
| macOS | 20,441,760 | 123 |
| Windows | 19,758,592 | 211 |
| Linux | 53,558,648 | 163 |

## Lines of app code for range selection

In `src/lib.rs`, excluding the size/column plumbing:

- `RangeState` and its methods (`press`, `drag_to`, `release`, `normalized`,
  `label`, `contains`): about 67 lines with doc comments.
- Per-cell pointer handlers in `render_td`: about 57 lines.
- `extend_focus` and `on_key_down`: about 33 lines.

## Gaps

- **Cells outside the fixed column are not addressable by id.** See the log
  line above; this blocked G2a-d and the last-cell assertion in G1a/b on every
  OS. The root cause is unknown, as stated there.
- **Row height is not settable.** `DataTable` takes only a `Size` preset
  (`XSmall` = 26 px, `Small` = 30 px); the brief asked 24 px, so 26 px was
  used.
- **Keyboard.** Shift+arrow is handled by `on_key_down` on the app root
  instead of action bindings, because the `actions!` macro's crate paths could
  not be verified without a local build. Plain arrows stay with the table and
  are synced from `TableEvent::SelectCell`; that path is unverified by CI.
- **Toolchain.** `gpui-pre` 0.3.11 needs Rust 1.98 or newer; CI installs
  1.99.1 rather than NSH's 1.97.1 pin.

## By hand on the Mac

```sh
cd prototypes/gpui-grid
GPUI_GRID_SIZE=10k cargo run --release
GPUI_GRID_SIZE=100k cargo run --release
```

The window is 1440 x 900. Check:

- Scrolling feel: wheel over the grid, then the last row and last column.
- Drag select: press a cell, drag to another, release; the header label reads
  `R{r1}C{c1}:R{r2}C{c2}` and the range is tinted. This is the case CI could
  not drive.
- Shift-press and shift+arrow extending the same range.
- Mixed Chinese and Japanese text rendering: not exercised by this slice (cell
  text is `R{row}C{col}` only).
- Retina sharpness: cell text and column borders.
