# Tachiko Sheet UI design authority

This directory contains current UI design authority, durable design contracts, and
retained historical design evidence. Start here before implementing or materially
changing a user-facing Sheet surface.

Tracked reconciliation: [#79](https://github.com/nurockplayer/tachiko-sheet/issues/79).

## Current authority precedence

For visual and interaction presentation, resolve conflicts in this order:

1. **Accepted product / semantic authority** — the live governing Issue/spec and
   accepted Tachiko Work authority define what the product means and which
   capabilities/states actually exist.
2. **Exact approved canonical Figma nodes** — the approved editable nodes recorded
   by [#71](https://github.com/nurockplayer/tachiko-sheet/issues/71), including
   [#69 Phase A](https://github.com/nurockplayer/tachiko-sheet/issues/69), are the
   current implementation authority for visual hierarchy, spacing, typography,
   component states, responsive presentation, and the built-in Interface Profiles.
3. **Interface Profile v1 contract** — [#68](https://github.com/nurockplayer/tachiko-sheet/issues/68)
   and its follow-ups #69/#70 define the stable appearance/runtime boundary.
4. **UI quality contract** — [ui-quality-contract.md](ui-quality-contract.md)
   defines enduring interaction, accessibility, state-truth, density, and evidence
   rules.
5. **Historical design bundles** — for example
   [fes45-v2/](fes45-v2/) (the approved FES45 v3 bundle) remain evidence and source
   material where they have not been superseded by later accepted authority.

A later accepted authority may supersede a historical bundle without rewriting that
bundle. Do not edit a hashed/reviewed historical evidence package merely to make its
old text look current.

## Current surface inventory

The accepted View inventory now contains **five** destinations:

1. Table
2. Cross-table summary
3. Brief
4. Import & export
5. Report

The historical FES45 v3 bundle predates the production-bound fifth Report View and
contains text saying there are four Views. That statement is historical evidence,
not the current surface inventory. The #71 canonical Figma system includes Report
and its Reports & Charts states.

## Figma authority and authoring workflow

[#44](https://github.com/nurockplayer/tachiko-sheet/issues/44) governs the ongoing
design-before-implementation workflow.

Material UI work normally follows:

```text
product/UX contract
    -> design authoring
    -> editable canonical Figma authority
    -> independent design review
    -> implementation
    -> exact-build visual/interaction verification
```

Dense screens may be authored render-first through an ephemeral HTML/CSS design
harness and imported as editable nodes. The harness is design tooling, not product
implementation or authority by itself.

The GitHub-render implementation-authority path used by #45 was a bounded pilot
exception. The completed #71 canonical Figma system is the current authority for
later material UI work.

### Writable-Figma qualification

The supported qualified write path is the official
`gethopp/figma-mcp-bridge` v0.0.22 server with the matching plugin, proven by
[#72](https://github.com/nurockplayer/tachiko-sheet/issues/72).

[#55](https://github.com/nurockplayer/tachiko-sheet/issues/55) is retained historical
non-PASS evidence. Do not cite #55 as the successful bridge qualification and do not
revive the retired custom executor.

## Interface Profile v1 boundary

The accepted `InterfaceProfileV1` contract is the closed schema established by #68:

```text
InterfaceProfileV1 {
  schemaVersion: 1
  name: string
  colorScheme: "light"
  typography: "tachiko-local" | "system-local"
  density: "compact" | "comfortable"
  chrome: "porcelain" | "structured" | "quiet"
  colors: exact closed map<ColorRoleV1, #RRGGBB>
}
```

For v1:

- public roles are semantic, not Figma/component/selector names;
- icons, brand glyphs, state glyphs, assets, protected status treatments, focus
  geometry, forced-colors behavior, and reduced-motion behavior remain product-owned;
- there is no `icons` or `assets` manifest field;
- arbitrary CSS, JavaScript, HTML, URLs, remote resources, and executable theme
  content are excluded;
- profile selection is application appearance, never workbook/document authority;
- report/export pixels remain document output and do not consume Interface Profile
  appearance tokens.

The broader Icon Theme / asset-package ideas recorded in #47 are future-version
exploration, not permission to widen InterfaceProfileV1.

## Figma-to-runtime mapping

[interface-profile-v1-mapping.json](interface-profile-v1-mapping.json) and
[interface-profile-v1-mapping.md](interface-profile-v1-mapping.md) record the checked-in
bridge from approved semantic roles to the private runtime recipes.

Verified native Figma `variableId`, `collectionId`, and `modeId` values are
**not required for v1 design authority**. When the approved evidence does not expose
verified binding IDs, the mapping records them as `null`; never infer IDs from names,
screenshots, or node structure.

Authority comes from the accepted semantic role/value mapping and exact approved
Figma nodes, not from manufacturing native binding identifiers.

## What design authority does not prove

Approved Figma nodes and visual evidence do not by themselves prove:

- runtime correctness;
- workbook/document semantic behavior;
- persistence/save/recovery correctness;
- CJK IME behavior;
- screen-reader/assistive-technology behavior;
- native OS behavior;
- real-device/browser/platform support.

Those remain owned by the applicable product, acceptance, host, accessibility, and
physical-device gates.

## Implementer checklist

Before materially changing UI:

1. Read the governing product/semantic Issue.
2. Read #44 and the exact approved Figma authority for the surface.
3. Read the relevant #68/#69 Interface Profile contract when appearance is involved.
4. Use semantic roles/private recipes rather than Figma names as runtime API.
5. Do not reinterpret historical FES45 text when later approved authority supersedes it.
6. Preserve focus, selection, draft/IME continuity, truthful state, forced colors,
   reduced motion, and document/runtime boundaries.
7. If implementation exposes a genuinely new product/design choice, return it to the
   appropriate authority instead of improvising in code.
