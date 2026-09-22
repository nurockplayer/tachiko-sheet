# #68 nonconflicting integration evidence

This is a tested **WIP checkpoint**, not a Final Candidate or acceptance closeout.
The canonical Figma values for `text.link`, `text.reference` and
`grid.header.foreground` conflict with the current-render parity requirement.
Their CSS consumers retain the current values until the
[Steward disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5773480863).
The canonical manifest/mapping is unchanged; no compatibility exception is claimed.

## Tested material

Baseline: merged #74, `799c42120c3c2a2ae6a4e2ab796b33c1062d9dcc`.
`source-manifest.json` identifies the exact tested implementation and evidence
helper contents; the owning #68 checkpoint records the containing commit.
Root Astra integrated bounded worker-luna packages and verified these results.
Both Luna audits and the separate Sol architecture consultation are WIP input,
not independent final-review approval.

## Actual checks

- `pnpm typecheck`: PASS.
- Focused profile/CSS unit tests: 90 PASS.
- `pnpm test:unit`: 179 Vitest + 16 Node tests PASS.
- `pnpm build`: PASS, including acceptance-hook exclusion across 66 output files.
- `pnpm acceptance:product`: PASS, including unchanged six M1 journeys,
  J3, J4 normal/imported, J5 report, recovery, focus and the added profile probe.
- `WORK_DIST=dist pnpm test:visual-foundation`: PASS.
- `git diff --check`: PASS before checkpoint.
- Existing core pin/provenance verification: PASS, 24 assets; core assets unchanged.

The added real-kit browser probe saves a real J4/J5 report copy, opens an active
cell draft, then applies a valid manifest changing all 29 public colors. It
requires stable shell subtree/control identity, focus and draft selection;
zero public Work-method and host-write delta; unchanged occurrence, revision,
opaque project bytes, saved bytes and presentation attachment; and byte-identical
exported report PNG. Four actual protected nodes and 24 supplementary CSS recipe
cases remain unchanged. Forced colors and reduced motion retain precedence.
Report PNG SHA-256: `1cec08cd95325d175aace8c88e8e4423dad233c5c79b94bc613195ba7e76f73a`.

Generic project observation uses public `exportOpaque`, because the existing J4
grouped-sum project requires the core's format-2 export. It never decodes or
rewrites those bytes. Observations are outside the zero-Work measurement window.
The scrim recipe compares its painted background; inherited colors on its empty,
borderless element do not paint content. Existing acceptance oracles are unchanged.

## Visual comparison

The immutable baseline and production candidate were captured in the same
Chromium environment at 320, 360, 600, 720, 1023, 1024, 1280, 1440, 1512, 1920,
2560 and 3840 widths. Seven states: first entry, Home, populated grid, focus,
CJK draft, Save dialog, and forced colors/reduced motion. Geometry is unchanged.

83 original pairs match exactly. The 720×450 Home baseline was prematurely
clipped at 488 pixels while its already-settled sampled geometry extends to
622 pixels. Its overlap with the candidate is pixel-identical. A focused repeat
on both immutable builds waits for the Saved copies section and two animation
frames; both complete 720×622 images have SHA-256
`d194668c502dbc0e995207e3329726254342673f710362fbf831b0d405f9fd2a`.
All 84 states therefore have matching evidence; original captures are preserved.
See `parity-summary.json` for exact raw and corrected evidence references.

Artifacts, capture/comparison scripts and full command logs are retained at
`/Users/tachikoma/.codex/artifacts/tachiko-sheet-68`; current product runner logs
are checked in under `evidence/product-acceptance`.

## Remaining gate

Steward disposition of the three bindings is required before completing the
public boundary. No Final Candidate, hosted-gate result, fresh independent Sol
review, merge, #69 Phase B readiness, engineering RC, physical IME/AT acceptance
or production promotion is claimed by this checkpoint. Held #40 is untouched.
