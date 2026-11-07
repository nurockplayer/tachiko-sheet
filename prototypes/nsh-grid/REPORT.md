# NSH grid canary — slice 1a report

Throwaway evidence app for Sheet #327 on `spike/nsh-grid`. **Never merged.**
Facts only: the CI runners have no GPU, so the frame-rate readings below are
runner numbers, not a device verdict.

## Runs

| Run | Head | When (JST) | Use |
| --- | --- | --- | --- |
| [42326304520](https://github.com/nurockplayer/tachiko-sheet/actions/runs/42326304520) | `6b48131` | 2026-11-07 10:52–11:05 | Cold-cache build times; its test results were superseded by the layout fix below (all OSes failed G1a/G1b). |
| [42327687401](https://github.com/nurockplayer/tachiko-sheet/actions/runs/42327687401) | `8718046` | 2026-11-07 11:10–11:15 | Results below. |

Every test step is `continue-on-error: true`, so a green job does not mean
green tests; the per-job artifact logs (`nsh-grid-<target>`) are the source.
Each app opens on a 390 × 844 pt surface (the `open` default), headless and
in a real window.

## Cases (run 42327687401)

| Case | macOS 15 headless | macOS 15 window | Windows 2022 headless | Windows 2022 window | Ubuntu 24.04 headless | Ubuntu 24.04 window |
| --- | --- | --- | --- | --- | --- | --- |
| G1a — 10k × 30: jump to last row and column | **pass** 716 ms | **pass** 3.2 s | **pass** 513 ms | **pass** 2.6 s | **pass** 544 ms | **pass** 28.6 s |
| G1b — 100k × 50: jump to last row and column | **pass** 762 ms | **pass** 2.6 s | **pass** 508 ms | **pass** 2.2 s | **pass** 581 ms | **pass** 26.2 s |
| G1c — 10k: scroll sweep | **fail** 34.6 s | **pass** 17.2 s | **pass** 27.1 s | **pass** 21.0 s | **pass** 21.5 s | **fail** 33.9 s |
| G1c — 100k: scroll sweep | **fail** 31.9 s | **pass** 14.7 s | **pass** 27.5 s | **pass** 21.3 s | **pass** 20.8 s | **pass** 22.8 s |

G1a/G1b checks the last row and last column text, the frozen first column
(`R<row>C0`), and the `C0` title after pressing `jump-last`. G1c checks that
three 4800 pt scrolls leave some row below R0 in the frozen first column.

Every G1c failure is the runner's default 30 s per-test limit, not a failed
assertion:

```
✗ App.test.tsx › G1c: scroll sweep (34.6s)
    the test did not end in 30 s
```

## Frame-rate readings (`--fps`, last sample)

Line format as NSH prints it: `fps <shown>/<display> frame … items … engine cpu mem|rss`.
Headless runs print none (`--fps` needs `--target`).

| OS / size | Reading |
| --- | --- |
| Linux 10k | `fps 60/60 frame 4.59/1.84/14.39/17.87 gap 16.67/16.16/27.17/29.39 over 1% … items 298 engine 97% cpu 129% rss 299.6 MB` |
| Linux 100k | `fps 60/60 frame 5.06/1.70/16.72/22.34 gap 16.67/16.51/28.60/33.12 over 6% … items 301 engine 96% cpu 127% rss 301.5 MB` |
| macOS 10k | `fps 53/60 frame 9.16/2.15/38.82/56.05 gap 20.27/16.65/53.62/66.14 over 19% … items 662 engine 79% cpu 66% gpu 0% mem 55.0 MB` |
| macOS 100k | `fps 45/60 frame 12.72/6.17/50.01/72.74 gap 22.81/16.85/64.39/81.19 over 23% … items 507 engine 98% cpu 154% gpu 0% mem 58.0 MB` |
| Windows 10k | `fps 49/64 frame 5.55/6.19/9.82/10.47 gap 22.43/16.19/31.86/32.05 over 0% … items 131 engine 43% cpu 44% mem 77.7 MB` |
| Windows 100k | `fps 33/64 frame 5.48/6.11/10.21/10.75 gap 23.38/17.06/31.86/32.37 over 0% … items 136 engine 0% cpu 0% mem 78.6 MB` |

These are single samples from a shared CI runner; the 0% engine/CPU sample
on Windows 100k is the frame after the last input, not a steady state.

## Commit times (`--trace`)

| OS / size | Commits | Max | Mean |
| --- | --- | --- | --- |
| Linux 10k | 123 | 163.3 ms | 59.7 ms |
| Linux 100k | 183 | 164.9 ms | 59.0 ms |
| macOS 10k | 94 | 446.4 ms | 131.1 ms |
| macOS 100k | 119 | 260.5 ms | 101.6 ms |
| Windows 10k | 440 | 114.3 ms | 34.1 ms |
| Windows 100k | 444 | 120.9 ms | 33.9 ms |

The mount size is the same at both sizes (roughly 1,200–1,350 nodes; Windows
1,173–1,193), because
the app hands the table only the visible window plus two rows on each side.

## Build times

Cold cache (run 42326304520, no cache existed yet), first step of each job:

| OS | Rust crate | Headless runner | Job total |
| --- | --- | --- | --- |
| macOS 15 | 2 m 23 s | 2 m 33 s | 10 m 51 s |
| Windows 2022 | 3 m 40 s | 3 m 29 s | 13 m 23 s |
| Ubuntu 24.04 | 2 m 40 s | 2 m 25 s | 8 m 15 s |

Warm cache (run 42327687401): Linux 5 m 23 s, macOS 4 m 1 s, Windows 4 m 25 s
per job. Development-host build in that run: Linux 45.9 s, macOS 7.1 s,
Windows 9.8 s.

## Slice 1b

Range selection (`anchor`/`focus` signals, drag, Shift press, Shift arrows)
and desktop-sized runs. Run
[42329776366](https://github.com/nurockplayer/tachiko-sheet/actions/runs/42329776366)
on `6c36a8c`, 2026-11-07 11:33–11:44 JST. Every app opens at 1440 × 900 pt
(`open(".", { width: 1440, height: 900 })`); every test step is
`continue-on-error: true`, so the job is green even when a test fails — the
artifact logs (`nsh-grid-<target>`) are the source below.

### Cases (run 42329776366)

| Case | macOS 15 headless | macOS 15 window | Windows 2022 headless | Windows 2022 window | Ubuntu 24.04 headless | Ubuntu 24.04 window |
| --- | --- | --- | --- | --- | --- | --- |
| G1a — 10k: jump to last | **pass** 5.2 s | **fail** 9.9 s | **pass** 3.2 s | **pass** 3.2 s | **pass** 3.3 s | **fail** 31.0 s (30 s cap) |
| G1b — 100k: jump to last | **pass** 4.1 s | **pass** 8.3 s | **pass** 3.0 s | **pass** 2.2 s | **pass** 3.3 s | **pass** 28.6 s |
| G1c — 10k: scroll sweep | **pass** 1 m 55 s | **pass** 27.6 s | **pass** 41.7 s | **pass** 23.2 s | **pass** 26.7 s | **pass** 38.7 s |
| G1c — 100k: scroll sweep | **pass** 1 m 41 s | **pass** 17.3 s | **pass** 44.3 s | **pass** 23.6 s | **pass** 26.0 s | **pass** 38.5 s |
| G2a — drag selects a range | **not driven by real input** | **pass** 5.6 s | **not driven by real input** | **pass** 1.6 s | **not driven by real input** | **pass** 26.7 s |
| G2b — Shift press extends | **pass** 2.1 s | **not run** (API) | **pass** 1.2 s | **not run** (API) | **pass** 1.2 s | **pass** 27.0 s |
| G2c — Shift arrows / plain arrow | **fail** 9.4 s | **fail** 12.3 s | **fail** 7.4 s | **fail** 10.4 s | **fail** 7.6 s | **fail** 30.2 s (30 s cap) |
| G2d — drag after scrolling | **not driven by real input** | **fail** 10.4 s | **not driven by real input** | **fail** 9.1 s | **not driven by real input** | **not run** (30 s cap) |

The 10k and 100k readings of G2a–G2d are the same in every column (both sizes
run the same file); the run had four steps per OS, headless and window.

Reasons:

- **G2a/G2d headless: not driven by real input.** A headless `app.drag` sends
  no `MouseMove`, so the `grid-wrap` handler never runs and the status line
  stays `range none` (the tests fail their 5 s `waitUntil`; macOS headless G2d
  also crossed the 30 s cap at 38.4–38.7 s). This was expected from the
  source: real windows set `pressed_button` on the moves.
- **G2b in a macOS/Windows window: not run.** `keyboard.down` rejects with
  "holding keys (`keyboard.down` / `keyboard.up`) runs headless and on Linux
  for now". Headless and the Linux window pass with the expected
  `range R2C1:R5C3`, so the Shift press path itself reaches `on_row_press`.
- **G2c: the second check fails everywhere.** The Shift sequence itself is
  correct in all twelve runs (`range R2C1:R4C2`). The following plain `right`
  then gave `range R4C3:R4C3`, because this run's app moved a plain key from
  the focus cell; the brief's expected `range R2C3:R2C3` was wrong too (this
  run's own decision note says so). Corrected in `f9f00c1` to follow Excel —
  a plain arrow moves from the active cell (the anchor) and collapses — and
  G2c now expects `range R2C2:R2C2`; see [Slice 1b fixes](#slice-1b-fixes).
- **G1a/G1b at 10k:** the macOS window run reported `jumped to R9999C29` in
  the status line but the cell text never appeared within the 5 s `waitUntil`
  (rows up to R9988 were mounted); the Linux window run reached the 30 s cap
  at 31.0 s (the same test takes 26–28.6 s at 100k). G1a/G1b at 100k passed in
  all six runs.

### Range text (G2a and G2d)

| OS / size | G2a, scroll 0 | G2d, after `scroll 4800` | Top row vs the estimated true row |
| --- | --- | --- | --- |
| macOS 10k | `range R15C7:R19C10` | `range R17C8:R19C10` | 17 vs ~217 → **~200 rows off** |
| macOS 100k | `range R15C7:R19C10` | `range R17C8:R19C10` | 17 vs ~217 → **~200 rows off** |
| Windows 10k | `range R12C5:R15C7` | `range R12C5:R15C7` | 12 vs ~217 → **~205 rows off** |
| Windows 100k | `range R12C5:R15C7` | `range R12C5:R15C7` | 12 vs ~217 → **~205 rows off** |
| Linux 10k | `range R15C7:R19C9` | not printed (30 s cap) | — |
| Linux 100k | `range R15C7:R19C9` | not printed (30 s cap) | — |
| All headless | `range none` | `range none` | — |

The G2d offset is an app bug, not an NSH gap: `on_visible_rows` never wrote
`first_row`, so `cell_at` always started at row 0 even though the table had
scrolled 4800 pt / 24 pt = 200 rows. On the Linux window runs the cells under
the same scroll were R120C1–R123C15 when the 30 s cap hit, so the table had
scrolled even though the drag had not finished; the macOS/Windows ranges after
the scroll were the same as their G2a ranges. Fixed in `f9f00c1`; the corrected
run reports `first R200C1` and ranges at R211–R218 (see
[Slice 1b fixes](#slice-1b-fixes)).

### Frame-rate readings (`--fps`, 1440 × 900, last sample)

Line format as NSH prints it (`items` is the engine's item count, `rss`/`mem`
the process). Single samples from shared runners running the whole test file.

| OS / size | Reading | Slice 1a (390 × 844) |
| --- | --- | --- |
| Linux 10k | `fps 56/60 frame 4.21/3.30/4.44/93.07 gap 17.23/16.85/17.76/93.68 over 1% … items 0 engine 118% cpu 122% rss 338.7 MB` | `fps 60/60 … items 298 engine 97% cpu 129% rss 299.6 MB` |
| Linux 100k | `fps 54/60 frame 4.55/3.43/4.40/118.39 gap 17.51/16.76/17.83/123.95 over 1% … items 0 engine 120% cpu 124% rss 342.4 MB` | `fps 60/60 … items 301 engine 96% cpu 127% rss 301.5 MB` |
| macOS 10k | `fps 3/60 frame 16.19/3.83/20.95/618.78 gap 35.69/16.68/133.52/660.29 over 13% … items 5415 engine 188% cpu 107% mem 98.3 MB` | `fps 53/60 … items 662 engine 79% cpu 66% mem 55.0 MB` |
| macOS 100k | `fps 9/60 frame 18.33/0.48/23.14/589.73 gap 45.91/16.84/141.47/907.23 over 12% … items 2644 engine 3% cpu 19% mem 91.7 MB` | `fps 45/60 … items 507 engine 98% cpu 154% mem 58.0 MB` |
| Windows 10k | `fps 29/64 frame 13.43/13.05/24.47/42.14 gap 26.04/23.95/47.64/100.58 over 32% … items 3658 engine 36% cpu 37%` | `fps 49/64 … items 131 engine 43% cpu 44% mem 77.7 MB` |
| Windows 100k | `fps 8/64 frame 13.03/13.26/23.81/41.39 gap 31.68/26.83/78.04/410.45 over 31% … items 2057 engine 2% cpu 2%` | `fps 33/64 … items 136 engine 0% cpu 0% mem 78.6 MB` |

These are not like-for-like with slice 1a: the 1440 × 900 window mounts many
more cells, and the same run now also drags for seconds at a time. The macOS
samples are the frames right after a drag (large `frame` maxima, 3 and 9 fps);
the Linux samples are the calmest of the run.

### Commit times (`--trace`, 1440 × 900)

| OS / size | Commits | Max | Mean | Most mount items | Most nodes |
| --- | --- | --- | --- | --- | --- |
| Linux 10k | 41 | 1437.1 ms | 596.1 ms | 10,771 | 3,473 |
| Linux 100k | 42 | 1302.4 ms | 580.0 ms | 10,771 | 3,473 |
| macOS 10k | 46 | 3091.5 ms | 887.9 ms | 12,055 | 3,887 |
| macOS 100k | 45 | 2295.1 ms | 751.7 ms | 12,055 | 3,887 |
| Windows 10k | 86 | 876.3 ms | 347.0 ms | 7,690 | 2,548 |
| Windows 100k | 91 | 626.2 ms | 334.4 ms | 7,690 | 2,548 |

Slice 1a at 390 × 844 was 59–131 ms mean (Linux 59.7/59.0, macOS 131.1/101.6,
Windows 34.1/33.9) with roughly 1,200–1,350 nodes. The desktop window mounts
about 2.5–3× as many nodes and the wide data window (up to 16 scrolling
columns) is the likely cause; these commits include every drag and key step
of the new cases, so they are not a steady-state measurement.

### App code for range selection

`src/lib.rs` +145 / −3 lines (all of slice 1b: the five signals, `cell_at`,
`on_drag`, `on_press`, `move_focus`, `range_text`, the status line, the tint,
`select-b2`, the two table options and the three new handlers);
`App.test.tsx` +68 / −8.

### Gaps

1. **No pointer-down event from DataTable.** The drag has to read
   `on_mouse_move` plus `pressed_button`, so a headless `app.drag` cannot drive
   it (`range none`), and the range starts at the first move, not at the press
   point.
2. **No public scroll offset.** The app reconstructs the cell from
   `on_visible_rows_change`/`on_visible_columns_change` plus fixed geometry
   (24 pt title and rows, 90 pt columns, fixed c0). The 200-row G2d error in
   the slice's first run came from the app never writing `first_row` from that
   range, not from NSH; with that fixed the ranges land on the scrolled rows
   (Slice 1b fixes). `first_col` is taken as the raw
   `VisibleColumnsChange.start` and was not adjusted, so a fixed c0 counted in
   it would shift every column by one in `cell_at`; the runs cannot tell.
3. **The row header is off** (`.row_header(false)`): the app cannot measure the
   row-number column's width, so `cell_at` assumes none and the canary loses
   the row-number press path (`DataTablePress.column` is `Some` for every
   press observed).
4. **A macOS/Windows window has no held-key API**, so G2b cannot run there
   (headless and Linux windows do), and Linux window key presses cost ~27 s
   each, which puts G2c/G2d over the 30 s default cap.

## Findings

1. **A control row wider than the 390 pt surface pushes the status text off
   screen**, so `app.texts()` cannot read it (round 1: every G1a/G1b run that
   executed — ten, all except Linux's window, whose host build failed — failed
   with `cannot read property 'match' of undefined`). The native trace
   showed the text laid out (`Text { id: 25, text: "grid 10000 x 30 last
   R9999C29", content: 192x16 @ 0,0 }`) while `on screen:` listed only
   `"Jump to last", "Commit grid cell"`. Fixed in `8718046` by giving the
   status its own line; G1a/G1b then passed in all twelve runs (six OS × size
   combinations, headless and in a real window).
2. **The 30 s default per-test limit is close to the cost of a scroll sweep.**
   The same test takes 14.7–22.8 s in a real window on all three OSes but
   31.9–34.6 s headless on macOS 15 and 33.9 s in Ubuntu 24.04's window when
   the development host had just been built. Windows headless is 27.1–27.5 s.
   Not changed: the test was kept as briefed and the timeout recorded here.
3. **The Linux development host needs WebKitGTK 6.0 dev packages.** Round 1's
   `nsh test --target linux` failed before opening a window:

   ```
   Package 'libsoup-3.0', required by 'virtual:world', not found
   The system library `libsoup-3.0` required by crate `soup3-sys` was not found.
   error building the development host for Linux failed
   ```

   `libwebkitgtk-6.0-dev` (the package nsh's own Linux CI installs) fixed it
   in `8718046`.
4. **No panics.** No log in either run contains `panicked`.
5. **G1a in the Linux real window takes 26–28.6 s**, against 2–3 s on macOS
   and Windows, and stays under the 30 s limit. Same app, same cases; only
   the GTK host under Xvfb differs.

## Slice 1b fixes

Run [42331173871](https://github.com/nurockplayer/tachiko-sheet/actions/runs/42331173871)
on `f9f00c1`, 2026-11-07 11:50–12:03 JST. It fixes the slice's own bugs and
adds a scroll-only measurement:

- `on_visible_rows` now writes `first_row` (the slice's G2d offset was the app
  never storing the table's top row), and a `grid-first` line (`first R<r>C<c>`)
  exposes it to the tests.
- A plain arrow now moves from the anchor (Excel's active cell) and collapses;
  G2c expects `range R2C2:R2C2`.
- Every test has a 120000 ms limit.
- `NSH_GRID_PLAIN=1` leaves out `render_cell`, so DataTable draws its own cell
  text and the range tint is unavailable. The workflow runs four extra window
  steps per OS — `nsh test --target <t> --filter "G1c" --fps --trace -v` for
  10k and 100k, each with and without `NSH_GRID_PLAIN=1` — so these samples
  contain one scroll sweep and no drag or key press.

### Cases (run 42331173871)

| Case | macOS 15 headless | macOS 15 window | Windows 2022 headless | Windows 2022 window | Ubuntu 24.04 headless | Ubuntu 24.04 window |
| --- | --- | --- | --- | --- | --- | --- |
| G1a — 10k: jump to last | **pass** 5.4 s | **pass** 7.1 s | **pass** 3.8 s | **pass** 3.2 s | **pass** 3.5 s | **pass** 29.9 s |
| G1b — 100k: jump to last | **pass** 3.9 s | **pass** 6.7 s | **pass** 4.0 s | **pass** 2.7 s | **pass** 3.6 s | **pass** 29.0 s |
| G2a — drag selects a range | **not driven by real input** | **pass** 4.8 s | **not driven by real input** | **pass** 1.7 s | **not driven by real input** | **pass** 26.9 s |
| G2b — Shift press extends | **pass** 1.7 s | **not run** (API) | **pass** 1.4 s | **not run** (API) | **pass** 1.3 s | **pass** 26.5 s |
| G2c — Shift arrows / plain arrow | **pass** 4.2 s | **pass** 6.2 s | **pass** 4.4 s | **pass** 4.6 s | **pass** 4.1 s | **pass** 29.4 s |
| G2d — drag after scrolling | **not driven by real input** | **pass** 9.6 s | **not driven by real input** | **pass** 9.9 s | **not driven by real input** | **pass** 32.1 s |

G1a at 10k in the macOS window **did not fail again**: it passed in 7.1 s (the
slice's first run failed the 5 s `waitUntil` there). All six window runs of
G2c and G2d pass. The headless G2a/G2d failures are still "not driven by real
input" (`app.drag` sends no `MouseMove`, so the status line stays `range
none`), and G2b in a macOS/Windows window is still "not run" — `keyboard.down`
rejects with "holding keys … runs headless and on Linux for now". The Linux
window now fits every case inside the 120 s limit (29.0–32.1 s each).

### G2d range and `first_row` (run 42331173871)

| OS / size | G2a, scroll 0 | G2d, after `scroll 4800` | `grid-first` |
| --- | --- | --- | --- |
| macOS 10k | `range R14C7:R18C10` | `range R216C8:R218C10` | `first R200C1` |
| macOS 100k | `range R14C7:R18C10` | `range R193C8:R218C10` | `first R200C1` |
| Windows 10k | `range R11C5:R15C7` | `range R211C5:R215C7` | `first R200C1` |
| Windows 100k | `range R11C5:R15C7` | `range R211C5:R215C7` | `first R200C1` |
| Linux 10k | `range R14C7:R18C9` | `range R214C9:R214C9` | `first R200C1` |
| Linux 100k | `range R14C7:R18C9` | `range R218C9:R218C9` | `first R200C1` |

4800 pt / 24 pt = 200 rows, and every OS reports `first R200C1`. The G2d
ranges start at R211–R218, matching the brief's estimate of a row about 217
for a drag from y = 450. One exception: macOS 100k's anchor is R193C8, seven
rows above the reported top row — the first move landed while the scroll was
still settling (the reported window and the pointer's own frame of reference
do not arrive in the same order).

### Scroll sweeps (one G1c run per log, `--fps --trace`)

Frame rate: median and minimum over all `--fps` samples (the first sample is
printed before the first frame, so it reads `0/60`; the number in parentheses
is the minimum without it). Frame time: the largest p95 and the largest max
across those samples (`frame mean/median/p95/max`, ms). Commits: count, mean
and max from the `--trace` commit lines. Nodes and memory: the largest of
those samples.

| OS / size / cells | fps median | fps min | frame p95 | frame max | commits | mean | max | nodes | peak mem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| macOS 10k, cells | 51 | 0 (13) | 21.57 ms | 687.85 ms | 11 | 1435.6 ms | 2145.8 ms | 3,683 | 107.2 MB |
| macOS 10k, plain | 58.5 | 0 (53) | 36.30 ms | 51.93 ms | 446 | 6.0 ms | 327.4 ms | 2,323 | 71.5 MB |
| macOS 100k, cells | 51.5 | 0 (14) | 26.27 ms | 650.28 ms | 10 | 1579.1 ms | 2113.6 ms | 3,683 | 105.9 MB |
| macOS 100k, plain | 58 | 0 (53) | 35.32 ms | 49.92 ms | 504 | 5.3 ms | 292.0 ms | 2,323 | 72.0 MB |
| Windows 10k, cells | 35 | 25 | 29.14 ms | 55.09 ms | 34 | 686.2 ms | 1025.8 ms | 2,379 | 108.1 MB |
| Windows 10k, plain | 41 | 31 | 21.45 ms | 23.81 ms | 681 | 4.7 ms | 198.1 ms | 1,521 | 89.7 MB |
| Windows 100k, cells | 35 | 26 | 28.94 ms | 52.77 ms | 33 | 697.4 ms | 970.3 ms | 2,379 | 109.7 MB |
| Windows 100k, plain | 42 | 30 | 18.96 ms | 27.61 ms | 690 | 4.5 ms | 196.3 ms | 1,521 | 90.3 MB |
| Linux 10k, cells | 54 | 0 (47) | 5.71 ms | 149.81 ms | 12 | 1174.0 ms | 1475.8 ms | 3,269 | 357.9 MB |
| Linux 10k, plain | 60 | 46 | 29.92 ms | 29.92 ms | 688 | 5.5 ms | 308.4 ms | 2,069 | 316.7 MB |
| Linux 100k, cells | 54 | 0 (47) | 4.57 ms | 194.88 ms | 11 | 1174.0 ms | 1467.1 ms | 3,269 | 356.3 MB |
| Linux 100k, plain | 60 | 46 | 22.56 ms | 24.59 ms | 682 | 5.5 ms | 304.5 ms | 2,069 | 317.1 MB |

Plain beside cells: DataTable's own text commits 446–690 times per sweep at
4.5–6.0 ms each and mounts 1,521–2,323 nodes; the app's per-cell views commit
10–34 times at 686–1,579 ms each and mount 2,379–3,683 nodes. The per-cell
view costs about 100–300× per commit, which is where the desktop frame-rate
samples come from. Frame-rate medians are 51–54 fps with cells against 58–60
with plain on macOS and Linux, and 35 against 41–42 on Windows. (Windows'
`plain` frame max and p95 are lower than macOS's, and both are far below the
cells runs' 650–688 ms maxima.)

These are shared CI runners with no GPU: `gpu 0%` in every sample, and the
numbers include the sweep's own scrolling rather than a user sitting on the
grid. They are not real-user readings. The 10k and 100k readings are within
about 15% of each other.
