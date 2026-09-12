# Research index

Status: research provenance and discussion history for Tachiko Sheet. These notes are **not** a second Tachiko Work Product Constitution, Accepted ADR, storage contract, or release decision. Live upstream authority and the Sheet Mission win where a concrete contract differs.

## Why this directory exists

Tachiko Sheet was intentionally started as a fresh spreadsheet client, but it is also the first concrete product being developed inside the wider Tachiko Work direction. Early discussions therefore split into two different questions:

1. **What should a serious spreadsheet product feel and behave like?**
2. **What kind of shared platform boundary should exist underneath multiple official products without weakening product-native semantics?**

Keeping those questions separate is deliberate. The research should constrain decisions; it should not turn one speculative architecture idea into authority before a real product validates it.

## Documents

- [`2026-09-10-spreadsheet-research-brief.md`](2026-09-10-spreadsheet-research-brief.md) — the research question and scope agreed before designing Tachiko Sheet. The full research result is not currently preserved in this repository, so this file records the brief only and makes no missing-source findings.
- [`2026-09-12-composable-platform-research-brief.md`](2026-09-12-composable-platform-research-brief.md) — the final deliberately compact Deep Research prompt, plus why the earlier checklist-heavy version was shortened.
- [`2026-09-12-composable-platform-report.md`](2026-09-12-composable-platform-report.md) — evidence-grounded digest of the owner-uploaded 21-page *Tachiko Work：Composable Application Platform 的產品與架構研究* report.
- [`2026-09-12-product-architecture-discussion.md`](2026-09-12-product-architecture-discussion.md) — chronological synthesis of the product/architecture discussion: Notion-like templates, internal LEGO/composability, the Deep Research prompt, and how the report changed the working thesis.
- [`2026-09-12-platform-intake.md`](2026-09-12-platform-intake.md) — reconciliation of the platform report with live Tachiko Work authority and Sheet delivery state.
- [`../PRODUCT-PRINCIPLES.md`](../PRODUCT-PRINCIPLES.md) — the compact Sheet-local principles that were promoted from the reconciled research.

## Evidence boundary

The owner-uploaded platform PDF is not checked into this repository. Its provenance is recorded in the intake, including SHA-256. The Markdown digest preserves the report's supported conclusions and labels inference as such; it does not pretend to know unpublished vendor internals.

The separate Spreadsheet Deep Research full report was not available when these notes were assembled. We therefore preserve its agreed question set, but do **not** manufacture product conclusions from memory or general industry knowledge. When that report becomes available, it should be added as a separate source and reconciled against the existing Mission, Product Acceptance, and upstream authority.

## Working rule

Research can propose or invalidate a hypothesis. It cannot silently override:

- live Sheet #1 Mission and hard constraints;
- current Sheet #2 handoff/ownership;
- Tachiko Work Product Constitution;
- Accepted ADRs/specs and their explicit ownership;
- release/acceptance evidence.

The practical goal is to preserve enough context that future agents understand **why** a boundary exists without having to rediscover the entire conversation.