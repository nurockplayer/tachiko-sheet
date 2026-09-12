# VF-03 populated fixture qualification status

Status: **BLOCKED / not introduced**

The repository currently has one real admitted product fixture:
`tests/fixtures/release-plan.roproj` (18 files, three rows), copied byte-for-byte
to `public/examples/release-plan` by `scripts/copy-example-fixture.mjs` and
covered by `tests/product/example-copy.node.mjs`. Its supported projected fields
are the existing release-plan columns; the core contract does not provide a
Sheet-side row-authoring or fixture-generation API.

The inspected admission path (`src/runtime/session.ts`,
`tests/qualification/qualified-kit.mjs`, and `tests/product/example-copy.node.mjs`)
requires canonical bytes to be admitted by the real kit and independently
qualified. No deterministic roughly-50-row fixture with the requested CJK,
Latin, number, and exceptional states is present or qualified at this baseline.
Creating JSONL rows by hand, duplicating the three-row seed, or padding a
screenshot would not be evidence of the real core and would violate the source
fixture/M1 boundary. Therefore VF-03 remains an explicit preparation blocker for
the parent/Steward to resolve through a core-supported fixture admission path.
