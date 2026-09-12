# Fixed MVP user-task inputs and acceptance script

Owner: ChatGPT Steward under #1/#5. Status: **PREPARED, NOT RUNTIME QUALIFIED**. This supplements `docs/PRODUCT-ACCEPTANCE.md` and the unchanged `acceptance/sheet-foundation` seed; it replaces neither. `scenarios.json` is test input/oracle data, not a production document schema, executable browser suite or proof of full-bundle coverage.

## How to qualify

Start from the normal product New/Open entry. Author the supplied values with ordinary controls; do not inject a hidden fixture to grant a capability the user cannot obtain. Read observations from the real UI and qualified runtime/codec. A test driver may wire controls or inject a bounded fault but may not return the expected values as product observations.

Before the relevant child is Ready, bind these fixed outcomes to concrete executable/manual tests, identify the Accepted semantic/profile and real kit/host prerequisites, and obtain an independent acceptance assessment per DELIVERY.md. Mechanical automation is allowed; changing expected facts, omitting a required case or inventing missing semantics requires Steward reconciliation. Missing bindings are BLOCKED, not behavioral RED. Product PASS requires actual execution and an independent final-head review.

## Six tasks

### J1 — An editable tracker, not a demo table

Create a list with Name, Status and Priority using J1 inputs. Add a visible dropdown limited to Todo/Doing/Done and priority validation 1–5. Apply readable headings/number formatting. Sort priority ascending: 試算, 驗收, 入庫. Filter Todo: 驗收, 入庫. Edit 入庫 to priority 5 while the view is sorted/filtered, proving the intended stable record changed. Try 6 and an unlisted status: canonical values stay unchanged, the draft and useful error remain. Cancel safely; save, fully close/reopen and verify accepted values and rules. Also test append and declared structural edits without silently retargeting another row.

### J2 — Monthly plan, copying and separate sheets

Create expenses 80000, 30000, 10000 and one shared 10% reserve rate. Author a formula using the actual qualified reference profile, then copy/fill it so the expense reference moves and the rate reference stays fixed. Expected reserves: 8000, 3000, 1000; total 12000. Duplicate the sheet and change only its 30000 expense to 35000: new total 12500, original still 12000. A cross-sheet summary is 24500. Save/reopen and verify formula meaning, not cached display alone. Exercise supported values/formulas clipboard behavior and visible invalid/cycle handling. UI addresses are authoring notation, never new canonical identities.

### J3 — Messy external data and an honest exit

Use the raw PEN/NOTE rows as an actual UTF-8 CSV and a separately qualified common-profile XLSX fixture. Select intended text/number types, trim names and preview exact whole-row deduplication. Expected cleaned rows are PEN/3/200 and NOTE/2/500, total 1600. Preserve `0012` when explicitly typed as Text; do not guess the locale of `03/04/2026`. Exercise find/replace, sort/filter and safe export to a new destination. Inspect exported values through the qualified external-format path and verify original input bytes unchanged. Include a real unsupported XLSX construct with an explicit report; reject/preserve rather than silently discard. JSON arithmetic checks do not supply XLSX evidence. Actual external-format files, independent expected contents and a qualified importer/exporter still need preparation for this child.

### J4 — Human-readable cross-sheet summary

Create Catalog and Sales from J4. Bind by visible table/field names using the qualified upstream lookup/grouped-sum capability. Line totals are 600, 1000, 200; grouped totals PEN=800 and NOTE=1000; overall 1800. A missing key and duplicate catalog key produce the actual qualified core diagnostic, never guessed first-match/zero or stale-current success. Save/reopen the definition and recompute. Work #330/#331 retain their existing ownership; an open PR is not an available kit capability. Match the storage version actually supported: ADR-0037 v2 data must not be mislabeled as package-v1 `.ro` output. Record a truthful supported exit route rather than bypassing a codec refusal.

### J5 — A report whose chart is real

Build a readable report and basic chart from J4's current summary. Change PEN price to 250: PEN=1000, NOTE=1000, total=2000, and chart/labels update from authoritative current data. Invalid/unavailable data must not look like a valid empty/stale chart. Produce an actually openable share/export artifact in the declared supported format and inspect it independently; a screenshot existing is not sufficient. No new PDF engine or particular chart library is mandated by this script.

### J6 — Continue work safely

Start with J2's original 12000 total; change the middle expense to 35000 and observe 12500. Test the qualified session Undo/Redo profile (12000 then 12500), save confirmation, complete process exit, fresh runtime admission/recalculation, another edit and another save/reopen. Separately exercise cancel-open, dirty-close, failed save, uncertain Execute and an old/stale reply. Failed save remains unsaved; uncertain execution cannot trigger blind replay; rejected/cancelled Open preserves current work and source. Do not claim rollback after a semantic commit merely because persistence failed. Named history/autosave is not implied; Work #364 retains its own profile gate.

## Cross-cutting observations

Record normal keyboard navigation, selection, edit/cancel/commit, clipboard, focus after every dialog and chart/panel interaction. Test real Chinese/Japanese IME separately from synthetic composition events: composition Enter must not publish. Record an actual accessibility walkthrough and representative workload/device timings for open, edit/recalc, scroll/filter, save/reopen and import/export. Declare actual supported hosts/locales; do not invent latency budgets or certify macOS from Linux/headless results.

Use exact client/core/kit/artifact identities and a case-level result/trace with expected and observed facts. Test faults and observers must not ship as production privileges. Preserve valid original seed evidence; these six scripts do not cover every behavior of the 15 bundles, every fault combination, native-host acceptance or public pilot metrics.

## Preparation check only

```sh
python3 acceptance/mvp-v1/check.py
```

The seven dependency-free checks verify input arithmetic, task IDs, coverage-intent mapping and non-success labeling. They run no Rust, UI, codec, XLSX, persistence, native host or actual user session. A green preparation check must never be counted as any J1–J6 product PASS.
