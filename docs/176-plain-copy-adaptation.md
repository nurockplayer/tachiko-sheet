# #176 approved plain-copy adaptation

This copy-only follow-up applies the [owner approval recorded on PR #175](https://github.com/nurockplayer/tachiko-sheet/pull/175#issuecomment-6136361173), resumed by the [#176 intake](https://github.com/nurockplayer/tachiko-sheet/issues/176#issuecomment-6236887362).

The original frozen driver remains recoverable at
`de9371e1dec44811fd6a1240f5b601d7e3cb0839:tests/product/web-save-closure-current.mjs`,
SHA-256 `f4370ac5cc87f3d5882c17470f7e0401283ba0d644ef79fc33c51f545e251e61`.
The adapted driver is byte-identical to the reviewed
`ce1959196521e217fd10ce0a2edd7cc85b9b237d:tests/product/web-save-closure-current.mjs`,
SHA-256 `1acb4f5746a5e76e556d8da2052b6771fed6bcd1dbb5bbece78fb81827b2f717`.
Those Git objects and existing historical receipts are retained; this note does
not rewrite or requalify any historical result.

The five approved changes are `Import candidate` → `Import file`,
`Source fidelity ledger` → `Import & export changes and warnings`,
`Cross-table summary binding` → `Cross-table summary setup`,
`original source remains available` → `original source is still available`,
and `This bar report renders` → `This bar report shows` (the report sentence
retains its existing dynamic report type). The driver changes only the seven
corresponding literal copy/locator lines. Its SHA-256 binding changes at one
site in each Save-closure runner and two sites in the production-lifecycle
runner. Related non-frozen harness locators receive the same literal changes;
their scenarios and assertions remain intact. The plain-copy guard no longer
needs the three exact-label exceptions.

The prerequisite and production lifecycle driver bytes, all case registries,
expected values, identity checks, #147 admission allowlist/workflow scope,
J3 corpus pins, runtime pins, and semantic/storage code remain unchanged.
New validation receipts belong to the exact new candidate and must not be
substituted for the required hosted checks or independent review. Rollback is
a normal reviewed revert of this copy/locator/pin package.

Local implementation checks on the candidate contents: frozen pnpm install,
typecheck, the two plain-copy tests, 631 Vitest tests plus 145 Node unit tests,
production build and its 85-file acceptance-hook exclusion all passed. The
runner-control invocation returned 26 passes and one failure: the unchanged
PR #147 admission test requires historical candidate `f6121d5b`, so it rejects
the current `de9371e1` baseline. Running the same controls with only that
PR-specific test excluded returned 26 passes (the runner reports zero skips); the
allowlist, workflow and admission test were preserved. Full Save/lifecycle,
hosted gates and independent review are separate candidate-bound obligations.
