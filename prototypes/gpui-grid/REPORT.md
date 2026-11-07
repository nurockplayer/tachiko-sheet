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
https://github.com/nurockplayer/tachiko-sheet/actions/runs/42342700401
(2026-11-07 14:26 JST, commit `b8fb041`). The G1 sections above are unchanged.

Editing, copy and paste are throwaway canary code too. Values live in
`GridDelegate::edits`; there is no durable store, no formula and no
revision behind them.

## Case table

`pass` keeps its G1 meaning: the case ran through a real headless window and
its assertion held. The 10k and 100k steps run the same cases. Every OS ran
19 passed, 2 failed.

| Case | macOS | Windows | Linux | Notes |
| --- | --- | --- | --- | --- |
| G3a typing + Enter (10k, 100k) | pass | pass | pass | cell `xyz`, selection `R3C1`, no editor mounted |
| G3b typing + Tab | pass | pass | pass | cell `xyz`, selection `R2C2` |
| G3c Escape cancels | pass | pass | pass | cell kept `R2C1`, editor gone, selection `R2C1` |
| G3d composing text blocks Enter | pass | pass | pass | Enter during the mark changed nothing; after the mark cleared the cell was `日本` |
| G3e edit after scrolling to row 5,000 | pass | pass | pass | `R5002C1` holds the value, `R5003C1` selected |
| G3f Escape during composition | fail | fail | fail | the mark was `ni`, yet the edit was cancelled |
| G4a copy a 2x2 range | pass | pass | pass | clipboard exactly `R2C1\tR2C2\nR3C1\tR3C2` |
| G4b paste 2x2 from `R7C1` | pass | pass | pass | four cells written, label `R7C1:R8C2` |
| G4c paste 2x2 at the last cell | fail | fail | fail | the click at the corner cell selected nothing |
| G4d the same corner cell, clicked a quarter of its height from the top | pass | pass | pass | selection and paste both work |

The two failures are the same on every OS. The log lines (macOS; identical on
the other two):

```
thread 'g3f_composition_keeps_escape_from_cancelling' panicked at tests/grid.rs:517:9:
  left: None   right: Some((2, 1))
thread 'g4c_paste_at_the_corner_clips_without_panic' panicked at tests/grid.rs:548:5:
  assertion `left == right` failed: click at table-cell-9999:29 did not select it:
  label None, cell bounds Some(Bounds { origin: Point { x: 929px, y: 669px }, size: Size { 90px x 26px } }),
  table bounds Some(Bounds { origin: Point { x: 4px, y: 28px }, size: Size { 1016px x 668px } })
  left: None   right: Some("R9999C29:R9999C29")
```

## Which key route worked

GPUI runs keymap actions before key listeners, so Tab and Escape never reach
`on_key_down`: the focused editor sits inside the table, whose bindings turn
Tab into `SelectNextColumn` and Escape into `Cancel`. The app root now catches
both with `capture_action`, which runs root-first:

- editing, not composing: `SelectNextColumn` commits and moves right, `Cancel`
  cancels the edit, and both stop propagation;
- editing and composing: the action is stopped without committing or
  cancelling;
- not editing: the action propagates, so the table keeps its own behaviour.

That is the route that made G3b and G3c pass on all three OS. Enter still goes
through `on_key_down`, which works because the table binds nothing to Enter.

The root's own `Tab` action is declared in a private module in this version
(`crates/base/src/root.rs`: `actions!(root, [Tab, TabPrev])`, with only
`Root`/`RootPlugin` re-exported and `mod root;` private), so the app cannot
name it. Tab is caught through the table's `SelectNextColumn` instead, and
that binding is what the run matched.

G3f: with `ni` marked, Escape still cancelled the edit. The capture handler saw
no marked text at that point, although the test had just marked `ni`. Enter on
the same marked state does see the mark (G3d), so the difference is the Escape
path, not the composition check itself. What clears the mark before the action
is dispatched is not shown by the logs; cause unknown.

## The last row's corner cell

The click used by G4c does not select the cell, and the diagnostic prints why
it cannot: the cell is inside the table, but its centre sits in the strip at
the table's bottom edge. Cell y runs 669-695, the table ends at y=696, and the
cell centre is y=682. G4d clicks the same cell a quarter of its height from the
top (y=675.5) and both selects and pastes correctly.

So part of the last row is covered by whatever the table draws along its
bottom edge (the horizontal scrollbar in this layout), and a user cannot click
the middle of that row's cells. The click was left where it was; G4d exists to
show which part of the cell works.

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
  is about 5; the editing branch of `on_key_down` is about 14. About 100 lines
  before the action handlers.
- Keymap actions: `on_action_cancel` and `on_action_select_next_column` are
  about 34 lines.
- Copy and paste: `copy_range` and `paste` are about 62 lines; the secondary-key
  branch of `on_key_down` is about 15. About 77 lines.

## Build

The release binary is 24.9 MB on macOS, 24.9 MB on Windows and 58.2 MB on
Linux; warm build seconds were 134, 157 and 168 (macOS, Windows, Linux).

# Slice R1: the canary in real OS windows

One run for every number in this slice:
https://github.com/nurockplayer/tachiko-sheet/actions/runs/42345687489
(2026-11-07 15:08 JST, commit `a696d72`; finished 15:22 JST). The G1 and G3
sections above are unchanged.

Every earlier number came from GPUI Kit's test platform: a headless test
window that renders frames on demand. This slice opens the normal app window
on each runner and measures frames there.

## What runs

`GPUI_GRID_SWEEP=<file>` starts a sweep from the app's first rendered frame.
It uses `window.on_next_frame` recursively for 400 frames. Step `n` calls
`table.scroll_to_row(n * 25 % rows, cx)` and notifies; every 20th step also
calls `scroll_to_col(n / 20 % cols, cx)`. Each frame records the interval since
the previous frame and counts the frames until
`visible_range().rows()` contains the requested row. One second after the last
step it writes one line to the file:

```
os=<os> size=<size> frames=<n> mean_ms=<> p95_ms=<> max_ms=<> \
  max_lag_frames=<> mean_lag_frames=<>
```

Then it holds the window open for `GPUI_GRID_HOLD_MS` (default 8000 ms) and
quits. Without the variable the app renders exactly as before; the 21 tests
below ran with it unset.

The workflow starts the release binary in the background, waits up to 120 s
for the line, screenshots the screen while the window is still held, and prints
the line. macOS uses `screencapture -x`, Windows uses PowerShell
`System.Drawing.CopyFromScreen`, Linux runs the binary under
`xvfb-run -a -s "-screen 0 1440x900x24"` with `mesa-vulkan-drivers` installed
and `import -window root`.

## Sweep readings

`frames` is the frames recorded; 401 because the frame that finishes the sweep
is counted too. `lag` is the frames until the requested row was visible.

| OS | Size | frames | mean ms | p95 ms | max ms | max lag frames | mean lag frames | window opened |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | 10k | 401 | 34.43 | 38.02 | 129.58 | 1 | 1.00 | yes |
| macOS | 100k | 401 | 34.22 | 33.60 | 310.68 | 1 | 1.00 | yes |
| Windows | 10k | 401 | 48.89 | 90.47 | 135.15 | 1 | 1.00 | yes |
| Windows | 100k | 401 | 49.22 | 90.24 | 135.24 | 1 | 1.00 | yes |
| Linux | 10k | 401 | 82.51 | 96.00 | 715.03 | 1 | 1.00 | yes |
| Linux | 100k | 401 | 80.00 | 80.01 | 96.01 | 1 | 1.00 | yes |

Every step's scroll was visible on the next frame: no stale cell was measured
at either size on any OS. The 100k numbers are not slower than 10k, which fits
the table rendering only the rows in view.

Two readings look odd but are in the raw lines. macOS 100k has p95 (33.60)
below its mean (34.22) because a few frames of up to 310.68 ms pull the mean
above the 95th percentile. Linux 100k has mean 80.00 and p95 80.01 with a
96.01 ms max: that run has no large outlier, so the two sit on top of each
other. Linux 10k is the one with a spike (715.03 ms), which is why its mean and
max are apart.

**These are not user numbers.** GitHub's hosted runners have no real GPU: the
macOS and Windows runners draw through a software or virtual adapter, and Linux
ran on Xvfb with `mesa-vulkan-drivers` (lavapipe) installed. The renderer each
OS actually chose is not in the logs: the app prints nothing about its backend
and every `window-*.log` in the artifacts is empty, so the backend is setup
evidence here, not log evidence.

## Screenshots

One 10k screenshot per OS is committed under `evidence/`; the full set of six
(10k and 100k) is in the run's artifacts.

- `evidence/sweep-10k-macos.png` (1024x768): a real macOS window titled
  "GPUI Grid Canary" over the Finder desktop, with the table drawn: the row
  header column C0, then columns C10-C19, rows R9975 to R9977 and below. Cell
  text is legible. The requested 1440x900 window is larger than the runner's
  1024x768 screen, so its bottom edge is off screen.
- `evidence/sweep-10k-windows.png` (1024x768): the same window on the Windows
  desktop with the taskbar visible; the title bar is clipped at the top edge
  but "GPUI Grid Canary" is readable. Table drawn with C0 and C10-C19 and rows
  R9974-R9999, text legible.
- `evidence/sweep-10k-linux.png` (1440x900): the whole Xvfb screen; there is no
  window manager, so the window has no decoration and fills the 1440x900
  screen. Table drawn with C0 and C5-C19 and rows R9950-R9981, text legible.
  The C5 cells appear clipped on their left edge, where the fixed C0 column
  overlaps the scrolled columns.

The 100k screenshots show the same final state as the 10k ones on each OS: the
last step requests row 399 * 25 % rows, which is 9975 for both 10k and 100k
(399 * 25 is below 10,000), so both runs end at row 9975 and column 19. The two
sizes differ in the sweep line, not in the final frame.

## Tests

The 10k and 100k test steps still run 21 cases and still report 19 passed,
2 failed on every OS (`g3f_composition_keeps_escape_from_cancelling`,
`g4c_paste_at_the_corner_clips_without_panic`), the same two recorded in Slice
G3. The sweep code is inert in those runs because `GPUI_GRID_SWEEP` is unset.

## Rounds

- Round 1 (run 42344401962, commit `51e78d7`): the sweep did not build.
  `entity.update(...)` returns `()` here, and the code called `.ok()` on it
  (`E0599`); the library and binary both failed to compile, so the sweep steps
  found no binary and their screenshots show only the desktop. No data from
  that run.
- Round 2 (run 42345687489, commit `a696d72`): the run quoted above.

From the step logs, each sweep finished about 17 s after the binary started on
macOS, about 24 s on Windows, and 39 s (10k) and 35 s (100k) on Linux, all well
inside the 120 s wait.
