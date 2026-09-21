# Tachiko Sheet — FES45 v3

**Design candidate. Independent review: PENDING. Implementation authority: false.**

A document-first, high-density workbook with a porcelain/violet visual language,
larger readable data typography, optical small-size branding and explicit work truth.
This is a deterministic design harness, not the Tachiko Sheet product runtime.

## Inspect

- `renders/fes45-v3-macbook-retina.png`: 1512 × 982 normal workbook.
- `renders/fes45-v3-fhd.png`: 1920 × 1080 normal workbook.
- `renders/fes45-v3-state-mac-unknownretaineddraft.png`: compound retained-draft truth.
- `preview.html`: self-contained offline review page, with a separate specimen switcher.
  `preview-source.html` is its uncompressed equivalent. No external scripts or fonts are fetched.
- `index.html?scene=macbook-retina`: exact source harness when served from this directory.
- `renders/fes45-v3-components.png`: complete component and semantic-state specimens.
- `renders/fes45-v3-review-board.png`: overview, not a substitute for full-size inspection.

The portable preview permits a visibly disclosed system-font fallback when the exact
local design fonts are missing. The evidence renderer does not: it fails explicitly.
The preview's specimen picker is review tooling outside the product, not a new Sheet command.
Product commands in the harness do not call a runtime, save a file or calculate values.

## Evidence

All 26 required evidence classes were freshly rendered at the v3 dimensions. Three
source-region details are actual 2× Chromium captures. Both complete render passes
matched all 26 PNG SHA-256 values. `verification/browser-checks.json` records 61
additional author-owned checks; these are not independent review, real-device/IME,
screen-reader, release, or production acceptance.

Evidence aggregate SHA-256:
`bf583416d1cd394f4b31091ad42ca6c4ab87b5c130224fb68577638c1351fd38`

`fes45-v3-manifest.json` links every input, image, state, measured region, font and
verification artifact. `MANIFEST.sha256` supplies its external identity. Run
`python verify_bundle.py` to verify the delivered bytes without rerendering.

See `DESIGN.md`, `AUTHORITY.md`, `VISUAL_REVIEW.md`, and `REPRODUCE.md`.
All intended repository changes are contained in `docs/design/fes45-v2/`.
No fonts, browser binaries, secrets, caches, production implementation or Figma files are included.
