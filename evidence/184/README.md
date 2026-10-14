# #184 table lifecycle evidence

New table, Add row and Delete row use the intact pinned public core kit. The
adapter shares the existing serialized confirmed-publication/read/recovery
path with cell edits; creation shares the existing occurrence replacement path.
No frontend document engine, defaults, row-history payloads or storage codec
were added. The entry row is a disposable, occurrence/collection-bound draft.
An uncertain insertion requires review and clearing before another Add.

## Production browser evidence

The screenshots below were captured from `pnpm build` (`dist`), not the dev
server or an acceptance mock. `artifact-manifest.json` binds their bytes to
that build's JS/CSS. `result.json` retains the actual process-exit receipts and
independent fixed-value/core projection comparison.

| Screen | Desktop (1400px) | Compact (800px) |
| --- | --- | --- |
| Home | [home-1400.png](home-1400.png) | [home-800.png](home-800.png) |
| New table dialog | [dialog-1400.png](dialog-1400.png) | [dialog-800.png](dialog-800.png) |
| Expenses with three rows | [table-1400.png](table-1400.png) | [table-800.png](table-800.png) |
| Refused Number draft | [refusal-1400.png](refusal-1400.png) | [refusal-800.png](refusal-800.png) |

The normal-UI lane covers empty/duplicate creation refusals; three explicit
inserts; scalar edit; delete/Undo/Redo/Undo with exact ID/value restoration;
invalid and empty Number refusals with unchanged core projection and retained
field inputs; Save guard for unfinished rows; explicit Yes/No and IME-safe
Enter; Save/full browser process exit/same-profile Home/reopen; independent
all-field comparison using a separate public client; Download/Open `.ro`;
Date blank refusal and explicit input/opaque Save/reopen. The observer only
copies actual public Worker replies. It supplies no success or calculation.
Synthetic composition evidence is not a physical IME claim. A held Enter does
not submit repeated rows. Controlled lost-reply evidence verifies that Refresh
reads the actually published row once, retains its draft, and changing that
draft cannot unlock another Add until explicit Clear. Compact grids
retain the existing horizontal-scroll behavior.

## Availability and desktop

Availability uses the authoritative public `native_table_profile` flag.
New tables and reopened native tables accept the commands. The current Sales
example's Catalog and Sales collections also accept insert/delete; their UI
row lifecycle and history were verified. CSV import, Release plan and tracker
refuse generic native-table row commands. Their row controls are unavailable
with a reason. No command is dispatched just to discover capability.

Desktop exposes the same UI. The unchanged native channel forwards `new_table`,
`insert_row` and `remove_table_rows`; differential WASM/native-host evidence
verifies create with all four scalar types, insert/delete/Undo/Redo, opaque
export/reopen with exact fields/IDs, and existing mixed-import scenarios. Date
uses the existing opaque Save path because canonical export refuses Date.
This evidence does not claim a packaged-app or physical macOS/IME walkthrough.

## Commands and results

- `pnpm typecheck`: PASS.
- `pnpm test`: PASS, unchanged 30-test seed harness.
- `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit`: PASS, 554 Vitest + 125 Node tests.
- `pnpm build`: PASS; production acceptance-hook exclusion PASS.
- `TACHIKO_TEST_SINGLE_PROCESS=1 WORK_DIST=dist TABLE_ROWS_SCREENSHOTS=1 TABLE_ROWS_OUT=evidence/184 node tests/product/new-table-rows-local.mjs`: PASS, eight lifecycle groups and eight screenshots.
- `NODE_OPTIONS='--import=/private/tmp/sheet184-appearance-receipt.mjs' pnpm acceptance:product`: PASS, 31/31 steps; the preload only preserves the complete visual result before child exit, with unchanged launch/assertions. Visual matrix PASS, zero findings.
- `pnpm build:desktop`: PASS; Worker/WASM and acceptance-hook exclusion PASS.
- `pnpm exec vitest run tests/desktop/native-parity.test.ts`: PASS, 2/2 with the real native frame harness built by `pnpm test:desktop-parity`.

The initial plain `pnpm test:unit` failed at Chromium launch because the macOS
sandbox denied its Mach-port rendezvous; the supported single-process run
passed. The initial native qualification attempted canonical export of a Date
table and was refused; it was corrected to the existing opaque carrier and
passed. The first full product regression run found narrow Sales overflow, a
save-reminder layout shift and an extra Home fixed-list row; source repairs
preserve the existing assertions and frozen acceptance files. Final root-cause
repairs scope row-toolbar spacing, retain the Home popover header anchor, keep
controls in the existing scroll owner, and contain the hidden Results
announcement so it cannot extend the document.

## Delivery metadata

The supplied worktree's shared Git metadata refuses `index.lock` creation in
this sandbox. Candidate commits are therefore assembled in the writable
`/private/tmp/sheet184-delivery-candidate` checkout from identical validated
files at the authorized base. The requested remote branch is
`codex/184-new-table-rows`. The original worktree retains its source changes at
base `147b8f2`; Opus must reconcile its local Git metadata with the pushed
candidate. Its pre-existing `.serena/project.yml` modification is preserved and
excluded from the candidate.

Opus retains integration and fresh deep independent Codex-review ownership.
No merge, deployment or review-thread disposition is claimed. No new product
or semantic decision is open; column evolution/order remains outside #184.
