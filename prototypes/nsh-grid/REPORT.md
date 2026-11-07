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
