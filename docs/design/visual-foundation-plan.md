# #13 Visual Foundation — target and evidence plan

Baseline: `04fb58b6dc4a0c463f9450f50fbe98fe523f3579`
Lane: `codex/visual-foundation`
Scope: `src/ui/**`, presentation-only app shell/CSS/assets, and focused visual evidence.

## Before state (current build)

Before any restyling, the current build is recorded as the control: a system-font
two-column shell with a pale grey page, rounded cards, pill-shaped status chips,
and a bordered grid. The Home view is a centered stack of cards; the Workbook
view puts the title/status row above a separate action row and tabs. Current
behaviour is the authority for controls, loading/recovery states, cell editing,
keyboard movement, and modal focus management. A browser capture of the built
baseline belongs in `evidence/visual-foundation/before/` and must include the
viewport, zoom, build commit, and capture date.

## Annotated target compositions

These are visual targets, not new product states. Each target is annotated with
layout intent, density, and the existing control/state it represents.

1. **Home** — compact workspace landing: left brand/context rail, prominent
   open-project action, and a quiet saved-copy list; no invented navigation.
2. **Populated Workbook** — title and freshness/save status in one calm header,
   actions grouped by consequence, table occupying the primary canvas, and
   Brief remaining a clearly secondary view.
3. **Active edit / selection** — one strong cell selection, a visible inline
   editor with a high-contrast focus ring, and enough row/column context to
   preserve orientation at dense zooms.
4. **Command / save dialog** — the existing Save a copy modal, with clear
   hierarchy, explicit device-local wording, and keyboard-trapped focus.
5. **Error / recovery** — truthful exception banner and recovery action, with
   unknown freshness visually distinct from ordinary warnings and no stale grid
   presented as editable.

## Brief / overlay state board

The state board maps existing states to presentation treatment: current (quiet
neutral), pending (progressive but non-alarming), saved (confirmation), failed
(actionable error), unknown freshness (blocking recovery), and unavailable or
calculation-failure cells (explicit cell-level exceptions). It also records
responsive breakpoints, keyboard focus, CJK wrapping, reduced-motion, and forced
colors checks. No state in this board grants frontend authority over canonical
data or adds an unsupported capability.

## Implementation and verification sequence

1. Capture and pin the baseline metadata/capture before broad restyling.
2. Establish local tokens and primitives (frame, toolbar, status, grid, modal,
   focus, exception) while preserving existing DOM semantics and handlers.
3. Add focused executable assertions for visual hooks and accessibility where
   they clarify the contract; keep existing core/runtime tests unchanged.
4. Run focused UI tests, `pnpm test:unit`, `pnpm typecheck`, and `git diff --check`.
5. Record target captures and test output under `evidence/visual-foundation/`.

## Guardrails

- No remote fonts/assets, fake spreadsheet controls, semantic state, formula
  evaluation, codec, save/recovery behaviour, or core-kit changes.
- Preserve the existing product copy and interaction contracts unless a wording
  change is presentation-only and makes an existing capability clearer.
- Every capture names its exact build revision and viewport/zoom; functional,
  native, and source-fidelity evidence remain separate.
