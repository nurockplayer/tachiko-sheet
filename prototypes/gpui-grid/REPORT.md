# GPUI grid canary: slice G1 (Sheet #327)

Throwaway spike. Never merged. App: `gpui-kit = "=0.9.0"` from crates.io, no
fork or vendoring; `Cargo.lock` is committed.

Run URL: pending CI (first push 2026-11-07 JST).

## Build history

- Round 1 (2026-11-07 11:49 JST, run 42331124547): the app did not compile on
  any OS. Three errors in `src/lib.rs`: `when` needs `FluentBuilder` in scope,
  `v_flex` is not exported by `gpui_kit::*`, and `Window::focus` takes the app
  context. macOS also failed in `gpui-pre-macos` 0.3.11, which uses
  `map_or_default` (unstable before Rust 1.98; the NSH workflow pins 1.97.1).
  Fixed by an explicit `if` instead of `when`, a `div().flex().flex_col()`
  instead of `v_flex`, `window.focus(&handle, cx)`, and Rust 1.99.1 in CI.
  No test case ran in round 1.
- Round 2 (2026-11-07 12:02 JST, run 42332103171, "success" only because
  the steps use `continue-on-error`): the library and the binary built on all
  three OS, so the sizes and times below are from this run. The test target
  did not compile: `tests/grid.rs` passed a `&str` to `find_all`, which needs
  a `'static` `ElementId` (`E0521`), plus one unused-import warning. Fixed by
  passing an owned `String`. No test case ran in round 2 either.


## Case table

`pass` means the case ran through a real headless window and its assertion
held. `not run` means CI did not reach it; `not driven by real input` marks a
case whose pointer/keyboard sequence was dispatched around the normal hit
test.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G1a/b scroll to last row and column (10k) | not run | not run | not run | |
| G1a/b scroll to last row and column (100k) | not run | not run | not run | |
| G2a drag select (10k) | not run | not run | not run | |
| G2a drag select (100k) | not run | not run | not run | |
| G2b shift-press select (10k) | not run | not run | not run | |
| G2b shift-press select (100k) | not run | not run | not run | |
| G2c shift-arrow extend (10k) | not run | not run | not run | |
| G2c shift-arrow extend (100k) | not run | not run | not run | |
| G2d drag after scrolling to row 5,000 (10k) | not run | not run | not run | |
| G1c scroll timing (10k) | not run | not run | not run | logged reading, no threshold |

## G1c readings

Pending CI. The harness renders single frames headlessly and has no GPU, so
these numbers are GPUI's layout cost per simulated frame, not real frame rate.

## Build size and time

From run 42332103171 (round 2). These are warm builds: the two test steps had
already compiled the dependencies, so "build seconds" is the remaining
`cargo build --release` for the binary only.

| OS | Binary bytes | Build seconds |
| --- | --- | --- |
| macOS | 20,441,760 | 125 |
| Windows | 19,758,592 | 159 |
| Linux | 53,558,648 | 166 |

## Lines of app code for range selection

- `src/lib.rs`: `RangeState` (~65 lines) plus the per-cell pointer handlers
  in `render_td` (~35 lines) and the shift-arrow handler (~25 lines).

## Gaps

Pending CI.

## By hand on the Mac

```sh
cd prototypes/gpui-grid
GPUI_GRID_SIZE=10k cargo run --release
GPUI_GRID_SIZE=100k cargo run --release
```

The window is 1440 x 900. Check:

- Scrolling feel: wheel over the grid, then the last row and last column.
- Drag select: press a cell, drag to another, release; the header label reads
  `R{r1}C{c1}:R{r2}C{c2}` and the range is tinted.
- Mixed Chinese and Japanese text rendering: not exercised by this slice (cell
  text is `R{row}C{col}` only).
- Retina sharpness: cell text and column borders.
