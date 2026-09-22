# J3 interop acceptance preparation — Sheet #17

Owner: ChatGPT Steward. Parent: #5. **PREPARED, NOT RUNTIME QUALIFIED; NOT PRODUCTION READY.** The fixed whole-J3 oracle remains `../mvp-v1/scenarios.json` and its README. This seed supplements them, never changes the 1600 calculation or the original clean PEN/NOTE result.

## Included executable evidence, and its limit

- Four immutable independent inputs in `fixtures/`, SHA-256 and authorship in `corpus.json`. Both XLSX files were generated independently with artifact_tool, not by Tachiko. All three common-input columns are source text; typing into Number is an explicit import choice. The second XLSX also contains an actual `mergeCells A1:B1` in `MergedNote`, not a fabricated fidelity ledger.
- `python3 acceptance/j3-interop/check.py`: dependency-free corpus byte/content check, including a narrow test-only OOXML reader and fixed-oracle crosscheck when the full repository is present. It performs **no runtime/UI/host test**.
- `node tests/qualification/j3-import-clean-export.mjs`: actual pinned kit/Worker/WASM candidate probe using the existing locked Playwright dependency. It exercises CSV and independent XLSX ingress, exact typed fields, nonmutating inspection, atomic bad-typing rejection, trim/dedup previews and values, both real exporters, independent file-content verification, codec-only reopen with stable targets, stale-preview rejection and Text sentinels. It prints the actual unsupported-content ledger. Missing tooling/pin/unsupported-case qualification is not a product RED or PASS.
- `python3 acceptance/j3-interop/check.py --export /absolute/path/output.xlsx` (or `.csv`): independently checks a real export against fixed headers, PEN/NOTE values and expected stored types. This test-only parser must never enter the application bundle. It is intentionally bounded to this corpus, not a new general spreadsheet implementation.

The kit probe creates core-native setup occurrences directly. **It is not normal user entry, UI validation, durable local-copy Save, actual browser-process restart or full J3.** It uses no mock calculation, imported expected-result document, invented publication or frontend cleanup semantics. Keep producer-generated projection/metadata identifiers distinct; native source pin and manifest must match before running.

## Qualification commands

From a complete checkout of the eventual #17 PR, with repository-locked dependencies and the real checked-in kit:

```sh
python3 acceptance/j3-interop/check.py
node --check tests/qualification/j3-import-clean-export.mjs
node tests/qualification/j3-import-clean-export.mjs
```

Use existing `verify:core-kit`, preparation, typecheck/unit/build, M1/product and visual-regression commands as applicable. Do not change the lock or add a second dependency manager merely to run this seed. `WORK_CHROMIUM` may point to a real supported executable. No missing-driver run may be renamed behavioral RED.

The merged-note fixture is a **candidate negative case**, not an assertion that the producer currently supports or rejectss it. Require an actual construct-specific safe-disabled/loss report, or prove genuine preservation and return a better independently evidenced unsupported case to Steward. A missing ledger or parser setup error does not qualify the negative case. Material changes to expected outcomes/fixture purpose remain Steward-owned.

## Whole bounded-child acceptance mapping

Before Ready, bind the following fixed cases to executable tests and/or the explicitly recorded manual boundaries below, then obtain independent adequacy review. The kit script is only the supporting portion named in the second column. Mechanical control/observer wiring is allowed, but not substitute oracles, omitted negatives or artificial frontend validity.

| Case | Prepared kit portion | Required real product/host observation before final PASS |
|---|---|---|
| J3-I01 CSV and independent XLSX ingress | Both file formats, source text and typed values | Home/Workbook import entry, visible preview, explicit Text/Number choice, actual imported cells; no hidden fixture installation |
| J3-I02 cancel/reject/preserve | Nonmutating inspect; failed Number admission retains old occurrence and bytes | Cancel chooser/preview; refuse dirty replacement; invalid typing keeps current unsaved work/copies and useful error context |
| J3-I03 preview/trim/dedup | Exact trim target set, one actual duplicate removal, fixed final stored values; preview nonmutation | Human selects actual fields, sees affected targets, cancels without publication, then explicitly commits; no silently retargeted sorted/visible records |
| J3-I04 stale cleanup | Actual intervening edit then rejected old preview with canonical bytes preserved | Visible stale/re-preview feedback, no retry-as-new-command, accepted intervening edit retained |
| J3-I05 source-preserving exit | Real CSV/XLSX bytes checked independently; exporter revision/ledger logged | User obtains new downloadable files, reviews any loss before consent; cancel/host failure does not claim success or overwrite source |
| J3-I06 unsupported content | Independent OOXML merge bytes; actual producer disposition still unqualified | Construct/location-specific explanation; safe cancel or explicitly supported treatment, original bytes retained; cannot substitute an unrelated warning |
| J3-I07 Text/date sentinels | Explicit Text keeps `0012` and `03/04/2026` | Same visible import choices/values and later reopened/exported facts; no browser locale guessing |
| J3-I08 save/restart/continue | **Codec-only** reopen of cleaned stored values/identities | Real local copy, completely terminate browser process, new occurrence/runtime, reopen and export again with qualified metadata; failed Save remains unsaved, no imaginary semantic rollback |
| J3-I09 interaction/trust | Not supplied by this kit script | Keyboard focus/cancel/commit, changed-control real CJK IME/accessibility, honest busy/currentness; M1/Visual Foundation regression, acceptance-hook exclusion |

Real browser/host cases remain a preparation requirement; this mapping is not an execution log. Use actual normal controls and existing observation/fault hooks; any new observer reads the production runtime/host only and must be excluded from the release build. Do not call a privileged setup operation through an observer to pass normal-entry acceptance. Reuse qualified unaffected manual evidence with its exact provenance; do not fabricate new runs.

## Delivery and continuation

Keep one coherent #17 PR: qualify this seed, complete mechanical normal-product/host binding, independently assess the full bounded contract, record Ready under `docs/DELIVERY.md`, then implement the actual user workflow with unit tests on the same PR. Never merge this as a stand-alone preflight micro-PR and then create a second implementation PR.

Astra remains the single lead/integrator. The preparation author is not an independent reviewer. Fresh exact-final-head Guarded review must be independent of both implementation and acceptance/evidence authorship. Keep upstream #315/#373 and all other producer owners separate; never solve a missing Rust behavior with React validation or a client codec.

#5 still owns ordinary active-table find/replace (#319 upstream), clipboard/paste, sort/filter, fixed authoritative total 1600, broader cleanup and all complete J1–J6/15-bundle/platform evidence. #17 closes only its declared coherent subjourney. #13 stays completed; #16 physical QA and #7 packaged macOS remain RC/support gates rather than blanket implementation-start blockers.

## Actual preparation-session results

2026-09-13 JST, ChatGPT container: four input files created; independent ZIP/XML/CSV content and hash checks passed; Node parse check passed; the runner's missing-checkout/kit path exited 78 (`BLOCKED`) as intended. The full-repository fixed-scenario crosscheck was unavailable in the partial local staging directory; the expected raw/clean/sentinel facts were transcribed from the live unchanged source. Independent oracle positive/negative control results are recorded in the PR handoff.

GitHub connector reads/writes are available, but local GitHub clone failed DNS and the Codex workspace connector returned a connection error. **No Rust/WASM/browser run, app/host test, physical-device test, independent adequacy review, Ready or merge is claimed by this session.** Hosted baseline CI, if it runs automatically, does not execute the new standalone probe unless explicitly wired/executed; it must not be mislabeled J3 qualification.
