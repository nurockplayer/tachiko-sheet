# Interface Profile v1 mapping

`interface-profile-v1-mapping.json` is the checked-in bridge from the approved
#71 role board to the runtime boundary. It records the canonical 29 semantic
roles, their approved six-digit values, and the private CSS variable name the
root integration may bind later. Public profile code never consumes Figma names,
selectors, or node structure.

The retained Figma evidence is a painted/readback artifact. It contains no
verified variable, collection, or mode binding identifiers, so each role's
`binding` slot carries `variableId`, `collectionId`, and `modeId` as `null`.
The shared reason is `unavailable: painted/readback frames contain no verified
binding IDs`. No IDs are inferred from names or screenshots.

The three approved values that currently differ from production CSS remain held
for Steward disposition and are intentionally not wired by this package:

| Role | Approved mapping | Current production CSS | Status |
| --- | --- | --- | --- |
| `text.link` | `#5542B5` | `#245D9F` | held |
| `text.reference` | `#4F54AD` | `#23508A` | held |
| `grid.header.foreground` | `#5B6072` | `#646879` | held |

The mapping does not control protected state colors, disabled or destructive
treatments, modal scrim, focus geometry, forced-colors behavior, reduced-motion
behavior, or report/document pixels.
