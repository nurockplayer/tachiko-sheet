# #131 local Save for .ro-origin work

Authority: [Opus's 2026-10-14 carrier-option-a decision](https://github.com/nurockplayer/tachiko-sheet/issues/131). Base Sheet `39ed2f2df85e3193c4256a5be13b2b7a58f482fa`; Work kit `d60fc65bc0e6b78ceab5ddeff9afbc241f42fc1e` is unchanged. This is a Web-only create-only Save slice. Opus owns independent review, integration and deployment.

## Private representation and admission

The existing IndexedDB database `tachiko-sheet-local-copies`, version 2, and its two stores are unchanged. New records live in `opaque-copies` with `kind: "work-file"`, `formatVersion: 1`, name, timestamp, source revision, and unchanged `exportPortableRo(expectedRevision)` bytes. The private envelope version is unrelated to the Work package or canonical format version. Actual host attachments remain outside those bytes. Locally authored report settings retain the existing `snapshotRevision` / SHA-256 `snapshotDigest` pairing and structural/text bounds. No imported-source or report attachment is fabricated after core-only .ro admission.

Admission dispatches only this exact kind/version/store tuple through `openWorkFile`: Work verifies the package before `openPortableRo` creates a fresh occurrence. Corrupt/unknown/misplaced records refuse without rewriting or deleting any record. Report revision/digest checks happen before replacement; current discovered Work definitions/results govern report rebinding afterward. Sheet implements no package codec or semantic state.

The review repair applies Work's exact 64 MiB archive limit before any application payload clone or hash at the writer, reader/classifier and saved-open boundaries. The exact limit remains admitted. This variant refuses every defined imported-source attachment, including null or a structurally valid foreign source; portable packages omit that provenance by design. Locally authored presentation settings use the ordinary copy's structural/text validators, with revision and SHA-256 binding checked before resident replacement. Corrupt rows remain independently listable without an admitted kind and do not affect healthy copies.

Writes reuse the existing cross-store, strict-durability, create-only transaction. Request success is insufficient: the promise resolves only on transaction completion. The existing occurrence/revision receipt and draft/currentness machinery determines Saved and Close permission. Ordinary canonical/Date/definition-bearing routing and all existing readers remain intact. Unsaved Close retains its existing guards and Save continuation.

## Reader-preserving rollback

Keep the compatible reader when disabling new writes. `createLocalCopies({ workFileWrites: false })` omits only the optional `createWorkFile` capability. `readAny` still admits the new variant; `App.openSaved` still uses Work portable admission; Home still lists it. The UI derives the writer-unavailable reason from that missing capability, while ordinary Save remains available. Desktop composition disables this writer.

The reader is delivered separately from the writer. Revert the writer commit while retaining the reader commit, or disable `workFileWrites` at the Web composition call sites. Do not revert the compatible reader after users have saved new copies. Neither rollback changes stored data or the database schema. Whole-build downgrade is explicitly different: the exact previous reader refuses the new variant and leaves its bytes recoverable when the compatible reader is restored.

`tests/fixtures/local-copies-39ed2f2.ts.txt` is the complete, byte-exact previous production module, with a fixed SHA-256 checked before execution by the host tests. Its actual `list` classification and `readAny` refusal are exercised against the same database. No simulated permissive old reader is substituted. After refusal, reader-only mode reads the original record unchanged. The real browser lane additionally proves Download work file emits exactly the stored payload, and independently verifies it through Work and fixed-source/arithmetic oracles.

## Evidence and retained boundaries

`tests/product/work-file-save-local.mjs` covers release-plan formulas and Sales definitions/results, two successive saves/reopens, five actual Chromium browser PIDs with OS-confirmed process absence before same-profile restart, locally authored report survival, omission disclosure, cancellation/conflict/quota/real abort/unknown committed reply/stale receipt, pending acknowledgement, corruption, revision/digest mismatch and unchanged old canonical/legacy/opaque-v2 copies. It is required by `scripts/run-product-acceptance.mjs` in both transports. The prior work-file oracle is shared verbatim; only #179's owner-dispositioned Save-unavailable assertions change.

Host tests cover strict completion, unchanged cloned bytes/attachments, actual previous-reader refusal, disabled-writer compatibility, closed classification, malformed envelopes/attachments, cross-kind conflicts, quota and abort. Existing host reader tests remain unchanged.

The repair's deterministic admission tests spy on payload cloning and hashing for 64 MiB + 1 refusals and the exact-limit positive control across writer, reader/classifier and open preflight. The real browser lane also attempts saved Open with clean resident work: malformed/foreign imports and invalid/mis-bound presentation attachments preserve its exact occurrence/revision/bytes and unsaved status, leave stored copies unchanged, and keep Import & export usable.

Frozen #146 seeds/runners/pins, all five #176 strings and their exact plain-copy exceptions, Date+summary policy, kit files, dependency manifests and lockfiles are unchanged. Desktop .ro entry, autosave/update-in-place, complete-workbook portability and native-collection CSV/XLSX remain out of scope. Local execution uses the existing explicit `TACHIKO_TEST_SINGLE_PROCESS=1` sandbox setting; multiprocess CI remains the default. Commands and actual results belong in the draft PR and #131 handoff. These tests are implementation evidence, not independent candidate-review credit.
