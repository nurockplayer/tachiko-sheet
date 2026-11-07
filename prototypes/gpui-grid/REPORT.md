# GPUI grid canary: slice G1 (Sheet #327)

Throwaway spike. Never merged. App: `gpui-kit = "=0.9.0"` from crates.io, no
fork or vendoring; `Cargo.lock` is committed.

Run URL: https://github.com/nurockplayer/tachiko-sheet/actions/runs/42335009735
(2026-11-07 12:39 JST, commit `c59fb60`).

## Build history

- Round 1 (2026-11-07 11:49 JST, run 42331124547): the app did not compile on
  any OS. Three errors in `src/lib.rs`: `when` needs `FluentBuilder` in scope,
  `v_flex` is not exported by `gpui_kit::*`, and `Window::focus` takes the app
  context. macOS also failed in `gpui-pre-macos` 0.3.11, which uses
  `map_or_default` (unstable before Rust 1.98; the NSH workflow pins 1.97.1).
  Fixed by an explicit `if` instead of `when`, a `div().flex().flex_col()`
  instead of `v_flex`, `window.focus(&handle, cx)`, and Rust 1.99.1 in CI.
- Round 2 (2026-11-07 12:02 JST, run 42332103171): the library and the binary
  built on all three OS; the test target did not compile: `tests/grid.rs`
  passed a `&str` to `find_all`, which needs a `'static` `ElementId` (`E0521`).
  Fixed by passing an owned `String`.
- Round 3 (2026-11-07 12:39 JST, run 42335009735): everything compiled and the
  ten cases ran on all three OS. Results below.

## Case table

`pass` means the case ran through a real headless window and its assertion
held. `fail` means it ran and an assertion or a harness lookup failed.
`not driven by real input` would mark a case whose input was dispatched around
the normal hit test; no case used that route.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G1a/b last row and column (10k) | fail | fail | fail | rows reached 9,999; visible cols ended at 28, not 29 |
| G1a/b last row and column (100k) | fail | fail | fail | rows reached 99,999; visible cols ended at 48, not 49 |
| G2a drag select (10k) | fail | fail | fail | `table-cell:2:1` is not in the harness registry |
| G2a drag select (100k) | fail | fail | fail | same |
| G2b shift-press select (10k) | fail | fail | fail | same |
| G2b shift-press select (100k) | fail | fail | fail | same |
| G2c shift-arrow extend (10k) | fail | fail | fail | the table click itself panics: id not registered |
| G2c shift-arrow extend (100k) | fail | fail | fail | same |
| G2d drag after scrolling to row 5,000 (10k) | fail | fail | fail | `table-cell:5002:1` is not in the registry |
| G1c scroll timing (10k) | pass | pass | pass | logged reading, no threshold |

The nine failures are one finding, not nine: the table's cell element ids are
not addressable from a test in another crate, so G2 a–d never delivered a
pointer or key event to a cell. Whether GPUI Kit can host range selection is
**not answered by CI**; the by-hand section below is the remaining path.

## G1c readings

200 simulated scroll steps of 480 px on a 10,000 x 30 grid. Each step
dispatches one wheel event and renders one frame. The harness is headless and
has no GPU, so these are GPUI's layout cost per frame, not a real frame rate.

| OS | Size | Mean | Max |
| --- | --- | --- | --- |
| macOS | 10k | 5.82 ms | 10.40 ms |
| macOS | 100k | 6.49 ms | 14.20 ms |
| Windows | 10k | 13.34 ms | 27.51 ms |
| Windows | 100k | 14.37 ms | 27.84 ms |
| Linux | 10k | 7.48 ms | 16.88 ms |
| Linux | 100k | 7.40 ms | 19.48 ms |

## Build size and time

From round 3. These are warm builds: the two test steps had already compiled
the dependencies, so "build seconds" is the remaining `cargo build --release`
for the binary only.

| OS | Binary bytes | Build seconds |
| --- | --- | --- |
| macOS | 20,441,760 | 100 |
| Windows | 19,758,592 | 207 |
| Linux | 53,558,712 | 168 |

## Lines of app code for range selection

In `src/lib.rs`, excluding the size/column plumbing:

- `RangeState` and its methods (`press`, `drag_to`, `release`, `normalized`,
  `label`, `contains`): about 67 lines with doc comments.
- Per-cell pointer handlers in `render_td`: about 57 lines.
- `extend_focus` and `on_key_down`: about 33 lines.

## Gaps

- **Cell ids are not observable.** GPUI Kit's `DataTable` wraps each cell with
  `.id(format!("table-cell:{row}:{col}")).test_support()`, but the harness
  registry after a frame lists no `table-cell:*` path, so `Window::click` and
  `find` panic on it. Our own cell ids (`grid-cell:{row}:{col}`) are not
  registered either, because the app does not call `.test_support()` on them
  and that extension is behind the `test-support` feature the binary build
  does not enable. This blocked G2 a–d on every OS.
- **`scroll_to_col(last)` leaves the last column out of `visible_range()`.**
  After it, `visible_range().cols()` was `18..29` on the 30-column grid and
  `38..49` on the 50-column grid: the exclusive end is one short of the last
  column. `scroll_to_row(last)` did reach the last row.
- **Row height is not settable.** `DataTable` takes only a `Size` preset
  (`XSmall` = 26 px, `Small` = 30 px); the brief asked 24 px, so 26 px was
  used.
- **Keyboard.** Shift+arrow is handled by `on_key_down` on the app root
  instead of action bindings, because the `actions!` macro's crate paths could
  not be verified without a local build. Plain arrows stay with the table and
  are synced from `TableEvent::SelectCell`; that path is also unverified by
  CI.
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
