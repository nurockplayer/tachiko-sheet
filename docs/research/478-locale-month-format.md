# #478: month-name locale changes originate in Work

## Finding

The pinned Work runtime rewrites unqualified month-name formats to explicitly
en-US formats. This is a product fidelity defect concealed by the Sheet test's
expected-value conversion, rather than a fixture-generation or XML-parser effect.

Sheet baseline: `781cc316bc6e799f5b4b2145baa4172df36344c0`.
Work pin in `core-kit.lock.json:6`:
`f5d3b2b59d695d95244b21647cc53bf4b302de9c`.
Acceptance row: none.

## Source evidence

- `tests/product/presentation-roundtrip-local.mjs:15` specifies `mmm d, yyyy`
  and `d mmm yyyy` without locale qualifiers. Line 30 writes those strings
  directly into the fixture's `formatCode` attributes.
- The independent XML parser reads `formatCode` verbatim at line 72.
- At the pinned Work revision,
  [`interop_date_format.rs:19–43`](https://github.com/nurockplayer/tachiko-work/blob/f5d3b2b59d695d95244b21647cc53bf4b302de9c/packages/browser-client/runtime/src/interop_date_format.rs#L19-L43)
  maps unqualified and en-US-qualified patterns to the same `DateFormat` variants.
- During import,
  [`interop_document.rs:1494–1506`](https://github.com/nurockplayer/tachiko-work/blob/f5d3b2b59d695d95244b21647cc53bf4b302de9c/packages/browser-client/runtime/src/interop_document.rs#L1494-L1506)
  uses that mapping and clears the source `style.number_format` for supported
  Date patterns. Thus the original qualification distinction is lost here.
- During export,
  [`interop_document.rs:4444`](https://github.com/nurockplayer/tachiko-work/blob/f5d3b2b59d695d95244b21647cc53bf4b302de9c/packages/browser-client/runtime/src/interop_document.rs#L4444)
  calls `cell_style`.
  [`interop_date_format.rs:101–110`](https://github.com/nurockplayer/tachiko-work/blob/f5d3b2b59d695d95244b21647cc53bf4b302de9c/packages/browser-client/runtime/src/interop_date_format.rs#L101-L110)
  assigns `to_excel(format)` as the output number format.
  [`to_excel` lines 14–15](https://github.com/nurockplayer/tachiko-work/blob/f5d3b2b59d695d95244b21647cc53bf4b302de9c/packages/browser-client/runtime/src/interop_date_format.rs#L14-L15)
  explicitly return `[$-409]mmm d, yyyy` and `[$-409]d mmm yyyy`.
- The Sheet oracle at lines 119–124 converts the expected source string to
  precisely that qualified result, concealing the change. Its comment's claim
  that this preserves rendering in any Excel locale is incorrect for an
  unqualified source pattern.

## Decision and remaining proof

Stop at the brief's export-rewrite boundary. No Work, storage codec or Sheet
oracle changes have been made, and no journey PASS is claimed. The brief's full
Test command was not run; this is a source-based diagnosis.

Options for the lead:

1. Route an upstream Work repair to preserve the imported pattern's locale
   qualification through import/export, then re-pin Sheet and replace
   `exportedFormat(source.format)` with the exact source format expectation.
2. Land the strict Sheet oracle first as an intentionally failing regression,
   with the product fix still blocked on Work.

Recommend option 1. Merely removing `[$-409]` from Work's export mapping would
change explicitly en-US-qualified inputs in the opposite direction; retaining
the source distinction is necessary. Do not qualify the fixture to make it pass.

When authorized to resume, require exact source-format equality for both
month-name columns. Prove that the real journey passes after the upstream repair
and that changing exported `mmm d, yyyy` or `d mmm yyyy` to its `[$-409]` form
fails that same oracle. Record both results on the PR. Those execution results
remain pending, rather than being inferred from this source trace.
