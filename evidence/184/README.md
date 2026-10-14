# #184 repair-batch 2 evidence

This batch implements the latest Opus A–F disposition on PR #188, from pushed
base `4c640a89e34dfaf703d91db71d58fb1b1f49da0f`.

| Item | Change | Production regression |
| --- | --- | --- |
| A | Creation-specific recovery allows a coherent authoritative Refresh to expose the created table, unsaved and protected, without replay. Authoritative absence returns Home with a plain explanation. | Lose a real successful creation reply → Refresh → unsaved Close/unload → Save/reopen; then lose another creation reply, close the real resident through its Worker protocol and Refresh to prove absence and no replay. |
| B | New-table name, headers, types and column structure register with the existing draft lifecycle when different from the initial defaults. The Home dialog can submit its own draft. | Initial/reverted defaults are clean; each kind of draft protects unload; refused Create retains protection; Cancel clears it. |
| C | Modal keyboard handling uses the same composition guard as the sheet editor. | Escape with `isComposing=true` and with key code 229 keeps the dialog, draft and focus; ordinary Escape dismisses it. |
| D | Delete captures the existing completion intent and occurrence, then checks them inside its frame before moving focus. | Hold frames after a real deletion, choose Appearance, release the frames and verify newer focus remains. |
| E | Shared insert/delete completion updates the Sales initial/change markers on confirmed publication, including known-publication observation recovery. | Fresh Sales insertion and fresh Sales-row deletion show “Edited — not saved” and an Updated tip. |
| F | Default headers use an unused ordinal, checking existing names with trimmed, case-insensitive comparison. | Add three columns, remove the middle, add again and verify unique defaults; explicitly valid headers reach real core creation. |

`tests/product/new-table-repair-cases.mjs` exercises the production UI and real
Worker/WASM. It only withholds real replies or queued frames; it fabricates no
runtime success, projection, refusal or absence. Every item failed behaviorally
on an unmodified exact-base temporary clone's production build, after Home and
core prerequisites succeeded. A's observation retained the successful creation
reply and coherent real table read while the UI stayed hidden. D retained the
real delete publication while its frame moved focus away from Appearance.
B waited for the existing dirty lifecycle to settle, which never happened on
the base. C, E and F failed explicit assertions. The same six regressions pass
on the repaired production source. [Before/after receipt](regression-results.json).

The full production new-table lane passes all 16 groups, including the existing
all-field/ID independent saved-byte oracle and actual full browser process
exit/restart. All eight screenshots were recaptured from the repaired production
build and are byte-identical to the prior captures. [Lane receipt](result.json)
and [source/artifact/frozen-file hashes](artifact-manifest.json) bind the evidence
to the tested files.

| Screen | Desktop (1400px) | Compact (800px) |
| --- | --- | --- |
| Home | [home-1400.png](home-1400.png) | [home-800.png](home-800.png) |
| New table dialog | [dialog-1400.png](dialog-1400.png) | [dialog-800.png](dialog-800.png) |
| Expenses with three rows | [table-1400.png](table-1400.png) | [table-800.png](table-800.png) |
| Refused Number draft | [refusal-1400.png](refusal-1400.png) | [refusal-800.png](refusal-800.png) |

## Validation and limits

PASS: typecheck; unit (556 Vitest + 125 Node); production build with hook
exclusion; production new-table lane (16 groups); full product (31/31), including
the 24-combination / 24-geometry-case visual matrix with zero findings.
The exact commands/results are recorded in [validation-results.json](validation-results.json).
Complete logs and earlier attempts are retained in
`/private/tmp/sheet184-repair2-validation/`. The baseline clone is
`/private/tmp/sheet184-repair2-candidate`, still at unmodified `4c640a8`.

An initial unit run caught implementation vocabulary in the no-work message;
the message was repaired and the complete unit gate rerun. An initial full
new-table run passed the original ten groups and B–F, but A's extra absence
probe targeted the already closed independent oracle worker. The harness now
retains the first product worker; the complete lane was rerun successfully.
Earlier baseline setup attempts used an invalid default header or unavailable
Results tab; those results earned no regression credit. The exact-base final
run reproduced all six valid behavioral failures. No infrastructure failure is
counted as PASS.

The out-of-repository `NODE_OPTIONS --import` observer used for full product
acceptance only preserves the complete visual JSON; it changes no assertions,
launch behavior or product code. The existing runner selects its supported
single-process Chromium fallback when the normal sandbox launch is unavailable.
Frozen #146 files/runners, `public/core-kit` and lockfiles are unchanged. Serena
was left untouched; its pre-existing local modification is preserved.
Existing space/ASCII/header normalization limits remain core-owned under Work
#525. Desktop qualification is inherited from the original lane; this batch
claims no new native/package/physical IME qualification. Opus retains hosted
gates, fresh independent exact-HEAD review and integration. No review threads
were resolved, and no independent approval or merge is claimed.
