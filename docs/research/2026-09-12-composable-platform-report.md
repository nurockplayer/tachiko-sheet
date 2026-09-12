# Composable Application Platform research digest

Status: source-derived digest of the owner-uploaded 21-page report **Tachiko Work：Composable Application Platform 的產品與架構研究** (2026-09-12). Provenance and SHA-256 are recorded in [`2026-09-12-platform-intake.md`](2026-09-12-platform-intake.md). The original PDF is not checked into this repository.

This document preserves what the report supports. It is not an Accepted ADR and does not replace live Tachiko Work authority.

## Executive conclusion

The report does **not** support this thesis:

> Design one universal Block/Component model first, then force Sheet / Doc / Slide / CRM / ERP to fit it.

It supports a narrower and stronger thesis:

> **shared application platform + reusable engines/primitives + product-owned semantic models + explicit composition protocols**

The composition boundary should generally sit **above** the core content model. Mature suites share substantial infrastructure while deliberately preserving different product semantics.

## Evidence pattern across mature products

### Microsoft Office / Loop / Fluid

Public Office APIs expose both cross-host Common APIs and application-specific APIs. Excel's public model centers on workbook / worksheet / range / table / chart; Word's centers on document / body / paragraph / range / content control / table. The suite therefore does not present one universal document model.

Fluid Framework is especially useful conceptually: it provides shared collaborative state infrastructure and shared data structures without requiring every application to become the same document type. Handles provide references between collaborative objects rather than structural flattening.

Loop productizes a similar idea: a portable live component can appear in multiple Microsoft 365 hosts while retaining its own identity and synchronized state.

### Google Workspace

Docs, Sheets and Slides expose different public object models: structured document content, spreadsheet/sheet/cell-range concepts, and presentation/page/page-element concepts. Cross-product capabilities such as Workspace Add-ons and smart chips sit above those host-specific models.

The evidence is therefore closer to **shared platform + native host semantics** than to a universal content tree.

### Notion

Notion is an important opposite case. Its engineering material confirms block as a broad core data entity with ID, type, properties, content and relationships. That model provides powerful composition and consistent infrastructure, but it also makes block identity/storage/sync/cache/sharding/offline/data tooling a system-wide commitment at very large scale.

The report does not call Notion's model a failure. Its lesson is that a universal primitive does not remove domain complexity; it moves that complexity into the platform. Such a commitment is justified only when the universal primitive itself is the product thesis.

### Airtable and Coda

Airtable clearly separates underlying tables/records from views and interfaces. One record-oriented source can drive grid, form, calendar, kanban, timeline and other presentations.

Coda similarly demonstrates reusable horizontal capabilities such as formulas and connected table views while still distinguishing canvas content, tables, canvas columns and reference-based subtables.

These products support **shared data with multiple native projections** without implying that all content in a wider suite should become relational data.

### Figma and editor frameworks

Figma's public APIs use a common node vocabulary while still exposing host/product-specific capabilities. This is evidence for capability boundaries, not for a giant union type containing every future product concept.

ProseMirror, Tiptap and Lexical are useful because they separate mechanisms such as schema ownership, transactions, commands, plugins, serializable state and selection types. Their lesson is composable editor mechanisms inside a domain—not that every business application should become editor nodes.

## Where sharing is most stable

The report finds the strongest cross-product reuse at platform/lifecycle layers:

- identity and resource addressing;
- authentication, permissions and sharing;
- comments, presence and collaboration transport;
- history/version infrastructure;
- telemetry and feature flags;
- design tokens/system;
- resource/file metadata;
- extension lifecycle and command dispatch skeleton;
- embedding/reference protocols;
- clipboard/interchange infrastructure.

A second layer may share reusable engines when the invariants genuinely match:

- formula parser/evaluator/function registry;
- charting / visualization;
- rich text;
- query/filter/sort;
- comments/annotations services;
- relation/entity-reference capability;
- import/export conversion;
- virtualized grid/table rendering pieces.

But engine reuse does **not** imply shared product semantics.

## Where sharing should stop

The strongest stop boundary is the product's core invariant.

A spreadsheet is not merely many cells. Its semantics include addressable 2D coordinates, ranges, relative/absolute references, copy/fill, recalculation and row/column mutations that affect references.

A document centers on continuous content, text/paragraph ranges and flow.

A record/database application centers on stable record identity, typed fields, relationships, queries and views.

A slide/canvas centers on spatial objects, page boundaries, transforms, geometry, z-order and grouping.

These models may share operational infrastructure, but the report finds no evidence that forcing them into one domain model is a generally successful default.

## Cross-product embedding pattern

The strongest recurring pattern is:

> **identity + reference + capability + presentation adapter**

rather than a common structural parent class.

Examples in the report include:

- Notion synced/transcluded content;
- Microsoft Loop portable components;
- Google smart-chip/entity references;
- Fluid object handles.

For Tachiko, a future Doc embedding a Sheet range is therefore better conceptualized as a live reference/projection onto a Sheet-owned resource than as Doc taking ownership of spreadsheet cells.

Similarly, CRM / ERP / Dashboard may consume a shared typed dataset through different native projections without implying that prose documents or slide scenes should also become relational datasets.

## Reusable primitive boundary

The report distinguishes a reusable mechanism from product semantics:

| Area | Reusable boundary | Product-owned meaning |
|---|---|---|
| Identity | resource/entity/embed IDs | cell address, text position, node path |
| Collaboration | transport, presence, delivery, history storage | operation meaning, conflict policy, undo grouping |
| Commands | registry, dispatch, shortcut framework | command set, enablement, exact semantics |
| Formula | parser/evaluator/function registry | reference syntax, dependency and recalc semantics |
| Chart | renderer, scales, series, data adapter | anchoring, selection and edit UX |
| Selection | lifecycle/interface/focus ownership | text range, grid range, object selection |
| Clipboard | interchange pipeline/format registry | relative-reference copy, text paste, vector paste |
| Comments | thread/mention/permission service | cell/range/text/node/record anchors |
| Serialization | envelope/version/extension registration | product payload/schema |
| Templates | manifest/version/dependency machinery | product-specific template semantics |

A recurring warning is that visually similar things—Word tables, spreadsheet grids, database tables, dashboard table visualizations—may have different invariants and should not automatically be one primitive.

## Template implications

The report separates three future concepts that should not be collapsed into “template JSON”:

1. **Clone template** — instantiate/copy and then evolve independently.
2. **Linked/versioned component** — consumer retains a dependency on a component definition/version.
3. **Application blueprint** — creates several resources, relations, permissions/config and product structure together.

The immediate requirement is not a marketplace or blueprint runtime. It is to avoid persisted state with no ownership/version/reference seam at all.

The report uses Power Apps component libraries, Retool versioned component libraries, Fluid schema upgrades and Notion template/reference behavior as evidence that reuse eventually creates version/dependency/migration responsibilities.

## Failure modes / anti-patterns

The report highlights these warning signs:

- a “universal primitive” gains nullable fields every time a new product appears;
- a platform API leaks the vocabulary of the first product;
- every new product immediately needs escape hatches;
- reuse exists only as shared source code with no ownership/version/dependency contract;
- templates snapshot implementation details;
- all hosts are forced to pretend they have identical capabilities;
- a generic configuration DSL is designed before the second real product exists.

A central lesson is:

> Mature platform design often shows its quality by knowing what **not** to abstract.

## What Tachiko Sheet should decide now

The report's “must decide now” set is mostly about expensive future migrations:

- Sheet has an explicitly owned spreadsheet semantic model;
- persistent state has an existing type/version boundary and can evolve;
- stable identity is distinct from local spreadsheet location/address;
- command/semantic operations are not simply direct UI event mutations;
- domain state is not the rendering/component tree;
- the architecture leaves namespace/reference room for embedded/external resources.

The reconciled project note is important: these statements do **not** authorize inventing a second persistence envelope or moving semantic authority into JavaScript. Existing upstream Rust/runtime/codec authority remains in force.

## What should only have a seam

The report recommends keeping replaceable/integratable seams around:

- formula engine pieces versus spreadsheet reference/recalc semantics;
- chart engine versus Sheet anchoring/selection/editing;
- rich-text/cell editing engine versus a future Doc schema;
- comments service versus product-specific anchors;
- selection/clipboard/undo framework versus product-specific representation;
- resource/embed interface versus a fully implemented embedding runtime.

## What is safe to defer

- full universal app manifest;
- Template Marketplace / blueprint runtime;
- generic CRM/Dashboard widget framework;
- universal layout engine;
- Work-wide universal data model.

These need evidence from additional real products.

## What not to build now

- `TachikoUniversalNode`;
- “everything is a block” purely because Notion succeeded;
- one primitive for spreadsheet cell / database field / doc-table cell;
- architecture defined by toolbar/UI components;
- shared source-code components presented as if they were a platform contract;
- a generic app-builder/configuration DSL for hypothetical future clients.

## Condensed thesis

The report's most useful sentence for current delivery is:

> **Build a real spreadsheet, not a hypothetical universal app model. But make the spreadsheet live inside a future platform boundary, not become the platform boundary itself.**

In repository language: **product-native semantics, platform-ready boundaries**.

## Source list preserved from the report

Representative first-party/public sources used by the report include Microsoft Office JavaScript API docs, Fluid Framework docs/Handles/schema upgrade guidance, Microsoft Loop documentation, Google Workspace Editors/add-ons docs, Notion engineering posts on its block model/synced blocks/sharding/data catalog, Airtable views/interfaces terminology, Coda formula/connected-view/canvas-column docs, Figma developer docs, ProseMirror/Tiptap/Lexical docs, Power Apps component-library docs and Retool custom-component/module docs.

The uploaded report contains the complete URL list. This digest does not independently re-verify every external citation or infer unpublished internal implementation.