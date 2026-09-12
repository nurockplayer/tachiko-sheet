# Product / architecture discussion synthesis

Status: chronological discussion record. This captures the reasoning path that led to the current Sheet-local principles. It is **not** an Accepted ADR and must be read with the evidence digest, the platform intake, live Sheet #1/#2, and upstream Tachiko Work authority.

## 1. Start with product research, not implementation assumptions

The first decision was procedural: before deciding how Tachiko Sheet should behave, study mature spreadsheet/table products across desktop, web and touch. The explicit goal was to avoid both “clone Excel” and “invent interactions from scratch.”

That produced the separate Spreadsheet Deep Research brief covering Excel, Numbers, Google Sheets, LibreOffice Calc, Notion Database, with Airtable/Coda/Rows as comparison points. Its focus was mental model, cell/range/table/record/view semantics, selection/editing/navigation, formula/fill/copy-paste, collaboration/history, platform differences, good decisions, historical baggage and entrenched user habits.

The full spreadsheet research output is not currently preserved in this repository, so its concrete findings are intentionally not reconstructed here. See [`2026-09-10-spreadsheet-research-brief.md`](2026-09-10-spreadsheet-research-brief.md).

## 2. Tachiko Sheet is a separate product client

The broader Tachiko Work direction includes possible future official clients/products such as Sheet, Doc, Slide, CRM, ERP, Project Management and dashboards. The working repo strategy therefore did **not** treat `tachiko-sheet` as the one frontend repo that must eventually contain every product.

The new Sheet repo was created specifically as a fresh spreadsheet client. Existing Tachiko Work semantic/runtime authority remains upstream, while the new client is free to establish a spreadsheet-native product UX rather than inherit the current Designer UI as a design baseline.

That distinction remains visible in live Sheet #1: the Mission is an actual Excel-like spreadsheet product using Tachiko Work's Rust semantic/runtime authority, not a generic editor/app builder or a bundle of every future product.

## 3. The Notion-template question exposed the platform question

A discussion about “letting users make templates like Notion” first separated several levels of difficulty:

- simple copy/instantiate templates;
- schema/formula/default-data templates;
- saved views/filter/sort/group;
- relations/rollups;
- variables;
- actions/automation;
- dashboards/application templates;
- arbitrary Retool-like UI builders.

The key observation was that Notion's power comes from a constrained vocabulary of reusable concepts—not arbitrary UI freedom. This suggested that Tachiko could eventually gain powerful templates and vertical products without immediately becoming a low-code builder.

At this stage the working mental model was roughly:

```text
Workspace
├─ Data / Table / Field / Record / Relation
├─ Views
├─ Documents / embedded views
└─ Logic / formula / action / automation
```

This was a product exploration, not a final data model.

## 4. Important clarification: internal LEGO, official products, no user-facing builder

The founder then clarified the intended analogy:

> Notion feels like LEGO. Tachiko Sheet could be one complete product assembled from reusable internal pieces, but users receive the official “brand-name machine”; they are not expected to assemble the UI themselves.

That produced an important distinction:

> **Composable architecture ≠ user-facing composable product builder.**

The initial hypothesis became:

```text
Tachiko application platform
├─ reusable capabilities/primitives
├─ composition/runtime
└─ official products
   ├─ tachiko-sheet
   ├─ tachiko-doc
   ├─ tachiko-slide
   ├─ tachiko-crm
   └─ tachiko-erp
```

A spreadsheet product might conceptually decompose into Grid + Formula + Table + Chart + Commands + Toolbar + spreadsheet-specific semantics. At this point, however, it was still unclear **how low** the shared primitive layer should go.

## 5. Spreadsheet-first was kept as a hard product requirement

Even while exploring the internal LEGO/platform idea, Tachiko Sheet was not supposed to become a Notion database UI or a generic composition surface.

The product was expected to retain spreadsheet-native behavior such as:

- row/column and 2D grid mental model;
- cells/ranges;
- formulas;
- fill/copy/paste;
- sorting/filtering/table workflows;
- keyboard navigation;
- sheet tabs and formula-bar-style interactions where product research supports them.

A useful temporary phrase from the discussion was:

> **Spreadsheet-first, application-capable.**

This expressed the product intent but still left the underlying platform thesis under-researched.

## 6. A second Deep Research track was opened for the platform question

The discussion then recognized that the previous spreadsheet study answered a different question.

- Spreadsheet research asks: **What should a spreadsheet be?**
- Platform research asks: **What should be shared underneath several official products?**

A dedicated Deep Research prompt was therefore created around a single central question:

> **Should Tachiko Work be a composable application platform where official products are assembled from reusable capabilities, while end users still receive a finished, opinionated product?**

The prompt asked for evidence from Notion/Coda/Airtable, Microsoft Office/Loop/Fluid, Google Workspace, Apple iWork, Figma, Retool/Power Apps and composable editor frameworks. It focused on:

- where successful multi-product systems actually share;
- shared primitive vs product-specific semantics;
- whether spreadsheet/document/database/canvas models should share a core model;
- cross-product embedding/shared data without forcing everything into block/table/cell;
- template implications;
- premature platformization and failure modes;
- what must be decided now vs left as a seam vs deferred vs explicitly not built.

## 7. The prompt itself was intentionally shortened

An earlier draft tried to enumerate nearly every subproblem: stable IDs, schema migration, clipboard, repository boundaries, plugin APIs, serialization, output chapters and many individual primitives.

The discussion concluded that this was counterproductive for Deep Research. A long checklist can push the model toward shallow “answer every bullet” coverage rather than discovering which architectural tensions matter most.

The revised prompt therefore kept:

- the product context;
- the central architecture hypothesis;
- the explicit non-goal of an end-user low-code builder;
- representative systems to study;
- a compact set of decision-level questions;
- first-party evidence requirements;
- the final must-decide / seam / defer / do-not-build classification.

The working principle was:

> **A Deep Research prompt should define the problem and evidence boundary, not pre-solve the research tree.**

## 8. The platform report changed the LEGO hypothesis

The resulting 21-page report materially refined the earlier internal-LEGO analogy. See [`2026-09-12-composable-platform-report.md`](2026-09-12-composable-platform-report.md).

The strongest cross-case result was **not** “successful products all reduce to one universal block/table/cell/node.” Instead, mature suites commonly share platform services, collaboration/reference/embedding protocols, design/extension/command infrastructure and selected reusable engines while preserving product-owned core semantics.

This changed the working thesis from:

```text
Build a universal set of app primitives first
→ assemble Sheet / Doc / CRM / ERP from them
```

to:

```text
Build real product-native semantic kernels
inside explicit platform-ready boundaries
→ extract/share mechanisms when actual commonality is validated
```

The report's condensed formulation is preserved as:

> **Build a real spreadsheet, not a hypothetical universal app model. But make the spreadsheet live inside a future platform boundary, not become the platform boundary itself.**

## 9. The analogy was corrected

The “LEGO” metaphor remains useful only at the right level.

A better analogy is a family of official products sharing chassis/interfaces/services/engines while keeping product-specific engines and body structures.

```text
Shared / potentially shared
├─ identity / references
├─ auth / permissions / sharing
├─ collaboration/history infrastructure
├─ command framework
├─ design system
├─ embed/resource protocols
├─ chart engine pieces
├─ formula parser/evaluator pieces
└─ other validated reusable services

Sheet-owned semantics
├─ spreadsheet grid/ranges
├─ A1 and relative/absolute references
├─ fill/copy behavior
├─ recalculation/dependency semantics
├─ grid selection/navigation
└─ sheet-specific interaction expectations

Doc-owned semantics
├─ text/paragraph ranges
├─ document flow/layout
└─ document-specific selection/editing

Slide/Canvas-owned semantics
├─ geometry/transforms/z-order
└─ spatial selection/layout
```

The architectural principle that emerged is:

> **Product-native semantics, platform-ready boundaries.**

## 10. What this means for Tachiko Sheet now

The report and live authority were reconciled in [`2026-09-12-platform-intake.md`](2026-09-12-platform-intake.md) and condensed into [`../PRODUCT-PRINCIPLES.md`](../PRODUCT-PRINCIPLES.md).

The practical outcomes are:

### Decide now

- Tachiko Sheet has an explicit spreadsheet semantic ownership boundary.
- Canonical semantic authority remains the existing Tachiko Work Rust runtime; “product-native” does not mean “move semantics into React/TypeScript.”
- Persistent state uses existing versioned upstream boundaries; do not invent an unapproved parallel format.
- Durable identity is not confused with a local display position such as a cell address.
- Commands/semantic operations are separated from incidental UI events.
- Domain state is not the React/component tree.
- Future external/embedded resources are not structurally forced into the Sheet model.

### Leave a seam

- formula parsing/evaluation versus Sheet-specific reference/recalc semantics;
- charting engine versus Sheet-specific anchoring/selection/edit UX;
- rich-text/cell editing engine versus a future Doc schema;
- comments service versus product-specific anchors;
- selection/clipboard/undo mechanism versus product-specific meaning;
- resource/embed interfaces versus a not-yet-built cross-product embedding runtime.

### Defer

- a universal app manifest;
- Template Marketplace/application blueprint runtime;
- generic CRM/Dashboard widget framework;
- universal layout engine;
- a Work-wide universal data model.

### Do not build now

- `TachikoUniversalNode` or a universal block tree;
- an “everything is block/table/cell” model;
- an end-user App Builder;
- a generic future-product configuration DSL;
- a universal selection/layout model guessed from Sheet;
- a platform API whose vocabulary is just Sheet concepts renamed as generic concepts.

## 11. Template direction remains open but no longer blocks Sheet

The earlier template discussion remains relevant, but the report sharpened the terminology:

- **clone template** — instantiate and diverge;
- **linked/versioned component** — retain a dependency;
- **application blueprint** — construct several resources/config/relations.

Those contracts have different identity/version/dependency semantics. The current Sheet MVP does not need a marketplace or builder. The architectural requirement is simply not to destroy the seams future template/resource systems would need.

## 12. What remains unresolved

The largest missing input is still the full Spreadsheet Deep Research result. Until it is restored, the platform research can tell us **how not to over-generalize**, but it cannot replace evidence for detailed spreadsheet interaction decisions.

The intended synthesis sequence therefore remains:

```text
Spreadsheet product evidence
        ×
Platform architecture evidence
        ×
Live Tachiko Work authority
        ↓
Product principles / acceptance / ADR decisions
        ↓
Implementation
```

This repository should keep those layers distinct so later implementation agents can move quickly without mistaking a chat hypothesis, a research conclusion and an Accepted project contract for the same thing.