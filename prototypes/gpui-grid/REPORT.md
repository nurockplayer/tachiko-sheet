# GPUI grid canary: slice G1 (Sheet #327)

Throwaway spike. Never merged. App: `gpui-kit = "=0.9.0"` from crates.io, no
fork or vendoring; `Cargo.lock` is committed.

Run URL: pending CI (first push 2026-11-07 JST).

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

| OS | Binary bytes | Cold build seconds |
| --- | --- | --- |
| macOS | pending | pending |
| Windows | pending | pending |
| Linux | pending | pending |

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
