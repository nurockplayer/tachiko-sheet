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

# Slice G3: editing and copy/paste (Sheet #327 gates 3 and 4)

One run for every number in this slice:
https://github.com/nurockplayer/tachiko-sheet/actions/runs/42341704656
(2026-11-07 14:12 JST, commit `f7c8c84`). The G1 sections above are unchanged.

Editing, copy and paste are throwaway canary code too. Values live in
`GridDelegate::edits`; there is no durable store, no formula and no
revision behind them.

## Case table

`pass` keeps its G1 meaning: the case ran through a real headless window and
its assertion held. The 10k and 100k steps run the same cases.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G3a typing + Enter (10k, 100k) | pass | pass | pass | cell `xyz`, selection `R3C1`, no editor mounted |
| G3b typing + Tab | fail | fail | fail | cell still `R2C1`; the commit never ran |
| G3c Escape cancels | fail | fail | fail | an editor is still mounted over R2C1 |
| G3d composing text blocks Enter | pass | pass | pass | Enter during the mark changed nothing; after the mark cleared the cell was `日本` |
| G3e edit after scrolling to row 5,000 | pass | pass | pass | `R5002C1` holds the value, `R5003C1` selected |
| G4a copy a 2x2 range | pass | pass | pass | clipboard exactly `R2C1\tR2C2\nR3C1\tR3C2` |
| G4b paste 2x2 from `R7C1` | pass | pass | pass | four cells written, label `R7C1:R8C2` |
| G4c paste 2x2 at the last cell | fail | fail | fail | corner cell kept `R9999C29` |

The three failures are the same on every OS. The log lines:

```
thread 'g3b_tab_commits_and_moves_right' panicked at tests/grid.rs:410:5:
  left: "R2C1"   right: "xyz"
thread 'g3c_escape_cancels_without_writing' panicked at tests/grid.rs:433:9:
  left: Some((2, 1))   right: None
thread 'g4c_paste_at_the_corner_clips_without_panic' panicked at tests/grid.rs:563:9:
  left: "R9999C29"   right: "1"
```

## Which key route worked

Everything goes through `on_key_down` on the app root; the editor is mounted
inside the editing cell and takes focus.

- Printable start, Enter, secondary-C and secondary-V reached the root on all
  three OS (G3a, G3d, G3e, G4a, G4b pass through real key events).
- Tab and Escape did not produce their branch: G3b shows the cell text never
  changed, G3c shows the editor still mounted. Enter proves the root handler
  runs for the same focused-editor state, so the two keys were consumed below
  it. Which component consumed them is not shown by the logs; the input's own
  events or bindings have not been tried yet. Cause unknown.
- G4c: the corner cell kept its default text. The test's click at the last cell
  of the last row is the only step there that can leave the selection unset
  (paste returns without a selection), but the logs do not show the selection
  at that moment. Cause unknown.

## IME

Composition is simulated: the test marks text through
`ElementInputHandler::replace_and_mark_text_in_range` and clears the mark with
`replace_text_in_range`, both of which GPUI Kit's own input tests use. There is
no native OS IME, candidate window or platform event translation here. This is
**no substitute for gate 5 by hand**: typing Chinese and Japanese through a real
IME on the Mac is still required.

## App code

In `src/lib.rs`, with doc comments:

- Editing: `begin_edit`, `commit_and_move`, `cancel_edit` and
  `editor_is_composing` are about 81 lines; the editing branch in `render_td`
  is about 5; the editing branch of `on_key_down` is about 20. About 105 lines.
- Copy and paste: `copy_range` and `paste` are about 62 lines; the secondary-key
  branch of `on_key_down` is about 15. About 77 lines.

## Build

Adding the input widget grew the release binary from 20.4 MB to 24.9 MB on
macOS, from 19.8 MB to 24.9 MB on Windows and from 53.6 MB to 58.2 MB on
Linux; warm build seconds were 168, 134 and 115 (macOS, Windows, Linux).
