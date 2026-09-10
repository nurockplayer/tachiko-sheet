# First spreadsheet product acceptance

Owner: #5 under #1. Intake: tachiko-work #256 and #261 on 2026-09-10 JST. This is a scope/coverage map, not executed release evidence or an alternate semantic contract. Later scope changes need explicit reconciliation.

## Fifteen bundles

Track core support, consumer-kit exposure, Sheet UI, Web/macOS result, fixture/test path, exact artifact and remaining owner separately for each:

1. Create/open/save/update/reopen, dirty state, undo/redo and recovery.
2. Grid navigation/selection/go-to/retrieval, find/replace and useful large-sheet navigation.
3. Direct/multi-cell editing and declared structural row/column/range operations.
4. Clipboard interoperability and declared values/formulas/formats behavior.
5. Fill/copy/series and relative/fixed reference semantics.
6. Multiple sheets: lifecycle, navigation, independent data duplication and cross-sheet references.
7. Text, finite Number, Boolean, Date/Time, Currency, Percentage and declared locale behavior.
8. Basic emphasis/alignment/wrapping/borders/fills/dimensions/freeze/hide in the declared profile.
9. Formula/reference/recalculation profile, common bounded functions, visible errors/cycles.
10. Deterministic sort/filter across declared value/error/blank cases.
11. Native structured tables, headers/columns/append/totals/range growth.
12. User-authored data validation and dropdowns, with core enforcement.
13. CSV and common-profile XLSX input/output with complete unsupported/loss reporting.
14. Basic cleanup: trim/split/replace, conversion, deduplication and missing values.
15. Basic charts and readable reporting.

A UI control, imported fixture or old Designer capability is not evidence that a normal Sheet user can complete the task. Do not silently narrow a missing bundle to make the matrix green. Evidence-based profile amendments are Steward-owned.

## Six integrated journeys

| Journey | Required ordinary product task | Minimum proof |
|---|---|---|
| J1 List | Create/maintain a formatted list with validation/dropdowns, sort/filter and edits | Normal New/authoring entry, core-enforced rejection, stable IDs through edits, durable reopened values |
| J2 Plan | Build/update a monthly plan using copied formulas and multiple sheets | Fixed/relative behavior, independent duplicated data, correct recalculation and round trip |
| J3 Cleanup | Import/paste messy CSV/XLSX, inspect fidelity, correct/clean/find/replace/sort/filter and export | Original unchanged, exact intended targets, no silent unsupported loss, actual external-format artifact |
| J4 Summary | Combine/look up values across sheets and summarize | Human-readable binding, authoritative current result, missing/duplicate-key error handling, save/reopen |
| J5 Report | Produce/share a readable formatted report with a chart | Chart derived from actual current data; artifact opens and remains understandable; independent visual/interaction review |
| J6 Continuation | Close/reopen/change/review/save/reopen and continue | Real host/process restart, core recomputation, no stale cache or silent drift; supported undo/recovery |

Use existing upstream canaries and accepted outcomes; bind new browser controls mechanically rather than reproducing formulas/validators in test hooks. Missing executable coverage beyond the first seed is an explicit preparation requirement before its relevant child becomes Ready. Steward writes acceptance, implementer writes unit tests; independence is about authorship, not the label on an agent.

## Hard gates and evidence

No known silent corruption/loss, partial publication on failed operations, wrong supported calculations, false saved/current status or lost exit path. Preserve inputs and explain unsupported/lossy constructs. Test the actual shipped artifact and normal user entry, not a special fixture that grants unavailable capabilities. Source commit, kit digest, app/build identity, OS/browser and commands must match evidence.

Run real keyboard, CJK IME and accessibility checks separately from synthetic events. Measure open/first-use, navigation/scroll/filter, edit-to-calculation, save/reopen and representative import/export on recorded workloads/devices. The small canary is not large-sheet evidence. Product-owned latency budgets are proposals until measured/accepted.

For public promotion retain #256/#261's initial evidence targets: at least 85% of participants complete every core task unaided; at least 90% overall completion with no task below 80%; median time approximately within 1.5 times a familiar baseline; curated common-profile estate at least 95% opens/displays and 90% edits/saves without blocking fidelity problems; at least 99% of in-profile formula results within declared tolerances; 100% unsupported constructs inventoried; zero known silent loss. Do not invent user sessions or claim a tiny synthetic dataset validates these rates. Any amendment needs recorded evidence and Steward reconciliation.

Web and macOS are this Mission's delivery target, stricter than upstream's minimum of one graphical distribution. Users must not need a checkout/toolchain. Keep channel-specific signing, hosting, identity and legal actions as explicit authorized tasks. A public repository is not a released product, counsel clearance or paid-service authorization.

Final packet: 15-bundle matrix, six task results/traces, trust/fidelity corpus, platform/UX/performance evidence, pilot metrics, known limits, remaining findings, exact reviewed artifacts and Public/Commercial Gate disposition. Only founder/Steward closes Mission #1. Unrelated backlog or optional AI does not delay otherwise qualified ordinary spreadsheet work.
