# Platform research intake and authority reconciliation

Status: evidence and synthesis, not an upstream architecture decision. Prepared by ChatGPT Steward on 2026-09-12 JST for Sheet #1.

## Sources actually available

- Owner-uploaded **Tachiko Work：Composable Application Platform 的產品與架構研究.pdf**, 21 pages. SHA-256: `8e52122ea0e584368217060bb1b5c7409aea696600176eaf8deb355d3f994ea8`. This record preserves provenance and the relevant synthesis; it is not a claim that the original PDF is checked into this repository.
- Sheet baseline `5bd04188627258cf4f9cf43c7d6b0769c47ca82e`; unchanged earlier acceptance branch `0bb56541d3820b1197da79aa2ce36c1051093d85`.
- Work authority inspected at `6900e975112576585fd9360f12d9fcf8b36ba466`: [Constitution](https://github.com/nurockplayer/tachiko-work/blob/6900e975112576585fd9360f12d9fcf8b36ba466/docs/vision/product-constitution.md), [Design Principles](https://github.com/nurockplayer/tachiko-work/blob/6900e975112576585fd9360f12d9fcf8b36ba466/docs/vision/design-principles.md), [authority policy](https://github.com/nurockplayer/tachiko-work/blob/6900e975112576585fd9360f12d9fcf8b36ba466/docs/governance/knowledge-authority.md), [ADR index](https://github.com/nurockplayer/tachiko-work/blob/6900e975112576585fd9360f12d9fcf8b36ba466/docs/decisions/README.md), and [frontend/runtime boundary](https://github.com/nurockplayer/tachiko-work/blob/6900e975112576585fd9360f12d9fcf8b36ba466/docs/architecture/frontend-backend-boundary.md).
- Existing promoted product scope: [Work #256](https://github.com/nurockplayer/tachiko-work/issues/256) and [#261](https://github.com/nurockplayer/tachiko-work/issues/261), already mapped in Sheet PRODUCT-ACCEPTANCE.md. These are not the missing research report.
- Workflow comparison: [Richman4 #1](https://github.com/nurockplayer/richman4-remake/issues/1), read live. Reuse its Mission/handoff/child separation and actual-product validation discipline, not its game, asset or model-specific rules.

**Source gap:** the separate recent Spreadsheet Deep Research full report was not located in the available uploads/library. No two-report synthesis is claimed. Its later intake should reconcile concrete interaction decisions before their affected work is frozen; it does not invalidate the existing accepted scope or block independent #3 qualification. Do not fill its absent findings with assumptions.

## What the PDF says

| Pages | Source-derived conclusion |
|---|---|
| 1–6 | Shared platform capabilities and reusable engines can coexist with product-specific models. Public API differences are evidence of exposed contracts; vendor internal code-sharing remains partly unknown. |
| 7–10 | References/projections and shared datasets can support cross-product use without making everything one block/table/cell. Reusable engine does not mean universally interchangeable widget. |
| 10–12 | Clone templates, linked/versioned components and multi-resource blueprints have different identity and dependency needs. |
| 14–19 | Decide costly identity/version/ownership boundaries early; leave replaceable seams; defer hypothetical universal models and builders. |

The report's examples are not Tachiko schemas. Its Notion scale observations do not prove that a universal block model caused a failure. This intake does not independently re-verify every external citation or infer unpublished vendor implementation.

## Reconciliation with the real project

**Synthesis:** the report supports the existing Constitution's small stable core and Design Principle 12 (generalize from real pressure). It does not authorize dismantling the shared semantic runtime, introducing a JS formula engine, moving canonical state into Sheet, or freezing a new persistence envelope. ADR-0020/0022 and the frontend/runtime boundary still govern. Read narrower Accepted ADRs/specs before implementing their capability.

**Observed audit:** main has only eight documentation/entry files, not a production Sheet UI. SPEC.md already separates UI/runtime/host, uses bounded semantic operations, makes AI optional and rejects a generic editor platform. Therefore there is no UI implementation to certify or refactor here. Remaining preparation gaps are explicit composition guidance, a transferable single-lead policy, concrete task inputs/expected facts and a recoverable next action.

**Ownership, not replacement:** Work #359 owns the experimental kit/canonical I/O; #361 owns optional delegated authority; #364 retains its separately gated named-history profile. Open PRs #331 and #351 are not merged capabilities and do not prove this client's summary or native-host behavior. Current-main inspection does not repin the old acceptance kit automatically. In particular ADR-0037's v2 persistence and package-v1 refusal must not be bypassed to make a later summary/export journey appear green.

## Resulting local changes

[PRODUCT-PRINCIPLES.md](../PRODUCT-PRINCIPLES.md) states the minimum local boundaries. [MVP-EXECUTION.md](../MVP-EXECUTION.md) gives the existing queue and gate ownership. [Task inputs](../../acceptance/mvp-v1/README.md) supplement, not replace, the original canary seed. DELIVERY.md's lead-role amendment requires independent review and merge before taking effect. No upstream ADR, production Ready decision, public launch approval or runtime PASS follows from this research intake.
