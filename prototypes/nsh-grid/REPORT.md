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
  then gives `range R4C3:R4C3`, not the expected `range R2C3:R2C3`, because the
  focus cell is R4C2 when it is collapsed. The Linux window run hit the 30 s
  test cap (three key presses cost ~27 s each there) but its screen dump shows
  the same `range R4C3:R4C3`. Kept as briefed; see the decision note in the
  handoff.
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

The G2d offset error is the scroll itself: 4800 pt / 24 pt = 200 rows, and the
reported range is 200–205 rows above the brief's estimate (~217) for a drag
starting at y = 450. On the Linux window runs the cells under the same scroll
were R120C1–R123C15 when the 30 s cap hit, so the table had scrolled even
though the drag had not finished; the macOS/Windows ranges after the scroll
are the same as their G2a ranges.

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
   (24 pt title and rows, 90 pt columns, fixed c0). The 200-row G2d error is
   what that costs when the table scrolls: the app's window and the pointer
   position do not line up. `first_col` is taken as the raw
   `VisibleColumnsChange.start` and was not adjusted, so a fixed c0 counted in
   it would shift every column by one in `cell_at`; the run cannot tell.
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
