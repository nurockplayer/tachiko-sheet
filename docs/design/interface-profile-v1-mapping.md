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
binding IDs`. No IDs are inferred from names or screenshots. **Native binding IDs are not a v1 authority prerequisite**: accepted semantic role/value mapping plus the exact approved Figma nodes are sufficient authority for v1 when binding identifiers are unavailable.

The historical role-board evidence and its recorded source hashes remain
unchanged as the original 29-role snapshot. The `border.control` row is superseded by the
approved canonical node 32:75 in the same Figma file: its approved value is
`#818798`, as recorded by the #70 design amendment and independent review
([PASS receipt](https://github.com/nurockplayer/tachiko-sheet/issues/70#issuecomment-5799633002)).
Its row points directly to that node. The original role-board node and source
hashes above remain historical provenance; they are not rewritten to imply
that the amendment came from the old board.

The three values below correct prior implementation drift under the explicit
[Steward disposition](https://github.com/nurockplayer/tachiko-sheet/issues/68#issuecomment-5774025721).
Their canonical values are wired through private aliases:

| Role | Approved mapping | Prior production CSS | Status |
| --- | --- | --- | --- |
| `text.link` | `#5542B5` | `#245D9F` | wired |
| `text.reference` | `#4F54AD` | `#23508A` | wired |
| `grid.header.foreground` | `#5B6072` | `#646879` | wired |

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
where their current production values already agree, plus the three approved
bindings listed above. The reserved roles above do not add new visible
treatments in this boundary migration.
Protected chips, statuses, disabled controls, destructive controls, forced
colors, reduced motion, focus geometry, scrim, and report pixels remain
product-owned.
