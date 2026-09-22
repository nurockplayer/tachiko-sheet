# Interface Profile v1 mapping

`interface-profile-v1-mapping.json` is the checked-in bridge from the approved
#71 role board to the runtime boundary. It records the canonical 29 semantic
roles, their approved six-digit values, and the private CSS variable name the
root integration binds through private component recipes. Public profile code never consumes Figma names,
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

## Runtime integration (bounded #68 slice)

The built-in Tachiko profile is resolved and applied once to
`document.documentElement` before mode selection, runtime creation, or React
rendering. The application seam does not recreate the runtime or expose profile
state to React. Existing private `--ts-*` recipes use profile custom properties
with their current six-digit values as fallbacks, preserving the current
appearance when no profile is applied.

The integration reserves `surface.app`, `accent.background`, `selection.header.foreground`, and the
profile attributes for later appearance work. It uses the canonical
`surface.chrome.tint`, `grid.canvas`, `selection.active.background`,
`selection.active.border`, `action.primary.foreground`, and `focus.ring` roles
where their current production values already agree. The three held roles above
remain on explicit current-value recipes and are not consumed by CSS aliases.
Protected chips, statuses, disabled controls, destructive controls, forced
colors, reduced motion, focus geometry, scrim, and report pixels remain
product-owned.
