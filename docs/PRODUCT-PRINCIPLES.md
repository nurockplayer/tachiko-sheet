# Sheet product and architecture principles

Status: proposed Sheet-local guidance under #1; effective after reviewed merge. This is not a second Work Product Constitution or a new semantic/storage ADR. [Upstream authority](UPSTREAM.md) wins where concrete contracts differ. Research provenance and limitations are in [the intake](research/2026-09-12-platform-intake.md).

## Product promise

Deliver an official, ready-to-use spreadsheet, not a builder that the user must assemble. Ordinary work must start without Git, IDs, schema design, an account or an LLM. The finite target remains the [15 Driver bundles and six journeys](PRODUCT-ACCEPTANCE.md); familiar interaction does not mean pixel-copying Excel or inheriting every historical behavior.

Internal composability means replaceable modules and explicit interfaces. It does not require a Notion page/block model, a universal application DSL, or an end-user template editor.

## Architecture boundaries

1. **One semantic authority.** The existing shared Rust runtime and Headless Semantic API own canonical state, calculation, validation and publication. Sheet owns its product UX and adapters, not a competing JavaScript workbook engine. A spreadsheet-specific semantic capability can live in an appropriately owned upstream Rust module; “product-native” does not mean “frontend-owned.”
2. **Model is not UI.** Commands express user intent; components own rendering, focus, selection, drafts and disposable projections. React trees and editor-library JSON do not become canonical persistence.
3. **Identity is not position.** Use upstream stable identities and qualified reference semantics. A displayed address, sorted row, storage path or label is not a durable target. This does not require inventing a persistent ID for every empty grid cell.
4. **Version at the existing boundary.** Use upstream versioned codecs and explicit migrations. Do not add a parallel `resourceType/schemaVersion/payload` file format merely because the research illustrated an envelope. Preserve unsupported input and disclose format/profile limitations.
5. **Separate effects.** Semantic commit, confirmed durable save and external publication remain different. Stale/uncertain replies and failed saves must not look current or saved. Preserve drafts, source files and recoverable work.
6. **Share mechanisms selectively.** Commands, chart data adapters, rich-text integration and host interfaces may have reusable seams. Text selection, grid selection, formula references, document layout and record identity retain their own meaning. A UI table, a database table and a spreadsheet range are not automatically the same object.
7. **References before forced ownership.** Leave room for future resource references and projections. Embedding a Sheet in a Doc need not move its cells into a Doc block tree. No embedding runtime is required for this MVP.
8. **Generalize from actual pressure.** Extract a shared engine when a concrete second consumer or an existing cross-host need validates its contract. Keep modules separable now; do not first build a platform for hypothetical Doc/Slide/CRM/ERP products.

## Deliberate non-goals

No universal node/layout/selection model, general plugin ABI, app-builder DSL, template marketplace, live collaboration service or new formula language as a prerequisite to Sheet. A copied template, a live reference and a versioned component dependency are different future contracts; this MVP does not promise automatic template upgrades.

## Delivery test

A user can complete a whole task through the normal product entry, keep the work after restart and export it truthfully. A three-row canary, green unit suite, packaged shell or self-generated screenshot baseline alone is insufficient. Concrete contract gaps go to the existing upstream owner; missing capabilities must not be disguised by UI mocks or by silently shrinking the profile.
