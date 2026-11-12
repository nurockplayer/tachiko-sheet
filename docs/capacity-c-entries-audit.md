# Capacity C request audit

Source: Tachiko Work **5f2b0718**, read with `git show`, and Sheet's
pre-change `src/runtime/session.ts` on `lead/capacity-c-entries`.
All Work line references below are at that pin, not the current Work checkout.
This is source analysis; it is not an execution receipt.

## Entries and admission

Work `packages/browser-client/runtime/src/lib.rs:8380–8400` creates a native
new table under the requested profile and returns `opened_window` rather than
`opened`. `:8428` / `:8650–8670` admit canonical working-size opens;
`:8549–8577` do the same for portable `.ro`. These use
`from_document_working_size` (`:3014`, `:3045–3065`) and bounded opening
windows (`:3277–3328`). There is no Tracker/Budget exclusion: the existing
Tracker and Budget documents are admitted if they satisfy these bounds;
Tracker windows retain `tracker_profile` (`:4406`, recognition at `:9603`).
Budget is not the stock Tracker shape. No profile-specific refusal code is
introduced for either template. Invalid/over-limit documents still refuse
before replacement. New table creates a native table, not a Tracker or Budget
template (`:7138–7195`).

`capacity.rs:36–45` sets working limits to 10,000 table rows / total entities,
100,000 populated cells and formulas, and 1,000,000 AST nodes / edges.
The profile is occurrence state, not restored from saved bytes (`:48–55`).

## Session requests with different behavior

Sheet line numbers below refer to the pre-change session.

| Sheet request and line | Work behavior at the pin | Existing Sheet handling |
| --- | --- | --- |
| `newTable` 651; `openProject` 664, 679, 713; `openPortableRo` 693 | Working-size variants return `opened_window`, not `opened` (`lib.rs:8380–8400`, `:8428`, `:8549`). | `openSession:585` ignores the reply and loads a coherent view. This change widens only the internal callback return type and selects the explicit capability. |
| `queryTable` 389 | Above 1,000 rows returns `use_window_query` for every profile (`:4194–4210`); working complete projections have a 16 MiB bound (`:4213–4227`). | Already catches that refusal and assembles revision-pinned windows (`session.ts:389–429`). |
| `queryTableWindow` 400, 537, 968 | At most 256 rows (`:4370`); working windows have a 16 MiB budget (`:8960`), may return fewer rows and `byte_limited` instead of refusing (`:5118`). | Already advances by actual returned rows and verifies revision, columns, counts, totals and progress. Zero-row windows read metadata/totals. |
| `queryCapacity` 911 | Reports occurrence-specific limits and usage (`:7041–7060`, `working_size_tests.rs:698`). | Already checks revision and returns the projection. |
| Scalar edits 489–497; `trackerCommand` 1018–1099, 1184; constraints/format/copy 1056–1070; `duplicateCollection` 1115; `createKeyedGroupedSum` 1330 | Working publications add `changed` or the `many` marker (`:3331–3364`); candidate admission uses working limits and saved-size bound (`:6709–6748`). Edit/paste/copy and removal bounds increase (`:7043`, `:7671`). | #368 patches disposable rows only when safe, otherwise reloads. History, duplication and keyed creation already reload and validate the receipt. UI limits stay unchanged. |
| `trackerCommand` undo/redo 1184 | Keeps at most 64 entries, additionally evicts oldest working history above 128 MiB (`:2210`, `:7337–7358`); settled internal lifecycle records are pruned (`:6981–6987`). | Reloads after history operations. No session API exposes settled lifecycle records. The byte bound can shorten history for large working documents; it is a runtime policy difference, not a promise of 64 undos at working size. |
| `exportCanonicalTree` 1246, `exportProjectV3` 1263, `exportPortableRo` 1275 | Re-admit saved bytes under the resident working profile (`:4067–4158`). Working edits preflight saved size (`capacity.rs:57–95`). | Already validates revision and retains opaque producer bytes; no ordinary-profile re-encoding. Portable verify before open remains read-only. |

All newly admitted working candidates also enforce a 32 MiB document-wide
stored-text budget (`lib.rs:131`, `:10373`) and a conservative saved-byte bound
of 63 MiB (`capacity.rs:57–95`). Per-item string bounds stay shared
(`lib.rs:10445–10450`, `:10591`). These are explicit refusals, not truncation.

## Requested reads that keep their response type

- Group totals (`session.ts:810`): same groups/result or named refusal;
  Work `lib.rs:4950–5069` still caps 200 groups and 64 KiB. Sheet already maps
  `group_limit_exceeded` and `result_size_exceeded` to refusal outcomes.
- Keyed sums (`session.ts:1296,1308`): same authorized query and projection
  (`lib.rs:3898–3948`); no profile refusal. Creation's publication gets
  `changed`, as above.
- Chart reads: session column totals (`:784`) and grouped totals (`:810`)
  retain their shapes. Column totals use the same aggregation (`lib.rs:4800`,
  `:4855`); wider wire budgets do not require another query API.
- Find and distinct values: there are no `client.findInView` or
  `client.queryDistinctValues` calls in `session.ts`. Work's requests
  (`lib.rs:4460`, `:4558`) retain their response types and view/revision
  semantics; their wire reply budget grows (`:8988–8995`). No new window
  alternative or profile-specific refusal is required.
- `observeOccurrence`, `bootstrap`, `queryFields`, formula translation,
  spreadsheet inspection/import/export, cleanup preview/commit and Close
  retain their request/reply contracts. Field queries still cap 1,024 targets
  and 64 KiB (`lib.rs:125`, `:5236`).

Spreadsheet import (`session.ts:1389`), imported-metadata opaque reopen
(`:704–713`) and imported-project validation (`:1524`) keep their ordinary
methods. CSV/XLSX export and UI limits are outside this change.
