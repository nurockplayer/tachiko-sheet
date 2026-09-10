# Tachiko Sheet product and client boundary

State: Sheet product direction adopted under Mission #1; frontend implementation choices are provisional. This replaces the *general client* framing of the earlier preparation, not upstream Accepted semantics.

## Product

Tachiko Sheet is the Excel-like spreadsheet client of Tachiko Work. Its Web and Desktop hosts belong in this repo. A future Docs client, Slides client and specialized ERP/CRM solution may be independently owned and released. Shared core meaning does not require one repository, one app shell or identical interaction models.

Start with familiar spreadsheet work: open/create a workbook, navigate/edit cells, define tables and formulas, organize sheets, clean/import data, review changes and save/export. Do not demand Git, an account, AI, stable IDs or schema internals before value. Full delivery is the bounded Driver Common Profile, not full Excel parity. Its six golden tasks and 15 bundles are in PRODUCT-ACCEPTANCE.md.

The existing UI is historical evidence only. Do not extract its coordinator, CSS or application state into this repo as the design. Retain useful core, codec, adapter and fixture evidence without importing old presentation constraints.

## Information architecture

**Home:** Open, supported New/template actions, recent work and an honest storage-location label. No empty dashboard, sign-in wall or fake future buttons.

**Workbook:** a compact workbook toolbar and visible save state; the main grid and sheet/table navigation are primary. View settings, inspection, change review and assistance are contextual. Selection, focus and draft state survive view switches where applicable.

**Grid:** familiar keyboard/mouse selection and direct editing; computed cells distinguish source/formula from results; diagnostics point to the value and recovery action. Sort/reorder changes the view, not stable targets. F2/Enter begin edit, Escape cancels and restores focus, Tab commits admissible input and moves predictably. IME Enter during composition never commits. Clipboard/fill/structure semantics follow core authority rather than guessed coordinate rules.

**Notes/report:** auxiliary authored rationale and live data references within Sheet. The initial Brief template uses a genuine Text notes field and the same entity's runtime facts. It is not the universal document model or a Word replacement. Later narrative embeds require their own accepted persistence/identity contract; editor-library JSON must not silently become canonical.

**Changes/Assist:** human editing remains direct; delegated proposals remain uncommitted until exact approval and trusted execution. Show before/after, source/scope, affected facts and actual outcome. Rejecting or postponing a suggestion does not change data. A stale proposal needs a new proposal; no silent rebase or reused approval. AI is optional and not required for ordinary spreadsheet launch.

## Ownership

- UI: rendering/accessibility, selection, viewport, drafts, pending actions and disposable occurrence/revision-keyed projections.
- Rust runtime: authoritative document, stable identity, typed queries/commands, formulas, validation, atomic publication and applicable proposal/approval gates.
- Host: selected-file access, persistence, lifecycle, trusted context, dialogs and external effects; never alternate semantic policy.

One resident Rust/WASM occurrence is the initial interactive topology. Ordinary edits cross as bounded typed intent/results, not full-document mirroring per keystroke. Full snapshots are explicit open/save/export/debug boundaries. Treat revision tokens as opaque. Closed-occurrence or older replies cannot restore stale views. An uncertain Execute outcome is not proof of failure and never triggers blind replay.

Semantic publication, durable persistence and external publication are distinct. Keep source bytes and pending drafts safe. Reject unsupported or malformed candidates without destroying valid open work. Private TWDPROJ transfer bytes are not a public .ro file. Consume canonical output from upstream codecs and keep unknown/lossy conversion visible.

## First slice, not completion

Use the pinned 18-file release-plan fixture. A user edits Impact 5 to 3 and sees core-calculated Priority 10 to 8, adds the CJK note `先完成試玩回饋，再決定下一版範圍。`, switches between grid and auxiliary Brief, saves a distinct copy, exits the browser process, then reopens the same meaning in a fresh occurrence. Preserve the input source.

Demonstrate invalid edit, cancelled draft, synthetic IME safety, failed save, uncertain Execute and dirty Close protection. Real IME/screen-reader checks remain separately required. The three-row fixture proves one integration path, not ordinary table creation, performance or release completion.

Initial Save a copy is create-only. It does not satisfy all save/update/undo/recovery requirements for the final product. Those remaining user tasks belong to #5's bounded gap queue; no relabeling Save a copy as complete lifecycle.

## Technical direction

React + TypeScript + Vite + pnpm, native DOM/CSS and Playwright are provisional defaults. Select actual supported versions/lockfile during #3. No server/SSR, canonical JS document store, heavyweight grid, generic RPC layer or rich-editor platform without concrete need. Use dense tool ergonomics and system CJK fonts, restrained neutral surfaces, accessible contrast and non-color-only status. Panels collapse rather than crush the grid. Don't substitute landing-page styling for a working spreadsheet.

The independent consumer receives one intact JS/types/Worker/WASM artifact, pinned source, checksums, provenance/capabilities and notices. No private-source/sibling imports or raw ABI shortcuts. Upstream packaging may still use its current app-local adapter; that does not constrain this UI. The kit remains experimental, not a stable SDK. A later real upgrade/rollback uses genuinely different qualified artifacts, not the same hash twice.

Desktop starts with a thin Tauri 2 macOS host and the same UI/WASM semantics. Native FFI is not a prerequisite. Keep new app/origin/database identity separate; no default file-association takeover, ambient filesystem authority or hidden save effect. Real macOS process/OS evidence is required. Other platforms are not automatically supported by choosing a cross-platform framework.

## Scope and privacy

No forced Docs/Slides/ERP/CRM membership, old-Designer retirement, universal plugin framework, collaboration server, telemetry, remote fonts or hidden LLM calls. Text/provider input cannot mint privileges or execute host effects. A configured external provider later needs explicit consent/scope and host-owned credentials; no keys in documents or renderer bundles. Release test hooks must be absent.

Product correctness and actual user flow outrank a screenshot baseline or test count. At RC fix the declared workflow's concrete failures without an unlimited polish/research loop. Final release remains subject to #256/#261 and actually applicable legal/commercial gates.
