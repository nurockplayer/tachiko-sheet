# #184 table lifecycle repair evidence

This repair batch starts at PR #188 HEAD `69ca1cebcd5b9f4c114d974eb6e08cd0d962ed18`
and implements the lead's three-item disposition:

1. Acknowledged creation remains unsaved when the first table observation or
   summary discovery fails. Refresh retains Close and unload protection.
   Two production-browser regressions lose only real observation replies;
   they never replace core data, fabricate creation success or replay creation.
2. The disposable Add-row entry lives in a presentation-only `tfoot`, outside
   `tbody` and accessible data rows. The Sales lane checks both DOM and
   accessible row counts. Frozen #146 seed files and runners are unchanged.
3. Home's first "Other ways to start" entry is New table, using the existing
   row pattern. Both creation triggers return dialog focus to their initiating
   button. The non-frozen visual assertions now require this new fifth entry
   while retaining all four existing entries and all geometry/focus checks.

The eight screenshots are refreshed from the production `dist` build. The
artifact manifest records JS/CSS and screenshot hashes; `result.json` records
all ten lifecycle groups, actual browser process exits and the independent
saved-byte/core projection oracle.

| Screen | Desktop (1400px) | Compact (800px) |
| --- | --- | --- |
| Home | [home-1400.png](home-1400.png) | [home-800.png](home-800.png) |
| New table dialog | [dialog-1400.png](dialog-1400.png) | [dialog-800.png](dialog-800.png) |
| Expenses with three rows | [table-1400.png](table-1400.png) | [table-800.png](table-800.png) |
| Refused Number draft | [refusal-1400.png](refusal-1400.png) | [refusal-800.png](refusal-800.png) |

## Repair validation

- `pnpm typecheck`: PASS.
- `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit`: PASS, 556 Vitest + 125 Node tests.
- `pnpm build`: PASS, including production acceptance-hook exclusion.
- `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_DIST=dist TABLE_ROWS_SCREENSHOTS=1 TABLE_ROWS_OUT=evidence/184 node tests/product/new-table-rows-local.mjs`: PASS, ten groups, eight screenshots.
- `pnpm acceptance:save-closure` with the supported single-process Chromium
  executable wrapper: PASS, seven prerequisites and eleven current cases.
- `NODE_OPTIONS=--import=/private/tmp/sheet184-repair-validation/appearance-receipt.mjs pnpm acceptance:product`: PASS, 31/31 steps; visual matrix 24 combinations / 24 geometry cases, zero findings.
- `pnpm acceptance:production-lifecycle` with the same wrapper: infrastructure
  BLOCKED (exit 78). The owned browser reached CDP; navigation to the real local
  production HTTP server timed out before Home loaded. No behavioral PASS is
  claimed. The runner recorded fresh build/seed identities and the real failure.

The full product runner uses an out-of-repository `NODE_OPTIONS --import`
observer only to preserve its complete visual JSON before child exit. It
changes no assertion, product code or browser launch. Two initial full runs passed 30/31 steps while the visual lane retained old
Home action-count and keyboard-order assumptions. Those assertions now require
New table first in both empty and returning Home and verify forward/reverse
Tab order while preserving every existing action and geometry check. A
standalone visual attempt was infrastructure-blocked when Chromium closed
during context creation; it earned no PASS. The final full run completes the
24-combination, 24-geometry-case visual matrix with zero findings.

Desktop transport/runtime support is inherited from the original #184 batch;
this repair does not claim a new desktop/package/physical IME qualification.
Lowercased/ASCII-only headers and Yes/No scalar display remain outside this
three-item repair disposition.

## Delivery metadata

The supplied worktree is based at `69ca1ce`; its shared Git metadata still
denies `index.lock`. The repair commit is assembled in writable
`/private/tmp/sheet184-repair-candidate` from byte-identical validated files at
that pushed HEAD, then normally pushed to `codex/184-new-table-rows` without
force. The supplied worktree keeps its source/evidence repairs and the
pre-existing `.serena/project.yml` modification; Serena is excluded from the
candidate. Test-generated shared evidence logs are archived outside the repo.

Complete local receipts/logs: `/private/tmp/sheet184-repair-validation/`.
`validation-results.json`, `product-summary.json` and `visual-summary.json`
record the repair run outcomes. Validation ran on the repaired source before
commit assembly; source hashes in the artifact manifest bind those files to
the delivered bytes. Opus retains hosted checks, fresh independent deep Codex
review and integration. This handback claims no merge, deployment or independent
review, and no production-lifecycle PASS.
