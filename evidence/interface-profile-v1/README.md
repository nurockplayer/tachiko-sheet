# #68 Interface Profile boundary evidence

The closed boundary retains the approved #71/FES45 v3 role contract. The three
normal-color corrections are link `#5542B5`, reference `#4F54AD`, and header
`#5B6072`, under [the original disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5774025721).
Canonical Figma/source authority, normal geometry/typography, commands,
editor ownership and runtime/storage/report boundaries remain unchanged.

## Current shared primary repair

The independent cbfed47 review found an enabled Create copy label with 1:1
rendered contrast in both forced-color palettes. The header-only repair had
left the shared enabled primary rule incomplete. The [Steward disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5782833344)
and [engineering decision](https://github.com/nurockplayer/tachiko-sheet/pull/75#issuecomment-5788796424)
authorize one coherent repair at the shared rule, without command or UI changes.

Inside forced colors only, `.ts-app .ts-button--primary:not(:disabled)` now uses
the existing product-owned `Highlight` / `HighlightText` background, foreground
and border treatment, `box-shadow: none`, and scoped `forced-color-adjust: none`.
The selector replaces the header-only selector. It has sufficient specificity
and ordering to retain readable system paint in resting, hover and pressed
states. There is no app-wide opt-out. Disabled/destructive/secondary/status
recipes, selected-row repair, editor inputs and focus geometry are unchanged.

`primary-actions-forced-colors-local.mjs` uses real visible product controls and
actual accepted fixtures/parser/exporter journeys. Tight rendered text crops
must contain glyph pixels with at least 4.5:1 contrast against their actual
painted background. Computed color alone is not proof of readability.

### Complete source and state inventory

All eight source consumers are in `src/ui/SheetShell.tsx`; there is no dynamic
primary-class construction. Every row below has four rendered resting samples:
canonical and stress profiles, each in light and dark forced-color palettes.

| Consumer / source line | Enabled state | Actual probe journey |
| --- | --- | --- |
| Save a copy / 836 | Controls unlocked, not saving | Open editable release-plan fixture |
| Apply notes / 1052 | Editable notes, unlocked, dirty bound draft | Edit Decision notes in Brief |
| Commit preview / 1084 | Preview exists, unlocked, witness present | Import real J3 CSV, Preview trim |
| Create cross-table summary / 1177 | Unlocked, not pending, bindings ready | Bind J4 Catalog/Sales fields |
| Export current PNG / 1303 | Unlocked, canvas ready, valid report draft | Create real summary and bar report |
| Create copy / 1429 | Not pending, nonempty name, valid report draft | Open Save modal and enter copy name |
| Import candidate / 1446 | Controls unlocked | Choose real CSV and reach parser modal |
| Download / 1449 | No explicit disabled condition | Prepare actual CSV export confirmation |

All **32 resting samples PASS**, with measured contrast 7.82–11.31:1. Create copy
also passes keyboard focus (light), hover (light/dark) and pressed (light).
Keyboard navigation reaches the real control and its 3px solid outline with
2px gap paints 820 visible outline pixels. Hover and pressed pseudo-states are
asserted; the pressed probe moves away before release and proves no save/write
dispatch or dialog close. `primary-actions-paint.json` retains the measurements.
The full product runner includes this probe in both failure-aggregation paths.

The **current probe fails the immutable cbfed47 acceptance build** at actual
Create copy with 1.00:1 contrast (nonzero exit), after the already-fixed Save
passes. `primary-actions-negative-control.log` retains the expected failure.
This is an implementation regression oracle, not independent final acceptance.

## Tested material and local checks

Base/main: merged #74, `799c42120c3c2a2ae6a4e2ab796b33c1062d9dcc`.
Current repair baseline: reviewed `cbfed47c584b149bd50da96194530d0b20f157a8`.
`source-manifest.json` identifies exact tested implementation/helper contents.
The owning PR records the containing Final Candidate SHA and exact-head hosted
checks/fresh Sol receipt. Luna implementation/source audits and root integration
receive no independent final-review credit.

- `pnpm typecheck`: PASS.
- `pnpm test:unit`: 180 Vitest + 16 Node tests PASS.
- `pnpm build`: PASS, including production acceptance-hook exclusion (66 files).
- `pnpm verify:core-kit`: PASS, same qualified pin and 24 assets.
- `python3 acceptance/mvp-v1/check.py`: seven preparation checks PASS.
- `pnpm acceptance:product`: all 11 steps PASS, including six unchanged M1
  journeys, J3, J4 normal/imported, J5, profile invariants, new primary probe,
  recovery and focus.
- `WORK_DIST=dist pnpm test:visual-foundation`: PASS.
- Current negative control, viewport comparison and protected-control comparison: PASS.

The existing real-kit profile probe again saves an actual J4/J5 report copy,
opens a cell draft and applies a valid manifest changing all 29 public colors.
It proves stable entire shell-subtree/control identity, focus/draft selection,
zero public Work-method and host-write delta, unchanged occurrence/revision,
opaque/saved bytes and presentation attachment, and byte-identical report PNG.
Four actual protected nodes and 24 supplementary CSS recipes remain unchanged.
Forced colors and reduced motion retain precedence. Report PNG SHA-256:
`1cec08cd95325d175aace8c88e8e4423dad233c5c79b94bc613195ba7e76f73a`.
No runtime/storage/report source or accepted fixture changed in this repair.

## Visual and protected-control preservation

The same 12 widths (320, 360, 600, 720, 1023, 1024, 1280, 1440, 1512, 1920,
2560, 3840) and seven states compare current production to reviewed cbfed47:

- All 72 normal-color states are pixel-identical.
- All 12 inherited forced-color states are pixel-identical.
- All 84 retain geometry, fonts, sampled backgrounds and outlines.

This inherited matrix contains the previously repaired header/selected text,
not the newly repaired enabled modal/actions. The separate 32-sample probe
proves those new consumers. `parity-summary.json` records this distinction.
The current capture manifest is byte-identical to the cbfed47 manifest:
`3e54ded116bd1a623d73890ef3ad0e7339a5473ec40f9aa4aa87cc1e5064ff6c`.

Real disabled Create copy, destructive Close without saving, and secondary
Cancel/Keep editing were separately captured on both production builds in
normal, forced-light and forced-dark palettes. All 12 images and their computed
style/geometry properties are identical. `primary-protected-comparison.json`
retains the complete comparison; this proves preservation, not new acceptance
of every disabled/status state.

## Preserved validation history

The earlier [bounded disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5775343376)
repaired Save and selected value/row-number text backplates from reviewed
`87bfd26fbdc6074d3815eec2234d1463b65c114f`. The old-build negative control fails
all four targets at 1:1. The current unchanged profile probe still passes those
16 paint checks (canonical/stress × light/dark), at 11.31:1 light and 8.73:1 dark.
`forced-colors-paint.json` and `forced-colors-negative-control.log` retain them.
`pre-primary-family-parity-summary.json` preserves that repair comparison:
72 identical normal states; 12 forced states changed only within authorized
Save/selected-text rectangles; all 84 geometry/font/outline samples unchanged.

`pre-forced-repair-parity-summary.json` preserves the three canonical-color
comparison to main: 72 approved normal-color deltas, and all 84 states reproduced
baseline when those three colors were restored in test context. Its 12 identical
forced states contained the subsequently repaired defect; they are not current
accessibility PASS. `historical-parity-summary.json` retains earlier history.
No reference cell occurs in the viewport fixture; the isolated reference-role
binding check is supplementary evidence, not a normal product journey.

An earlier completion probe race was repaired by waiting for the real catalog
price header before reading its position. Scenario, cell, assertions and runtime
boundary were unchanged; original failure and passing logs remain in artifacts.
Runtime observation uses public `exportOpaque` for format-2 J4 outside the zero-
Work window; bytes are never decoded or rewritten.

The earlier cbfed47 full local product run, concurrent with capture jobs, timed
out in the unchanged J5 keyboard Remove-report check. Isolated J5, subsequent
full local/hosted runs and the previous independent isolated run passed without
product/assertion/timeout changes. Cause remains unproven. The initial log is
`verification/forced-product-initial-j5-timeout.log`; current sequential full
product validation passes. This history is disclosed, not erased or called a
fixed product defect.

## Artifact and final-gate records

Artifacts remain at `/Users/tachikoma/.codex/artifacts/tachiko-sheet-68`:
immutable `reviewed-cbfed47-{dist,dist-acceptance}`, `primary-family-candidate`,
`primary-protected-{before,after}`, enabled Create copy screenshots, comparison
scripts/results and command logs under `verification/primary-*`. Prior captures,
review receipts and failure logs are preserved. Worker setup corrections are
disclosed in `verification/primary-worker-initial-wiring-notes.log` (narrative
notes, not a complete raw log); root fixed outline sampling bounds and asserted
actual interaction states before the final local run. No scenario was waived.
Only affected tracked evidence is refreshed; unrelated J3 temporary-path log
churn is omitted, with the actual full run retained in the artifact log.

Hosted exact-head checks and a different fresh independent Sol review are
recorded on the PR after Final Candidate declaration. Neither previous finding
author nor a solution consultant is eligible. This document does not pre-approve
review or merge. After a clean protected merge, update #2 and stop before #69
Phase B. No engineering RC, physical IME/AT acceptance or public promotion is
inferred. Canonical #71/#58/#69 Phase A and held PR #40 remain untouched.
