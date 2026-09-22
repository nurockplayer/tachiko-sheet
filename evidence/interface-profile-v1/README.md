# #68 Interface Profile boundary evidence

The closed boundary retains the approved #71/FES45 v3 role contract. The three
normal-color corrections are link `#5542B5`, reference `#4F54AD`, and header
`#5B6072`, under [the original disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5774025721).
A [subsequent bounded disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5775343376)
authorizes the forced-colors Save label and selected-row text/backplate repair.
Canonical Figma/source authority, normal geometry/typography, commands,
editor ownership and runtime/storage/report boundaries remain unchanged.

## Repair and rendered regression

The previous independent review found invisible Save and selected-row text on
`87bfd26fbdc6074d3815eec2234d1463b65c114f`. Browser-generated text backplates and
automatic forced-color painting defeated otherwise plausible computed colors.
The white row rectangles were non-editing value text backplates, not inputs.
The repair uses the product-owned `Highlight` / `HighlightText` system pair and
narrow forced-color adjustment opt-outs for enabled header Save, selected value
spans and row-number text. Editor inputs, disabled/destructive/status recipes,
non-color semantic cues and the focus outline are outside the repair.

A rendered pixel regression checks actual Save/value/header text paint. Its
negative control runs the new probe against the preserved old acceptance build.
Computed style alone is not considered proof of readable glyphs.

The negative control fails all four targets at 1:1 contrast on the old build.
The repaired build passes Save, focused/nonfocused selected values and row number
under canonical and stress profiles, each with light and dark forced-color
preferences (16 checks). Measured text/background contrast is 11.31:1 (light)
and 8.73:1 (dark). `forced-colors-paint.json` retains pixel counts/crops;
`forced-colors-negative-control.log` retains the expected old-build failure.

## Tested material and local checks

Baseline: merged #74, `799c42120c3c2a2ae6a4e2ab796b33c1062d9dcc`.
Resumed forced-colors repair checkpoint: `87bfd26fbdc6074d3815eec2234d1463b65c114f`.
`source-manifest.json` identifies exact tested implementation/evidence-helper
contents. The owning #68/PR records the containing Final Candidate commit and
subsequent hosted checks/fresh independent Sol receipt. Luna implementation and
WIP audits and the separate Sol consultation receive no final-review credit.

- `pnpm typecheck`: PASS.
- Focused UI units: 127 PASS after the repair; `pnpm test:unit`: 179 Vitest + 16 Node PASS.
- `pnpm build`: PASS, including production acceptance-hook exclusion (66 files).
- Focused real-kit profile probe and `pnpm acceptance:product`: PASS, including
  unchanged six M1 journeys, J3, J4 normal/imported, J5, recovery and focus.
- `WORK_DIST=dist pnpm test:visual-foundation`: PASS.
- Core pin/assets unchanged; prior qualified provenance check passed (24 assets).

The real-kit probe saves an actual J4/J5 report copy, opens a cell draft and
applies a valid manifest changing all 29 public colors. It proves stable entire
shell-subtree/control identity, focus/draft selection, zero public Work-method
and host-write delta, unchanged occurrence/revision/opaque bytes/saved bytes and
presentation attachment, and byte-identical report PNG. Four actual protected
nodes and 24 supplementary CSS recipes remain unchanged. Forced colors and
reduced motion retain precedence. PNG SHA-256:
`1cec08cd95325d175aace8c88e8e4423dad233c5c79b94bc613195ba7e76f73a`.

The completion regression exposed an asynchronous table-selection probe race.
The repaired probe waits for the real catalog price header before reading its
position; the scenario, cell, assertions and runtime boundary are unchanged.
The original failure and subsequent focused/full passing logs are retained.
Runtime observation uses public `exportOpaque` for the real format-2 J4 project;
observations stay outside the zero-Work window. No bytes are decoded or rewritten.

## Approved-delta visual evidence

The same 12 widths (320, 360, 600, 720, 1023, 1024, 1280, 1440, 1512, 1920,
2560, 3840) and seven states compare the repair to reviewed `87bfd26`:

- All 72 normal-color states remain pixel-identical.
- All 12 forced-colors states change only within the authorized enabled Save,
  selected value and row-number rectangles (one-pixel paint outset).
- All 84 states retain the sampled geometry, fonts, cell backgrounds and outlines.

`parity-summary.json` records this repair comparison and artifact hashes.
`pre-forced-repair-parity-summary.json` preserves the earlier three-color-only
comparison to main. That historical comparison showed 72 approved normal-color
consumer deltas, and all 84 states reproduced baseline when those three colors
were restored in test context. Its 12 identical forced-color states contained
the now-repaired accessibility defect; they are not current accessibility PASS.
`historical-parity-summary.json` retains the earlier pre-disposition history.
No reference cell occurs in the viewport fixture; the previous isolated browser
reference-role binding check is supplementary evidence, not a normal journey.

Artifacts, immutable previous production/acceptance builds, captures and scripts
remain at `/Users/tachikoma/.codex/artifacts/tachiko-sheet-68`. The repair capture
set is `forced-repair-candidate`, with `forced-repair-comparison.json`. Current
runner logs are in `evidence/product-acceptance`; detailed command logs are under
`verification/forced-*` in the artifact root.

The first full local product run, concurrent with capture jobs, timed out in the
unchanged J5 keyboard Remove-report check. The isolated J5 run and subsequent
full product run passed without changing product code, assertions or timeouts.
The initial failure is retained as `verification/forced-product-initial-j5-timeout.log`;
its exact cause is not proven. It is disclosed for independent review, not erased
or claimed as a fixed product defect.

## Remaining final gates

Hosted exact-head checks and a different fresh independent Sol review are
recorded on the owning PR after Final Candidate declaration. The previous
reviewer is ineligible. This document does not pre-approve review or claim merge.
After a clean protected merge, update #2 and stop before #69 Phase B per the
latest user/Steward instruction. No engineering RC, physical IME/AT acceptance
or production promotion is inferred. Held #40 remains untouched.
