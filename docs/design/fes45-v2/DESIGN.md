# FES45 v3 — Porcelain / violet workbook

## Design decisions

The workbook is the document, not a data-management dashboard. The small product
signature sits above an 18px workbook title beside an optically drawn 32px sprout.
The header has a faint porcelain-to-lavender material; the data plane stays white.
Violet connects brand, primary action, focused field, row locator and selected View.
Exceptions remain semantic red/amber, not decorative brand colors.

- Data: Inter Regular 14/20. The row pitch remains 28px and the cell inset 4×10px.
- Title: Inter Display Semibold 18/24. Compact labels: Inter Medium 12/20.
- Metadata: 11/16. Work/Values status: 12/20, never omitted or color-only.
- Japanese: Noto Sans CJK JP; Traditional Chinese: Noto Sans CJK TC, real local faces.
  TC is a chosen v3 face, not a concealed v2 fallback. No remote or distributed fonts.
- Commands retain 32px hit height, 7px radius, icon/label alignment and explicit hover,
  pressed, disabled and 3px keyboard focus with 2px clearance. Menus use 10px corners.
- Grid: separate quiet horizontal/vertical lattice; opaque structural boundaries.
  Selected data row is #F6F4FE; row number is solid violet/white. Focused field has a
  violet location echo and underline. Active cell is white, with a 2px pointer border
  or a single 3px keyboard perimeter. Error and focus remain different cues.
- Views: four supported destinations only; individual icons, a restrained selected
  surface and underline. The Views/status foundation is quiet but explicitly labeled.
- Exceptions: each channel has its own glyph and well; dark full prose is legible,
  wrapping and nondismissible. No giant colored panel, toast or collapsed warning.
- Hints: F2 and Enter keycaps are explanatory text, not new commands or focus targets.

## Dense composition and responsive rules

Wide normal: document header 60, context 40, Views 36, status 28 = 164px non-grid.
Compact normal: header 96, context 40, Views 36, status 28 = 200px non-grid.
Narrow normal: header 136, context 88, Views 36, status 44 = 304px non-grid.
The identity row gains 12px versus v2; no grid font/target shrink hides the cost.
Effective-width tiers remain 1024 / 600 / 320. Notices, save scope and status text may
wrap and grow. `L=max(viewportHeight,nonGridHeight+168)` keeps a usable minimum grid;
extra height becomes document scrolling. Only the grid and Views pan horizontally.

| Main workspace | Grid height | Complete visible rows | Grid / viewport height |
|---|---:|---:|---:|
| 1920×1080 | 916 | 31 | 84.81% |
| 2048×1152 | 988 | 33 | 85.76% |
| 2560×1440 | 1276 | 44 | 88.61% |
| 1512×982 | 818 | 27 | 83.30% |

There is no workspace card, sidebar, ribbon, ornamental empty panel or native window
chrome. The exact component geometry and measured region boxes are in the manifest.

## Product invariants

The only document commands are Refresh, Save a copy and Close project. The Table
selector selects a collection. Compact/narrow More exposes only Close project.
The four Views remain Table, Cross-table summary, Brief, Import & export. No new
search/filter/sort, formatting, undo, worksheet creation, sharing, cloud or AI controls.

`controlsLocked = busy || commitPending || currentness === "unknown"`.
Selector lock additionally includes an active cell draft; Save additionally locks
while saving. Close is disabled only when busy. Views have no invented busy gate.

The illustrative projection remains 50 rows × 8 exact ordered columns, unchanged
values, boolean strings and reference/empty/error display meanings. Units row 8 stays
committed `18`; editor `21` or rejected `abc` is unapplied. Selection details are
noninteractive committed/last-read readouts. No formula or canonical validation is implemented.

Copy save, current work and value currentness are always separate. A previous saved
copy never overrides edited/draft truth. UnknownRetainedDraft has all three existing
rejection/currentness/outcome messages, saved-older-copy acknowledgement, unsaved-draft
footer and retained `abc`; locked editor has no caret/focus, and no retry is invented.
The narrow dirty-draft abbreviation is accompanied by its full not-saved warning.

## Accessibility boundary

Semantic DOM, non-color cues, text disclosure, tab/command focus visibility and
reflow are preserved; read-only facts are not styled as disabled controls. Reduced
motion requires no animation. Emulated forced colors preserves system borders,
selection and focus. These browser design checks do not certify native OS behavior,
IME composition, screen readers, real-device host quality or production usability.
