# Authority, provenance and canonical issue routing

## Live authority

Read the relevant files in nurockplayer/tachiko-work: docs/vision/product-constitution.md; design-principles.md; docs/governance/knowledge-authority.md; Accepted ADR-0007, ADR-0020, ADR-0022, ADR-0024, ADR-0026 and the relevant later storage/history decisions; docs/specs/semantic-api.md and semantic-authorization.md; docs/architecture/frontend-backend-boundary.md. Read AGENTS.md/CONTRIBUTING.md and current Issue/PR policy before writing upstream. Imported baseline evidence never overrides live authority.

Core baseline in the original seed: `8bba9b09cea3c011df383216ba3846ccd003dece`.
Original preparation: `f264ead7a8286b0de337792b118055f13aa2c83d`, path `planning/independent-work-client/`, subtree `70c2c897cb0892b8656ce7d3c595ce7e8cbb438f`.

The founder subsequently created **nurockplayer/tachiko-sheet**, public. This is the real target, not the former proposed tachiko-work-client. No additional private staging repo or visibility change is needed.

## Single owners

| Old tachiko-work ticket | Current owner |
|---|---|
| #357 generic-client planning Epic | tachiko-sheet #1 Mission; upstream #357 retained only as navigation/history |
| #358 independent bootstrap | tachiko-sheet #3 |
| #359 core kit/canonical I/O | stays tachiko-work #359 |
| #360 human client loop | tachiko-sheet #4 |
| #361 trusted delegated bridge | stays tachiko-work #361 |
| #362 agent review UI | tachiko-sheet #6 |
| #363 new-client desktop | tachiko-sheet #7 |

Sheet #2 is the only current Mission handoff; #5 owns full spreadsheet gap/RC evidence. Child completion does not close #1. Successor routing is explicit; do not dispatch a closed old client ticket or maintain competing editable specifications.

The #354 same-repo recommendation was already superseded for new-client planning. This further narrows the new client to Sheet. Multiple future clients may have separate repositories. The old seed's prohibition on separate sheet/document/AI repos, guessed role/grade assignments, private-repo creation and unconditional preflight/no-self-merge instructions are superseded **only for Sheet-local work** by #1 and docs/DELIVERY.md. It remains historical evidence, not live dispatch authority.

Existing #315–#319/#330 and then-live successors retain semantic/producer responsibility; #345/#351 retains the existing Designer desktop lane. Re-read actual status before depending on them. No existing public product is retired, no stable SDK promoted, and #231's independent third-party evidence is not supplied by our first-party client. #256/#261 and #15/#202 retain release/contribution/legal ownership.

## Seed preservation

The acceptance branch copies original tests, fixture bytes and scripts unchanged and records per-file SHA-256 in evidence/seed-provenance.json. Old generic product/governance documents and old validation claims are not copied as live authority. Current checks are independently rerun here. The package name changes to tachiko-sheet-acceptance-seed, not the assertions. The manifest preserves source attribution/provenance; it is not a license grant or conformance certificate.

The runtime-kit interface remains experimental. Original test-driver names and DTO expectations are test-local wiring, not a public ABI. Producer capabilities may need a bounded upstream update rather than a client-side rewrite. Real generation/consumption and upgrade/rollback need actual evidence.
