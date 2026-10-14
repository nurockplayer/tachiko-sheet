# Round-6 bounded repair evidence

Base: `25418b56064d691f7a114b7764fd8f4eed81cf60`. Contract: Opus's [Lead disposition after round 6, item 6 only](https://github.com/nurockplayer/tachiko-sheet/pull/188#issuecomment-6163369653).

One layout effect now reconciles the roving key against each installed projection, including collection changes, history, Refresh and recovery. It retains the prior projection order through a temporarily absent view. A removed target chooses the next surviving row, else the previous row, preserving the column when available. The reconciled row stays mounted in a windowed grid. This effect changes state only. Delete's existing completion-intent/occurrence guard permits focusing the reconciled Tab stop, or the first Add-row field for an empty table. Delete-specific key reconciliation, selection clearing and the row-1 jump are removed. History's existing focus handling is unchanged.

## Regressions against the exact base

The base production build was completed and copied to `/private/tmp/sheet184-round6-validation/base-dist` before production source edits. The identical final regression runner exercised that build and the repaired production build. No core result/projection was fabricated; pending-focus cases delay actual Worker mutation replies.

| Regression | Actual on `25418b5` | Repaired source |
| --- | --- | --- |
| Undo of a focused inserted row | Zero grid Tab stops, expected one; fails both ordinary completion and newer external focus cases. | PASS: previous surviving row, same column, exactly one grid Tab stop. |
| Redo of a delete of the focused row | Zero grid Tab stops, expected one; fails both ordinary completion and newer external focus cases. | PASS: next surviving row, same column, exactly one grid Tab stop. |
| Delete the middle row | Expected next-row/same-column cell has `tabindex=-1`; completion instead jumps to row 1. | PASS: next-row/same-column Tab stop and DOM focus. |
| Delete the only row | First Add-row field is not focused. | PASS: no grid cell remains; first Add-row field is tabbable and focused. |

All four groups independently fail on the base. All **11 variants** pass repaired: ordinary completion; newer Appearance focus for every group; newer surviving-cell focus for each nonempty group. The newer surviving-cell variants already pass on the base. Newer external DOM focus also survives on the base, though Undo/Redo leave the grid without a Tab stop. Neither preservation result is misrepresented as a pre-fix failure. History focus is asserted before roving state: Undo keeps its usable initiator; exhausted Redo keeps the existing desktop Refresh fallback.

Commands (both browser runs use the same final test files):

```sh
# Baseline: expected behavioral FAIL, exit 1, all four groups reproduced.
TACHIKO_TEST_SINGLE_PROCESS=1 WORK_DIST=/private/tmp/sheet184-round6-validation/base-dist TABLE_ROWS_ROUND6_CASE=all TABLE_ROWS_OUT=/private/tmp/sheet184-round6-validation/base-final-regressions2 node tests/product/new-table-rows-local.mjs

# Final: PASS, exit 0, complete existing and new new-table lanes.
TACHIKO_TEST_SINGLE_PROCESS=1 WORK_DIST=dist TABLE_ROWS_OUT=/private/tmp/sheet184-round6-validation/new-table-final2 node tests/product/new-table-rows-local.mjs
```

## Actual validation

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | PASS, exit 0: 36 files, 563 Vitest + 125 Node tests |
| `pnpm build` | PASS, exit 0, including production hook exclusion |
| Complete production new-table lane above | PASS, exit 0: 34 groups, including 11 new focus variants; retained repairs, independent saved-byte/value/stable-ID oracle, full browser termination/restart |
| `git diff --check` | PASS |
| Full `acceptance:product` | NOT RUN, per writer contract; Opus runs it |

The initial focused repaired run, first complete-lane attempt and a focused diagnosis failed overly specific new assertions about exhausted Redo's focus target. Inspection and diagnosis confirmed the existing desktop fallback is Refresh (the compact More control is hidden at this width). Those assertions were corrected; no production change was needed. Final tests also assert that unchanged history behavior on the base before reproducing the roving failure. These earlier attempts earn no PASS.

All 64 checked protected files are byte-identical to the base: frozen #146 seed files/runners, `public/core-kit`, and lockfiles. The existing Serena modification remains excluded. Protected inventory/hashes, base build, full logs and final runner receipt remain at `/private/tmp/sheet184-round6-validation/`. Existing screenshots and earlier evidence are historical and unchanged. No hosted-gate, independent-review, integration or merge result is claimed. Review threads remain open; Opus retains full acceptance, review and integration.
