# #184 root-cause batch 3 evidence

This implements Opus's latest **ROOT-CAUSE CHECKPOINT**, decisions (1)–(4),
on PR #188, from `5959e7b3ee11edfa00609281111dca5c0da52a7c`.

| Finding / decision | Change | Before → after production regression |
| --- | --- | --- |
| R3 #2, #3 / (1) | One captured intent/occurrence predicate protects delete selection, roving cell state, deferred DOM focus and RowEntry refusal focus. Existing scalar behavior reuses that predicate. Drafts and error messages remain available. | Hold real delete reply, focus a surviving cell, release → its selection/focus remains. Hold real invalid-Number refusal, focus Appearance, release → error/draft remain without stealing focus. `R2`, `R3`: FAIL → PASS. |
| R3 #4 / (2) | Record Sales opening occurrence/revision. Completed publication observation and coherent Refresh use one revision comparison to update initial/change markers for row, scalar and history paths; equivalent confirmed per-path updates are removed. | Lose real insert acknowledgement → Refresh → one inserted row and Edited/Updated markers. Lose real scalar acknowledgement → Refresh → exact changed value and Edited/Updated markers, without replay. `R4-row`, `R4-scalar`: FAIL → PASS. Unknown Undo additionally verifies the same boundary (`R4-history`, supplemental PASS on both versions). |
| R3 #1 / (3) | The runtime observes the real occurrence immediately before creation; only authoritative no-project permits dispatch. Recovery retains the requested trimmed title and normalized column keys/types, admitting only a matching coherent native table. Mismatch uses the existing unknown-open gate. | Lose Close dispatch with `Old` resident, then prepare a creation whose real duplicate-header refusal would be lost → reload refusal and **zero new creation dispatches**. Separately, lose a successful creation reply, replace it through the real core with a differently titled table, Refresh → projection stays hidden/protected, without replay. `R1-resident`, `R1-identity`: FAIL → PASS. |
| Connector default-name finding / (4) | Defaults are the next unused spreadsheet letter, compared case-insensitively. The dialog gives the current #525 name-limit hint and checks table/column name syntax before dispatch. Trusted core refusals remain visible. | Name-only creation with default A succeeds; A/B/C → remove B → add gives A/C/B and creates without header repair. Invalid table/column names show field errors before any command. `defaults`, `constraints`: FAIL → PASS. |

[Before/after receipt](regression-results.json) retains real request/reply
observations and each failing assertion. The production build used for baseline
proof was made while w184's production source was unchanged at `5959e7b`, then
snapshotted before repair. An exact-base temporary clone retains the original
source. The final same-harness run reproduces all five findings behaviorally;
setup failures earn no regression credit. The harness only delays/loses actual
replies or Close dispatch, or sends real core commands for the identity probe.
It manufactures no success, refusal, projection or no-work reply.

The complete production new-table lane passes **25 groups**, including all
nine batch-3 cases, the six batch-2 cases, independent saved-byte/all-field/ID
oracles and full browser process exit/restart. Batch-2 draft/default tests now
use A and require real creation with untouched default headers.
[Lane receipt](result.json), [source/artifact/frozen-file hashes](artifact-manifest.json).

All eight screenshots were recaptured from the repaired production build:

| Screen | Desktop (1400px) | Compact (800px) |
| --- | --- | --- |
| Home | [home-1400.png](home-1400.png) | [home-800.png](home-800.png) |
| New table dialog with name-limit hint | [dialog-1400.png](dialog-1400.png) | [dialog-800.png](dialog-800.png) |
| Expenses with three rows | [table-1400.png](table-1400.png) | [table-800.png](table-800.png) |
| Refused Number draft | [refusal-1400.png](refusal-1400.png) | [refusal-800.png](refusal-800.png) |

## Actual validation

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS, exit 0 |
| `TACHIKO_TEST_SINGLE_PROCESS=1 pnpm test:unit` | PASS, 558 Vitest + 125 Node, exit 0 |
| `pnpm build` | PASS, production hook exclusion included, exit 0 |
| Production new-table lane, screenshots enabled | PASS, 25 groups / 8 screenshots, exit 0 |
| Full `pnpm acceptance:product` | **FAIL, exit 1: 22/31 steps PASS; nine infrastructure failures. No full-gate PASS.** |

The full runner attempted every step. Chromium launch or context creation
failed in `appearance-visual-local`, `home-visual-local`,
`initial-launch-local-transport`, `cell-editing-regression`,
`import-recognizable-local`, `browser-m1`, `browser-recovery-regression`,
`browser-initial-launch-regression` and `product-focus`. Logs report
`Target page, context or browser has been closed`; some launch failures also
report SIGABRT. Required behavior in those steps did not complete. The complete
visual matrix did not emit a current receipt; [visual status](visual-summary.json)
is BLOCKED. No earlier visual PASS is reused.

[Exact commands/results and disclosed earlier attempts](validation-results.json),
[full product step receipt](product-summary.json). Complete logs and archived
shared evidence: `/private/tmp/sheet184-repair3-validation/`.
The unmodified product runner used its supported single-process fallback.
An out-of-repository console observer only preserves a complete visual JSON if
one is emitted; it changes no assertions or launch behavior. A separate supported
full-Chrome probe failed in both normal and single-process modes; no full rerun
or test weakening follows from that infrastructure failure.

All 62 recorded core-kit/lock/frozen-acceptance files are byte-identical to the
base. Frozen #146 seeds/runners, public/core-kit and lockfiles are unchanged.
Serena's existing local modification is preserved and excluded. Desktop/package
qualification is inherited; no new native, physical IME or complete visual
qualification is claimed. Opus retains hosted gates, fresh independent
exact-HEAD review and integration. Review threads remain open. No merge or
independent approval is claimed.

Worktree metadata denied `index.lock`. The same 24 source/evidence files were
verified byte-identical and committed from `/private/tmp/sheet184-repair3-candidate`
at the exact `5959e7b` parent, for a normal non-force push. w184 retains the tested
repairs at metadata HEAD `5959e7b`; its existing Serena modification is excluded.
