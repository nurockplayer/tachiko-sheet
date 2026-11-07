# GPUI grid canary: slice G1 (Sheet #327)

Throwaway spike. Never merged. App: `gpui-kit = "=0.9.0"` from crates.io, no
fork or vendoring; `Cargo.lock` is committed.

One run for every number below:
https://github.com/nurockplayer/tachiko-sheet/actions/runs/42338653443
(2026-11-07 13:29 JST, commit `39e4140`; finished 13:43 JST).

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
- Round 5 (2026-11-07 13:12 JST, run 42337402786): the failure message reported
  registered/visible counts for neighbour cells and the table bounds. It showed
  column-0 cells registered and column-1 cells absent.
- Round 6 (2026-11-07 13:29 JST, run 42338653443): every lookup goes through
  `cell_id`, which builds each id in the form Kit uses for that kind of column.
  All 10 cases passed on all three OS. This is the run quoted throughout.

## Case table

`pass` means the case ran through a real headless window and its assertion
held; it is not a proof of feel. `fail` means it ran and failed. No case used
the "not driven by real input" fallback.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G1a/b last row and column (10k) | pass | pass | pass | `visible_range().rows()` holds the last row; the last cell element is present |
| G1a/b last row and column (100k) | pass | pass | pass | same, row 99,999 and column 49 |
| G2a drag select (10k) | pass | pass | pass | `window.drag` from R2C1 to R5C3; label `R2C1:R5C3` |
| G2a drag select (100k) | pass | pass | pass | same |
| G2b shift-press select (10k) | pass | pass | pass | press R2C1, shift-press R5C3; label `R2C1:R5C3` |
| G2b shift-press select (100k) | pass | pass | pass | same |
| G2c shift-arrow extend (10k) | pass | pass | pass | click R2C1, then shift-down, shift-down, shift-right; label `R2C1:R4C2` |
| G2c shift-arrow extend (100k) | pass | pass | pass | same |
| G2d drag after scrolling to row 5,000 (10k) | pass | pass | pass | drag R5002C1 to R5005C3 after `scroll_to_row`; label `R5002C1:R5005C3` |
| G1c scroll timing (10k) | pass | pass | pass | logged reading, no threshold |

Both test steps run the same 10 cases: each case passes its own
`GridSize`, and `GPUI_GRID_SIZE` only selects the size of the app binary.

One naming note: Kit gives a cell in a fixed column the id
`table-cell:{row}:{col}` and a cell in a scrollable column
`table-cell-{row}:{col}` (a dash after `cell`); the tests derive both through
`cell_id(row, col)`.

## What the run confirms

On macOS, Windows and Linux, through a real headless window and normal event
dispatch:

- The table reaches its last row and last column at 10k and 100k rows.
- A pointer drag produces a multi-cell range with the anchor at the press and
  the focus at the release.
- Shift-press extends from an existing anchor instead of starting a new one.
- Shift+arrow reaches the app's `on_key_down`, extends the range and scrolls
  to the focus.
- A drag after a programmatic scroll to row 5,000 selects the cells under the
  pointer, with no offset error.

## G1c readings

200 simulated scroll steps of 480 px. Each step dispatches one wheel event and
renders one frame. The harness is headless and has no GPU, so these are GPUI's
layout cost per frame, not a real frame rate.

| OS | Size | Mean | Max |
| --- | --- | --- | --- |
| macOS | 10k | 5.20 ms | 11.49 ms |
| macOS | 100k | 4.69 ms | 8.30 ms |
| Windows | 10k | 12.89 ms | 25.32 ms |
| Windows | 100k | 13.33 ms | 35.21 ms |
| Linux | 10k | 4.89 ms | 9.23 ms |
| Linux | 100k | 5.13 ms | 20.15 ms |

## Build size and time

Warm builds: the two test steps had already compiled the dependencies, so
"build seconds" is the remaining `cargo build --release` for the binary only.

| OS | Binary bytes | Build seconds |
| --- | --- | --- |
| macOS | 20,441,760 | 92 |
| Windows | 19,758,592 | 211 |
| Linux | 53,558,648 | 102 |

## Lines of app code for range selection

In `src/lib.rs`, excluding the size/column plumbing:

- `RangeState` and its methods (`press`, `drag_to`, `release`, `normalized`,
  `label`, `contains`): about 67 lines with doc comments.
- Per-cell pointer handlers in `render_td`: about 57 lines.
- `extend_focus` and `on_key_down`: about 33 lines.

## Gaps

- **Row height is not settable.** `DataTable` takes only a `Size` preset
  (`XSmall` = 26 px, `Small` = 30 px); the brief asked 24 px, so 26 px was
  used.
- **Keyboard.** Shift+arrow is handled by `on_key_down` on the app root
  instead of action bindings, because the `actions!` macro's crate paths could
  not be verified without a local build. Plain arrows stay with the table and
  are synced from `TableEvent::SelectCell`; that path is exercised by the G2c
  click but not asserted on its own.
- **Toolchain.** `gpui-pre` 0.3.11 needs Rust 1.98 or newer; CI installs
  1.99.1 rather than NSH's 1.97.1 pin.
- **Empty cells.** Every cell renders `R{row}C{col}`; no case covers empty or
  mixed-content cells, and no case edits a value.

## By hand on the Mac

```sh
cd prototypes/gpui-grid
GPUI_GRID_SIZE=10k cargo run --release
GPUI_GRID_SIZE=100k cargo run --release
```

The window is 1440 x 900. Check:

- Scrolling feel: wheel over the grid, then the last row and last column.
- Retina sharpness: cell text and column borders.
- Mixed Chinese and Japanese text rendering: not exercised by this slice (cell
  text is `R{row}C{col}` only).
